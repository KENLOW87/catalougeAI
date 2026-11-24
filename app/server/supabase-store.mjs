// Durable storage for published catalogues, on Supabase.
//
// Why this exists: Render's free plan gives the container no persistent disk, so
// the file-backed store in publish.mjs loses every snapshot on redeploy AND on
// the 15-minute idle spin-down. Published catalogues kept vanishing from the
// live site. Supabase holds them off the container entirely, so they survive.
//
// A snapshot is almost entirely image bytes — one real catalogue was 42 MB of
// inline base64 — so it is split in two:
//
//   - Storage bucket `catalogue-images`: every image in the snapshot as its own
//     object, named by the SHA-256 of its bytes. Content-addressed, so
//     re-publishing an unchanged catalogue re-uploads nothing, and the public
//     site gets cacheable image files instead of one enormous JSON payload.
//   - Table `published_catalogues`: the same snapshot with every `data:` URI
//     swapped for that object's public URL. 42 MB of base64 becomes a few KB.
//
// The swap is transparent to the front end: every image is rendered through
// `<img src={...}>`, which takes a URL exactly as happily as a data URI.
//
// Configured by SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. With either absent
// (local dev, the server tests) `isConfigured()` is false and publish.mjs keeps
// using files, so nothing here is required to run the app locally.
import { createHash } from 'node:crypto'

const BUCKET = 'catalogue-images'
const TABLE = 'published_catalogues'

// Base64 image payloads only. Anything else in the snapshot — an http(s) URL
// from a previous publish, ordinary text — is left exactly as it is.
const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

const url = () => (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export const isConfigured = () => Boolean(url() && key())

// The service-role key must never reach a response body or a log line, so
// failures are reported by status and endpoint only, never by echoing the
// request. Supabase's own error text is safe (it does not quote credentials)
// and is worth keeping — it names the actual constraint or policy at fault.
async function call(path, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(`${url()}${path}`, {
    method,
    headers: { apikey: key(), authorization: `Bearer ${key()}`, ...headers },
    body,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Supabase ${method} ${path.split('?')[0]} failed (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`)
  }
  return res
}

const publicUrl = path => `${url()}/storage/v1/object/public/${BUCKET}/${path}`

// Created on demand rather than assumed, so a fresh deployment works without a
// manual dashboard step. Public-read: the catalogue site has no login, and the
// snapshot that names these files is itself public.
let bucketReady = null
function ensureBucket() {
  bucketReady ??= (async () => {
    const res = await fetch(`${url()}/storage/v1/bucket/${BUCKET}`, {
      headers: { apikey: key(), authorization: `Bearer ${key()}` },
    })
    if (res.ok) return
    // Storage reports a missing bucket as HTTP 400 with `"statusCode":"404"`
    // and `"code":"NoSuchBucket"` in the body — not as a bare 404 — so the
    // status alone cannot tell "does not exist yet" from "something is wrong".
    const detail = await res.text().catch(() => '')
    const missing = res.status === 404 || /NoSuchBucket|"statusCode"\s*:\s*"?404/.test(detail)
    if (!missing) {
      throw new Error(`Supabase could not check the image bucket (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`)
    }
    await call('/storage/v1/bucket', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
    })
  })().catch(error => { bucketReady = null; throw error })
  return bucketReady
}

// Every object already under this category's prefix. Used to skip re-uploading
// bytes that are already there, which is what makes re-publishing cheap: an
// edit to one product's name uploads nothing at all.
async function existingObjects(categoryId) {
  const names = new Set()
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const res = await call(`/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: `${categoryId}/`, limit: pageSize, offset }),
    })
    const page = await res.json()
    if (!Array.isArray(page) || !page.length) return names
    for (const entry of page) if (entry?.name) names.add(entry.name)
    if (page.length < pageSize) return names
  }
}

async function upload(path, bytes, contentType) {
  await call(`/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable', 'x-upsert': 'true' },
    body: bytes,
  })
}

// Walk the whole snapshot rather than the handful of fields that hold images
// today (products[].image, products[].photo, products[].details[], chrome.image).
// The product shape differs per category and grows as readers are added; a
// generic walk cannot fall behind it and silently leave 40 MB of base64 in the
// row.
function collectImages(value, found) {
  if (typeof value === 'string') {
    const match = DATA_URI.exec(value)
    if (!match) return
    const [, mime, base64] = match
    const bytes = Buffer.from(base64, 'base64')
    if (!bytes.length) return
    const sha = createHash('sha256').update(bytes).digest('hex')
    if (!found.has(sha)) found.set(sha, { sha, bytes, mime, extension: EXTENSIONS[mime.toLowerCase()] ?? 'bin' })
    return
  }
  if (Array.isArray(value)) { for (const entry of value) collectImages(entry, found) ; return }
  if (value && typeof value === 'object') for (const entry of Object.values(value)) collectImages(entry, found)
}

function replaceImages(value, urlBySha) {
  if (typeof value === 'string') {
    const match = DATA_URI.exec(value)
    if (!match) return value
    const sha = createHash('sha256').update(Buffer.from(match[2], 'base64')).digest('hex')
    return urlBySha.get(sha) ?? value
  }
  if (Array.isArray(value)) return value.map(entry => replaceImages(entry, urlBySha))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceImages(v, urlBySha)]))
  }
  return value
}

// Bounded concurrency: a 25-product catalogue holds ~40 images, and neither one
// at a time (slow) nor all at once (Supabase rate limits, and 40 multi-megabyte
// bodies in flight) is right.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

export async function putSnapshot(snapshot) {
  await ensureBucket()
  const { categoryId } = snapshot

  const found = new Map()
  collectImages({ products: snapshot.products, chrome: snapshot.chrome }, found)
  const images = [...found.values()]

  const present = images.length ? await existingObjects(categoryId) : new Set()
  const urlBySha = new Map()
  let uploaded = 0
  await mapLimit(images, 6, async image => {
    const name = `${image.sha}.${image.extension}`
    const path = `${categoryId}/${name}`
    if (!present.has(name)) { await upload(path, image.bytes, image.mime); uploaded++ }
    urlBySha.set(image.sha, publicUrl(path))
  })

  const stored = {
    ...snapshot,
    products: replaceImages(snapshot.products, urlBySha),
    chrome: replaceImages(snapshot.chrome, urlBySha),
  }

  await call(`/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      category_id: categoryId,
      title: stored.title,
      snapshot: stored,
      published_at: stored.publishedAt,
    }),
  })

  return { imageCount: images.length, uploaded }
}

export async function listSnapshots() {
  const res = await call(`/rest/v1/${TABLE}?select=category_id,title,published_at&order=published_at.desc`)
  const rows = await res.json()
  if (!Array.isArray(rows)) return []
  return rows.map(row => ({ categoryId: row.category_id, title: row.title, publishedAt: row.published_at }))
}

export async function getSnapshot(categoryId) {
  const res = await call(`/rest/v1/${TABLE}?category_id=eq.${encodeURIComponent(categoryId)}&select=snapshot&limit=1`)
  const rows = await res.json()
  return Array.isArray(rows) && rows.length ? rows[0].snapshot : null
}

// Removes the row first: once it is gone the catalogue is unpublished whatever
// happens next, and a leftover image object is invisible to visitors. Doing it
// the other way round could leave a published row pointing at deleted images.
export async function deleteSnapshot(categoryId) {
  const res = await call(`/rest/v1/${TABLE}?category_id=eq.${encodeURIComponent(categoryId)}`, {
    method: 'DELETE',
    headers: { prefer: 'return=representation' },
  })
  const removed = await res.json().catch(() => [])
  if (!Array.isArray(removed) || !removed.length) return false

  // Image names are SHA-prefixed by category, never shared between categories,
  // so the whole prefix can go. A failure here leaves orphaned bytes, which is
  // not worth failing the unpublish over.
  try {
    const names = await existingObjects(categoryId)
    if (names.size) {
      await call(`/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: [...names].map(name => `${categoryId}/${name}`) }),
      })
    }
  } catch { /* orphaned images are harmless; the catalogue is already unpublished */ }
  return true
}
