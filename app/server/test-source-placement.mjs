import assert from 'node:assert/strict'
import {repairSourcePlacement} from '../src/lib/repair-source-placement.js'
const items=['CW02','CW03','CW04','WB06','M01 Full Mirror','M02 Quater Mirror'].map((name,i)=>({id:`p${i}`,name,photo:`photo-${name}`,drawing:`drawing-${name}`,examples:[]}))
for(const p of items.slice(0,3))p.examples=[{image:`complete-drawing-${p.name}`},...(p.name==='CW04'?[]:[{image:`installation-${p.name}`}])]
items[3].examples=[{image:'WB06-CW02'},{image:'WB06-CW03'}]
items[4].examples=[{image:'M01-A'},{image:'M01-B'},{image:'M02-installation'}]
const before=structuredClone(items),fixed=repairSourcePlacement(items)
assert.deepEqual(items,before,'Repair never mutates source objects')
assert.deepEqual(fixed.map(p=>p.id),items.map(p=>p.id),'Product order stays identical')
for(const p of fixed.slice(0,3)){
 assert.ok(p.drawing.startsWith('data:image/png;base64,'),'Complete reviewed source reference used')
 assert.equal(p.examples.some(e=>e.image.includes('drawing')),false)
 assert.equal(p.photo,`photo-${p.name}`)
 assert.deepEqual(p.sourcePlacementBackup.examples,before.find(b=>b.id===p.id).examples)
}
assert.deepEqual(fixed[4].examples.map(e=>e.image),['M01-A','M01-B'])
assert.deepEqual(fixed[5].examples.map(e=>e.image),['M02-installation'])
assert.deepEqual(fixed[3].examples.map(e=>e.relatedProductCodes),[['WB06','CW02'],['WB06','CW03']])
assert.equal(repairSourcePlacement(fixed),fixed,'Correction runs only once')
const unrelated=items.slice(1)
assert.equal(repairSourcePlacement(unrelated),unrelated)
const withCorners=[...fixed,{id:'csw1',name:'CSW - Coner Solid Wainscoting'},
 {id:'csw2',name:'CSW - Coner Wainscoting'},{id:'gold',name:'GOLD PW02'}]
const restored=repairSourcePlacement(withCorners)
assert.deepEqual(restored.slice(-5).map(p=>p.name),['CSW - Coner Solid Wainscoting','CSW - Coner Wainscoting','C-R80','C-R100','GOLD PW02'])
assert.equal(restored.filter(p=>p.layoutPairGroup==='csw-corners').length,2)
assert.equal(restored.filter(p=>p.layoutPairGroup==='aluminium-corners').length,2)
assert.equal(repairSourcePlacement(restored),restored,'Missing source products are inserted once')
console.log('Source placement: complete drawings restored verbatim, M02 usage moved from M01, shared WB06 installation identified, originals backed up and no product/image lost.')
