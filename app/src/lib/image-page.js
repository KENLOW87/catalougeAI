import { recentDisplayContext } from './display-planner.js'
import { removeDisplayImage } from './display-image.js'

export function isImagePageRequest(text) {
  return /\b(pages?|newpage|halaman|muka\s*surat)\b/i.test(text) &&
    /\b(jadi(?:kan)?|buat(?:kan)?|tambah(?:kan)?|new|baru|convert|turn|make|add|whole|penuh|pindah(?:kan)?|alih(?:kan)?|move|letak(?:kan)?|put)\b/i.test(text) &&
    /\b(gambar|gamba|image|photo|picture|display|ini|ni|itu|tu|this|that|whole)\b/i.test(text)
}

export function requestedImagePage(text) {
  const page = '(?:newpage|pages?|halaman|muka\\s*surat)'
  const number = '(?:\\s+(?:baru|yang|nombor|number|ke))*[\\s:#-]*(\\d+)'
  const between = text.match(new RegExp(`(?:antara|between)\\s+(?:${page}\\s*)?(\\d+)\\s*(?:dan|and|&|-)\\s*(?:${page}\\s*)?(\\d+)`, 'i'))
  if (between) return { specified: true, position: Number(between[2]) === Number(between[1]) + 1 ? Number(between[2]) : NaN }
  const references = [...text.matchAll(new RegExp(`${page}${number}`, 'gi'))]
    .filter(match => !/\b(?:bukan|not|jangan)(?:\s+(?:di|pada|at|on))*\s*$/i.test(text.slice(0, match.index)))
  const reference = references.at(-1)
  const after = reference && /\b(?:selepas|sesudah|lepas|after)\s*$/i.test(text.slice(0, reference.index))
  return reference ? { specified: true, position: Number(reference[1]) + (after ? 1 : 0) } : { specified: false }
}

export function proposeImagePage(text, items, category, attachment, context, options = {}) {
  if (!category?.isDefault) return { reply: 'Halaman gambar penuh ini tersedia untuk template katalog biasa.' }
  const selected = attachment ? null : context ?? recentDisplayContext(items)
  const existingPage = selected?.pageId ? items.find(p => p.id === selected.pageId && p.isPage && p.origin === 'manual-image-page') : null
  const sources = selected ? items.filter(p => selected.ids?.includes(p.id)).flatMap(p =>
    (p.examples ?? []).filter(e => e.origin === 'manual-display' && (selected.displayId ? e.displayId === selected.displayId : e.image === selected.value)).map(e => ({ p, e }))) : []
  const image = attachment ?? existingPage?.image ?? sources[0]?.e.image
  if (!image) return { reply: 'Lampirkan gambar penuh atau nyatakan display yang hendak dijadikan halaman baharu. Tiada perubahan dibuat.' }
  const source = sources[0]
  const sourceGroup = source?.p.layoutRowGroup
  const members = source ? items.filter(p => !p.isPage && (p.id === source.p.id ||
    (sourceGroup && p.layoutRowGroup === sourceGroup) || source.e.sharedWithProductIds?.includes(p.id))) : []
  const afterId = members.length ? members.at(-1).id : items.at(-1)?.id ?? null
  const label = source?.e.displaySeries ? `${source.e.displaySeries} series` : source?.p.name
  const literalPosition = requestedImagePage(text)
  const unresolvedPosition = /\b(?:selepas|sesudah|lepas|sebelum|antara|after|before|between|middle)\b/i.test(text) ||
    /\b(?:pages?|halaman|muka\s*surat)\s+(?:(?:yang|ke|nombor|number)\s+)?(?:pertama|ke[a-z]+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i.test(text)
  if (!literalPosition.specified && options.pagePosition == null && unresolvedPosition) return { needsInterpret: true }
  const requested = literalPosition.specified ? literalPosition : options.pagePosition != null ? { specified: true, position: options.pagePosition } : literalPosition
  const count = typeof category.paginate === 'function' ? (items.length ? category.paginate(items).length : 0) : null
  if (requested.specified && (!Number.isInteger(requested.position) || requested.position < 1 ||
      (count != null && requested.position > count + (existingPage ? 0 : 1)))) {
    return { reply: `Nombor halaman tidak sah.${count != null ? ` Pilih 1 hingga ${Math.max(1, count + (existingPage ? 0 : 1))}.` : ''} Gambar tidak ditambah di hujung secara automatik.` }
  }
  if (existingPage && !requested.specified) return { needsInterpret: true, reply: 'Gambar ini sudah menjadi satu halaman penuh. Nyatakan nombor halaman yang dikehendaki.' }
  return { propose: {
    summary: requested.specified ? `${existingPage ? 'Pindahkan' : 'Jadikan'} gambar penuh ke halaman ${requested.position}?` : 'Jadikan gambar penuh satu halaman baharu?', preview: image,
    detail: `Gambar asal dipaparkan penuh tanpa crop, rotation atau buang background.${source ? ' Display ini dipindahkan dari kedudukan lama supaya tidak berulang.' : ''} Halaman ${requested.specified ? `diletakkan tepat pada nombor ${requested.position}` : `disisipkan ${label ? `selepas kumpulan ${label}` : 'di hujung katalog'}`}. ${existingPage ? 'Jumlah halaman kekal; tiada salinan baharu.' : 'Jumlah halaman bertambah satu'}; layout produk lain dikekalkan. Klik Apply untuk simpan.`,
    action: { type: existingPage ? 'positionImagePage' : 'addImagePage', pageId: existingPage?.id ?? `image-page-${crypto.randomUUID()}`, name: existingPage?.name ?? (label ? `Display — ${label}` : 'Display image'),
      ...(requested.specified ? { pagePosition: requested.position } : {}),
      ...(existingPage && typeof category.paginate === 'function' ? { previousPagePosition: category.paginate(items).findIndex(page => page.plate?.id === existingPage.id) + 1 } : {}),
      value: image, afterId, ids: sources.map(s => s.p.id), displayId: source?.e.displayId, fromDisplay: Boolean(source) },
  } }
}

export function addImagePage(products, action) {
  if (action.type === 'positionImagePage') {
    const current = products.find(p => p.id === action.pageId && p.isPage && p.origin === 'manual-image-page' && p.image === action.value)
    if (!current || !Number.isInteger(action.pagePosition) || action.pagePosition < 1) return products
    const old = current.pagePosition ?? action.previousPagePosition
    if (old === action.pagePosition) return products
    return products.map(p => {
      if (p.id === current.id) return { ...p, pagePosition: action.pagePosition }
      if (p.isPage && p.origin === 'manual-image-page' && Number.isInteger(p.pagePosition)) {
        let position = p.pagePosition
        if (Number.isInteger(old) && position > old) position--
        if (position >= action.pagePosition) position++
        return position === p.pagePosition ? p : { ...p, pagePosition: position }
      }
      return p
    })
  }
  if (action.type !== 'addImagePage' || !action.value || !action.pageId || products.some(p => p.id === action.pageId)) return products
  const anchor = action.afterId == null ? -1 : products.findIndex(p => p.id === action.afterId)
  if (action.afterId != null && anchor < 0) return products
  if (action.fromDisplay && !products.some(p => action.ids.includes(p.id) && p.examples?.some(e =>
    e.origin === 'manual-display' && e.image === action.value && (!action.displayId || e.displayId === action.displayId)))) return products
  const next = action.fromDisplay ? removeDisplayImage(products, { type: 'removeDisplayImage', ids: action.ids, displayId: action.displayId, value: action.value }) : [...products]
  const page = { id: action.pageId, name: action.name, isPage: true, image: action.value,
    ...(Number.isInteger(action.pagePosition) && action.pagePosition > 0 ? { pagePosition: action.pagePosition } : {}),
    createdAt: Date.now(),
    photoTreatmentMode: 'preserve-scene', origin: 'manual-image-page', sourceDisplayId: action.displayId }
  const output = next.map(p => page.pagePosition && p.isPage && p.origin === 'manual-image-page' && Number.isInteger(p.pagePosition) && p.pagePosition >= page.pagePosition
    ? { ...p, pagePosition: p.pagePosition + 1 } : p)
  output.splice(anchor + 1, 0, page)
  return output
}
