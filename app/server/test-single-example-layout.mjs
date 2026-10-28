import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { writeFile, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{
  const page=await browser.newPage()
  await page.goto('http://localhost:5173',{waitUntil:'networkidle0'})
  const images=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=200;c.height=160
    const ctx=c.getContext('2d');ctx.fillStyle='#a48b67';ctx.fillRect(0,0,200,160)
    const photo=c.toDataURL();ctx.fillStyle='#397a9d';ctx.fillRect(0,0,200,160)
    return {photo,usage:c.toDataURL()}
  })
  const {photo,usage}=images
  const products=[
    {id:'flat',name:'PS FLAT BAR',photo,examples:[{image:usage,caption:'Installed example'}]},
    {id:'other',name:'Another product',photo,examples:[{image:usage,caption:'Usage'}]},
    {id:'legacy',name:'Legacy extra photo',photo,extra:usage,extraRole:'usage'},
    {id:'technical',name:'With technical drawing',photo,drawing:photo,examples:[{image:usage}]},
    {id:'multiple',name:'Multiple display photos',photo,examples:[{image:usage},{image:usage,caption:'Installed example'}]},
    {id:'both',name:'Drawing and multiple displays',photo,drawing:photo,examples:[{image:usage},{image:usage}]},
    {id:'four',name:'Four supplementary views',photo,examples:Array.from({length:4},()=>({image:usage}))},
    {id:'folding',name:'Folding instructions',photo,drawing:photo,examples:[{image:usage,caption:'Folded to the left'},{image:usage,caption:'Folded to the right'}]},
  ]
  await page.evaluateOnNewDocument(data=>{window.__CATALOGUE_CATEGORY__='wainscoting-mirror';window.__CATALOGUE_DATA__=data},products)
  await page.goto('http://localhost:5173/?print=1',{waitUntil:'networkidle0'})
  await page.waitForFunction(()=>!document.querySelector('[data-examples-pending="true"]'))
  const layout=await page.$$eval('.dp-item',items=>items.map(item=>{
    const main=item.querySelector('.dp-visuals').getBoundingClientRect()
    const example=item.querySelector('.dp-examples').getBoundingClientRect()
    const bounds=item.getBoundingClientRect()
    const image=item.querySelector('.dp-photo img').getBoundingClientRect()
    const displayedSizes=[...item.querySelectorAll('.dp-photo img,.dp-examples img')].map(img=>{
      const r=img.getBoundingClientRect(),scale=Math.min(r.width/img.naturalWidth,r.height/img.naturalHeight)
      return {width:img.naturalWidth*scale,height:img.naturalHeight*scale,fit:getComputedStyle(img).objectFit}
    })
    const displays=[...item.querySelectorAll('.dp-examples img')].map(i=>i.getBoundingClientRect())
    const displayCenter=displays.reduce((sum,r)=>sum+(r.top+r.bottom)/2,0)/displays.length
    return {side:item.classList.contains('dp-item--display-examples'),left:main.left,right:main.right,exampleLeft:example.left,
      sameRow:Math.abs(main.top-example.top)<1,aligned:Math.abs((image.top+image.bottom)/2-displayCenter)<1,
      displayedSizes,fit:[...item.querySelectorAll('img,.dp-name,.dp-sub,figcaption')].every(el=>{const r=el.getBoundingClientRect();return r.top>=bounds.top-1&&r.bottom<=bounds.bottom+1&&r.left>=bounds.left-1&&r.right<=bounds.right+1})}
  }))
  assert.equal(layout.length,8)
  for(const [index,item] of layout.slice(0,7).entries()){
    assert.ok(item.side&&item.sameRow&&item.fit,`Display stays beside its product: ${products[index].name} ${JSON.stringify(item)}`)
    assert.ok(item.aligned,`Product and display image centres align: ${products[index].name}`)
    assert.ok(item.exampleLeft>=item.right)
    for(const size of item.displayedSizes){
      assert.equal(size.fit,'contain')
      assert.ok(size.width>35*96/25.4,`Actual contained image must grow beyond the old 32mm cap: ${products[index].name} ${JSON.stringify(size)}`)
    }
  }
  assert.equal(layout[7].side,false,'Folding instructions keep their approved horizontal gallery')
  assert.ok(layout[7].fit)
  assert.equal(await page.$$eval('.dp-drawing-frame',frames=>frames.length),3,'All original technical drawings remain visible')
  assert.equal(await page.$$eval('.cat-page',pages=>pages.length),4)
  const response=await fetch('http://localhost:5174/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:'wainscoting-mirror',products}),signal:AbortSignal.timeout(65000)})
  assert.ok(response.ok)
  await writeFile('../.tmp/single-example-layout.pdf',Buffer.from(await response.arrayBuffer()))
  await promisify(execFile)('pdftohtml',['-xml','-zoom','1','../.tmp/single-example-layout.pdf','../.tmp/single-example-layout.xml'])
  const xml=await readFile('../.tmp/single-example-layout.xml','utf8')
  assert.equal([...xml.matchAll(/<page\s/g)].length,4)
  for(const product of products) assert.ok(xml.includes(product.name))
  const firstPage=xml.match(/<page\s[\s\S]*?<\/page>/)[0]
  const pdfImages=[...firstPage.matchAll(/<image\b[^>]*top="([\d.]+)"[^>]*left="([\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/g)].map(m=>({top:+m[1],left:+m[2],width:+m[3],height:+m[4]}))
  assert.equal(pdfImages.length,4)
  for(let i=0;i<4;i+=2){
    assert.ok(pdfImages[i+1].left>pdfImages[i].left,'Actual PDF puts the display on the right')
    assert.ok(Math.abs(pdfImages[i].top+pdfImages[i].height/2-pdfImages[i+1].top-pdfImages[i+1].height/2)<2,'Actual PDF photo centres align')
  }
  for(const image of pdfImages)assert.ok(image.width>75*72/25.4,'Actual exported product/display photos use the panel width, not a 32mm thumbnail')
  console.log('Display images stay on the right with matching centres, including multiple images and drawings; no overflow; folding gallery retained; browser/PDF retain four pages and order. No AI requests.')
}finally{await browser.close()}
