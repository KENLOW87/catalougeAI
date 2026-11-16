// Publish: snapshot one catalogue to a durable file, list/read it back, unpublish.
// No AI calls, no PDF export — pure HTTP round-trips against a temp directory.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { installPublish } from './publish.mjs'

const directory = mkdtempSync(join(tmpdir(), 'catalogue-published-'))
let server
try {
  const app = express(); app.use(express.json())
  installPublish(app, { directory })
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const root = `http://127.0.0.1:${server.address().port}`
  const get = path => fetch(root + path)
  const post = (path, body) => fetch(root + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const del = path => fetch(root + path, { method: 'DELETE' })

  const products = [{ id: 'p1', name: 'Led -160', photo: 'data:image/png;base64,aGVsbG8=' }]
  const chrome = { heightMm: 46 }

  // Nothing published yet.
  assert.deepEqual(await (await get('/api/published')).json(), [])
  assert.equal((await get('/api/published/fake-category')).status, 404)

  // Publish.
  const publishRes = await post('/api/publish/fake-category', { products, chrome, title: 'Fake Category' })
  assert.equal(publishRes.status, 200)
  const published = await publishRes.json()
  assert.equal(published.categoryId, 'fake-category')
  assert(published.publishedAt, 'records when it was published')

  // Lists without the full payload.
  const list = await (await get('/api/published')).json()
  assert.equal(list.length, 1)
  assert.equal(list[0].categoryId, 'fake-category')
  assert.equal(list[0].title, 'Fake Category')
  assert.equal(list[0].products, undefined, 'the list omits products/chrome')

  // Round-trips the full snapshot.
  const snapshot = await (await get('/api/published/fake-category')).json()
  assert.deepEqual(snapshot.products, products)
  assert.deepEqual(snapshot.chrome, chrome)
  assert.equal(snapshot.title, 'Fake Category')

  // Re-publishing overwrites rather than duplicating.
  await post('/api/publish/fake-category', { products: [], chrome: null, title: 'Fake Category' })
  const overwritten = await (await get('/api/published/fake-category')).json()
  assert.deepEqual(overwritten.products, [])
  assert.equal((await (await get('/api/published')).json()).length, 1, 'still exactly one snapshot')

  // Malformed ids are rejected before fileFor() ever builds a path from them. A
  // literal ".." never even reaches the server — URL parsing collapses the dot
  // segment first — so the test exercises ids that survive as one path segment.
  assert.equal((await post('/api/publish/a.b', { products: [] })).status, 400)
  assert.equal((await get('/api/published/not%20a%20valid%20id')).status, 400)
  assert.equal((await del('/api/publish/a.b')).status, 400)
  assert(!existsSync(join(directory, '..', 'evil.json')), 'nothing escaped the published directory')

  // Unpublish.
  const deleteRes = await del('/api/publish/fake-category')
  assert.equal(deleteRes.status, 200)
  assert.equal((await del('/api/publish/fake-category')).status, 404, 'deleting again 404s')
  assert.equal((await get('/api/published/fake-category')).status, 404)
  assert.deepEqual(await (await get('/api/published')).json(), [], 'gone from the list too')

  console.log('PASS publish: snapshot/list/round-trip/overwrite/unpublish, invalid categoryId rejected before touching the filesystem.')
} finally {
  if (server) await new Promise(resolve => server.close(resolve))
  rmSync(directory, { recursive: true, force: true })
}
