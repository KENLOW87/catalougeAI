import { TYPE_A, TYPE_B } from './model.js'
import { CELL_A, BLOCK_B, FLOW, GRID } from './geometry.js'

// Lay the ordered product list out into pages.
//
// The client's rule, stated once and treated as authoritative:
//   1. A new Type A product is appended to the grid and wraps to a new row
//      directly underneath the existing row, on the same page.
//   2. As Type A rows grow, the Type B block is pushed onto a following page.
//   3. A new Type B product goes onto a further page, using the same full-width
//      structure as the original #7.
//
// So Type A flows first and fills pages top-down; Type B blocks always follow.
// The badge number ("bil no.") is positional -- it is assigned here over the
// final order and is never stored on the product, so it always reads 1,2,3...
// with no gaps however the list is edited.

export function orderedProducts(products) {
  const a = products.filter(p => p.type === TYPE_A)
  const b = products.filter(p => p.type === TYPE_B)
  return [...a, ...b]
}

export function paginate(products) {
  const ordered = orderedProducts(products)

  // Assign the positional badge number over the final flow order.
  const numbered = ordered.map((p, i) => ({ ...p, slot: i + 1 }))

  const typeA = numbered.filter(p => p.type === TYPE_A)
  const typeB = numbered.filter(p => p.type === TYPE_B)

  // Chunk Type A into rows of six.
  const rows = []
  for (let i = 0; i < typeA.length; i += GRID.columns) {
    rows.push(typeA.slice(i, i + GRID.columns))
  }

  const pages = []
  let page = newPage(1)
  let used = 0

  const capacity = () => (page.index === 1 ? FLOW.page1H : FLOW.contH)
  const pushPage = () => { pages.push(page); page = newPage(page.index + 1); used = 0 }

  for (const row of rows) {
    const need = used === 0 ? CELL_A.rowH : CELL_A.rowH + FLOW.rowGap
    if (used + need > capacity() && used > 0) pushPage()
    used += used === 0 ? CELL_A.rowH : CELL_A.rowH + FLOW.rowGap
    page.rows.push(row)
  }

  for (const block of typeB) {
    const need = used === 0 ? BLOCK_B.blockH : BLOCK_B.blockH + FLOW.blockGap
    if (used + need > capacity() && used > 0) pushPage()
    used += used === 0 ? BLOCK_B.blockH : BLOCK_B.blockH + FLOW.blockGap
    page.blocks.push(block)
  }

  if (page.rows.length || page.blocks.length || pages.length === 0) pages.push(page)
  return pages
}

function newPage(index) {
  return { index, rows: [], blocks: [] }
}

// The alternating tinted panel is a property of the SLOT, not the product.
// Verified against the original: slots 1, 3, 5 and 7 are tinted.
export const isTinted = slot => slot % 2 === 1
