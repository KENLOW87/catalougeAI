import { SEED } from './model.js'

// A previous Accessories import was saved without the fourth standard LED card.
// Repair only that unmistakable legacy signature: never resurrect a product from
// an arbitrary catalogue or overwrite an existing edited record.
export function repairLegacyAccessoriesProducts(categoryId, products) {
  if (categoryId !== 'accessories' || !Array.isArray(products)) return products
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
