import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import puppeteer from 'puppeteer-core'
import { drawingContentBounds } from '../src/lib/drawing-display.js'
import { readImage, crop, toBuffer } from './imageops.mjs'
const synthetic = new PNG({width:400,height:350})
synthetic.data.fill(255)
const dot=(x,y)=>{const i=(y*400+x)*4;synthetic.data[i]=synthetic.data[i+1]=synthetic.data[i+2]=0}
for(let y=5;y<345;y++)for(let x=330;x<333;x++)dot(x,y)
for(let y=100;y<=220;y++) {dot(110,y);dot(230,y)}
for(let x=110;x<=230;x++){dot(x,100);dot(x,220)}
dot(95,155);dot(240,155);dot(165,90);dot(165,240) // separated measurement labels
const original=Buffer.from(synthetic.data)
const bounds=drawingContentBounds(400,350,synthetic.data)
assert.equal(bounds.ignored.length,1)
assert.ok(bounds.x<=95 && bounds.y<=90 && bounds.x+bounds.w>240 && bounds.y+bounds.h>240)
assert.ok(bounds.w<180 && bounds.h<180)
assert.ok(original.equals(synthetic.data),'Original dimension pixels must remain unchanged')

const source=readImage('C:/Users/admin/AppData/Local/Temp/codex-clipboard-b54b9ee1-6ee8-4ee6-9612-104abc9cb970.png')
const drawing=`data:image/png;base64,${toBuffer(crop(source,294,16,247,193)).toString('base64')}`
const photo=`data:image/png;base64,${toBuffer(crop(source,65,20,184,187)).toString('base64')}`
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try {
  const page=await browser.newPage()
  await page.setViewport({width:1000,height:1250})
  await page.evaluateOnNewDocument(data=>{
    window.__CATALOGUE_CATEGORY__='wainscoting-mirror'
    window.__CATALOGUE_DATA__=[{id:'drawing-size',name:'M04 Full Diamond Mirror',photo:data.photo,drawing:data.drawing,subtitle:'300mm x 300mm'}]
  },{photo,drawing})
  await page.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
  await page.waitForFunction(()=>!document.querySelector('[data-drawing-pending="true"]'))
  const result=await page.$eval('.dp-drawing-frame img',img=>({width:img.naturalWidth,height:img.naturalHeight,fit:getComputedStyle(img).objectFit}))
  assert.ok(result.width<150 && result.height<150,JSON.stringify(result))
  assert.equal(result.fit,'contain')
  assert.equal(await page.evaluate(()=>window.__CATALOGUE_DATA__[0].drawing),drawing)
  const frameWidths=await page.$$eval('.dp-photo,.dp-drawing-frame',els=>els.map(el=>el.getBoundingClientRect().width))
  assert.ok(Math.abs(frameWidths[0]-frameWidths[1])<1)
  await page.screenshot({path:'../.tmp/drawing-size-fixed.png',fullPage:true})
  const exported = await fetch('http://localhost:5174/api/export', {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:'wainscoting-mirror',products:[{
      id:'drawing-size',name:'M04 Full Diamond Mirror',photo,drawing,subtitle:'300mm x 300mm',
    }]}),signal:AbortSignal.timeout(65_000),
  })
  assert.ok(exported.ok,await exported.clone().text())
  const pdf=Buffer.from(await exported.arrayBuffer())
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-')
  await writeFile('../.tmp/drawing-size-fixed.pdf',pdf)
  console.log('Drawing display: white margins and detached separator excluded; dimension labels and original retained; equal main frames in browser. No API calls.')
}finally{await browser.close()}
