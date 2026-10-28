import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { PNG } from 'pngjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { mockKnownCommandInterpret } from './mock-command-interpret.mjs'

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1100 })
  let forbidden = 0, mockedInterpretations = 0, mockIntent = null
  await page.setRequestInterception(true)
  page.on('request', async request => {
    if (/\/api\/interpret$/.test(request.url()) && mockIntent) {
      const headers = { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Activity-Job-ID,X-Activity-Origin' }
      if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers })
      mockedInterpretations++
      assert.ok(!(request.postData() ?? '').includes('data:image'), 'Interpretation receives text/record metadata only')
      return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ kind: 'display_intent', text: JSON.stringify(mockIntent) }) })
    }
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
  const products = ['WB01', 'WB02', 'WB05', 'WB06', 'WB07 (Bare Finish)', 'WB08 (Bare Finish)'].map((name, i) => ({
    id: `wb-${i}`, name, photo, layoutRowGroup: 'approved-wb',
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
  await mkdir('.tmp/audit', { recursive: true })
  const file = '.tmp/audit/inline-display-fixture.png', bytes = PNG.sync.write(png)
  const original = `data:image/png;base64,${bytes.toString('base64')}`
  await writeFile(file, bytes)
  await (await page.$('.bot-photo-input')).uploadFile(file)
  await page.waitForSelector('.bot-attachment img')
  const ask = async text => {
    await page.type('.bot-dock input[placeholder]', text)
    await page.click('.bot-dock button[type="submit"]')
    await page.waitForSelector('.proposal-acts .primary')
  }
  const read = () => page.evaluate(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'])
  await ask('product WB series')
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'].some(p => p.examples?.some(e => e.origin === 'manual-display')))
  // Reproduce the user's actual sequence: the series display was already
  // applied in the lower band, then a short follow-up asks to put it by WB08.
  await page.reload({ waitUntil: 'networkidle0' })
  await page.click('[aria-label="Catalogue assistant"]')
  await ask('tambah kat sebelah wb08')
  assert.equal(await page.$('.modal'), null, 'The follow-up must not open Add product')
  assert.match(await page.$eval('.proposal-acts', el => el.closest('.proposal').textContent), /Pindahkan display/)
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(() => document.querySelector('[data-display-anchor="wb-5"]'))
  await ask('letak kan gamba display, bersebelahan wb08 tetapi selepas display image')
  await ask('letak kan gamba display, bersebelahan wb08 tetapi sebelum daripada display image')
  assert.equal(await page.$$('.proposal-acts').then(e => e.length), 1, 'A refined placement supersedes the earlier pending proposal')
  assert.match(await page.$eval('.proposal-acts', el => el.closest('.proposal').textContent), /sebelum display sedia ada/)
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'][5].examples?.[0]?.displayPlacement?.order === 'before')
  const saved = await read(), identity = saved[5].examples[0].displayId
  assert.equal(saved[5].examples[0].image, original)
  assert.equal(saved[5].examples[0].displayPlacement.order, 'before')
  assert.equal(saved.reduce((n, p) => n + (p.examples?.length ?? 0), 0), 1)
  const placement = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.dp-item')].map(el => el.getBoundingClientRect())
    const display = document.querySelector('[data-display-anchor="wb-5"]').getBoundingClientRect()
    const band = document.querySelector('.dp-source-support').getBoundingClientRect()
    const image = document.querySelector('[data-display-anchor="wb-5"] img')
    const imageRect = image.getBoundingClientRect()
    const scale = Math.min(imageRect.width / image.naturalWidth, imageRect.height / image.naturalHeight)
    return { fourAcross: cards.slice(0, 4).every(r => Math.abs(r.top - cards[0].top) < 1),
      beside: display.left >= cards[5].right - 1 && Math.abs(display.top - cards[5].top) < 1,
      before: display.bottom <= band.top + 1,
      readable: image.naturalHeight * scale > cards[5].height * .7,
      count: document.querySelectorAll('.dp-inline-display').length, strips: document.querySelectorAll('.dp-source-support-strip').length }
  })
  assert.deepEqual(placement, { fourAcross: true, beside: true, before: true, readable: true, count: 1, strips: 2 })
  await ask('pindahkan gambar display dari WB08 ke WB07, bersebelahan produk sebelum display lain')
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(async () => (await (await import('/src/lib/store.js')).loadAll()).byCategory['wainscoting-mirror'][4].examples?.length === 1)
  assert.equal((await read())[4].examples[0].displayId, identity)
  assert.equal((await read())[5].examples.length, 0)
  // A different wording may use the general text interpreter, but its output is
  // validated by the same planner. This response is mocked, never a paid call.
  mockIntent = { operation: 'move', target: { type: 'product', value: 'WB08 (Bare Finish)' }, source: {}, placement: { mode: 'beside-product', order: 'before' } }
  await ask('Please relocate the scene we discussed to the last bare finish item, ahead of the other references')
  await page.click('.proposal-acts .primary')
  await page.waitForFunction(() => document.querySelector('[data-display-anchor="wb-5"]'))
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-display-anchor="wb-5"]')
  const final = await read()
  assert.equal(final[5].examples[0].displayId, identity)
  assert.equal(final[5].examples[0].image, original)
  assert.ok(final.every((p, i) => p.name === products[i].name && p.photo === photo && p.layoutRowGroup === 'approved-wb'))
  const pages = await page.evaluate(async products => {
    const { defaultCategoryFor } = await import('/src/lib/categories/default.js')
    return defaultCategoryFor({ id: 'wainscoting-mirror', title: 'Test' }).paginate(products).length
  }, final)
  assert.equal(pages, 1)
  assert.equal(mockedInterpretations, 1)
  assert.equal(forbidden, 0)
  await page.screenshot({ path: '.tmp/audit/display-placement-wb08.png' })
  console.log('Actual browser: exact screenshot instruction, pending-plan refinement, display beside WB08 before source bands, move WB08→WB07→WB08, structured AI response mocked, Apply/save/reload; six products/four-column source rows/two strips/one page unchanged. No paid API calls or PDF exports.')
} finally { await browser.close() }
