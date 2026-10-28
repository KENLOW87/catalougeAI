import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import puppeteer from 'puppeteer-core'
import { readImage, crop, toBuffer } from './imageops.mjs'
const source = readImage('C:/Users/admin/AppData/Local/Temp/codex-clipboard-f8748af0-97c7-4626-8d14-507402f25be1.png')
const live = JSON.parse(await readFile('../.tmp/layout-reader-live.json', 'utf8'))
const cut = b => `data:image/png;base64,${toBuffer(crop(source, Math.round(b.x * source.width), Math.round(b.y * source.height), Math.round(b.w * source.width), Math.round(b.h * source.height))).toString('base64')}`
const pixels = (x,y,w,h) => cut({ x:x/source.width, y:y/source.height, w:w/source.width, h:h/source.height })
const mirrors = live.examples.map((p,i) => ({ id: `mirror-${i}`, name:p.name, subtitle:'300mm x 300mm',
  photo: i === 0 ? pixels(44,82,101,113) : pixels(37,478,104,166),
  drawing: i === 0 ? pixels(170,81,99,104) : pixels(170,418,99,107),
  examples:p.examples.map(e=>({ image:cut(e.box),caption:e.caption })),
}))
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width:1000,height:1400 })
  await page.evaluateOnNewDocument(data => {
    window.__CATALOGUE_CATEGORY__='wainscoting-mirror'
    window.__CATALOGUE_DATA__=data
  }, mirrors)
  await page.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
  await page.waitForFunction(()=>!document.querySelector('[data-examples-pending="true"]'))
  assert.equal(await page.$$eval('.dp-item',els=>els.length),2)
  assert.equal(await page.$$eval('.dp-examples-grid img',els=>els.length),7)
  const exampleSizes = await page.$$eval('.dp-examples-grid img',images=>images.map(image=>{
    const r=image.getBoundingClientRect()
    return { width:r.width,height:r.height,fit:getComputedStyle(image).objectFit }
  }))
  for (const size of exampleSizes) {
    assert.ok(Math.abs(size.width-exampleSizes[0].width)<.1)
    assert.ok(Math.abs(size.height-exampleSizes[0].height)<.1)
    assert.equal(size.fit,'contain')
  }
  const mainSizes = await page.$$eval('.dp-photo img',images=>images.map(image=>{
    const r=image.getBoundingClientRect()
    return {width:r.width,height:r.height,fit:getComputedStyle(image).objectFit}
  }))
  for (const size of mainSizes) {
    assert.ok(Math.abs(size.width-exampleSizes[0].width)<.1,'Main and example photos use the same moderate width')
    assert.ok(Math.abs(size.height-exampleSizes[0].height)<.1,'Main and example photos use the same moderate height')
    assert.equal(size.fit,'contain')
  }
  const exampleColumns = await page.$$eval('.dp-examples-grid',grids=>grids.map(grid=>getComputedStyle(grid).gridTemplateColumns.split(' ').length))
  assert.deepEqual(exampleColumns,[4,3],'Restore the approved four/three-column horizontal galleries')
  const galleryPositions=await page.$$eval('.dp-examples-grid',grids=>grids.map(grid=>[...grid.querySelectorAll('img')].map(img=>img.getBoundingClientRect().top)))
  assert.ok(galleryPositions.every(positions=>positions.every(top=>Math.abs(top-positions[0])<.1)))
  assert.equal(await page.$$eval('.cat-page',pages=>pages.length),1,'Both products stay together on the original one-page layout')
  const pagination=await page.evaluate(async()=>{
    const {defaultCategoryFor}=await import('/src/lib/categories/default.js')
    const category=defaultCategoryFor({id:'test',title:'Test'})
    return category.paginate([{id:'gallery',name:'Gallery',photo:'p',examples:Array.from({length:8},()=>({image:'e'}))},
      {id:'original-page',isPage:true,image:'page'},{id:'next-product',name:'Next',photo:'p'}])
  })
  assert.equal(pagination.flatMap(p=>p.rows).flat().filter(p=>p.id==='gallery').reduce((n,p)=>n+p.examples.length,0),8)
  assert.equal(pagination.filter(p=>p.plate).length,1)
  assert.equal(pagination.length,3,'No extra gallery or continuation pages')
  assert.equal(pagination.flatMap(p=>p.rows).flat().filter(p=>p.id==='gallery').length,1)
  assert.equal(pagination.flatMap(p=>p.rows).flat().find(p=>p.id==='next-product').slot,2)
  const bounds = await page.$$eval('.dp-item',items=>items.map(item=>{
    const b=item.getBoundingClientRect()
    return [...item.querySelectorAll('img,.dp-name,.dp-sub')].every(el=>{
      const r=el.getBoundingClientRect()
      return r.top>=b.top-1 && r.bottom<=b.bottom+1 && r.left>=b.left-1 && r.right<=b.right+1
    })
  }))
  assert.ok(bounds.every(Boolean),'Images and captions must stay within their own product row')
  await page.screenshot({path:'../.tmp/product-example-layout.png',fullPage:true})
  const response = await fetch('http://localhost:5174/api/export',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({category:'wainscoting-mirror',products:mirrors}),signal:AbortSignal.timeout(65_000),
  })
  assert.ok(response.ok,'Actual PDF export must succeed')
  await writeFile('../.tmp/uniform-product-photos.pdf',Buffer.from(await response.arrayBuffer()))
  await promisify(execFile)('pdftohtml',['-xml','-zoom','1','../.tmp/uniform-product-photos.pdf','../.tmp/uniform-product-photos.xml'])
  const xml = await readFile('../.tmp/uniform-product-photos.xml','utf8')
  const pdfImages = [...xml.matchAll(/<image\b[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/g)].map(m=>({width:Number(m[1]),height:Number(m[2])}))
  assert.equal([...xml.matchAll(/<page\s/g)].length,1,'Actual exported PDF must retain ONE page')
  const photoPrintSize = 32 * 72 / 25.4
  assert.equal(pdfImages.filter(i=>Math.abs(Math.max(i.width,i.height)-photoPrintSize)<2).length,9,
    `Actual PDF must contain nine equally sized main/example photos: ${JSON.stringify(pdfImages)}`)
  await page.evaluate(data => {
    window.__CATALOGUE_DATA__=[{ id:'measurement',name:'Product',photo:data, drawing:data,dimensionText:'172mm x 172mm x 35mm(T)',drawingPresentation:'dimensions' }]
  },mirrors[0].photo)
  // Separate page with measured-photo presentation: no duplicate drawing panel.
  const dimensions = await browser.newPage()
  await dimensions.evaluateOnNewDocument(photo=>{
    window.__CATALOGUE_CATEGORY__='wainscoting-mirror'
    window.__CATALOGUE_DATA__=[{id:'dimension-photo',name:'Corner flower',photo,drawing:photo,dimensionText:'172mm x 172mm x 35mm(T)',drawingPresentation:'dimensions'}]
  },mirrors[0].photo)
  await dimensions.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
  assert.equal(await dimensions.$$eval('.dp-drawing-frame',els=>els.length),0)
  assert.equal(await dimensions.$eval('.dp-sub',el=>el.textContent),'172mm x 172mm x 35mm(T)')
  console.log('Browser: exactly two mirror products, seven grouped examples, no overflow; dimension-photo uses one picture plus complete size.')
} finally { await browser.close() }
