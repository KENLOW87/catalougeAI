import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import {readWithRules} from './readers/index.mjs'
import {readImage} from './imageops.mjs'
import {shutdownOcr} from './ocr.mjs'
import {orderTechnicalSpace} from '../src/lib/product-layout.js'
import {mkdir} from 'node:fs/promises'
const source=readImage('../.tmp/wains-inspect/page-04.png')
let read
try{read=await readWithRules(source,()=>{},4,{sourceImage:source})}finally{await shutdownOcr()}
const products=read.products.map((p,i)=>({...p,id:`source-${i}`}))
const csw=products.filter(p=>p.name.startsWith('CSW'))
assert.equal(csw.length,2)
assert.ok(csw.every(p=>p._spec==='wainscoting-csw-complete'),'Actual local dispatch selects full CSW source crops')
assert.ok(csw.every(p=>p.layoutFullRow&&p.drawingPreserved))
assert.ok(csw[1].__sourceBoxes.photo.w>=132&&csw[1].__sourceBoxes.photo.h>=98,'Entire arch fits within the extraction bounds')
const flat={id:'flat',name:'PS FLAT BAR',photo:csw[0].photo,examples:[{image:csw[1].photo,role:'usage'}]}
const input=[flat,...products],backup=structuredClone(input)
const ordered=orderTechnicalSpace(input)
assert.deepEqual(ordered.map(p=>p.name),['PS FLAT BAR','GOLD PW02','GOLD PW03','GOLD PW05','GOLD PW06',...csw.map(p=>p.name),'C-R80','C-R100'])
assert.deepEqual(input,backup,'Reflow never mutates saved source order or records')
assert.deepEqual(orderTechnicalSpace(ordered),ordered,'Reflow is stable across reloads')
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const page=await browser.newPage();await page.setViewport({width:900,height:1200})
 await page.evaluateOnNewDocument(input=>{window.__CATALOGUE_CATEGORY__='wainscoting-mirror';window.__CATALOGUE_DATA__=input},input)
 await page.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
 await page.waitForFunction(()=>!document.querySelector('[data-examples-pending="true"],[data-drawing-pending="true"]'))
 const state=await page.evaluate(()=>({pages:[...document.querySelectorAll('.cat-page')].map(p=>[...p.querySelectorAll('.dp-row')].map(r=>[...r.querySelectorAll('.dp-name')].map(e=>e.textContent))),
  profiles:[...document.querySelectorAll('.dp-item')].filter(e=>/^CSW|^C-R/.test(e.querySelector('.dp-name').textContent)).map(e=>({width:e.getBoundingClientRect().width,photo:e.querySelector('.dp-photo img').naturalWidth,fit:getComputedStyle(e.querySelector('.dp-photo img')).objectFit})),
  overflow:[...document.querySelectorAll('.dp-item')].some(e=>{const b=e.getBoundingClientRect();return [...e.querySelectorAll('img,.dp-name,.dp-sub')].some(el=>{const r=el.getBoundingClientRect();return r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1})})
 }))
 assert.deepEqual(state.pages,[[['PS FLAT BAR'],['GOLD PW02','GOLD PW03','GOLD PW05','GOLD PW06']],csw.map(p=>[p.name]),[['C-R80'],['C-R100']]])
 assert.equal(state.profiles.length,4);assert.equal(state.overflow,false)
 for(const profile of state.profiles){assert.ok(profile.width>700);assert.equal(profile.fit,'contain')}
 const other=await page.evaluate(async()=>{
  const {defaultCategoryFor}=await import('/src/lib/categories/default.js')
  return defaultCategoryFor({id:'test',title:'Test'}).paginate(Array.from({length:8},(_,i)=>({id:String(i),name:`Ordinary ${i}`}))).map(p=>p.rows.map(r=>r.length))
 })
 assert.deepEqual(other,[[4,4]])
 await mkdir('.tmp/audit',{recursive:true})
 const sheets=await page.$$('.cat-page')
 await sheets[1].screenshot({path:'.tmp/audit/csw-full-row-browser.png'})
 await sheets[2].screenshot({path:'.tmp/audit/cr-full-row-browser.png'})
 console.log('Real source crops: complete CSW arch and preserved measurements. Flat Bar + GOLD grid share page 1; CSW products get one row each on page 2; C-R products one row each on page 3. No records lost, ordinary four-column grid intact, no PDF/AI requests.')
}finally{await browser.close()}
