// Re-importing a PDF that overlaps what is already in the catalogue.
//
// The client's scenario: the system holds PV1, PV2, PV4 and the PDF has
// PV1, PV2, PV3, PV4. The result should follow the PDF — PV3 inserted at 3, PV4
// shifted to 4 — not appended with duplicates.
//
// Driven through the real browser, against the real PVC Marble catalogue: the
// system is cut down to 3 products, then the whole 3-page PDF is re-imported.

import puppeteer from 'puppeteer-core'

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let failures = 0
const check = (c, m) => { console.log(`${c ? '  PASS' : '  FAIL'}  ${m}`); if (!c) failures++ }
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

console.log('\n== set up: a catalogue with a gap in the middle ==')
// Keep H Profile, T Profile and W Profile. END Profile — the one between T and W —
// is removed, so the PDF should put it back in the right place.
await p.evaluate(() => {
  const key = 'geometra.catalogue.pvc-marble'
  const seed = JSON.parse(localStorage.getItem(key) ?? 'null')
  localStorage.setItem('geometra.activeCategory', 'pvc-marble')
})
await p.reload({ waitUntil: 'networkidle0' })
await p.evaluate(() => [...document.querySelectorAll('.cat-tab')]
  .find(t => t.textContent.includes('PVC Marble')).click())
await pause(500)

await p.evaluate(() => {
  const key = 'geometra.catalogue.pvc-marble'
  const all = JSON.parse(localStorage.getItem(key))
  const keep = all.filter(x => ['H Profile', 'T Profile', 'W Profile'].includes(x.name))
  localStorage.setItem(key, JSON.stringify(keep))
})
await p.reload({ waitUntil: 'networkidle0' })
await pause(500)

const names = () => p.$$eval('.list li .nm', ns => ns.map(n => n.textContent.trim()))
const before = await names()
check(before.join(' | ') === 'H Profile | T Profile | W Profile',
  `system holds: ${before.join(', ')}  (END Profile is missing from the middle)`)

console.log('\n== re-import the full PDF ==')
await p.evaluate(() => [...document.querySelectorAll('button')]
  .find(b => b.textContent.includes('Add from PDF')).click())
await p.waitForSelector('.modal--wide')
const input = await p.$('.modal--wide input[type=file]')
await input.uploadFile('../ACCECORIES - PVC MARBLE.pdf')

// Reading three pages locally takes a while.
await p.waitForFunction(() => /Review what the PDF says/.test(document.body.textContent),
  { timeout: 240000 })
check(true, 'the review screen appeared')

const pills = await p.$$eval('.pill', ps => ps.map(x => x.textContent.trim()))
check(pills.some(t => /already here/.test(t)), `summary shows what matched: ${pills.join(' · ')}`)
check(pills.some(t => /new/.test(t)), 'and what is new')

const reconNames = await p.$$eval('.recon-list .rname', ns => ns.map(n => n.textContent.trim()))
check(reconNames.includes('H Profile') && reconNames.includes('T Profile'),
  'the products already here are listed as matches, not as new')
check(!reconNames.includes('END Profile'),
  'END Profile is NOT listed as already-here — it is genuinely new to the system')

console.log('\n== apply ==')
await p.evaluate(() => [...document.querySelectorAll('.modal-actions button')]
  .find(b => b.textContent.trim() === 'Apply').click())
await pause(1500)

const after = await names()
console.log('  result: ' + after.join(', '))
check(after.length === 7, `7 products, not ${3 + 7} — nothing was duplicated`)
check(after.join(' | ') === 'H Profile | T Profile | END Profile | W Profile | CORNER Profile | L Profile | L Profile',
  'and they are in the PDF\'s order, with END Profile back at position 3')

const dupes = after.filter((n, i) => after.indexOf(n) !== i && n !== 'L Profile')
check(dupes.length === 0, 'no duplicate products')

console.log('\n== console ==')
check(errs.length === 0, errs.length ? 'JS errors:\n' + errs.join('\n') : 'no JS errors')

await b.close()
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures ? 1 : 0)
