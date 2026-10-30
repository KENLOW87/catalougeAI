// PVC Marble — "Edge Display / Aluminum accessories for PVC Marble"
//
// Structurally different from the LED category: not a grid, but full-width rows
// stacked down the page, one product per row, separated by a gold rule.
//
// Geometry measured off pages 2-3 of the source PDF at 400 DPI:
//   header (first page)   0    - 35.0   blue band, Edge Display, 收边条展示, PVC MARBLE banner
//   header (continuation) 0    - 35.0   banner only, no Edge Display title
//   badge                 32.6 - 37.3   (page 2)  /  39.0 - 44.4  (page 3)
//   name                  40.4 - 44.6
//   size                  47.2 - 50.9
//   series                53.0 - 56.7
//   drawing               61.9 - 81.4
//   variant photos        39.9 - 79.3
//   variant labels        80.3 - 84.0
//   gold rule             ~88.7
//
// The original row pitch is uneven (61.3, 66.7, 71.4 mm) because the page was laid
// out by hand. A reflowing catalogue cannot use hand-placed rows, so a uniform row
// height is imposed — the same trade-off already accepted for the LED grid.

export const PVC = {
  id: 'pvc-marble',
  title: 'PVC Marble',
  subtitle: 'Edge Display · 收边条展示',
}

export const PVC_GEOMETRY = {
  headerH: 35,
  flowTop: 36,
  flowBottom: 285,
  rowH: 58,          // a standard product row, rule included
  rowExceptionH: 100, // a row carrying an exception sub-row (product 6's White)
}

export const blankPvcProduct = () => ({
  id: `pvc${Math.random().toString(36).slice(2, 8)}`,
  name: '',
  size: `9'5"`,
  series: 'PVC Marble',
  drawing: null,
  variants: [],
  extra: null,
  exceptions: null,
})

export const blankVariant = () => ({
  id: `v${Math.random().toString(36).slice(2, 8)}`,
  name: '',
  photo: null,
})

const A = 'public/assets/pvc'
const v = (id, name, i) => ({ id: `${id}-v${i}`, name, photo: `/assets/pvc/${id}-v${i}.png` })

// The 7 products as extracted from pages 2-3.
export const PVC_SEED = [
  {
    id: 'h-profile', name: 'H Profile', size: `9'5"`, series: 'PVC Marble',
    drawing: '/assets/pvc/h-profile-drawing.png', extra: null, exceptions: null,
    variants: [v('h-profile', 'Silver', 0), v('h-profile', 'Rose Gold', 1), v('h-profile', 'Gold', 2), v('h-profile', 'Black', 3)],
  },
  {
    id: 't-profile', name: 'T Profile', size: `9'5"`, series: 'PVC Marble',
    drawing: '/assets/pvc/t-profile-drawing.png', extra: '/assets/pvc/t-profile-extra.png', exceptions: null,
    variants: [v('t-profile', 'Silver', 0), v('t-profile', 'Rose Gold', 1), v('t-profile', 'Gold', 2), v('t-profile', 'Black', 3)],
  },
  {
    id: 'end-profile', name: 'END Profile', size: `9'5"`, series: 'PVC Marble',
    drawing: '/assets/pvc/end-profile-drawing.png', extra: '/assets/pvc/end-profile-extra.png', exceptions: null,
    variants: [v('end-profile', 'Silver', 0), v('end-profile', 'Rose Gold', 1), v('end-profile', 'Gold', 2), v('end-profile', 'Black', 3)],
  },
  {
    // Only three finishes — no Rose Gold. The variant list is genuinely variable length.
    id: 'w-profile', name: 'W Profile', size: `9'5"`, series: 'PVC Marble',
    drawing: '/assets/pvc/w-profile-drawing.png', extra: '/assets/pvc/w-profile-extra.png', exceptions: null,
    variants: [v('w-profile', 'Silver', 0), v('w-profile', 'Gold', 1), v('w-profile', 'Black', 2)],
  },
  {
    id: 'corner-profile', name: 'CORNER Profile', size: `9'5"`, series: 'PVC Marble',
    drawing: '/assets/pvc/corner-profile-drawing.png', extra: '/assets/pvc/corner-profile-extra.png', exceptions: null,
    variants: [v('corner-profile', 'Silver', 0), v('corner-profile', 'Rose Gold', 1), v('corner-profile', 'Gold', 2), v('corner-profile', 'Black', 3)],
  },
  {
    // Carries the source PDF's one exception: the White finish is shown at 20mm
    // with its own photo and dimension drawing, plus the printed note.
    id: 'l-profile-14', name: 'L Profile', size: `9'5"`, series: 'PVC Marble',
    drawing: '/assets/pvc/l-profile-14-drawing.png', extra: null,
    variants: [v('l-profile-14', 'Silver', 0), v('l-profile-14', 'Rose Gold', 1), v('l-profile-14', 'Gold', 2), v('l-profile-14', 'Black', 3)],
    exceptions: [
      {
        variant: { id: 'l14-white-20', name: 'White', photo: '/assets/pvc/l-profile-14-white.png' },
        drawing: '/assets/pvc/l-profile-14-white-drawing.png',
        note: '(This size only for White Color)',
      },
    ],
  },
  {
    id: 'l-profile-10', name: 'L Profile', size: `9'5"`, series: 'PVC Marble',
    drawing: '/assets/pvc/l-profile-10-drawing.png', extra: null, exceptions: null,
    variants: [v('l-profile-10', 'Silver', 0), v('l-profile-10', 'Rose Gold', 1), v('l-profile-10', 'Gold', 2), v('l-profile-10', 'Black', 3)],
  },
]

export const rowHeight = p => (p.exceptions?.length ? PVC_GEOMETRY.rowExceptionH : PVC_GEOMETRY.rowH)

/**
 * PVC Marble reflow: one product per full-width row, flowing top-down.
 *
 * Simpler than the LED category because every product is the same shape — there is
 * no second product type to push to a later page. A row moves to the next page when
 * it no longer fits. Numbering is positional, exactly as in LED: the badge is
 * computed over the final order and never stored on the product, so deleting a
 * product closes the gap and pulls later products backward across page boundaries.
 */
export function paginatePvc(products) {
  const numbered = products.map((p, i) => ({ ...p, slot: i + 1 }))
  const pages = []
  let page = { index: 1, rows: [] }
  let used = 0

  for (const p of numbered) {
    const h = rowHeight(p)
    const capacity = PVC_GEOMETRY.flowBottom - PVC_GEOMETRY.flowTop
    if (used + h > capacity && used > 0) {
      pages.push(page)
      page = { index: page.index + 1, rows: [] }
      used = 0
    }
    page.rows.push(p)
    used += h
  }
  if (page.rows.length || pages.length === 0) pages.push(page)
  return pages
}
