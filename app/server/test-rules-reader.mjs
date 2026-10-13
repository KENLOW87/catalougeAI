// The rule-based readers, end to end, with NO API key.
import { readImage } from './imageops.mjs'
import { readWithRules, ruleReadIsUsable } from './readers/index.mjs'
import { shutdownOcr } from './ocr.mjs'

const pages = [
  ['LED page 1', '../extract/pages/p-1.png'],
  ['PVC page 2', '../.tmp/pvcstrip/pg2-2.png'],
  ['PVC page 3', '../.tmp/pvcstrip/pg3-3.png'],
]

for (const [label, path] of pages) {
  const t0 = Date.now()
  const res = await readWithRules(readImage(path))
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n=== ${label} — ${res.template ?? 'UNKNOWN'} (${secs}s, usable=${ruleReadIsUsable(res)}) ===`)
  for (const p of res.products ?? []) {
    const bits = [
      p.type === 'B' || p.finishes ? '[featured]' : '',
      p.colour ? `colour=${JSON.stringify(p.colour)}` : '',
      p.size ? `size=${JSON.stringify(p.size)}` : '',
      p.length ? `len=${JSON.stringify(p.length)}` : '',
      p.variants ? `${p.variants.length} finishes: ${p.variants.map(v => v.name).join('/')}` : '',
      p.finishes ? `${p.finishes.length} finishes: ${p.finishes.map(v => v.name).join('/')}` : '',
      p.extra ? '+photo' : '',
      p.photo ? 'photo✓' : 'photo✗',
      p.drawing ? 'drawing✓' : 'drawing✗',
    ].filter(Boolean)
    console.log(`   ${JSON.stringify(p.name).padEnd(20)} ${bits.join('  ')}`)
  }
  for (const w of res.warnings ?? []) console.log(`   ! ${w}`)
}

await shutdownOcr()
