// Trims an asset down to its own content.
//
// Crops taken off a page pick up fragments of the NEIGHBOURING cell -- a stray
// "10r" or a corner of the next product's strip. Those fragments are always
// separated from the real subject by a band of clean white, so: find the largest
// run of ink-bearing columns (tolerating small internal gaps, since a product can
// legitimately have a gap in the middle), then do the same for rows, and crop.
import { PNG } from 'pngjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = resolve(process.argv[2])
const DST = resolve(process.argv[3])
const GAP = Number(process.argv[4] ?? 26)   // internal gap tolerated, px
const PAD = Number(process.argv[5] ?? 6)    // breathing room kept, px
const WHITE = 247

const img = PNG.sync.read(readFileSync(SRC))
const { width, height, data } = img
const isInk = (x, y) => {
  const i = (y * width + x) * 4
  return data[i] < WHITE || data[i + 1] < WHITE || data[i + 2] < WHITE
}

// Largest run of "true" in a boolean profile, merging gaps shorter than GAP.
function bestRun(profile) {
  const runs = []
  let s = -1, lastTrue = -1
  profile.forEach((v, i) => {
    if (v) {
      if (s < 0) s = i
      else if (i - lastTrue > GAP) { runs.push([s, lastTrue + 1]); s = i }
      lastTrue = i
    }
  })
  if (s >= 0) runs.push([s, lastTrue + 1])
  if (!runs.length) return [0, profile.length]
  // Score by ink mass, not width, so a wide faint smear loses to the real subject.
  return runs.reduce((a, b) => {
    const mass = r => profile.slice(r[0], r[1]).filter(Boolean).length
    return mass(b) > mass(a) ? b : a
  })
}

const colProfile = []
for (let x = 0; x < width; x++) {
  let n = 0
  for (let y = 0; y < height; y++) if (isInk(x, y)) n++
  colProfile.push(n > 1)
}
const [x0r, x1r] = bestRun(colProfile)

const rowProfile = []
for (let y = 0; y < height; y++) {
  let n = 0
  for (let x = x0r; x < x1r; x++) if (isInk(x, y)) n++
  rowProfile.push(n > 1)
}
const [y0r, y1r] = bestRun(rowProfile)

const x0 = Math.max(0, x0r - PAD), x1 = Math.min(width, x1r + PAD)
const y0 = Math.max(0, y0r - PAD), y1 = Math.min(height, y1r + PAD)
const w = x1 - x0, h = y1 - y0

const out = new PNG({ width: w, height: h })
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const s = ((y + y0) * width + (x + x0)) * 4
    const d = (y * w + x) * 4
    out.data[d] = data[s]; out.data[d + 1] = data[s + 1]
    out.data[d + 2] = data[s + 2]; out.data[d + 3] = 255
  }
}
writeFileSync(DST, PNG.sync.write(out))
console.log(`${SRC.split(/[\/]/).pop().padEnd(24)} ${width}x${height} -> ${w}x${h}`)
