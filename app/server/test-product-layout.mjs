import assert from 'node:assert/strict'
import { readProductDimensions, readDimensionReference } from './read-dimensions.mjs'
import { attachProductExamples, validSourceBox, coversPrimaryPhoto } from './product-examples.mjs'
import { usageExamples, isDimensionReference, exampleHeading } from '../src/lib/product-layout.js'
const products = [{ name: 'Photo', photo: 'photo', drawing: 'original', subtitle: '172mm x 172mm x 35mm' }]
await readProductDimensions(products, { read: async () => ({ kind: 'photo-reference', confident: true, dimensions: '172mm x 172mm x 35mm(T)' }) })
assert.equal(products[0].drawingPresentation, 'dimensions')
assert.equal(products[0].drawing, 'original')
const sketch = [{ name: 'Sketch', photo: 'photo', drawing: 'technical-sketch' }]
await readProductDimensions(sketch, { read: async () => ({ kind: 'technical-sketch', confident: false, dimensions: '' }) })
assert.equal(sketch[0].drawingPresentation, undefined)
const mismatch = [{ name: 'Mismatch', photo: 'photo', drawing: 'original', subtitle: '300mm' }]
const warnings = await readProductDimensions(mismatch, { read: async () => ({ kind: 'photo-reference', confident: true, dimensions: '172mm' }) })
assert.ok(warnings.length)
assert.equal(mismatch[0].drawingPresentation, undefined)
const untrusted = await readDimensionReference('data:image/png;base64,AA==', { key: 'test', request: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ kind: 'photo-reference', confident: true, dimensions: 'unknown' }) } }] }) }) })
assert.equal(untrusted.confident, false)
const box = { x: .1, y: .1, w: .2, h: .2 }
const mirrors = [{ name: 'M04', photo: 'main4', drawing: 'original4' }, { name: 'M05', photo: 'main5', drawing: 'original5' }]
attachProductExamples(mirrors, [
  { name: 'M04', examples: [{ box: { ...box, y: .25 }, caption: 'Folded left' }, { box, caption: 'Back' }] },
  { name: 'M05', examples: [{ box, caption: 'Folded' }] },
  { name: 'Invented', examples: [{ box, caption: 'Ignore' }] },
], () => 'source-crop', () => ({ x: .1, y: .1, w: .2, h: .3 }))
assert.equal(mirrors.length, 2)
assert.equal(mirrors[0].examples.length, 2)
assert.equal(mirrors[1].examples.length, 1)
assert.equal(mirrors[0].photo, 'main4')
assert.equal(mirrors[0].drawingOriginal, undefined)
assert.equal(mirrors[0].drawing, 'original4')
const technical=[{name:'Reference',drawing:'complete-original'}]
attachProductExamples(technical,[{name:'Reference',examples:[{box,role:'drawing'}]}],()=> 'not-an-example')
assert.equal(technical[0].examples,undefined)
assert.equal(technical[0].drawing,'complete-original')
assert.equal(validSourceBox({ ...box, w: 2 }), false)
assert.equal(validSourceBox({ ...box, x: NaN }), false)
const installed = [{ name: 'Installed', photo: 'rectangular-scene' }]
attachProductExamples(installed, [{ name: 'Installed', preserveScene: true, examples: [] }], () => { throw new Error('No crop expected') })
assert.equal(installed[0].photoTreatmentMode, 'preserve-scene')
assert.equal(installed[0].photo, 'rectangular-scene')
assert.equal(coversPrimaryPhoto({x:.1,y:.1,w:.4,h:.6},{x:.15,y:.2,w:.2,h:.3}),true)
assert.equal(coversPrimaryPhoto({x:.6,y:.1,w:.2,h:.3},{x:.15,y:.2,w:.2,h:.3}),false)
assert.equal(usageExamples({photo:'p',extra:'product-card'}).length,0)
assert.equal(usageExamples({photo:'p',photoOriginal:'original',examples:[{image:'original'},{image:'p'},{image:'usage'}]}).length,1)
for (const caption of ['60mm (W) x 20mm (H) x 2440mm (L)', '40mm (W) x 20mm (H) x 2440mm (L)']) {
  assert.equal(isDimensionReference({caption}),true)
}
assert.equal(isDimensionReference({caption:'Folded to the left'}),false)
assert.equal(isDimensionReference({caption:'Installed 300mm above the floor'}),false)
assert.equal(exampleHeading([{image:'unverified-product-photo'}]),'Gambar tambahan')
assert.equal(exampleHeading([{caption:'Folded to the left'}]),'Contoh penggunaan')
assert.equal(exampleHeading([{role:'usage'}]),'Contoh penggunaan')
console.log('Measurements: original retained, sketches retained, conflicts/uncertainty safe. Examples: two products retained, grouped crops, no invented products, invalid boxes rejected.')
