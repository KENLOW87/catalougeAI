import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { crop, readImage, toBuffer } from './imageops.mjs'

const sourceDir = resolve(process.argv[2] || '../tmp/pdfs/accessories-audit')
const outputDir = resolve('public/assets/source/accessories-march-2026')
await mkdir(outputDir, { recursive: true })

const cutMm = (page, box) => {
  const mm = page.width / 210
  return toBuffer(crop(page,
    Math.round(box.x * mm), Math.round(box.y * mm),
    Math.round(box.w * mm), Math.round(box.h * mm)))
}

const page5 = readImage(join(sourceDir, 'page-05.png'))
const page6 = readImage(join(sourceDir, 'page-06.png'))
const assets = {
  'corner-5mm-photo.png': cutMm(page5, { x: 58, y: 37, w: 148, h: 55 }),
  'corner-5mm-drawing.png': cutMm(page5, { x: 10, y: 57, w: 43, h: 37 }),
  'corner-support.png': cutMm(page5, { x: 0, y: 199, w: 210, h: 98 }),
  'aluminum-end-bend-features.png': cutMm(page6, { x: 0, y: 173, w: 210, h: 124 }),
}
for (const [name, bytes] of Object.entries(assets)) await writeFile(join(outputDir, name), bytes)
console.log(`Wrote ${Object.keys(assets).length} reviewed source assets to ${outputDir}`)
