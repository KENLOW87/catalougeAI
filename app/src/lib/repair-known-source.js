import { SEED } from './model.js'
import { PVC_SEED } from './categories/pvc.js'

// A previous Accessories import was saved without the fourth standard LED card.
// Repair only that unmistakable legacy signature: never resurrect a product from
// an arbitrary catalogue or overwrite an existing edited record.
export function repairLegacyAccessoriesProducts(categoryId, products) {
  if (!Array.isArray(products)) return products
  if (categoryId === 'carbon-crystal-wall') return repairCarbonCrystalProfileRows(products)
  if (categoryId !== 'accessories') return products
  products = repairPvcMeasurementDrawings(products)
  products = splitMarch2026EndBendProducts(products)
  products = repairMarch2026Variations(products)
  products = repairMarch2026FlatBarDrawings(products)
  products = repairMarch2026Page9Profiles(products)
  products = repairMarch2026Page10Assets(products)
  products = repairMarch2026LedRows(products)
  products = repairMarch2026Page3Profiles(products)
  products = repairMarch2026Page11And12Assets(products)
  const names = new Set(products.map(p => String(p?.name ?? '').trim().toLowerCase()))
  if (names.has('led - 508') || names.has('led-508')) return products
  const signature = ['led -160', 'led -170', 'led -195', 'led -15', 'corner led 601', 'led - 08']
  if (!signature.every(name => names.has(name))) return products

  const source = SEED.find(p => p.id === 'p4')
  if (!source) return products
  const before = products.findIndex(p => /^led\s*-\s*15$/i.test(String(p?.name ?? '')))
  if (before < 0) return products
  const restored = {
    ...source,
    id: `restored-${source.id}`,
    categoryId,
    sourcePage: 1,
    readBy: 'rules',
    sourcePreserved: true,
  }
  return [...products.slice(0, before), restored, ...products.slice(before)]
}

// Carbon Crystal's edge-profile source sheet is one page containing three
// different products (I, END and CORNER). A legacy import treated the first row
// as the final ordinary card on the preceding page and left the source strips as
// whole-row photo/drawing crops. Repair the exact three-row signature in place:
// stable IDs remain untouched, source scenes become display examples, and only
// the finish strips / dimension drawings are used as product media.
function repairCarbonCrystalProfileRows(products) {
  const names = products.map(product => normal(product?.name))
  const start = names.findIndex((name, index) =>
    name === 'i profile' && names[index + 1] === 'end profile' && names[index + 2] === 'corner profile' &&
    products.slice(index, index + 3).every(product => /carbon\s+crystal/i.test(`${product?.third ?? ''} ${product?.subtitle ?? ''}`)))
  if (start < 0) return products

  const version = '2026-11-16-carbon-edge-profile-page9'
  const rows = [
    ['i-profile', 'I Profile'],
    ['end-profile', 'END Profile'],
    ['corner-profile', 'CORNER Profile'],
  ]
  let changed = false
  const repaired = products.slice()
  rows.forEach(([key, name], offset) => {
    const current = products[start + offset]
    const base = `/assets/source/carbon-crystal-wall/page9-${key}`
    const photo = `${base}-photo.png?v=${version}`
    const drawing = `${base}-drawing.png?v=${version}`
    const display = `${base}-display.png?v=${version}`
    const next = {
      ...current,
      name,
      photo,
      photoOriginal: current.photoOriginal ?? current.photo,
      sourcePhotoBackup: current.sourcePhotoBackup ?? current.photo,
      drawing,
      drawingOriginal: current.drawingOriginal ?? current.drawing,
      sourceDrawingBackup: current.sourceDrawingBackup ?? current.drawing,
      examples: [{ image: display, caption: '', role: 'usage' }],
      examplesTrusted: true,
      sourceExamplesBackup: current.sourceExamplesBackup ?? current.examples ?? [],
      sourceLayout: 'carbon-edge-profile',
      sourcePreserved: true,
      readBy: 'rules',
    }
    if (JSON.stringify(next) !== JSON.stringify(current)) changed = true
    repaired[start + offset] = next
  })
  return changed ? repaired : products
}

// The saved March import can contain a stray "Led -160 New" row between the
// genuine LED cards. That single false product shifts every later source row,
// so repair the complete page-1 signature in place (keeping genuine stable IDs)
// instead of letting page-specific repairs miss their anchors.
function repairMarch2026LedRows(products) {
  const start = products.findIndex(product => Number(product?.sourcePage) === 1)
  if (start < 0 || start > 1) return products
  let end = start
  while (end < products.length && Number(products[end]?.sourcePage) === 1) end++
  const sourceRows = products.slice(start, end)
  const genuine = sourceRows.filter(product => normal(product?.name) !== 'led - 160 new')
  const expected = SEED.map(product => normal(product.name))
  const actual = genuine.map(product => normal(product?.name))
  if (genuine.length !== SEED.length || !expected.every((name, index) => actual[index] === name)) return products
  let changed = false
  const repairedRows = genuine.map((product, index) => {
    const source = SEED[index]
    if (!source) return product
    const next = {
      ...product,
      ...source,
      id: product.id,
      categoryId: 'accessories',
      sourcePage: 1,
      readBy: 'rules',
      sourcePreserved: true,
    }
    if (product.photo && product.photo !== source.photo) {
      next.photoOriginal = product.photoOriginal ?? product.photo
      next.sourcePhotoBackup = product.sourcePhotoBackup ?? product.photo
    }
    if (product.drawing && product.drawing !== source.drawing) {
      next.drawingOriginal = product.drawingOriginal ?? product.drawing
      next.sourceDrawingBackup = product.sourceDrawingBackup ?? product.drawing
    }
    if (JSON.stringify(next) !== JSON.stringify(product)) changed = true
    return next
  })
  if (!changed && genuine.length === sourceRows.length) return products
  return [...products.slice(0, start), ...repairedRows, ...products.slice(end)]
}

// Page 3 is CORNER, L (15mm/20mm white exceptions), L. A legacy saved import
// had three L rows, so the first product silently borrowed the wrong photos.
// Match only the complete page-3 run and restore the reviewed PVC source data.
function repairMarch2026Page3Profiles(products) {
  let indexes = products.map((product, index) => Number(product?.sourcePage) === 3 ? index : -1).filter(index => index >= 0)
  const indexedNames = indexes.map(index => normal(products[index]?.name))
  // Some legacy records lost sourcePage during the earlier category merge. The
  // surrounding March source sequence is still unambiguous: page 2 is H/T/END/W,
  // page 3 is the next three rows, and page 4 starts with I Profile.
  if ((indexes.length !== 3 || !(indexedNames.every(name => name === 'l profile') || (indexedNames[0] === 'corner profile' && indexedNames.slice(1).every(name => name === 'l profile')))) && products.length >= 15 &&
      ['h profile', 't profile', 'end profile', 'w profile'].every((name, i) => normal(products[7 + i]?.name) === name) &&
      normal(products[14]?.name) === 'i profile') indexes = [11, 12, 13]
  if (indexes.length !== 3) return products
  const current = indexes.map(index => products[index])
  const names = current.map(product => normal(product?.name))
  if (!(names.every(name => name === 'l profile') || (names[0] === 'corner profile' && names.slice(1).every(name => name === 'l profile')))) return products
  const sources = PVC_SEED.slice(4, 7)
  let changed = false
  const repaired = products.slice()
  indexes.forEach((index, offset) => {
    const product = products[index]
    const source = sources[offset]
    if (!source) return
    const next = {
      ...product,
      name: source.name,
      productShape: 'generic',
      size: source.size,
      subtitle: `Size : ${source.size}`,
      third: source.series,
      variants: source.variants,
      exceptions: source.exceptions,
      extra: source.extra,
      drawing: source.drawing,
      sourcePage: 3,
      readBy: 'rules',
      sourcePreserved: true,
    }
    if (product.drawing && product.drawing !== source.drawing) {
      next.drawingOriginal = product.drawingOriginal ?? product.drawing
      next.sourceDrawingBackup = product.sourceDrawingBackup ?? product.drawing
    }
    if (JSON.stringify(next) !== JSON.stringify(product)) changed = true
    repaired[index] = next
  })
  return changed ? repaired : products
}

// Page 11/12 previously inherited whole-row crops and narrow drawing boxes.
// These assets are source-specific and are safe to restore by printed page and
// dimensions; unrelated catalogues never enter this repair path.
function repairMarch2026Page11And12Assets(products) {
  const version = '2026-11-16-final-source-assets'
  let changed = false
  const repaired = products.map(product => {
    const page = Number(product?.sourcePage)
    const name = normal(product?.name)
    const subtitle = String(product?.subtitle ?? '')
    let key = null
    if (page === 7 && name === 't micro-seam aluminium black') key = 'page7-t-micro-seam'
    if (page === 7 && name === 'h micro-seam aluminium silver') key = 'page7-h-micro-seam'
    if (page === 11 && name === 'u channel profile (b)' && /20\s*mm\s*x\s*3000/i.test(subtitle)) key = 'page11-u-channel-20mm'
    if (page === 11 && name === 'u channel profile (b)' && /10\s*mm\s*x\s*3000/i.test(subtitle)) key = 'page11-u-channel-10mm'
    if (page === 11 && name === 'wing flat bar') key = 'page11-wing-flat-bar'
    if (page === 12 && name === 'brass flat bar - bfb 01') key = 'page12-bfb-01'
    if (page === 12 && name === 'brass flat bar - bfb 02') key = 'page12-bfb-02'
    if (page === 12 && name === 'brass flat bar - bfb 03') key = 'page12-bfb-03'
    if (!key) return product
    const photo = `/assets/source/accessories-march-2026/${key}-photo.png?v=${version}`
    const drawing = `/assets/source/accessories-march-2026/${key}-drawing.png?v=${version}`
    const display = key === 'page7-t-micro-seam'
      ? `/assets/source/accessories-march-2026/page7-t-micro-seam-display.png?v=${version}`
      : null
    const examplesOk = !display || (product.examples?.length === 1 && product.examples[0]?.image === display)
    if (product.photo === photo && product.drawing === drawing && examplesOk) return product
    changed = true
    const next = {
      ...product,
      photo,
      photoOriginal: product.photoOriginal ?? product.photo,
      sourcePhotoBackup: product.sourcePhotoBackup ?? product.photo,
      drawing,
      drawingOriginal: product.drawingOriginal ?? product.drawing,
      sourceDrawingBackup: product.sourceDrawingBackup ?? product.drawing,
      sourcePreserved: true,
    }
    if (display && !examplesOk) {
      next.sourceExamplesBackup = product.sourceExamplesBackup ?? product.examples ?? []
      next.examples = [{ image: display, caption: 'Pemasangan T Micro-Seam', role: 'usage' }]
    }
    return next
  })
  return changed ? repaired : products
}

// The source PDF prints two separate Aluminum End Bend product cards on page 6:
// one 5mm card and one 8mm card. Older imports merged them as technical variants.
// Split that legacy shape back into two products while retaining the first ID and
// giving the second a stable thickness-specific ID.
function splitMarch2026EndBendProducts(products) {
  let changed = false
  const out = []
  for (const product of products) {
    if (product?.sourcePage !== 6 || normal(product.name) !== 'aluminum end bend') {
      out.push(product)
      continue
    }
    if (!product.variantTechnical || !Array.isArray(product.finishes) || product.finishes.length < 2) {
      const thickness = /thickness-8mm/i.test(String(product.id)) ||
        /^thickness\s*:\s*8mm\b/i.test(String(product.third ?? '')) ? '8mm' : '5mm'
      const drawing = `/assets/source/accessories-march-2026/aluminum-end-bend-${thickness}-drawing.png?v=2026-11-02-page6-drawings`
      const photo = `/assets/source/accessories-march-2026/aluminum-end-bend-${thickness}-photo.png?v=2026-11-03-page6-source-rows`
      const fixed = product.drawing === drawing && product.photo === photo ? product : {
        ...product,
        photo,
        photoOriginal: product.photoOriginal ?? product.photo,
        sourcePhotoBackup: product.sourcePhotoBackup ?? product.photo,
        drawing,
        drawingOriginal: product.drawingOriginal ?? product.drawing,
        sourceDrawingBackup: product.sourceDrawingBackup ?? product.drawing,
      }
      if (fixed !== product) changed = true
      out.push(fixed)
      continue
    }
    const { finishes, variants, photo: oldPhoto, drawing: oldDrawing, ...base } = product
    finishes.slice(0, 2).forEach((finish, index) => {
      const thickness = /5mm|8mm/i.exec(String(finish.name ?? ''))?.[0] ?? (index === 0 ? '5mm' : '8mm')
      out.push({
        ...base,
        id: index === 0 ? product.id : `${product.id}-thickness-${thickness}`,
        photo: `/assets/source/accessories-march-2026/aluminum-end-bend-${thickness}-photo.png?v=2026-11-03-page6-source-rows`,
        photoOriginal: finish.photoOriginal ?? null,
        drawing: `/assets/source/accessories-march-2026/aluminum-end-bend-${thickness}-drawing.png?v=2026-11-02-page6-drawings`,
        drawingOriginal: finish.drawingOriginal ?? null,
        sourceBox: finish.sourceBox ?? product.sourceBox ?? null,
        sourceDrawingBox: finish.sourceDrawingBox ?? product.sourceDrawingBox ?? null,
        subtitle: `Size : 9'5"`,
        third: `Thickness : ${thickness} / Carbon Crystal`,
        variantTechnical: false,
        finishes: undefined,
        variants: undefined,
        examples: [],
        supportStrip: index === 1 ? '/assets/source/accessories-march-2026/aluminum-end-bend-features.png?v=2026-11-02-page6-clean' : null,
        supportCaption: index === 1 ? 'Aluminum End Bend — original feature and bending guide' : null,
        sourceReferences: [],
      })
    })
    changed = true
  }
  return changed ? out : products
}

// Page 8's Flat Bar dimension crops were previously taken from a box that was
// tall enough to include the next row's caption.  The 80mm card therefore
// showed the size text as a clipped second line.  Replace only that known
// source drawing on load; keep the old asset as a recovery backup and never
// touch the product photo or any user-edited drawing from another source page.
function repairMarch2026FlatBarDrawings(products) {
  let changed = false
  const repaired = products.map(product => {
    if (Number(product?.sourcePage) !== 8 || normal(product.name) !== 'flat bar') return product
    const width = String(product.subtitle ?? '').match(/(20|25|30|80)\s*mm/i)?.[1]
    if (!width) return product
    const drawing = `/assets/source/accessories-march-2026/flat-bar-${width}mm-drawing.png?v=2026-11-24-page8-measurements-clean`
    const photo = `/assets/source/accessories-march-2026/flat-bar-${width}mm-photo.png?v=2026-11-03-page8-source-rows`
    if (product.drawing === drawing && product.photo === photo) return product
    changed = true
    return {
      ...product,
      photo,
      photoOriginal: product.photoOriginal ?? product.photo,
      sourcePhotoBackup: product.sourcePhotoBackup ?? product.photo,
      drawing,
      drawingOriginal: product.drawingOriginal ?? product.drawing,
      sourceDrawingBackup: product.sourceDrawingBackup ?? product.drawing,
    }
  })
  return changed ? repaired : products
}

// Page 9's previous saved records used a whole-row crop, so the cards showed
// neighbouring captions, drawings and the small reference pieces as if they
// were the product photo. Restore the three right-hand finish groups and the
// matching dimension sketches from the reviewed source rectangles.
function repairMarch2026Page9Profiles(products) {
  let changed = false
  const repaired = products.map(product => {
    if (product?.sourcePage !== 9) return product
    const name = normal(product.name)
    const size = String(product.subtitle ?? '')
    let key = null
    if (name === 't profile' && /10\s*mm\s*x\s*3000/i.test(size)) key = 't-profile-10mm'
    if (name === 'u channel profile' && /10\s*mm\s*x\s*3000/i.test(size)) key = 'u-channel-10mm'
    if (name === 'u channel profile' && /20\s*mm\s*x\s*3000/i.test(size)) key = 'u-channel-20mm'
    if (!key) return product
    const photo = `/assets/source/accessories-march-2026/page9-${key}-photo.png?v=2026-11-16-final-source-assets`
    const drawing = `/assets/source/accessories-march-2026/page9-${key}-drawing.png?v=2026-11-16-final-source-assets`
    const display = `/assets/source/accessories-march-2026/page9-${key}-display.png?v=2026-11-16-final-source-assets`
    const examplesOk = product.examples?.length === 1 && product.examples[0]?.image === display
    if (product.photo === photo && product.drawing === drawing && examplesOk) return product
    changed = true
    const next = {
      ...product,
      photo,
      photoOriginal: product.photoOriginal ?? product.photo,
      sourcePhotoBackup: product.sourcePhotoBackup ?? product.photo,
      drawing,
      drawingOriginal: product.drawingOriginal ?? product.drawing,
      sourceDrawingBackup: product.sourceDrawingBackup ?? product.drawing,
    }
    if (!examplesOk) {
      next.sourceExamplesBackup = product.sourceExamplesBackup ?? product.examples ?? []
      next.examples = [{ image: display, caption: `Gambar tambahan ${product.name || 'profile'}`, role: 'usage' }]
    }
    return next
  })
  return changed ? repaired : products
}

function repairMarch2026Page10Assets(products) {
  const version = '2026-11-16-final-source-assets'
  let changed = false
  const repaired = products.map(product => {
    if (Number(product?.sourcePage) !== 10 || normal(product?.name) !== 'l profile' || !/25\s*mm\s*x\s*3000/i.test(String(product?.subtitle ?? ''))) return product
    const photo = `/assets/source/accessories-march-2026/page10-l-profile-25mm-photo.png?v=${version}`
    const drawing = `/assets/source/accessories-march-2026/page10-l-profile-25mm-drawing.png?v=${version}`
    const display = `/assets/source/accessories-march-2026/page10-l-profile-25mm-display.png?v=${version}`
    const examplesOk = product.examples?.length === 1 && product.examples[0]?.image === display
    if (product.photo === photo && product.drawing === drawing && examplesOk) return product
    changed = true
    return {
      ...product,
      photo,
      photoOriginal: product.photoOriginal ?? product.photo,
      sourcePhotoBackup: product.sourcePhotoBackup ?? product.photo,
      drawing,
      drawingOriginal: product.drawingOriginal ?? product.drawing,
      sourceDrawingBackup: product.sourceDrawingBackup ?? product.drawing,
      sourceExamplesBackup: examplesOk ? product.sourceExamplesBackup : (product.sourceExamplesBackup ?? product.examples ?? []),
      examples: examplesOk ? product.examples : [{ image: display, caption: 'Gambar tambahan L Profile 25mm', role: 'usage' }],
      sourcePreserved: true,
    }
  })
  return changed ? repaired : products
}

// Existing Accessories imports may carry the old full-card dimension crops in
// IndexedDB. Replace only the unambiguous PVC source rows with the reviewed,
// dimension-only transparent drawings; retain the old pixels as a recovery copy.
function repairPvcMeasurementDrawings(products) {
  const nextIndex = { 2: 0, 3: 0 }
  let changed = false
  const repaired = products.map(product => {
    const page = Number(product?.sourcePage)
    if (![2, 3].includes(page)) return product
    const index = nextIndex[page]++
    const sourceIndex = page === 2 ? index : index + 4
    const source = PVC_SEED[sourceIndex]
    if (!source || normal(product.name) !== normal(source.name) || !source.drawing) return product
    const drawingChanged = product.drawing !== source.drawing
    const exceptionChanged = JSON.stringify(product.exceptions ?? null) !== JSON.stringify(source.exceptions ?? null)
    if (!drawingChanged && !exceptionChanged) return product
    changed = true
    return {
      ...product,
      drawing: drawingChanged ? source.drawing : product.drawing,
      drawingOriginal: drawingChanged && product.drawing ? (product.drawingOriginal ?? product.drawing) : product.drawingOriginal,
      sourceDrawingBackup: drawingChanged && product.drawing ? (product.sourceDrawingBackup ?? product.drawing) : product.sourceDrawingBackup,
      exceptions: source.exceptions,
    }
  })
  return changed ? repaired : products
}

const normal = value => String(value ?? '').trim().toLowerCase()
const thickness = product => /(?:thickness\s*:\s*)?(5mm|8mm)/i.exec(String(product?.third ?? ''))?.[1] ?? ''
const knownVariation = product => {
  if (![4, 5, 6].includes(product?.sourcePage)) return false
  const name = normal(product.name)
  return (product.sourcePage === 4 && (name === 'i profile' || name === 'end profile')) ||
    (product.sourcePage === 5 && name === 'corner profile')
}

const reviewedVariationPaths = (product, index) => {
  const page = Number(product?.sourcePage)
  if (![4, 5].includes(page)) return null
  const name = normal(product?.name)
  const variationKey = page === 4
    ? (name === 'i profile' ? 'i-profile' : name === 'end profile' ? 'end-profile' : null)
    : name === 'corner profile' ? 'corner' : null
  if (!variationKey) return null
  const mm = ['5mm', '8mm'][index]
  const prefix = page === 4 ? `page4-${variationKey}-${mm}` : `corner-${mm}`
  const version = page === 4 ? '2026-11-24-page4-variation-assets' : '2026-11-24-page5-variation-assets'
  return {
    photo: `/assets/source/accessories-march-2026/${prefix}-photo.png?v=${version}`,
    drawing: `/assets/source/accessories-march-2026/${prefix}-drawing.png?v=${version}`,
  }
}

// Repair the already-saved March 2026 catalogue without asking for another
// upload. This is deliberately source/page-specific: repeated names elsewhere
// may be real products and must not be merged by guesswork.
function repairMarch2026Variations(products) {
  const out = []
  let changed = false
  for (let i = 0; i < products.length; i++) {
    const current = products[i]
    if (current?.sourcePage === 6 && normal(current.name) === 'aluminum end bend features') {
      // The explanatory row belongs to Aluminum End Bend. Keep its main before /
      // after reference as one support band; never keep it as a product.
      const owner = [...out].reverse().find(p => p?.sourcePage === 6 && normal(p.name) === 'aluminum end bend')
      if (owner) {
        owner.supportStrip = current.photo || owner.supportStrip
        owner.supportCaption = 'Aluminum End Bend — original feature and bending guide'
        owner.sourceReferences = [
          ...(owner.sourceReferences ?? []),
          ...(current.drawing ? [{ image: current.drawing, role: 'source-reference', caption: 'Original feature explanation' }] : []),
        ]
      }
      changed = true
      continue
    }
    if (current.variantTechnical && knownVariation(current)) {
      const expected = ['5mm', '8mm']
      let finishes = (current.finishes ?? []).map((finish, index) => ({
        ...finish,
        name: expected[index] ?? finish.name,
        third: finish.third || `Thickness : ${expected[index] ?? ''} / Carbon Crystal`,
      }))
      // Re-imports may carry the old rendered row crop in each variation. The
      // reviewed source assets are the authoritative product-only rectangles;
      // restore them before pagination so every variation has the right photo
      // and complete dimension drawing.
      const reviewed = finishes.map((finish, index) => {
        const paths = reviewedVariationPaths(current, index)
        if (!paths) return finish
        const { photo, drawing } = paths
        if (finish.photo === photo && finish.drawing === drawing) return finish
        changed = true
        return {
          ...finish,
          photo,
          photoOriginal: finish.photoOriginal ?? finish.photo,
          sourcePhotoBackup: finish.sourcePhotoBackup ?? finish.photo,
          drawing,
          drawingOriginal: finish.drawingOriginal ?? finish.drawing,
          sourceDrawingBackup: finish.sourceDrawingBackup ?? finish.drawing,
          sourceRestoredFromPdf: true,
        }
      })
      finishes = reviewed
      // If an old reconcile duplicated the cleaned CORNER photo but retained
      // distinct source originals, restore those originals rather than showing
      // the same 8mm product for both thicknesses.
      if (current.sourcePage === 5 && finishes.length === 2 && finishes[0].photo === finishes[1].photo &&
          normal(current.name) === 'corner profile') {
        finishes = finishes.map((finish, index) => index === 0 ? {
          ...finish,
          photo: '/assets/source/accessories-march-2026/corner-5mm-photo.png',
          drawing: '/assets/source/accessories-march-2026/corner-5mm-drawing.png',
          sourceRestoredFromPdf: true,
        } : finish)
        changed = true
      }
      let examples = current.examples ?? []
      let supportStrip = current.supportStrip
      let sourceReferences = current.sourceReferences ?? []
      let sourceReferencesBackup = current.sourceReferencesBackup
      if (current.sourcePage === 5 && normal(current.name) === 'corner profile' && !supportStrip) {
        supportStrip = '/assets/source/accessories-march-2026/corner-support.png'
        changed = true
      }
      if (current.sourcePage === 6 && normal(current.name) === 'aluminum end bend') {
        const featureText = examples.find(example => example.caption === 'Feature explanation')
        const beforeAfter = examples.find(example => example.caption === 'Before bend / after bend')
        supportStrip ||= beforeAfter?.image
        if (featureText?.image && !sourceReferences.some(reference => reference.image === featureText.image)) {
          sourceReferences = [...sourceReferences, { image: featureText.image, role: 'source-reference', caption: 'Original feature explanation' }]
        }
        const cleaned = examples.filter(example => !['Feature explanation', 'Before bend / after bend'].includes(example.caption))
        if (cleaned.length !== examples.length) changed = true
        // The three finish photos belong to the two technical variations above,
        // not to the feature/support band. Keep only the original bend reference
        // in the support area so page 6 does not repeat and scatter product media.
        examples = []
        supportStrip = '/assets/source/accessories-march-2026/aluminum-end-bend-features.png?v=2026-11-02-page6-clean'
        sourceReferencesBackup = sourceReferences.length ? (current.sourceReferencesBackup ?? sourceReferences) : current.sourceReferencesBackup
        sourceReferences = []
        if (featureText || beforeAfter) {
          supportStrip = '/assets/source/accessories-march-2026/aluminum-end-bend-features.png?v=2026-11-02-page6-clean'
          sourceReferences = sourceReferences.filter(reference => reference.caption !== 'Original feature explanation')
        }
      }
      const fixed = {
        ...current,
        productShape: 'generic',
        subtitle: current.subtitle || `Size : 9'5"`,
        third: 'Thickness : 5mm / 8mm / Carbon Crystal',
        finishes,
        examples,
        supportStrip,
        supportCaption: current.sourcePage === 6
          ? 'Aluminum End Bend — original feature and bending guide'
          : current.sourcePage === 5 ? 'CORNER Profile — additional original profile reference' : current.supportCaption,
        sourceReferences,
        sourceReferencesBackup,
      }
      if (current.third !== fixed.third || current.subtitle !== fixed.subtitle ||
          finishes.some((finish, index) => finish.name !== current.finishes?.[index]?.name) ||
          current.supportStrip !== supportStrip || current.examples !== examples ||
          current.sourceReferences !== sourceReferences) changed = true
      out.push(fixed)
      continue
    }
    if (!knownVariation(current)) { out.push(current); continue }
    const next = products[i + 1]
    if (!next || !knownVariation(next) || next.sourcePage !== current.sourcePage || normal(next.name) !== normal(current.name)) {
      out.push(current)
      continue
    }
    const members = [current, next]
    const merged = {
      ...current,
      productShape: 'generic',
      variantTechnical: true,
      subtitle: current.subtitle || `Size : 9'5"`,
      third: `Thickness : ${members.map(thickness).filter(Boolean).join(' / ')} / Carbon Crystal`,
      photo: null,
      drawing: null,
      examples: current.sourcePage === 6 ? [] : current.examples,
      supportStrip: current.sourcePage === 6
        ? '/assets/source/accessories-march-2026/aluminum-end-bend-features.png?v=2026-11-02-page6-clean'
        : current.supportStrip,
      finishes: members.map((member, index) => ({
        ...(() => {
          const paths = reviewedVariationPaths(current, index)
          if (paths && (member.photo !== paths.photo || member.drawing !== paths.drawing)) changed = true
          return paths ? {
            photo: paths.photo,
            drawing: paths.drawing,
            photoOriginal: member.photoOriginal ?? member.photo,
            sourcePhotoBackup: member.sourcePhotoBackup ?? member.photo,
            drawingOriginal: member.drawingOriginal ?? member.drawing,
            sourceDrawingBackup: member.sourceDrawingBackup ?? member.drawing,
            sourceRestoredFromPdf: true,
          } : {}
        })(),
        id: `${current.id}-thickness-${thickness(member) || index + 1}`,
        name: thickness(member) || ['5mm', '8mm'][index] || `Variation ${index + 1}`,
        photo: reviewedVariationPaths(current, index)?.photo ?? member.photo ?? null,
        photoOriginal: reviewedVariationPaths(current, index)?.photo ? (member.photoOriginal ?? member.photo) : (member.photoOriginal ?? null),
        photoDisplayBackground: member.photoDisplayBackground,
        drawing: reviewedVariationPaths(current, index)?.drawing ?? member.drawing ?? null,
        drawingOriginal: reviewedVariationPaths(current, index)?.drawing ? (member.drawingOriginal ?? member.drawing) : (member.drawingOriginal ?? null),
        third: member.third ?? '',
        sourceBox: member.sourceBox ?? null,
        sourceDrawingBox: member.sourceDrawingBox ?? null,
      })),
    }
    out.push(merged)
    i++
    changed = true
  }
  const withMetadata = restoreMarch2026ProfileMetadata(out)
  return changed || withMetadata !== out ? withMetadata : products
}

const MARCH_PROFILE_META = {
  2: [
    ['H Profile', `Size : 9'5"`, 'PVC Marble'], ['T Profile', `Size : 9'5"`, 'PVC Marble'],
    ['END Profile', `Size : 9'5"`, 'PVC Marble'], ['W Profile', `Size : 9'5"`, 'PVC Marble'],
  ],
  3: [
    ['CORNER Profile', `Size : 9'5"`, 'PVC Marble'], ['L Profile', `Size : 9'5"`, 'PVC Marble'],
    ['L Profile', `Size : 9'5"`, 'PVC Marble'],
  ],
  4: [
    ['I Profile', `Size : 9'5"`, 'Thickness : 5mm / 8mm / Carbon Crystal'],
    ['END Profile', `Size : 9'5"`, 'Thickness : 5mm / 8mm / Carbon Crystal'],
  ],
  5: [['CORNER Profile', `Size : 9'5"`, 'Thickness : 5mm / 8mm / Carbon Crystal']],
  6: [
    ['Aluminum End Bend', `Size : 9'5"`, 'Thickness : 5mm / Carbon Crystal'],
    ['Aluminum End Bend', `Size : 9'5"`, 'Thickness : 8mm / Carbon Crystal'],
  ],
  7: [
    ['T Micro-Seam Aluminium Black', `Size : 9'5"`, 'Thickness : 8mm / Carbon Crystal'],
    ['H Micro-Seam Aluminium Silver', `Size : 9'5"`, 'Thickness : 8mm / Carbon Crystal'],
  ],
  8: [20, 25, 30, 80].map(width => ['Flat Bar', `Size : ${width}mm x 3000mm`, 'Thickness : 0.5mm']),
  9: [
    ['T Profile', 'Size : 10mm x 3000mm', 'Thickness : 0.5mm'],
    ['U CHANNEL Profile', 'Size : 10mm x 3000mm', 'Thickness : 10mm'],
    ['U CHANNEL Profile', 'Size : 20mm x 3000mm', 'Thickness : 10mm'],
  ],
  10: [10, 15, 25].map(width => ['L Profile', `Size : ${width}mm x 3000mm`, '']),
  11: [
    ['U CHANNEL Profile (B)', 'Size : 20mm x 3000mm', 'Thickness : 10mm'],
    ['U CHANNEL Profile (B)', 'Size : 10mm x 3000mm', 'Thickness : 10mm'],
    ['Wing Flat Bar', 'Size : 100mm x 3000mm', 'Thickness : 1mm'],
  ],
  12: [
    ['BRASS FLAT BAR - BFB 01', 'Size : 10mm x 3000mm', 'Thickness : 3mm'],
    ['BRASS FLAT BAR - BFB 02', 'Size : 5mm x 3000mm', 'Thickness : 5mm'],
    ['BRASS FLAT BAR - BFB 03', 'Size : 15mm x 3000mm', 'Thickness : 3mm'],
  ],
}

function restoreMarch2026ProfileMetadata(products) {
  const sequence = Object.entries(MARCH_PROFILE_META).flatMap(([page, rows]) =>
    rows.map(row => ({ page: Number(page), row })))
  // The old duplicate-name reconciliation could attach the right L Profile to
  // the wrong sourcePage. The complete 29-name sequence is stronger evidence
  // than that stale tag, and is unique to this reviewed PDF.
  for (let start = 0; start <= products.length - sequence.length; start++) {
    if (!sequence.every(({ row }, offset) => normal(products[start + offset]?.name) === normal(row[0]))) continue
    let changed = false
    const repaired = products.map((product, index) => {
      const source = sequence[index - start]
      if (!source) return product
      const [, subtitle, third] = source.row
      if (product.sourcePage === source.page && product.productShape === 'generic' &&
          product.subtitle === subtitle && product.third === third) return product
      changed = true
      return { ...product, sourcePage: source.page, productShape: 'generic', subtitle, third }
    })
    return changed ? repaired : products
  }

  // Fallback for a partially edited catalogue whose full source sequence is no
  // longer contiguous. This only fills records whose sourcePage/name pair still
  // has unambiguous source evidence.
  const seen = new Map()
  let changed = false
  const repaired = products.map(product => {
    const rows = MARCH_PROFILE_META[product?.sourcePage]
    if (!rows) return product
    const key = `${product.sourcePage}:${normal(product.name)}`
    const occurrence = seen.get(key) ?? 0
    seen.set(key, occurrence + 1)
    const metadata = rows.filter(row => normal(row[0]) === normal(product.name))[occurrence]
    if (!metadata) return product
    const [, subtitle, third] = metadata
    if (product.productShape === 'generic' && product.subtitle === subtitle && product.third === third) return product
    changed = true
    return { ...product, productShape: 'generic', subtitle, third }
  })
  return changed ? repaired : products
}
