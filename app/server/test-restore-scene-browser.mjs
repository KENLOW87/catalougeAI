import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true })
try {
  const page = await browser.newPage()
  await page.goto('http://localhost:5173',{waitUntil:'networkidle0'})
  const original = await page.evaluate(async()=>{
    const canvas=document.createElement('canvas')
    canvas.width=300;canvas.height=200
    const ctx=canvas.getContext('2d');ctx.fillStyle='#6a5544';ctx.fillRect(0,0,300,200)
    const original=canvas.toDataURL()
    canvas.width=100;canvas.height=200
    const edited=canvas.toDataURL()
    const {saveCatalogue}=await import('/src/lib/store.js')
    await saveCatalogue('wainscoting-mirror',[{id:'scene',name:'Installed mirror',photo:edited,photoOriginal:original}])
    localStorage.setItem('geometra.activeCategory','wainscoting-mirror')
    sessionStorage.setItem('geometra.view','catalogue')
    return original
  })
  await page.reload({waitUntil:'networkidle0'})
  await page.waitForSelector('#product-scene')
  await page.$eval('#product-scene .hit-edit',el=>el.click())
  await page.waitForSelector('.modal')
  await page.evaluate(()=>[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Restore original rectangular photo').click())
  await page.click('.modal-actions .primary')
  await page.waitForFunction(src=>document.querySelector('#product-scene .dp-photo img')?.src===src,{},original)
  await page.reload({waitUntil:'networkidle0'})
  assert.equal(await page.$eval('#product-scene .dp-photo img',img=>img.src),original)
  const dimensions=await page.$eval('#product-scene .dp-photo img',img=>({width:img.naturalWidth,height:img.naturalHeight,fit:getComputedStyle(img).objectFit}))
  assert.deepEqual(dimensions,{width:300,height:200,fit:'contain'})
  console.log('Browser: restore original rectangle, save, reload and full-aspect display passed in isolated test profile.')
} finally {await browser.close()}
