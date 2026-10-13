// Rule-based reader for the "PVC Marble / Edge Display" template. No API key.
//
// One product per full-width row. The left column carries the text and the gold
// dimension drawing; the right carries the colour finishes with their labels
// beneath, and sometimes an installed detail photo at the far right.

import { crop, trimToContent, keepInk, keepLargestBlob, whitenBackground, toBuffer } from '../imageops.mjs'
import { splitStrip } from '../split-strip.mjs'
import { ocr, ocrLabel } from '../ocr.mjs'
import { snapTo, repairSize, trimBleed, FINISHES } from './vocab.mjs'

const dataUrl = img => `data:image/png;base64,${toBuffer(img).toString('base64')}`

const cleanPhoto = img => {
  const { img: white } = whitenBackground(img, { tol: 30, agreement: 0.5 })
  return trimToContent(keepLargestBlob(white), { gap: 45, pad: 4 })
}
// PVC drawings are GOLD line art (luminance ~160), so the cut sits higher than
// the 185 used for the LED template's black drawings.
const cleanDrawing = img => trimToContent(keepInk(img, 210), { gap: 70, pad: 8 })

/** Rows in [yFrom, yTo) carrying dark text, as merged runs. */
function textRuns(page, x0, x1, yFrom, yTo, minPx) {
  const { width, data } = page
  const runs = []
  let s = -1, last = -1
  for (let y = yFrom; y < yTo; y++) {
    let n = 0
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      // Labels are near-black text; product photos are mid-tone and colourful.
      if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 120) n++
    }
    if (n >= minPx) {
      if (s < 0) s = y
      last = y
    } else if (s >= 0 && y - last > 4) { runs.push([s, last + 1]); s = -1 }
  }
  if (s >= 0) runs.push([s, last + 1])
  return runs
}

/**
 * Locates the row of finish labels.
 *
 * Assuming a fixed offset below the photos put the crop in the wrong place and
 * OCR returned noise ("I/So/oo/EE"). The labels are a thin band of near-black
 * text, so find that band instead of guessing where it should be.
 */
function findLabelBand(page, x0, x1, yFrom, yTo, mm) {
  const runs = textRuns(page, x0, x1, yFrom, yTo, Math.max(3, Math.round(mm * 1.5)))
  const bands = runs.filter(([a, b]) => b - a >= mm * 1.6 && b - a <= mm * 7)
  if (!bands.length) return null
  // The labels are the last thin text band in the row.
  const [a, b] = bands[bands.length - 1]
  return [a - Math.round(mm * 1), b + Math.round(mm * 1)]
}

export async function readPvcPage(page, detection) {
  const { width, height } = page
  const mm = width / 210
  const products = []
  const warnings = []

  const rows = detection.rows
  const RIGHT_X0 = Math.round(mm * 58)
  const RIGHT_X1 = Math.round(mm * 205)

  for (let i = 0; i < rows.length; i++) {
    const top = rows[i][0]
    const nextTop = i + 1 < rows.length ? rows[i + 1][0] : Math.min(height, top + Math.round(mm * 58))
    const rowH = nextTop - top

    // ---- left column: name, size, series ------------------------------------
    const { lines } = await ocr(crop(page, Math.round(mm * 14), top + Math.round(mm * 6),
      Math.round(mm * 43), Math.round(mm * 19)))
    const [name = '', sizeRaw = '', series = ''] = lines

    // Re-read the size on its own line with a digit whitelist. In block mode the
    // feet/inches glyphs sit next to quote marks and get confused (9'5" read as
    // 9'6"); constrained single-line mode is markedly better on that one field.
    const { text: sizeTight } = await ocrLabel(
      crop(page, Math.round(mm * 14), top + Math.round(mm * 12.6), Math.round(mm * 30), Math.round(mm * 6)))

    // ---- gold dimension drawing ---------------------------------------------
    const drawTop = top + Math.round(mm * 27)
    const drawH = Math.min(Math.round(mm * 24), Math.max(0, nextTop - drawTop - Math.round(mm * 2)))
    const drawing = drawH > mm * 5
      ? cleanDrawing(crop(page, Math.round(mm * 4), drawTop, Math.round(mm * 54), drawH))
      : null

    // ---- colour finishes ----------------------------------------------------
    const labelBand = findLabelBand(page, RIGHT_X0, RIGHT_X1,
      top + Math.round(mm * 20), Math.min(height, nextTop), mm)

    const stripTop = top + Math.round(mm * 4)
    const stripBottom = labelBand ? labelBand[0] : top + Math.round(mm * 42)
    const stripH = Math.max(Math.round(mm * 8), stripBottom - stripTop)
    const strip = crop(page, RIGHT_X0, stripTop, RIGHT_X1 - RIGHT_X0, stripH)
    const parts = splitStrip(strip, { minAreaFrac: 0.015 })

    const variants = []
    let extra = null
    for (const part of parts) {
      let label = ''
      if (labelBand) {
        const { text } = await ocrLabel(
          crop(page, RIGHT_X0 + part.x0, labelBand[0], part.x1 - part.x0, labelBand[1] - labelBand[0]))
        label = text
      }
      const snapped = snapTo(label, FINISHES)
      // A block with no readable label beneath it is the installed detail photo,
      // not a colour finish. That is how the template itself distinguishes them.
      if (!snapped.value) {
        if (!extra) extra = dataUrl(cleanPhoto(part.img))
        continue
      }
      variants.push({ name: snapped.value, photo: dataUrl(cleanPhoto(part.img)) })
    }

    const stripPrefix = s => (s ?? '').replace(/^\s*si?ze?\s*[:;.]?\s*/i, '')
    const tight = repairSize(stripPrefix(sizeTight))
    const block = repairSize(stripPrefix(sizeRaw))
    const size = tight.repaired ? tight.value : block.value
    products.push({
      kind: 'pvc',
      name: trimBleed(name),
      size,
      series: /marble|pvc/i.test(series) ? 'PVC Marble' : trimBleed(series),
      drawing: drawing ? dataUrl(drawing) : null,
      variants,
      extra,
      exception: null,
    })

    if (!drawing) warnings.push(`${name || 'a product'}: no dimension drawing found.`)
    if (!variants.length) warnings.push(`${name || 'a product'}: no colour finishes found.`)
    if (!labelBand) warnings.push(`${name || 'a product'}: could not find its finish labels.`)
  }

  // `9'5"` and `9'6"` are near-identical glyphs at print resolution and OCR does
  // mix them. A size is a real measurement, so it is never silently "corrected" to
  // the majority — the disagreement is reported and the reviewer decides.
  const sizes = [...new Set(products.map(p => p.size).filter(Boolean))]
  if (sizes.length > 1) {
    const tally = sizes.map(s => `${s} (${products.filter(p => p.size === s).length})`).join(', ')
    warnings.push(`Sizes did not read consistently: ${tally}. ` +
      'Those digits look alike at this resolution — check them before importing.')
  }

  // An exception sub-row (a finish made only in another size, with its own drawing
  // and printed note) is rare and easy to get wrong. Flag it for the reviewer
  // rather than guess.
  const tall = rows.some((r, i) => i + 1 < rows.length && rows[i + 1][0] - r[0] > mm * 75)
  if (tall) {
    warnings.push('One row is unusually tall — it may carry an exception finish ' +
      '(its own drawing and note). Add that by hand after importing.')
  }

  return { products, warnings }
}
