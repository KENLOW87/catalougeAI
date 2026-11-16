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

console.log('Accessories March structure: 37 products, page 6 kept as two products, saved-catalogue repair OK')
