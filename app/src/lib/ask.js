// Answering questions about the catalogue.
//
// Same principle as the PDF readers: the cheap local answer first, the API only for
// what genuinely needs it. Counting products needs no intelligence, and an answer
// computed from the data is EXACT — it cannot drift, cost anything, or be invented.
//
// What reaches the API, when it is used at all, is a TEXT SUMMARY: names, codes,
// descriptions, counts. Never the images. They are the bulk of a catalogue, they
// would cost a fortune to send, and they are not needed to answer questions about it.

import { runQc, partsOf } from './qc.js'

const norm = s => String(s ?? '').toLowerCase().trim()
const has = (q, ...words) => words.some(w => q.includes(w))

const list = names => names.length > 12
  ? `${names.slice(0, 12).join(', ')} … and ${names.length - 12} more`
  : names.join(', ')

/**
 * Try to answer from the data alone.
 * @returns { text, source: 'local' } or null when the question needs more than rules
 */
export function answerLocally(question, items = [], category = null) {
  const q = norm(question)
  if (!q) return null

  const products = items.filter(p => !p.isPage)
  const pages = items.filter(p => p.isPage)
  const title = category?.title ?? 'this catalogue'
  const named = p => p.name || '(unnamed)'

  // --- how many -------------------------------------------------------------
  if (has(q, 'how many', 'count', 'total', 'number of')) {
    if (has(q, 'page')) {
      return { source: 'local', text: `${pages.length} kept page${pages.length === 1 ? '' : 's'} ` +
        `in ${title}${pages.length ? ` (${list(pages.map(named))})` : ''}.` }
    }
    return { source: 'local', text:
      `${title} holds ${products.length} product${products.length === 1 ? '' : 's'}` +
      `${pages.length ? ` and ${pages.length} kept page${pages.length === 1 ? '' : 's'}` : ''}.` }
  }

  // --- what is missing ------------------------------------------------------
  if (has(q, 'missing', 'without', 'no photo', 'no image', 'incomplete', 'empty')) {
    if (has(q, 'drawing')) {
      const n = products.filter(p => !p.drawing)
      return { source: 'local', text: n.length
        ? `${n.length} without a dimension drawing: ${list(n.map(named))}.`
        : 'Every product has a dimension drawing.' }
    }
    const n = products.filter(p => !p.photo &&
      !(p.finishes ?? []).some(f => f.photo) && !(p.variants ?? []).some(v => v.photo))
    return { source: 'local', text: n.length
      ? `${n.length} product${n.length === 1 ? '' : 's'} with no photo: ${list(n.map(named))}.`
      : 'Every product has a photo.' }
  }

  // --- QC -------------------------------------------------------------------
  if (has(q, 'qc', 'check', 'problem', 'issue', 'wrong', 'error', 'mistake', 'anything bad')) {
    const findings = runQc(items, category)
    if (!findings.length) return { source: 'local', text: `I checked ${title} and found no problems.` }
    return { source: 'local', text: `${findings.length} thing${findings.length === 1 ? '' : 's'} in ${title}:\n` +
      findings.map(f => `• ${f.level === 'error' ? 'FIX' : f.level === 'warn' ? 'CHECK' : 'NOTE'} — ${f.title}. ${f.detail}`).join('\n') }
  }

  // --- gaps in the numbering ------------------------------------------------
  if (has(q, 'gap', 'sequence', 'skipped', 'missing code', 'out of order')) {
    const findings = runQc(items, category).filter(f => /sequence|format/.test(f.title))
    return { source: 'local', text: findings.length
      ? findings.map(f => `${f.title}. ${f.detail}`).join('\n')
      : 'The codes run in sequence with no gaps.' }
  }

  // --- listing --------------------------------------------------------------
  if (has(q, 'list', 'show me', 'what products', 'which products', 'all products')) {
    return { source: 'local', text: products.length
      ? `${products.length} in order: ${list(products.map(named))}.`
      : `${title} is empty.` }
  }

  // --- a specific code or name ----------------------------------------------
  const codeMatch = q.toUpperCase().match(/\b([A-Z]{1,4}\d{1,4}[A-Z]?)\b/)
  if (codeMatch) {
    const wanted = codeMatch[1]
    const hit = products.find(p => norm(p.name) === norm(wanted))
    if (hit) {
      const bits = [
        hit.subtitle && `description "${hit.subtitle}"`,
        hit.size && `size ${hit.size}`,
        hit.colour && `colour ${hit.colour}`,
        hit.length && `length ${hit.length}`,
        `photo ${hit.photo || (hit.variants ?? []).some(v => v.photo) ? 'yes' : 'NO'}`,
        `drawing ${hit.drawing ? 'yes' : 'no'}`,
        hit.sourcePage && `read from page ${hit.sourcePage}`,
      ].filter(Boolean)
      const at = products.indexOf(hit) + 1
      return { source: 'local', text: `${hit.name} is number ${at} in ${title}: ${bits.join(', ')}.` }
    }
    const near = products.filter(p => partsOf(p.name)?.prefix === partsOf(wanted)?.prefix)
    return { source: 'local', text: `There is no ${wanted} in ${title}.` +
      (near.length ? ` The nearest codes are ${list(near.map(named))}.` : '') }
  }

  return null     // rules cannot answer this one
}

/** A compact text picture of the catalogue — no images, safe and cheap to send. */
export function summarise(items = [], category = null) {
  const products = items.filter(p => !p.isPage)
  const rows = products.map((p, i) => [
    i + 1, p.name,
    p.subtitle ?? p.colour ?? p.size ?? '',
    p.third ?? p.length ?? p.series ?? '',
    p.photo || (p.finishes ?? []).some(f => f.photo) || (p.variants ?? []).some(v => v.photo) ? 'photo' : 'NO PHOTO',
    p.drawing ? 'drawing' : 'no drawing',
  ].join(' | '))
  const pages = items.filter(p => p.isPage).map(p => `${p.name} (kept page from source page ${p.sourcePage ?? '?'})`)
  return [
    `Catalogue: ${category?.title ?? 'untitled'}`,
    `${products.length} products, ${pages.length} kept pages`,
    '',
    'PRODUCTS (position | name | second line | third line | photo | drawing):',
    ...rows,
    ...(pages.length ? ['', 'KEPT PAGES:', ...pages] : []),
  ].join('\n')
}
