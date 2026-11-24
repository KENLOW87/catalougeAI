// The Supabase publish backend, against an in-memory Supabase.
//
// Free and offline: `fetch` is stubbed with just enough of Supabase's Storage
// and PostgREST surface to be honest about status codes and request shapes. No
// credentials, no network, so this belongs in the ordinary regression suite —
// server/check-publish-supabase-live.mjs is the paid-nothing-but-real
// counterpart that proves the same things against the actual project.
//
// What matters here is the thing that cannot be eyeballed: that an arbitrarily
// shaped snapshot has EVERY image lifted out of it, wherever it sits, and comes
// back as URLs. A snapshot that keeps even one base64 field is a 40 MB row.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { installPublish } from './publish.mjs'

const PROJECT = 'https://test-project.supabase.co'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAACg/ieZAAAAFUlEQVR4nGP8z8DAwMDAwMDAwAAABAABAAHgzLMAAAAASUVORK5CYII='
const JPG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofGh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDQ0NP/bAEMBCQkJDAsMGA0NGDQhHCE0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='
const uri = (base64, mime = 'image/png') => `data:${mime};base64,${base64}`
const sha = base64 => createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex')

// ---- in-memory Supabase ----------------------------------------------------
const objects = new Map() // path -> { bytes, contentType }
const rows = new Map()    // category_id -> row
const seen = { buckets: [], uploads: [], lists: 0 }
let bucketExists = false

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  if (!url.startsWith(PROJECT)) return realFetch(input, init)
  const path = url.slice(PROJECT.length)
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))

  // Every call must be authorized, or the real thing would 401.
  assert.equal(headers.apikey, 'test-service-role-key', `missing apikey on ${method} ${path}`)
  assert.equal(headers.authorization, 'Bearer test-service-role-key', `missing bearer on ${method} ${path}`)

  // Bucket: probe, then create.
  //
  // The miss is HTTP *400* carrying "statusCode":"404" / "NoSuchBucket" in the
  // body, which is what the real Storage API does — not the bare 404 this stub
  // used to return. That lie let the first migration run fail against the real
  // project while this test passed, so keep it exactly as Supabase behaves.
  if (path === '/storage/v1/bucket/catalogue-images' && method === 'GET') {
    return bucketExists
      ? json({ name: 'catalogue-images' })
      : json({ statusCode: '404', error: 'Bucket not found', message: 'Bucket not found', code: 'NoSuchBucket' }, 400)
  }
  if (path === '/storage/v1/bucket' && method === 'POST') {
    const body = JSON.parse(init.body)
    assert.equal(body.public, true, 'the image bucket must be public — the catalogue site has no login')
    seen.buckets.push(body.id)
    bucketExists = true
    return json({ name: body.id })
  }

  // Storage: list by prefix.
  if (path === '/storage/v1/object/list/catalogue-images' && method === 'POST') {
    const { prefix, offset = 0, limit = 1000 } = JSON.parse(init.body)
    seen.lists++
    const names = [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length))
    return json(names.slice(offset, offset + limit).map(name => ({ name })))
  }

  // Storage: bulk delete.
  if (path === '/storage/v1/object/catalogue-images' && method === 'DELETE') {
    for (const prefix of JSON.parse(init.body).prefixes) objects.delete(prefix)
    return json([])
  }

  // Storage: upload one object.
  if (path.startsWith('/storage/v1/object/catalogue-images/') && method === 'POST') {
    const key = path.slice('/storage/v1/object/catalogue-images/'.length)
    assert.ok(Buffer.isBuffer(init.body), 'images must be uploaded as bytes, not a base64 string')
    assert.match(headers['cache-control'] ?? '', /immutable/, 'content-addressed objects should be cached immutably')
    seen.uploads.push(key)
    objects.set(key, { bytes: init.body, contentType: headers['content-type'] })
    return json({ Key: key })
  }

  // PostgREST: upsert.
  if (path === '/rest/v1/published_catalogues' && method === 'POST') {
    assert.match(headers.prefer ?? '', /resolution=merge-duplicates/, 're-publishing must upsert, not fail on the primary key')
    const row = JSON.parse(init.body)
    rows.set(row.category_id, row)
    return new Response('', { status: 201 })
  }

  // PostgREST: list.
  if (path.startsWith('/rest/v1/published_catalogues?select=category_id') && method === 'GET') {
    const list = [...rows.values()]
      .map(({ category_id, title, published_at }) => ({ category_id, title, published_at }))
      .sort((a, b) => b.published_at.localeCompare(a.published_at))
    return json(list)
  }

  // PostgREST: one row.
  if (path.startsWith('/rest/v1/published_catalogues?category_id=eq.') && method === 'GET') {
    const id = decodeURIComponent(path.match(/category_id=eq\.([^&]+)/)[1])
    const row = rows.get(id)
    return json(row ? [{ snapshot: row.snapshot }] : [])
  }

  // PostgREST: delete.
  if (path.startsWith('/rest/v1/published_catalogues?category_id=eq.') && method === 'DELETE') {
    const id = decodeURIComponent(path.match(/category_id=eq\.([^&]+)/)[1])
    const row = rows.get(id)
    rows.delete(id)
    return json(row ? [row] : [])
  }

  throw new Error(`stub has no route for ${method} ${path}`)
}

process.env.SUPABASE_URL = PROJECT
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

const app = express()
app.use(express.json({ limit: '300mb' }))
// A temp directory purely so nothing can touch app/data/published/: with
// Supabase configured the file backend is never reached, and the assertion at
// the end of this test proves it.
const directory = mkdtempSync(join(tmpdir(), 'catalogue-supabase-'))
installPublish(app, { directory })
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const root = `http://127.0.0.1:${server.address().port}`
const get = path => fetch(root + path)
const post = (path, body) => fetch(root + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const del = path => fetch(root + path, { method: 'DELETE' })

try {
  // Images hidden at four different depths and shapes, mirroring what the real
  // snapshots hold: products[].image, products[].photo, a bare array of data
  // URIs in products[].details, a nested variation, and chrome.image.
  const products = [
    { id: 'p1', name: 'Page 1', isPage: true, image: uri(JPG, 'image/jpeg'), details: [uri(PNG), uri(JPG, 'image/jpeg')] },
    { id: 'p2', name: 'LED-160', photo: uri(PNG), variations: [{ name: 'Black', photo: uri(PNG) }], note: 'not an image' },
  ]
  const chrome = { image: uri(PNG), heightMm: 40, text: 'header' }

  const published = await post('/api/publish/led-strip', { products, chrome, title: 'LED Strip' })
  assert.equal(published.status, 200, await published.text())

  // The bucket was created, once, and public.
  assert.deepEqual(seen.buckets, ['catalogue-images'])

  // Two distinct images across six references, so exactly two objects exist.
  assert.equal(seen.uploads.length, 2, `expected 2 uploads, got ${seen.uploads.length}: ${seen.uploads}`)
  assert.deepEqual([...seen.uploads].sort(), [`led-strip/${sha(JPG)}.jpg`, `led-strip/${sha(PNG)}.png`].sort())
  assert.equal(objects.get(`led-strip/${sha(PNG)}.png`).contentType, 'image/png')
  assert.equal(objects.get(`led-strip/${sha(JPG)}.jpg`).contentType, 'image/jpeg')
  // Byte-exact, not re-encoded.
  assert.equal(objects.get(`led-strip/${sha(PNG)}.png`).bytes.toString('base64'), PNG)
  console.log('  ok  every image uploaded once, content-addressed, byte-exact, correct mime + extension')

  // Nothing base64 survived into the row.
  const stored = JSON.stringify(rows.get('led-strip').snapshot)
  assert.ok(!stored.includes('data:image/'), 'base64 survived into the stored row')
  assert.ok(stored.length < 2000, `the row should be small, got ${stored.length} bytes`)
  console.log(`  ok  stored row holds no base64 (${stored.length} bytes for 6 image references)`)

  // Read back through the endpoint: URLs everywhere an image was, text untouched.
  const back = await (await get('/api/published/led-strip')).json()
  const pngUrl = `${PROJECT}/storage/v1/object/public/catalogue-images/led-strip/${sha(PNG)}.png`
  const jpgUrl = `${PROJECT}/storage/v1/object/public/catalogue-images/led-strip/${sha(JPG)}.jpg`
  assert.equal(back.products[0].image, jpgUrl)
  assert.deepEqual(back.products[0].details, [pngUrl, jpgUrl])
  assert.equal(back.products[1].photo, pngUrl)
  assert.equal(back.products[1].variations[0].photo, pngUrl, 'an image nested inside a variation must be lifted too')
  assert.equal(back.chrome.image, pngUrl)
  assert.equal(back.products[1].note, 'not an image', 'non-image strings must be left alone')
  assert.equal(back.products[0].isPage, true, 'non-string fields must survive')
  assert.equal(back.title, 'LED Strip')
  console.log('  ok  round-trips as URLs at every depth; non-image values untouched')

  // Re-publishing identical images uploads nothing: the list call finds them
  // already there. This is what keeps a public-site bot edit cheap.
  const before = seen.uploads.length
  const again = await post('/api/publish/led-strip', { products, chrome, title: 'LED Strip' })
  assert.equal(again.status, 200)
  assert.equal(seen.uploads.length, before, 're-publish re-uploaded bytes that were already stored')
  console.log('  ok  re-publish uploads nothing')

  // A new image in an existing catalogue uploads only itself.
  const extra = [...products, { id: 'p3', name: 'LED-200', photo: uri('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==') }]
  await post('/api/publish/led-strip', { products: extra, chrome, title: 'LED Strip' })
  assert.equal(seen.uploads.length, before + 1, 'adding one product should upload exactly one new image')
  console.log('  ok  adding a product uploads only the new image')

  // Listing omits the payload and is newest-first.
  await post('/api/publish/pvc-marble', { products: [{ id: 'x', name: 'PV06', photo: uri(PNG) }], chrome: null, title: 'PVC Marble' })
  const list = await (await get('/api/published')).json()
  assert.equal(list.length, 2)
  assert.equal(list[0].categoryId, 'pvc-marble', 'the list should be newest-first')
  assert.equal(list[0].products, undefined, 'the list must omit products')
  assert.equal(list[1].title, 'LED Strip')
  console.log('  ok  /api/published lists newest-first, without payloads')

  // publish-all drives the same path.
  const all = await post('/api/publish-all', {
    catalogues: [
      { categoryId: 'acoustic', title: 'Acoustic', products: [{ id: 'a', photo: uri(PNG) }], chrome: null },
      { categoryId: 'empty-one', title: 'Empty', products: [], chrome: null },
    ],
  })
  const allBody = await all.json()
  assert.equal(all.status, 200)
  assert.deepEqual(allBody.published.map(p => p.categoryId), ['acoustic'])
  assert.deepEqual(allBody.skipped, [{ categoryId: 'empty-one', reason: 'empty' }])
  assert.ok(rows.has('acoustic') && !rows.has('empty-one'))
  console.log('  ok  publish-all stores non-empty catalogues and skips empty ones')

  // Validation still happens before anything reaches storage.
  assert.equal((await post('/api/publish/led-strip', { products: [] })).status, 400)
  assert.equal((await post('/api/publish/led-strip', {})).status, 400)
  assert.equal((await get(`/api/published/${encodeURIComponent('../evil')}`)).status, 400)
  assert.equal((await del(`/api/publish/${encodeURIComponent('../evil')}`)).status, 400)
  console.log('  ok  empty publishes and malformed ids rejected before storage')

  // Unpublish removes the row and the images; a second attempt is a 404.
  assert.equal((await del('/api/publish/led-strip')).status, 200)
  assert.equal((await get('/api/published/led-strip')).status, 404)
  assert.equal((await del('/api/publish/led-strip')).status, 404)
  assert.equal([...objects.keys()].filter(key => key.startsWith('led-strip/')).length, 0, 'unpublish left images behind')
  assert.ok(objects.has(`pvc-marble/${sha(PNG)}.png`), 'unpublishing one catalogue must not touch another\'s images')
  console.log('  ok  unpublish removes the row and only its own images')

  // A Supabase outage must answer the request, not hang it, and must not leak
  // the service-role key into the response.
  bucketExists = true
  const broken = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.startsWith(`${PROJECT}/rest/v1/`)) return new Response('permission denied for table published_catalogues', { status: 403 })
    return broken(input, init)
  }
  const failed = await post('/api/publish/led-strip', { products, chrome, title: 'LED Strip' })
  assert.equal(failed.status, 502, 'a storage failure should surface as 502, not hang or claim success')
  const message = await failed.text()
  assert.ok(message.includes('permission denied'), 'the real cause should reach the admin')
  assert.ok(!message.includes('test-service-role-key'), 'the service-role key must never reach a response body')
  globalThis.fetch = broken
  console.log('  ok  storage failure answers 502 with the cause and no credentials')

  assert.deepEqual(readdirSync(directory), [], 'with Supabase configured, nothing should be written to the local disk')
  console.log('  ok  the on-disk fallback was never touched')

  console.log('\nPASS publish/supabase: images split out, URLs stored, dedup across re-publish, unpublish scoped, failures surfaced.')
} finally {
  server.close()
  globalThis.fetch = realFetch
  rmSync(directory, { recursive: true, force: true })
}
