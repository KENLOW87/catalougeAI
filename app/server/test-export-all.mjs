// "Download all as PDF" — every catalogue in ONE file.
//
// The thing worth proving is that the combined download is not a second exporter:
// it is the same renderer handed a list. So the test does not hardcode page counts.
// It exports each catalogue on its own, exports them together, and checks the
// combined file has exactly the sum of the pages — no page lost where two
// catalogues meet, and none shared between them.
//
//   EXPORT_URL=http://localhost:5199 node server/test-export-all.mjs
//
// Needs the export server running with the app served at APP_URL.

import { SEED as LED_SEED } from '../src/lib/model.js'
import { PVC_SEED } from '../src/lib/categories/pvc.js'

const EXPORT = process.env.EXPORT_URL ?? 'http://localhost:5174'

let failed = 0
const check = (ok, label) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${label}`)
  if (!ok) failed++
}

async function exportPdf(body) {
  const res = await fetch(`${EXPORT}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

// Chrome writes one "/Type /Page" object per printed sheet; "/Type /Pages" is the
// tree node, so the trailing character has to be excluded.
const pageCount = buf => (buf.toString('latin1').match(/\/Type\s*\/Page(?![s])/g) ?? []).length

const catalogues = [
  { category: 'accessories-led', products: LED_SEED, chrome: null },
  { category: 'pvc-marble', products: PVC_SEED, chrome: null },
]

console.log(`export server  ${EXPORT}\n`)

const separate = []
for (const c of catalogues) {
  const pdf = await exportPdf({ products: c.products, category: c.category })
  const n = pageCount(pdf)
  separate.push(n)
  check(n > 0, `${c.category} on its own — ${n} page(s), ${Math.round(pdf.length / 1024)} KB`)
}

const combined = await exportPdf({ catalogues })
const total = pageCount(combined)
const expected = separate.reduce((a, b) => a + b, 0)

check(total === expected, `combined = ${total} pages, expected ${expected} (${separate.join(' + ')})`)
check(combined.length > 1024, `combined file is real — ${Math.round(combined.length / 1024)} KB`)

// A malformed request must be refused rather than quietly exporting nothing.
let refused = false
try { await exportPdf({ catalogues: [] }) } catch { refused = true }
check(refused, 'an empty catalogues array is refused')

refused = false
try { await exportPdf({ catalogues: [{ category: 'accessories-led' }] }) } catch { refused = true }
check(refused, 'a catalogue with no products array is refused')

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
