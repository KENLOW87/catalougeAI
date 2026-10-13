import { readFileSync } from 'node:fs'
import { ingestPdf } from './ingest.mjs'
import { shutdownOcr } from './ocr.mjs'

delete process.env.ANTHROPIC_API_KEY
delete process.env.ANTHROPIC_AUTH_TOKEN

const pdf = readFileSync('C:/Users/admin/Downloads/CATALOUGE AI_260915_161248.pdf').toString('base64')
try {
  const r = await ingestPdf(pdf, m => console.log('   · ' + m))
  console.log('\nproducts:', r.products.length)
  for (const w of r.warnings) console.log('  ! ' + w)
} catch (e) {
  console.log('\nSTOPPED WITH:')
  console.log('  ' + e.message)
}
await shutdownOcr()
