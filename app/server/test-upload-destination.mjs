import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'

const directory = mkdtempSync(join(tmpdir(), 'catalogue-upload-destination-'))
const png = new PNG({ width:20, height:20 }); png.data.fill(255)
const image = PNG.sync.write(png), photo = `data:image/png;base64,${image.toString('base64')}`
const pdf = join(directory,'Unrelated Catalogue.pdf'), picture = join(directory,'Unrelated Picture.png')
writeFileSync(pdf,'%PDF-1.4\n% mocked local reader fixture\n%%EOF'); writeFileSync(picture,image)
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true })
try {
  const page = await browser.newPage(), payloads = [], errors = []
  let detected = false, forbidden = 0
  page.on('pageerror',error => errors.push(error.message))
  const headers = {'Access-Control-Allow-Origin':'http://localhost:5173','Access-Control-Allow-Headers':'Content-Type,X-Activity-Job-ID,X-Activity-Origin','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}
  await page.setRequestInterception(true)
  page.on('request',request => {
    const path = new URL(request.url()).pathname
    if (request.method()==='OPTIONS') return request.respond({status:204,headers})
    if (path==='/api/ingest/status') return request.respond({status:200,headers,contentType:'application/json',body:JSON.stringify({ready:true,aiFallback:true})})
    if (path==='/api/activity/events') return request.respond({status:200,headers,contentType:'application/json',body:'{"ok":true}'})
    if (['/api/ingest','/api/ingest-image'].includes(path)) {
      const payload = JSON.parse(request.postData()); payloads.push(payload)
      const result = {products:[{id:'neutral-test',name:'ZX77',photo,wantsDrawing:false,readBy:'vision'}],routing:{confident:detected,...(detected ? {suggestedCategoryId:'wainscoting-mirror'}:{}),filename:payload.filename}}
      return request.respond({status:200,headers,contentType:path==='/api/ingest'?'application/x-ndjson':'application/json',body:path==='/api/ingest'?JSON.stringify({done:result})+'\n':JSON.stringify(result)})
    }
    if (/\/api\/(interpret|image\/edit|export)/.test(request.url()) || /^https?:/.test(request.url()) && !['localhost','127.0.0.1'].includes(new URL(request.url()).hostname)) {forbidden++;return request.abort()}
    request.continue()
  })
  await page.goto('http://localhost:5173',{waitUntil:'networkidle0'})
  await page.evaluate(()=>{localStorage.setItem('geometra.activeCategory','wainscoting-mirror');sessionStorage.setItem('geometra.view','dashboard')})
  await page.reload({waitUntil:'networkidle0'})
  const snapshot = await page.evaluate(async()=>JSON.stringify(await(await import('/src/lib/store.js')).loadAll()))
  const assertDashboard = async()=>{
    assert.ok(await page.$('.dashboard'),'Upload must not replace dashboard with last catalogue')
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('geometra.view')),'dashboard')
    assert.equal(await page.evaluate(()=>localStorage.getItem('geometra.activeCategory')),'wainscoting-mirror')
  }
  const cancel = async()=>{await page.$$eval('.modal-actions button',buttons=>buttons.find(b=>b.textContent.trim()==='Cancel').click());await page.waitForFunction(()=>!document.querySelector('.modal'));await assertDashboard()}
  const review = async filename=>{
    await(await page.$('input[type="file"][accept="application/pdf,image/*"]')).uploadFile(filename)
    await page.waitForSelector('.route-pick select')
    await assertDashboard()
    return page.$eval('.route-pick select',el=>el.value)
  }
  // Opening and cancelling alone must not navigate or change reload state.
  await page.click('.dashboard-head-actions .primary');await page.waitForSelector('.modal');await assertDashboard();await cancel()
  for (const filename of [pdf,picture]) {
    await page.click('.dashboard-head-actions .primary')
    assert.equal(await review(filename),'__new__','Unrecognised general upload must not select Wainscoting')
    assert.equal(payloads.at(-1).into,null,'The previous active catalogue must not reach the reader')
    await cancel()
  }
  await page.evaluate(()=>{const card=[...document.querySelectorAll('.dashboard-card')].find(card=>/PVC Marble/i.test(card.querySelector('h3').textContent));[...card.querySelectorAll('button')].find(b=>b.textContent==='Upload file').click()})
  assert.equal(await review(pdf),'pvc-marble','Card upload retains its explicit destination')
  assert.equal(payloads.at(-1).into,'pvc-marble');await cancel()
  detected=true
  await page.click('.dashboard-head-actions .primary')
  assert.equal(await review(pdf),'wainscoting-mirror','Confident file recognition still suggests the correct catalogue')
  assert.equal(payloads.at(-1).into,null);await cancel()
  await page.reload({waitUntil:'networkidle0'});await assertDashboard()
  assert.equal(await page.evaluate(async()=>JSON.stringify(await(await import('/src/lib/store.js')).loadAll())),snapshot,'Opening/reviewing/cancelling does not change any catalogue')
  assert.deepEqual(errors,[]);assert.equal(forbidden,0)
  console.log('PASS upload destinations: general PDF/image upload stays neutral; remembered Wainscoting never sent; explicit PVC card and detected routing preserved; cancel/reload retains dashboard/category/data. Mock readers only, no paid AI or exports.')
} finally {await browser.close();rmSync(directory,{recursive:true,force:true})}
