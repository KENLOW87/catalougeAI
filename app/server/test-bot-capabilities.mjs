import assert from 'node:assert/strict'
import { resolveCatalogueIntent } from '../src/lib/bot-interpreter.js'
import { needsSemanticReview, BOT_CAPABILITIES } from '../src/lib/bot-capabilities.js'
import { parseCommand } from '../src/lib/commands.js'
import { applyImageRemoval } from '../src/lib/image-removal.js'
const items = [{ id: 'p', name: 'WB08 (Bare Finish)', photo: 'original', drawing: 'drawing' }, { id: 'other', name: 'WB07', photo: 'other' }]
const category = { isDefault: true, fields: () => [{ type: 'image', key: 'photo', label: 'Product photo' }] }
const ctx = { items, category, attachment: 'uploaded-original', text: 'panggil WB08 sebagai WB08 DEMO' }
const plan = intent => resolveCatalogueIntent({ intent }, ctx)
assert.equal(plan({ domain: 'product', operation: 'rename', target: 'WB08', name: 'WB08 DEMO' }).propose.action.type, 'rename')
assert.equal(plan({ domain: 'product', operation: 'rename', target: 'WB08', name: 'invented' }).propose, undefined)
const hostileName = resolveCatalogueIntent({ intent: { domain: 'product', operation: 'rename', target: 'WB08', name: 'remove WB07' } }, { ...ctx, text: 'rename WB08 to remove WB07' })
assert.equal(hostileName.propose.action.type, 'rename', 'Names are data, never re-parsed as deletion commands')
assert.deepEqual(hostileName.propose.action.ids, ['p'])
assert.equal(plan({ domain: 'photo', operation: 'replace', target: 'WB08' }).propose.preview, 'uploaded-original')
assert.equal(plan({ domain: 'photo', operation: 'remove', target: 'WB08' }).propose.action.type, 'clearProductPhoto')
assert.equal(plan({ domain: 'photo', operation: 'adjust', target: 'WB08', adjustment: 'rotate', angle: 180 }).propose.action.angle, 180)
assert.ok(plan({ domain: 'photo', operation: 'adjust', target: 'WB08', adjustment: 'rotate', angle: 45 }).reply)
assert.equal(plan({ domain: 'photo', operation: 'background', target: 'WB08' }).propose.action.type, 'removeBackground')
assert.equal(plan({ domain: 'product', operation: 'show', target: 'WB08' }).run.type, 'reveal')
assert.equal(plan({ domain: 'catalogue', operation: 'check' }).run.type, 'qc')
assert.ok(plan({ domain: 'imagePage', operation: 'destroyEverything' }).reply)
assert.ok(plan({ domain: 'imagePage', operation: 'remove' }).reply, 'Removing an image page cannot fall back to deleting a display')
assert.ok(plan({ domain: 'product', operation: 'rename', target: 'unknown', name: 'WB08 DEMO' }).reply)
assert.ok(plan({ domain: 'display', operation: 'add', unfulfilledConstraints: ['a requested position is unsupported'] }).reply)
assert.ok(plan({ domain: 'catalogue', operation: 'export' }).reply, 'Export cannot be triggered without explicit request')
const text = 'Tambah gambar display ini untuk WB08 tapi WB07 jangan usik'
const local = parseCommand(text, items, category, [], [], 'uploaded-original')
assert.deepEqual(local.propose.action.ids, ['p', 'other'], 'Fixture demonstrates the unsafe partial keyword match')
assert.equal(needsSemanticReview(text, local), true, 'A compound exclusion must reach semantic interpretation before Apply')
assert.equal(needsSemanticReview('tambah WB09', { run: { type: 'addProduct' } }), false)
assert.equal(needsSemanticReview('tambah display WB08 dan padam WB07', local), true)
assert.equal(needsSemanticReview('boleh panggil produk WB08 tu sebagai WB08 DEMO selepas ni', { propose: { action: { type: 'moveDisplayImage' } } }), true, 'A conversational phrase must not be hijacked by a partial keyword match')
const variantProduct = [{ id: 'v', name: 'PV08', variants: [{ id: 'red', name: 'Red', photo: 'red-photo' }, { id: 'blue', name: 'Blue', photo: 'blue-photo' }] }]
const variantCategory = { fields: () => [{ type: 'list', key: 'variants', label: 'Variants', requireOne: 'photo' }] }
const variantPlan = resolveCatalogueIntent({ intent: { domain: 'photo', operation: 'remove', target: 'PV08', finish: 'Red' } }, { items: variantProduct, category: variantCategory })
const cleared = applyImageRemoval(variantProduct, variantPlan.propose.action)
assert.equal(cleared[0].variants[0].photo, null); assert.equal(cleared[0].variants[1].photo, 'blue-photo')
assert.equal(variantProduct[0].variants[0].photo, 'red-photo')
assert.ok(BOT_CAPABILITIES.every(capability => capability.operations.length > 0))
console.log('Capability vocabulary: product/finish lookup, typed rename/remove/show, original photo replacement/removal/background/adjustment, catalogue actions, unknown operations, unfulfilled constraints, exclusions and multiple clauses validated. No AI/image/export calls.')
