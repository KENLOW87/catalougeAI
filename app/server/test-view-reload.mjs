import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
  await page.waitForSelector('.dashboard')
  await page.click('.dashboard-card-actions .primary')
  await page.waitForFunction(() => sessionStorage.getItem('geometra.view') === 'catalogue')
  const category = await page.evaluate(() => localStorage.getItem('geometra.activeCategory'))
  await page.reload({ waitUntil: 'networkidle0' })
  assert.equal(await page.$('.dashboard'), null)
  assert.equal(await page.evaluate(() => localStorage.getItem('geometra.activeCategory')), category)
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Dashboard').click())
  await page.waitForFunction(() => sessionStorage.getItem('geometra.view') === 'dashboard')
  await page.reload({ waitUntil: 'networkidle0' })
  assert.ok(await page.$('.dashboard'))
  console.log('Reload preserves catalogue/category and dashboard selection.')
} finally { await browser.close() }
