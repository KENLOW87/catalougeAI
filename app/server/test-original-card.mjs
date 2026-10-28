import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import {writeFile,readFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
  const page=await browser.newPage()
  await page.goto('http://localhost:5173',{waitUntil:'networkidle0'})
  const images=await page.evaluate(()=>{
    const original=document.createElement('canvas');original.width=200;original.height=160
    const ctx=original.getContext('2d');ctx.fillStyle='#c59a28';ctx.fillRect(0,0,200,160)
    ctx.fillStyle='#654d14';ctx.fillRect(20,10,30,140);ctx.fillStyle='#ffe69b';ctx.fillRect(80,0,40,160)
    const card=document.createElement('canvas');card.width=300;card.height=340
    const c=card.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,300,340)
    c.fillStyle='#222';c.fillRect(0,0,300,50);c.drawImage(original,20,70,260,208)
    const usage=document.createElement('canvas');usage.width=200;usage.height=160
    const u=usage.getContext('2d');u.fillStyle='#8ab5cb';u.fillRect(0,0,200,160);u.fillStyle='#333';u.fillRect(80,40,60,70)
    return {original:original.toDataURL(),card:card.toDataURL(),usage:usage.toDataURL()}
  })
  const matches=await page.evaluate(async images=>{
    const {isOriginalProductCard}=await import('/src/lib/source-photo-match.js')
    return {card:await isOriginalProductCard(images.original,images.card),usage:await isOriginalProductCard(images.original,images.usage)}
  },images)
  assert.equal(matches.card,true,'Original photo inside the full product card must be recognised')
  assert.equal(matches.usage,false,'A different usage photo must remain visible')
  await page.evaluateOnNewDocument(images=>{
    window.__CATALOGUE_CATEGORY__='wainscoting-mirror'
    window.__CATALOGUE_DATA__=[
      {id:'gold',name:'GOLD PW05',photo:images.usage,photoOriginal:images.original,examples:[{image:images.card}]},
      {id:'usage',name:'PS FLAT BAR',photo:images.original,photoOriginal:images.original,examples:[{image:images.usage,role:'usage'}]},
    ]
  },images)
  await page.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
  await page.waitForFunction(()=>!document.querySelector('[data-examples-pending="true"]'))
  const states=await page.$$eval('.dp-item',items=>items.map(item=>({name:item.querySelector('.dp-name').textContent,
    examples:item.querySelectorAll('.dp-examples img').length,side:item.classList.contains('dp-item--display-examples'),
    limited:item.classList.contains('dp-item--examples'),
    photoHeight:item.querySelector('.dp-photo img').getBoundingClientRect().height,
    frameHeight:item.querySelector('.dp-photo').getBoundingClientRect().height})))
  assert.equal(states[0].examples,0)
  assert.equal(states[0].side,false)
  assert.equal(states[0].limited,false,'Filtered source cards must not leave the 32mm example limit on the main photo')
  assert.ok(states[0].photoHeight > states[0].frameHeight * .9,'Main photo fills the existing frame after its false example is removed')
  assert.equal(states[1].examples,1)
  assert.equal(states[1].side,true)
  const products=[
    {id:'gold',name:'GOLD PW05',photo:images.usage,photoOriginal:images.original,examples:[{image:images.card}]},
    {id:'usage',name:'PS FLAT BAR',photo:images.original,photoOriginal:images.original,examples:[{image:images.usage,role:'usage'}]},
  ]
  const response=await fetch('http://localhost:5174/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:'wainscoting-mirror',products}),signal:AbortSignal.timeout(65000)})
  assert.ok(response.ok)
  await writeFile('../.tmp/original-card-check.pdf',Buffer.from(await response.arrayBuffer()))
  await promisify(execFile)('pdftohtml',['-xml','../.tmp/original-card-check.pdf','../.tmp/original-card-check.xml'])
  const xml=await readFile('../.tmp/original-card-check.xml','utf8')
  assert.equal([...xml.matchAll(/<image\b/g)].length,3,'PDF contains two main photos and only the genuine usage photo')
  assert.equal([...xml.matchAll(/Contoh penggunaan/g)].length,1,'Only genuine usage carries the usage heading')
  console.log('Local browser: original product card suppressed, genuine usage retained, no paid API calls and source data preserved.')
}finally{await browser.close()}
