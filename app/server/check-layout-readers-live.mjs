import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { readDimensionReference } from './read-dimensions.mjs'
import { findProductExamples } from './product-examples.mjs'
const input = 'C:/Users/admin/AppData/Local/Temp/'
const sizeImage = `data:image/png;base64,${(await readFile(input + 'codex-clipboard-f1af4993-c293-4292-be62-15001002ea9b.png')).toString('base64')}`
const reference = await readDimensionReference(sizeImage)
console.log('Measurement reading:', JSON.stringify(reference))
assert.equal(reference.kind, 'photo-reference')
assert.ok(reference.dimensions.includes('172') && reference.dimensions.includes('35'))
const page = `data:image/png;base64,${(await readFile(input + 'codex-clipboard-f8748af0-97c7-4626-8d14-507402f25be1.png')).toString('base64')}`
const examples = await findProductExamples(page, ['M04 Full Diamond Mirror', 'M05 Bronze Brick Mirror'])
console.log('Example groups:', JSON.stringify(examples.map(p => ({ name: p.name, examples: p.examples?.length }))))
assert.equal(examples.length, 2)
assert.equal(examples.find(p => p.name.startsWith('M04')).examples.length, 4)
assert.equal(examples.find(p => p.name.startsWith('M05')).examples.length, 3)
await writeFile('../.tmp/layout-reader-live.json', JSON.stringify({ reference, examples }, null, 2))
console.log('Live readers passed on both user reference images.')
