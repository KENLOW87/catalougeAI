import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { PNG } from 'pngjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { mockKnownCommandInterpret } from './mock-command-interpret.mjs'

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 1000 })
  let forbidden = 0
  await page.setRequestInterception(true)
  page.on('request', async request => {
    if (await mockKnownCommandInterpret(request)) return
    if (/\/api\/(?:export|interpret|image\/edit|ingest)(?:\?|$)/.test(request.url()) || /^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(request.url())) {
      forbidden++; return request.abort()
    }
    request.continue()
  })
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
  const photo = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 100; c.height = 160
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ddd'; ctx.fillRect(10, 5, 80, 150)
    return c.toDataURL()
  })
  const products = [{ id: 'display-test-7', name: 'WB07 (Bare Finish)', photo }, { id: 'display-test-8', name: 'WB08', photo }]
  await page.evaluate(async products => {
    const { saveCatalogue } = await import('/src/lib/store.js')
    await saveCatalogue('wainscoting-mirror', products)
    localStorage.setItem('geometra.activeCategory', 'wainscoting-mirror')
    sessionStorage.setItem('geometra.view', 'catalogue')
  }, products)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.click('[aria-label="Catalogue assistant"]')
  const display = new PNG({ width: 180, height: 100 })
  for (let y = 0; y < 100; y++) for (let x = 0; x < 180; x++) display.data.set([x, y, 90, 255], (y * 180 + x) * 4)
  await mkdir('.tmp/audit', { recursive: true })
  const file = '.tmp/audit/manual-display-test.png'
  const bytes = PNG.sync.write(display)
  const original = `data:image/png;base64,${bytes.toString('base64')}`
  await writeFile(file, bytes)
  const upload = async () => { const input = await page.$('.bot-photo-input'); await input.uploadFile(file) }
  const read = () => page.evaluate(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'])
  await upload()
  await page.waitForSelector('.bot-attachment img')
  assert.equal(await page.$eval('.bot-attachment img', img => img.src), original)
  assert.equal(forbidden, 0, 'Upload alone must not call image AI or interpretation')
  await page.type('.bot-dock input[placeholder]', 'Tambah gambar display untuk WB07. Letak sebelah produk, jangan buang background.')
  await page.click('.bot-dock button[type="submit"]')
  await page.waitForSelector('.proposal-acts .primary')
  assert.equal(await page.$eval('.proposal img', img => img.src), original)
  assert.equal((await read())[0].examples, undefined, 'Preview must not save before Apply')
  // Cancel keeps catalogue and original attachment available for another instruction.
  await page.click('.proposal-acts button:last-child')
  assert.equal((await read())[0].examples, undefined)
  await page.type('.bot-dock input[placeholder]', 'Add this as a display image for WB07')
  await page.click('.bot-dock button[type="submit"]')
  await page.waitForSelector('.proposal-acts .primary')
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'][0].examples?.length === 1)
  const saved = await read()
  assert.equal(saved[0].photo, photo)
  assert.equal(saved[0].examples[0].image, original)
  assert.equal(saved[0].examples[0].ownerProductId, products[0].id)
  assert.equal(saved[0].examples[0].photoTreatmentMode, 'preserve-scene')
  assert.equal(saved[1].examples, undefined)
  assert.equal(await page.$('.bot-attachment'), null)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('#product-display-test-7 .dp-examples img')
  await page.waitForFunction(() => !document.querySelector('[data-examples-pending="true"]'))
  const placement = await page.$eval('#product-display-test-7', el => {
    const main = el.querySelector('.dp-photo img').getBoundingClientRect()
    const display = el.querySelector('.dp-examples img').getBoundingClientRect()
    return { beside: display.left >= main.right - 1, src: el.querySelector('.dp-examples img').src }
  })
  assert.equal(placement.beside, true)
  assert.equal(placement.src, original)
  assert.equal((await read())[0].examples[0].image, original)
  // Source WB groups keep four cards and their original strip. A new display
  // must remain visible in the support band rather than disappear behind it.
  const sourceGroup = ['WB01', 'WB02', 'WB05', 'WB06'].map((name, i) => ({
    id: `source-${i}`, name, photo, layoutRowGroup: 'source-wb',
    ...(i === 0 ? { supportStrip: '/assets/reviewed/wb01-support-strip.png', examples: [{ image: original, role: 'usage', origin: 'manual-display' }] } : {}),
    ...(i === 3 ? { supportStrip: '/assets/reviewed/wb06-corner-installation-strip.png' } : {}),
  }))
  await page.evaluateOnNewDocument(products => { window.__CATALOGUE_CATEGORY__ = 'wainscoting-mirror'; window.__CATALOGUE_DATA__ = products }, sourceGroup)
  await page.goto('http://localhost:5173/?print=1', { waitUntil: 'networkidle0' })
  const band = await page.evaluate(() => {
    const entry = document.querySelector('[data-support-owner="WB01"]')
    const image = entry.querySelector('.dp-source-support-gallery img')
    const r = image.getBoundingClientRect(), e = entry.getBoundingClientRect()
    const cards = [...document.querySelectorAll('.dp-item')].map(el => el.getBoundingClientRect().top)
    return { width: r.width, height: r.height, contained: r.top >= e.top && r.bottom <= e.bottom + 1,
      originalStrips: document.querySelectorAll('.dp-source-support-strip').length,
      fourAcross: cards.length === 4 && cards.every(top => Math.abs(top - cards[0]) < 1), pages: document.querySelectorAll('.cat-page').length }
  })
  assert.ok(band.width > 100 && band.height > 50, JSON.stringify(band))
  assert.equal(band.contained, true, JSON.stringify(band))
  assert.equal(band.originalStrips, 2)
  assert.equal(band.fourAcross, true)
  assert.equal(band.pages, 1)
  // Exercise a natural series request through the real chat, then reload.
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
  const cleanGroup = sourceGroup.map(({ examples, ...p }) => p)
  await page.evaluate(async products => {
    await (await import('/src/lib/store.js')).saveCatalogue('wainscoting-mirror', products)
    sessionStorage.setItem('geometra.view', 'catalogue')
  }, cleanGroup)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.click('[aria-label="Catalogue assistant"]')
  await upload()
  await page.waitForSelector('.bot-attachment img')
  await page.type('.bot-dock input[placeholder]', 'product WB series')
  await page.click('.bot-dock button[type="submit"]')
  await page.waitForSelector('.proposal-acts .primary')
  assert.match(await page.$eval('.proposal', el => el.textContent), /WB01, WB02, WB05, WB06/)
  assert.ok((await read()).every(p => !p.examples), 'Series matching must wait for Apply')
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'].some(p => p.examples?.some(e => e.displayScope === 'series')))
  await page.reload({ waitUntil: 'networkidle0' })
  const seriesSaved = await read()
  assert.equal(seriesSaved.reduce((n, p) => n + (p.examples?.length ?? 0), 0), 1)
  assert.equal(seriesSaved[3].examples[0].displaySeries, 'WB')
  assert.ok(seriesSaved.every(p => p.layoutRowGroup === 'source-wb'))
  const shared = await page.evaluate(original => {
    const cards = [...document.querySelectorAll('.dp-item')].map(el => el.getBoundingClientRect())
    const images = [...document.querySelectorAll('.dp-source-support-gallery img')].filter(img => img.src === original)
    return { count: images.length, fourAcross: cards.length === 4 && cards.every(r => Math.abs(r.top - cards[0].top) < 1),
      below: images.length === 1 && images[0].getBoundingClientRect().top >= Math.max(...cards.map(r => r.bottom)),
      strips: document.querySelectorAll('.dp-source-support-strip').length }
  }, original)
  assert.deepEqual(shared, { count: 1, fourAcross: true, below: true, strips: 2 })
  // The exact screenshot wording must find the saved recent display after reload.
  await page.click('[aria-label="Catalogue assistant"]')
  const askRemove = async (text = 'tolong buang gambar display yang baru je saya masukkan tadi .') => {
    await page.type('.bot-dock input[placeholder]', text)
    await page.click('.bot-dock button[type="submit"]')
    await page.waitForSelector('.proposal-acts .primary')
  }
  await askRemove('nak buang gambar nya')
  assert.equal(await page.$eval('.proposal img', img => img.src), original)
  assert.equal((await read())[3].examples.length, 1, 'Removal preview waits for Apply')
  await page.click('.proposal-acts button:last-child')
  assert.equal((await read())[3].examples.length, 1, 'Cancel leaves the display untouched')
  await askRemove()
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(async () => !(await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'].some(p => p.examples?.some(e => e.origin === 'manual-display')))
  await page.reload({ waitUntil: 'networkidle0' })
  const afterRemove = await read()
  assert.equal(afterRemove.length, 4)
  assert.ok(afterRemove.every(p => p.photo === photo && p.layoutRowGroup === 'source-wb'))
  assert.equal(afterRemove[0].supportStrip, cleanGroup[0].supportStrip)
  assert.equal(afterRemove[3].supportStrip, cleanGroup[3].supportStrip)
  assert.equal(await page.$$('.dp-source-support-strip').then(elements => elements.length), 2)
  assert.equal(forbidden, 0)
  console.log('Actual isolated browser: upload, product/series display placement, exact screenshot removal wording after reload, preview/cancel/Apply and saved deletion. All four products, source rows and both original strips preserved. Zero AI requests or PDF exports.')
} finally { await browser.close() }
