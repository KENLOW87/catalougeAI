// One-off extraction of the PVC Marble category assets.
//
// Colour variants come from the EMBEDDED strip images, not from page crops. On the
// page the "installed" detail photo overlaps the Black bar (177-187mm), so the two
// merge into a single connected blob and cannot be separated. The embedded strips
// contain only the variants, cleanly.
//
// The strips are NOT in page order in the PDF - draw order shuffled P2/P3/P4 - so
// the mapping below was established by identifying each strip's profile shape.

import { writeFileSync, mkdirSync } from 'node:fs'
import { splitStrip, readImage, toBuffer } from './split-strip.mjs'
import { crop, keepInk, keepLargestBlob, trimToContent, whiteToTransparent } from './imageops.mjs'

const MM = 400 / 25.4        // page renders are 400 DPI
const SRC = '../extract/pvc'
const OUT = 'public/assets/pvc'
mkdirSync(OUT, { recursive: true })

// strip file -> product, verified by profile shape and variant count.
// L Profile 14mm is the exception: the embedded img-019 strip is a different
// rounded profile, so these four finishes must be cropped from the printed row.
const PRODUCTS = [
  { id: 'h-profile',      strip: 'img-001', page: 2, band: [40.5, 84.0],  drawing: [62, 84],    extra: null },
  { id: 't-profile',      strip: 'img-012', page: 2, band: [91.0, 146.0], drawing: [124, 146],  extra: [91.0, 139.0] },
  { id: 'end-profile',    strip: 'img-006', page: 2, band: [159.0, 215.0],drawing: [194, 215],  extra: [159.0, 206.0] },
  { id: 'w-profile',      strip: 'img-010', page: 2, band: [230.5, 282.0],drawing: [261, 282],  extra: [230.5, 276.0] },
  { id: 'corner-profile', strip: 'img-019', page: 3, band: [38.0, 100.0], drawing: [70, 100],   extra: [38.0, 82.5] },
  { id: 'l-profile-14',   page: 3, band: [106.5, 172.0],drawing: [144, 172],  extra: null,
    pageVariants: [
      [68.6, 92.1, 30.5, 55.2], [95.9, 92.1, 33.7, 55.2],
      [126.4, 92.1, 31.8, 55.2], [155.0, 92.1, 40.0, 55.2],
    ] },
  { id: 'l-profile-10',   page: 3, band: [221.5, 278.0],drawing: [250, 278],  extra: null,
    pageVariants: [
      [74.9, 222.2, 33.0, 54.0], [104.1, 222.2, 33.0, 54.0],
      [131.4, 222.2, 33.0, 54.0], [158.1, 222.2, 41.3, 54.0],
    ] },
]

const pages = {
  2: readImage('../.tmp/pvcstrip/pg2-2.png'),
  3: readImage('../.tmp/pvcstrip/pg3-3.png'),
}

const save = (name, img) => {
  writeFileSync(`${OUT}/${name}.png`, toBuffer(img))
  return `${img.width}x${img.height}`
}

console.log('--- colour variants (from embedded strips) ---')
for (const p of PRODUCTS) {
  const parts = p.pageVariants
    ? p.pageVariants.map(box => {
        let img = crop(pages[p.page], box[0] * MM, box[1] * MM, box[2] * MM, box[3] * MM)
        return { img: trimToContent(img, { gap: 45, pad: 8 }) }
      })
    : splitStrip(readImage(`${SRC}/${p.strip}.jpg`))
  const sizes = parts.map((part, i) => save(`${p.id}-v${i}`, part.img))
  console.log(`  ${p.id.padEnd(16)} ${parts.length} variants  ${sizes.join('  ')}`)
}

console.log('\n--- dimension drawings (gold line art, left column) ---')
for (const p of PRODUCTS) {
  const page = pages[p.page]
  const [y0, y1] = p.drawing
  // Gold luminance is ~160 and the callout text is black, so a cut at 210 keeps
  // both and drops the white ground.
  let img = whiteToTransparent(keepInk(crop(page, 5 * MM, y0 * MM, 53 * MM, (y1 - y0) * MM), 210))
  img = trimToContent(img, { gap: 70, pad: 8 })
  console.log(`  ${p.id.padEnd(16)} ${save(`${p.id}-drawing`, img)}`)
}

console.log('\n--- installed detail photos (right edge) ---')
for (const p of PRODUCTS.filter(x => x.extra)) {
  const page = pages[p.page]
  const [y0, y1] = p.extra
  let img = crop(page, 172 * MM, y0 * MM, 36 * MM, (y1 - y0) * MM)
  img = keepLargestBlob(img)
  img = trimToContent(img, { gap: 60, pad: 3 })
  console.log(`  ${p.id.padEnd(16)} ${save(`${p.id}-extra`, img)}`)
}

console.log('\n--- product 6 White exception ---')
{
  const page = pages[3]
  const white = splitStrip(crop(page, 55 * MM, 162 * MM, (150 - 55) * MM, 38 * MM), { minAreaFrac: 0.02 })
  if (white.length) console.log(`  white variant   ${save('l-profile-14-white', white[0].img)}`)
  let dw = keepInk(crop(page, 108 * MM, 162 * MM, 45 * MM, 34 * MM), 210)
  dw = trimToContent(dw, { gap: 70, pad: 8 })
  console.log(`  white drawing   ${save('l-profile-14-white-drawing', dw)}`)
}

console.log('\n--- template chrome ---')
// Page 2 is the FIRST page of the category and carries the "Edge Display" title
// block; page 3 is a continuation and carries the banner only. Two variants.
console.log(`  header-first    ${save('chrome-header-first', crop(pages[2], 0, 0, 210 * MM, 39 * MM))}`)
console.log(`  header-cont     ${save('chrome-header-cont', crop(pages[3], 0, 0, 210 * MM, 35 * MM))}`)
