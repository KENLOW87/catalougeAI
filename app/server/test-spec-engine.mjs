// Does the DATA-driven engine match the hand-written readers?
// If yes, a layout taught through the UI is as capable as one written in code.
import { readImage } from './imageops.mjs'
import { findAnchors, readWithSpec } from './readers/spec.mjs'
import { BUILTIN_SPECS } from './readers/specs.mjs'
import { shutdownOcr } from './ocr.mjs'

const pages = [
  ['LED page 1', '../extract/pages/p-1.png', 'accessories-led'],
  ['PVC page 2', '../.tmp/pvcstrip/pg2-2.png', 'pvc-marble'],
  ['PVC page 3', '../.tmp/pvcstrip/pg3-3.png', 'pvc-marble'],
]

for (const [label, path, specId] of pages) {
  const page = readImage(path)
  const spec = BUILTIN_SPECS.find(s => s.id === specId)
  const anchors = findAnchors(page, spec.anchor)
  console.log(`\n=== ${label} — spec "${spec.id}" found ${anchors.length} anchors ===`)
  const { products, warnings } = await readWithSpec(page, spec)
  for (const p of products) {
    const fin = p.variants ?? p.finishes
    console.log(`   ${JSON.stringify(p.name ?? '').padEnd(20)}` +
      `${(p.colour ?? p.size ?? '').toString().padEnd(16)}` +
      `${p.length ? String(p.length).padEnd(10) : ''.padEnd(10)}` +
      `${fin ? fin.length + ' finishes: ' + fin.map(v => v.name).join('/') : ''}` +
      `${p.photo ? ' photo✓' : ''}${p.drawing ? ' drawing✓' : ' drawing✗'}${p.extra ? ' +photo' : ''}`)
  }
  for (const w of warnings) console.log(`   ! ${w}`)
}
await shutdownOcr()
