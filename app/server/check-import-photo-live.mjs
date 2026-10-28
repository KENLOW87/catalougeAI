// Explicit live verification helper: makes one paid image edit request.
import { readFile, writeFile } from 'node:fs/promises'
import { prepareImportPhotos } from './prepare-import-photos.mjs'
const source = `data:image/png;base64,${(await readFile('public/assets/pvc/corner-profile-v0.png')).toString('base64')}`
const products = [{ name: 'Live photo verification', photo: source, drawing: 'original-drawing-unchanged' }]
const result = await prepareImportPhotos(products, { onProgress: console.log })
if (result.failed) throw new Error(result.warnings.join('\n'))
if (products[0].drawing !== 'original-drawing-unchanged') throw new Error('Drawing changed')
await writeFile('../.tmp/import-photo-live.png', Buffer.from(products[0].photo.split(',')[1], 'base64'))
console.log('Live OpenAI photo preparation passed; drawing unchanged. Output: .tmp/import-photo-live.png')
