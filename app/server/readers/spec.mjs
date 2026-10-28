// A layout expressed as DATA, not code.
//
// The LED and PVC readers each hardcode two things: how to find a product, and
// where each field sits relative to it. Neither needs to be code. Put both in a
// spec and one engine reads any layout that follows the same shape — which means
// a new catalogue can be taught through the UI instead of written by a developer.
//
// Boxes are in MILLIMETRES, relative to the top-left of the product's anchor, so a
// spec is resolution-independent: measured on a 200 DPI preview, applied to a 400
// DPI render.

import { crop, toBuffer, inkFromBright } from '../imageops.mjs'
import { splitStrip } from '../split-strip.mjs'
import { ocr, ocrLabel } from '../ocr.mjs'
import { snapTo, repairSize, repairLength, repairLengthParen, repairFirstMm, repairCode, snapCode, trimBleed, FINISHES } from './vocab.mjs'

const dataUrl = img => `data:image/png;base64,${toBuffer(img).toString('base64')}`

/**
 * @typedef {Object} LayoutSpec
 * @property {string} id
 * @property {string} title
 * @property {{rgb:[number,number,number], tolerance:number, arrangement:'row'|'column',
 *            scanWidthMm?:number, minSizeMm?:number, maxSizeMm?:number}} anchor
 * @property {Array<{key:string, type:'text'|'photo'|'lineart'|'finishes',
 *                   box:{x:number,y:number,w:number,h:number},
 *                   labelBox?:{x:number,y:number,w:number,h:number},
 *                   repair?:'size'|'length', vocab?:boolean}>} fields
 */

const near = (r, g, b, c, tol) => Math.hypot(r - c[0], g - c[1], b - c[2]) < tol

/** Merges indices into runs, tolerating small gaps. */
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

/**
 * Finds every product anchor on the page.
 * @returns array of {x, y} in pixels — the top-left of each anchor
 */
/**
 * Finds products that are marked by nothing but their own photograph.
 *
 * Many catalogues have no numbered badge at all — they are a grid of product
 * photos with a caption under each. The product IS the photo block, so the anchor
 * is found by shape rather than by colour: a large, solidly filled rectangle that
 * is not a full-width banner.
 *
 * Returns anchors carrying their own width and height, which the field boxes then
 * measure from — a caption sits under ITS block, whatever size that block is.
 */
export function findBlockAnchors(page, anchor) {
  const { width, height, data } = page
  const mm = width / 210
  const n = width * height
  const minSize = (anchor.minSizeMm ?? 25) * mm
  const minFill = anchor.minFill ?? 0.62
  const maxWidthFrac = anchor.maxWidthFrac ?? 0.5
  const white = anchor.white ?? 246

  const ink = new Uint8Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    ink[i] = (data[p] < white || data[p + 1] < white || data[p + 2] < white) ? 1 : 0
  }

  const label = new Int32Array(n).fill(-1)
  const stack = new Int32Array(n)
  const boxes = []
  for (let start = 0; start < n; start++) {
    if (!ink[start] || label[start] >= 0) continue
    const id = boxes.length
    let sp = 0, area = 0, minX = width, maxX = -1, minY = height, maxY = -1
    stack[sp++] = start
    label[start] = id
    while (sp > 0) {
      const cur = stack[--sp]
      area++
      const cx = cur % width, cy = (cur / width) | 0
      if (cx < minX) minX = cx
      if (cx > maxX) maxX = cx
      if (cy < minY) minY = cy
      if (cy > maxY) maxY = cy
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = cx + dx, ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (ink[ni] && label[ni] < 0) { label[ni] = id; stack[sp++] = ni }
        }
      }
    }
    // Only keep components big enough to be a product. At 400 DPI a page of
    // photographs produces hundreds of thousands of tiny anti-aliasing specks, and
    // holding an object for each one is pure memory pressure for no information.
    const w = maxX - minX + 1, h = maxY - minY + 1
    if (w < minSize || h < minSize) continue
    boxes.push({ area, minX, maxX, minY, maxY, w, h })
  }

  const blocks = boxes.filter(b =>
    b.w <= width * maxWidthFrac &&
    b.area / (b.w * b.h) >= minFill)

  if (!blocks.length) return []
  if (anchor.realOnly) return blocks.map(b => ({ x: b.minX, y: b.minY, w: b.w, h: b.h, block: true, bandCount: 1 }))

  // Find the page's PITCH — the repeating cell size most blocks agree on. A page
  // can mix the ordinary cell width with a "hero" cell spanning two or more columns
  // (a double-width featured product beside six ordinary ones): including those in
  // the estimate would drag the median sideways, so only the size most blocks share
  // decides the grid. This is for grid PROJECTION ONLY — recovering a cell whose
  // product is too pale to pass the fill test. It must never be used to decide which
  // REAL blocks are products; see `found` below.
  const median = arr => { const v = [...arr].sort((a, b) => a - b); return v[v.length >> 1] }
  const mw = median(blocks.map(b => b.w)), mh = median(blocks.map(b => b.h))
  const tol = anchor.sizeToleranceMm ? anchor.sizeToleranceMm * mm : Math.max(mw, mh) * 0.35
  const kept = blocks.filter(b => Math.abs(b.w - mw) <= tol && Math.abs(b.h - mh) <= tol)
  const use = kept.length >= 2 ? kept : blocks

  // --- fill in the grid ------------------------------------------------------
  //
  // Detection alone is unreliable on a page of near-WHITE products: a white marble
  // sheet on a white page is separated from it only by a faint edge, so its region
  // breaks up and fails the fill test while its darker neighbours pass. The same
  // happens where a sticker overlaps a corner.
  //
  // But these pages are grids. Once a few blocks are found the pitch is known, so
  // the rest of the cells can be projected — and then CONFIRMED by checking each
  // one actually contains something. Projection supplies the position; ink decides
  // whether a product is really there.
  const cluster = (values, tol) => {
    const out = []
    for (const v of [...values].sort((a, b) => a - b)) {
      const last = out[out.length - 1]
      if (last && v - last.at <= tol) { last.at = (last.at * last.n + v) / (last.n + 1); last.n++ }
      else out.push({ at: v, n: 1 })
    }
    return out.map(c => Math.round(c.at))
  }

  const cols = cluster(use.map(b => b.minX), mw * 0.5)
  const rowsY = cluster(use.map(b => b.minY), mh * 0.5)

  // A cell counts as occupied if a decent share of it is not page-white. The
  // threshold is deliberately loose: pale marble is barely darker than the page.
  const occupied = (x, y) => {
    let hit = 0, total = 0
    const step = Math.max(2, Math.round(mw / 40))
    for (let yy = y; yy < Math.min(height, y + mh); yy += step) {
      for (let xx = x; xx < Math.min(width, x + mw); xx += step) {
        total++
        const i = (yy * width + xx) * 4
        if (data[i] < 252 || data[i + 1] < 252 || data[i + 2] < 252) hit++
      }
    }
    return total > 0 && hit / total >= 0.5
  }

  // A GENUINE block is always kept as itself, at its OWN measured size — including
  // one wider than the ordinary pitch. `maxWidthFrac` and `minFill` already ruled
  // out page furniture above, so a block that reaches here really is a product; a
  // "hero" card spanning two columns (page 3's PW07, PS FLAT BAR) is one product,
  // not a slice of one. Earlier this synthesised a STANDARD-size cell for every grid
  // position instead, which truncated a wide block to one column's width and then,
  // because nothing stopped the projection from landing a SECOND cell on the same
  // block's leftover ink, duplicated it — the real product beside it went unfound.
  const found = blocks.map(b => ({ x: b.minX, y: b.minY, w: b.w, h: b.h }))

  // A projected grid cell only gets to synthesise a cell when NO real block already
  // covers that position — checked by its centre, the same test `unique` uses below.
  const coveredByReal = (cx, cy) => found.some(b => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h)

  for (const y of rowsY) {
    for (const x of cols) {
      const cx = x + mw / 2, cy = y + mh / 2
      if (coveredByReal(cx, cy)) continue
      if (occupied(x, y)) found.push({ x, y, w: mw, h: mh })
    }
  }

  // ONE PHOTO, ONE PRODUCT. A page can hold two grids of different pitch — PU Stone
  // page 4 has a row of four above a row of three — and clustering every left edge
  // together then produces two column positions that both land on the same photo.
  // That photo was emitted twice and became two identical products.
  //
  // Overlap is the test, not position: however a cell arrived, if its centre sits
  // inside a block already found, it is that same block again.
  const unique = []
  for (const b of found) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    const dup = unique.some(u => cx >= u.x && cx <= u.x + u.w && cy >= u.y && cy <= u.y + u.h)
    if (!dup) unique.push(b)
  }

  // Reading order: left to right, then down. Rows are grouped by a tolerance so a
  // few pixels of vertical drift does not scramble the order.
  const rowTol = mh * 0.5
  return unique
    .map(b => ({ ...b, bandCount: 1, block: true }))
    .sort((a, c) => (Math.abs(a.y - c.y) <= rowTol ? a.x - c.x : a.y - c.y))
}

/**
 * Finds products marked by a big BOLD HEADING rather than a badge or a photo
 * block — "C-R80" / "C-R100" printed oversized inside one wide feature block that
 * holds two products ("ALUMINIUM CORNER EDGE"), too wide for `blocks`'s own
 * maxWidthFrac and too broken up by its own paragraph text and diagrams to ever
 * register as one solidly-filled rectangle.
 *
 * A heading is found the same way a person would describe it: taller than body
 * text (`minHeightMm`/`maxHeightMm` on a row-band of dark ink), and a compact run
 * of ink within that band (`minWidthMm`/`maxWidthMm`) — which is what tells the
 * actual heading apart from the body paragraph sharing the same row height, a much
 * longer run of ordinary-weight text wrapping across the same lines.
 */
export function findTextBlockAnchors(page, anchor) {
  const { width, height, data } = page
  const mm = width / 210
  const darkCut = anchor.darkCut ?? 80
  const minHeightMm = anchor.minHeightMm ?? 6
  const maxHeightMm = anchor.maxHeightMm ?? 15
  const minWidthMm = anchor.minWidthMm ?? 15
  const maxWidthMm = anchor.maxWidthMm ?? 50
  const minRowInk = anchor.minRowInk ?? 10
  const minColInk = anchor.minColInk ?? 3
  const rowGapMm = anchor.rowGapMm ?? 1
  const colGapMm = anchor.colGapMm ?? 3
  // Scanning the FULL page width lets a dense body paragraph elsewhere on the same
  // row keep the row-band "open" (its line-to-line gap is under a millimetre, far
  // less than a heading's own leading) and swallow the real heading into one long
  // band spanning the whole paragraph. A heading sits in a known horizontal slice
  // of the page (the right-hand side of a feature block, say), so the scan can be
  // confined there — scanX1Frac defaults to the right HALF, which is also where
  // `blocks`'s own maxWidthFrac draws the same "not a banner" line.
  const scanX0 = Math.round((anchor.scanX0Frac ?? 0.5) * width)
  const scanX1 = Math.round((anchor.scanX1Frac ?? 1) * width)

  const lumAt = (x, y) => {
    const i = (y * width + x) * 4
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }

  // Row-bands tall enough to be a HEADING, not a line of body text.
  const rowBands = []
  let s = -1, last = -1
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = scanX0; x < scanX1; x += 2) if (lumAt(x, y) < darkCut) n++
    if (n >= minRowInk) { if (s < 0) s = y; last = y }
    else if (s >= 0 && y - last > mm * rowGapMm) { rowBands.push([s, last + 1]); s = -1 }
  }
  if (s >= 0) rowBands.push([s, last + 1])
  const bands = rowBands.filter(([a, c]) => {
    const h = (c - a) / mm
    return h >= minHeightMm && h <= maxHeightMm
  })

  // Within a tall-enough band, a compact column RUN is the heading itself — a
  // paragraph sharing the same row height instead runs on far wider.
  const anchors = []
  for (const [y0, y1] of bands) {
    const colDark = new Array(scanX1).fill(0)
    for (let x = scanX0; x < scanX1; x++) {
      let n = 0
      for (let y = y0; y < y1; y++) if (lumAt(x, y) < darkCut) n++
      colDark[x] = n
    }
    const runs = []
    let cs = -1, clast = -1
    for (let x = scanX0; x < scanX1; x++) {
      if (colDark[x] >= minColInk) { if (cs < 0) cs = x; clast = x }
      else if (cs >= 0 && x - clast > mm * colGapMm) { runs.push([cs, clast]); cs = -1 }
    }
    if (cs >= 0) runs.push([cs, clast])
    for (const [x0, x1] of runs) {
      const wmm = (x1 - x0) / mm
      if (wmm >= minWidthMm && wmm <= maxWidthMm) {
        anchors.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0, bandCount: 1, block: true })
      }
    }
  }
  anchors.sort((a, b) => a.y - b.y || a.x - b.x)
  return anchors
}

export function findAnchors(page, anchor) {
  if (anchor?.type === 'fixed') {
    if (anchor.pages?.length && !anchor.pages.includes(anchor.pageNo)) return []
    const mm = page.width / 210
    return (anchor.boxes ?? []).map(box => ({
      x: Math.round(box.x * mm),
      y: Math.round(box.y * mm),
      w: Math.round(box.w * mm),
      h: Math.round(box.h * mm),
    }))
  }
  // A layout with no coloured mark finds its products by shape instead.
  if (anchor?.type === 'blocks') return findBlockAnchors(page, anchor)
  if (anchor?.type === 'textBlocks') return findTextBlockAnchors(page, anchor)

  const { width, height, data } = page
  const mm = width / 210
  const { rgb, tolerance = 60, arrangement = 'row' } = anchor
  const minSize = (anchor.minSizeMm ?? 2) * mm
  const maxSize = (anchor.maxSizeMm ?? 10) * mm
  const scanX = anchor.scanWidthMm ? Math.round(anchor.scanWidthMm * mm) : width

  const hit = (x, y) => {
    const i = (y * width + x) * 4
    return near(data[i], data[i + 1], data[i + 2], rgb, tolerance)
  }

  // Horizontal bands carrying the anchor colour.
  const rowProfile = []
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = 0; x < scanX; x++) if (hit(x, y)) n++
    rowProfile.push(n)
  }
  // Low threshold on purpose: a featured product has a SINGLE anchor, and a
  // threshold tuned for a full row of them skips it silently.
  const bands = runs(rowProfile, Math.max(2, Math.round(mm * 2)), Math.round(mm * 2))
    .filter(([a, b]) => b - a >= minSize && b - a <= maxSize)

  // An anchor is a SOLID mark. Line art in the same colour is not one — PVC's gold
  // dimension drawings sit in the same left column as its gold badges, and without
  // this test they register as extra products and shift every field box.
  // Measured: a badge fills ~62% of its box, a gold drawing ~5%.
  const minFill = anchor.minFill ?? 0.3
  const fillOf = (x0, x1, y0, y1) => {
    let h = 0, t = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t++; if (hit(x, y)) h++ }
    return t ? h / t : 0
  }

  const anchors = []
  for (const [y0, y1] of bands) {
    const colProfile = []
    for (let x = 0; x < scanX; x++) {
      let n = 0
      for (let y = y0; y < y1; y++) if (hit(x, y)) n++
      colProfile.push(n)
    }
    const cols = runs(colProfile, Math.max(1, Math.round((y1 - y0) * 0.25)), Math.round(mm * 3))
      .filter(([a, b]) => b - a >= minSize * 0.6)
      .filter(([a, b]) => fillOf(a, b, y0, y1) >= minFill)
    for (const [x0] of cols) {
      anchors.push({ x: x0, y: y0, bandTop: y0, bandBottom: y1, bandCount: cols.length })
    }
  }

  // In a column layout every badge shares the same left edge. Anything off that
  // line is not a product marker — a stray run inside PVC's gold dimension drawing
  // survived the fill test at x=24.3mm while every real badge sat at 15.6mm, and
  // became a phantom fifth product.
  if (arrangement === 'column' && anchors.length > 2) {
    const xs = anchors.map(a => a.x).sort((p, q) => p - q)
    const medianX = xs[xs.length >> 1]
    const tol = (anchor.columnToleranceMm ?? 4) * mm
    const kept = anchors.filter(a => Math.abs(a.x - medianX) <= tol)
    if (kept.length >= 2) anchors.length = 0, anchors.push(...kept)
  }

  // Reading order.
  anchors.sort((a, b) => a.y - b.y || a.x - b.x)
  return anchors
}

// Product photos are source material, not silhouettes to be cleaned. Keep the
// exact field crop and all of its pixels; only the catalogue CSS decides how it
// fits the product card. Final product isolation happens once after PDF reading.
const cleanPhoto = img => img

// Product codes deserve a second, stricter OCR pass. A normal text whitelist lets
// Tesseract choose lowercase l/O/S and punctuation, which is exactly where short
// catalogue codes fail. The strict pass removes those alternatives; repairCode then
// resolves the remaining O/0, I/1 and S/5 confusions. If the strict read does not
// form a plausible code, keep the normal read rather than inventing one.
async function readCodeLabel(img, f) {
  const base = await ocrLabel(img, f.whitelist ? { whitelist: f.whitelist } : {})
  const strict = await ocrLabel(img, { whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' })
  const fixed = repairCode(strict.text, { requireDigit: !f.looseCode }).value
  const compact = fixed.replace(/\s+/g, '')
  if (/^[A-Z]{1,8}\d{1,6}[A-Z]?$/.test(compact)) return fixed
  return trimBleed(base.text)
}

/**
 * Reads a box as however many lines of text it actually holds, and joins them —
 * "GOLD" stacked over "PW02" becomes "GOLD PW02", one line stays one word. Shared
 * by `joinLines` (one title, N lines) and `parts` (several differently-styled
 * titles side by side, each read this way and then joined together).
 *
 * A real continuation line sits close under the first, at title line spacing; the
 * gap before genuine photo content starts is bigger, by design. So once the first
 * line is found, only further lines that follow closely — and are a similar
 * height, not a thick band of photo ink — are accepted as more of this title.
 *
 * Light text is binarised ONCE, over the whole box, and every line is then found
 * and read from THAT buffer — a mid-tone gradient background confused a per-pixel
 * "is this bright" scan of the raw page (it is not flat, so the same threshold
 * that correctly picks out the glyphs over one patch of background mis-fires over
 * another), where the same test applied after `inkFromBright` has already turned
 * the whole box into clean black-on-white has nothing left to be ambiguous about.
 *
 * `f.fromEnd` walks the SAME continuation test from the LAST line backward
 * instead of the first line forward — for a caption anchored to the bottom of a
 * box that can also catch an unrelated single line ABOVE it (a smaller diagram
 * dimension label, sitting closer to this box's top than the title-spacing gap
 * that separates genuine continuation lines, varying card to card with how tall
 * that card's own diagram happens to be). Growing backward from the line that is
 * always real — the caption always ends flush with the card's own bottom edge —
 * never has to guess how much of that variable gap to search past.
 *
 * @returns {{value: string, bounds: [number,number]|null}} bounds in ABSOLUTE page
 *   pixels, so a later field (a photo pinned between two text fields) can use them
 *   the same way regardless of which buffer they were actually measured in.
 */
async function readMultiline(page, b, mm, f, spec) {
  const px = v => Math.round(v * mm)
  const region = crop(page, b.x, b.y, b.w, b.h)
  const inkedBox = f.lightText ? inkFromBright(region) : null
  let lines = inkedBox
    ? findTextLinesInImage(inkedBox, mm, f.lineGapMm ?? spec.lineGapMm ?? 0.7)
    : findTextLines(page, b, mm, f.lineGapMm ?? spec.lineGapMm ?? 0.7)
  if (lines.length > 1) {
    if (f.fromEnd) {
      const last = lines.length - 1
      const h0 = lines[last][1] - lines[last][0]
      const kept = [lines[last]]
      for (let i = last - 1; i >= 0; i--) {
        const gap = kept[kept.length - 1][0] - lines[i][1]
        const h = lines[i][1] - lines[i][0]
        if (gap > px(f.lineGapMaxMm ?? 3) || h > h0 * 1.8 || h < h0 * 0.4) break
        kept.unshift(lines[i])
      }
      lines = kept
    } else {
      const h0 = lines[0][1] - lines[0][0]
      const kept = [lines[0]]
      for (let i = 1; i < lines.length; i++) {
        const gap = lines[i][0] - kept[kept.length - 1][1]
        const h = lines[i][1] - lines[i][0]
        if (gap > px(f.lineGapMaxMm ?? 3) || h > h0 * 1.8 || h < h0 * 0.4) break
        kept.push(lines[i])
      }
      lines = kept
    }
  }
  if (!lines.length) return { value: '', bounds: null }
  const pad = px(1.2)
  // `blockOcr`: OCR the whole kept SPAN in one pass, in block mode, instead of one
  // `ocrLabel` (single-LINE mode) call per detected band. Two tightly-kerned lines
  // can sit close enough together that no row between them ever drops under the
  // ink floor — nothing to split the row-scan on — so what `findTextLines` hands
  // back is ONE band that is genuinely two lines of print. Single-line OCR on that
  // crop assumes it is looking at one line and mangles or drops the other; block
  // mode expects multiple lines and reads both, which is what this is for.
  let words
  if (f.blockOcr) {
    const t0 = lines[0][0], t1 = lines[lines.length - 1][1]
    const target1 = inkedBox
      ? crop(inkedBox, 0, Math.max(0, t0 - pad), inkedBox.width, t1 - t0 + pad * 2)
      : crop(page, b.x, Math.max(0, t0 - pad), b.w, t1 - t0 + pad * 2)
    const { text } = await ocr(target1, f.whitelist ? { whitelist: f.whitelist } : {})
    words = text.split('\n').map(s => trimBleed(s.trim())).filter(Boolean)
    if (f.repair === 'code') {
      // Block OCR can still emit Q/O/I look-alikes even when the normal title
      // whitelist excludes them. Re-read the same pixels with a code-safe
      // alphabet, then use that result only when it contains a plausible code;
      // this preserves ordinary words such as GOLD and PS FLAT BAR verbatim.
      const strict = await ocr(target1, { whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' })
      const strictWords = strict.text.split('\n').map(s => trimBleed(s.trim())).filter(Boolean)
      const repaired = strictWords.map(word => repairCode(word, { requireDigit: !f.looseCode }).value)
      if (repaired.some(word => /^[A-Z]{1,8}\d{1,6}[A-Z]?$/.test(word.replace(/\s+/g, '')))) {
        words = repaired
      }
    }
  } else {
    words = []
    for (const [t0, t1] of lines) {
      const target1 = inkedBox
        ? crop(inkedBox, 0, Math.max(0, t0 - pad), inkedBox.width, t1 - t0 + pad * 2)
        : crop(page, b.x, Math.max(0, t0 - pad), b.w, t1 - t0 + pad * 2)
      const word = f.repair === 'code'
        ? await readCodeLabel(target1, f)
        : trimBleed((await ocrLabel(target1, f.whitelist ? { whitelist: f.whitelist } : {})).text.trim())
      if (word) words.push(word)
    }
  }
  const value = words.join(' ')
  const toAbs = inkedBox ? (y => y + b.y) : (y => y)
  return { value, bounds: [toAbs(lines[0][0]), toAbs(lines[lines.length - 1][1])] }
}

/** Reads one page using a spec. */
export async function readWithSpec(page, spec) {
  const { width } = page
  const mm = width / 210
  const products = []
  const warnings = []
  const anchors = findAnchors(page, spec.anchor)

  if (!anchors.length) return { products, warnings: ['No products found with this layout.'] }

  const px = (v) => Math.round(v * mm)

  // Keep the measured photo rectangles alongside the data. The importer can
  // later match them to an embedded PDF image and use that original object;
  // the rendered crop remains the safe fallback when no native object matches.
  const rememberSourceBox = (product, key, box) => {
    if (!box || box.w <= 0 || box.h <= 0) return
    product.__sourceBoxes ??= {}
    product.__sourceBoxes[key] = { x: box.x, y: box.y, w: box.w, h: box.h }
  }

  /**
   * Places a field box against its anchor.
   *
   * A badge anchor is a fixed mark, so everything is measured from its top-left.
   * A BLOCK anchor is the product photo itself and varies in size, so a field can
   * ask to be measured from the block's bottom (`from: 'blockBottom'`) and to
   * inherit the block's width (`w: 0`) — which is what a caption under a photo
   * actually wants, whatever size that photo happens to be.
   *
   * `w: 0` means "out to the block's own right edge", not "the block's full width
   * glued on after whatever x already indented" — a title box that starts past the
   * badge (`x: 11`) with `w: 0` must still END at the block's right edge, not 11mm
   * beyond it. Measured the hard way: that overshoot read 11mm into the NEXT card's
   * badge and title, and "PW03" came back "PW0304" — the start of PW04's own badge
   * digits, glued onto the end of a perfectly good read.
   */
  const boxAt = (a, box, field) => {
    if(field?.absolute)return {x:px(box.x),y:px(box.y),w:px(box.w),h:px(box.h)}
    const fromBottom = field?.from === 'blockBottom' && a.block
    const originY = fromBottom ? a.y + a.h : a.y
    const w = (box.w === 0 && a.block) ? a.w - px(box.x) : px(box.w)
    const h = (box.h === 0 && a.block) ? a.h : px(box.h)
    return { x: a.x + px(box.x), y: originY + px(box.y), w, h }
  }

  // A layout can hold more than one KIND of product laid out differently — LED has
  // narrow grid cells and a full-width featured block. They are told apart by how
  // many anchors share the band: a grid row has several, a featured block has one.
  const kinds = spec.kinds ?? [{ id: 'default', fields: spec.fields }]
  const kindFor = a => kinds.find(k => {
    const w = k.when
    if (!w) return true
    if (w.minAnchorsInBand != null && a.bandCount < w.minAnchorsInBand) return false
    if (w.maxAnchorsInBand != null && a.bandCount > w.maxAnchorsInBand) return false
    return true
  }) ?? kinds[kinds.length - 1]

  // Reads ONE anchor against ONE kind, returning the product it built — possibly
  // carrying `__reject` if a required field did not pan out. Pulled out to a
  // function (rather than inlined in the loop below) so a page that mixes several
  // UNRELATED card shapes can try each kind in turn against the same anchor and
  // keep whichever one actually worked, instead of a single spec only ever being
  // able to describe one shape of product.
  const readKind = async (a, kind, anchorIndex) => {
    const product = { _spec: spec.id, _kind: kind.id,
      __sourceAnchor:{x:a.x/page.width,y:a.y/page.height},
      ...(kind.layoutPairGroup?{layoutPairGroup:kind.layoutPairGroup}:{}),
      ...(kind.layoutFullRow?{layoutFullRow:true}:{}),
      ...(kind.layoutRowGroup?{layoutRowGroup:kind.layoutRowGroup}:{}) }
    const attemptWarnings = []
    for (const f of kind.fields) {
      // A block anchor IS the product photo, so that field needs no box at all.
      if (f.type === 'blockPhoto') {
        const block = { x: a.x, y: a.y, w: a.w, h: a.h }
        rememberSourceBox(product, f.key, block)
        product[f.key] = dataUrl(crop(page, block.x, block.y, block.w, block.h))
        continue
      }

      // A `parts` field (two differently-styled runs of text side by side, each
      // with its OWN box) has no single box of its own — only its parts do, read
      // further down. Computing `b`/`region` here against a nonexistent `f.box`
      // would crash before that branch ever got a chance to run.
      // A fixed layout can have the same card shape with a different vertical
      // arrangement on one anchor (the Wainscoting M04/M05 page is the concrete
      // example). Let a spec provide a per-anchor box without making the reader
      // duplicate the whole product kind. The ordinary `box` remains the default.
      const fieldBox = Array.isArray(f.boxByAnchor)
        ? (f.boxByAnchor[anchorIndex] ?? f.box)
        : f.box
      const b = f.parts ? null : boxAt(a, fieldBox, f)
      const region = f.parts ? null : crop(page, b.x, b.y, b.w, b.h)

      if (f.type === 'text') {
        // A text box is a SEARCH REGION, not an exact crop.
        //
        // These pages were laid out by hand, so the gap between a product's anchor
        // and its text drifts — measured across one page: 8.3, 8.7, 11.1, 9.4 mm.
        // A fixed box clipped "END Profile" in half and OCR returned "EEE EES Ee".
        // So find the actual text lines inside the region and take the Nth one,
        // which is also how a person would describe it: name first, size second.
        let target = region
        // Absolute page-pixel [top, bottom] of whatever text this field actually
        // found — set below, whichever path is taken. A later `photo` field can
        // measure its own box from this instead of a fixed offset, which is what
        // lets the SAME card template place its photo correctly whether the title
        // above it takes one line ("PW01") or two ("GOLD" / "PW02").
        let bounds = null
        let value = null       // set directly by joinLines/parts; otherwise read below
        const preset = Array.isArray(f.valueByAnchor) ? f.valueByAnchor[anchorIndex] : f.value
        if (preset != null) {
          value = String(preset)
          bounds = [b.y, b.y + b.h]
        } else if (f.parts) {
          // A title that is TWO DIFFERENT COLOURS of text side by side — a light
          // badge code and, beside it, a dark descriptive word ("CSW" white,
          // "- Coner Solid Wainscoting" brown) — cannot be read as one box at one
          // threshold. Each part is read with its OWN polarity and box, then
          // joined into one name, so "CSW" does not collide with a second product
          // on the same page whose badge also prints "CSW".
          const vals = []
          let firstTop = null, lastBottom = null
          for (const part of f.parts) {
            const pb = boxAt(a, part.box, part)
            const r = await readMultiline(page, pb, mm, part, spec)
            if (r.value) vals.push(r.value)
            if (r.bounds) {
              firstTop = firstTop == null ? r.bounds[0] : Math.min(firstTop, r.bounds[0])
              lastBottom = lastBottom == null ? r.bounds[1] : Math.max(lastBottom, r.bounds[1])
            }
          }
          value = vals.join(f.partSep ?? ' ')
          if (firstTop != null) bounds = [firstTop, lastBottom]
          if (!value) {
            attemptWarnings.push(`${product.name || 'a product'}: no text found for "${f.key}".`)
            if (f.required) product.__reject = true
          }
        } else if (f.joinLines) {
          // The title is however many lines it actually is, not a fixed count —
          // "GOLD" stacked over "PW02" is one name, "GOLD PW02", not a box tall
          // enough for one line that clips the second to a sliver ("oo"). But the
          // box has to be tall enough to hold a two-line title, and on a one-line
          // card that same extra height reaches down into the photo beneath it —
          // a product edge or shadow is dark enough to register as a spurious
          // "line" of its own, by this same measure of "a band of dark pixels".
          const r = await readMultiline(page, b, mm, f, spec)
          if (!r.bounds) {
            attemptWarnings.push(`${product.name || 'a product'}: no text found for "${f.key}".`)
            product[f.key] = ''
            if (f.required) product.__reject = true
            continue
          }
          value = r.value
          bounds = r.bounds
        } else {
          if (f.line) {
            let lines = findTextLines(page, b, mm, f.lineGapMm ?? spec.lineGapMm ?? 0.7, f.lightText)
            // A search box tall enough for a two-line caption can also just catch
            // the bottom edge of the photo above it — a shadow or a glare, not
            // text, but still dense enough to pass as a geometric "line", and it
            // throws off plain positional indexing (line 1 became an empty band,
            // the REAL first line became "line 2"). `pickMatching` reads every
            // candidate band and keeps only the ones that actually look like what
            // this field expects, so the index counts real content, not position.
            if (f.pickMatching && f.matches && lines.length > 1) {
              const pad0 = px(1.2)
              const good = []
              for (const ln of lines) {
                const t = crop(page, b.x, Math.max(0, ln[0] - pad0), b.w, ln[1] - ln[0] + pad0 * 2)
                const { text: t2 } = await ocrLabel(t, f.whitelist ? { whitelist: f.whitelist } : {})
                if (f.matches.test(t2)) good.push(ln)
              }
              if (good.length) lines = good
            }
            const chosen = lines[f.line - 1]
            if (chosen) {
              const pad = px(1.2)
              target = crop(page, b.x, Math.max(0, chosen[0] - pad), b.w, chosen[1] - chosen[0] + pad * 2)
              bounds = chosen
            } else {
              attemptWarnings.push(`${product.name || 'a product'}: expected ${f.line} text lines for "${f.key}", found ${lines.length}.`)
              product[f.key] = ''
              if (f.required) product.__reject = true
              continue
            }
          }
          // Some panel-style cards print the title in light text on a mid-tone
          // background. Measured at only ~55 luminance apart, plain inversion just
          // swaps which side is dark without adding contrast — hard-threshold the
          // bright pixels into solid ink instead, the same move keepInk makes for
          // dark ink on line art, mirrored.
          if (f.lightText) target = inkFromBright(target)
          const text = f.repair === 'code'
            ? await readCodeLabel(target, f)
            : (await ocrLabel(target, f.whitelist ? { whitelist: f.whitelist } : {})).text
          value = trimBleed(text.replace(new RegExp(`^\\s*${f.stripPrefix ?? ''}\\s*[:;.]?\\s*`, 'i'), ''))
        }
        if (f.repair === 'size') value = repairSize(value).value
        if (f.repair === 'code') {
          // A `joinLines` title can be MORE than a bare code — "GOLD" stacked over
          // "PW02" reads back as "GOLD PW02", two words. repairCode compacts
          // whitespace to recognise the code shape, which would weld a two-word
          // title into one run ("GOLDPW02"); repairing only the LAST word keeps
          // the brand word untouched and still fixes the code sitting after it.
          const opts = { requireDigit: !f.looseCode }
          if (f.joinLines && value.includes(' ')) {
            const words2 = value.split(' ')
            words2[words2.length - 1] = snapCode(repairCode(words2[words2.length - 1], opts).value, f.codeCandidates)
            value = words2.join(' ')
          } else {
            value = snapCode(repairCode(value, opts).value, f.codeCandidates)
          }
        }
        if (f.repair === 'length') value = repairLength(value).value
        if (f.repair === 'lengthParen') value = repairLengthParen(value).value
        if (f.repair === 'firstMm') value = repairFirstMm(value).value
        // Names must stay verbatim, so vocabulary snapping is opt-in per field.
        if (f.vocab) value = snapTo(value, FINISHES).value || value
        product[f.key] = value
        if (bounds) { product.__bounds ??= {}; product.__bounds[f.key] = bounds }
        // A field can be REQUIRED to look like its real content, not merely present.
        // The block anchor finds every solidly-filled rectangle on the page, and on
        // a mixed page that includes things that are not products at all — a
        // lifestyle photo filling a leftover grid cell, a decorative demo strip with
        // its own stray caption. A genuine product card always carries this field
        // (its dimension line, say); one that does not is not a product, and the
        // whole anchor is dropped rather than imported as a blank entry to fix later.
        if (f.required && (!value || (f.matches && !f.matches.test(value)))) product.__reject = true
      } else if (f.type === 'photo') {
        if (f.preserveScene && f.key === 'photo') product.photoTreatmentMode = 'preserve-scene'
        // A card's title can be one line or two, and its total height can vary
        // ("hero" cards spanning extra columns are shorter overall) — a photo box
        // measured at a fixed offset from the top then either starts inside the
        // title's own text, or runs on into the caption below it, baking both into
        // what is supposed to be a clean product shot. `topField`/`bottomField`
        // pin the photo to whatever the NAME and CAPTION fields actually measured
        // on THIS card, found earlier in the same field list, instead of a
        // one-size offset. Falls back to the static box when neither is given.
        if (f.topField || f.bottomField) {
          const top = f.topField && product.__bounds?.[f.topField]
            ? product.__bounds[f.topField][1] + px(f.topMarginMm ?? 2) : b.y
          const bottom = f.bottomField && product.__bounds?.[f.bottomField]
            ? product.__bounds[f.bottomField][0] - px(f.bottomMarginMm ?? 2) : b.y + b.h
          const photoBox = { x: b.x, y: top, w: b.w, h: Math.max(1, bottom - top) }
          rememberSourceBox(product, f.key, photoBox)
          const dyn = crop(page, photoBox.x, photoBox.y, photoBox.w, photoBox.h)
          product[f.key] = f.source ? dataUrl(dyn) : dataUrl(cleanPhoto(dyn))
        } else {
          rememberSourceBox(product, f.key, b)
          product[f.key] = f.source ? dataUrl(region) : dataUrl(cleanPhoto(region))
        }
      } else if (f.type === 'lineart') {
        if(f.key==='drawing')product.drawingPreserved=true
        // Preserve every original dimension crop, including pale photographic
        // references. Ink thresholding erases white relief and faint measurements.
        product[f.key] = dataUrl(region)
        rememberSourceBox(product, f.key, b)
      } else if (f.type === 'finishes') {
        const parts = splitStrip(region, { minAreaFrac: 0.012 })
        product.__sourceBoxes ??= {}
        product.__sourceBoxes[f.key] = []

        // The label box is a SEARCH REGION, like a text box. Row heights vary
        // between pages (PVC page 3's rows are taller than page 2's), so a fixed
        // offset landed off the labels and OCR returned noise like "So/I/I/EE".
        // Snap to the last band of text inside the region instead.
        let lb = f.labelBox ? boxAt(a, f.labelBox, { from: f.labelFrom }) : null
        if (lb) {
          const bands = findTextLines(page, lb, mm, f.lineGapMm ?? spec.lineGapMm ?? 0.7)
          if (bands.length) {
            const [t, bt] = bands[bands.length - 1]
            const pad = px(1)
            lb = { x: lb.x, y: Math.max(0, t - pad), w: lb.w, h: bt - t + pad * 2 }
          }
        }
        const list = []
        let leftover = null

        // Touching diagonal bars merge into one blob. When labels are available and
        // outnumber the blobs, use the label centres to decide the boundaries.
        const labelRuns = lb ? labelColumns(page, lb.x, lb.x + lb.w, lb.y, lb.y + lb.h, mm) : []
        const useLabels = labelRuns.length >= 2 && labelRuns.length > parts.length

        if (useLabels) {
          const centres = labelRuns.map(([p0, p1]) => (p0 + p1) / 2)
          for (let k = 0; k < labelRuns.length; k++) {
            const left = k === 0 ? b.x : Math.round((centres[k - 1] + centres[k]) / 2)
            const right = k === labelRuns.length - 1 ? b.x + b.w : Math.round((centres[k] + centres[k + 1]) / 2)
            const { text } = await ocrLabel(crop(page, labelRuns[k][0] - px(2), lb.y,
              labelRuns[k][1] - labelRuns[k][0] + px(4), lb.h))
            list.push({
              name: snapTo(text, FINISHES).value || text,
              photo: dataUrl(cleanPhoto(crop(page, left, b.y, right - left, b.h))),
            })
            product.__sourceBoxes[f.key].push({ x: left, y: b.y, w: right - left, h: b.h })
          }
        } else {
          for (const part of parts) {
            let label = ''
            if (lb) {
              const { text } = await ocrLabel(crop(page, b.x + part.x0, lb.y, part.x1 - part.x0, lb.h))
              label = text
            }
            const snapped = snapTo(label, FINISHES)
            // A block with no readable label beneath it is a detail photo, not a
            // finish — that is how these templates distinguish the two.
            if (lb && !snapped.value) { leftover ??= dataUrl(cleanPhoto(part.img)); continue }
            list.push({ name: snapped.value || label, photo: dataUrl(cleanPhoto(part.img)) })
            product.__sourceBoxes[f.key].push({ x: b.x + part.x0, y: b.y, w: part.x1 - part.x0, h: b.h })
          }
        }
        product[f.key] = list
        if (leftover && f.leftoverKey) product[f.leftoverKey] = leftover
        if (!list.length) attemptWarnings.push(`${product.name || 'a product'}: no finishes found.`)

        // If most finish names are not real words, the label band was probably the
        // wrong one — a product carrying an exception note underneath, for example.
        // Say so rather than import nonsense.
        const junk = list.filter(v => !FINISHES.includes(v.name)).length
        if (list.length && junk > list.length / 2) {
          attemptWarnings.push(`${product.name || 'a product'}: its finish labels did not read ` +
            `(${list.map(v => v.name || '?').join(', ')}). Check this one — it may carry an ` +
            'exception note that confused the label search.')
        }
      }
    }
    if(kind.supportStripByAnchor?.[anchorIndex]) {
      const b=boxAt(a,kind.supportStripByAnchor[anchorIndex],{absolute:true})
      product.supportStrip=dataUrl(crop(page,b.x,b.y,b.w,b.h))
      if(kind.supportCaptionByAnchor?.[anchorIndex])product.supportCaption=kind.supportCaptionByAnchor[anchorIndex]
    }
    if(kind.examplesByAnchor){
      product.examples=(kind.examplesByAnchor[anchorIndex]||[]).map(e=>{
        const b=boxAt(a,e.box,{absolute:true})
        return {image:dataUrl(crop(page,b.x,b.y,b.w,b.h)),caption:e.caption||'',role:e.role||'usage',
          ...(e.displayWithProductCode?{displayWithProductCode:e.displayWithProductCode}:{}),
          ...(e.relatedProductCodes?{relatedProductCodes:e.relatedProductCodes}:{}),
          associationEvidence:'verified-source-layout',ownerName:product.name,
          sourceBox:{x:b.x/page.width,y:b.y/page.height,w:b.w/page.width,h:b.h/page.height}}
      })
      product.examplesTrusted=true
    }
    if (attemptWarnings.length) product.__warnings = attemptWarnings
    return product
  }

  // A layout whose kinds all declare `when` keeps today's behaviour exactly: ONE
  // kind per anchor, chosen by how many anchors share its band (LED's grid row vs.
  // its featured block). A layout whose kinds declare no `when` at all is a page
  // mixing shapes that cannot be told apart by position — try each kind in turn
  // and keep the first one whose required fields actually held up. An anchor that
  // satisfies none of them is not a product in any shape this spec knows, and is
  // dropped rather than imported as whichever kind rejected "least".
  const tryAllKinds = !kinds.some(k => k.when)

  for (const a of anchors) {
    const candidateKinds = tryAllKinds ? kinds : [kindFor(a)]
    let winner = null
    for (const kind of candidateKinds) {
      const attempt = await readKind(a, kind, anchors.indexOf(a))
      if (!attempt.__reject) { winner = attempt; break }
    }
    if (!winner) continue
    if (winner.__warnings?.length) warnings.push(...winner.__warnings)
    delete winner.__reject
    delete winner.__bounds
    delete winner.__warnings
    products.push(winner)
  }

  // Never auto-correct a measurement: report the disagreement instead.
  const allFields = (spec.kinds ?? [{ fields: spec.fields }]).flatMap(k => k.fields ?? [])
  const sizeField = allFields.find(f => f.repair === 'size')
  if (sizeField) {
    const seen = [...new Set(products.map(p => p[sizeField.key]).filter(Boolean))]
    if (seen.length > 1) {
      warnings.push(`Sizes did not read consistently: ${seen.join(', ')}. ` +
        'Those digits look alike at this resolution — check them before importing.')
    }
  }

  // Hand back where the products sat. The caller uses it to lift the page header —
  // everything above the first product — straight off the source page.
  return { products, warnings, anchors }
}

/** Column runs of near-black text inside a band — i.e. where labels sit. */
function labelColumns(page, x0, x1, y0, y1, mm) {
  const { width, data } = page
  const cols = []
  for (let x = x0; x < x1; x++) {
    let n = 0
    for (let y = y0; y < y1; y++) {
      const i = (y * width + x) * 4
      if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 120) n++
    }
    cols.push(n > 0)
  }
  const out = []
  let s = -1, last = -1
  cols.forEach((v, i) => {
    if (!v) return
    if (s < 0) s = i
    else if (i - last > mm * 4) { out.push([x0 + s, x0 + last + 1]); s = i }
    last = i
  })
  if (s >= 0) out.push([x0 + s, x0 + last + 1])
  return out.filter(([p0, p1]) => p1 - p0 > mm * 3)
}

/**
 * Rows of dark text inside a box, as bands.
 * Used to snap a text field onto the line it actually occupies, rather than
 * trusting a fixed offset on a hand-laid page.
 *
 * `light` flips the test for a panel card's title: it is WHITE text on a mid-tone
 * or dark photo background, so "dark pixels" would describe the background itself
 * (a big single band covering the whole panel), not the letters. Counting BRIGHT
 * pixels instead picks out the actual glyphs the same way `inkFromBright` does for
 * reading them.
 */
function findTextLines(page, b, mm, gapMm = 0.7, light = false) {
  const { width, data } = page
  const x0 = Math.max(0, b.x), x1 = Math.min(width, b.x + b.w)
  // Low on purpose. A short word in a wide box ("Silver" across 30mm) only puts a
  // handful of dark pixels on each row; a higher floor fragmented that band and the
  // colour line disappeared entirely. Specks are rejected by the height filter below.
  const minInk = Math.max(2, Math.round(mm * 0.4))
  const bands = []
  let s = -1, last = -1
  for (let y = b.y; y < b.y + b.h; y++) {
    let n = 0
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (light ? lum >= 225 : lum < 120) n++
    }
    if (n >= minInk) { if (s < 0) s = y; last = y }
    else if (s >= 0 && y - last > mm * gapMm) { bands.push([s, last + 1]); s = -1 }
  }
  if (s >= 0) bands.push([s, last + 1])
  // Drop specks; keep anything tall enough to be a line of type.
  return bands.filter(([a, c]) => c - a >= mm * 1.6)
}

/**
 * Same row-band scan as `findTextLines`, but over a STANDALONE already-binarised
 * image (local coordinates, y starts at 0) instead of the page. Used for light text
 * on a panel card: `inkFromBright` turns the whole search box into clean black ink
 * on white in one pass, and scanning THAT for dark bands finds real glyph lines
 * reliably — a per-pixel brightness test re-applied to the raw page instead
 * mis-fired on an uneven gradient background, which is not flat the way a plain
 * mid-tone panel is.
 */
function findTextLinesInImage(img, mm, gapMm = 0.7) {
  const { width, height, data } = img
  const minInk = Math.max(2, Math.round(mm * 0.4))
  const bands = []
  let s = -1, last = -1
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i] < 120) n++
    }
    if (n >= minInk) { if (s < 0) s = y; last = y }
    else if (s >= 0 && y - last > mm * gapMm) { bands.push([s, last + 1]); s = -1 }
  }
  if (s >= 0) bands.push([s, last + 1])
  return bands.filter(([a, c]) => c - a >= mm * 1.6)
}
