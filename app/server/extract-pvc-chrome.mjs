// Re-cuts the PVC Marble page chrome.
//
// There is no clean horizontal cut between the header and the first product: the
// header's right-hand text (铝合金装饰条) runs to 34.1mm while product 1's gold badge
// starts at 32.6mm in the LEFT column. They sit side by side, not stacked.
//
// So the header is cut at 35mm and the badge region is painted out - the badge is
// per-product and is drawn by the template, not baked into the chrome.

import { writeFileSync } from 'node:fs'
import { readImage, toBuffer, crop } from './imageops.mjs'

const MM = 400 / 25.4
const OUT = 'public/assets/pvc'

/** Paints a rectangle white, in millimetres. */
function whiteOut(img, x0, y0, w, h) {
  const X0 = Math.round(x0 * MM), Y0 = Math.round(y0 * MM)
  const X1 = Math.min(img.width, Math.round((x0 + w) * MM))
  const Y1 = Math.min(img.height, Math.round((y0 + h) * MM))
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      const i = (y * img.width + x) * 4
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = 255
    }
  }
  return img
}

const pg2 = readImage('../.tmp/pvcstrip/pg2-2.png')
const pg3 = readImage('../.tmp/pvcstrip/pg3-3.png')

// First page of the category: blue band, "Edge Display", 收边条展示,
// the PVC MARBLE banner and both lines of Chinese.
const first = whiteOut(crop(pg2, 0, 0, 210 * MM, 35 * MM), 6, 30.5, 34, 5)
writeFileSync(`${OUT}/chrome-header-first.png`, toBuffer(first))
console.log(`header-first  ${first.width}x${first.height}  (badge region painted out)`)

// Continuation page: banner only, no "Edge Display" title block.
// Product 5's badge starts at 39mm here, so a 35mm cut is already clean.
const cont = crop(pg3, 0, 0, 210 * MM, 35 * MM)
writeFileSync(`${OUT}/chrome-header-cont.png`, toBuffer(cont))
console.log(`header-cont   ${cont.width}x${cont.height}`)
