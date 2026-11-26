import assert from 'node:assert/strict'
import { adoptRuleProduct } from './ingest.mjs'
import { BUILTIN_SPECS } from './readers/specs.mjs'
import { repairLegacyAccessoriesProducts } from '../src/lib/repair-known-source.js'

const specs = BUILTIN_SPECS.filter(spec => /^accessories-march-/.test(spec.id))
assert.equal(specs.length, 11)

const page8 = specs.find(spec => spec.id === 'accessories-march-8')
assert.equal(page8.expectedAnchorCount, 4, 'page 8 must contain four Flat Bar source rows')
const page8PhotoBoxes = page8.kinds[0].fields.find(field => field.key === 'photo').boxByAnchor
assert.deepEqual(page8PhotoBoxes.map(box => [box.x, box.y, box.w]), [
  [87, 0, 123], [87, 0, 123], [87, 0, 123], [87, 0, 123],
], 'page 8 photos stay in the right-hand source column')
const page8DrawingBoxes = page8.kinds[0].fields.find(field => field.key === 'drawing').boxByAnchor
assert.deepEqual(page8DrawingBoxes.map(box => [box.x, box.y, box.w]), [
  [40, 0, 25], [40, 0, 29], [40, 0, 36], [40, 0, 42],
], 'page 8 measurements stay in the left source column')

let profileProducts = 0
for (const spec of specs) {
  assert.equal(spec.productShape, 'generic')
  const kind = spec.kinds[0]
  const names = kind.fields.find(field => field.key === 'name').valueByAnchor
  const groups = kind.variantGroupByAnchor ?? []
  const logical = new Set(names.map((_, index) => groups[index] || `row-${index}`))
  profileProducts += logical.size
  assert.ok(!names.includes('Aluminum End Bend Features'))
}
assert.equal(profileProducts, 30)
assert.equal(profileProducts + 7, 37, 'seven LED products plus 30 profile products')

const generic = adoptRuleProduct({
  name: 'Profile', subtitle: 'Size : 9\'5"', third: 'Carbon Crystal',
  photo: 'photo', drawing: 'drawing',
}, 1, 2, { category: 'accessories', productShape: 'generic', kinds: [{ fields: [{ type: 'lineart' }] }] })
assert.equal(generic.productShape, 'generic')
assert.equal(generic.subtitle, 'Size : 9\'5"')
assert.equal(generic.third, 'Carbon Crystal')
assert.equal(generic.type, undefined, 'profile data must not be coerced into an LED product')

const row = (id, sourcePage, name, mm) => ({
  id, categoryId: 'accessories', sourcePage, name,
  third: `Thickness : ${mm} / Carbon Crystal`, photo: `photo-${id}`, drawing: `drawing-${id}`,
})
const saved = [
  row('i5', 4, 'I Profile', '5mm'), row('i8', 4, 'I Profile', '8mm'),
  row('e5', 4, 'END Profile', '5mm'), row('e8', 4, 'END Profile', '8mm'),
  row('c5', 5, 'CORNER Profile', '5mm'), row('c8', 5, 'CORNER Profile', '8mm'),
  row('a5', 6, 'Aluminum End Bend', '5mm'), row('a8', 6, 'Aluminum End Bend', '8mm'),
  { id: 'features', categoryId: 'accessories', sourcePage: 6, name: 'Aluminum End Bend Features', photo: 'feature-photo', drawing: 'feature-text' },
]
const repaired = repairLegacyAccessoriesProducts('accessories', saved)
assert.equal(repaired.length, 5)
assert.deepEqual(repaired.map(product => product.name), ['I Profile', 'END Profile', 'CORNER Profile', 'Aluminum End Bend', 'Aluminum End Bend'])
for (const product of repaired.slice(0, 3)) {
  assert.equal(product.productShape, 'generic')
  assert.equal(product.variantTechnical, true)
  assert.deepEqual(product.finishes.map(variant => variant.name), ['5mm', '8mm'])
  assert.ok(product.finishes.every(variant => variant.photo && variant.drawing))
}
assert.match(repaired[0].finishes[0].photo, /page4-i-profile-5mm-photo/)
assert.match(repaired[0].finishes[0].drawing, /page4-i-profile-5mm-drawing/)
assert.match(repaired[0].finishes[1].photo, /page4-i-profile-8mm-photo/)
assert.match(repaired[1].finishes[0].drawing, /page4-end-profile-5mm-drawing/)
assert.match(repaired[2].finishes[0].drawing, /corner-5mm-drawing/)
assert.match(repaired[2].finishes[1].drawing, /corner-8mm-drawing/)
const bends = repaired.slice(-2)
assert.deepEqual(bends.map(product => product.third), [
  'Thickness : 5mm / Carbon Crystal',
  'Thickness : 8mm / Carbon Crystal',
])
assert.equal(bends[1].supportStrip, 'feature-photo')
assert.ok(bends[1].sourceReferences.some(reference => reference.image === 'feature-text'))

const repairedAgain = repairLegacyAccessoriesProducts('accessories', repaired)
assert.deepEqual(repairedAgain[0].finishes.map(variant => variant.name), ['5mm', '8mm'])
assert.equal(repairedAgain[0].third, 'Thickness : 5mm / 8mm / Carbon Crystal')

// A fresh March import may include the stray "Led -160 New" row. It must be
// removed before source-page numbering is trusted, otherwise page 3 repairs
// target the wrong records and the whole catalogue shifts.
const ledNames = ['Led -160', 'Led - 160 New', 'Led -170', 'Led -195', 'Led - 508', 'Led -15', 'Corner Led 601', 'Led - 08']
const ledRows = ledNames.map((name, index) => ({
  id: `led-${index}`, categoryId: 'accessories', sourcePage: 1, name,
  photo: `photo-${index}`, drawing: `drawing-${index}`,
  ...(name === 'Led - 08' ? { finishes: [{ name: 'Black', photo: 'black', drawing: 'led08' }] } : {}),
}))
const repairedLedRows = repairLegacyAccessoriesProducts('accessories', ledRows)
assert.deepEqual(repairedLedRows.map(product => product.name), ['Led -160', 'Led -170', 'Led -195', 'Led - 508', 'Led -15', 'Corner Led 601', 'Led - 08'])
assert.equal(repairedLedRows.length, 7)

const flatBarRows = [20, 25, 30, 80].map((width, index) => ({
  id: `flat-${width}`, categoryId: 'accessories', sourcePage: 8,
  name: 'Flat Bar', subtitle: `Size : ${width}mm x 3000mm`,
  photo: `old-photo-${index}`, drawing: `old-drawing-${index}`,
}))
const repairedFlatBars = repairLegacyAccessoriesProducts('accessories', flatBarRows)
assert.ok(repairedFlatBars.every(product => /page8-measurements-clean/.test(product.drawing)), 'page 8 must use the clean measurement assets')

console.log('Accessories March structure: 37 products, page 6 kept as two products, saved-catalogue repair OK')
