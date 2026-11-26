import assert from 'node:assert/strict'
import express from 'express'
import puppeteer from 'puppeteer-core'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { installActivity, malaysiaDate } from './activity.mjs'

const directory = mkdtempSync(join(tmpdir(), 'catalogue-activity-browser-'))
const originalFetch = globalThis.fetch
const app = express(); app.use(express.json({ limit: '5mb' }))
app.use((req,res,next) => { res.setHeader('Access-Control-Allow-Origin','http://localhost:5173'); res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Activity-Job-ID,X-Activity-Origin,X-Catalogue-Into,X-Catalogue-Filename,X-Upload-Bytes'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); if(req.method==='OPTIONS') return res.sendStatus(204); next() })
let providerCalls = 0, forbidden = 0, ledgerUnavailable = false
const store = installActivity(app, { directory, request: async (url, options) => {
  if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options)
  providerCalls++
  return new Response(JSON.stringify({ model: 'gpt-4o-2024-08-06', usage: { prompt_tokens: 1000, completion_tokens: 100 }, choices: [{ message: { content: 'mock' } }] }), { headers: { 'content-type': 'application/json', 'x-request-id': 'browser-mock-request' } })
} })
app.get('/api/ai/status', (req,res) => res.json({ ready:true, openai:true }))
app.get('/api/ingest/status', (req,res) => res.json({ aiFallback:true }))
app.post('/api/interpret', async (req,res) => {
  await (await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', body:JSON.stringify({ model:'gpt-4o' }) })).json()
  res.json({ kind:'answer', text:'Mock AI answer for usage audit.' })
})
for (const path of ['/api/ingest', '/api/ingest-pdf']) app.post(path, (req,res) => { res.type('application/x-ndjson').end(JSON.stringify({ done: { products:[], routing:{ filename:'usage-test.pdf' } } })+'\n') })
const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve))
const mockRoot = `http://127.0.0.1:${server.address().port}`
const browser = await puppeteer.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true })
try {
  const page = await browser.newPage(); await page.setViewport({width:1440,height:1000})
  const errors=[]; page.on('pageerror',error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    const url=new URL(request.url())
    if(url.pathname.startsWith('/api/')) {
      if (ledgerUnavailable && url.pathname === '/api/activity/events') return request.respond({ status:503, headers:{'Access-Control-Allow-Origin':'http://localhost:5173','Access-Control-Allow-Headers':'Content-Type'},contentType:'application/json',body:'{"error":"mock temporarily offline"}' })
      if(['/api/image/edit','/api/export'].includes(url.pathname)) { forbidden++; return request.abort() }
      return request.continue({url:mockRoot+url.pathname+url.search})
    }
    if(/^https?:/.test(url.protocol)&&!['localhost','127.0.0.1'].includes(url.hostname)){forbidden++;return request.abort()}
    request.continue()
  })
  await page.goto('http://localhost:5173',{waitUntil:'networkidle0'})
  const image=await page.evaluate(() => {const c=document.createElement('canvas');c.width=120;c.height=180;const ctx=c.getContext('2d');ctx.fillStyle='#997755';ctx.fillRect(0,0,120,180);return c.toDataURL()})
  await page.evaluate(async image => {
    await (await import('/src/lib/store.js')).saveCatalogue('wainscoting-mirror',[{id:'usage-product',name:'WB01',photo:image}])
    localStorage.setItem('geometra.activeCategory','wainscoting-mirror');sessionStorage.setItem('geometra.view','catalogue')
  },image)
  await page.reload({waitUntil:'networkidle0'});await page.click('[aria-label="Catalogue assistant"]')
  const png=new PNG({width:40,height:60});png.data.fill(255);const filename=join(directory,'display.png');writeFileSync(filename,PNG.sync.write(png))
  await(await page.$('.bot-photo-input')).uploadFile(filename);await page.waitForSelector('.bot-attachment img')
  async function ask(text,expected) {await page.type('.bot-dock input[placeholder]',text);await page.click('.bot-dock button[type="submit"]');await page.waitForFunction(expected=>document.querySelector('.bot-dock').textContent.includes(expected),{},expected)}
  await ask('How many products?','1')
  await ask('Boleh terangkan apa pilihan saya untuk susunan katalog ini?','Mock AI answer')
  await page.evaluate(async () => { await (await import('/src/lib/activity.js')).flushActivity() })
  let report=store.report(malaysiaDate(),true)
  assert.equal(report.summary.imageUploads,1)
  assert.equal(report.summary.botCommands,2)
  assert.equal(report.summary.openaiCalls,1)
  assert.equal(report.summary.estimatedUsd,.0035)
  assert.equal(report.jobs.find(j=>j.kind==='upload.image').credit,'none')
  assert.equal(report.jobs.filter(j=>j.kind==='bot.command'&&j.calls.length===1).length,1)
  ledgerUnavailable=true
  await(await page.$('.bot-photo-input')).uploadFile(filename)
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('catalogue-activity-outbox-v1')||'[]').length>=2)
  await page.reload({waitUntil:'networkidle0'})
  assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('catalogue-activity-outbox-v1')||'[]').length)>=2,'offline events retained through reload')
  ledgerUnavailable=false
  await page.evaluate(async()=>await(await import('/src/lib/activity.js')).flushActivity())
  assert.equal(store.report(malaysiaDate(),true).summary.imageUploads,2,'queued upload recovered once')
  // A real browser upload, but the local mock reader returns no products/AI.
  await page.evaluate(()=>sessionStorage.setItem('geometra.view','dashboard'))
  await page.reload({waitUntil:'networkidle0'})
  await page.click('.dashboard-head-actions .primary')
  const pdf=join(directory,'usage-test.pdf');writeFileSync(pdf,'%PDF-1.4\n% local test fixture, intercepted before any reader\n%%EOF')
  await(await page.$('input[type="file"][accept="application/pdf,image/*"]')).uploadFile(pdf)
  await page.waitForFunction(()=>document.querySelector('.modal')?.textContent.includes('usage-test')||!document.querySelector('.working'))
  await page.evaluate(async()=>{await(await import('/src/lib/activity.js')).flushActivity();sessionStorage.setItem('geometra.view','dashboard')})
  await page.reload({waitUntil:'networkidle0'})
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Aktiviti & Kos').click())
  await page.waitForSelector('.activity-panel table')
  assert.equal((await page.$$('.activity-panel tbody tr')).length,0,'test activities hidden by default')
  await page.click('.activity-panel input[type="checkbox"]')
  await page.waitForFunction(()=>document.querySelectorAll('.activity-panel tbody tr').length===5)
  assert.match(await page.$eval('.activity-panel',el=>el.textContent),/\$0\.003500/)
  mkdirSync('.tmp/audit',{recursive:true});await page.screenshot({path:'.tmp/audit/activity-monitor.png'})
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.activity-panel'))
  report=store.report(malaysiaDate(),true)
  assert.equal(report.summary.pdfUploads,1)
  assert.equal(providerCalls,1);assert.equal(forbidden,0);assert.deepEqual(errors,[])
  console.log('PASS actual browser: attachment upload, free local bot answer, mocked AI command linked to USD cost, PDF upload, reload persistence and monitor/test filter. No paid AI calls, image edits or exports; isolated catalogue and ledger.')
} finally {await browser.close();globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true})}
