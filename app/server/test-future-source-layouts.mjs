import assert from 'node:assert/strict'
import {readWithSpec} from './readers/spec.mjs'
import {fixedLayoutMatches} from './readers/fixed-layout-match.mjs'
import {BUILTIN_SPECS} from './readers/specs.mjs'
import {readImage} from './imageops.mjs'
import {validateImportedAssociations} from './image-association.mjs'
import {PNG} from 'pngjs'
let calls=0
globalThis.fetch=async()=>{calls++;throw new Error('Network disabled in source regression test')}

// PVC Marble Sheet 3D prints one composed product image containing several
// labelled panels. The suffix is part of that one product image, never a
// separate cropped product card.
const threeDPages = BUILTIN_SPECS.filter(spec => /^pvc-marble-sheet-3d-page-/.test(spec.id))
assert.equal(threeDPages.length, 9)
for (const spec of threeDPages) {
 assert.equal(spec.expectedAnchorCount, 1, `${spec.id} has one composed product anchor`)
 const fields = spec.kinds[0].fields
 assert.ok(fields.some(field => field.key === 'photo'), `${spec.id} keeps the composed product photo`)
 assert.ok(fields.some(field => field.key === 'drawing'), `${spec.id} keeps the dimension reference`)
}
const blank3dPage = new PNG({width: 2100, height: 3000})
blank3dPage.data.fill(255)
const grouped3d = await readWithSpec(blank3dPage, {...threeDPages[0], anchor: {...threeDPages[0].anchor, pageNo: 2}})
assert.equal(grouped3d.products.length, 1, '3D-1A and 3D-1B are one composed product')
assert.equal(grouped3d.products[0].variantTechnical, undefined)
assert.equal(grouped3d.products[0].name, '3D-1A & 1B')
for(const [id,pageNo,counts] of [
 ['wainscoting-flat-bar-display',3,[1]],
 ['wainscoting-mirror-cards',8,[2,1,1]],
 ['wainscoting-corner-flower',5,[1,1,0]],
 ['wainscoting-mirror-folded',9,[4,3]],
 ['wainscoting-wave-crystal-brick',7,[2,2]],
 ['wainscoting-corner-edge',4,[0,0]],
 ['wainscoting-csw-complete',4,[0,0]],
 ['wainscoting-bendable-profiles',5,[4,0,0,2]],
]){
 const page=readImage(pageNo===3?'../.tmp/source-page3-03.png':`../.tmp/wains-inspect/page-${String(pageNo).padStart(2,'0')}.png`)
 const spec=BUILTIN_SPECS.find(s=>s.id===id)
 const result=await readWithSpec(page,{...spec,anchor:{...spec.anchor,pageNo}})
 assert.equal(result.products.length,counts.length,id)
 const products=result.products.map((p,i)=>({...p,id:`${id}-${i}`,categoryId:'test',sourcePage:pageNo,
   sourceBox:p.__sourceBoxes.photo?{x:p.__sourceBoxes.photo.x/page.width,y:p.__sourceBoxes.photo.y/page.height,w:p.__sourceBoxes.photo.w/page.width,h:p.__sourceBoxes.photo.h/page.height}:null,
   sourceDrawingBox:p.__sourceBoxes.drawing?{x:p.__sourceBoxes.drawing.x/page.width,y:p.__sourceBoxes.drawing.y/page.height,w:p.__sourceBoxes.drawing.w/page.width,h:p.__sourceBoxes.drawing.h/page.height}:null}))
 await validateImportedAssociations(products,{readText:async()=>''})
 assert.deepEqual(products.map(p=>p.examples.length),counts,id)
 assert.ok(products.every(p=>p.photo),'Every product, including C-R80/C-R100, has its own source photo')
 if(pageNo===8){
  const image=PNG.sync.read(Buffer.from(products[2].photo.split(',')[1],'base64'))
  assert.ok(image.width>=148&&image.height>=130,'M03 source crop contains the complete product')
 }
 if(id==='wainscoting-corner-flower')for(const p of products){
  const drawing=PNG.sync.read(Buffer.from(p.drawing.split(',')[1],'base64'))
  assert.ok(drawing.width>=235&&drawing.height>=179,'Complete dimension reference, never just the ruler strip')
 }
 if(id==='wainscoting-csw-complete'){
  assert.ok(products.every(p=>p.layoutFullRow&&p.drawingPreserved))
  const photo=PNG.sync.read(Buffer.from(products[1].photo.split(',')[1],'base64'))
  assert.ok(photo.width>=132&&photo.height>=98,'Complete corner arch, including both tips')
 }
 if(pageNo===9)assert.ok(products.every(p=>p.drawingPreserved),'Original drawings are not collapsed or resized by a later AI reading')
 if(id==='wainscoting-bendable-profiles'){
  assert.ok(products.every(p=>p.layoutRowGroup==='wains-bendable-profiles'),'Every WB card remains in its source four-product row')
  const strip=PNG.sync.read(Buffer.from(products[0].supportStrip.split(',')[1],'base64'))
  assert.ok(strip.width>=774&&strip.height>=179,'Keep the full panoramic source band, including its explanation')
 }
}
const sample=readImage('../.tmp/wains-inspect/page-08.png')
const spec=BUILTIN_SPECS.find(s=>s.id==='wainscoting-mirror-cards')
assert.equal(await fixedLayoutMatches(sample,spec,8,{readText:async()=> 'OTHER PRODUCTS AB77 AB88'}),false)
const codes=['M01','M02','M03'];let i=0
assert.equal(await fixedLayoutMatches(sample,spec,8,{readText:async()=>codes[i++]}),true)
const cover=BUILTIN_SPECS.find(s=>s.nonProductPages)
assert.equal(await fixedLayoutMatches(sample,cover,1,{readText:async()=> 'PVC MARBLE PV01 PV02'}),false)
const flat=BUILTIN_SPECS.find(s=>s.id==='wainscoting-flat-bar-display')
assert.equal(await fixedLayoutMatches(sample,flat,3,{readText:async()=> 'OTHER CATALOGUE ZX11'}),false,'A different PDF must never receive historical Flat Bar crops')
assert.equal(calls,0)
console.log('Future upload source readers: complete M03/CW drawings, correct M01/M02/M03 ownership, M04 four/M05 three examples, C-R photos included, unrelated PDFs reject fixed source templates; zero network calls.')
