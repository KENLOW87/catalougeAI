import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { findProductExamples } from './product-examples.mjs'
import { readImage, crop, toBuffer } from './imageops.mjs'
// Analyse the original PDF photograph on the left, not the already-damaged
// catalogue preview shown beside it in the user's comparison screenshot.
const original = readImage('C:/Users/admin/AppData/Local/Temp/codex-clipboard-fe596462-eaaf-494f-813b-20be61322852.png')
const image = `data:image/png;base64,${toBuffer(crop(original, 37, 137, 673, 445)).toString('base64')}`
const groups = await findProductExamples(image, ['HM01 RIGHT', 'HM01 LEFT'])
console.log(JSON.stringify(groups.map(p => ({ name: p.name, preserveScene: p.preserveScene }))))
assert.equal(groups.length, 2)
assert.ok(groups.every(p => p.preserveScene))
console.log('Live context recognition: both HM01 images must retain their original rectangular scenes.')
