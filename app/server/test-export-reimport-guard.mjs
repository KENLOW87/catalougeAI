import assert from 'node:assert/strict'
import {
  isCatalogueAiExportMetadata,
  isKnownLocalCatalogueFilename,
} from './ingest.mjs'

assert.equal(isCatalogueAiExportMetadata(`
Title:           GEOMETRA — Catalogue AI
Creator:         HeadlessChrome
Producer:        Skia/PDF m141
Pages:           12
`), true, 'the app export must be rejected')

assert.equal(isCatalogueAiExportMetadata(`
Title:           Accessories (March 2026)
Creator:         Adobe Illustrator 27.9 (Windows)
Producer:        Adobe PDF library 17.00
Pages:           12
`), false, 'the original supplier PDF must remain importable')

assert.equal(isCatalogueAiExportMetadata(`
Title:           GEOMETRA — Catalogue AI
Creator:         Adobe Illustrator
Producer:        Adobe PDF library
`), false, 'a matching title alone is not enough to reject a source')

assert.equal(isKnownLocalCatalogueFilename('Accessories (March 2026).pdf'), true)
assert.equal(isKnownLocalCatalogueFilename('Wainscoting, Cornering & Mirror (Sept 2026).pdf'), true)
assert.equal(isKnownLocalCatalogueFilename('Unfamiliar supplier.pdf'), false)

console.log('export re-import guard tests passed')
