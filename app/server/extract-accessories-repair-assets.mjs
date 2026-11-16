import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { crop, readImage, toBuffer, keepInk, whiteToTransparent, trimToContent } from './imageops.mjs'

const sourceDir = resolve(process.argv[2] || '../tmp/pdfs/accessories-audit')
const outputDir = resolve('public/assets/source/accessories-march-2026')
await mkdir(outputDir, { recursive: true })

const cutMm = (page, box) => {
  const mm = page.width / 210
  return toBuffer(crop(page,
    Math.round(box.x * mm), Math.round(box.y * mm),
    Math.round(box.w * mm), Math.round(box.h * mm)))
}
const cutDrawingMm = (page, box) => {
  const mm = page.width / 210
  let img = crop(page, Math.round(box.x * mm), Math.round(box.y * mm), Math.round(box.w * mm), Math.round(box.h * mm))
  img = trimToContent(whiteToTransparent(keepInk(img, 210)), { gap: 50, pad: 8 })
  return toBuffer(img)
}

const page5 = readImage(join(sourceDir, 'page-05.png'))
const page6 = readImage(join(sourceDir, 'page-06.png'))
const page4 = readImage(join(sourceDir, 'page-04.png'))
const page7 = readImage(join(sourceDir, 'page-07.png'))
const page8 = readImage(join(sourceDir, 'page-08.png'))
const page9 = readImage(join(sourceDir, 'page-09.png'))
const page10 = readImage(join(sourceDir, 'page-10.png'))
const assets = {
  // Page 4 has two products, each with independent 5mm/8mm technical
  // variations. Keep the finish strip and the dimension drawing separate.
  'page4-i-profile-5mm-photo.png': cutMm(page4, { x: 58, y: 37, w: 148, h: 56 }),
  'page4-i-profile-5mm-drawing.png': cutDrawingMm(page4, { x: 14, y: 73, w: 43, h: 27 }),
  'page4-i-profile-8mm-photo.png': cutMm(page4, { x: 58, y: 108, w: 148, h: 56 }),
  'page4-i-profile-8mm-drawing.png': cutDrawingMm(page4, { x: 14, y: 126, w: 43, h: 34 }),
  'page4-end-profile-5mm-photo.png': cutMm(page4, { x: 58, y: 179, w: 148, h: 49 }),
  'page4-end-profile-5mm-drawing.png': cutDrawingMm(page4, { x: 14, y: 208, w: 47, h: 28 }),
  'page4-end-profile-8mm-photo.png': cutMm(page4, { x: 58, y: 242, w: 148, h: 49 }),
  'page4-end-profile-8mm-drawing.png': cutDrawingMm(page4, { x: 14, y: 262, w: 47, h: 31 }),
  'page7-t-micro-seam-display.png': cutMm(page7, { x: 132, y: 43, w: 68, h: 31 }),
  'corner-5mm-photo.png': cutMm(page5, { x: 58, y: 37, w: 148, h: 55 }),
  'corner-5mm-drawing.png': cutDrawingMm(page5, { x: 14, y: 80, w: 40, h: 27 }),
  'corner-8mm-photo.png': cutMm(page5, { x: 58, y: 119, w: 148, h: 55 }),
  'corner-8mm-drawing.png': cutDrawingMm(page5, { x: 14, y: 159, w: 40, h: 31 }),
  'corner-support.png': cutMm(page5, { x: 0, y: 199, w: 210, h: 98 }),
  'aluminum-end-bend-features.png': cutMm(page6, { x: 0, y: 210, w: 210, h: 87 }),
  'aluminum-end-bend-5mm-drawing.png': cutDrawingMm(page6, { x: 5, y: 80, w: 60, h: 36 }),
  'aluminum-end-bend-8mm-drawing.png': cutDrawingMm(page6, { x: 5, y: 155, w: 60, h: 36 }),
  // Page 6 contains two separate Aluminum End Bend products. Preserve the
  // complete source photo frame for each row, including its finish labels;
  // do not tight-crop or run background removal on source imagery.
  'aluminum-end-bend-5mm-photo.png': cutMm(page6, { x: 72, y: 45, w: 133, h: 75 }),
  'aluminum-end-bend-8mm-photo.png': cutMm(page6, { x: 72, y: 125, w: 133, h: 85 }),
  // Page 8's four dimension sketches share the same compact source band.
  // Keep the measurement labels/lines, but stop before the product caption
  // below the 80mm sketch.
  'flat-bar-20mm-drawing.png': cutDrawingMm(page8, { x: 40, y: 90, w: 25, h: 12 }),
  'flat-bar-25mm-drawing.png': cutDrawingMm(page8, { x: 40, y: 121, w: 29, h: 12 }),
  'flat-bar-30mm-drawing.png': cutDrawingMm(page8, { x: 40, y: 155, w: 36, h: 12 }),
  'flat-bar-80mm-drawing.png': cutDrawingMm(page8, { x: 40, y: 209, w: 42, h: 10 }),
  'flat-bar-20mm-photo.png': cutMm(page8, { x: 87, y: 90, w: 123, h: 31 }),
  'flat-bar-25mm-photo.png': cutMm(page8, { x: 87, y: 121, w: 123, h: 34 }),
  'flat-bar-30mm-photo.png': cutMm(page8, { x: 87, y: 155, w: 123, h: 58 }),
  'flat-bar-80mm-photo.png': cutMm(page8, { x: 87, y: 212, w: 123, h: 85 }),
  // Page 9 has three separate source rows. The right-hand finish group is the
  // product photo. The dimension sketch is the small centre drawing; the
  // lower-left profile pieces are a separate display/reference image. The old
  // crop started at the lower-left pieces, so it was incorrectly saved as the
  // dimension drawing.
  'page9-t-profile-10mm-photo.png': cutMm(page9, { x: 105, y: 37, w: 105, h: 60 }),
  'page9-t-profile-10mm-drawing.png': cutDrawingMm(page9, { x: 74, y: 37, w: 33, h: 25 }),
  'page9-t-profile-10mm-display.png': cutMm(page9, { x: 10, y: 67, w: 86, h: 34 }),
  'page9-u-channel-10mm-photo.png': cutMm(page9, { x: 105, y: 113, w: 105, h: 70 }),
  'page9-u-channel-10mm-drawing.png': cutDrawingMm(page9, { x: 74, y: 113, w: 33, h: 25 }),
  'page9-u-channel-10mm-display.png': cutMm(page9, { x: 10, y: 153, w: 86, h: 34 }),
  'page9-u-channel-20mm-photo.png': cutMm(page9, { x: 105, y: 199, w: 105, h: 84 }),
  'page9-u-channel-20mm-drawing.png': cutDrawingMm(page9, { x: 74, y: 199, w: 36, h: 25 }),
  'page9-u-channel-20mm-display.png': cutMm(page9, { x: 10, y: 254, w: 86, h: 36 }),
  'page10-l-profile-25mm-drawing.png': cutDrawingMm(page10, { x: 20, y: 227, w: 40, h: 24 }),
  'page10-l-profile-25mm-display.png': cutMm(page10, { x: 14, y: 251, w: 64, h: 42 }),
}
for (const [name, bytes] of Object.entries(assets)) await writeFile(join(outputDir, name), bytes)
console.log(`Wrote ${Object.keys(assets).length} reviewed source assets to ${outputDir}`)
