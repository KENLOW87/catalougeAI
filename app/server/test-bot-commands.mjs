import assert from 'node:assert/strict'
import { parseCommand } from '../src/lib/commands.js'
import { addDisplayImage, removeDisplayImage, withDisplaySeriesLayout, isDisplayRequest } from '../src/lib/display-image.js'

const items = [{ id: 'p1', name: 'PV07', photo: 'original' }]
const category = { id: 'test', fields: () => [{ type: 'image', key: 'photo', label: 'Photo' }] }
const parse = (text, attachment = null) => parseCommand(text, items, category, [], [], attachment)
assert.equal(parse('buang latar belakang PV07').propose.action.type, 'removeBackground')
assert.equal(parse('cerahkan gambar PV07').propose.action.operation, 'brighten')
assert.equal(parse('pusing gambar PV07 180').propose.action.angle, 180)
assert.match(parse('betulkan gambar PV07').reply, /laras/)
assert.equal(parse('gantikan PV07 dengan gambar ni', 'new').propose.action.value, 'new')
assert.equal(parse('tambah PV08 dalam catalogue', 'new').run.photo, 'new')
for (const text of ['yang aku masukkan tadi tu tak payah simpan, keluarkan semula', 'yang saya masukkan PV08 tadi bukan macam ni', 'I added product PV08 earlier, can you undo that?']) {
  assert.notEqual(parse(text)?.run?.type, 'addProduct', 'A past-action reference must not create a product')
}
assert.equal(parse('tolong tambah PV08 dalam catalogue', 'new').run.type, 'addProduct')
assert.equal(parse('remove background gambar ni', 'new').run.type, 'cleanAttachment')
assert.ok(parse('remove background PV99', 'new').reply)
assert.equal(parse('padam PV07').propose.action.type, 'delete')
console.log('9 bot command checks passed')
const displayItems = [
  { id: 'wb7', name: 'WB07 (Bare Finish)', photo: 'product-7', drawing: 'drawing-7' },
  { id: 'wb8', name: 'WB08', photo: 'product-8' },
  { id: 'wb70', name: 'WB070', photo: 'product-70' },
]
const displayCategory = { ...category, isDefault: true }
const displayParse = (text, attachment = 'original-scene', original = attachment) => parseCommand(text, displayItems, displayCategory, [], [], attachment, original)
const instruction = 'Tambah gambar display untuk WB07. Letak di sebelah produk, jangan buang background.'
const proposal = displayParse(instruction, 'cleaned', 'original-scene').propose
assert.equal(proposal.action.type, 'addDisplayImage')
assert.deepEqual(proposal.action.ids, ['wb7'])
assert.equal(proposal.preview, 'original-scene')
const saved = addDisplayImage(displayItems, proposal.action)
assert.equal(saved[0].photo, 'product-7')
assert.equal(saved[0].drawing, 'drawing-7')
assert.equal(saved[0].examples[0].image, 'original-scene')
assert.equal(saved[0].examples[0].photoTreatmentMode, 'preserve-scene')
assert.equal(saved[0].examples[0].ownerProductId, 'wb7')
assert.equal(displayItems[0].examples, undefined, 'Proposal and Apply cannot mutate input records')
assert.equal(addDisplayImage(saved, proposal.action)[0].examples.length, 1, 'Repeated Apply must not duplicate images')
assert.deepEqual(displayParse('Add this as a display image for WB07 and WB08').propose.action.ids, ['wb7', 'wb8'])
assert.ok(displayParse('Add display image for WB99').reply)
assert.ok(displayParse('Add display image for WB07 and WB99').reply)
assert.ok(displayParse('Tambah gambar display', null).reply)
assert.ok(displayParse('Tambah gambar display untuk WB07', null).reply)
assert.ok(parseCommand('Tambah gambar display untuk WB07', [...displayItems, { id: 'duplicate', name: 'WB07' }], displayCategory, [], [], 'scene').reply)
assert.equal(parse('remove background gambar ni', 'new').run.type, 'cleanAttachment', 'Explicit background removal remains available')
console.log('Display commands: original scene, exact owner, no accidental background removal/replacement/add-product, multi-product ownership, missing/ambiguous codes and duplicate Apply passed.')
const familyItems = ['WB01', 'WB02', 'WB05', 'WB06'].map((name, i) => ({ id: `family-${i}`, name, photo: `own-${i}`, layoutRowGroup: 'source-wb', ...(i === 3 ? { supportStrip: 'original-strip' } : {}) }))
familyItems.push({ id: 'other-family', name: 'CW02', photo: 'own-corner' })
const familyParse = text => parseCommand(text, familyItems, displayCategory, [], [], 'cleaned-preview', 'original-scene')
for (const text of ['product WB series', 'Letak display ini dekat WB series', 'Gambar ni untuk siri WB', 'add this display for WB', 'kumpulan WB']) {
  const command = familyParse(text)
  assert.equal(command.propose.action.displayScope, 'series', text)
  assert.deepEqual(command.propose.action.ids, familyItems.slice(0, 4).map(p => p.id), text)
  assert.equal(command.propose.preview, 'original-scene')
  assert.match(command.propose.detail, /WB01, WB02, WB05, WB06/)
}
const familyAction = familyParse('product WB series').propose.action
const familySaved = addDisplayImage(familyItems, familyAction)
assert.equal(familySaved.reduce((n, p) => n + (p.examples?.length ?? 0), 0), 1, 'One series display must be stored once, never copied to every card')
assert.equal(familySaved[3].examples[0].displaySeries, 'WB')
assert.equal(familySaved[3].examples[0].ownerProductId, 'family-3')
assert.equal(familySaved[3].supportStrip, 'original-strip')
assert.equal(familySaved[4].examples, undefined)
assert.ok(familyParse('product WB and CW series').reply)
assert.ok(familyParse('product ZZ series').reply)
assert.equal(isDisplayRequest('remove background WB series', true), false)
assert.equal(isDisplayRequest('delete WB series', true), false)
const ordinary = ['ZX01', 'ZX02', 'ZX03', 'ZX04'].map((name, i) => ({ id: `zx-${i}`, name, photo: `zx-photo-${i}` }))
const ordinaryCommand = parseCommand('product ZX series', ordinary, displayCategory, [], [], 'scene').propose.action
const ordinarySaved = addDisplayImage(ordinary, ordinaryCommand)
const presentation = withDisplaySeriesLayout(ordinarySaved)
assert.ok(presentation.every(p => p.layoutRowGroup === 'display-series:ZX'))
assert.ok(ordinarySaved.every(p => !p.layoutRowGroup), 'Presentation grouping must not alter stored source row metadata')
assert.ok(parseCommand('product WB series', [familyItems[0], { id: 'source-page', isPage: true }, familyItems[1]], displayCategory, [], [], 'scene').reply)
console.log('Series display: flexible Malay/English instructions, catalogue family resolution, one shared scene, original source strips, presentation-only grouping, ambiguous/unknown/barrier protection passed.')
const removeText = 'tolong buang gambar display yang baru je saya masukkan tadi .'
const removalItems = [{ id: 'old', name: 'WB01', photo: 'primary', drawing: 'drawing', supportStrip: 'source-strip', examples: [
  { image: 'imported', role: 'usage' },
  { image: 'older', origin: 'manual-display', addedAt: 100, displayId: 'old-display' },
] }, { id: 'new', name: 'WB02', photo: 'primary-2', examples: [
  { image: 'newest', origin: 'manual-display', addedAt: 200, displayId: 'latest-display' },
] }]
const removeCommand = (text, records = removalItems) => parseCommand(text, records, displayCategory)
assert.equal(isDisplayRequest(removeText, true), false)
for (const text of [removeText, 'remove the display image I just added', 'delete the latest display photo']) {
  const proposal = removeCommand(text).propose
  assert.equal(proposal.action.type, 'removeDisplayImage')
  assert.equal(proposal.preview, 'newest')
  assert.deepEqual(proposal.action.ids, ['new'])
}
const removal = removeCommand(removeText).propose.action
const removed = removeDisplayImage(removalItems, removal)
assert.equal(removalItems[1].examples.length, 1, 'Preview/removal must not mutate source input')
assert.equal(removed[1].examples.length, 0)
assert.equal(removed[0], removalItems[0], 'Other products, imported examples and source strip stay untouched')
const later = addDisplayImage(removalItems, { type: 'addDisplayImage', ids: ['new'], value: 'added-after-preview', displayId: 'later', addedAt: 300 })
assert.deepEqual(removeDisplayImage(later, removal)[1].examples.map(e => e.image), ['added-after-preview'], 'Apply removes the preview identity, never a newer image')
assert.deepEqual(removeDisplayImage(removed, removal), removed, 'Removal is idempotent')
assert.equal(removeCommand('buang display terakhir untuk WB01').propose.preview, 'older')
assert.ok(removeCommand('buang gambar display').reply)
assert.ok(removeCommand('buang display terbaru untuk ZZ series').reply)
assert.ok(removeCommand('buang display WB99').reply)
assert.ok(removeCommand(removeText, [{ id: 'source', name: 'WB01', examples: [{ image: 'source-photo', role: 'usage' }] }]).reply)
const legacy = [{ id: 'legacy', name: 'WB06', examples: [{ origin: 'manual-display', image: 'first' }, { origin: 'manual-display', image: 'last' }] }]
assert.equal(removeCommand(removeText, legacy).propose.preview, 'last')
assert.ok(removeCommand(removeText, [...legacy, { id: 'other', name: 'CW02', examples: [{ origin: 'manual-display', image: 'uncertain' }] }]).reply)
assert.equal(familySaved[3].examples[0].displayId.length > 0, true)
assert.equal(Number.isFinite(familySaved[3].examples[0].addedAt), true)
console.log('Recent display removal: exact Malay screenshot command, English variants, preview identity, scoped/latest/legacy matching, ambiguity and source preservation passed.')
