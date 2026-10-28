import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { prepareDimensionPhoto, finishProductCutout } from './dimension-photo.mjs'
import { readWithSpec } from './readers/spec.mjs'

const source = new PNG({ width: 100, height: 100 })
for (let i = 0; i < source.data.length; i += 4) {
  source.data[i] = source.data[i + 1] = source.data[i + 2] = 235
  source.data[i + 3] = 255
}
const encode = image => `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`
const spec = { id: 'dimension-photo-test', anchor: { type: 'fixed', boxes: [{ x: 0, y: 0, w: 210, h: 210 }] }, kinds: [{ fields: [
  { key: 'drawing', type: 'lineart', dimensionPhoto: true, box: { x: 0, y: 0, w: 210, h: 210 } },
] }] }
const oldKey = process.env.OPENAI_API_KEY
delete process.env.OPENAI_API_KEY
try {
  const { products, warnings } = await readWithSpec(source, spec)
  const restored = PNG.sync.read(Buffer.from(products[0].drawing.split(',')[1], 'base64'))
  assert.equal(restored.data[0], 235, 'Pale product pixels must not be erased by ink thresholding')
  assert.equal(warnings.length, 0)
} finally { if (oldKey !== undefined) process.env.OPENAI_API_KEY = oldKey }
const cutout = new PNG({ width: 100, height: 100 })
for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) {
  const i = (y * 100 + x) * 4
  cutout.data[i] = cutout.data[i + 1] = cutout.data[i + 2] = 245
  cutout.data[i + 3] = 255
}
const original = encode(source)
const result = await prepareDimensionPhoto(original, async (input, instruction, options) => {
  assert.equal(input, original)
  assert.equal(options.productOnly, true)
  assert.match(instruction, /Do not draw or invent any measurements/)
  return encode(cutout)
})
const finished = PNG.sync.read(Buffer.from(result.split(',')[1], 'base64'))
assert.deepEqual([...finished.data.subarray(0, 4)], [48, 52, 59, 255])
assert.equal(encode(source), original)
// An asymmetric, leaning product must retain every pixel's direction and spacing
// after margin trimming, for both transparent and dark-contrast output.
for (const colour of [60, 245]) {
  const angled = new PNG({ width: 120, height: 160 })
  for (let y = 25; y < 130; y++) {
    const left = 25 + Math.floor((y - 25) / 6)
    for (let x = left; x < left + (y < 55 ? 30 : 12); x++) {
      const i = (y * angled.width + x) * 4
      angled.data.set([colour, colour, colour, 255], i)
    }
  }
  const output = PNG.sync.read(Buffer.from(finishProductCutout(encode(angled)).split(',')[1], 'base64'))
  // Product bounds: x=25..58, y=25..129; existing padding is eight pixels.
  assert.equal(output.width, 50)
  assert.equal(output.height, 121)
  for (let y = 25; y < 130; y++) for (let x = 25; x <= 58; x++) {
    const i = (y * angled.width + x) * 4
    if (!angled.data[i + 3]) continue
    const j = ((y - 25 + 8) * output.width + x - 25 + 8) * 4
    assert.deepEqual([...output.data.subarray(j, j + 4)], [...angled.data.subarray(i, i + 4)], 'Trimming must translate product pixels only, without rotation, mirroring or scaling')
  }
}
console.log('Dimension-photo source pixels preserved; AI failure retains original; separate white product cutout gets dark contrast; measurements never regenerated.')
