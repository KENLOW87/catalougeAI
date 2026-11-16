import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { crop, readImage, toBuffer, keepInk, whiteToTransparent, trimToContent } from './imageops.mjs'
import { PNG } from 'pngjs'

const sourcePath = resolve(process.argv[2] || '../.tmp/carbon-page9.png')
const outputDir = resolve('public/assets/source/carbon-crystal-wall')
await mkdir(outputDir, { recursive: true })

const page = readImage(sourcePath)
const mm = page.width / 210
const cut = box => toBuffer(crop(page,
  Math.round(box.x * mm), Math.round(box.y * mm),
  Math.round(box.w * mm), Math.round(box.h * mm)))
const drawing = box => {
  const image = crop(page,
    Math.round(box.x * mm), Math.round(box.y * mm),
    Math.round(box.w * mm), Math.round(box.h * mm))
  return toBuffer(trimToContent(whiteToTransparent(keepInk(image, 210)), { gap: 50, pad: 8 }))
}
const stack = (topBox, bottomBox, gap = 8) => {
  const top = crop(page, Math.round(topBox.x * mm), Math.round(topBox.y * mm), Math.round(topBox.w * mm), Math.round(topBox.h * mm))
  const bottom = crop(page, Math.round(bottomBox.x * mm), Math.round(bottomBox.y * mm), Math.round(bottomBox.w * mm), Math.round(bottomBox.h * mm))
  const out = new PNG({ width: Math.max(top.width, bottom.width), height: top.height + gap + bottom.height })
  for (const [image, y0] of [[top, 0], [bottom, top.height + gap]]) {
    for (let y = 0; y < image.height; y++) {
      const src = y * image.width * 4
      const dest = (y0 + y) * out.width * 4
      Buffer.from(image.data.buffer ?? image.data).copy(out.data, dest, src, src + image.width * 4)
    }
  }
  return PNG.sync.write(out)
}

const assets = {
  // The left panels are installation/display scenes. They deliberately retain
  // the original scene; only the product strips and dimension drawings are
  // isolated below.
  'page9-i-profile-display.png': cut({ x: 10, y: 35, w: 185, h: 53 }),
  'page9-end-profile-display.png': cut({ x: 10, y: 123, w: 108, h: 52 }),
  'page9-corner-profile-display.png': cut({ x: 10, y: 211, w: 108, h: 53 }),

  // Right-hand finish strips, cropped above their printed finish captions.
  'page9-i-profile-photo.png': cut({ x: 126, y: 89, w: 80, h: 23 }),
  'page9-end-profile-photo.png': cut({ x: 118, y: 135, w: 88, h: 29 }),
  'page9-corner-profile-photo.png': stack(
    { x: 127, y: 213, w: 79, h: 18 },
    { x: 127, y: 247, w: 79, h: 25 }),

  // Measurement drawings only. No product names, captions or adjacent photos.
  'page9-i-profile-drawing.png': drawing({ x: 48, y: 88, w: 68, h: 25 }),
  'page9-end-profile-drawing.png': drawing({ x: 119, y: 174, w: 87, h: 22 }),
  'page9-corner-profile-drawing.png': drawing({ x: 55, y: 268, w: 75, h: 29 }),
}

for (const [name, bytes] of Object.entries(assets)) await writeFile(join(outputDir, name), bytes)
console.log(`Wrote ${Object.keys(assets).length} Carbon Crystal profile assets to ${outputDir}`)
