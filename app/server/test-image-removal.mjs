import assert from 'node:assert/strict'
import { parseCommand } from '../src/lib/commands.js'
import { applyImageRemoval, recentImageContext } from '../src/lib/image-removal.js'
import { removeDisplayImage } from '../src/lib/display-image.js'
import { resolveInterpretedIntent } from '../src/lib/bot-interpreter.js'
const category = { isDefault: true }
const products = [{ id: 'wb', name: 'WB08', photo: 'main', drawing: 'drawing', supportStrip: 'source-strip', examples: [
  { image: 'source-installation', role: 'usage' }, { image: 'selected-display', origin: 'manual-display', displayId: 'd1', addedAt: 100 },
] }]
for (const text of ['nak buang gambar nya', 'buang gambarnya', 'remove that image', 'padam gambar tu']) {
  const proposal = parseCommand(text, products, category).propose
  assert.equal(proposal.action.type, 'removeDisplayImage', text)
  assert.equal(proposal.preview, 'selected-display')
  const removed = removeDisplayImage(products, proposal.action)
  assert.deepEqual(removed[0].examples, [products[0].examples[0]])
  assert.equal(removed[0].photo, 'main'); assert.equal(removed[0].drawing, 'drawing'); assert.equal(removed[0].supportStrip, 'source-strip')
}
const pages = [...products, { id: 'original-page', name: 'Original PDF', isPage: true, image: 'original-source' },
  { id: 'manual-page', name: 'Display page', isPage: true, origin: 'manual-image-page', image: 'whole-image', createdAt: 200 }]
assert.equal(recentImageContext(pages).kind, 'image-page')
const pageRemoval = parseCommand('buang gambar tu', pages, category).propose
assert.equal(pageRemoval.action.type, 'removeImagePage')
assert.equal(pageRemoval.preview, 'whole-image')
assert.deepEqual(applyImageRemoval(pages, pageRemoval.action), pages.slice(0, -1))
assert.deepEqual(applyImageRemoval(pages, { ...pageRemoval.action, pageId: 'original-page', value: 'original-source' }), pages)
const cleared = parseCommand('buang gambar utama WB08', products, category).propose
assert.equal(cleared.action.type, 'clearProductPhoto')
const withoutMain = applyImageRemoval(products, cleared.action)
assert.equal(withoutMain.length, 1); assert.equal(withoutMain[0].photo, null)
assert.equal(withoutMain[0].drawing, 'drawing'); assert.equal(withoutMain[0].examples.length, 2)
assert.deepEqual(applyImageRemoval(products, { ...cleared.action, value: 'stale' }), products)
assert.equal(parseCommand('padam WB08', products, category).propose.action.type, 'delete', 'Explicit product deletion retains its separate meaning')
assert.equal(resolveInterpretedIntent({ intent: { operation: 'remove', source: { pageId: 'manual-page' } } }, { items: pages, category }).propose.action.type, 'removeImagePage')
console.log('Natural image-removal context: selected display/page/main photo, exact preview, preserved products/drawings/source strips and PDF pages, stale identity safety and separate product deletion. No paid API or PDF export.')
