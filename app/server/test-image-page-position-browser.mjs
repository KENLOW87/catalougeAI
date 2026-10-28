import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { mkdir, writeFile } from 'node:fs/promises'
const real = process.argv.includes('--real-text-ai')
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const evidence = { realTextAI: real, interpretations: [], steps: [] }
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1450, height: 1050 })
  page.on('pageerror', error => { evidence.pageError = error.message; console.log('BROWSER ERROR: ' + error.stack) })
  let forbidden = 0
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (!real && /\/api\/interpret$/.test(request.url())) {
      const headers = { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Activity-Job-ID,X-Activity-Origin' }
      if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers })
      return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ kind: 'display_intent', text: JSON.stringify({ operation: 'page', source: { pageId: 'manual-page' }, pagePosition: 6 }) }) })
    }
    if (/\/api\/(?:export|image\/edit|ingest)(?:\?|$)/.test(request.url()) || /^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(request.url())) { forbidden++; return request.abort() }
    request.continue()
  })
  page.on('response', async response => {
    if (/\/api\/interpret$/.test(response.url()) && response.request().method() === 'POST') {
      const result = await response.json(); evidence.interpretations.push(result); console.log(JSON.stringify({ realTextAI: real, result }))
    }
  })
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 140; c.height = 200; const ctx = c.getContext('2d'); ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, 140, 200); return c.toDataURL() })
  const plate = i => ({ id: `original-page-${i}`, isPage: true, name: `Source ${i}`, image })
  const cards = ['WB01', 'WB02', 'WB05', 'WB06', 'WB07', 'WB08'].map((name, i) => ({ id: `wb-${i}`, name, photo: image, layoutRowGroup: 'source-wb', ...(i === 0 ? { supportStrip: '/assets/reviewed/wb01-support-strip.png' } : {}) }))
  const base = [plate(1), plate(2), ...cards, ...Array.from({ length: 7 }, (_, i) => plate(i + 3))]
  const products = [...base, { id: 'manual-page', isPage: true, origin: 'manual-image-page', name: 'Display image', image, createdAt: Date.now() }]
  await page.evaluate(async products => {
    await (await import('/src/lib/store.js')).saveCatalogue('wainscoting-mirror', products)
    localStorage.setItem('geometra.activeCategory', 'wainscoting-mirror'); sessionStorage.setItem('geometra.view', 'catalogue')
  }, products)
  await page.reload({ waitUntil: 'networkidle0' }); await page.click('[aria-label="Catalogue assistant"]')
  console.log('Position test: actual catalogue and chatbot loaded')
  const ask = async text => {
    await page.type('.bot-dock input[placeholder]', text); await page.click('.bot-dock button[type="submit"]')
    await page.waitForSelector('.proposal-acts .primary:not(:disabled)', { timeout: 60000 })
    const reply = await page.$$eval('.bot-msg--bot', nodes => nodes.at(-1).textContent); evidence.steps.push({ text, reply }); console.log(JSON.stringify({ text, reply }))
  }
  const read = () => page.evaluate(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'])
  const layout = products => page.evaluate(async products => {
    const category = (await import('/src/lib/categories/default.js')).defaultCategoryFor({ id: 'wainscoting-mirror' })
    return category.paginate(products).map(p => ({ id: p.plate?.id, rows: p.rows.map(row => ({ ids: row.map(p => p.id), sourceGroup: row.sourceGroup, sourceGroupBundle: row.sourceGroupBundle, supportIds: row.supportFor?.map(p => p.id) })) }))
  }, products)
  const originalLayout = await layout(base)
  assert.equal(originalLayout.length, 10)
  await ask('gambar tadi tu jadikan page 7, bukan page paling belakang')
  assert.match(await page.$eval('.proposal-acts', el => el.closest('.proposal').textContent), /halaman 7/)
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'].some(p => p.id === 'manual-page' && p.pagePosition === 7))
  await page.reload({ waitUntil: 'networkidle0' })
  let saved = await read(), pages = await layout(saved)
  assert.equal(pages.length, 11); assert.equal(pages[6].id, 'manual-page')
  assert.deepEqual(pages.filter(p => p.id !== 'manual-page'), originalLayout, 'Every existing source page and row retains its original contents and geometry grouping')
  await page.click('[aria-label="Catalogue assistant"]')
  await ask('Saya mahu helaian yang tadi muncul sesudah helaian kelima; bahagian produk semua kekalkan.')
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'].some(p => p.id === 'manual-page' && p.pagePosition === 6))
  await page.reload({ waitUntil: 'networkidle0' })
  saved = await read(); pages = await layout(saved)
  assert.equal(pages.length, 11); assert.equal(pages[5].id, 'manual-page')
  assert.deepEqual(pages.filter(p => p.id !== 'manual-page'), originalLayout)
  assert.equal(saved.filter(p => p.origin === 'manual-image-page').length, 1)
  assert.ok(cards.every(card => saved.some(p => JSON.stringify(p) === JSON.stringify(card))))
  // A fresh attachment also honours its requested middle position rather than
  // merely supporting repositioning an existing image page.
  await page.click('[aria-label="Catalogue assistant"]')
  await mkdir('.tmp/audit', { recursive: true })
  await writeFile('.tmp/audit/page-position-new-upload.png', Buffer.from(image.split(',')[1], 'base64'))
  await (await page.$('.bot-photo-input')).uploadFile('.tmp/audit/page-position-new-upload.png')
  await page.waitForSelector('.bot-attachment img')
  await ask('jadikan gambar ini page baru pada halaman 3')
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'].filter(p => p.origin === 'manual-image-page').length === 2)
  await page.reload({ waitUntil: 'networkidle0' })
  saved = await read(); pages = await layout(saved)
  const newPage = saved.find(p => p.origin === 'manual-image-page' && p.id !== 'manual-page')
  assert.equal(pages.length, 12)
  assert.equal(pages[2].id, newPage.id)
  assert.equal(pages[6].id, 'manual-page', 'The prior image page shifts one place when a page is inserted before it')
  assert.deepEqual(pages.filter(p => ![newPage.id, 'manual-page'].includes(p.id)), originalLayout)
  assert.equal(newPage.image, image)
  assert.equal(forbidden, 0); assert.equal(evidence.interpretations.length, 3)
  await mkdir('.tmp/audit', { recursive: true }); await page.screenshot({ path: '.tmp/audit/image-page-exact-position.png' })
  evidence.passed = true
  console.log('Actual chatbot: existing tail image page moves to exact page 7, then relative-language request places it after page 5. Apply/reload preserves one image page, 11 total pages and every original source page/row. No image editing or PDF export.')
} catch (error) { evidence.error = error.message; evidence.passed = false; throw error }
finally { await mkdir('.tmp/audit', { recursive: true }); await writeFile(`.tmp/audit/image-page-position-${real?'live':'mock'}-evidence.json`, JSON.stringify(evidence, null, 2)); await browser.close() }
