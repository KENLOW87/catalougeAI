// Separates a product photo from a fragment of its neighbour when the two are
// physically fused.
//
// In the PVC Marble source, the "installed" detail photo is drawn ON TOP of the
// last colour bar. The pixels genuinely touch, so neither column runs nor connected
// components can split them — both see one blob.
//
// What does separate them is tone: the bar is dark aluminium, the detail photo is
// light marble. So build a mask of the subject's tone, keep its largest connected
// region, dilate to recover the subject's own soft edge and specular rim, and
// whiten everything outside.

import { PNG } from 'pngjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = resolve(process.argv[2])
const DST = resolve(process.argv[3])
const MODE = process.argv[4] ?? 'dark'      // which tone is the subject
const CUT = Number(process.argv[5] ?? 130)
const DILATE = Number(process.argv[6] ?? 7)

const img = PNG.sync.read(readFileSync(SRC))
const { width, height, data } = img
const n = width * height

const lum = i => 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
const isWhite = i => data[i * 4] > 250 && data[i * 4 + 1] > 250 && data[i * 4 + 2] > 250

const seed = new Uint8Array(n)
for (let i = 0; i < n; i++) {
  if (isWhite(i)) continue
  seed[i] = MODE === 'dark' ? (lum(i) < CUT ? 1 : 0) : (lum(i) >= CUT ? 1 : 0)
}

// Largest connected region of the subject's tone.
const label = new Int32Array(n).fill(-1)
const stack = new Int32Array(n)
const sizes = []
for (let start = 0; start < n; start++) {
  if (!seed[start] || label[start] >= 0) continue
  const id = sizes.length
  let sp = 0, area = 0
  stack[sp++] = start
  label[start] = id
  while (sp > 0) {
    const cur = stack[--sp]
    area++
    const cx = cur % width, cy = (cur / width) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const ni = ny * width + nx
        if (seed[ni] && label[ni] < 0) { label[ni] = id; stack[sp++] = ni }
      }
    }
  }
  sizes.push(area)
}
if (!sizes.length) {
  writeFileSync(DST, PNG.sync.write(img))
  console.log(`${SRC.split(/[\\/]/).pop()}  no ${MODE} subject found — left unchanged`)
  process.exit(0)
}
const best = sizes.indexOf(Math.max(...sizes))

// Dilate so the subject keeps its own soft edge / specular rim, which sits on the
// wrong side of the tone cut and would otherwise be shaved off.
let mask = new Uint8Array(n)
for (let i = 0; i < n; i++) mask[i] = label[i] === best ? 1 : 0
for (let pass = 0; pass < DILATE; pass++) {
  const next = new Uint8Array(mask)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (mask[i]) continue
      if ((x > 0 && mask[i - 1]) || (x < width - 1 && mask[i + 1]) ||
          (y > 0 && mask[i - width]) || (y < height - 1 && mask[i + width])) {
        // Only grow into non-white pixels: never invent subject where the ground is.
        if (!isWhite(i)) next[i] = 1
      }
    }
  }
  mask = next
}

const out = new PNG({ width, height })
let kept = 0
for (let i = 0; i < n; i++) {
  const p = i * 4
  if (mask[i]) {
    kept++
    out.data[p] = data[p]; out.data[p + 1] = data[p + 1]; out.data[p + 2] = data[p + 2]
  } else {
    out.data[p] = 255; out.data[p + 1] = 255; out.data[p + 2] = 255
  }
  out.data[p + 3] = 255
}
writeFileSync(DST, PNG.sync.write(out))
console.log(`${SRC.split(/[\\/]/).pop().padEnd(26)} mode=${MODE} kept=${(kept / n * 100).toFixed(1)}% of frame`)
