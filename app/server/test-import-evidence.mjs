import assert from 'node:assert/strict'
import { attachImportEvidence, sourceDocumentFor } from './import-evidence.mjs'

const first = sourceDocumentFor(Buffer.from('%PDF-version-one'), 'supplier.pdf', 3)
const second = sourceDocumentFor(Buffer.from('%PDF-version-two'), 'supplier.pdf', 3)
assert.notEqual(first.id, second.id, 'different source versions need different document identities')
const products = [{
  id: 'p1', name: 'P1', sourcePage: 2, readBy: 'rules', photo: 'photo', drawing: 'drawing',
  sourceBox: { x: .1, y: .2, w: .3, h: .2 }, sourceDrawingBox: { x: .5, y: .2, w: .2, h: .2 },
  finishes: [{ id: 'f1', name: 'Gold', photo: 'finish', sourceBox: { x: .1, y: .5, w: .1, h: .1 } }],
  examples: [{ image: 'usage', role: 'usage', sourceBox: { x: .3, y: .5, w: .2, h: .2 }, associationEvidence: 'verified-source-layout' }],
  imageAssociationIssues: ['Image ownership could not be confirmed'],
}]
attachImportEvidence(products, first)
assert.equal(products[0].sourceDocument.id, first.id)
assert.equal(products[0].sourceAssets.photo.role, 'main-product')
assert.equal(products[0].sourceAssets.drawing.role, 'dimension-drawing')
assert.equal(products[0].sourceAssets.choices[0].role, 'finish-sample')
assert.equal(products[0].sourceAssets.examples[0].role, 'application-photo')
assert.equal(products[0].importReviewFindings[0].code, 'uncertain-image-ownership')
assert.deepEqual(products[0].sourceAssets.photo.sourceBox, products[0].sourceBox)
console.log('Import evidence: document versions, page/box provenance, normalized asset roles and uncertain-ownership review findings preserved; deterministic local test only.')
