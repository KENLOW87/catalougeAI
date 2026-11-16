import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import crops from '../src/lib/reviewed-source-crops.js'
import {mkdir} from 'node:fs/promises'
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try {
 const page=await browser.newPage()
 await page.setViewport({width:900,height:1200})
 const profiles=['C-R80','C-R100'].map((name,i)=>({id:`profile-${i}`,name,...crops[name],subtitle:'Aluminium Corner Edge',layoutPairGroup:'aluminium-corners'}))
 const photos=profiles.map(p=>p.photo),drawings=profiles.map(p=>p.drawing)
 const products=[...profiles,...Array.from({length:4},(_,i)=>({id:`ordinary-${i}`,name:`Ordinary ${i+1}`,photo:profiles[0].photo}))]
 await page.evaluateOnNewDocument(products=>{window.__CATALOGUE_CATEGORY__='wainscoting-mirror';window.__CATALOGUE_DATA__=products},products)
 await page.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
 await page.waitForFunction(()=>!document.querySelector('[data-drawing-pending="true"]'))
 const result=await page.evaluate(()=>{
  const contained=img=>{const r=img.getBoundingClientRect(),frame=img.parentElement?.getBoundingClientRect(),scale=Math.min(r.width/img.naturalWidth,r.height/img.naturalHeight);return {width:img.naturalWidth*scale,height:img.naturalHeight*scale,frameWidth:frame?.width??r.width,centre:(r.top+r.bottom)/2,fit:getComputedStyle(img).objectFit}}
  return {pages:document.querySelectorAll('.cat-page').length,rows:[...document.querySelectorAll('.dp-row')].map(r=>r.querySelectorAll('.dp-item').length),
   pairs:[...document.querySelectorAll('.dp-item--technical-pair')].map(item=>({photo:contained(item.querySelector('.dp-photo img')),drawing:contained(item.querySelector('.dp-drawing-frame img'))})),
   fit:[...document.querySelectorAll('.dp-item')].every(item=>{const b=item.getBoundingClientRect();return [...item.querySelectorAll('img,.dp-name,.dp-sub')].every(el=>{const r=el.getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1&&r.top>=b.top-1&&r.bottom<=b.bottom+1})})}
 })
 assert.equal(result.pages,2);assert.deepEqual(result.rows,[1,1,4]);assert.equal(result.pairs.length,2);assert.ok(result.fit)
 for(const pair of result.pairs){
  assert.equal(pair.photo.fit,'contain');assert.equal(pair.drawing.fit,'contain')
  assert.ok(pair.photo.height <= 55*96/25.4+1,'Full-row profile photos stay within the approved 55mm maximum')
  assert.ok(pair.drawing.frameWidth>90*96/25.4,'Complete dimensioned section gets full-row readable width')
  const ratio=pair.photo.width*pair.photo.height/(pair.drawing.width*pair.drawing.height)
  assert.ok(ratio>.15&&ratio<2,`Comparable visual area, rather than an oversized profile and thumbnail section: ${ratio}`)
  assert.ok(Math.abs(pair.photo.centre-pair.drawing.centre)<1,'Profile and section centres stay aligned')
 }
 assert.ok(Math.abs(result.pairs[0].photo.height-result.pairs[1].photo.height)<1)
 assert.deepEqual(profiles.map(p=>p.photo),photos);assert.deepEqual(profiles.map(p=>p.drawing),drawings)
 await mkdir('.tmp/audit',{recursive:true})
 await page.screenshot({path:'.tmp/audit/technical-pair-balance-browser.png',clip:{x:0,y:0,width:794,height:600}})
 const other=await browser.newPage()
 await other.evaluateOnNewDocument(profiles=>{window.__CATALOGUE_CATEGORY__='wainscoting-mirror';window.__CATALOGUE_DATA__=profiles.map(p=>({...p,layoutPairGroup:'csw-corners'}))},profiles)
 await other.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
 assert.equal(await other.$$eval('.dp-item--technical-pair',items=>items.length),0,'Accepted CSW layout is unaffected')
 console.log('Actual reviewed C-R80/C-R100: one full row per product, equal 55mm profile heights and readable complete sections; four ordinary columns intact. Browser-only: no PDF export or OpenAI calls.')
}finally{await browser.close()}
