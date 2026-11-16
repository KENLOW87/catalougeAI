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

  app.post('/api/publish/:categoryId', (req, res) => {
    const { categoryId } = req.params
    if (!VALID_ID.test(categoryId)) return res.status(400).json({ error: 'Invalid categoryId' })
    const products = req.body?.products
    if (!Array.isArray(products)) return res.status(400).json({ error: 'products array required' })
    const snapshot = {
      categoryId,
      title: typeof req.body?.title === 'string' && req.body.title ? req.body.title : categoryId,
      products,
      chrome: req.body?.chrome ?? null,
      publishedAt: new Date().toISOString(),
    }
    writeFileSync(fileFor(categoryId), JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 })
    res.json({ ok: true, categoryId, publishedAt: snapshot.publishedAt })
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
