import { createHash } from 'node:crypto'

const box = value => value && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(value[key]))
  ? { x: value.x, y: value.y, w: value.w, h: value.h }
  : null

const asset = (role, sourcePage, sourceBox, method, extra = {}) => ({
  role,
  sourcePage,
  sourceBox: box(sourceBox),
  method,
  ...extra,
})

export function sourceDocumentFor(bytes, filename, pageCount) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return {
    id: `pdf:${sha256.slice(0, 24)}`,
    sha256,
    filename: String(filename || 'uploaded.pdf'),
    byteLength: bytes.length,
    pageCount,
    evidenceVersion: 1,
  }
}

// Apply one normalized evidence vocabulary after every reader path. It records
// what the system actually knows; it does not invent missing boxes or ownership.
export function attachImportEvidence(products, document) {
  for (const product of products) {
    product.sourceDocument = document
    const method = product.readBy || 'unknown'
    if (product.isPage) {
      product.sourceAssets = { page: asset('source-page', product.sourcePage, null, method) }
      continue
    }
    const sourceAssets = {}
    if (product.photo) sourceAssets.photo = asset('main-product', product.sourcePage, product.sourceBox, method)
    if (product.drawing) sourceAssets.drawing = asset('dimension-drawing', product.sourcePage, product.sourceDrawingBox, method, { preserveOriginal: true })
    if (product.extra) sourceAssets.extra = asset(product.extraRole === 'usage' ? 'application-photo' : product.extraRole === 'alternate-view' ? 'alternate-view' : 'source-reference', product.sourcePage, product.extraSourceBox, method)
    const choices = product.finishes ?? product.variants ?? []
    sourceAssets.choices = choices.filter(choice => choice.photo).map(choice => asset('finish-sample', product.sourcePage, choice.sourceBox, method, { id: choice.id, name: choice.name || '' }))
    sourceAssets.examples = (product.examples ?? []).filter(example => example.image).map(example => asset(
      example.role === 'usage' ? 'application-photo' : example.role === 'installation' ? 'installation-instruction' : example.role === 'alternate-view' ? 'alternate-view' : 'source-reference',
      product.sourcePage, example.sourceBox, method,
      { ownerProductId: example.ownerProductId ?? product.id, associationEvidence: example.associationEvidence ?? null },
    ))
    sourceAssets.references = (product.sourceReferences ?? []).filter(reference => reference.image).map(reference => asset(
      reference.reason === 'dimension-reference' ? 'dimension-drawing' : 'source-reference',
      product.sourcePage, reference.sourceBox, method, { reason: reference.reason || 'unclassified' },
    ))
    product.sourceAssets = sourceAssets
    const uncertain = [...(product.imageAssociationIssues ?? [])]
    if (uncertain.length) product.importReviewFindings = uncertain.map(message => ({
      code: 'uncertain-image-ownership', severity: 'warn', message,
    }))
  }
  return products
}
