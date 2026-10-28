import assert from 'node:assert/strict'
import {validateImportedAssociations,resolveAssociation} from './image-association.mjs'
import {repairSourcePlacement} from '../src/lib/repair-source-placement.js'
import {reconcile,applyReconcile} from '../src/lib/reconcile.js'
import {matchesRenderedPhoto} from './native-photo-evidence.mjs'
const box=(x,y,w=.2,h=.1)=>({x,y,w,h})
const a={id:'a',name:'ZX41 New Product',categoryId:'unrelated-catalogue',sourcePage:3,photo:'main-a',drawing:'full-drawing-a',sourceBox:box(.05,.1),sourceDrawingBox:box(.3,.1,.2,.2)}
const b={id:'b',name:'ZX42 Other Product',categoryId:a.categoryId,sourcePage:3,photo:'main-b',sourceBox:box(.05,.55)}
const originalDrawing=a.drawing
a.examples=[
 {image:'installation-b',sourceBox:box(.7,.55,.2,.2),role:'usage'},
 {image:'drawing-again',sourceBox:box(.3,.1,.2,.2),role:'usage'},
 {image:'original-card',sourceBox:box(.03,.08,.25,.16),role:'usage'},
 {image:'uncertain',sourceBox:box(.7,.34,.1,.1)},
 {image:'joint-installation',role:'usage',sourceBox:box(.7,.15)},
]
let paidCalls=0
globalThis.fetch=async()=>{paidCalls++;throw new Error('Paid/network calls forbidden')}
const warnings=await validateImportedAssociations([a,b],{readText:async image=>({
 'installation-b':'ZX42','joint-installation':'ZX41 ZX42',
})[image]||''})
assert.equal(paidCalls,0)
assert.deepEqual(b.examples.map(e=>e.image),['installation-b'])
assert.equal(b.examples[0].ownerProductId,'b')
assert.equal(a.drawing,originalDrawing)
assert.deepEqual(a.examples.map(e=>e.image),['joint-installation'])
assert.deepEqual(a.examples[0].relatedProductCodes,['ZX41 New Product','ZX42 Other Product'])
assert.ok(a.sourceReferences.some(e=>e.image==='uncertain'))
assert.ok(a.sourceReferences.some(e=>e.image==='drawing-again'))
assert.ok(a.sourceReferences.some(e=>e.image==='original-card'))
assert.ok(warnings.length && a.imageAssociationIssues.length)
assert.equal(resolveAssociation({image:'technical',role:'drawing',sourceText:'ZX42 Size 30mm x 40mm'},a,[a,b]).kind,'drawing')
const old={id:'stable',name:a.name,layoutPairGroup:'accepted-pair',layoutRowGroup:'accepted-source-row',layoutFullRow:true}
const plan=reconcile([old],[{...a,layoutPairGroup:'wrong-new-layout'}])
assert.equal(applyReconcile(plan,{useDraft:new Set(['a'])})[0].layoutPairGroup,'accepted-pair')
assert.equal(applyReconcile(plan,{useDraft:new Set(['a'])})[0].layoutRowGroup,'accepted-source-row')
assert.equal(applyReconcile(plan,{useDraft:new Set(['a'])})[0].layoutFullRow,true)
const newImport=['CW02','CW03','CW04','WB06','M01 Full Mirror','M02 Quater Mirror'].map((name,i)=>({id:`new${i}`,name,imageAssociationVersion:1,photo:'new-source'}))
assert.equal(repairSourcePlacement(newImport),newImport,'Legacy fixes never replace a future upload with this catalogue\'s source assets')
const pixels={width:16,height:16,data:Buffer.alloc(16*16*4)}
for(let i=0;i<16*16;i++){const v=i%16<8?30:220;pixels.data.set([v,v,v,255],i*4)}
const foreign={...pixels,data:Buffer.from(pixels.data)}
for(let i=0;i<16*16;i++){const v=i%16<8?220:30;foreign.data.set([v,v,v,255],i*4)}
assert.equal(matchesRenderedPhoto(pixels,pixels),true)
assert.equal(matchesRenderedPhoto(foreign,pixels),false,'Reused PDF rectangles cannot substitute another native product photo')
console.log('Generic upload validation: foreign ownership corrected, drawings/cards excluded, uncertain images retained for review, shared installations identified, accepted layout retained, legacy overrides skipped; zero network calls.')
