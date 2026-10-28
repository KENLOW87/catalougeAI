import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { prepareImportPhotos } from './prepare-import-photos.mjs'

const encode = image => `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`
function cutout(colour) {
  const image = new PNG({ width: 80, height: 80 })
  for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) {
    const i = (y * 80 + x) * 4
    image.data[i] = image.data[i + 1] = image.data[i + 2] = colour
    image.data[i + 3] = 255
  }
  return encode(image)
}
const white = cutout(245), dark = cutout(35)
const products = [
  { name: 'ANY-WHITE-PRODUCT', categoryId: 'generic-ai', photo: white, drawing: 'untouched-original-drawing' },
  { name: 'OTHER-COLOUR', categoryId: 'accessories-led', photo: dark, extra: white, drawing: 'untouched-original-reference' },
  { name: 'FINISHES', finishes: [{ photo: dark, drawing: 'finish-drawing' }] },
  { name: 'VARIANTS', variants: [{ photo: white }], exception: { variant: { photo: dark }, drawing: 'exception-drawing' } },
  { isPage: true, image: white, photo: dark, details: [white] },
]
const before = structuredClone(products)
let calls = 0
const progress = []
const result = await prepareImportPhotos(products, { keyAvailable: true, onProgress: m => progress.push(m), edit: async (source, instruction, options) => {
  calls++
  assert.equal(options.productOnly, true)
  assert.match(instruction, /ONLY the actual catalogue product/)
  assert.ok(source === white || source === dark)
  return source
} })
assert.equal(result.total, 6)
assert.equal(result.processed, 6)
assert.equal(result.failed, 0)
assert.equal(calls, 2, 'identical source images are processed once per import')
assert.equal(products[0].photoOriginal, white)
const outputWhite = PNG.sync.read(Buffer.from(products[0].photo.split(',')[1], 'base64'))
assert.deepEqual([...outputWhite.data.subarray(0, 4)], [48, 52, 59, 255])
const outputDark = PNG.sync.read(Buffer.from(products[1].photo.split(',')[1], 'base64'))
assert.equal(outputDark.data[3], 0)
assert.equal(products[0].drawing, before[0].drawing)
assert.equal(products[1].drawing, before[1].drawing)
assert.equal(products[2].finishes[0].drawing, before[2].finishes[0].drawing)
assert.equal(products[3].exception.drawing, before[3].exception.drawing)
assert.deepEqual(products[4], before[4], 'full pages and their detail galleries are preserved')
assert.equal(progress.length, 7)

const failed = [{ name: 'FAILURE', photo: dark, drawing: white }]
const failure = await prepareImportPhotos(failed, { keyAvailable: true, edit: async () => { throw new Error('403 access denied') } })
assert.equal(failure.failed, 1)
assert.equal(failed[0].photo, dark)
assert.equal(failed[0].drawing, white)
assert.ok(failed[0].photoTreatmentErrors.length)
await assert.rejects(prepareImportPhotos([{ photo: dark }], { keyAvailable: false }), /OPENAI_API_KEY/)
await assert.rejects(prepareImportPhotos([{ photo: dark }], { keyAvailable: true, shouldStop: () => true }), { name: 'IngestCancelled' })
assert.equal((await prepareImportPhotos([{ isPage: true, image: white }], { keyAvailable: false })).total, 0)
const scenes = [
  { name: 'Installed mirror', photo: white, photoTreatmentMode: 'preserve-scene' },
  { name: 'Previously isolated mirror', photo: dark, photoOriginal: white, photoTreatmentMode: 'preserve-scene' },
]
const sceneResult = await prepareImportPhotos(scenes, { keyAvailable: false, edit: async () => { throw new Error('Scene must not reach image editor') } })
assert.equal(sceneResult.preserved, 2)
assert.equal(sceneResult.processed, 0)
assert.equal(scenes[0].photo, white)
assert.equal(scenes[1].photo, white)
assert.equal(scenes[1].photoTreatment, 'original-scene-v1')
console.log('Import photos: all categories/variants/exceptions, dark contrast, transparency, original drawings/pages, deduplication, missing key, API failure and cancellation passed (mock API).')
