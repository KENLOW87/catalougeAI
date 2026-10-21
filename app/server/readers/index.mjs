// Reader dispatcher.
//
// Every layout is a spec and one engine reads them all. A page is tried against
// each known layout and the best match wins; only a page no layout recognises
// falls through to the AI reader.

import { findAnchors, readWithSpec } from './spec.mjs'
import { BUILTIN_SPECS } from './specs.mjs'

/** Every text field a layout claims to read, across all of its product kinds. */
const textFields = spec => {
  const fields = spec?.kinds ? spec.kinds.flatMap(k => k.fields ?? []) : (spec?.fields ?? [])
  const byKey = new Map()
  for (const f of fields.filter(f => f.type === 'text')) if (!byKey.has(f.key)) byKey.set(f.key, f)
  return [...byKey.values()]
}

/**
 * A rule read is only trusted when it produced usable products. A layout that
 * matches but yields empty names is worse than no match, because it would quietly
 * import junk.
 *
 * A NAME ALONE IS NOT ENOUGH. The PVC Marble layout matched the catalogue's cover —
 * one big photograph — and read a product called "NN 7" off it: four characters, so
 * the name test passed, and a junk product went into the catalogue. Every other
 * field it claims to read came back empty (`size: ""`, `series: ""`, unnamed
 * finishes), which is what actually distinguishes a mismatch from a real page.
 *
 * So the layout must also DELIVER the fields it declares. One product reading
 * properly is enough — pages have their oddities — but if the best product on the
 * page fills fewer than half the text fields, the layout did not match this page.
 */
export function ruleReadIsUsable(result, spec) {
  if (!result?.products?.length) return false
  const named = result.products.filter(p => (p.name ?? '').trim().length >= 2)
  if (named.length < Math.ceil(result.products.length * 0.6)) return false

  const fields = textFields(spec)
  if (fields.length < 2) return true          // nothing else was promised
  // A field counts as "delivered" only once it clears its OWN minimum length — not
  // merely non-empty. A mismatched page can land a stray OCR fragment in a box by
  // sheer position; a field's own `minChars` (default 1, i.e. today's "non-empty"
  // behaviour) lets a spec say what its real content actually looks like.
  //
  // Length alone is not reliable either — a long enough fragment of the WRONG page's
  // own text ("Bena." from a Ceiling-style catalogue's caption) can clear a 4-char
  // floor by pure chance. `matches` lets a field also require its content to look
  // like what it is: PVC Marble's "series" box prints the literal word "PVC Marble"
  // on every real page, so nothing else should ever satisfy it.
  const clears = (f, v) => v.length >= (f.minChars ?? 1) && (!f.matches || f.matches.test(v))
  const filled = p => fields.filter(f => clears(f, String(p[f.key] ?? '').trim())).length / fields.length
  // A spec can also demand a stricter bar than "half the fields filled" — PVC
  // Marble's badge colour is close enough to another catalogue's that a mismatched
  // page can still land text in every box by sheer position, just not the right
  // text (a Ceiling Panel page read "(Ceiling)" into the "size" field — non-empty,
  // wrong). Defaults to 0.5 so every other spec keeps today's behaviour exactly.
  return Math.max(...result.products.map(filled)) >= (spec?.minFill ?? 0.5)
}

/**
 * Picks the layout that best fits this page and reads it.
 * @returns { spec, products, warnings } or { spec: null } when nothing matches
 */
export async function readWithRules(page, onProgress = () => {}, pageNo = null) {
  // Record what EVERY layout made of the page, including the ones that found
  // nothing. When a read fails, "no layout matched" on its own is useless — the
  // counts say whether the page was not recognised at all, or recognised and then
  // read badly, which are different problems with different fixes.
  const report = []

  // Specific layouts first, then the shape-based fallback. A layout that keys off a
  // distinctive mark is always a better answer than one that keys off "looks like a
  // photo", so the fallback only gets a turn when nothing specific fits.
  const rounds = [
    BUILTIN_SPECS.filter(s => !s.fallback && !s.augment),
    BUILTIN_SPECS.filter(s => s.fallback && !s.augment),
  ]

  for (const round of rounds) {
    const candidates = []
    for (const spec of round) {
      try {
        const anchors = findAnchors(page, { ...spec.anchor, pageNo })
        report.push({ title: spec.title, found: anchors.length })
        if (anchors.length) candidates.push({ spec, count: anchors.length })
      } catch (e) {
        // One bad layout must not break the others, but say so rather than hiding it.
        report.push({ title: spec.title, found: 0, error: String(e.message ?? e) })
      }
    }
    // More anchors means a better fit — a layout matching one stray mark loses to
    // one that finds a whole page of products.
    candidates.sort((a, b) => b.count - a.count)

    for (const { spec, count } of candidates) {
      onProgress(`Recognised the "${spec.title}" layout (${count} products) — reading it locally…`)
      const entry = report.find(r => r.title === spec.title)
      try {
        const result = await readWithSpec(page, { ...spec, anchor: { ...spec.anchor, pageNo } })
        if (ruleReadIsUsable(result, spec)) {
          const augmentProducts = []
          for (const extra of BUILTIN_SPECS.filter(s => s.augment)) {
            const extraAnchors = findAnchors(page, { ...extra.anchor, pageNo })
            if (!extraAnchors.length) continue
            const extraResult = await readWithSpec(page, { ...extra, anchor: { ...extra.anchor, pageNo } })
            if (ruleReadIsUsable(extraResult, extra)) augmentProducts.push(...extraResult.products)
          }
          return { spec, ...result, products: [...result.products, ...augmentProducts] }
        }
        entry.read = `${result.products.length} read, but the layout's own fields came back empty`
      } catch (e) {
        entry.read = `failed: ${String(e.message ?? e)}`
      }
    }
  }

  return { spec: null, report }
}

/** One line a human can act on, for when nothing matched. */
export function describeReport(report = []) {
  if (!report.length) return 'no layouts were tried'
  return report
    .map(r => `${r.title}: ${r.error ? `error — ${r.error}` : `${r.found} found${r.read ? `, ${r.read}` : ''}`}`)
    .join(' · ')
}

export { BUILTIN_SPECS }
