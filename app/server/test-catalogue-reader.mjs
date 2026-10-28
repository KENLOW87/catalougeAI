import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try {
 const page=await browser.newPage()
 await page.setViewport({width:1440,height:900})
 await page.goto('http://localhost:5173',{waitUntil:'networkidle0'})
 const products=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=160;c.height=240
  c.getContext('2d').fillRect(0,0,160,240);const photo=c.toDataURL()
  const products=[{id:'cover',name:'Cover',isPage:true,image:photo},
   ...Array.from({length:24},(_,i)=>({id:`reader-${i}`,name:`Product ${i+1}`,photo})),
   {id:'last',name:'Last sheet',isPage:true,image:photo}]
  const {saveCatalogue}=await import('/src/lib/store.js')
  await saveCatalogue('wainscoting-mirror',products)
  localStorage.setItem('geometra.activeCategory','wainscoting-mirror')
  sessionStorage.setItem('geometra.view','catalogue');sessionStorage.removeItem('geometra.reader')
  return products
 })
 await page.reload({waitUntil:'networkidle0'})
 const visible=()=>page.$$eval('.cat-page',sheets=>sheets.map(p=>Number(p.getAttribute('data-page'))))
 const fitted=async()=>{
  await page.waitForFunction(()=>{
   const stage=document.querySelector('.reader-stage'),canvas=document.querySelector('main')
   if(!stage||!stage.classList.contains('reader-stage--fit'))return false
   const s=stage.getBoundingClientRect()
   return canvas.scrollHeight<=canvas.clientHeight+1&&stage.scrollHeight<=stage.clientHeight+1&&stage.scrollWidth<=stage.clientWidth+1&&
    [...document.querySelectorAll('.cat-page')].every(p=>{const r=p.getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom+1&&r.left>=s.left&&r.right<=s.right+1})
  })
 }
 await fitted();assert.deepEqual(await visible(),[1])
 await page.click('[aria-label="Next page"]');await fitted();assert.deepEqual(await visible(),[2,3])
 assert.equal(await page.$eval('.reader-page-count',e=>e.textContent),'2–3 / 5')
 const gap=await page.$$eval('.cat-page',p=>p[1].getBoundingClientRect().left-p[0].getBoundingClientRect().right)
 assert.ok(gap>0&&gap<20,'No transform-created space between the facing pages')
 await page.click('[aria-label="Next page"]');assert.deepEqual(await visible(),[4,5])
 assert.equal(await page.$eval('[aria-label="Next page"]',e=>e.disabled),true)
 await page.click('[aria-label="Previous page"]');assert.deepEqual(await visible(),[2,3])
 await page.click('[aria-label="First page"]');assert.deepEqual(await visible(),[1])
 await page.keyboard.press('ArrowRight');assert.deepEqual(await visible(),[2,3])
 await page.keyboard.press('ArrowLeft');assert.deepEqual(await visible(),[1])
 await page.select('[aria-label="Go to page"]','2');assert.deepEqual(await visible(),[2,3])
 await page.click('.reader-title')
 await page.keyboard.press('End');assert.deepEqual(await visible(),[4,5])
 await page.keyboard.press('Home');assert.deepEqual(await visible(),[1])
 await page.evaluate(()=>[...document.querySelectorAll('.list button.nm')].find(e=>e.textContent==='Product 17').click())
 await page.waitForSelector('#product-reader-16');assert.deepEqual(await visible(),[4,5])
 await page.click('.reader-modes button:first-child');assert.deepEqual(await visible(),[4])
 await page.reload({waitUntil:'networkidle0'});await fitted();assert.deepEqual(await visible(),[4])
 assert.equal(await page.$eval('.reader-modes button:first-child',e=>e.getAttribute('aria-pressed')),'true')
 await page.click('[aria-label="Zoom in"]')
 await page.waitForFunction(()=>!document.querySelector('.reader-stage--fit'))
 await page.evaluate(()=>[...document.querySelectorAll('.reader-toolbar button')].find(e=>e.textContent==='Fit to screen').click())
 await fitted()
 await page.click('[title="Hide sidebar"]')
 await page.setViewport({width:680,height:650});await fitted()
 assert.deepEqual(await visible(),[4])
 // The reader filters ONLY the screen. PDF output still contains all five sheets.
 const response=await fetch('http://localhost:5174/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:'wainscoting-mirror',products}),signal:AbortSignal.timeout(65000)})
 assert.ok(response.ok)
 const pdf=Buffer.from(await response.arrayBuffer())
 assert.equal([...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,5)
 console.log('Reader: fitted cover/spreads without scrolling or large gaps; next/previous, keyboard, jumps, sidebar reveal, single-page mode, reload, zoom/fit and smaller viewport work; PDF retains all five pages. No AI calls.')
}finally{await browser.close()}
