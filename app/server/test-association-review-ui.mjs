import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import {writeFile} from 'node:fs/promises'
import {PNG} from 'pngjs'
const png=new PNG({width:20,height:20});png.data.fill(255)
const photo=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
const result={products:[{id:'review-one',name:'ZX77',categoryId:'wainscoting-mirror',photo,wantsDrawing:false,sourcePage:2,
 imageAssociationVersion:1,imageAssociationIssues:['Image ownership could not be confirmed'],
 sourceReferences:[{image:photo,reason:'Image ownership could not be confirmed'}]}],warnings:[],
 routing:{confident:true,suggestedCategoryId:'wainscoting-mirror',filename:'test-import.pdf'}}
await writeFile('../.tmp/association-review.pdf','%PDF-1.4\n% local mocked upload\n')
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
 const page=await browser.newPage();let uploads=0,external=0
 await page.setRequestInterception(true)
 page.on('request',request=>{
  const url=request.url(),cors={'Access-Control-Allow-Origin':'http://localhost:5173','Access-Control-Allow-Headers':'Content-Type,X-Activity-Job-ID,X-Activity-Origin','Access-Control-Allow-Methods':'POST,GET,OPTIONS'}
  if(request.method()==='OPTIONS')return request.respond({status:204,headers:cors})
  if(url.endsWith('/api/ingest')&&request.method()==='POST'){
   uploads++;return request.respond({status:200,contentType:'application/x-ndjson',headers:cors,body:JSON.stringify({done:result})+'\n'})
  }
  if(!url.startsWith('http://localhost:')&&!url.startsWith('data:')){external++;return request.abort()}
  request.continue()
 })
 await page.goto('http://localhost:5173',{waitUntil:'networkidle0'})
 await page.$$eval('button',buttons=>buttons.find(b=>b.textContent==='Upload file').click())
 const input=await page.$('input[type=file]');await input.uploadFile('../.tmp/association-review.pdf')
 await page.waitForSelector('.draft')
 assert.equal(await page.$eval('.draft input[type=checkbox]',el=>el.checked),false)
 assert.ok((await page.$eval('.draft',el=>el.textContent)).includes('Rujukan sumber'))
 await page.$$eval('.draft button',buttons=>buttons.find(b=>b.textContent.includes('Sahkan produk')).click())
 assert.equal(await page.$eval('.draft input[type=checkbox]',el=>el.checked),true)
 await page.$$eval('.modal-actions button',buttons=>buttons.find(b=>b.textContent==='Apply').click())
 await page.waitForSelector('.dp-item')
 assert.equal(await page.$eval('.dp-name',el=>el.textContent),'ZX77')
 assert.equal(await page.$$('.dp-examples').then(a=>a.length),0)
 const stored=await page.evaluate(async()=>{
  const {loadAll}=await import('/src/lib/store.js');return (await loadAll()).byCategory['wainscoting-mirror'][0]
 })
 assert.equal(stored.sourcePage,2)
 assert.equal(stored.sourceReferences.length,1)
 assert.equal(stored.imageAssociationVersion,1)
 assert.equal(uploads,1);assert.equal(external,0)
 console.log('Upload review UI: uncertain image visible, unchecked by default, confirmed product saves original reference/source page without adding false usage images; mocked import only, zero external requests.')
} finally{await browser.close()}
