import { proposeDisplayRemoval } from './display-image.js'
import { resolveProductReference } from './display-planner.js'

export function isImageRemovalRequest(text) {
  return /\b(buang|padam|hapus(?:kan)?|remove|delete|discard)\b/i.test(text) &&
    /\b(gambar(?:nya)?|gamba|foto|photo|picture|image|display|halaman|page)\b/i.test(text) &&
    !/\b(background|latar|hand|hands|tangan|jari|caption|kapsyen|text|teks|jangan|don't|do not)\b/i.test(text)
}

export function recentImageContext(items) {
  const display = proposeDisplayRemoval('remove latest display', items)?.propose?.action
  const displayRecord = display && items.flatMap(p => p.examples ?? []).find(e => display.displayId ? e.displayId === display.displayId : e.image === display.value)
  const pages = items.filter(p => p.isPage && p.origin === 'manual-image-page')
  const datedPages = pages.filter(p => Number.isFinite(p.createdAt)).sort((a, b) => b.createdAt - a.createdAt)
  const page = datedPages[0] ?? (pages.length === 1 ? pages[0] : null)
  if (page && (!display || (Number.isFinite(page.createdAt) && page.createdAt > (displayRecord?.addedAt ?? 0)))) {
    if (datedPages.length > 1 && datedPages[0].createdAt === datedPages[1].createdAt) return null
    return { kind: 'image-page', pageId: page.id, ids: [page.id], value: page.image }
  }
  return display ? { ...display, kind: 'display' } : null
}

export function proposeImageRemoval(text, items, category, attachment, context) {
  const explicitDisplay = /\b(display|penggunaan|usage)\b/i.test(text)
  const explicitPage = /\b(halaman|page|muka\s*surat)\b/i.test(text)
  const explicitPrimary = /\b(utama|main|primary)\b/i.test(text)
  if (attachment && !explicitDisplay && !explicitPage && !explicitPrimary && !/\b(katalog|catalogue|catalog|produk|product)\b/i.test(text)) {
    return { propose: { summary: 'Buang lampiran gambar ini?', preview: attachment,
      detail: 'Hanya lampiran chat dibuang. Kandungan katalog dikekalkan.', action: { type: 'discardImageAttachment', value: attachment } } }
  }
  let selected = context ?? recentImageContext(items)
  const codes = [...text.matchAll(/\b([A-Z]{1,4}\s?\d{1,4}[A-Z]?)\b/gi)].map(m => m[1])
  if (codes.length || explicitPrimary) {
    const matches = codes.length === 1 ? resolveProductReference(codes[0], items) : selected?.kind === 'product-photo' ? items.filter(p => selected.ids?.includes(p.id)) : []
    if (matches.length !== 1) return { reply: 'Nyatakan kod produk yang gambarnya hendak dibuang. Tiada produk dipadam.' }
    const product = matches[0]
    if (!explicitPrimary && product.examples?.length) return { reply: `Untuk ${product.name}, mahu buang gambar utama atau display? Produk dan drawing akan dikekalkan.` }
    selected = { kind: 'product-photo', ids: [product.id], targetKey: 'photo', value: product.photo }
  }
  if (explicitDisplay) {
    if (context?.displayId) {
      const owners = items.filter(p => p.examples?.some(e => e.origin === 'manual-display' && e.displayId === context.displayId))
      if (owners.length) return proposeDisplayRemoval('remove display', owners.map(p => ({ ...p, examples: p.examples.filter(e => e.displayId === context.displayId) })))
    }
    return proposeDisplayRemoval(text, items)
  }
  if (explicitPage && selected?.kind !== 'image-page') selected = recentImageContext(items.filter(p => p.isPage))
  if (selected?.kind === 'image-page') {
    const page = items.find(p => p.id === selected.pageId && p.isPage && p.origin === 'manual-image-page')
    if (!page) return { reply: 'Halaman gambar yang dirujuk sudah tiada. Tiada perubahan dibuat.' }
    return { propose: { summary: `Buang halaman gambar — ${page.name}?`, preview: page.image,
      detail: 'Gambar ini memenuhi satu halaman, jadi halaman gambar ini turut dibuang. Produk, drawing dan halaman asal PDF dikekalkan. Klik Apply untuk sahkan.',
      action: { type: 'removeImagePage', ids: [page.id], pageId: page.id, value: page.image } } }
  }
  if (selected?.kind === 'product-photo') {
    const product = items.find(p => p.id === selected.ids?.[0] && !p.isPage)
    const key = selected.targetKey ?? 'photo'
    if (!category?.isDefault || !product?.[key] || !['photo', 'extra'].includes(key)) return { reply: 'Nyatakan gambar produk yang tepat untuk dibuang. Tiada produk dipadam.' }
    return { propose: { summary: `Buang gambar sahaja — ${product.name}?`, preview: product[key],
      detail: 'Hanya gambar ini dikosongkan. Nama produk, drawing, ukuran dan display dikekalkan. Klik Apply untuk sahkan.',
      action: { type: 'clearProductPhoto', ids: [product.id], targetKey: key, value: product[key] } } }
  }
  if (selected) {
    const owners = items.filter(p => selected.ids?.includes(p.id)).map(p => ({ ...p, examples: (p.examples ?? []).filter(e =>
      e.origin === 'manual-display' && (selected.displayId ? e.displayId === selected.displayId : e.image === selected.value)) }))
    return proposeDisplayRemoval('remove display', owners)
  }
  return { reply: 'Gambar mana yang hendak dibuang: display, halaman gambar penuh, atau gambar utama produk? Tiada perubahan dibuat.' }
}

export function applyImageRemoval(items, action) {
  if (action.type === 'removeImagePage') return items.filter(p => !(p.id === action.pageId && p.isPage && p.origin === 'manual-image-page' && p.image === action.value))
  if (action.type === 'clearProductPhoto' && action.targetItemId && ['finishes', 'variants'].includes(action.targetKey)) return items.map(p =>
    !p.isPage && action.ids.includes(p.id) ? { ...p, [action.targetKey]: (p[action.targetKey] ?? []).map(item => item.id === action.targetItemId && item.photo === action.value ? { ...item, photo: null } : item) } : p)
  if (action.type === 'clearProductPhoto' && ['photo', 'extra', 'image'].includes(action.targetKey)) return items.map(p =>
    !p.isPage && action.ids.includes(p.id) && p[action.targetKey] === action.value ? { ...p, [action.targetKey]: null } : p)
  return items
}
