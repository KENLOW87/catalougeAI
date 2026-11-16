// Cheap regression for the source profiles that previously fell through to the
// generic/paid reader.  It checks the local catalogue geometry contract only;
// the full PDF smoke check is run separately against the supplier fixtures.
import assert from 'node:assert/strict'
import { sourceProfileForFilename } from './ingest.mjs'
import { BUILTIN_SPECS } from './readers/specs.mjs'

assert.equal(sourceProfileForFilename('PVC Marble Sheet 3D (September 2025).pdf'), 'pvc-marble-sheet-3d')
assert.equal(sourceProfileForFilename('PVC Marble Sheet (Jan 2026).pdf'), 'pvc-marble-sheet-grid')
assert.equal(sourceProfileForFilename('Acoustic Panel (August 2025).pdf'), 'acoustic-panel')
assert.equal(sourceProfileForFilename('Acoustic Panel (Nov 2024).pdf'), 'acoustic-panel-2024')

const pvc3d = BUILTIN_SPECS.filter(s => s.sourceProfile === 'pvc-marble-sheet-3d' && s.expectedAnchorCount)
assert.deepEqual(pvc3d.map(s => s.expectedAnchorCount), [2, 2, 3, 3, 2, 3, 3, 2, 3])
assert.equal(pvc3d.reduce((n, s) => n + s.expectedAnchorCount, 0), 23)

const acoustic = BUILTIN_SPECS.filter(s => s.sourceProfile === 'acoustic-panel' && s.expectedAnchorCount)
assert.deepEqual(acoustic.map(s => s.expectedAnchorCount), [1, 1, 1, 1])
const acoustic2024 = BUILTIN_SPECS.filter(s => s.sourceProfile === 'acoustic-panel-2024' && s.expectedAnchorCount)
assert.deepEqual(acoustic2024.map(s => s.expectedAnchorCount), [2])

console.log('Known source readers: PVC Marble Sheet 3D=23 products, Acoustic Panel=4 products, local-only routing profiles present.')
