import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { PNG } from 'pngjs'
import { mkdir, writeFile } from 'node:fs/promises'
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1400, height: 1050 })
  let interpretations = 0, forbidden = 0
  const payloads = []
  await page.setRequestInterception(true)
  page.on('request', request => {
    const headers = { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Activity-Job-ID,X-Activity-Origin' }
    if (/\/api\/(?:interpret|ai\/status)$/.test(request.url())) {
      if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers })
      if (/\/ai\/status$/.test(request.url())) return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ ready: true, openai: true }) })
      const payload = JSON.parse(request.postData()); payloads.push(payload); interpretations++
      assert.ok(!request.postData().includes('data:image'))
      let intent
      if (interpretations === 1) {
        assert.match(payload.localClarification, /siri/)
        assert.ok(payload.conversation.some(m => m.role === 'user' && /WB series/.test(m.text)))
        assert.ok(payload.conversation.some(m => m.proposal?.status === 'pending'))
        intent = { operation: 'add', target: { type: 'product', value: 'WB08' }, placement: { mode: 'beside-product', order: 'before' } }
      } else {
        assert.ok(payload.conversation.some(m => m.proposal?.status === 'completed'))
        const displayId = payload.displayInventory.flatMap(p => p.displays).find(e => e.id)?.id
        assert.ok(displayId)
        intent = { operation: 'page', source: { displayId } }
      }
      return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ kind: 'display_intent', text: JSON.stringify(intent) }) })
    }
    if (/\/api\/(?:export|image\/edit|ingest)(?:\?|$)/.test(request.url()) || /^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(request.url())) { forbidden++; return request.abort() }
    request.continue()
  })
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 120; c.height = 180; const ctx = c.getContext('2d'); ctx.fillStyle = '#aa8855'; ctx.fillRect(0, 0, 120, 180); return c.toDataURL() })
  const products = ['WB01', 'WB02', 'WB05', 'WB06', 'WB07 (Bare Finish)', 'WB08 (Bare Finish)'].map((name, i) => ({ id: `wb-${i}`, name, photo: image, layoutRowGroup: 'source-wb', ...(i === 0 ? { supportStrip: '/assets/reviewed/wb01-support-strip.png' } : {}) }))
  await page.evaluate(async products => {
    await (await import('/src/lib/store.js')).saveCatalogue('wainscoting-mirror', products)
    localStorage.setItem('geometra.activeCategory', 'wainscoting-mirror'); sessionStorage.setItem('geometra.view', 'catalogue')
  }, products)
  await page.reload({ waitUntil: 'networkidle0' }); await page.click('[aria-label="Catalogue assistant"]')
  const png = new PNG({ width: 100, height: 180 }); png.data.fill(180)
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255
  await mkdir('.tmp/audit', { recursive: true }); await writeFile('.tmp/audit/interpreter-display.png', PNG.sync.write(png))
  await (await page.$('.bot-photo-input')).uploadFile('.tmp/audit/interpreter-display.png')
  await page.waitForSelector('.bot-attachment img')
  const ask = async text => { await page.type('.bot-dock input[placeholder]', text); await page.click('.bot-dock button[type="submit"]'); await page.waitForSelector('.proposal-acts .primary') }
  await ask('Gambar ni untuk WB series')
  await ask('letak display ni dekat siri yang kita bincang tadi')
  await page.waitForFunction(() => [...document.querySelectorAll('.proposal')].some(el => /Di sebelah WB08/.test(el.textContent)))
  assert.equal(interpretations, 1, 'Local parser clarification must reach configured interpreter')
  await page.click('.proposal-acts .primary'); await page.waitForSelector('[data-display-anchor="wb-5"]')
  await ask('jadikan yang itu satu helaian tersendiri pula')
  await page.waitForFunction(() => [...document.querySelectorAll('.proposal')].some(el => /halaman baharu/.test(el.textContent)))
  await page.click('.proposal-acts .primary'); await page.waitForSelector('.cat-page--plate img')
  const read = () => page.evaluate(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'])
  await page.waitForFunction(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'].some(p => p.isPage))
  const saved = await read(); assert.equal(saved.length, 7); assert.equal(saved.filter(p => p.isPage).length, 1)
  assert.equal(saved[5].examples.length, 0)
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.cat-page--plate img')
  assert.equal((await read()).length, 7)
  assert.equal(interpretations, 2); assert.equal(forbidden, 0)
  console.log('Actual browser: local misunderstanding reaches mocked interpreter with conversation/pending plan; short WB08 alias becomes valid Apply action; next contextual request creates full-image page via same pipeline, saves and survives reload. Two mocked interpretations; no real AI/image calls or PDF exports.')
} finally { await browser.close() }
