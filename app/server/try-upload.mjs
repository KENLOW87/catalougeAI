// Drive the real browser: pick the empty family, click Add from PDF, upload the
// catalogue, and report exactly what the app does.
import puppeteer from 'puppeteer-core'

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const b = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] })
const p = await b.newPage()
const errs = []
p.on('pageerror', e => errs.push(String(e)))
p.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(m.text()) })
p.on('dialog', d => d.accept())
await p.setViewport({ width: 1500, height: 1000 })

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 600))

await p.select('.parent-pick select', 'pvc-marble-sheet')
await new Promise(r => setTimeout(r, 500))
console.log('category: ' + await p.$eval('.parent-pick select', s => s.options[s.selectedIndex].text))

await p.evaluate(() => [...document.querySelectorAll('button')]
  .find(x => x.textContent.includes('Add from PDF')).click())
await p.waitForSelector('.modal--wide')
await new Promise(r => setTimeout(r, 800))

const known = await p.$$eval('.modal--wide .lede', ls =>
  ls.map(l => l.textContent.trim()).find(t => t.startsWith('Known layouts')) ?? '(not shown)')
console.log(known)

const input = await p.$('.modal--wide input[type=file]')
await input.uploadFile('../test 2.pdf')
console.log('\nuploaded "test 2.pdf" — waiting…')

// Watch the progress line until the screen changes.
let last = ''
const started = Date.now()
while (Date.now() - started < 300000) {
  const state = await p.evaluate(() => {
    const h = document.querySelector('.modal--wide h2')?.textContent?.trim() ?? ''
    const prog = document.querySelector('.working p')?.textContent?.trim() ?? ''
    const warn = [...document.querySelectorAll('.modal--wide .warn')].map(w => w.textContent.trim())
    return { h, prog, warn }
  })
  if (state.prog && state.prog !== last) { last = state.prog; console.log('   · ' + state.prog) }
  if (state.h && state.h !== 'Reading your PDF') {
    console.log('\nRESULT: ' + state.h)
    if (state.warn.length) state.warn.forEach(w => console.log('  ! ' + w))
    break
  }
  await new Promise(r => setTimeout(r, 700))
}

const rows = await p.$$eval('.draft', ds => ds.map(d => {
  const ins = [...d.querySelectorAll('.draft-fields input')].map(i => i.value)
  const imgs = d.querySelectorAll('.draft-assets img').length
  return `${ins[0] ?? '?'} | ${ins[1] ?? ''} | ${imgs} image(s)`
})).catch(() => [])
if (rows.length) {
  console.log(`\n${rows.length} products on the review screen:`)
  rows.forEach((r, i) => console.log('  ' + String(i + 1).padStart(2) + '  ' + r))
}
const pills = await p.$$eval('.pill', ps => ps.map(x => x.textContent.trim())).catch(() => [])
if (pills.length) console.log('\nsummary: ' + pills.join(' · '))

// Apply, then check the catalogue actually renders and exports.
await p.evaluate(() => [...document.querySelectorAll('.modal-actions button')]
  .find(x => x.textContent.trim() === 'Apply')?.click())
await new Promise(r => setTimeout(r, 3000))

const inList = await p.$$eval('.list li .nm', ns => ns.map(n => n.textContent.trim()))
const pageCount = await p.$$eval('.cat-page', ps => ps.length)
const stats = await p.$eval('.stats', e => e.textContent.replace(/\s+/g, ' ').trim())
console.log('\nAFTER APPLY: ' + stats + ', ' + pageCount + ' page(s) rendered')
console.log('first five: ' + inList.slice(0, 5).join(', '))
console.log('photos on the rendered pages: ' + await p.$$eval('.cat-page img', is => is.length))

const { resolve } = await import('node:path')
const { readdirSync, statSync } = await import('node:fs')
const DL = resolve(process.cwd(), '..', '.tmp', 'dlsheet')
const cdp = await p.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL })
await p.evaluate(() => document.querySelector('.export button.primary').click())
await new Promise(r => setTimeout(r, 20000))
let files = []
try { files = readdirSync(DL) } catch {}
const pdfOut = files.find(x => x.endsWith('.pdf'))
console.log('exported PDF: ' + (pdfOut
  ? `${pdfOut} (${Math.round(statSync(resolve(DL, pdfOut)).size / 1024)} KB)`
  : 'NONE'))

await p.screenshot({ path: '../.tmp/upload-result.png' })
console.log('\nscreenshot: .tmp/upload-result.png')
console.log('JS errors: ' + (errs.length ? errs.join(' | ') : 'none'))
await b.close()
