import puppeteer from 'puppeteer-core'
import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DL = resolve(process.cwd(), '..', '.tmp', 'dlpvc')
let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`)
  if (!cond) failures++
}
const pause = ms => new Promise(r => setTimeout(r, ms))

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

const list = () => p.$$eval('.list li', ls => ls.map(l => ({
  n: l.querySelector('.n').textContent.trim(),
  name: l.querySelector('.nm').textContent.trim(),
})))
const pageCount = () => p.$$eval('.cat-page', ps => ps.length)
const badges = () => p.$$eval('.cat-page .badge--pvc', bs => bs.map(x => x.textContent.trim()))

console.log('\n== 1. switching category ==')
check(await p.$$eval('.cat-tab', ts => ts.length) === 2, 'two category tabs')
check((await list()).length === 7, 'LED shows 7 products before switching')

await p.evaluate(() => [...document.querySelectorAll('.cat-tab')]
  .find(t => t.textContent.includes('PVC Marble')).click())
await pause(600)

check(await p.$('.cat-page--pvc') !== null, 'PVC template rendered (not the LED grid)')
check(await p.$('.cellA') === null, 'the LED grid is gone')

console.log('\n== 2. the extracted PVC catalogue ==')
const pvc = await list()
check(pvc.length === 7, '7 products')
check(pvc[0].name === 'H Profile', 'first is H Profile')
check(pvc[3].name === 'W Profile', 'fourth is W Profile')
check(pvc[5].name === 'L Profile' && pvc[6].name === 'L Profile',
  'products 6 and 7 are both "L Profile" — the name is not unique')
check((await badges()).join(',') === '1,2,3,4,5,6,7', 'badges read 1..7')

console.log('\n== 3. matches the original page split ==')
check(await pageCount() === 2, '2 pages')
const perPage = await p.$$eval('.cat-page', ps => ps.map(x => x.querySelectorAll('.pvc-row').length))
check(perPage[0] === 4 && perPage[1] === 3, `4 products on page 1, 3 on page 2 (got ${perPage.join('/')})`)
check(await p.$$eval('.cat-page', ps => ps[0].querySelectorAll('.pvc-header img').length) === 1,
  'page 1 carries the Edge Display header')
check(await p.$eval('.cat-page:nth-child(2) .pvc-header img', el => el.getAttribute('src')).then(s => s.includes('cont')),
  'page 2 uses the continuation header, not the first-page one')

console.log('\n== 4. the exception sub-row ==')
check(await p.$$eval('.pvc-exception', es => es.length) === 1, 'exactly one exception row')
check(await p.$eval('.pvc-exnote', el => el.textContent.trim()) === '(This size only for White Color)',
  'its note is printed verbatim')
check(await p.$$eval('.pvc-row--tall', rs => rs.length) === 1, 'that row is laid out taller')

console.log('\n== 5. variable-length finish lists ==')
const counts = await p.$$eval('.pvc-row', rs => rs.map(r => r.querySelectorAll('.pvc-variants .pvc-variant').length))
check(counts.join(',') === '4,4,4,3,4,4,4', `finish counts ${counts.join(',')} — W Profile really has only 3`)

console.log('\n== 6. delete reflows and renumbers ==')
await p.evaluate(() => {
  const li = [...document.querySelectorAll('.list li')].find(l => l.querySelector('.nm').textContent.trim() === 'T Profile')
  li.querySelector('button.danger').click()
})
await pause(500)
const after = await list()
check(after.length === 6, '6 products remain')
check(after[1].name === 'END Profile', 'END Profile slid back into slot 2')
check((await badges()).join(',') === '1,2,3,4,5,6', 'badges closed the gap')
check(await pageCount() === 2, 'still 2 pages (the tall exception row keeps the split)')

console.log('\n== 7. the LED category is untouched ==')
await p.evaluate(() => [...document.querySelectorAll('.cat-tab')]
  .find(t => t.textContent.includes('LED')).click())
await pause(500)
const led = await list()
check(led.length === 7, 'LED still has its 7 products')
check(led[0].name === 'Led -160', 'LED names preserved verbatim')
check(await p.$('.cellA') !== null, 'the LED grid is back')

console.log('\n== 8. PDF export of the PVC category ==')
await p.evaluate(() => [...document.querySelectorAll('.cat-tab')]
  .find(t => t.textContent.includes('PVC Marble')).click())
await pause(400)
const cdp = await p.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL })
await p.click('.export button.primary')
await pause(14000)
let files = []
try { files = readdirSync(DL) } catch (e) { console.log('    (readdir failed: ' + e.code + ')') }
const pdf = files.find(f => f.endsWith('.pdf'))
check(!!pdf, `PDF downloaded (${pdf ?? 'none'})`)
if (pdf) {
  const kb = Math.round(statSync(resolve(DL, pdf)).size / 1024)
  check(kb > 100, `PDF is non-trivial (${kb} KB)`)
  check(pdf.startsWith('PVC'), `named for the category (${pdf})`)
}

console.log('\n== console ==')
check(errs.length === 0, errs.length ? 'JS errors:\n' + errs.join('\n') : 'no JS errors')

await b.close()
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures ? 1 : 0)
