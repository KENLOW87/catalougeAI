// Splits a composite colour-variant strip into one image per variant.
//
// In the PVC Marble pages each product's finishes are stored as a SINGLE wide
// photo containing every colour side by side. The catalogue system needs them
// individually so an admin can add, remove, or replace one colour.
//
// Column splitting does NOT work here: the bars are long diagonals, so bar 1's
// bottom-left overlaps bar 2's columns and the whole strip reads as one run even
// with zero gap tolerance. Connected components separate them correctly - each bar
// is its own blob.

import { readImage, toBuffer, crop } from './imageops.mjs'

/**
 * Labels connected components of ink and returns each as its own image,
 * ordered left to right.
 * @returns array of { img, x0, x1, area }
 */
export function splitStrip(img, { white = 244, minAreaFrac = 0.01, pad = 4 } = {}) {
  const { width, height, data } = img
  const n = width * height

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
    let sp = 0, area = 0
    let minX = width, maxX = -1, minY = height, maxY = -1
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
    boxes.push({ id, area, minX, maxX, minY, maxY })
  }

  const minArea = minAreaFrac * n
  const kept = boxes.filter(b => b.area >= minArea).sort((a, b) => a.minX - b.minX)

  // Cut each blob out on a white ground: a diagonal bar's bounding box overlaps
  // its neighbour's, so copying the rectangle would drag the neighbour in.
  return kept.map(b => {
    const x0 = Math.max(0, b.minX - pad), x1 = Math.min(width, b.maxX + 1 + pad)
    const y0 = Math.max(0, b.minY - pad), y1 = Math.min(height, b.maxY + 1 + pad)
    const w = x1 - x0, h = y1 - y0
    const out = { width: w, height: h, data: Buffer.alloc(w * h * 4, 255) }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y + y0) * width + (x + x0)
        if (label[si] !== b.id) continue
        const s = si * 4, d = (y * w + x) * 4
        out.data[d] = data[s]; out.data[d + 1] = data[s + 1]
        out.data[d + 2] = data[s + 2]; out.data[d + 3] = 255
      }
    }
    return { img: out, x0, x1, area: b.area }
  })
}

export { readImage, toBuffer, crop }
