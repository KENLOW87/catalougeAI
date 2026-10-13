import puppeteer from 'puppeteer-core'
const exe = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const b = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] })
const p = await b.newPage()
const errs = []
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
p.on('pageerror', e => errs.push(String(e)))
await p.setViewport({ width: 1500, height: 1000 })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
await p.evaluate(() => Promise.all([...document.images].map(i => i.complete || new Promise(r => { i.onload = i.onerror = r }))))
await p.screenshot({ path: process.argv[2] ?? '../.tmp/editor.png' })
console.log(errs.length ? 'CONSOLE ERRORS:\n' + errs.join('\n') : 'no console errors')
await b.close()
