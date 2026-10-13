// A catalogue is not only its product tables.
//
// The cover, the "Wide Range of Application" spread, the close-up detail pages and
// the installation steps carry no products to extract — and they are still the
// document the client publishes. Each is kept whole, as one full-page picture that
// holds its place in the flow and prints back out exactly as printed.
//
// Three behaviours are pinned here:
//   1. a PDF with cover pages AND product pages -> both come in, in order
//   2. a PDF with ONLY cover pages              -> still imports, as pages
//   3. product codes survive the doubled-glyph repair (PV0O3 -> PV03)
//
//   node server/test-keep-pages.mjs
//
// Needs poppler (pdftoppm, pdfinfo) and the sample PDFs. No API key, no server.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { ingestPdf } from './ingest.mjs'

const MIXED = '../test 3.pdf'   // cover + application spread + one product page
const FULL = 'C:/Users/admin/Desktop/RAIHANA - INTERN WORK/\u2705\ud835\udc04-\ud835\udc02\ud835\udc00\ud835\udc13\ud835\udc00\ud835\udc0b\ud835\udc0e\ud835\udc06\ud835\udc14\ud835\udc04/PVC Marble Sheet (Jan  2026).pdf'

let failed = 0
const check = (ok, label) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${label}`)
  if (!ok) failed++
}

const asBase64 = async p => (await readFile(p)).toString('base64')
const quiet = () => {}

// --- 1. cover pages and product pages, together, in order ----------------------
if (existsSync(MIXED)) {
  const res = await ingestPdf(await asBase64(MIXED), quiet, 'pvc-marble-sheet')
  const pages = res.products.filter(p => p.isPage)
  const products = res.products.filter(p => !p.isPage)

  check(pages.length > 0, `${pages.length} page(s) kept whole`)
  check(products.length > 0, `${products.length} product(s) read`)
  check(pages.every(p => typeof p.image === 'string' && p.image.startsWith('data:image/jpeg')),
    'each kept page carries its picture, as JPEG rather than a multi-megabyte PNG')
  check(pages.every(p => p.issues.length === 0),
    'a kept page is never "missing" anything — it IS the page')

  // Order is the point: a cover that lands after the products it introduces is wrong.
  const flow = res.products.map(p => p.sourcePage)
  check(flow.every((n, i) => i === 0 || n >= flow[i - 1]), `flow follows the PDF: pages ${flow.join(',')}`)

  // The doubled glyph: OCR reads one round character twice ("PV0O3"), and converting
  // both readings invented a digit — the client saw PV003 and PV006.
  const codes = products.map(p => p.name)
  check(!codes.some(n => /^PV0\d\d/.test(n)), `no invented digit in any code: ${codes.join(', ')}`)
} else {
  console.log(`  skip  ${MIXED} not found`)
}

// --- 2. a PDF with NO products at all still imports, as pages -------------------
// This used to be refused outright, which threw away the front page of every
// catalogue whose cover was uploaded on its own.
if (existsSync(FULL)) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const run = promisify(execFile)
  const dir = await mkdtemp(join(tmpdir(), 'keep-pages-'))
  await run('pdfseparate', ['-f', '1', '-l', '2', FULL, join(dir, 'p-%d.pdf')])
  await run('pdfunite', [join(dir, 'p-1.pdf'), join(dir, 'p-2.pdf'), join(dir, 'cover-only.pdf')])

  const res = await ingestPdf(await asBase64(join(dir, 'cover-only.pdf')), quiet, 'pvc-marble-sheet')
  check(res.products.length === 2, `a products-free PDF imports ${res.products.length} page(s), not an error`)
  check(res.products.every(p => p.isPage), 'every item is a kept page')
} else {
  console.log('  skip  full catalogue not found at the expected path')
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
