import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import {readWithSpec} from './readers/spec.mjs'
import {BUILTIN_SPECS} from './readers/specs.mjs'
import {readImage} from './imageops.mjs'
import {groupSharedUsage} from '../src/lib/product-layout.js'
import {writeFile} from 'node:fs/promises'
const source=readImage('../.tmp/wains-inspect/page-05.png')
const products=[]
for(const id of ['wainscoting-bendable-profiles','wainscoting-corner-flower']){
 const spec=BUILTIN_SPECS.find(s=>s.id===id)
 const result=await readWithSpec(source,{...spec,anchor:{...spec.anchor,pageNo:5}})
 products.push(...result.products.map((p,i)=>({...p,id:`${id}-${i}`})))
}
const before=structuredClone(products),grouped=groupSharedUsage(products)
assert.deepEqual(products,before,'Presentation must never mutate stored ownership or source images')
for(const name of ['CW02','CW03'])assert.equal(grouped.find(p=>p.name===name).examples.length,0)
assert.equal(grouped.find(p=>p.name==='WB06').examples.length,4,'All installation/close-up references remain in one shared set')
assert.ok(grouped.find(p=>p.name==='WB06').supportStrip)
const missing=products.filter(p=>p.name!=='WB06')
assert.equal(groupSharedUsage(missing),missing,'Missing shared band retains the examples under their original products')
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const page=await browser.newPage()
 await page.evaluateOnNewDocument(products=>{window.__CATALOGUE_CATEGORY__='wainscoting-mirror';window.__CATALOGUE_DATA__=products},products)
 await page.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
 await page.waitForFunction(()=>!document.querySelector('[data-examples-pending="true"],[data-drawing-pending="true"]'))
 const state=await page.evaluate(()=>({pages:document.querySelectorAll('.cat-page').length,
  wb:[...document.querySelectorAll('.dp-row--source-group .dp-name')].map(e=>e.textContent),
  installations:[...document.querySelectorAll('[data-support-owner="WB06"] img')].length,
  label:document.querySelector('[data-support-owner="WB06"] .dp-source-support-title')?.textContent,
  cornerExamples:[...document.querySelectorAll('.dp-item')].filter(e=>/^CW0[23]$/.test(e.querySelector('.dp-name')?.textContent)).map(e=>e.querySelectorAll('.dp-examples img').length),
  drawings:document.querySelectorAll('.dp-drawing-frame').length,
  overflow:[...document.querySelectorAll('.dp-row')].some(row=>{const b=row.getBoundingClientRect();return [...row.querySelectorAll('img,.dp-name,.dp-sub')].some(el=>{const r=el.getBoundingClientRect();return r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1})})
 }))
 assert.equal(state.pages,3)
 assert.deepEqual(state.wb,['WB01','WB02','WB05','WB06'])
 assert.equal(state.installations,1,'One intact source strip, never scattered across individual corner cards')
 assert.equal(state.label,'Contoh pemasangan WB06 bersama CW02 / CW03')
 assert.deepEqual(state.cornerExamples,[0,0]);assert.equal(state.drawings,3);assert.equal(state.overflow,false)
 const response=await fetch('http://localhost:5174/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:'wainscoting-mirror',products}),signal:AbortSignal.timeout(65000)})
 assert.ok(response.ok)
 const pdf=Buffer.from(await response.arrayBuffer())
 assert.equal([...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,3)
 await writeFile('../.tmp/shared-usage-layout.pdf',pdf)
 console.log('Source WB06/CW02/CW03 installation scenes and close-ups form one original strip; no scattered corner examples or lost drawings; four WB cards and page count preserved in browser/PDF; stored records untouched. No AI calls.')
}finally{await browser.close()}
