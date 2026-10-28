import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import {PNG} from 'pngjs'
import {readImage,toBuffer} from './imageops.mjs'
import {readWithRules} from './readers/index.mjs'
import {shutdownOcr} from './ocr.mjs'
import {adoptRuleProduct} from './ingest.mjs'
import {validateImportedAssociations} from './image-association.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
let external=0
globalThis.fetch=async()=>{external++;throw new Error('No API calls allowed in approved-layout audit')}
const resize=(image,width)=>{
 const height=Math.round(image.height*width/image.width),out=new PNG({width,height})
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const from=(Math.min(image.height-1,Math.floor(y*image.height/height))*image.width+Math.min(image.width-1,Math.floor(x*image.width/width)))*4
  out.data.set(image.data.subarray(from,from+4),(y*width+x)*4)
 }
 return out
}
const products=[],sourceCounts={}
try{
 for(let n=1;n<=10;n++){
  if([1,2,6].includes(n)){
   const image=readImage(`../.tmp/wains-400/p-${String(n).padStart(2,'0')}.png`)
   products.push({id:`source-page-${n}`,name:`Source page ${n}`,isPage:true,image:`data:image/png;base64,${toBuffer(resize(image,414)).toString('base64')}`})
   continue
  }
  const image=n===3?readImage('../.tmp/source-page3-03.png'):readImage(`../.tmp/wains-inspect/page-${String(n).padStart(2,'0')}.png`)
  const result=await readWithRules(image,()=>{},n,{sourceImage:image})
  assert.ok(result.products?.length,`Source page ${n} must be read locally`)
  sourceCounts[n]=result.products.length
  for(const raw of result.products){
   const normalized=b=>b?{x:b.x/image.width,y:b.y/image.height,w:b.w/image.width,h:b.h/image.height}:null
   raw.sourceBox=normalized(raw.__sourceBoxes?.photo)
   raw.sourceDrawingBox=normalized(raw.__sourceBoxes?.drawing)
   const p=adoptRuleProduct(raw,products.length,n,{...result.spec,category:'wainscoting-mirror'})
   p.id=`source-${n}-${products.length}`;p.imageAssociationVersion=1
   products.push(p)
  }
 }
}finally{await shutdownOcr()}
assert.deepEqual(sourceCounts,{3:8,4:8,5:7,7:2,8:3,9:2,10:2})
assert.equal(products.filter(p=>!p.isPage).length,32)
await validateImportedAssociations(products,{readText:async()=>''})
const drawingSources=new Map(products.filter(p=>p.drawing).map(p=>[p.id,p.drawing]))
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const page=await browser.newPage();await page.setViewport({width:900,height:1200})
 await page.setRequestInterception(true)
 page.on('request',request=>{
  const url=request.url()
  if(url.includes('/api/')||(!url.startsWith('http://localhost:5173/')&&!url.startsWith('data:')&&!url.startsWith('blob:'))){external++;return request.abort()}
  request.continue()
 })
 await page.evaluateOnNewDocument(products=>{window.__CATALOGUE_CATEGORY__='wainscoting-mirror';window.__CATALOGUE_DATA__=products},products)
 await page.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
 await page.waitForFunction(()=>!document.querySelector('[data-examples-pending="true"],[data-drawing-pending="true"]'),{timeout:45000})
 const report=await page.evaluate(()=>({pages:[...document.querySelectorAll('.cat-page')].map((p,i)=>({page:i+1,rows:[...p.querySelectorAll('.dp-row')].map(r=>[...r.querySelectorAll('.dp-name')].map(e=>e.textContent))})),
  names:[...document.querySelectorAll('.dp-name')].map(e=>e.textContent),
  errors:[...document.querySelectorAll('.dp-row')].flatMap(row=>{const b=row.getBoundingClientRect();return [...row.querySelectorAll('img,.dp-name,.dp-sub,figcaption')].flatMap(el=>{const r=el.getBoundingClientRect();return r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1?[{element:el.tagName,text:el.getAttribute('alt')||el.textContent}]:[]})}),
  incomplete:[...document.querySelectorAll('img')].filter(img=>!img.complete||!img.naturalWidth).map(img=>img.alt),
  fits:[...document.querySelectorAll('.dp-photo img,.dp-drawing-frame img,.dp-examples img,.dp-source-support img')].every(img=>getComputedStyle(img).objectFit==='contain'),
  sourceDrawings:window.__CATALOGUE_DATA__.filter(p=>p.drawing).map(p=>[p.id,p.drawing]),
  shared:[...document.querySelectorAll('[data-support-owner]')].map(e=>({owner:e.getAttribute('data-support-owner'),images:e.querySelectorAll('img').length})),
  folding:[...document.querySelectorAll('.dp-item')].filter(e=>/^M0[45]/.test(e.querySelector('.dp-name').textContent)).map(e=>({name:e.querySelector('.dp-name').textContent,images:e.querySelectorAll('.dp-examples img').length,columns:getComputedStyle(e.querySelector('.dp-examples-grid')).gridTemplateColumns.split(' ').length})),
  scenes:window.__CATALOGUE_DATA__.filter(p=>/^HM01/.test(p.name)).map(p=>({name:p.name,mode:p.photoTreatmentMode}))
 }))
 await mkdir('.tmp/audit',{recursive:true})
 const {sourceDrawings,...summary}=report
 await writeFile('.tmp/audit/approved-layout-audit.json',JSON.stringify({date:'2026-10-28',sourceCounts,...summary,externalCalls:external},null,2))
 assert.equal(report.names.length,32)
 assert.equal(new Set(report.names).size,32,'No duplicated or missing products')
 assert.equal(report.pages.length,14)
 assert.deepEqual(report.errors,[],'No image, caption or dimensions overflow their approved row')
 assert.deepEqual(report.incomplete,[]);assert.ok(report.fits)
 assert.deepEqual(report.sourceDrawings,[...drawingSources],'Saved measurement source images remain byte-for-byte intact')
 const rows=report.pages.flatMap(p=>p.rows)
 assert.deepEqual(rows.find(r=>r[0]==='PW01'),['PW01','PW02','PW03','PW04'])
 assert.deepEqual(rows.find(r=>r[0]==='GOLD PW02'),['GOLD PW02','GOLD PW03','GOLD PW05','GOLD PW06'])
 assert.deepEqual(rows.find(r=>r[0]==='WB01'),['WB01','WB02','WB05','WB06'])
 for(const name of ['CSW - Coner Solid Wainscoting','CSW - Coner Wainscoting','C-R80','C-R100'])assert.deepEqual(rows.find(r=>r.includes(name)),[name])
 const flat=report.pages.find(p=>p.rows.some(r=>r.includes('PS FLAT BAR')))
 assert.deepEqual(flat.rows,[['PS FLAT BAR'],['GOLD PW02','GOLD PW03','GOLD PW05','GOLD PW06']])
 assert.deepEqual(report.shared,[{owner:'WB01',images:1},{owner:'WB06',images:1}])
 assert.deepEqual(report.folding,[{name:'M04 Full Diamond Mirror',images:4,columns:4},{name:'M05 Bronze Brick Mirror',images:3,columns:3}])
 assert.ok(report.scenes.length===2&&report.scenes.every(p=>p.mode==='preserve-scene'))
 assert.equal(external,0,'No export, import API or external model requests')
 const sheets=await page.$$('.cat-page')
 for(const index of [4,5,6,7,9,10,11,12,13])await sheets[index].screenshot({path:`.tmp/audit/approved-page-${index+1}.png`})
 console.log('All 32 source products checked through actual upload adoption: 14 pages, ordinary grids 4 across, full CSW/C-R rows, original WB shared bands and other layouts retained, all source drawings intact, no missing images/overflow. Zero API/model calls and no PDF exports.')
}finally{await browser.close()}
