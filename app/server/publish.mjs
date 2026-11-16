// Publish: a durable, server-side snapshot of one catalogue, for the public
// read-only site to show. Modeled on activity.mjs's durable-file pattern.
//
// Storage: one JSON file per catalogue at <directory>/<categoryId>.json, holding
// { categoryId, title, products, chrome, publishedAt }. Images already live inline
// as base64 inside `products` (ProductDialog stores photos via FileReader), so this
// file is fully self-contained — no separate asset store is needed.
//
// Publishing is explicit and one-way: the admin's further edits do not reach the
// public site until Publish is pressed again. Re-publishing simply overwrites the
// existing snapshot.
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// categoryId is client-supplied and becomes part of a filesystem path — reject
// anything that is not a plain id before it ever reaches `fs`.
const VALID_ID = /^[a-zA-Z0-9_-]+$/

export function installPublish(app, { directory = fileURLToPath(new URL('../data/published/', import.meta.url)) } = {}) {
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

  app.post('/api/publish/:categoryId', (req, res) => {
    const { categoryId } = req.params
    if (!VALID_ID.test(categoryId)) return res.status(400).json({ error: 'Invalid categoryId' })
    const products = req.body?.products
    if (!Array.isArray(products)) return res.status(400).json({ error: 'products array required' })
    if (!products.length) return res.status(400).json({ error: 'Cannot publish an empty catalogue' })
    const snapshot = makeSnapshot(categoryId, req.body)
    writeFileSync(fileFor(categoryId), JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 })
    res.json({ ok: true, categoryId, publishedAt: snapshot.publishedAt })
  })

  app.post('/api/publish-all', (req, res) => {
    const catalogues = req.body?.catalogues
    if (!Array.isArray(catalogues)) return res.status(400).json({ error: 'catalogues array required' })

    // Validate every non-empty entry before writing any file. Empty catalogues
    // are deliberately skipped, and existing published snapshots are left alone.
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

    const published = validated.map(entry => {
      const snapshot = makeSnapshot(entry.categoryId, entry)
      writeFileSync(fileFor(entry.categoryId), JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 })
      return { categoryId: snapshot.categoryId, publishedAt: snapshot.publishedAt }
    })
    res.json({ ok: true, published, skipped })
  })

  app.delete('/api/publish/:categoryId', (req, res) => {
    const { categoryId } = req.params
    if (!VALID_ID.test(categoryId)) return res.status(400).json({ error: 'Invalid categoryId' })
    const file = fileFor(categoryId)
    if (!existsSync(file)) return res.status(404).json({ error: 'Not published' })
    unlinkSync(file)
    res.json({ ok: true })
  })

  app.get('/api/published', (_req, res) => {
    const list = readdirSync(directory)
      .filter(name => name.endsWith('.json'))
      .map(name => {
        try {
          const { categoryId, title, publishedAt } = JSON.parse(readFileSync(join(directory, name), 'utf8'))
          return { categoryId, title, publishedAt }
        } catch { return null } // a partially written file must not break the whole list
      })
      .filter(Boolean)
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    res.json(list)
  })

  app.get('/api/published/:categoryId', (req, res) => {
    const { categoryId } = req.params
    if (!VALID_ID.test(categoryId)) return res.status(400).json({ error: 'Invalid categoryId' })
    const file = fileFor(categoryId)
    if (!existsSync(file)) return res.status(404).json({ error: 'Not published' })
    res.json(JSON.parse(readFileSync(file, 'utf8')))
  })
}
