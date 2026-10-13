import puppeteer from 'puppeteer-core'
let fails = 0
const check = (c, m) => { console.log(`${c ? '  PASS' : '  FAIL'}  ${m}`); if (!c) fails++ }

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox'],
})
const p = await b.newPage()
const errs = []
p.on('pageerror', e => errs.push(String(e)))
p.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(m.text()) })
await p.setViewport({ width: 1500, height: 1000 })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle0' })

console.log('\n== ingest dialog ==')
const btn = await p.$$eval('button', bs => bs.some(x => x.textContent.includes('Add from PDF')))
check(btn, 'the "Add from PDF…" button is in the sidebar')

await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Add from PDF')).click())
await p.waitForSelector('.modal--wide')
check(true, 'dialog opens')
await new Promise(r => setTimeout(r, 600))   // let the /api/ingest/status probe land

const heading = await p.$eval('.modal--wide h2', el => el.textContent.trim())
check(heading === 'Add products from a PDF or image', `heading reads "${heading}"`)

const warned = await p.$$eval('.modal--wide .warn', ws => ws.some(w => w.textContent.includes('ANTHROPIC_API_KEY')))
check(warned, 'it says plainly that the server has no API key')

// Without a key the built-in readers still work, so the button must stay usable.
// It was disabled here before the local readers existed; that is no longer right.
const disabled = await p.$$eval('.modal--wide button.primary', bs => bs[0]?.disabled)
check(disabled === false, 'the Choose PDF button stays enabled — local readers need no key')

const localNote = await p.$$eval('.modal--wide .lede', ls =>
  ls.some(l => /on this machine, for free/i.test(l.textContent)))
check(localNote, 'it explains that known layouts are read locally and free')

const listsReaders = await p.$$eval('.modal--wide .lede', ls =>
  ls.some(l => l.textContent.includes('PVC Marble') && l.textContent.includes('LED')))
check(listsReaders, 'it names which layouts are recognised')

// The layout teacher was removed at the client's request — it was manual work in a
// system built for automation. Nothing should still offer it.
const noTeachCopy = await p.$$eval('.modal--wide', ms =>
  ms.every(m => !/Teach a layout/i.test(m.textContent)))
check(noTeachCopy, 'it does not offer a layout teacher — that feature was removed')

await p.evaluate(() => [...document.querySelectorAll('.modal-actions button')].find(b => b.textContent === 'Cancel').click())
await new Promise(r => setTimeout(r, 300))
check(!(await p.$('.modal--wide')), 'Cancel closes it')

console.log('\n== console ==')
check(errs.length === 0, errs.length ? 'JS errors:\n' + errs.join('\n') : 'no JS errors')
await b.close()
console.log(`\n${fails ? fails + ' FAILED' : 'ALL CHECKS PASSED'}`)
process.exit(fails ? 1 : 0)
