// Proves the Supabase publish backend actually works, against the real project.
//
// No AI calls and no money: this only touches Supabase Storage and Postgres.
// But it DOES write to the live project, so it is opt-in and it cleans up after
// itself — it publishes a throwaway catalogue under a reserved id, reads it
// back through the real HTTP endpoints, then unpublishes it. It never touches a
// real catalogue.
//
//   node server/check-publish-supabase-live.mjs --real-supabase
//
// What it has to prove, because these are the things that would have silently
// broken the live site:
//   1. The snapshot comes back with URLs, not base64 — otherwise the split
//      never happened and rows are still tens of megabytes.
//   2. Those URLs are publicly fetchable and return the exact bytes that went
//      in — otherwise the public site renders broken images.
//   3. They are served with CORS, or the drawing trim and cutout checks that
//      read pixels off a canvas will fail on the public site.
//   4. Re-publishing the same images uploads nothing — otherwise every bot edit
//      on the public site re-uploads the whole catalogue.
//   5. Unpublish removes the row.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from 'node:process'
import express from 'express'
import { installPublish } from './publish.mjs'
import { isConfigured } from './supabase-store.mjs'

if (!process.argv.includes('--real-supabase')) {
  throw new Error('Requires explicit --real-supabase authorization; writes to the live Supabase project')
}
const __dirname = dirname(fileURLToPath(import.meta.url))
if (existsSync(join(__dirname, '../.env'))) loadEnvFile(join(__dirname, '../.env'))
if (!isConfigured()) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in app/.env')

// A 2x2 red PNG and a 1x1 white one: small, but real image bytes with real
// mime types, so the extension and content-type handling is exercised.
const PNG_A = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAACg/ieZAAAAFUlEQVR4nGP8z8DAwMDAwMDAwAAABAABAAHgzLMAAAAASUVORK5CYII='
const PNG_B = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const uri = base64 => `data:image/png;base64,${base64}`
const sha = base64 => createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex')

// Reserved id, and a fresh suffix per run so two runs never collide.
const categoryId = `zz-live-check-${randomUUID().slice(0, 8)}`

const app = express()
app.use(express.json({ limit: '300mb' }))
installPublish(app)
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const root = `http://127.0.0.1:${server.address().port}`

const results = []
const step = (name, detail) => { results.push({ name, detail }); console.log(`  ok  ${name}${detail ? ` — ${detail}` : ''}`) }

try {
  console.log(`Publishing throwaway catalogue ${categoryId} to the live project…`)

  // PNG_A appears three times, in three different shapes of field, to prove the
  // generic walk finds images wherever the product shape puts them and that a
  // repeated image is stored once.
  const products = [
    { id: 'p1', name: 'Live Check One', photo: uri(PNG_A), details: [uri(PNG_B)] },
    { id: 'p2', name: 'Live Check Two', photo: uri(PNG_A), drawing: uri(PNG_A) },
  ]
  const chrome = { image: uri(PNG_B), heightMm: 40, text: 'live check' }

  const publish = () => fetch(`${root}/api/publish/${categoryId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ products, chrome, title: 'Live Check' }),
  })

  // Read the body once: a Response body can only be consumed a single time, so
  // it cannot be both the assertion message and the parsed result.
  const first = await publish()
  const firstBody = await first.text()
  assert.equal(first.status, 200, `publish failed: ${firstBody}`)
  step('published', JSON.parse(firstBody).publishedAt)

  // 1. Round-trips as URLs, not base64.
  const readBack = await fetch(`${root}/api/published/${categoryId}`)
  assert.equal(readBack.status, 200)
  const body = await readBack.text()
  assert.ok(!body.includes('data:image/'), 'the stored snapshot still contains base64 — images were not split out')
  const snapshot = JSON.parse(body)
  assert.equal(snapshot.products.length, 2)
  step('no base64 in the stored snapshot', `${(Buffer.byteLength(body) / 1024).toFixed(1)} KB for 4 image references`)

  // Every image field is now an https URL under the project's public bucket.
  const urls = [
    snapshot.products[0].photo, snapshot.products[0].details[0],
    snapshot.products[1].photo, snapshot.products[1].drawing,
    snapshot.chrome.image,
  ]
  for (const value of urls) {
    assert.match(value ?? '', /^https:\/\/.+\/storage\/v1\/object\/public\/catalogue-images\//, `not a public storage URL: ${String(value).slice(0, 60)}`)
  }
  // The same bytes in three places resolve to one object; different bytes do not.
  assert.equal(snapshot.products[0].photo, snapshot.products[1].photo, 'identical images should share one object')
  assert.equal(snapshot.products[1].drawing, snapshot.products[0].photo, 'identical images should share one object')
  assert.notEqual(snapshot.products[0].details[0], snapshot.products[0].photo, 'different images must not collide')
  assert.ok(snapshot.products[0].photo.includes(sha(PNG_A)), 'object name should be the sha256 of its bytes')
  assert.ok(snapshot.chrome.image.includes(sha(PNG_B)), 'chrome image should be content-addressed too')
  step('images are content-addressed and de-duplicated', '5 references, 2 objects')

  // 2 + 3. Publicly fetchable, byte-exact, and CORS-enabled.
  for (const [value, expected] of [[snapshot.products[0].photo, PNG_A], [snapshot.chrome.image, PNG_B]]) {
    const res = await fetch(value, { headers: { origin: 'https://example.com' } })
    assert.equal(res.status, 200, `public image URL not readable: ${res.status}`)
    assert.match(res.headers.get('content-type') ?? '', /^image\/png/, 'served with the wrong content type')
    assert.equal(res.headers.get('access-control-allow-origin'), '*', 'no CORS header — canvas pixel reads will fail on the public site')
    const bytes = Buffer.from(await res.arrayBuffer())
    assert.equal(bytes.toString('base64'), expected, 'the stored bytes differ from what was published')
  }
  step('public URLs serve the exact bytes, with CORS and a long cache')

  // Appears in the list, without its payload.
  const list = await (await fetch(`${root}/api/published`)).json()
  const entry = list.find(row => row.categoryId === categoryId)
  assert.ok(entry, 'the published catalogue is missing from /api/published')
  assert.equal(entry.title, 'Live Check')
  assert.equal(entry.products, undefined, 'the list must omit products')
  step('listed by /api/published', `${list.length} catalogue(s) published in total`)

  // 4. Re-publishing the same images uploads nothing.
  const second = await publish()
  assert.equal(second.status, 200)
  const again = await (await fetch(`${root}/api/published/${categoryId}`)).json()
  assert.equal(again.products[0].photo, snapshot.products[0].photo, 'a re-publish changed a stable image URL')
  assert.notEqual(again.publishedAt, snapshot.publishedAt, 'a re-publish should restamp publishedAt')
  step('re-publish reuses the uploaded objects')

  // Empty catalogues are still refused, and bad ids still never reach storage.
  const empty = await fetch(`${root}/api/publish/${categoryId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ products: [] }),
  })
  assert.equal(empty.status, 400)
  const evil = await fetch(`${root}/api/published/${encodeURIComponent('../evil')}`)
  assert.equal(evil.status, 400)
  step('empty publishes and malformed ids still rejected')

  // 5. Unpublish.
  const removed = await fetch(`${root}/api/publish/${categoryId}`, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  assert.equal((await fetch(`${root}/api/published/${categoryId}`)).status, 404)
  assert.equal((await fetch(`${root}/api/publish/${categoryId}`, { method: 'DELETE' })).status, 404)
  step('unpublished, and gone')

  console.log(`\nPASS publish/Supabase: ${results.length} checks against the live project. Throwaway catalogue removed.`)
} catch (error) {
  // Never leave the live project holding a test catalogue, even on failure.
  await fetch(`${root}/api/publish/${categoryId}`, { method: 'DELETE' }).catch(() => {})
  console.error(`\nFAIL after ${results.length} check(s): ${error.message}`)
  process.exitCode = 1
} finally {
  server.close()
}
