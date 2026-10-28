import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 100
    canvas.getContext('2d').fillRect(0, 0, 100, 100)
    window.__CATALOGUE_CATEGORY__ = 'wainscoting-mirror'
    window.__CATALOGUE_DATA__ = ['HM01 RIGHT', 'HM01 LEFT'].map((name, i) => ({ id: String(i), name, photo: canvas.toDataURL() }))
  })
  await page.goto('http://localhost:5173/?print=1', { waitUntil: 'networkidle0' })
  const sizes = await page.$$eval('.dp-photo', frames => frames.map(frame => {
    const image = frame.querySelector('img')
    const f = frame.getBoundingClientRect(), i = image.getBoundingClientRect()
    return { frame: f.width, image: i.width, fits: i.width <= f.width && i.height <= f.height, fit: getComputedStyle(image).objectFit }
  }))
  assert.equal(sizes.length, 2)
  for (const size of sizes) {
    assert.ok(size.frame > 300, JSON.stringify(size))
    assert.ok(size.image > 280)
    assert.ok(size.fits)
    assert.equal(size.fit, 'contain')
  }
  console.log('Two product photos expand across the row, fit their frames, and preserve aspect ratio.')
} finally { await browser.close() }
