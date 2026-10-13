// The whole ingest pipeline with NO API key: upload the real catalogue PDF and
// see what comes back.
import { readFileSync } from 'node:fs'
import { ingestPdf } from './ingest.mjs'
import { shutdownOcr } from './ocr.mjs'

delete process.env.ANTHROPIC_API_KEY
delete process.env.ANTHROPIC_AUTH_TOKEN

const pdf = readFileSync('../ACCECORIES - PVC MARBLE.pdf').toString('base64')
const t0 = Date.now()
const { products, pages, warnings } = await ingestPdf(pdf, m => console.log('   · ' + m))
const secs = ((Date.now() - t0) / 1000).toFixed(1)

console.log(`\n=== ${products.length} products from ${pages} pages in ${secs}s, zero API calls ===`)
for (const p of products) {
  const kind = p.variants ? `${p.variants.length} finishes` : p.finishes ? `featured, ${p.finishes.length} finishes` : 'standard'
  const names = p.variants?.map(v => v.name).join('/') ?? p.finishes?.map(f => f.name).join('/') ?? p.colour
  console.log(`  p${p.sourcePage}  ${JSON.stringify(p.name).padEnd(20)} ${kind.padEnd(22)} ${names ?? ''}`)
  if (p.issues?.length) console.log(`        needs: ${p.issues.join(', ')}`)
}
console.log('\nwarnings:')
for (const w of warnings) console.log('  ! ' + w)

const clean = products.filter(p => !p.issues?.length).length
console.log(`\n${clean} of ${products.length} ready to import with no further work.`)
await shutdownOcr()
