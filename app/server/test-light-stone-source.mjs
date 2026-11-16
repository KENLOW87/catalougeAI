import assert from 'node:assert/strict'
import { BUILTIN_SPECS } from './readers/specs.mjs'
import { sourceProfileForFilename } from './ingest.mjs'

const light = BUILTIN_SPECS.filter(spec => spec.id.startsWith('light-stone-wall-'))
assert.equal(light.length, 5, 'Light Stone must cover the cover plus four source product pages')
assert.equal(sourceProfileForFilename('Light Stone Panel (October 2026).pdf'), 'light-stone-wall')

const cover = light.find(spec => spec.id === 'light-stone-wall-cover')
assert.deepEqual(cover.nonProductPages, [1])

const pages = light.filter(spec => spec.id !== cover.id)
assert.deepEqual(pages.map(spec => spec.expectedAnchorCount), [4, 4, 1, 1])
assert.deepEqual(pages.flatMap(spec => spec.kinds[0].fields.find(f => f.key === 'name').codeByAnchor), [
  'LS01', 'LS02', 'LS03', 'LS04', 'LS05', 'LS06', 'LS04N', 'LS05N', 'LS07', 'ICP01',
])
assert.ok(pages.every(spec => spec.kinds[0].fields.find(f => f.key === 'photo').source))
assert.ok(pages.find(spec => spec.id.endsWith('-page-4')).kinds[0].supportStripByAnchor[0])
assert.equal(pages.find(spec => spec.id.endsWith('-page-5')).kinds[0].examplesByAnchor[0].length, 4)

console.log('Light Stone source reader: 5 source pages, 10 products, paired panel views and installation strips preserved.')
