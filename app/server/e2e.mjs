import puppeteer from 'puppeteer-core'
import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DL = resolve(process.cwd(), '..', '.tmp', 'dl')
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
p.on('dialog', d => d.accept())          // the delete / reset confirms
await p.setViewport({ width: 1500, height: 1000 })

// Always start from the seeded catalogue, not whatever a previous run left behind.
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle0' })

const list = () => p.$$eval('.list li', ls => ls.map(l => ({
  n: l.querySelector('.n').textContent.trim(),
  name: l.querySelector('.nm').textContent.trim(),
})))
const badges = () => p.$$eval('.cat-page .badge', bs => bs.map(x => x.textContent.trim()))
const tinted = () => p.$$eval('.cat-page .cellA, .cat-page .blockB', cs =>
  cs.map(c => c.querySelector('.panel').classList.contains('panel--tint')))
const pageCount = () => p.$$eval('.cat-page', ps => ps.length)
const clickRow = (name, idx) => p.evaluate((nm, i) => {
  const li = [...document.querySelectorAll('.list li')].find(l => l.querySelector('.nm').textContent.trim() === nm)
  li.querySelectorAll('.mv button')[i].click()
}, name, idx)

console.log('\n== 1. loads with the extracted catalogue ==')
check((await list()).length === 7, '7 products in the sidebar')
check(await pageCount() === 1, '1 page rendered')
check((await badges()).join(',') === '1,2,3,4,5,6,7', 'badges read 1..7')
check((await tinted()).join(',') === 'true,false,true,false,true,false,true', 'tint alternates, #7 tinted')
check((await list())[0].name === 'Led -160', 'name preserved verbatim ("Led -160")')

console.log('\n== 2. STORYBOARD 2 - delete the middle item ==')
await clickRow('Led -170', 3)
await pause(400)
const after = await list()
check(after.length === 6, '6 products remain')
check(!after.some(x => x.name === 'Led -170'), 'Led -170 is gone')
check(after[1].name === 'Led -195', 'Led -195 slid back into slot 2')
check((await badges()).join(',') === '1,2,3,4,5,6', 'badges closed the gap: 1..6')
check((await tinted())[1] === false, 'Led -195 LOST its tint moving 3 -> 2')
check(after[5].name === 'Led - 08' && after[5].n === '6', 'Led - 08 renumbered 7 -> 6')

console.log('\n== 3. STORYBOARD 1 - add a product ==')
await p.click('.actions button.primary')
await p.waitForSelector('.modal')
await p.type('.modal input[placeholder="Led -160"]', 'Led -220')
await p.type('.modal input[placeholder="Silver"]', 'Rose Gold')
check(await p.$eval('.modal button.primary', el => el.disabled), 'Save is BLOCKED until a drawing is supplied')
const [photo, drawing] = await p.$$('.modal input[type=file]')
await photo.uploadFile('public/assets/products/led-160.png')
await drawing.uploadFile('public/assets/drawings/led-160.png')
await pause(400)
check(!(await p.$eval('.modal button.primary', el => el.disabled)), 'Save enabled once both files are in')
await p.click('.modal button.primary')
await pause(400)
const added = await list()
check(added.length === 7, '7 products after adding')
check(added[5].name === 'Led -220' && added[5].n === '6', 'new product took slot 6 (after the standard items)')
check(added[6].name === 'Led - 08' && added[6].n === '7', 'Led - 08 pushed back to 7')

console.log('\n== 4. reorder ==')
await clickRow('Led -220', 0)
await pause(300)
const moved = await list()
check(moved[4].name === 'Led -220', 'Led -220 moved up to slot 5')
check(moved[5].name === 'Corner Led 601', 'Corner Led 601 shifted down to 6')

console.log('\n== 5. edit an existing product ==')
await clickRow('Led -160', 2)
await p.waitForSelector('.modal')
await p.$eval('.modal input[placeholder="Silver"]', el => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, '')
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await p.type('.modal input[placeholder="Silver"]', 'Matte Black')
await p.click('.modal button.primary')
await pause(400)
check(await p.$eval('.cat-page .cellA .colour', el => el.textContent.trim()) === 'Matte Black',
  'colour edit shows on the page')

console.log('\n== 6. persistence across reload ==')
await p.reload({ waitUntil: 'networkidle0' })
const reloaded = await list()
check(reloaded.length === 7 && reloaded.some(x => x.name === 'Led -220'), 'edits survived a reload')

console.log('\n== 7. add enough to force a second page ==')
await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('geometra.catalogue.accessories-led'))
  const base = s.find(x => x.type === 'A')
  for (let i = 0; i < 6; i++) s.push({ ...base, id: 'bulk' + i, name: 'Bulk ' + (i + 1) })
  localStorage.setItem('geometra.catalogue.accessories-led', JSON.stringify(s))
})
await p.reload({ waitUntil: 'networkidle0' })
check(await pageCount() === 2, 'catalogue grew to 2 pages')
check(await p.$$eval('.cat-page', ps => ps[1].querySelectorAll('.blockB').length) === 1,
  'the featured block was pushed onto page 2')
check(await p.$$eval('.cat-page', ps => ps[1].querySelectorAll('.cat-gallery').length) === 0,
  'page 2 has header only - no gallery')

console.log('\n== 8. PDF export from the UI ==')
const cdp = await p.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL })
await p.click('.export button.primary')
await pause(12000)
let files = []
try { files = readdirSync(DL) } catch (e) { console.log('    (readdir failed: ' + e.code + ')') }
const pdf = files.find(f => f.endsWith('.pdf'))
check(!!pdf, `PDF downloaded (${pdf ?? 'none'})`)
if (pdf) {
  const kb = Math.round(statSync(resolve(DL, pdf)).size / 1024)
  check(kb > 100, `PDF is non-trivial (${kb} KB)`)
}

console.log('\n== console ==')
check(errs.length === 0, errs.length ? 'JS errors:\n' + errs.join('\n') : 'no JS errors')

await b.close()
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures ? 1 : 0)
