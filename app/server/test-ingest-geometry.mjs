// The ingest pipeline has two halves: Claude reads the page, geometry cuts the assets.
// The geometry half can be tested without any API call, by feeding it the boxes a
// perfect vision model would return for the page we already know by hand.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { readImage, toBuffer, crop, whitenBackground, keepInk, trimToContent, keepLargestBlob, snapBox } from './imageops.mjs'

const run = promisify(execFile)
const PDF = '../ACCECORIES - PVC MARBLE.pdf'
const dir = await mkdtemp(join(tmpdir(), 'geomtest-'))
await run('pdftoppm', ['-r', '400', '-png', '-f', '1', '-l', '1', PDF, join(dir, 'p')])
const page = readImage(join(dir, 'p-1.png'))
console.log(`page rendered: ${page.width}x${page.height}`)

// Deliberately SLOPPY boxes - roughly right, the way a vision model returns them.
// If snapBox works, these land on the same content my hand-measured crops did.
const W = page.width, H = page.height
const sloppy = [
  { label: 'led-160 photo',   kind: 'photo',   box: { x: 30/W,   y: 2880/H, w: 500/W, h: 620/H } },
  { label: 'led-160 drawing', kind: 'drawing', box: { x: 70/W,   y: 3240/H, w: 420/W, h: 260/H } },
  { label: 'led-195 drawing', kind: 'drawing', box: { x: 1090/W, y: 3240/H, w: 430/W, h: 260/H } },
  { label: 'led-15 drawing',  kind: 'drawing', box: { x: 2230/W, y: 3240/H, w: 490/W, h: 250/H } },
  { label: 'led-08 silver',   kind: 'photo',   box: { x: 880/W,  y: 3900/H, w: 560/W, h: 380/H } },
  { label: 'led-08 drawing',  kind: 'drawing', box: { x: 2350/W, y: 3850/H, w: 400/W, h: 360/H } },
]

for (const s of sloppy) {
  const snapped = snapBox(page, s.box)
  let img = crop(page, snapped.x, snapped.y, snapped.w, snapped.h)
  if (s.kind === 'drawing') {
    img = keepInk(img)
    img = trimToContent(img, { gap: 60, pad: 6 })
  } else {
    img = keepLargestBlob(whitenBackground(img, { tol: 30, agreement: 0.5 }).img)
    img = trimToContent(img, { gap: 45, pad: 4 })
  }
  const name = s.label.replace(/\s+/g, '-')
  writeFileSync(`../.tmp/geom-${name}.png`, toBuffer(img))
  const dx = Math.round(snapped.x - s.box.x * W), dy = Math.round(snapped.y - s.box.y * H)
  console.log(`  ${s.label.padEnd(18)} snapped by (${String(dx).padStart(4)},${String(dy).padStart(4)})px -> ${img.width}x${img.height}`)
}
await rm(dir, { recursive: true, force: true })
console.log('\nwrote .tmp/geom-*.png')
