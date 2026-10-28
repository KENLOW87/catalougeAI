import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import {writeFile,readFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try {
 const page=await browser.newPage()
 await page.goto('http://localhost:5173',{waitUntil:'networkidle0'})
 const data=await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=100;c.height=160
  c.getContext('2d').fillRect(0,0,100,160);const photo=c.toDataURL()
  const h=document.createElement('canvas');h.width=400;h.height=80
  h.getContext('2d').fillRect(0,0,400,80)
  return {photo,chrome:{image:h.toDataURL(),heightMm:24}}
 })
 const ordinary=Array.from({length:8},(_,i)=>({id:`p${i}`,name:`Product ${i+1}`,photo:data.photo}))
 const profiles=['CSW solid','CSW corner','C-R80','C-R100'].map((name,i)=>({id:`t${i}`,name,photo:data.photo,drawing:data.photo,layoutFullRow:true,layoutPairGroup:i<2?'csw-corners':'aluminium-corners'}))
 const result=await page.evaluate(async ({ordinary,profiles})=>{
  const {defaultCategoryFor}=await import('/src/lib/categories/default.js')
  const category=defaultCategoryFor({id:'wainscoting-mirror',title:'Test'})
  return {before:category.paginate([...ordinary,...profiles.slice(0,2).map(({layoutPairGroup,...p})=>p)]).length,
   after:category.paginate([...ordinary,...profiles]).map(p=>p.rows.map(r=>r.length))}
 },{ordinary,profiles})
 assert.equal(result.before,2)
 assert.deepEqual(result.after,[[4,4],[1,1],[1,1]])
 const response=await fetch('http://localhost:5174/api/export',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({category:'wainscoting-mirror',products:[...ordinary,...profiles],chrome:data.chrome})})
 assert.ok(response.ok)
 const pdf=Buffer.from(await response.arrayBuffer())
 assert.equal([...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,3)
 await writeFile('../.tmp/technical-pairs-export.pdf',pdf)
 await promisify(execFile)('pdftohtml',['-xml','../.tmp/technical-pairs-export.pdf','../.tmp/technical-pairs-export.xml'])
 const xml=await readFile('../.tmp/technical-pairs-export.xml','utf8')
 assert.equal([...xml.matchAll(/<image\b/g)].length,19,'12 products, 4 drawings, and original headers on three exported pages')
 console.log('Actual export: four ordinary products per row; CSW and C-R each get a full row on dedicated technical pages; original headers retained.')
} finally {await browser.close()}
