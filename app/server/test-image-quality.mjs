import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
  const result = await page.evaluate(async () => {
    const { assessBackgroundRemoval } = await import('/src/lib/image-quality.js')
    const picture = (paint, width = 240, height = 160) => {
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      paint(canvas.getContext('2d'), width, height)
      return canvas.toDataURL('image/png')
    }
    const original = picture((context, width, height) => {
      context.fillStyle = '#fff'; context.fillRect(0, 0, width, height)
      context.fillStyle = '#c8c8c8'; context.fillRect(35, 62, 170, 38)
    })
    const complete = picture(context => {
      context.fillStyle = '#c8c8c8'; context.fillRect(35, 62, 170, 38)
    })
    const whiteProduct = picture(context => {
      context.fillStyle = '#f8f8f8'; context.fillRect(35, 62, 170, 38)
    })
    const empty = picture(() => {})
    const fragments = picture(context => {
      context.fillStyle = '#666'
      for (let y = 20; y < 140; y += 28) for (let x = 20; x < 220; x += 35) context.fillRect(x, y, 3, 3)
    })
    return {
      complete: await assessBackgroundRemoval(original, complete),
      whiteProduct: await assessBackgroundRemoval(original, whiteProduct),
      empty: await assessBackgroundRemoval(original, empty),
      fragments: await assessBackgroundRemoval(original, fragments),
    }
  })
  assert.equal(result.complete.accepted, true)
  assert.equal(result.complete.needsReview, false)
  assert.equal(result.whiteProduct.displayBackground, 'dark-neutral')
  assert.equal(result.empty.accepted, false)
  assert.ok(result.empty.findings.some(finding => finding.code === 'empty-cutout'))
  assert.equal(result.fragments.needsReview, true)
  assert.ok(result.fragments.findings.some(finding => finding.code === 'fragmented-cutout'))
  console.log('Image quality gate: complete cutout accepted, white product receives display contrast, empty cutout rejected and fragmented output routed to review; local browser only, no model/API/export.')
} finally {
  await browser.close()
}
