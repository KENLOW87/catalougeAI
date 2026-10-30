import { SEED } from './model.js'

// A previous Accessories import was saved without the fourth standard LED card.
// Repair only that unmistakable legacy signature: never resurrect a product from
// an arbitrary catalogue or overwrite an existing edited record.
export function repairLegacyAccessoriesProducts(categoryId, products) {
  if (categoryId !== 'accessories' || !Array.isArray(products)) return products
  products = repairMarch2026Variations(products)
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

const normal = value => String(value ?? '').trim().toLowerCase()
const thickness = product => /(?:thickness\s*:\s*)?(5mm|8mm)/i.exec(String(product?.third ?? ''))?.[1] ?? ''
const knownVariation = product => {
  if (![4, 5, 6].includes(product?.sourcePage)) return false
  const name = normal(product.name)
  return (product.sourcePage === 4 && (name === 'i profile' || name === 'end profile')) ||
    (product.sourcePage === 5 && name === 'corner profile') ||
    (product.sourcePage === 6 && name === 'aluminum end bend')
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
        examples = cleaned
        if (featureText || beforeAfter) {
          supportStrip = '/assets/source/accessories-march-2026/aluminum-end-bend-features.png'
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
      }
      if (current.third !== fixed.third || current.subtitle !== fixed.subtitle ||
          finishes.some((finish, index) => finish.name !== current.finishes?.[index]?.name)) changed = true
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
      finishes: members.map((member, index) => ({
        id: `${current.id}-thickness-${thickness(member) || index + 1}`,
        name: thickness(member) || ['5mm', '8mm'][index] || `Variation ${index + 1}`,
        photo: member.photo ?? null,
        photoOriginal: member.photoOriginal ?? null,
        photoDisplayBackground: member.photoDisplayBackground,
        drawing: member.drawing ?? null,
        drawingOriginal: member.drawingOriginal ?? null,
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
  6: [['Aluminum End Bend', `Size : 9'5"`, 'Thickness : 5mm / 8mm / Carbon Crystal']],
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
