import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { mockKnownCommandInterpret } from './mock-command-interpret.mjs'
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 1050 })
  let forbidden = 0
  await page.setRequestInterception(true)
  page.on('request', async request => {
    if (await mockKnownCommandInterpret(request)) return
    if (/\/api\/(?:export|interpret|image\/edit|ingest)(?:\?|$)/.test(request.url()) || /^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(request.url())) { forbidden++; return request.abort() }
    request.continue()
  })
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 240
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e7d4a1'; ctx.fillRect(0, 0, 180, 240)
    ctx.fillStyle = '#b02020'; ctx.fillRect(0, 0, 180, 4); ctx.fillRect(0, 236, 180, 4)
    return canvas.toDataURL()
  })
  const products = ['WB01', 'WB02', 'WB05', 'WB06', 'WB07', 'WB08'].map((name, i) => ({ id: `p${i}`, name, photo: image, layoutRowGroup: 'source-wb',
    ...(i === 0 ? { supportStrip: '/assets/reviewed/wb01-support-strip.png' } : {}),
    ...(i === 3 ? { supportStrip: '/assets/reviewed/wb06-corner-installation-strip.png', examples: [{ image, origin: 'manual-display', displayId: 'new-display', addedAt: 200, displaySeries: 'WB' }] } : {}) }))
  await page.evaluate(async products => {
    await (await import('/src/lib/store.js')).saveCatalogue('wainscoting-mirror', products)
    localStorage.setItem('geometra.activeCategory', 'wainscoting-mirror'); sessionStorage.setItem('geometra.view', 'catalogue')
  }, products)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.click('[aria-label="Catalogue assistant"]')
  await page.type('.bot-dock input[placeholder]', 'saya nak this whole image jadi newpage dalam catalouge ni')
  await page.click('.bot-dock button[type="submit"]')
  await page.waitForSelector('.proposal-acts .primary')
  assert.match(await page.$eval('.proposal', el => el.textContent), /bertambah satu/)
  const read = () => page.evaluate(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'])
  assert.equal((await read()).length, 6, 'Preview cannot create a page before Apply')
  await page.click('.proposal-acts .primary')
  await page.waitForSelector('.cat-page--plate > img')
  await page.waitForFunction(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'].some(p => p.isPage))
  const saved = await read()
  assert.equal(saved.length, 7)
  assert.ok(saved[6].isPage)
  assert.equal(saved[6].image, image)
  assert.equal(saved[3].examples.length, 0)
  assert.ok(saved.slice(0, 6).every((p, i) => p.name === products[i].name && p.photo === image && p.layoutRowGroup === 'source-wb'))
  const full = await page.$eval('.cat-page--plate > img', el => ({ src: el.src, fit: getComputedStyle(el).objectFit }))
  assert.deepEqual(full, { src: image, fit: 'contain' })
  assert.equal(await page.$('.bot-dock'), null, 'Apply reveals the complete new page')
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.cat-page--plate > img')
  assert.equal(await page.$eval('.cat-page--plate > img', el => el.src), image)
  const pages = await page.evaluate(async products => (await import('/src/lib/categories/default.js')).defaultCategoryFor({ id: 'wainscoting-mirror' }).paginate(products).length, saved)
  assert.equal(pages, 2, 'One existing catalogue page plus exactly one full-image page')
  assert.equal(forbidden, 0)
  console.log('Actual browser: full-image new-page request, preview/Apply, exact original bytes, no duplicated display, six WB products and source strips retained, automatic page reveal and reload; exactly one additional page. No AI requests or PDF export.')
} finally { await browser.close() }
