// Rule-based reader for the "Accessories ~ LED" template. No API key.
//
// The template tells us where everything is, so OCR is only ever asked to read a
// crop whose meaning we already know. That is the whole trick: geometry supplies
// the structure that OCR cannot.

import { crop, trimToContent, keepInk, toBuffer } from '../imageops.mjs'
import { splitStrip } from '../split-strip.mjs'
import { ocr, ocrLabel } from '../ocr.mjs'
import { snapTo, repairLength, trimBleed, FINISHES } from './vocab.mjs'

const dataUrl = img => `data:image/png;base64,${toBuffer(img).toString('base64')}`

/**
 * The most common colour in the crop — the panel's own ground.
 *
 * Sampling the BORDER does not work here: a cell crop is wider than the tinted
 * rectangle inside it, so the border is part white page and part tint and the
 * median can land on white. The tint then counts as content, no gutter is ever
 * found, and the drawing comes back empty — which is exactly what happened to
 * cells 1, 3 and 5 on the first run.
 */
function modalColour(img) {
  const { data } = img
  const hist = new Map()
  for (let p = 0; p < data.length; p += 4) {
    const key = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3)
    hist.set(key, (hist.get(key) ?? 0) + 1)
  }
  let best = 0, bestN = -1
  for (const [k, n] of hist) if (n > bestN) { bestN = n; best = k }
  return [((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4]
}

/** Finds the horizontal gutter separating the product photo from its drawing. */
function splitPanel(panel) {
  const { width, height, data } = panel
  const ground = modalColour(panel)
  // Both the page white and the panel's own tint count as background.
  const isBg = i =>
    (data[i] > 246 && data[i + 1] > 246 && data[i + 2] > 246) ||
    Math.hypot(data[i] - ground[0], data[i + 1] - ground[1], data[i + 2] - ground[2]) < 26

  const rowInk = []
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = 0; x < width; x++) if (!isBg((y * width + x) * 4)) n++
    rowInk.push(n)
  }

  const a = Math.round(height * 0.3), b = Math.round(height * 0.8)
  const quiet = Math.max(1, Math.round(width * 0.015))
  let bestStart = -1, bestLen = 0, curStart = -1
  for (let y = a; y < b; y++) {
    if (rowInk[y] <= quiet) {
      if (curStart < 0) curStart = y
      const len = y - curStart + 1
      if (len > bestLen) { bestLen = len; bestStart = curStart }
    } else curStart = -1
  }
  if (bestLen < 3) return { photo: panel, drawing: null }
  const cut = bestStart + Math.floor(bestLen / 2)
  return {
    photo: crop(panel, 0, 0, width, cut),
    drawing: crop(panel, 0, cut, width, height - cut),
  }
}

/** Column runs of near-black text inside a band — i.e. where the labels are. */
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
  const runs = []
  let s = -1, last = -1
  cols.forEach((v, i) => {
    if (!v) return
    if (s < 0) s = i
    else if (i - last > mm * 4) { runs.push([x0 + s, x0 + last + 1]); s = i }
    last = i
  })
  if (s >= 0) runs.push([x0 + s, x0 + last + 1])
  return runs.filter(([a, b]) => b - a > mm * 3)
}

// Preserve the PDF's product-photo crop exactly. Background removal and blob
// trimming can delete bright product faces or make a large source image appear
// like a tiny sliver. The layout already supplies the photo bounds.
function cleanPhoto(img) { return img }

const cleanDrawing = img => trimToContent(keepInk(img, 185), { gap: 60, pad: 6 })

export async function readLedPage(page, detection) {
  const { width, height } = page
  const mm = width / 210
  const products = []
  const warnings = []

  const { cells, stripTop, stripBottom, featured = [] } = detection
  const textTop = stripBottom + Math.round(mm * 0.6)
  const textH = Math.round(mm * 11)
  const panelTop = stripTop + Math.round(mm * 17.1)
  const panelH = Math.min(Math.round(mm * 38), height - panelTop)

  // ---- Type A: the 6-across grid strip --------------------------------------
  for (let i = 0; i < cells.length; i++) {
    const x0 = cells[i][0] - Math.round(mm * 0.5)
    // Stop short of the next cell so a neighbour's text cannot bleed in — that
    // bleed produced readings like "Led -170 L". The last cell runs to the page
    // margin, which must be generous enough not to clip "Corner Led 601".
    const x1 = i + 1 < cells.length
      ? cells[i + 1][0] - Math.round(mm * 2.5)
      : width - Math.round(mm * 1.5)
    const w = x1 - x0

    const { lines } = await ocr(crop(page, x0, textTop, w, textH))
    const [name = '', colour = '', length = ''] = lines

    const panel = crop(page, x0, panelTop, w, panelH)
    const { photo, drawing } = splitPanel(panel)

    products.push({
      type: 'A',
      name: trimBleed(name),
      colour: trimBleed(colour),
      length: repairLength(length).value,
      photo: photo ? dataUrl(cleanPhoto(photo)) : null,
      drawing: drawing ? dataUrl(cleanDrawing(drawing)) : null,
    })
    if (!drawing) warnings.push(`${name || 'a product'}: could not separate the dimension drawing.`)
  }

  // ---- Type B: full-width featured blocks below the strip --------------------
  for (const band of featured) {
    const top = band.top
    const { lines } = await ocr(crop(page, Math.round(mm * 4), band.bottom,
      Math.round(mm * 42), Math.round(mm * 10)))
    const [name = '', colour = '', length = ''] = lines

    const panelY = top + Math.round(mm * 14.7)
    const panelHt = Math.min(Math.round(mm * 31.3), height - panelY)
    if (panelHt < mm * 8) { warnings.push(`${name || 'a featured product'}: its panel is cut off.`); continue }

    const stripX0 = Math.round(mm * 5), stripX1 = Math.round(mm * 145)
    const labelY0 = panelY + panelHt - Math.round(mm * 6)
    const labelY1 = panelY + panelHt

    // The finish bars are long diagonals that touch, so connected components see
    // one blob. The LABELS underneath are separate and evenly spaced, so use them
    // to decide where one finish ends and the next begins.
    const labels = labelColumns(page, stripX0, stripX1, labelY0, labelY1, mm)
    const finishes = []

    if (labels.length >= 2) {
      const centres = labels.map(([a, b]) => (a + b) / 2)
      for (let k = 0; k < labels.length; k++) {
        const left = k === 0 ? stripX0 : Math.round((centres[k - 1] + centres[k]) / 2)
        const right = k === labels.length - 1 ? stripX1 : Math.round((centres[k] + centres[k + 1]) / 2)
        const photo = crop(page, left, panelY, right - left, panelHt - Math.round(mm * 6))
        const { text } = await ocrLabel(crop(page, labels[k][0] - Math.round(mm * 2), labelY0,
          labels[k][1] - labels[k][0] + Math.round(mm * 4), labelY1 - labelY0))
        const snapped = snapTo(text, FINISHES)
        finishes.push({ name: snapped.value || text, badge: '', photo: dataUrl(cleanPhoto(photo)) })
      }
    } else {
      for (const part of splitStrip(crop(page, stripX0, panelY, stripX1 - stripX0, panelHt),
        { minAreaFrac: 0.012 })) {
        finishes.push({ name: '', badge: '', photo: dataUrl(cleanPhoto(part.img)) })
      }
      warnings.push(`${name || 'a featured product'}: finish labels not found; names left blank.`)
    }

    products.push({
      type: 'B',
      name: trimBleed(name),
      colour: trimBleed(colour),
      length: repairLength(length).value,
      photo: null,
      drawing: dataUrl(cleanDrawing(crop(page, Math.round(mm * 148), panelY, Math.round(mm * 55), panelHt))),
      finishes,
    })
    if (!finishes.length) warnings.push(`${name || 'a featured product'}: no finishes found.`)
  }

  return { products, warnings }
}
