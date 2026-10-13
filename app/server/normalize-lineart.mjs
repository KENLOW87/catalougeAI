// Dimension drawings are black line art on a light ground. Rather than matching a
// background colour (which is a subtle gradient, not flat), keep only the ink:
// anything lighter than the threshold becomes pure white, so the drawing composites
// onto any slot colour with mix-blend-mode:multiply.
import { PNG } from 'pngjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SRC = resolve(process.argv[2])
const DST = resolve(process.argv[3])
const CUT = Number(process.argv[4] ?? 215)

const { width, height, data } = PNG.sync.read(readFileSync(SRC))
const out = new PNG({ width, height })
let ink = 0
for (let i = 0; i < data.length; i += 4) {
  const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  const keep = lum < CUT
  if (keep) ink++
  // Ramp the surviving pixels to full white at the cut so anti-aliased edges stay smooth.
  out.data[i] = keep ? data[i] : 255
  out.data[i + 1] = keep ? data[i + 1] : 255
  out.data[i + 2] = keep ? data[i + 2] : 255
  out.data[i + 3] = 255
}
mkdirSync(dirname(DST), { recursive: true })
writeFileSync(DST, PNG.sync.write(out))
console.log(`${SRC.split(/[\/]/).pop().padEnd(22)} ink=${(ink / (width * height) * 100).toFixed(1)}%`)
