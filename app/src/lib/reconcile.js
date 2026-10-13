// Reconciling an imported PDF against what is already in the catalogue.
//
// Importing used to just append, so re-importing a catalogue that shared products
// with the system produced duplicates and left the order wrong. What is actually
// wanted is a merge: products already there stay, genuinely new ones are inserted
// at the position the PDF gives them, and the result follows the PDF's order.
//
// Matching is by product NAME, because in this catalogue the name IS the code.
//
// BUT names are not unique — "L Profile" appears twice in PVC Marble, told apart
// only by its dimension drawing. So matching pairs up same-named products IN ORDER
// rather than assuming one match per name.

export const norm = s => (s ?? '').trim().replace(/\s+/g, ' ')
const key = s => norm(s).toLowerCase()

/** Text fields worth comparing. Images are never diffed — see below. */
const TEXT_FIELDS = ['colour', 'length', 'size', 'series', 'subtitle', 'third']

const finishNames = p =>
  (p.variants ?? p.finishes ?? []).map(f => norm(f.name)).filter(Boolean)

/**
 * @returns {{
 *   matched: Array<{existing, draft, diffs: Array<{field, from, to}>, ambiguous: boolean}>,
 *   added: Array<object>,
 *   missing: Array<object>,
 * }}
 */
export function reconcile(existing, drafts) {
  // Bucket by name so duplicates pair up in order rather than all matching the first.
  const pool = new Map()
  existing.forEach((p, i) => {
    const k = key(p.name)
    if (!pool.has(k)) pool.set(k, [])
    pool.get(k).push({ p, i })
  })

  const matched = []
  const added = []
  const usedIdx = new Set()

  for (const draft of drafts) {
    const k = key(draft.name)
    const bucket = pool.get(k)
    if (bucket && bucket.length) {
      const { p, i } = bucket.shift()
      usedIdx.add(i)
      matched.push({
        existing: p,
        draft,
        diffs: diffOf(p, draft),
        // Flag a match that relied on order because several share the name.
        ambiguous: existing.filter(e => key(e.name) === k).length > 1,
      })
    } else {
      added.push(draft)
    }
  }

  const missing = existing.filter((_, i) => !usedIdx.has(i))
  // Keep the PDF's own sequence: that is the order the result must follow, and it
  // is lost if matched and added drafts are concatenated separately.
  return { matched, added, missing, pdfOrder: drafts }
}

/**
 * Differences worth showing.
 *
 * Images are deliberately NOT compared. Re-extracting the same photo produces
 * different bytes every time, so a byte comparison would mark every product as
 * changed and the signal would be worthless. Instead the review screen shows the
 * current image beside the PDF's and lets the user pick.
 */
export function diffOf(existing, draft) {
  const out = []
  for (const f of TEXT_FIELDS) {
    if (!(f in draft) && !(f in existing)) continue
    const from = norm(existing[f]), to = norm(draft[f])
    if (from !== to && to) out.push({ field: f, from, to })
  }
  const a = finishNames(existing).join(' / ')
  const b = finishNames(draft).join(' / ')
  if (a !== b && b) out.push({ field: 'finishes', from: a || '—', to: b })
  return out
}

/**
 * Builds the final product list.
 *
 * Order follows the PDF for everything the PDF mentions. Products kept but absent
 * from the PDF keep their relative order and go after — the PDF is the authority on
 * sequence, so anything it does not mention cannot be placed within it.
 *
 * @param decisions.useDraft  Set of draft ids to take from the PDF instead of keeping current
 * @param decisions.skipAdded Set of draft ids NOT to add
 * @param decisions.dropMissing Set of existing ids to remove
 */
export function applyReconcile({ matched, missing, pdfOrder }, decisions = {}) {
  const useDraft = decisions.useDraft ?? new Set()
  const skipAdded = decisions.skipAdded ?? new Set()
  const dropMissing = decisions.dropMissing ?? new Set()

  // Walk the drafts in the PDF's OWN order, emitting either the existing product or
  // the draft — whichever the user chose. Walking matched-then-added instead would
  // put every new product at the end, which is the opposite of the point.
  const byDraftId = new Map(matched.map(m => [m.draft.id, m]))
  const inPdf = []
  for (const d of pdfOrder) {
    const m = byDraftId.get(d.id)
    if (m) {
      // Taking the PDF's version keeps the existing product's id, so anything
      // referring to it still resolves.
      inPdf.push(useDraft.has(d.id) ? { ...d, id: m.existing.id } : m.existing)
    } else if (!skipAdded.has(d.id)) {
      inPdf.push(d)
    }
  }

  const kept = missing.filter(p => !dropMissing.has(p.id))
  return [...inPdf, ...kept]
}
