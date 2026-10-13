// Keeps only the largest connected blob of ink and whitens everything else.
//
// The Led-08 finish photos each contain a sliver of the NEIGHBOURING strip. The
// strips run diagonally, so a fragment can share columns with the real subject --
// column-run trimming cannot separate them. Connected components can.
import { PNG } from 'pngjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = resolve(process.argv[2])
const DST = resolve(process.argv[3])
const WHITE = Number(process.argv[4] ?? 244)

const { width, height, data } = PNG.sync.read(readFileSync(SRC))
const n = width * height
const ink = new Uint8Array(n)
for (let i = 0; i < n; i++) {
  const p = i * 4
  ink[i] = (data[p] < WHITE || data[p + 1] < WHITE || data[p + 2] < WHITE) ? 1 : 0
}

// Iterative flood fill, 8-connected.
const label = new Int32Array(n).fill(-1)
const sizes = []
const stack = new Int32Array(n)
for (let start = 0; start < n; start++) {
  if (!ink[start] || label[start] >= 0) continue
  const id = sizes.length
  let sp = 0, count = 0
  stack[sp++] = start
  label[start] = id
  while (sp > 0) {
    const cur = stack[--sp]
    count++
    const cx = cur % width, cy = (cur / width) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const ni = ny * width + nx
        if (ink[ni] && label[ni] < 0) { label[ni] = id; stack[sp++] = ni }
      }
    }
  }
  sizes.push(count)
}

const best = sizes.indexOf(Math.max(...sizes))
const out = new PNG({ width, height })
let dropped = 0
for (let i = 0; i < n; i++) {
  const p = i * 4
  const keep = label[i] === best
  if (ink[i] && !keep) dropped++
  out.data[p] = keep ? data[p] : 255
  out.data[p + 1] = keep ? data[p + 1] : 255
  out.data[p + 2] = keep ? data[p + 2] : 255
  out.data[p + 3] = 255
}
writeFileSync(DST, PNG.sync.write(out))
console.log(`${SRC.split(/[\/]/).pop().padEnd(24)} blobs=${String(sizes.length).padStart(4)} kept=${sizes[best]} dropped=${dropped}px`)
