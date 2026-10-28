import assert from 'node:assert/strict'
import { parseCommand } from '../src/lib/commands.js'
import { addDisplayImage, moveDisplayImage } from '../src/lib/display-image.js'
import { planDisplayIntent, displayInventory } from '../src/lib/display-planner.js'
import { DISPLAY_INTENT_GUIDANCE, displayIntentContext } from './display-intent.mjs'

const category = { isDefault: true }
const products = ['WB01', 'WB02', 'WB05', 'WB06', 'WB07 (Bare Finish)', 'WB08 (Bare Finish)'].map((name, i) => ({
  id: `p${i}`, name, photo: `product-${i}`, layoutRowGroup: 'original-WB',
  ...(i === 3 ? { supportStrip: 'original-strip', examples: [{ image: 'source-installation', role: 'usage' }] } : {}),
}))
const parse = (text, items = products, attachment = 'new-scene', context = null) => parseCommand(text, items, category, [], [], attachment, attachment, context)
for (const text of [
  'letak kan gamba display, bersebelahan wb08 tetapi sebelum daripada display image',
  'Letakkan display di sisi WB08 sebelum gambar lain',
  'place this display next to WB08 before existing displays',
]) {
  const proposal = parse(text).propose
  assert.equal(proposal.action.type, 'addDisplayImage')
  assert.deepEqual(proposal.action.ids, ['p5'])
  assert.deepEqual(proposal.action.placement, { mode: 'beside-product', order: 'before', anchorProductId: 'p5' })
  assert.match(proposal.detail, /sebelum display/)
}
const added = addDisplayImage(products, { ...parse('letak display sebelah WB07').propose.action, displayId: 'new', addedAt: 200 })
const original = structuredClone(added)
for (const text of [
  'pindahkan gambar display dari WB07 ke WB08, sebelum display lain',
  'move display from WB07 to WB08 before other displays',
  'alihkan display WB07 ke WB08 selepas display lain',
]) {
  const proposal = parse(text, added, null).propose
  assert.equal(proposal.action.type, 'moveDisplayImage', text)
  assert.deepEqual(proposal.action.sourceIds, ['p4'])
  assert.deepEqual(proposal.action.ids, ['p5'])
  const moved = moveDisplayImage(added, proposal.action)
  assert.equal(moved[4].examples.length, 0)
  assert.equal(moved[5].examples[0].image, 'new-scene')
  assert.equal(moved[5].examples[0].displayId, 'new')
  assert.equal(moved[5].examples[0].addedAt, 200)
  assert.equal(moved[5].examples[0].ownerProductId, 'p5')
  assert.deepEqual(moved[3], original[3])
  assert.deepEqual(added, original, 'Planning/moving cannot mutate input data')
}
const contextual = parse('letak dia sebelah WB08 sebelum display lain', added, null, { displayId: 'new', value: 'new-scene' }).propose
assert.equal(contextual.action.type, 'moveDisplayImage')
assert.equal(contextual.action.displayId, 'new')
for (const wording of ['tambah kat sebelah wb08', 'kat sebelah wb08', 'put next to WB08', 'sebelah WB08']) {
  const followup = parse(wording, added, null, { displayId: 'new', value: 'new-scene' }).propose
  assert.equal(followup.action.type, 'moveDisplayImage', wording)
  assert.equal(followup.action.displayId, 'new')
  assert.equal(followup.action.ownerId, 'p5')
  assert.equal(followup.action.placement.mode, 'beside-product')
  const restored = parse(wording, added, null).propose
  assert.equal(restored.action.type, 'moveDisplayImage', 'Recent saved display context is restored without chat history')
}
assert.equal(parseCommand('tambah product WB09', added, category, [], [], null, null, { displayId: 'new' }).run.type, 'addProduct')
assert.equal(parseCommand('move WB08 (Bare Finish) up', added, category, [], [], null, null, { displayId: 'new' }).propose.action.type, 'move', 'Product movement remains separate from display movement')
const toSeries = parse('pindahkan display dari WB07 ke WB series sebelum display lain', added, null).propose
assert.equal(toSeries.action.displayScope, 'series')
assert.equal(toSeries.action.ownerId, 'p3')
const sharedRecords = moveDisplayImage(added, toSeries.action)
const fromSeries = parse('pindahkan display terakhir dari WB series ke WB08 bersebelahan produk', sharedRecords, null).propose
assert.equal(fromSeries.action.ownerId, 'p5')
assert.deepEqual(fromSeries.action.sourceIds, ['p3'])
assert.ok(parse('pindahkan display WB99 ke WB08', added, null).reply)
assert.ok(parse('jangan buang display', added, null).reply)
assert.equal(moveDisplayImage(added, { ...contextual.action, ownerId: 'missing' }), added, 'Stale destination cannot lose a source image')
const structured = { operation: 'move', source: { product: 'WB07 (Bare Finish)' }, target: { type: 'series', value: 'WB' }, placement: { mode: 'default', order: 'before' } }
const modelPlan = planDisplayIntent(structured, { items: added, category })
assert.equal(modelPlan.propose.action.displayScope, 'series')
assert.equal(modelPlan.propose.action.ownerId, 'p3')
assert.ok(planDisplayIntent({ ...structured, operation: 'deleteAll' }, { items: added, category }).reply)
assert.ok(planDisplayIntent({ ...structured, target: { type: 'product', value: 'invented' } }, { items: added, category }).reply)
assert.ok(planDisplayIntent({ ...structured, placement: { mode: 'rotate' } }, { items: added, category }).reply)
const summary = displayIntentContext(displayInventory(added), { displayId: 'new', ids: ['p4'], value: 'private-image' })
assert.ok(!summary.includes('private-image'))
assert.ok(!summary.includes('new-scene'))
assert.match(DISPLAY_INTENT_GUIDANCE, /before\/after\/beside/)
console.log('Structured display plans: literal screenshot/paraphrases, add/move/remove context, stable image identity, exact source/target validation, preserved source strip, safe AI plan contract and no image bytes in interpretation context. No API calls.')
