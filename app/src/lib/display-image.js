import { productSeries, orderProductFamilies } from './product-order.js'

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const seriesWord = /\b(series|siri|kumpulan|group)\b/i

export function isRemoveDisplayRequest(text) {
  return /\b(buang|padam|hapus(?:kan)?|remove|delete|discard)\b/i.test(text) &&
    /\b(display|contoh\s+penggunaan|usage|installation)\b/i.test(text) &&
    !/\b(jangan|do not|don't)\b/i.test(text)
}

export function proposeDisplayRemoval(text, items) {
  const codes = [...text.toUpperCase().matchAll(/\b([A-Z]{1,4}\s?\d{1,4}[A-Z]?)\b/g)].map(m => m[1].replace(/\s+/g, ''))
  const families = [...new Set(items.map(p => productSeries(p)?.family).filter(Boolean))]
    .filter(family => new RegExp(`(?<![a-z0-9])${family.split(' ').map(escape).join('[ -]*')}(?![a-z0-9])`, 'i').test(text))
  if (!codes.length && seriesWord.test(text) && !families.length) return { reply: 'Saya tak jumpa siri itu dalam katalog ini. Tiada gambar dibuang.' }
  const matchesCode = (p, code) => [p.code, p.name].filter(Boolean).some(name =>
    new RegExp(`(?<![a-z0-9])${escape(code)}(?![a-z0-9])`, 'i').test(name.replace(/\s+/g, '')))
  if (codes.some(code => !items.some(p => !p.isPage && matchesCode(p, code)))) return { reply: 'Kod produk itu tidak ditemui. Tiada gambar dibuang.' }
  const candidates = []
  for (const product of items) {
    if (product.isPage) continue
    for (let index = 0; index < (product.examples ?? []).length; index++) {
      const example = product.examples[index]
      if (example.origin !== 'manual-display') continue
      const owners = items.filter(p => p.id === product.id || example.sharedWithProductIds?.includes(p.id))
      if (codes.length ? !codes.some(code => owners.some(p => matchesCode(p, code))) :
          families.length && !families.some(family => example.displaySeries === family || productSeries(product)?.family === family)) continue
      candidates.push({ product, example, index })
    }
  }
  if (!candidates.length) return { reply: 'Saya tak jumpa display image yang ditambah secara manual untuk dibuang. Gambar produk dan gambar asal PDF dikekalkan.' }
  const recent = /\b(baru|tadi|terakhir|latest|last|recent(?:ly)?|just)\b/i.test(text)
  let selected = candidates
  if (recent) {
    const dated = candidates.filter(c => Number.isFinite(c.example.addedAt))
    if (dated.length) {
      const latest = Math.max(...dated.map(c => c.example.addedAt))
      selected = dated.filter(c => c.example.addedAt === latest)
    } else if (new Set(candidates.map(c => c.product.id)).size === 1) {
      // Earlier manual uploads have no timestamps, but append order within one
      // owner is reliable. Never invent cross-product chronology for old records.
      selected = [candidates[candidates.length - 1]]
    }
  }
  const identities = new Set(selected.map(c => c.example.displayId || c.example.image))
  if (identities.size !== 1) return { reply: 'Ada beberapa display image yang mungkin dimaksudkan. Sebut kod produk atau siri dan nyatakan gambar terakhir supaya saya boleh tunjuk gambar yang betul sebelum buang.' }
  const first = selected[0]
  const group = first.example.displaySeries ? `${first.example.displaySeries} series` : first.product.name
  return { propose: {
    summary: `Buang display image — ${group}?`,
    detail: 'Hanya display image dalam preview ini akan dibuang. Produk, drawing dan gambar asal PDF dikekalkan. Klik Apply untuk sahkan.',
    preview: first.example.image,
    action: { type: 'removeDisplayImage', ids: selected.map(c => c.product.id), label: group,
      displayId: first.example.displayId, value: first.example.image },
  } }
}

export function isDisplayRequest(text, hasAttachment = false) {
  if (isRemoveDisplayRequest(text)) return false
  const explicit = /\b(display|contoh\s+penggunaan|pemasangan|installation|usage|showroom)\b/i.test(text) &&
    /\b(tambah(?:kan)?|masukkan|letak(?:kan)?|add|attach|put|gambar|image|photo|picture|untuk|for)\b/i.test(text)
  // With an attachment, "product WB series" is enough context for a shared
  // display. Explicit editing/deletion commands still retain their own meaning.
  return explicit || (hasAttachment && seriesWord.test(text) &&
    !/\b(remove|buang|padam|delete|replace|ganti|rotate|pusing|background|latar)\b/i.test(text))
}

export function resolveDisplaySeries(text, items) {
  const families = [...new Set(items.map(p => productSeries(p)?.family).filter(Boolean))]
  const matches = families.filter(family => new RegExp(`(?<![a-z0-9])${family.split(' ').map(escape).join('[ -]*')}(?![a-z0-9])`, 'i').test(text))
  if (!matches.length) return { reply: 'Saya tak jumpa siri itu dalam katalog ini. Sebut nama siri atau kod produk yang tersedia.' }
  if (matches.length > 1) return { reply: `Gambar ini untuk siri ${matches.join(' atau ')}? Pilih satu siri supaya gambar tidak tersalah kumpulan.` }
  const family = matches[0]
  const targets = orderProductFamilies(items).filter(p => productSeries(p)?.family === family)
  const indices = targets.map(p => items.findIndex(item => item.id === p.id))
  const sourceGroups = new Set(targets.map(p => p.layoutRowGroup).filter(Boolean))
  if (sourceGroups.size > 1 || items.slice(Math.min(...indices), Math.max(...indices) + 1).some(p => p.isPage) ||
      targets.some(p => p.layoutPairGroup || p.layoutFullRow || (p.drawing && !(p.drawingPresentation === 'dimensions' && p.dimensionText)))) {
    return { reply: `${family} mempunyai beberapa susunan/rujukan berbeza. Sebut kod produk yang patut menerima display ini supaya layout asal kekal.` }
  }
  const owner = [...targets].reverse().find(p => p.supportStrip) ?? targets[targets.length - 1]
  return { family, targets, owner }
}

// Only presentation gets grouping metadata. Raw product rows, source owners and
// original strips are retained; one shared display is stored and rendered once.
export function withDisplaySeriesLayout(items) {
  let output = items
  for (const owner of items) for (const example of owner.examples ?? []) {
    if (example.origin !== 'manual-display' || example.displayScope !== 'series') continue
    const plan = resolveDisplaySeries(example.displaySeries, output)
    if (plan.reply || !plan.targets.some(p => p.id === owner.id)) continue
    const group = plan.targets.find(p => p.layoutRowGroup)?.layoutRowGroup ?? `display-series:${plan.family}`
    const ids = new Set(plan.targets.map(p => p.id))
    output = output.map(p => ids.has(p.id) && !p.layoutRowGroup ? { ...p, layoutRowGroup: group } : p)
  }
  return output
}

// An uploaded display is a complete scene, never a replacement product photo
// or an input to product-background isolation.
export function addDisplayImage(products, action) {
  if (action.type !== 'addDisplayImage' || !action.value) return products
  const displayId = action.displayId ?? globalThis.crypto.randomUUID()
  const addedAt = action.addedAt ?? Date.now()
  return products.map(product => {
    if (product.isPage || !action.ids.includes(product.id) ||
        (action.displayScope === 'series' && product.id !== action.ownerId) ||
        product.examples?.some(example => example.image === action.value)) return product
    const example = {
      image: action.value, role: 'usage', ownerProductId: product.id,
      photoTreatmentMode: 'preserve-scene', origin: 'manual-display', caption: '',
      displayId, addedAt,
      ...(action.placement ? { displayPlacement: action.placement } : {}),
      ...(action.displayScope === 'series' ? {
        displayScope: 'series', displaySeries: action.series,
        sharedWithProductIds: [...action.ids], caption: `Display — ${action.series} series`,
      } : {}),
    }
    const existing = product.examples ?? []
    return { ...product, examples: action.placement?.order === 'before' ? [example, ...existing] : [...existing, example] }
  })
}

export function moveDisplayImage(products, action) {
  if (action.type !== 'moveDisplayImage') return products
  const sources = products.filter(p => action.sourceIds?.includes(p.id)).flatMap(p => (p.examples ?? []).filter(e =>
    e.origin === 'manual-display' && (action.displayId ? e.displayId === action.displayId : e.image === action.value)))
  const destination = products.find(p => !p.isPage && p.id === (action.ownerId ?? action.ids?.[0]))
  if (!sources.length || !destination || sources.some(e => e.image !== action.value)) return products
  const source = sources[0]
  // All validation happens before removal; a stale or missing destination must
  // never lose the display. Original identity/time survives moves and reloads.
  const without = removeDisplayImage(products, { type: 'removeDisplayImage', ids: action.sourceIds,
    displayId: action.displayId, value: action.value })
  return addDisplayImage(without, { ...action, type: 'addDisplayImage',
    displayId: source.displayId, addedAt: source.addedAt })
}

export function removeDisplayImage(products, action) {
  if (action.type !== 'removeDisplayImage') return products
  return products.map(product => {
    if (!action.ids.includes(product.id) || !product.examples) return product
    const examples = product.examples.filter(example => !(example.origin === 'manual-display' &&
      (action.displayId ? example.displayId === action.displayId : example.image === action.value)))
    return examples.length === product.examples.length ? product : { ...product, examples }
  })
}
