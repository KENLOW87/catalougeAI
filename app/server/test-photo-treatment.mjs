import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
  const result = await page.evaluate(async () => {
    const { finishProductPhoto } = await import('/src/lib/product-photo.js')
    const results = []
    for (const colour of ['#ffffff', '#222222', '#b02020']) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 120
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = colour
      ctx.fillRect(30, 20, 60, 80)
      const finished = await finishProductPhoto(canvas.toDataURL())
      const image = new Image()
      image.src = finished.dataUrl
      await image.decode()
      canvas.width = image.width; canvas.height = image.height
      ctx.drawImage(image, 0, 0)
      results.push({ light: finished.light, width: image.width, height: image.height, corner: [...ctx.getImageData(0, 0, 1, 1).data], centre: [...ctx.getImageData(20, 20, 1, 1).data] })
    }
    return results
  })
  assert.equal(result[0].light, true)
  assert.deepEqual(result[0].corner, [48, 52, 59, 255])
  assert.deepEqual(result[0].centre, [255, 255, 255, 255])
  for (const r of result.slice(1)) { assert.equal(r.light, false); assert.equal(r.corner[3], 0) }
  for (const r of result) { assert.equal(r.width, 76); assert.equal(r.height, 96) }
  const pose = await page.evaluate(async () => {
    const { finishProductPhoto } = await import('/src/lib/product-photo.js')
    const results = []
    for (const colour of ['#333333', '#f5f5f5']) {
      const canvas = document.createElement('canvas')
      canvas.width = 120; canvas.height = 160
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = colour
      for (let y = 25; y < 130; y++) ctx.fillRect(25 + Math.floor((y - 25) / 6), y, y < 55 ? 30 : 12, 1)
      const source = ctx.getImageData(0, 0, 120, 160).data
      const finished = await finishProductPhoto(canvas.toDataURL())
      const image = new Image()
      image.src = finished.dataUrl
      await image.decode()
      canvas.width = image.width; canvas.height = image.height
      ctx.drawImage(image, 0, 0)
      const output = ctx.getImageData(0, 0, image.width, image.height).data
      let mismatches = 0
      for (let y = 25; y < 130; y++) for (let x = 25; x <= 58; x++) {
        const i = (y * 120 + x) * 4
        if (!source[i + 3]) continue
        const j = ((y - 25 + 8) * image.width + x - 25 + 8) * 4
        for (let c = 0; c < 4; c++) if (source[i + c] !== output[j + c]) mismatches++
      }
      results.push({ width: image.width, height: image.height, mismatches })
    }
    return results
  })
  for (const r of pose) assert.deepEqual(r, { width: 50, height: 121, mismatches: 0 }, 'Leaning asymmetric products retain orientation and all product pixels')
  console.log('White products get dark contrast; dark/coloured products retain transparency; margins trimmed without changing product pixels.')
} finally { await browser.close() }
