import assert from 'node:assert/strict'
import { requestedImagePage, proposeImagePage, addImagePage } from '../src/lib/image-page.js'
import { resolveInterpretedIntent } from '../src/lib/bot-interpreter.js'
for (const [text, expected] of [
  ['jadikan gambar ni page baru di page 7', 7], ['letak gambar di halaman ke-7', 7],
  ['selepas page 6', 7], ['lepas halaman 6', 7], ['sebelum page 7', 7],
  ['antara page 6 dan page 7', 7], ['between pages 6 and 7', 7],
  ['letak page 7, bukan page 15', 7], ['bukan page 15, letak page 7', 7],
]) {
  const actual = requestedImagePage(text)
  if (expected !== undefined) assert.equal(actual.position, expected, text)
}
const imagePage = { id: 'manual', name: 'Display image', isPage: true, image: 'original-poster', origin: 'manual-image-page', createdAt: 100 }
const items = [{ id: 'p', name: 'WB08', photo: 'main' }, imagePage]
const context = { kind: 'image-page', pageId: 'manual', ids: ['manual'] }
const category = { isDefault: true, paginate: () => Array.from({ length: 15 }, (_, i) => i === 14 ? { plate: imagePage } : { rows: [[items[0]]] }) }
const proposed = proposeImagePage('letakkan gambar ni page 7', items, category, null, context).propose
assert.equal(proposed.action.type, 'positionImagePage')
assert.equal(proposed.action.pagePosition, 7)
assert.equal(proposed.action.previousPagePosition, 15)
assert.match(proposed.detail, /Jumlah halaman kekal/)
const moved = addImagePage(items, proposed.action)
assert.equal(moved.length, 2)
assert.equal(moved[1].pagePosition, 7)
assert.equal(moved[1].image, imagePage.image)
assert.equal(items[1].pagePosition, undefined)
assert.deepEqual(addImagePage(moved, proposed.action), moved)
assert.ok(proposeImagePage('letak gambar page 17', items, category, null, context).reply)
const fresh = proposeImagePage('jadikan gambar ni page baru pada halaman 7', items, category, 'new-poster', null).propose
assert.equal(fresh.action.type, 'addImagePage')
assert.equal(fresh.action.pagePosition, 7)
assert.equal(proposeImagePage('make this image a new page after page six', items, category, 'new-poster', null).needsInterpret, true, 'Unparsed placement must reach AI instead of silently appending')
const interpreted = resolveInterpretedIntent({ intent: { operation: 'page', source: { pageId: 'manual' }, pagePosition: 7 } }, { items, category, context })
assert.equal(interpreted.propose.action.type, 'positionImagePage')
assert.equal(interpreted.propose.action.pagePosition, 7)
const keptText = resolveInterpretedIntent({ intent: { operation: 'page', source: { pageId: 'manual' } } }, { items, category, context, text: 'letak gambar ni pada page 7' })
assert.equal(keptText.propose.action.pagePosition, 7, 'Explicit requested position survives even when model omits the field')
const conflict = resolveInterpretedIntent({ intent: { operation: 'page', source: { pageId: 'manual' }, pagePosition: 15 } }, { items, category, context, text: 'letak gambar ni pada page 7' })
assert.equal(conflict.propose.action.pagePosition, 7, 'A model cannot override an explicit page number from the user')
console.log('Exact full-image page numbers, before/after/between, excluded wrong positions, range validation, existing-page move without duplication and structured AI/source identity passed.')
