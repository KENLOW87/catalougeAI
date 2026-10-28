import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import {PNG} from 'pngjs'
import {writeFile,mkdir} from 'node:fs/promises'
import {orderProductFamilies,upsertSeriesProduct} from '../src/lib/product-order.js'
const raw=['WB01','WB02','WB05','WB06','WB08 (Bare Finish)','WB07 (Bare Finish)'].map((name,i)=>({id:`wb-${i}`,name,photo:`photo-${i}`,
 ...(i<4?{layoutRowGroup:'approved-wb'}:{}),...(i===0?{supportStrip:'/assets/reviewed/wb01-support-strip.png'}:{}),
 ...(i===3?{supportStrip:'/assets/reviewed/wb06-corner-installation-strip.png'}:{})}))
const backup=structuredClone(raw),ordered=orderProductFamilies(raw)
assert.deepEqual(ordered.map(p=>p.name),['WB01','WB02','WB05','WB06','WB07 (Bare Finish)','WB08 (Bare Finish)'])
assert.ok(ordered.every(p=>p.layoutRowGroup==='approved-wb'))
assert.deepEqual(raw,backup,'Sorting must not modify existing photos, examples or source records')
const inserted=upsertSeriesProduct(raw,{id:'new-wb03',name:'WB03',photo:'new-own-photo',examples:[{image:'new-own-display',role:'usage'}]})
assert.deepEqual(inserted.map(p=>p.name),['WB01','WB02','WB03','WB05','WB06','WB07 (Bare Finish)','WB08 (Bare Finish)'])
assert.equal(inserted[2].photo,'new-own-photo');assert.equal(inserted[2].examples[0].image,'new-own-display')
assert.equal(inserted[2].supportStrip,undefined,'A new product must never copy another product\'s display images')
const duplicates=orderProductFamilies([...raw,{id:'different-wb06',name:'WB06',photo:'different-photo'}])
assert.equal(duplicates.filter(p=>p.name==='WB06').length,2,'Do not delete or rename duplicate product codes')
assert.deepEqual(orderProductFamilies([{id:'a',name:'PV10'},{id:'b',name:'PV08'},{id:'c',name:'PV07'}]).map(p=>p.name),['PV07','PV08','PV10'])
const barrier=[{id:'a',name:'WB08'},{id:'page',isPage:true},{id:'b',name:'WB07'}]
assert.deepEqual(orderProductFamilies(barrier),barrier,'Never move products across kept source pages')
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const page=await browser.newPage();await page.setViewport({width:1000,height:1300})
 let forbidden=0
 await page.setRequestInterception(true)
 page.on('request',request=>{
  const url=request.url()
  if(/\/api\/(?:export|interpret|image\/edit|ingest)(?:\?|$)/.test(url)||/^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(url)){
   forbidden++;return request.abort()
  }
  request.continue()
 })
 await page.goto('http://localhost:5173',{waitUntil:'networkidle0'})
 const photo=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=180;const ctx=c.getContext('2d');ctx.fillStyle='#ddd';ctx.fillRect(10,10,80,160);return c.toDataURL()})
 const products=[...raw.map(p=>({...p,photo})),{id:'cw2',name:'CW02',photo,drawing:photo},{id:'cw3',name:'CW03',photo,drawing:photo},{id:'cw4',name:'CW04',photo,drawing:photo}]
 await page.evaluateOnNewDocument(products=>{window.__CATALOGUE_CATEGORY__='wainscoting-mirror';window.__CATALOGUE_DATA__=products},products)
 await page.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
 await page.waitForFunction(()=>!document.querySelector('[data-examples-pending="true"],[data-drawing-pending="true"]')&&[...document.images].every(i=>i.complete))
 const state=await page.evaluate(()=>{
  const bundle=document.querySelector('.dp-source-group-bundle'),cards=[...bundle.querySelectorAll('.dp-item')],band=bundle.querySelector('.dp-source-support')
  return {pages:document.querySelectorAll('.cat-page').length,names:cards.map(e=>e.querySelector('.dp-name').textContent),
   bounds:cards.map(e=>e.getBoundingClientRect().toJSON()),supportTop:band.getBoundingClientRect().top,
   owners:[...band.querySelectorAll('[data-support-owner]')].map(e=>e.getAttribute('data-support-owner')),
   overflow:[...document.querySelectorAll('.dp-row')].some(row=>{const b=row.getBoundingClientRect();return [...row.querySelectorAll('img,.dp-name,.dp-sub,figcaption')].some(el=>{const r=el.getBoundingClientRect();return r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1})})}
 })
 assert.equal(state.pages,3);assert.deepEqual(state.names,ordered.map(p=>p.name));assert.equal(state.overflow,false)
 assert.ok(state.bounds.slice(0,4).every(b=>Math.abs(b.top-state.bounds[0].top)<1))
 assert.ok(state.bounds[4].top>state.bounds[0].bottom)
 assert.ok(state.bounds.every(b=>Math.abs(b.width-state.bounds[0].width)<1),'Four-column card sizes remain consistent across wrapped rows')
 assert.ok(state.supportTop>=Math.max(...state.bounds.map(b=>b.bottom)),'Display images come AFTER every WB product, never between old and newly added products')
 assert.deepEqual(state.owners,['WB01','WB06'])
 await mkdir('.tmp/audit',{recursive:true});await page.screenshot({path:'.tmp/audit/growing-wb-family-browser.png'})
 // Exercise the actual chat → Add product → Save path in an isolated profile.
 await page.goto('http://localhost:5173',{waitUntil:'networkidle0'})
 await page.evaluate(async products=>{const {saveCatalogue}=await import('/src/lib/store.js');await saveCatalogue('wainscoting-mirror',products);localStorage.setItem('geometra.activeCategory','wainscoting-mirror');sessionStorage.setItem('geometra.view','catalogue')},products)
 await page.reload({waitUntil:'networkidle0'})
 await page.click('[aria-label="Catalogue assistant"]')
 await page.type('.bot-dock input[placeholder]','tambah WB03 dalam catalogue')
 await page.click('.bot-dock button[type="submit"]');await page.waitForSelector('.modal')
 const png=new PNG({width:60,height:100});png.data.fill(220)
 await writeFile('.tmp/audit/new-wb03.png',PNG.sync.write(png))
 const input=await page.$('.modal input[type="file"]');await input.uploadFile('.tmp/audit/new-wb03.png')
 await page.waitForFunction(()=>!document.querySelector('.modal-actions .primary').disabled)
 await page.click('.modal-actions .primary');await page.waitForFunction(()=>!document.querySelector('.modal'))
 const saved=await page.evaluate(async()=>{const {loadAll}=await import('/src/lib/store.js');return (await loadAll()).byCategory['wainscoting-mirror'].filter(p=>/^WB/.test(p.name)).map(p=>({name:p.name,group:p.layoutRowGroup}))})
 assert.deepEqual(saved.map(p=>p.name),['WB01','WB02','WB03','WB05','WB06','WB07 (Bare Finish)','WB08 (Bare Finish)'])
 assert.ok(saved.every(p=>p.group==='approved-wb'))
 await page.reload({waitUntil:'networkidle0'})
 assert.deepEqual(await page.$$eval('.list button.nm',e=>e.map(x=>x.textContent).filter(n=>/^WB/.test(n))),saved.map(p=>p.name))
 assert.equal(forbidden,0,'Actual add/save/reload must not invoke interpretation, image editing, import or PDF export')
 console.log('Newest WB08/WB07 case: natural code order, group inherited without copying photos, four-column wrapped cards before shared displays, page count intact. Actual chat add/save/reload also inserts WB03 correctly. No PDF export or OpenAI calls.')
}finally{await browser.close()}
