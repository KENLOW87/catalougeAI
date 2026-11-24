// Publish: a durable, server-side snapshot of one catalogue, for the public
// read-only site to show.
//
// Two backends behind one set of endpoints:
//
//   - Supabase (supabase-store.mjs), whenever SUPABASE_URL and
//     SUPABASE_SERVICE_ROLE_KEY are both set. This is what production uses.
//     Render's free plan gives the container no persistent disk, so a
//     file-backed snapshot is wiped on every redeploy AND on the 15-minute
//     idle spin-down — which is why published catalogues kept disappearing
//     from the live site. Supabase keeps them off the container.
//   - One JSON file per catalogue at <directory>/<categoryId>.json, when
//     Supabase is not configured. That is local development and the server
//     tests, which must keep working with no credentials at all.
//
// Either way the snapshot is { categoryId, title, products, chrome, publishedAt }.
// In the file backend images stay inline as base64, exactly as ProductDialog
// stored them. In the Supabase backend each image is uploaded once and the
// snapshot holds its URL instead — see supabase-store.mjs for why.
//
// Publishing is explicit and one-way: the admin's further edits do not reach the
// public site until Publish is pressed again. Re-publishing simply overwrites the
// existing snapshot.
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as supabase from './supabase-store.mjs'

// categoryId is client-supplied and becomes part of a filesystem path — reject
// anything that is not a plain id before it ever reaches `fs`.
const VALID_ID = /^[a-zA-Z0-9_-]+$/

export function installPublish(app, { directory = fileURLToPath(new URL('../data/published/', import.meta.url)), store = null } = {}) {
  mkdirSync(directory, { recursive: true })
  const fileFor = categoryId => join(directory, `${categoryId}.json`)
  const makeSnapshot = (categoryId, body) => ({
    categoryId,
    title: typeof body?.title === 'string' && body.title ? body.title : categoryId,
    products: body.products,
    chrome: body?.chrome ?? null,
    publishedAt: new Date().toISOString(),
  })
  const validateEntry = entry => {
    const categoryId = entry?.categoryId ?? entry?.category
    if (typeof categoryId !== 'string' || !VALID_ID.test(categoryId)) return { error: 'Invalid categoryId' }
    if (!Array.isArray(entry?.products)) return { error: 'products array required' }
    return { categoryId }
  }

  // The file backend, as its own store, so the two are the same shape and the
  // request handlers below never branch on which one they are talking to.
  const fileStore = {
    name: 'files',
    async put(snapshot) {
      writeFileSync(fileFor(snapshot.categoryId), JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 })
    },
    async list() {
      return readdirSync(directory)
        .filter(name => name.endsWith('.json'))
        .map(name => {
          try {
            const { categoryId, title, publishedAt } = JSON.parse(readFileSync(join(directory, name), 'utf8'))
            return { categoryId, title, publishedAt }
          } catch { return null } // a partially written file must not break the whole list
        })
        .filter(Boolean)
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    },
    async get(categoryId) {
      const file = fileFor(categoryId)
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
    },
    async remove(categoryId) {
      const file = fileFor(categoryId)
      if (!existsSync(file)) return false
      unlinkSync(file)
      return true
    },
  }

  const supabaseStore = {
    name: 'supabase',
    put: supabase.putSnapshot,
    list: supabase.listSnapshots,
    get: supabase.getSnapshot,
    remove: supabase.deleteSnapshot,
  }

  // Resolved per request, not once at install time, so a key added to the
  // environment takes effect on restart without this module caring about order
  // of imports. `store` is an injection point for tests.
  const backend = () => store ?? (supabase.isConfigured() ? supabaseStore : fileStore)

  // Express 4 does not catch rejected promises from an async handler — an
  // unhandled Supabase failure would hang the request instead of answering it.
  const handle = fn => (req, res) => fn(req, res).catch(error => {
    console.error('[publish]', error.message)
    if (!res.headersSent) res.status(502).json({ error: `Publish storage failed: ${error.message}` })
  })

  app.post('/api/publish/:categoryId', handle(async (req, res) => {
    const { categoryId } = req.params
    if (!VALID_ID.test(categoryId)) return res.status(400).json({ error: 'Invalid categoryId' })
    const products = req.body?.products
    if (!Array.isArray(products)) return res.status(400).json({ error: 'products array required' })
    if (!products.length) return res.status(400).json({ error: 'Cannot publish an empty catalogue' })
    const snapshot = makeSnapshot(categoryId, req.body)
    await backend().put(snapshot)
    res.json({ ok: true, categoryId, publishedAt: snapshot.publishedAt })
  }))

  app.post('/api/publish-all', handle(async (req, res) => {
    const catalogues = req.body?.catalogues
    if (!Array.isArray(catalogues)) return res.status(400).json({ error: 'catalogues array required' })

    // Validate every non-empty entry before writing any of them. Empty
    // catalogues are deliberately skipped, and existing published snapshots are
    // left alone.
    const validated = []
    const skipped = []
    const seen = new Set()
    for (const entry of catalogues) {
      const result = validateEntry(entry)
      if (result.error) return res.status(400).json({ error: result.error })
      if (seen.has(result.categoryId)) return res.status(400).json({ error: `Duplicate categoryId: ${result.categoryId}` })
      seen.add(result.categoryId)
      if (!entry.products.length) {
        skipped.push({ categoryId: result.categoryId, reason: 'empty' })
        continue
      }
      validated.push({ ...entry, categoryId: result.categoryId })
    }

    // One at a time: each catalogue can carry tens of megabytes of images, and
    // publishing all of them at once would put every byte in flight together.
    const target = backend()
    const published = []
    for (const entry of validated) {
      const snapshot = makeSnapshot(entry.categoryId, entry)
      await target.put(snapshot)
      published.push({ categoryId: snapshot.categoryId, publishedAt: snapshot.publishedAt })
    }
    res.json({ ok: true, published, skipped })
  }))

  app.delete('/api/publish/:categoryId', handle(async (req, res) => {
    const { categoryId } = req.params
    if (!VALID_ID.test(categoryId)) return res.status(400).json({ error: 'Invalid categoryId' })
    const removed = await backend().remove(categoryId)
    if (!removed) return res.status(404).json({ error: 'Not published' })
    res.json({ ok: true })
  }))

  app.get('/api/published', handle(async (_req, res) => {
    res.json(await backend().list())
  }))

  app.get('/api/published/:categoryId', handle(async (req, res) => {
    const { categoryId } = req.params
    if (!VALID_ID.test(categoryId)) return res.status(400).json({ error: 'Invalid categoryId' })
    const snapshot = await backend().get(categoryId)
    if (!snapshot) return res.status(404).json({ error: 'Not published' })
    res.json(snapshot)
  }))
}
