import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { crop, readImage, toBuffer, keepInk, whiteToTransparent, trimToContent } from './imageops.mjs'
import { PNG } from 'pngjs'

const sourceDir = resolve(process.argv[2] || '../tmp/pdfs/accessories-audit')
const outputDir = resolve('public/assets/source/accessories-march-2026')
const embeddedPage11Dir = process.argv[3] ? resolve(process.argv[3]) : null
const embeddedPage12Dir = process.argv[4] ? resolve(process.argv[4]) : null
const embeddedPage7Dir = process.argv[5] ? resolve(process.argv[5]) : null
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

const compose = images => {
  const width = images.reduce((sum, image) => sum + image.width, 0) + Math.max(0, images.length - 1) * 24
  const height = Math.max(...images.map(image => image.height))
  const out = new PNG({ width, height })
  let x = 0
  for (const image of images) {
    for (let y = 0; y < image.height; y++) {
      const src = y * image.width * 4
      const dest = (y * width + x) * 4
      Buffer.from(image.data.buffer ?? image.data).copy(out.data, dest, src, src + image.width * 4)
    }
    x += image.width + 24
  }
  return PNG.sync.write(out)
}

// Some embedded supplier photos are stored as RGB pixels plus a separate
// grayscale soft mask.  Keep the product pixels and use the mask as alpha so
// the catalogue never inherits the PDF's black matte/background.
const maskedPng = (imagePath, maskPath) => {
  const image = readImage(imagePath)
  const mask = readImage(maskPath)
  const out = new PNG({ width: image.width, height: image.height })
  const count = Math.min(image.width * image.height, mask.width * mask.height)
  for (let p = 0; p < count; p++) {
    const i = p * 4
    out.data[i] = image.data[i]
    out.data[i + 1] = image.data[i + 1]
    out.data[i + 2] = image.data[i + 2]
    out.data[i + 3] = mask.data[i]
  }
  return PNG.sync.write(out)
}

const page5 = readImage(join(sourceDir, 'page-05.png'))
const page6 = readImage(join(sourceDir, 'page-06.png'))
const page4 = readImage(join(sourceDir, 'page-04.png'))
const page7 = readImage(join(sourceDir, 'page-07.png'))
const page8 = readImage(join(sourceDir, 'page-08.png'))
const page9 = readImage(join(sourceDir, 'page-09.png'))
const page10 = readImage(join(sourceDir, 'page-10.png'))
const page11 = readImage(join(sourceDir, 'page-11.png'))
const page12 = readImage(join(sourceDir, 'page-12.png'))
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
  'page9-t-profile-10mm-drawing.png': cutDrawingMm(page9, { x: 74, y: 37, w: 28, h: 25 }),
  'page9-t-profile-10mm-display.png': cutMm(page9, { x: 10, y: 67, w: 86, h: 34 }),
  'page9-u-channel-10mm-photo.png': cutMm(page9, { x: 105, y: 113, w: 105, h: 70 }),
  'page9-u-channel-10mm-drawing.png': cutDrawingMm(page9, { x: 68, y: 132, w: 34, h: 27 }),
  'page9-u-channel-10mm-display.png': cutMm(page9, { x: 10, y: 153, w: 86, h: 34 }),
  'page9-u-channel-20mm-photo.png': cutMm(page9, { x: 105, y: 199, w: 105, h: 84 }),
  'page9-u-channel-20mm-drawing.png': cutDrawingMm(page9, { x: 68, y: 216, w: 42, h: 26 }),
  'page9-u-channel-20mm-display.png': cutMm(page9, { x: 10, y: 254, w: 86, h: 36 }),
  'page10-l-profile-25mm-drawing.png': cutDrawingMm(page10, { x: 20, y: 227, w: 40, h: 24 }),
  'page10-l-profile-25mm-photo.png': cutMm(page10, { x: 75, y: 210, w: 130, h: 64 }),
  'page10-l-profile-25mm-display.png': cutMm(page10, { x: 14, y: 251, w: 64, h: 42 }),
  'page7-t-micro-seam-drawing.png': cutDrawingMm(page7, { x: 15, y: 95, w: 52, h: 31 }),
  'page7-h-micro-seam-drawing.png': cutDrawingMm(page7, { x: 25, y: 188, w: 66, h: 50 }),
  // Page 11 technical drawings need a wider left margin than the old boxes:
  // the vertical measurement labels sat just outside x:20 and were reduced to
  // a bare "mm" in the saved catalogue.
  'page11-u-channel-20mm-drawing.png': cutDrawingMm(page11, { x: 12, y: 68, w: 58, h: 34 }),
  'page11-u-channel-10mm-drawing.png': cutDrawingMm(page11, { x: 12, y: 141, w: 58, h: 30 }),
  'page11-wing-flat-bar-drawing.png': cutDrawingMm(page11, { x: 94, y: 193, w: 92, h: 36 }),
  // Page 12's vertical size labels also begin left of the former x:20 crop.
  'page12-bfb-01-drawing.png': cutDrawingMm(page12, { x: 12, y: 70, w: 58, h: 32 }),
  'page12-bfb-02-drawing.png': cutDrawingMm(page12, { x: 12, y: 150, w: 58, h: 42 }),
  'page12-bfb-03-drawing.png': cutDrawingMm(page12, { x: 12, y: 246, w: 64, h: 32 }),
}
for (const [name, bytes] of Object.entries(assets)) await writeFile(join(outputDir, name), bytes)

if (embeddedPage11Dir) {
  await copyFile(join(embeddedPage11Dir, 'img-001.png'), join(outputDir, 'page11-u-channel-20mm-photo.png'))
  await copyFile(join(embeddedPage11Dir, 'img-003.png'), join(outputDir, 'page11-u-channel-10mm-photo.png'))
  const wing = await Promise.all(['img-005.png', 'img-007.png', 'img-009.png'].map(file => readImage(join(embeddedPage11Dir, file))))
  await writeFile(join(outputDir, 'page11-wing-flat-bar-photo.png'), compose(wing))
}
if (embeddedPage12Dir) {
  await writeFile(join(outputDir, 'page12-bfb-01-photo.png'), maskedPng(
    join(embeddedPage12Dir, 'img-000.png'), join(embeddedPage12Dir, 'img-001.png')))
  await writeFile(join(outputDir, 'page12-bfb-02-photo.png'), maskedPng(
    join(embeddedPage12Dir, 'img-002.png'), join(embeddedPage12Dir, 'img-003.png')))
  await writeFile(join(outputDir, 'page12-bfb-03-photo.png'), maskedPng(
    join(embeddedPage12Dir, 'img-004.png'), join(embeddedPage12Dir, 'img-005.png')))
}
if (embeddedPage7Dir) {
  await copyFile(join(embeddedPage7Dir, 'img-001.png'), join(outputDir, 'page7-t-micro-seam-photo.png'))
  await copyFile(join(embeddedPage7Dir, 'img-003.png'), join(outputDir, 'page7-h-micro-seam-photo.png'))
}
console.log(`Wrote ${Object.keys(assets).length} reviewed source assets to ${outputDir}`)
