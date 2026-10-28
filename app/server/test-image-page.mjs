import assert from 'node:assert/strict'
import { parseCommand } from '../src/lib/commands.js'
import { addImagePage } from '../src/lib/image-page.js'
const category = { isDefault: true }
const items = ['WB01', 'WB02', 'WB05', 'WB06', 'WB07', 'WB08'].map((name, i) => ({ id: `p${i}`, name, photo: `p-photo-${i}`, layoutRowGroup: 'source-wb',
  ...(i === 3 ? { supportStrip: 'original-strip', examples: [{ image: 'original-installation', role: 'usage' },
    { image: 'whole-original-poster', origin: 'manual-display', displayId: 'recent-display', addedAt: 200, displaySeries: 'WB', sharedWithProductIds: ['p0', 'p1', 'p2', 'p3'] }] } : {}) }))
items.push({ id: 'cw', name: 'CW02', photo: 'corner', drawing: 'complete-drawing' })
const snapshot = structuredClone(items)
for (const text of ['this whole image jadi newpage dalam catalogue ni', 'jadikan gambar ini satu halaman baharu', 'make this whole image a new page', 'buat gambar ni jadi muka surat baru']) {
  const proposal = parseCommand(text, items, category).propose
  assert.equal(proposal.action.type, 'addImagePage', text)
  assert.equal(proposal.preview, 'whole-original-poster')
  assert.equal(proposal.action.afterId, 'p5', 'Insert after the complete source group including later added WB07/WB08')
  assert.match(proposal.detail, /bertambah satu/)
  const saved = addImagePage(items, proposal.action)
  assert.equal(saved.length, items.length + 1)
  assert.equal(saved[6].isPage, true)
  assert.equal(saved[6].image, 'whole-original-poster')
  assert.equal(saved[3].examples.length, 1)
  assert.equal(saved[3].examples[0].image, 'original-installation')
  assert.equal(saved[3].supportStrip, 'original-strip')
  assert.deepEqual(saved[7], items[6])
  assert.deepEqual(addImagePage(saved, proposal.action), saved, 'Repeated Apply cannot duplicate a page')
  assert.deepEqual(addImagePage(items, { ...proposal.action, afterId: 'deleted-anchor' }), items)
  assert.deepEqual(addImagePage(items, { ...proposal.action, displayId: 'stale-display' }), items)
}
assert.deepEqual(items, snapshot, 'Preview and Apply never mutate input records')
const uploaded = parseCommand('jadikan gambar ini satu halaman baru', items, category, [], [], 'new-original-upload').propose
assert.equal(uploaded.preview, 'new-original-upload')
assert.equal(uploaded.action.fromDisplay, false)
assert.equal(addImagePage(items, uploaded.action).at(-1).image, 'new-original-upload')
assert.equal(addImagePage(items, uploaded.action)[3].examples.length, 2, 'A different attached upload cannot delete a saved display')
assert.ok(parseCommand('jadikan gambar ini satu halaman baru', [], category).reply)
console.log('Full-image page commands: saved display conversion or untouched original upload, correct group anchor, source preservation, explicit one additional page, idempotent Apply and stale-source/anchor safety. No AI calls or exports.')
