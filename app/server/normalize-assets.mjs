// Normalises a product image's flat background to pure white so the asset can be
// dropped onto ANY slot (tinted or white) and composited with mix-blend-mode:multiply.
// The catalogue's tint is positional, so assets must not carry a baked-in background.
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SRC = resolve(process.argv[2])
const DST = resolve(process.argv[3])
const TOL = Number(process.argv[4] ?? 30)

const raw = readFileSync(SRC)
const { width, height, data } = SRC.toLowerCase().endsWith('.png')
  ? PNG.sync.read(raw)
  : jpeg.decode(raw, { useTArray: true })
const px = (x, y) => { const i = (y * width + x) * 4; return [data[i], data[i + 1], data[i + 2]] }

// Sample the entire border, not just the corners: a neighbouring product bleeding
// into one corner must not be mistaken for the background.
const border = []
for (let x = 0; x < width; x += 2) { border.push(px(x, 0), px(x, height - 1)) }
for (let y = 0; y < height; y += 2) { border.push(px(0, y), px(width - 1, y)) }

const median = c => { const v = border.map(p => p[c]).sort((a, b) => a - b); return v[v.length >> 1] }
const forced = process.argv[6] ? process.argv[6].split(',').map(Number) : null
const bg = forced ?? [median(0), median(1), median(2)]
const dist = p => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2])

// Trust the background only if most of the border actually matches it.
const agree = border.filter(p => dist(p) < TOL).length / border.length
const flat = forced ? true : agree > Number(process.argv[5] ?? 0.6)

const out = new PNG({ width, height })
let wiped = 0
for (let i = 0; i < data.length; i += 4) {
  const isBg = flat && dist([data[i], data[i + 1], data[i + 2]]) < TOL
  if (isBg) wiped++
  out.data[i] = isBg ? 255 : data[i]
  out.data[i + 1] = isBg ? 255 : data[i + 1]
  out.data[i + 2] = isBg ? 255 : data[i + 2]
  out.data[i + 3] = 255
}
mkdirSync(dirname(DST), { recursive: true })
writeFileSync(DST, PNG.sync.write(out))
console.log(`${SRC.split(/[\/]/).pop().padEnd(12)} bg=rgb(${String(bg).padEnd(11)}) agree=${(agree*100).toFixed(0)}% flat=${flat} wiped=${(wiped / (width * height) * 100).toFixed(1)}%`)
