// Can free local OCR actually read this catalogue? Test before building on it.
import { readImage, crop } from './imageops.mjs'
import { ocr, ocrLabel, shutdownOcr } from './ocr.mjs'

const MM = 400 / 25.4
const led = readImage('../extract/pages/p-1.png')   // 200 DPI
const LED_MM = 200 / 25.4

// The six LED text blocks: name, colour, "Length : 3000mm".
const cells = [
  ['Led -160 / Silver',        81],
  ['Led -170 / Silver',       616],
  ['Led -195 / Black',       1119],
  ['Led - 508 / Black & Silver', 1679],
  ['Led -15 / Black & White', 2231],
  ['Corner Led 601 / Silver', 2817],
]

console.log('=== LED product text blocks (expected / got) ===')
for (const [expect, x400] of cells) {
  const x = Math.round(x400 / 2) - 6                 // 400 DPI measure -> 200 DPI render
  const block = crop(led, x, Math.round(170.5 * LED_MM), 270, Math.round(12 * LED_MM))
  const { lines, confidence } = await ocr(block)
  console.log(`  ${expect.padEnd(26)} -> ${JSON.stringify(lines)}  (conf ${confidence.toFixed(0)})`)
}

console.log('\n=== PVC product text blocks ===')
const pvc = readImage('../.tmp/pvcstrip/pg2-2.png')  // 400 DPI
const rows = [['H Profile', 40.4], ['T Profile', 91 + 9.4], ['END Profile', 159 + 9.4], ['W Profile', 230.5 + 9.4]]
for (const [expect, yMm] of rows) {
  const block = crop(pvc, 15 * MM, (yMm - 1) * MM, 42 * MM, 18 * MM)
  const { lines, confidence } = await ocr(block)
  console.log(`  ${expect.padEnd(14)} -> ${JSON.stringify(lines)}  (conf ${confidence.toFixed(0)})`)
}

console.log('\n=== PVC finish labels (single-line mode) ===')
for (const [name, x] of [['Silver', 60], ['Rose Gold', 92], ['Gold', 124], ['Black', 156]]) {
  const label = crop(pvc, x * MM, 80 * MM, 30 * MM, 5.5 * MM)
  const { text, confidence } = await ocrLabel(label)
  console.log(`  ${name.padEnd(10)} -> ${JSON.stringify(text)}  (conf ${confidence.toFixed(0)})`)
}

await shutdownOcr()
