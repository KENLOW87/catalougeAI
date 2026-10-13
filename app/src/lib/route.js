// Deciding WHICH catalogue an import belongs to.
//
// Until now an import landed in whichever catalogue happened to be open, which is
// only right by luck. A PDF says what it is — its header carries the family's own
// name ("PVC Marble | Gloss/ Film", "Acoustic Panel", "Carbon Crystal Wall Panel") —
// and the product codes say it a second time. Both are already extracted, so the
// destination can be worked out rather than assumed.
//
// This is a SUGGESTION, never a decision. It is shown before the import with the
// evidence that produced it, and the admin can override it in one click. A wrong
// guess that imports silently would scatter a catalogue across families, and
// nothing about the result would say why.
//
// No AI: matching a title against thirteen known names is word comparison, and an
// answer computed from the text can be shown with its reasons.

import { PARENTS, parentLabel } from './categories/parents.js'

// Child catalogues that are specific enough to route without a second question.
// Parent families with no children use their own id as the catalogue id.
const CHILD_HINTS = [
  { id: 'accessories-led', words: ['led', 'linear', 'light'] },
  { id: 'pvc-marble', words: ['edge', 'display', 'accessories'] },
]

const STOP = new Set(['the', 'and', 'for', 'with', 'series', 'product', 'products',
  'catalogue', 'catalog', 'panel', 'size', 'mm', 'w', 'l', 't'])

// Short tokens are dropped as noise — EXCEPT ones carrying a digit. "3D" is two
// characters and is the only thing separating "PVC Marble Sheet" from "PVC Marble
// Sheet 3D"; dropping it made the two families score identically, so every marble
// import came back as an unresolvable tie.
const words = s => String(s ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter(w => !STOP.has(w) && (w.length > 2 || (w.length === 2 && /\d/.test(w))))

/** Words that actually identify a family, e.g. "carbon crystal wall" → carbon, crystal, wall. */
const familyWords = p => new Set(words(p.title))

/**
 * Where should this import go?
 *
 * @param headerText  what the lifted page header reads
 * @param names       the product codes/names that were read
 * @param openId      the catalogue the admin currently has open
 * @returns { best, ranked: [{ id, title, score, why }], confident }
 */
export function suggestDestination(headerText = '', names = [], openId = null, filename = '') {
  // THE FILENAME IS EVIDENCE. "PU Stone ( Jan 2026 ).pdf" names the family outright,
  // and it was being ignored — so a PU Stone upload, whose product pages carry only
  // the generic "Product Series" banner, matched nothing and fell back to whichever
  // catalogue happened to be selected. It landed in Acoustic Panel.
  //
  // The page header is still the better evidence where it exists: it is printed by
  // the publisher. A filename can be anything. But a filename that names a family
  // beats no evidence at all, and here it is decisive.
  const headerWords = new Set(words(headerText))
  const inHeader = new Set([...headerWords, ...words(filename)])
  const codePrefixes = new Set(
    names.map(n => String(n ?? '').match(/^([A-Za-z]{2,4})\d/)?.[1]?.toUpperCase()).filter(Boolean))

  const ranked = PARENTS.map(p => {
    const fw = familyWords(p)
    const hits = [...fw].filter(w => inHeader.has(w))
    let score = hits.length / Math.max(1, fw.size)
    const why = []
    // Say which source matched. The review screen shows this sentence, and
    // "the header says PU Stone" about a header that reads "Product Series" would
    // be a plain untruth — the one thing a review screen cannot afford.
    const fromHeader = hits.filter(w => headerWords.has(w))
    const fromFile = hits.filter(w => !headerWords.has(w))
    if (fromHeader.length) why.push(`the header says "${fromHeader.join(' ')}"`)
    if (fromFile.length) why.push(`the file is named "${filename}"`)

    // A code prefix is weaker evidence than a title, but it settles a tie: PV**
    // belongs with the PVC families rather than with Acoustic Panel.
    for (const pre of codePrefixes) {
      if ([...fw].some(w => w.startsWith(pre.toLowerCase()) || pre.toLowerCase().startsWith(w.slice(0, 2)))) {
        score += 0.15
        why.push(`codes begin with ${pre}`)
      }
    }

    // "PVC Marble Sheet" and "PVC Marble" (the Accessories child) share words. The
    // longer title winning on word count is the behaviour we want, but a header that
    // names EVERY word of a family is a stronger claim than one that names some.
    if (hits.length === fw.size && fw.size > 1) score += 0.25
    // When two catalogue titles share every word in the shorter title, prefer
    // the exact longer title. This resolves "PVC Marble Sheet 3D" above
    // "PVC Marble Sheet" without making a fuzzy guess.
    if (hits.length === fw.size && fw.size > 1) score += fw.size * 0.01

    return { id: p.id, title: parentLabel(p), score, why }
  }).sort((a, b) => b.score - a.score)

  // If the winning family has children, use the more specific child hints when
  // the header contains them. Otherwise leave it unresolved and let the review
  // screen keep the current catalogue rather than guessing between siblings.
  const childRanked = CHILD_HINTS.map(c => {
    const hits = c.words.filter(w => inHeader.has(w))
    return { ...c, hits, score: hits.length / c.words.length }
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score)

  const best = ranked[0]
  const runnerUp = ranked[1]
  // Confident only when something matched AND nothing else matched nearly as well.
  const exactLongerTitle = best.score >= 0.5 && runnerUp &&
    familyWords(PARENTS.find(p => p.id === best.id)).size >
    familyWords(PARENTS.find(p => p.id === runnerUp.id)).size &&
    best.why.some(x => x.startsWith('the header says') || x.startsWith('the file is named')) &&
    best.score - runnerUp.score >= 0.005
  const confident = best.score >= 0.5 &&
    (best.score - (runnerUp?.score ?? 0) >= 0.2 || exactLongerTitle)

  return {
    ranked: ranked.filter(r => r.score > 0).slice(0, 4),
    best: best.score > 0 ? best : null,
    confident,
    child: childRanked[0] ?? null,
    openId,
  }
}

/** Resolve a routing suggestion to an actual catalogue id, when safe. */
export function suggestedCatalogue(suggestion, fallbackId = null) {
  if (!suggestion) return { id: fallbackId, title: fallbackId, confident: false, why: [] }

  const parent = PARENTS.find(p => p.id === suggestion.best?.id)

  // A CHILD hint only decides WHICH child, never which family.
  //
  // This ran unconditionally: the words are "led", "linear", "light", two of which
  // score 0.67 and were declared confident on their own. So any panel catalogue
  // advertising "LED lighting" was claimed by Accessories ~ LED, whatever the rest
  // of the page said. The hint is only meaningful once the family that OWNS those
  // children has actually won.
  const familyOwnsChildren = parent?.children?.length > 0
  if (familyOwnsChildren && suggestion.confident && suggestion.child?.score >= 0.5) {
    const childTitle = suggestion.child.id === 'accessories-led' ? 'Accessories ~ LED' : 'PVC Marble'
    return {
      id: suggestion.child.id,
      title: childTitle,
      confident: true,
      why: [...(suggestion.best?.why ?? []), ...suggestion.child.hits.map(w => `and "${w}" points to ${childTitle}`)],
    }
  }
  if (parent && parent.children.length === 0 && suggestion.confident) {
    return { id: parent.id, title: parentLabel(parent), confident: true, why: suggestion.best.why }
  }
  const fallback = PARENTS.find(p => p.id === fallbackId)?.title ??
    (fallbackId === 'accessories-led' ? 'Accessories ~ LED' : fallbackId === 'pvc-marble' ? 'PVC Marble' : fallbackId)
  return { id: fallbackId, title: fallback, confident: false, why: suggestion.best?.why ?? [] }
}

/** One sentence for the review screen. */
export function describeDestination(s, openTitle) {
  if (!s?.best) {
    return `I cannot tell which catalogue this belongs to, so it will go into ${openTitle}.`
  }
  if (s.confident) {
    return `This looks like ${s.best.title} — ${s.best.why[0]}.`
  }
  return `This might be ${s.best.title} (${s.best.why[0]}), but I am not sure.`
}
