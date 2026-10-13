// Reconciling an imported PDF against the catalogue already in the system.
import { reconcile, applyReconcile, diffOf } from '../src/lib/reconcile.js'

let failures = 0
const check = (cond, msg) => { console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`); if (!cond) failures++ }
const names = list => list.map(p => p.name).join(' ')

const P = (id, name, extra = {}) => ({ id, name, ...extra })

console.log('\n== the client\'s scenario ==')
// system: PV1 PV2 PV4      PDF: PV1 PV2 PV3 PV4
{
  const existing = [P('e1', 'PV1'), P('e2', 'PV2'), P('e3', 'PV4')]
  const drafts = [P('d1', 'PV1'), P('d2', 'PV2'), P('d3', 'PV3'), P('d4', 'PV4')]
  const r = reconcile(existing, drafts)
  check(r.matched.length === 3, `3 already in the catalogue (${r.matched.map(m => m.draft.name).join(', ')})`)
  check(r.added.length === 1 && r.added[0].name === 'PV3', 'PV3 is the only new one')
  check(r.missing.length === 0, 'nothing in the system is absent from the PDF')

  const out = applyReconcile(r)
  check(names(out) === 'PV1 PV2 PV3 PV4', `result follows the PDF: ${names(out)}`)
  check(out[3].id === 'e3', 'PV4 kept its original id — it moved, it was not recreated')
  check(out.length === 4, 'no duplicates')
}

console.log('\n== duplicate names pair up in order ==')
// "L Profile" appears twice in PVC Marble, told apart only by its drawing.
{
  const existing = [P('e1', 'L Profile', { size: '14mm' }), P('e2', 'L Profile', { size: '10mm' })]
  const drafts = [P('d1', 'L Profile', { size: '14mm' }), P('d2', 'L Profile', { size: '10mm' })]
  const r = reconcile(existing, drafts)
  check(r.matched.length === 2 && r.added.length === 0, 'both matched, neither treated as new')
  check(r.matched[0].existing.id === 'e1' && r.matched[1].existing.id === 'e2',
    'paired in order, not both onto the first')
  check(r.matched.every(m => m.ambiguous), 'and flagged as matched by position, not name alone')
}

console.log('\n== a product the PDF does not mention ==')
{
  const existing = [P('e1', 'PV1'), P('e2', 'PV5')]
  const drafts = [P('d1', 'PV1')]
  const r = reconcile(existing, drafts)
  check(r.missing.length === 1 && r.missing[0].name === 'PV5', 'PV5 reported as not in this PDF')

  const kept = applyReconcile(r)
  check(names(kept) === 'PV1 PV5', `kept by default: ${names(kept)}`)

  const dropped = applyReconcile(r, { dropMissing: new Set(['e2']) })
  check(names(dropped) === 'PV1', 'removed only when explicitly chosen')
}

console.log('\n== choosing between current and the PDF version ==')
{
  const existing = [P('e1', 'PV1', { colour: 'Silver', photo: 'OLD' })]
  const drafts = [P('d1', 'PV1', { colour: 'Rose Gold', photo: 'NEW' })]
  const r = reconcile(existing, drafts)
  check(r.matched[0].diffs.length === 1 && r.matched[0].diffs[0].field === 'colour',
    'the colour change is detected')
  check(r.matched[0].diffs[0].from === 'Silver' && r.matched[0].diffs[0].to === 'Rose Gold',
    'showing both values')

  check(applyReconcile(r)[0].photo === 'OLD', 'keeps the current version by default')
  const taken = applyReconcile(r, { useDraft: new Set(['d1']) })
  check(taken[0].photo === 'NEW' && taken[0].id === 'e1',
    'takes the PDF version on request, keeping the original id')
}

console.log('\n== images are never diffed ==')
{
  // Re-extracting the same photo yields different bytes each time, so comparing
  // them would mark everything as changed and the signal would be worthless.
  const a = P('e1', 'PV1', { colour: 'Silver', photo: 'bytes-A' })
  const b = P('d1', 'PV1', { colour: 'Silver', photo: 'bytes-B' })
  check(diffOf(a, b).length === 0, 'a different photo alone is not reported as a change')
}

console.log('\n== skipping a new product ==')
{
  const existing = [P('e1', 'PV1')]
  const drafts = [P('d1', 'PV1'), P('d2', 'PV2')]
  const r = reconcile(existing, drafts)
  check(names(applyReconcile(r)) === 'PV1 PV2', 'added by default')
  check(names(applyReconcile(r, { skipAdded: new Set(['d2']) })) === 'PV1', 'skipped on request')
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures ? 1 : 0)
