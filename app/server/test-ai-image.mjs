import assert from 'node:assert/strict'
import { editProductImage } from './ai-image.mjs'
const image = 'data:image/png;base64,aGVsbG8='
await assert.rejects(editProductImage(image, 'remove hand', { key: '' }), /OPENAI_API_KEY/)
await assert.rejects(editProductImage('https://example.com/private', 'edit', { key: 'test' }), /PNG/)
await assert.rejects(editProductImage(image, '', { key: 'test' }), /Arahan/)
let calls = 0
const edited = await editProductImage(image, 'buang tangan', { key: 'test', productOnly: true, request: async (url, options) => {
  calls++
  assert.equal(url, 'https://api.openai.com/v1/images/edits')
  assert.equal(options.headers.Authorization, 'Bearer test')
  assert.equal(options.body.get('image').type, 'image/png')
  assert.match(options.body.get('prompt'), /buang tangan/)
  assert.match(options.body.get('prompt'), /Do not rotate, straighten, tilt, mirror, flip, change viewpoint/)
  assert.match(options.body.get('prompt'), /background-removal or hand-removal request does not authorize/)
  assert.match(options.body.get('prompt'), /if it is angled, preserve that exact angle/)
  assert.match(options.body.get('prompt'), /Preserve the source framing and product scale/)
  assert.equal(options.body.get('background'), 'transparent')
  return { ok: true, json: async () => ({ data: [{ b64_json: 'ZWRpdGVk' }] }) }
} })
assert.equal(calls, 1)
assert.equal(edited, 'data:image/png;base64,ZWRpdGVk')
await editProductImage(image, 'rotate 90 degrees clockwise', { key: 'test', request: async (_url, options) => {
  // Attachment edits use this path too; explicit user transformations remain available.
  assert.match(options.body.get('prompt'), /unless the user instruction explicitly requests that specific transformation/)
  assert.match(options.body.get('prompt'), /Instruction: rotate 90 degrees clockwise$/)
  assert.equal(options.body.get('background'), null)
  return { ok: true, json: async () => ({ data: [{ b64_json: 'ZWRpdGVk' }] }) }
} })
await assert.rejects(editProductImage(image, 'edit', { key: 'test', request: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'access denied' } }) }) }), /403/)
console.log('Image edit validation, request, preview data and API error checks passed (mock API; no charges).')
