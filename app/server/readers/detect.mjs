// Which known layout is this page?
//
// Both GEOMETRA templates mark their products with a coloured number badge, and
// the two badge colours are distinct enough to identify the template without any
// model: LED uses a cyan badge in a horizontal strip, PVC Marble a gold badge
// running down the left column.
//
// A page that matches neither is handed to the AI reader instead.

const isCyan = (r, g, b) => b > 150 && g > 120 && r < 120 && b - r > 60
const isGold = (r, g, b) => r > 150 && r - b > 55 && g > 90 && g < r

/** Columns/rows carrying at least `min` pixels of a colour, merged into runs. */
function runs(profile, min, gap) {
  const out = []
  let s = -1, last = -1
  profile.forEach((v, i) => {
    if (v < min) return
    if (s < 0) s = i
    else if (i - last > gap) { out.push([s, last + 1]); s = i }
    last = i
  })
  if (s >= 0) out.push([s, last + 1])
  return out
}

export function scanBadges(page, test, { xMax = null, minPx = 6, gap = 8 } = {}) {
  const { width, height, data } = page
  const limit = xMax ?? width
  const rowProfile = []
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = 0; x < limit; x++) {
      const i = (y * width + x) * 4
      if (test(data[i], data[i + 1], data[i + 2])) n++
    }
    rowProfile.push(n)
  }
  return runs(rowProfile, minPx, gap)
}

export function scanBadgeColumns(page, test, y0, y1, { minPx = 5, gap = 15 } = {}) {
  const { width, data } = page
  const colProfile = []
  for (let x = 0; x < width; x++) {
    let n = 0
    for (let y = y0; y < y1; y++) {
      const i = (y * width + x) * 4
      if (test(data[i], data[i + 1], data[i + 2])) n++
    }
    colProfile.push(n)
  }
  return runs(colProfile, minPx, gap)
}

/**
 * @returns { template: 'led' | 'pvc' | null, evidence }
 */
export function detectTemplate(page) {
  const { width, height } = page
  const mm = width / 210          // px per mm at whatever DPI this page was rendered

  // LED: cyan badges. The threshold must be low enough to see a SINGLE badge —
  // a featured product has only one, and at a six-badge threshold it vanished,
  // which is why the featured block went unread on the first run.
  const cyanRows = scanBadges(page, isCyan, { minPx: Math.round(mm * 3) })
  const cyanBands = cyanRows
    .filter(([a, b]) => b - a > mm * 2 && b - a < mm * 9)
    .map(([a, b]) => ({
      top: a, bottom: b,
      cells: scanBadgeColumns(page, isCyan, a, b, { minPx: Math.round((b - a) * 0.3) })
        .filter(([x0, x1]) => x1 - x0 > mm * 3),
    }))
    .filter(band => band.cells.length > 0)

  // The widest band is the grid strip; anything below it with one or two badges
  // is a featured block.
  const stripBand = cyanBands.reduce((best, b) => (!best || b.cells.length > best.cells.length ? b : best), null)
  const ledCells = stripBand?.cells ?? []

  // PVC: gold badges stacked down the LEFT column only. Restricting x avoids the
  // gold "PVC MARBLE" banner and the gold dimension drawings further right.
  const goldRows = scanBadges(page, isGold, { xMax: Math.round(mm * 34), minPx: Math.round(mm * 6) })
  const pvcRows = goldRows.filter(([a, b]) => b - a > mm * 3 && b - a < mm * 8)

  if (ledCells.length >= 3) {
    const featured = cyanBands.filter(b => b !== stripBand && b.top > stripBand.top)
    return {
      template: 'led',
      evidence: `${ledCells.length} cyan badges in a strip, ${featured.length} featured block(s) below`,
      cells: ledCells,
      stripTop: stripBand.top,
      stripBottom: stripBand.bottom,
      featured,
    }
  }
  if (pvcRows.length >= 2) {
    return {
      template: 'pvc',
      evidence: `${pvcRows.length} gold badges down the left column`,
      rows: pvcRows,
    }
  }
  return { template: null, evidence: `cyan bands=${cyanBands.length}, gold rows=${pvcRows.length}` }
}
