// Explicit opt-in only: exercises the running chatbot with REAL text AI.
// Never include this script in the ordinary free/mock regression suite.
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
if (!process.argv.includes('--real-text-ai')) throw new Error('Requires explicit --real-text-ai authorization; invokes live text interpretation')
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const evidence = { realTextInterpretations: [], forbiddenRequests: [], steps: [] }
const broad = process.argv.includes('--capabilities')
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1450, height: 1050 })
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (/\/api\/(?:export|image\/edit|ingest)(?:\?|$)/.test(request.url()) || /^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(request.url())) {
      evidence.forbiddenRequests.push(request.url()); return request.abort()
    }
    request.continue()
  })
  page.on('response', async response => {
    if (/\/api\/interpret$/.test(response.url()) && response.request().method() === 'POST') {
      try {
        const body = await response.json()
        const request = JSON.parse(response.request().postData())
        evidence.realTextInterpretations.push({ request: request.text, status: response.status(), response: body, historyLength: request.conversation?.length })
        console.log(JSON.stringify({ liveAI: request.text, response: body }))
      } catch (error) { console.log('Interpretation response unavailable: ' + error.message) }
    }
  })
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 240
    const ctx = c.getContext('2d'); ctx.fillStyle = '#d8c79a'; ctx.fillRect(0, 0, 160, 240)
    ctx.fillStyle = '#333'; ctx.font = '16px sans-serif'; ctx.fillText('TEST DISPLAY', 12, 40)
    return c.toDataURL()
  })
  const products = ['WB01', 'WB02', 'WB05', 'WB06', 'WB07 (Bare Finish)', 'WB08 (Bare Finish)'].map((name, i) => ({
    id: `live-wb-${i}`, name, photo: image, layoutRowGroup: 'approved-wb',
    ...(i === 0 ? { supportStrip: '/assets/reviewed/wb01-support-strip.png' } : {}),
    ...(i === 3 ? { supportStrip: '/assets/reviewed/wb06-corner-installation-strip.png' } : {}),
  }))
  await page.evaluate(async products => {
    await (await import('/src/lib/store.js')).saveCatalogue('wainscoting-mirror', products)
    localStorage.setItem('geometra.activeCategory', 'wainscoting-mirror'); sessionStorage.setItem('geometra.view', 'catalogue')
  }, products)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.click('[aria-label="Catalogue assistant"]')
  const png = new PNG({ width: 100, height: 180 }); png.data.fill(180)
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255
  await mkdir('.tmp/audit', { recursive: true }); await writeFile('.tmp/audit/live-bot-display.png', PNG.sync.write(png))
  await (await page.$('.bot-photo-input')).uploadFile('.tmp/audit/live-bot-display.png')
  await page.waitForSelector('.bot-attachment img')
  const ask = async text => {
    const count = await page.$$('.bot-msg--bot').then(nodes => nodes.length)
    await page.type('.bot-dock input[placeholder]', text)
    await page.click('.bot-dock button[type="submit"]')
    await page.waitForFunction(count => document.querySelector('.modal') || (document.querySelectorAll('.bot-msg--bot').length > count &&
      document.querySelector('.bot-ask')?.getAttribute('aria-busy') !== 'true' && !document.querySelector('.bot-thinking')), { timeout: 60000 }, count)
    assert.equal(await page.$('.modal'), null, 'A display conversation must not open the product-creation dialog')
    const reply = await page.$$eval('.bot-msg--bot', nodes => nodes.at(-1).textContent)
    evidence.steps.push({ instruction: text, reply })
    console.log(JSON.stringify({ instruction: text, reply }))
  }
  const read = () => page.evaluate(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'])
  await ask('Gambar ni untuk WB series')
  await page.waitForSelector('.proposal-acts .primary')
  await ask(broad ? 'Tambah gambar display ini untuk WB08 tapi WB07 jangan usik' : 'yang keluarga sama macam tadi, bukan untuk satu kod sahaja ya')
  await page.waitForSelector('.proposal-acts .primary', { timeout: 10000 })
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'].some(p => p.examples?.some(e => e.origin === 'manual-display')))
  const beforeRemoval = await read()
  assert.equal(beforeRemoval.flatMap(p => p.examples ?? []).filter(e => e.origin === 'manual-display').length, 1)
  if (broad) {
    assert.equal(beforeRemoval[5].examples.length, 1)
    assert.equal(beforeRemoval[4].examples, undefined, 'WB07 is explicitly excluded')
    await ask('boleh panggil produk WB08 tu sebagai WB08 DEMO selepas ni')
    await page.waitForSelector('.proposal-acts .primary')
    await page.click('.proposal-acts .primary')
    await page.waitForFunction(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'].some(p => p.name === 'WB08 DEMO'))
  }
  await ask('yang aku masukkan tadi tu tak payah simpan, keluarkan semula')
  await page.waitForSelector('.proposal-acts .primary', { timeout: 10000 })
  const text = await page.$eval('.proposal-acts', el => el.closest('.proposal').textContent)
  assert.match(text, /buang|remove|padam/i)
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(async () => !(await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'].some(p => p.examples?.some(e => e.origin === 'manual-display')))
  await page.reload({ waitUntil: 'networkidle0' })
  const final = await read()
  assert.equal(final.length, 6)
  assert.ok(final.every((p, i) => p.name === (broad && i === 5 ? 'WB08 DEMO' : products[i].name) && p.photo === image && p.layoutRowGroup === 'approved-wb'))
  assert.equal(final[0].supportStrip, products[0].supportStrip); assert.equal(final[3].supportStrip, products[3].supportStrip)
  assert.equal(evidence.forbiddenRequests.length, 0)
  assert.ok(evidence.realTextInterpretations.length >= 2, 'Must exercise real AI, not merely local parsing')
  evidence.passed = true
  console.log('REAL chatbot text AI: contextual series add and natural follow-up removal passed through Apply/save/reload; six products and original source strips preserved, no image editing or PDF export.')
} catch (error) {
  evidence.passed = false; evidence.error = error.message
  throw error
} finally {
  await mkdir('.tmp/audit', { recursive: true }); await writeFile(`.tmp/audit/live-chatbot-${broad?'capabilities':'evidence'}.json`, JSON.stringify(evidence, null, 2))
  await browser.close()
}
