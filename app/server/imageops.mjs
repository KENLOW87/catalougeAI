// Image operations shared by the one-off asset scripts and the PDF ingest pipeline.
//
// The catalogue's alternating tint is POSITIONAL, so an asset must never carry a
// baked-in background: a product that moves from a tinted slot to a white one would
// drag a coloured rectangle with it. Everything here works toward assets on a pure
// white ground, which then composite onto any slot via mix-blend-mode:multiply.

import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { readFileSync } from 'node:fs'

export const readImage = src => {
  const raw = Buffer.isBuffer(src) ? src : readFileSync(src)
  // PNG magic number; anything else we treat as JPEG.
  const isPng = raw[0] === 0x89 && raw[1] === 0x50
  return isPng ? PNG.sync.read(raw) : jpeg.decode(raw, { useTArray: true })
}

export const toBuffer = img => {
  const png = new PNG({ width: img.width, height: img.height })
  png.data.set(img.data)
  return PNG.sync.write(png)
}

// A whole catalogue page kept as a picture is a photograph, not line art, and PNG is
// the wrong format for it — a single A4 page runs to several megabytes and a
// catalogue carries a handful of them. JPEG holds the same page in a few hundred KB.
export const toJpeg = (img, quality = 82) =>
  jpeg.encode({ data: img.data, width: img.width, height: img.height }, quality).data

/**
 * Light text printed on a MID-TONE panel (not a dark one) is a different, worse
 * problem than invert() fixes: measured on a real cell, the panel sits around
 * luminance 195 and the text around 250 — only ~55 apart, so a plain invert just
 * swaps which side is dark without adding contrast tesseract can use. This
 * hard-thresholds anything bright enough to be the text into solid black ink on
 * white, the same binarize-for-OCR move `keepInk` makes for dark ink, mirrored.
 */
export function inkFromBright(img, cut = 225) {
  const { width, height, data } = img
  const out = blank(width, height)
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    const ink = lum >= cut
    out.data[i] = out.data[i + 1] = out.data[i + 2] = ink ? 0 : 255
  }
  return out
}

const blank = (width, height) => ({ width, height, data: Buffer.alloc(width * height * 4, 255) })

export function crop(img, x0, y0, w, h) {
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0))
  w = Math.min(Math.round(w), img.width - x0); h = Math.min(Math.round(h), img.height - y0)
  if (w <= 0 || h <= 0) return blank(1, 1)
  const out = blank(w, h)
  for (let y = 0; y < h; y++) {
    const src = ((y + y0) * img.width + x0) * 4
    img.data.copy
      ? Buffer.from(img.data.buffer ?? img.data).copy(out.data, y * w * 4, src, src + w * 4)
      : out.data.set(img.data.slice(src, src + w * 4), y * w * 4)
  }
  return out
}

/** Flattens a flat, uniform background to pure white. Refuses when it isn't flat. */
export function whitenBackground(img, { tol = 30, agreement = 0.6, forced = null } = {}) {
  const { width, height, data } = img
  const px = (x, y) => { const i = (y * width + x) * 4; return [data[i], data[i + 1], data[i + 2]] }

  // Sample the entire border, not just corners: a neighbouring product bleeding
  // into one corner must not be mistaken for the background.
  const border = []
  for (let x = 0; x < width; x += 2) border.push(px(x, 0), px(x, height - 1))
  for (let y = 0; y < height; y += 2) border.push(px(0, y), px(width - 1, y))

  const median = c => { const v = border.map(p => p[c]).sort((a, b) => a - b); return v[v.length >> 1] }
  const bg = forced ?? [median(0), median(1), median(2)]
  const dist = (r, g, b) => Math.hypot(r - bg[0], g - bg[1], b - bg[2])
  const agree = border.filter(p => dist(...p) < tol).length / border.length
  const lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]
  const brightBorder = border.filter(([r, g, b]) =>
    0.299 * r + 0.587 * g + 0.114 * b >= 205).length / border.length
  // A light border is already a safe catalogue background. Callers should keep
  // the original crop in this case: whitening it and then selecting a single
  // connected blob can erase white product facets (SW01 is the known example).
  // Do not require a flat colour here. Catalogue photos often use a light
  // marble/wood background with gentle texture; colour agreement is low even
  // though the background is bright enough that segmentation would damage a
  // white product. The border brightness is the safer signal for this decision.
  // Prefer preserving a bright catalogue photo over an aggressive cutout. A
  // white product on a pale grey/wood background is still readable in the
  // original crop, while segmentation can erase its edges and highlights.
  const light = lum >= 205 && brightBorder >= 0.60
  if (!forced && agree <= agreement) return { img, changed: false, bg, agree, light }

  const out = blank(width, height)
  for (let i = 0; i < data.length; i += 4) {
    const isBg = dist(data[i], data[i + 1], data[i + 2]) < tol
    out.data[i] = isBg ? 255 : data[i]
    out.data[i + 1] = isBg ? 255 : data[i + 1]
    out.data[i + 2] = isBg ? 255 : data[i + 2]
  }
  return { img: out, changed: true, bg, agree, light }
}

/**
 * Keeps only the ink in line art. Dimension drawings sit on a subtly graded tint,
 * so matching a background colour fails; thresholding on luminance does not.
 * The cut must sit BELOW the tint's luminance (the tint is around 200).
 */
export function keepInk(img, cut = 185) {
  const { width, height, data } = img
  const out = blank(width, height)
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    const keep = lum < cut
    out.data[i] = keep ? data[i] : 255
    out.data[i + 1] = keep ? data[i + 1] : 255
    out.data[i + 2] = keep ? data[i + 2] : 255
  }
  return out
}

const inkMask = (img, white) => {
  const { width, height, data } = img
  const m = new Uint8Array(width * height)
  for (let i = 0, p = 0; p < data.length; i++, p += 4) {
    m[i] = (data[p] < white || data[p + 1] < white || data[p + 2] < white) ? 1 : 0
  }
  return m
}

/**
 * Crops to the subject's own content.
 *
 * A crop lifted off a page picks up fragments of the NEIGHBOURING cell. Those are
 * separated from the real subject by clean white, so take the largest run of
 * ink-bearing columns (tolerating small internal gaps, since a product may
 * legitimately have a gap in the middle), then the same for rows.
 */
export function trimToContent(img, { gap = 45, pad = 5, white = 247 } = {}) {
  const { width, height } = img
  const mask = inkMask(img, white)

  const bestRun = profile => {
    const runs = []
    let s = -1, lastTrue = -1
    profile.forEach((v, i) => {
      if (!v) return
      if (s < 0) s = i
      else if (i - lastTrue > gap) { runs.push([s, lastTrue + 1]); s = i }
      lastTrue = i
    })
    if (s >= 0) runs.push([s, lastTrue + 1])
    if (!runs.length) return [0, profile.length]
    const mass = r => profile.slice(r[0], r[1]).filter(Boolean).length
    return runs.reduce((a, b) => (mass(b) > mass(a) ? b : a))
  }

  const cols = []
  for (let x = 0; x < width; x++) {
    let n = 0
    for (let y = 0; y < height; y++) if (mask[y * width + x]) n++
    cols.push(n > 1)
  }
  const [cx0, cx1] = bestRun(cols)

  const rows = []
  for (let y = 0; y < height; y++) {
    let n = 0
    for (let x = cx0; x < cx1; x++) if (mask[y * width + x]) n++
    rows.push(n > 1)
  }
  const [ry0, ry1] = bestRun(rows)

  const x0 = Math.max(0, cx0 - pad), y0 = Math.max(0, ry0 - pad)
  return crop(img, x0, y0, Math.min(width, cx1 + pad) - x0, Math.min(height, ry1 + pad) - y0)
}

/**
 * Binary dilation by a (2r+1)x(2r+1) square, as two O(n) sliding-window passes
 * (horizontal then vertical) so the cost does not grow with the radius -- a brute
 * force per-pixel disc stamp is O(n * r^2), which is unusable at r>10 on a
 * 1500x1000 crop.
 */
function dilateMask(mask, width, height, r) {
  if (r <= 0) return mask
  const tmp = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    let count = 0
    for (let x = 0; x <= r && x < width; x++) count += mask[row + x]
    for (let x = 0; x < width; x++) {
      tmp[row + x] = count > 0 ? 1 : 0
      const out = x - r, add = x + r + 1
      if (out >= 0) count -= mask[row + out]
      if (add < width) count += mask[row + add]
    }
  }
  const out = new Uint8Array(width * height)
  for (let x = 0; x < width; x++) {
    let count = 0
    for (let y = 0; y <= r && y < height; y++) count += tmp[y * width + x]
    for (let y = 0; y < height; y++) {
      out[y * width + x] = count > 0 ? 1 : 0
      const outIdx = y - r, addIdx = y + r + 1
      if (outIdx >= 0) count -= tmp[outIdx * width + x]
      if (addIdx < height) count += tmp[addIdx * width + x]
    }
  }
  return out
}

/**
 * Keeps the largest connected blob of ink and whitens the rest.
 * Product strips run diagonally, so a sliver of a neighbour can share COLUMNS with
 * the real subject -- run-based trimming cannot separate those, but components can.
 *
 * Connectivity is judged on a CLOSED copy of the ink mask (dilate by `closeRadius`,
 * label, then read those labels back onto the real ink pixels) rather than on the
 * raw mask directly. A product that is itself near-white has broad facets that
 * `whitenBackground` flattens right along with the real backdrop (see the trap
 * documented on `whitenBackground`), which can cut the product into several
 * disconnected pieces -- a highlight running clean across it, say. Plain strict
 * 8-connectivity then keeps only one surviving piece and discards the rest, which
 * is how a whole product came back eaten to a sliver. Closing first treats pieces
 * that are only a few pixels apart as one object, the way the gap already does for
 * `trimToContent`.
 *
 * `closeRadius` has to stay well under the narrowest real gutter between two
 * different grid cells -- measured at ~31-37px at 400 DPI on a 4-column panel-card
 * page -- or it starts bridging to a genuinely different neighbour (confirmed: at
 * closeRadius=6 a faint bleed band from the row above got pulled into a product
 * that was already cutting correctly). 5px comfortably closes the gaps a
 * whitened-out highlight leaves inside ONE product (measured up to ~29px as actual
 * holes, but each is bridged from both sides so only ~half that reach is needed)
 * while staying far short of the real gutter.
 *
 * Components are ranked by how many REAL ink pixels they hold, not by the dilated
 * pixel count -- a label must win by how much actual product it holds, not by how
 * far its dilation halo happened to spread into blank background.
 */
export function keepLargestBlob(img, { white = 244, closeRadius = 5 } = {}) {
  const { width, height, data } = img
  const n = width * height
  const ink = inkMask(img, white)
  const closed = closeRadius > 0 ? dilateMask(ink, width, height, closeRadius) : ink
  const label = new Int32Array(n).fill(-1)
  const stack = new Int32Array(n)
  const sizes = []

  for (let start = 0; start < n; start++) {
    if (!closed[start] || label[start] >= 0) continue
    const id = sizes.length
    let sp = 0, count = 0
    stack[sp++] = start
    label[start] = id
    while (sp > 0) {
      const cur = stack[--sp]
      if (ink[cur]) count++
      const cx = cur % width, cy = (cur / width) | 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = cx + dx, ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (closed[ni] && label[ni] < 0) { label[ni] = id; stack[sp++] = ni }
        }
      }
    }
    sizes.push(count)
  }
  if (!sizes.length) return img

  const best = sizes.indexOf(Math.max(...sizes))
  const out = blank(width, height)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const keep = ink[i] && label[i] === best
    out.data[p] = keep ? data[p] : 255
    out.data[p + 1] = keep ? data[p + 1] : 255
    out.data[p + 2] = keep ? data[p + 2] : 255
  }
  return out
}

export { snapBox } from './snapbox.mjs'
