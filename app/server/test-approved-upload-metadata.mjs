import assert from 'node:assert/strict'
import {adoptRuleProduct} from './ingest.mjs'
import {reconcile,applyReconcile} from '../src/lib/reconcile.js'
import {repairSourcePlacement} from '../src/lib/repair-source-placement.js'
let calls=0
globalThis.fetch=async()=>{calls++;throw new Error('Network forbidden: local metadata checks only')}
const source={name:'ZX88 New Catalogue Product',photo:'complete-original-photo',drawing:'complete-original-dimensions',drawingOriginal:'saved-dimensions',drawingPreserved:true,
 layoutFullRow:true,layoutPairGroup:'new-technical-set',layoutRowGroup:'new-source-row',supportStrip:'complete-shared-strip',supportCaption:'Original explanation',
 sourceBox:{x:.1,y:.2,w:.3,h:.4},sourceDrawingBox:{x:.5,y:.2,w:.4,h:.4},photoTreatmentMode:'preserve-scene',
 examples:[{image:'full-installation',caption:'Shared installation',role:'usage',displayWithProductCode:'ZX89',relatedProductCodes:['ZX88','ZX89']}],
 sourceReferences:[{image:'uncertain-source',reason:'Needs review'}]}
const before=structuredClone(source)
const draft=adoptRuleProduct(source,0,3,{category:'wainscoting-mirror',fields:[{type:'lineart'}]})
for(const key of ['photo','drawing','drawingOriginal','drawingPreserved','layoutFullRow','layoutPairGroup','layoutRowGroup','supportStrip','supportCaption','sourceBox','sourceDrawingBox','photoTreatmentMode','examples','sourceReferences'])
 assert.deepEqual(draft[key],source[key],`${key} must survive the actual reader-to-upload boundary`)
assert.equal(draft.sourcePage,3)
assert.deepEqual(source,before,'Adoption must not modify source crops or evidence')
const existing={...draft,id:'stable-product',layoutFullRow:true,layoutPairGroup:'accepted-technical-set',layoutRowGroup:'accepted-source-row'}
const plan=reconcile([existing],[{...draft,layoutPairGroup:'different-incoming-set'}])
const applied=applyReconcile(plan,{useDraft:new Set([draft.id])})[0]
assert.equal(applied.id,existing.id)
assert.equal(applied.layoutFullRow,true)
assert.equal(applied.layoutPairGroup,'accepted-technical-set')
assert.equal(applied.layoutRowGroup,'accepted-source-row')
assert.equal(applied.supportStrip,source.supportStrip)
assert.equal(applied.drawing,source.drawing)
assert.equal(applied.examples[0].displayWithProductCode,'ZX89')
assert.equal(applied.examples[0].ownerProductId,existing.id)
const validated=[{...applied,imageAssociationVersion:1}]
assert.equal(repairSourcePlacement(validated),validated,'New validated uploads bypass historical catalogue-specific image patches')
assert.equal(calls,0)
console.log('Actual upload adoption and re-import preserve full pictures, drawing pixels, source boxes/page, row/group/strip metadata, ownership and stable IDs for unrelated product codes. Zero API/PDF calls.')
