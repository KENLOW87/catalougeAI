import { resolveDisplaySeries, proposeDisplayRemoval, isRemoveDisplayRequest } from './display-image.js'

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const displayWords = /\b(display|contoh\s+penggunaan|usage|installation|pemasangan|showroom)\b/i
const moveWords = /\b(pindah(?:kan)?|alih(?:kan)?|anjak(?:kan)?|move|reposition|susun(?:kan)?)\b/i
const placeWords = /\b(letak(?:kan)?|letak\s+kan|taruh|tempatkan|put|place|beside|sebelah|bersebelahan)\b/i
export const isDisplayConversation = (text, context = null) => displayWords.test(text) || moveWords.test(text) ||
  Boolean(context && /\b(sebelah|bersebelahan|beside|next to|sisi|sebelum|selepas|before|after)\b/i.test(text) &&
    !/\b(?:tambah|add|create|new)\s+(?:produk|product|item)\b/i.test(text))

export function recentDisplayContext(items) {
  const proposal = proposeDisplayRemoval('remove latest display', items)?.propose
  return proposal ? { displayId: proposal.action.displayId, value: proposal.action.value, ids: proposal.action.ids } : null
}

export function displayInventory(items) {
  return items.filter(p => !p.isPage).map(p => ({ id: p.id, name: p.name, code: p.code,
    displays: (p.examples ?? []).filter(e => e.origin === 'manual-display').map((e, i) => ({
      id: e.displayId, ordinal: i + 1, series: e.displaySeries, addedAt: e.addedAt,
    })) }))
}

function namedProducts(text, items) {
  return items.filter(p => !p.isPage).map(p => {
    const aliases = [p.code, p.name, p.name?.match(/^.*?[A-Z][ -]*\d+[A-Z]?(?=$|[^A-Z0-9])/i)?.[0]].filter(Boolean)
    const positions = aliases.map(name => text.search(new RegExp(`(?<![a-z0-9])${escape(name).replace(/ /g, '\\s*')}(?![a-z0-9])`, 'i'))).filter(i => i >= 0)
    return { p, at: positions.length ? Math.min(...positions) : -1 }
  }).filter(entry => entry.at >= 0).sort((a, b) => a.at - b.at).map(entry => entry.p)
}

export function resolveProductReference(reference, items) {
  const normalize = value => String(value ?? '').normalize('NFKC').toUpperCase().replace(/\s+/g, '').trim()
  const asked = normalize(reference)
  if (!asked) return []
  return items.filter(p => !p.isPage && [p.code, p.name, p.name?.match(/^.*?[A-Z][ -]*\d+[A-Z]?(?=$|[^A-Z0-9])/i)?.[0]]
    .filter(Boolean).some(alias => normalize(alias) === asked))
}

// One intent vocabulary is shared by local language handling and AI fallback.
// The AI names records; only this validator can turn that into an Apply action.
export function inferDisplayIntent(text, items, hasAttachment, context = null) {
  const followup = context && !/\b(?:tambah|add|create|new)\s+(?:produk|product|item)\b/i.test(text) &&
    ((/\b(dia|it|that|this|gambar|image|photo|scene)\b/i.test(text) && (placeWords.test(text) || moveWords.test(text))) ||
      /\b(sebelah|bersebelahan|beside|next to|sisi|sebelum|selepas|before|after)\b/i.test(text))
  if (!displayWords.test(text) && !followup) return null
  if (/\b(jangan|do not|don't)\s+(?:tolong\s+)?(?:buang|padam|remove|delete)\b/i.test(text) && !moveWords.test(text) && !placeWords.test(text)) return { operation: 'none' }
  const named = namedProducts(text, items)
  const mentionedCodes = [...text.matchAll(/\b([A-Z]{1,4}\s?\d{1,4}[A-Z]?)\b/gi)].map(m => m[1].replace(/\s+/g, '').toUpperCase())
  const unknownReference = mentionedCodes.some(code => !named.some(p => [p.code, p.name].filter(Boolean).some(name =>
    new RegExp(`(?<![a-z0-9])${escape(code)}(?![a-z0-9])`, 'i').test(name.replace(/\s+/g, '')))))
  const operation = isRemoveDisplayRequest(text) ? 'remove' : moveWords.test(text) || (!hasAttachment && (placeWords.test(text) || followup)) ? 'move' : hasAttachment ? 'add' : null
  if (!operation) return null
  const destinations = [...text.matchAll(/\b(?:ke|kepada|to|untuk|for|dekat|kat)\b/gi)]
  const destination = destinations.at(-1)
  const targetText = destination ? text.slice(destination.index + destination[0].length) : text
  const destinationProducts = namedProducts(targetText, items)
  const target = destinationProducts.length ? { type: 'product', value: destinationProducts.at(-1).code || destinationProducts.at(-1).name } : null
  const series = !destinationProducts.length ? resolveDisplaySeries(targetText, items) : null
  const placement = /\b(beside|next to|sebelah|bersebelahan|sisi)\b/i.test(text) ? 'beside-product' : 'default'
  const order = /\b(sebelum|before|mendahului|depan)\b/i.test(text) ? 'before' : /\b(selepas|sesudah|after|belakang)\b/i.test(text) ? 'after' : 'default'
  const sourceText = destination ? text.slice(0, destination.index) : named.length > 1 ? text.slice(0, text.toLowerCase().lastIndexOf((named.at(-1).code || named.at(-1).name).toLowerCase())) : text
  const sourceProducts = destination ? namedProducts(sourceText, items) : named.length > 1 ? [named[0]] : []
  const sourceSeries = /\b(series|siri|kumpulan|group)\b/i.test(sourceText) && !sourceProducts.length ? resolveDisplaySeries(sourceText, items) : null
  const ordinalMatch = sourceText.split(/\b(sebelum|selepas|before|after)\b/i)[0].match(/\b(?:display|gambar|image)(?:\s+(?:yang|nombor|number|ke))?[\s-]*(pertama|kedua|ketiga|first|second|third|[1-9]\d*)\b/i)
  const ordinal = ordinalMatch ? ({ pertama: 1, first: 1, kedua: 2, second: 2, ketiga: 3, third: 3 }[ordinalMatch[1].toLowerCase()] ?? Number(ordinalMatch[1])) : undefined
  return { operation, invalidReference: unknownReference, target: target ?? (series && !series.reply ? { type: 'series', value: series.family } : null),
    source: { product: sourceProducts[0] ? sourceProducts[0].code || sourceProducts[0].name : undefined,
      series: sourceSeries && !sourceSeries.reply ? sourceSeries.family : undefined, ordinal,
      recency: /\b(baru|tadi|terakhir|latest|last|recent(?:ly)?|just)\b/i.test(sourceText) ? 'latest' : undefined },
    placement: { mode: placement, order }, text }
}

export function planDisplayIntent(intent, { items, category, attachment = null, context = null }) {
  if (!intent || !['add', 'move', 'remove', 'none'].includes(intent.operation)) return { reply: 'Saya belum dapat menentukan tindakan display. Mahu tambah, buang atau pindahkan gambar?' }
  if (intent.operation === 'none') return { reply: 'Baik, display image dikekalkan. Tiada perubahan dibuat.' }
  if (intent.invalidReference) return { reply: 'Ada kod produk yang tidak ditemui dalam arahan ini. Tiada perubahan dibuat.' }
  if (!category?.isDefault) return { reply: 'Arahan display ini tersedia untuk template katalog biasa.' }
  const mode = intent.placement?.mode ?? 'default', order = intent.placement?.order ?? 'default'
  if (!['default', 'beside-product'].includes(mode) || !['default', 'before', 'after'].includes(order)) return { reply: 'Kedudukan itu belum jelas. Nyatakan di sebelah produk, sebelum atau selepas display lain.' }
  let plan = null
  if (intent.target?.type === 'series') plan = resolveDisplaySeries(String(intent.target.value), items)
  else if (intent.target?.type === 'product') {
    const matches = resolveProductReference(intent.target.value, items)
    if (matches.length === 1) plan = { targets: matches, owner: matches[0] }
    else return { reply: 'Produk sasaran tidak ditemui atau mempunyai nama bertindih. Nyatakan kod/nama yang tepat.' }
  }
  if (plan?.reply) return { reply: plan.reply }
  if (intent.operation !== 'remove' && !plan) return { needsInterpret: true }
  let selected = null
  if (intent.operation !== 'add') {
    let sourceItems = items
    if (intent.source?.product) {
      sourceItems = resolveProductReference(intent.source.product, items)
      if (sourceItems.length !== 1) return { reply: 'Produk asal display tidak jelas. Tiada gambar dipindahkan.' }
    } else if (intent.source?.series) {
      const sourcePlan = resolveDisplaySeries(String(intent.source.series), items)
      if (sourcePlan.reply) return sourcePlan
      sourceItems = items.filter(p => sourcePlan.targets.some(t => t.id === p.id))
    } else if (intent.operation === 'remove' && plan) sourceItems = items.filter(p => plan.targets.some(t => t.id === p.id) || p.examples?.some(e => e.displaySeries === plan.family))
    const candidates = sourceItems.flatMap(p => (p.examples ?? []).filter(e => e.origin === 'manual-display').map(e => ({ p, e })))
    const ordinal = intent.source?.ordinal
    if (intent.source?.displayId) {
      const matching = candidates.filter(c => c.e.displayId === intent.source.displayId)
      if (!matching.length || new Set(matching.map(c => c.e.image)).size !== 1) return { reply: 'Gambar yang dirujuk sudah tiada atau tidak jelas. Tiada perubahan dibuat.' }
      selected = { type: 'removeDisplayImage', ids: matching.map(c => c.p.id), displayId: intent.source.displayId, value: matching[0].e.image }
    } else if (ordinal != null) {
      if (!Number.isInteger(ordinal) || ordinal < 1 || new Set(candidates.map(c => c.p.id)).size > 1) return { reply: 'Nyatakan produk asal untuk memilih nombor display dengan tepat.' }
      const candidate = candidates[ordinal - 1]
      if (!candidate) return { reply: 'Nombor display itu tidak ditemui.' }
      selected = { type: 'removeDisplayImage', ids: [candidate.p.id], displayId: candidate.e.displayId, value: candidate.e.image }
    } else if (context && !intent.source?.product && !intent.source?.recency && candidates.some(c => context.displayId ? c.e.displayId === context.displayId : c.e.image === context.value)) {
      const matching = candidates.filter(c => context.displayId ? c.e.displayId === context.displayId : c.e.image === context.value)
      selected = { type: 'removeDisplayImage', ids: matching.map(c => c.p.id), displayId: matching[0].e.displayId, value: matching[0].e.image }
    } else {
      const removal = proposeDisplayRemoval(`remove display ${intent.source?.recency === 'latest' ? 'latest' : ''}`, sourceItems)
      if (removal.reply) return removal
      selected = removal.propose.action
    }
    if (intent.operation === 'remove') return { propose: {
      summary: 'Buang display image ini?', preview: selected.value,
      detail: 'Hanya gambar dalam preview dibuang selepas Apply. Gambar produk, drawing dan jalur asal PDF dikekalkan.', action: selected,
    } }
  }
  if (intent.operation === 'add' && !attachment) return { reply: 'Lampirkan gambar display dahulu. Background asal dikekalkan.' }
  if (mode === 'beside-product' && plan.targets.length !== 1) return { reply: 'Pilih satu kod produk untuk kedudukan di sebelah; display siri menggunakan ruang bersama kumpulan.' }
  const value = selected?.value ?? attachment
  const label = plan.family ? `${plan.family} series` : plan.owner.name
  const placement = { mode, order, ...(mode === 'beside-product' ? { anchorProductId: plan.owner.id } : {}) }
  return { propose: { summary: `${intent.operation === 'move' ? 'Pindahkan' : 'Tambah'} display — ${label}`,
    detail: `${mode === 'beside-product' ? `Di sebelah ${plan.owner.name}` : `Bersama ${label}`}${order === 'before' ? ', sebelum display sedia ada' : order === 'after' ? ', selepas display sedia ada' : ''}. Gambar penuh dan background dikekalkan. Produk dan susunan lain kekal. Semak, kemudian Apply.`,
    preview: value, action: { type: intent.operation === 'move' ? 'moveDisplayImage' : 'addDisplayImage',
      ids: plan.targets.map(p => p.id), ownerId: plan.owner.id, label, value, placement,
      ...(plan.family ? { displayScope: 'series', series: plan.family } : {}),
      ...(selected ? { sourceIds: selected.ids, displayId: selected.displayId } : {}),
    } } }
}
