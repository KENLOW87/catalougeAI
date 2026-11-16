// Publish-all writes only non-empty catalogues and never removes an existing
// published snapshot just because its current browser catalogue is empty.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { installPublish } from './publish.mjs'

const directory = mkdtempSync(join(tmpdir(), 'catalogue-publish-all-'))
let server
try {
  const app = express(); app.use(express.json()); installPublish(app, { directory })
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const root = `http://127.0.0.1:${server.address().port}`
  const post = (path, body) => fetch(root + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const get = path => fetch(root + path)

  const original = [{ id: 'p1', name: 'Published product' }]
  assert.equal((await post('/api/publish/kept', { title: 'Kept', products: original })).status, 200)

  const response = await post('/api/publish-all', {
    catalogues: [
      { category: 'kept', title: 'Kept now empty', products: [] },
      { category: 'new-catalogue', title: 'New', products: [{ id: 'p2', name: 'New product' }] },
    ],
  })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual(result.published.map(x => x.categoryId), ['new-catalogue'])
  assert.deepEqual(result.skipped, [{ categoryId: 'kept', reason: 'empty' }])
  assert.deepEqual((await (await get('/api/published/kept')).json()).products, original)
  assert.deepEqual((await (await get('/api/published/new-catalogue')).json()).products, [{ id: 'p2', name: 'New product' }])
  assert.equal((await post('/api/publish/empty', { products: [] })).status, 400)

  console.log('PASS publish-all: non-empty catalogues publish, empty entries skip, existing snapshots stay intact.')
} finally {
  if (server) await new Promise(resolve => server.close(resolve))
  rmSync(directory, { recursive: true, force: true })
}
