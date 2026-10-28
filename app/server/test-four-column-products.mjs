import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => {
    const c=document.createElement('canvas');c.width=100;c.height=160
    c.getContext('2d').fillRect(0,0,100,160)
    const image=c.toDataURL()
    window.__CATALOGUE_CATEGORY__='wainscoting-mirror'
    window.__CATALOGUE_DATA__=Array.from({length:8},(_,i)=>({id:`p${i}`,name:`Product ${i+1}`,photo:image,
      ...(i<4?{examples:[{image:image+'#reference',caption:'60mm (W) x 20mm (H) x 2440mm (L)'}]}:
        {drawing:image,drawingPresentation:'dimensions',dimensionText:'60mm x 20mm x 2440mm'})
    }))
  })
  await page.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
  await page.waitForFunction(()=>!document.querySelector('[data-examples-pending="true"]'))
  const result=await page.evaluate(()=>({pages:document.querySelectorAll('.cat-page').length,
    rows:[...document.querySelectorAll('.dp-row')].map(row=>[...row.querySelectorAll('.dp-item')].map(item=>({
      name:item.querySelector('.dp-name').textContent,top:item.getBoundingClientRect().top,
      height:item.getBoundingClientRect().height,photo:item.querySelector('.dp-photo img').getBoundingClientRect().height
    }))),examples:document.querySelectorAll('.dp-examples').length,drawings:document.querySelectorAll('.dp-drawing-frame').length}))
  assert.equal(result.pages,1)
  assert.deepEqual(result.rows.map(row=>row.length),[4,4])
  assert.equal(result.examples,0);assert.equal(result.drawings,0)
  for(const row of result.rows){
    assert.equal(new Set(row.map(p=>p.top)).size,1)
    for(const p of row)assert.ok(p.photo>p.height*.8,'Photos use their existing grid frame')
  }
  await page.emulateMediaType('print')
  const pdf=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true})
  assert.equal([...Buffer.from(pdf).toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,1)
  console.log('Eight ordinary products: four per row, two rows, one exported page; hidden reference cards/drawings do not reserve full rows.')
} finally {await browser.close()}
