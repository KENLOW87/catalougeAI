import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import {readWithSpec} from './readers/spec.mjs'
import {BUILTIN_SPECS} from './readers/specs.mjs'
import {readImage,crop,toBuffer} from './imageops.mjs'
import {writeFile,readFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const source=readImage('../.tmp/wains-inspect/page-05.png')
const spec=BUILTIN_SPECS.find(s=>s.id==='wainscoting-bendable-profiles')
const result=await readWithSpec(source,{...spec,anchor:{...spec.anchor,pageNo:5}})
const products=result.products.map((p,i)=>({...p,id:`wb-${i}`}))
assert.deepEqual(products.map(p=>p.name),['WB01','WB02','WB05','WB06'])
assert.ok(products.every(p=>p.layoutRowGroup==='wains-bendable-profiles'))
assert.ok(products[0].supportStrip,'Import retains the original panoramic support strip')
assert.deepEqual(products.map(p=>p.examples.length),[4,0,0,2],'Raw source references and owners remain intact')
const chrome={image:`data:image/png;base64,${toBuffer(crop(source,0,0,827,110)).toString('base64')}`,heightMm:28}
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const page=await browser.newPage()
 await page.evaluateOnNewDocument(({products,chrome})=>{
  window.__CATALOGUE_CATEGORY__='wainscoting-mirror';window.__CATALOGUE_DATA__=products;window.__CATALOGUE_CHROME__=chrome
 },{products,chrome})
 await page.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
 await page.waitForFunction(()=>!document.querySelector('[data-examples-pending="true"]'))
 const state=await page.evaluate(()=>({pages:document.querySelectorAll('.cat-page').length,
  rows:[...document.querySelectorAll('.dp-row')].map(r=>[...r.querySelectorAll('.dp-name')].map(e=>e.textContent)),
  names:[...document.querySelectorAll('.dp-name')].map(e=>e.getBoundingClientRect().top),
  owners:[...document.querySelectorAll('[data-support-owner]')].map(e=>e.getAttribute('data-support-owner')),
  strip:document.querySelectorAll('.dp-source-support-strip').length,
  images:document.querySelectorAll('.dp-source-support img').length,
  overflow:[...document.querySelectorAll('.dp-row')].some(row=>{const b=row.getBoundingClientRect();return [...row.querySelectorAll('img,.dp-name,.dp-sub,figcaption')].some(el=>{const r=el.getBoundingClientRect();return r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1})})
 }))
 assert.equal(state.pages,1)
 assert.deepEqual(state.rows,[['WB01','WB02','WB05','WB06'],[]])
 assert.ok(state.names.every(y=>Math.abs(y-state.names[0])<.5),'Four product names align in the same row')
 assert.deepEqual(state.owners,['WB01','WB06'])
 assert.equal(state.strip,2);assert.equal(state.images,2,'WB01 description and complete WB06/CW installation strip stay intact')
 assert.equal(state.overflow,false)
 const generic=await page.evaluate(async products=>{
  const {defaultCategoryFor}=await import('/src/lib/categories/default.js')
  return defaultCategoryFor({id:'other',title:'Other'}).paginate(products.map((p,i)=>({...p,name:`BX${i+1}`}))).map(p=>p.rows.map(r=>r.length))
 },products)
 assert.deepEqual(generic,[[4,0]],'Source row metadata works independently of product names')
 const response=await fetch('http://localhost:5174/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:'wainscoting-mirror',products,chrome}),signal:AbortSignal.timeout(65000)})
 assert.ok(response.ok)
 await writeFile('../.tmp/source-row-layout.pdf',Buffer.from(await response.arrayBuffer()))
 await promisify(execFile)('pdftohtml',['-xml','-zoom','1','../.tmp/source-row-layout.pdf','../.tmp/source-row-layout.xml'])
 const xml=await readFile('../.tmp/source-row-layout.xml','utf8')
 assert.equal([...xml.matchAll(/<page\s/g)].length,1)
 assert.equal([...xml.matchAll(/<image\b/g)].length,7,'Four cards, two complete source strips, and header')
 assert.ok(/width="5\d\d"[^>]*src=/.test(xml),'Original panoramic support remains full-width in the exported PDF')
 console.log('Real source WB import: four cards in one aligned row, intact original supporting strip below, WB06 examples still owned, one exported page. Metadata also works for unrelated product names; no AI calls.')
}finally{await browser.close()}
