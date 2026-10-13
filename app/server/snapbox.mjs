// Snapping a vision-estimated box onto the real content underneath it.
//
// Vision gives approximate boxes; a catalogue needs exact ones. The failure I hit
// doing this by hand was horizontal: a dimension label like "10mm" sits apart from
// the drawing body, and a box drawn slightly too narrow sliced it to "0mm".
//
// Two rules make this work:
//
// 1. SHRINK TO FIT, and grow only HORIZONTALLY where ink is clipped at the edge.
//    Vertical growth is disabled by default: a drawing sits directly beneath its
//    product photo with under 10px between them, so growing up reliably swallows
//    the photo. Vision estimates the vertical extent well enough; it is the
//    horizontal clipping of a detached label that actually goes wrong. Growing
//    symmetrically swallows the neighbour above -- in this template a dimension
//    drawing sits directly beneath its product photo. So horizontally we tolerate
//    a wide gap (to reclaim a detached "10mm" label) and vertically almost none.
//
// 2. "Background" is not the same as "white". Half the cells sit on a tinted
//    panel, so a plain white test marks the entire panel as content and the box
//    grows until it hits its budget. The local background colour is sampled from a
//    ring just outside the estimate, where the panel is, and both that colour and
//    white count as background.

const near = (data, i, c, tol) =>
  Math.hypot(data[i] - c[0], data[i + 1] - c[1], data[i + 2] - c[2]) < tol

/** Samples a ring just outside the box - that region is panel, whichever panel it is. */
function sampleBackground(page, x0, y0, x1, y1, ring) {
  const { width, height, data } = page
  const px = []
  const take = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = (y * width + x) * 4
    px.push([data[i], data[i + 1], data[i + 2]])
  }
  for (let x = x0 - ring; x <= x1 + ring; x += 3) { take(x, y0 - ring); take(x, y1 + ring) }
  for (let y = y0 - ring; y <= y1 + ring; y += 3) { take(x0 - ring, y); take(x1 + ring, y) }
  if (!px.length) return null
  const median = c => { const v = px.map(p => p[c]).sort((a, b) => a - b); return v[v.length >> 1] }
  return [median(0), median(1), median(2)]
}

export function snapBox(page, box, {
  white = 247,
  bgTol = 26,         // how close to the sampled panel colour still counts as background
  gapX = 42,          // horizontal gap to jump when reclaiming clipped content
  gapY = 10,          // vertical gap - deliberately tight
  // Reclaiming a clipped dimension label needs ~80px at 400dpi. Anything more and
  // the box walks into the neighbouring product, whose feathered edge leaves debris
  // at 2-14px spacing that no later trim threshold can separate out.
  maxGrowX = 0.025,
  maxGrowY = 0,      // see note below: vertical growth is not safe in this template
  minInk = 2,         // columns/rows need at least this much ink to count
} = {}) {
  const W = page.width, H = page.height
  const data = page.data

  let x0 = Math.max(0, Math.round(box.x * W))
  let y0 = Math.max(0, Math.round(box.y * H))
  let x1 = Math.min(W, Math.round((box.x + box.w) * W))
  let y1 = Math.min(H, Math.round((box.y + box.h) * H))
  const fallback = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
  if (x1 <= x0 || y1 <= y0) return fallback

  const panel = sampleBackground(page, x0, y0, x1, y1, Math.round(Math.min(W, H) * 0.006))
  // A near-white ring is just the page; only treat a genuinely tinted ring as a
  // second background colour.
  const tint = panel && (panel[0] < white || panel[1] < white || panel[2] < white) ? panel : null

  // On a TINTED panel the background is the tint -- and only the tint. Excluding
  // white as well would erase a white product (half this catalogue is white
  // aluminium on a blue-grey panel), which is exactly what made the first cut of
  // this function return a sliver instead of the product.
  const isInk = tint
    ? (x, y) => !near(data, (y * W + x) * 4, tint, bgTol)
    : (x, y) => {
      const i = (y * W + x) * 4
      return data[i] < white || data[i + 1] < white || data[i + 2] < white
    }
  const colInk = (x, a, b) => { let n = 0; for (let y = a; y < b; y++) if (isInk(x, y)) n++; return n }
  const rowInk = (y, a, b) => { let n = 0; for (let x = a; x < b; x++) if (isInk(x, y)) n++; return n }

  // --- shrink to the ink actually inside the estimate -----------------------
  let sx0 = x1, sx1 = x0
  for (let x = x0; x < x1; x++) if (colInk(x, y0, y1) >= minInk) { if (x < sx0) sx0 = x; sx1 = x + 1 }
  if (sx1 <= sx0) return fallback

  let sy0 = y1, sy1 = y0
  for (let y = y0; y < y1; y++) if (rowInk(y, sx0, sx1) >= minInk) { if (y < sy0) sy0 = y; sy1 = y + 1 }
  if (sy1 <= sy0) return fallback

  // --- grow outward only where the estimate clipped something ---------------
  // A side grows only if ink touches that edge, which is what "clipped" means.
  // Budgets are measured against the ORIGINAL bound: the loops move sx0/sx1/sy0/sy1,
  // so comparing against the live value lets growth run away unbounded.
  const budgetX = Math.round(maxGrowX * W), budgetY = Math.round(maxGrowY * H)
  const ox0 = sx0, ox1 = sx1, oy0 = sy0, oy1 = sy1

  if (sx0 === x0) {
    let x = sx0, run = 0
    while (x - 1 >= 0 && ox0 - (x - 1) <= budgetX && run <= gapX) {
      x--
      if (colInk(x, sy0, sy1) >= minInk) { sx0 = x; run = 0 } else run++
    }
  }
  if (sx1 === x1) {
    let x = sx1, run = 0
    while (x < W && x - ox1 <= budgetX && run <= gapX) {
      if (colInk(x, sy0, sy1) >= minInk) { sx1 = x + 1; run = 0 } else run++
      x++
    }
  }
  if (sy0 === y0) {
    let y = sy0, run = 0
    while (y - 1 >= 0 && oy0 - (y - 1) <= budgetY && run <= gapY) {
      y--
      if (rowInk(y, sx0, sx1) >= minInk) { sy0 = y; run = 0 } else run++
    }
  }
  if (sy1 === y1) {
    let y = sy1, run = 0
    while (y < H && y - oy1 <= budgetY && run <= gapY) {
      if (rowInk(y, sx0, sx1) >= minInk) { sy1 = y + 1; run = 0 } else run++
      y++
    }
  }

  return { x: sx0, y: sy0, w: sx1 - sx0, h: sy1 - sy0 }
}
