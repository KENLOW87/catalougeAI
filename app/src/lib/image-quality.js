// Independent, local validation for a proposed transparent product cutout.
// This does not try to decide what the product is. It only checks measurable
// failure signatures before an automatic background-removal result is accepted.

import { loadImageForCanvas } from './load-image.js'

const loadImage = loadImageForCanvas

const pixelsOf = (image, maxSide = 192) => {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.clearRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  return { width, height, data: context.getImageData(0, 0, width, height).data }
}

const componentStats = (mask, width, height) => {
  const seen = new Uint8Array(mask.length)
  let count = 0
  let largest = 0
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    count++
    let size = 0
    const queue = [start]
    seen[start] = 1
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const at = queue[cursor]
      size++
      const x = at % width
      const y = Math.floor(at / width)
      const neighbours = [x > 0 ? at - 1 : -1, x + 1 < width ? at + 1 : -1,
        y > 0 ? at - width : -1, y + 1 < height ? at + width : -1]
      for (const next of neighbours) if (next >= 0 && mask[next] && !seen[next]) {
        seen[next] = 1
        queue.push(next)
      }
    }
    largest = Math.max(largest, size)
  }
  return { count, largest }
}

export async function assessBackgroundRemoval(originalSource, cutoutSource) {
  const [originalImage, cutoutImage] = await Promise.all([loadImage(originalSource), loadImage(cutoutSource)])
  const original = pixelsOf(originalImage)
  const cutout = pixelsOf(cutoutImage)
  const total = cutout.width * cutout.height
  const mask = new Uint8Array(total)
  let foreground = 0
  let opaque = 0
  let semi = 0
  let edge = 0
  let minX = cutout.width
  let minY = cutout.height
  let maxX = -1
  let maxY = -1
  let light = 0
  let chroma = 0
  for (let n = 0; n < total; n++) {
    const i = n * 4
    const alpha = cutout.data[i + 3]
    if (alpha < 24) continue
    foreground++
    if (alpha >= 192) opaque++
    else semi++
    const x = n % cutout.width
    const y = Math.floor(n / cutout.width)
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    if (x === 0 || y === 0 || x === cutout.width - 1 || y === cutout.height - 1) edge++
    const r = cutout.data[i], g = cutout.data[i + 1], b = cutout.data[i + 2]
    if (0.299 * r + 0.587 * g + 0.114 * b >= 190) light++
    chroma += Math.max(r, g, b) - Math.min(r, g, b)
    if (alpha >= 64) mask[n] = 1
  }

  let sourceBorderLight = 0
  let sourceBorderCount = 0
  for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) {
    if (x > 2 && x < original.width - 3 && y > 2 && y < original.height - 3) continue
    const i = (y * original.width + x) * 4
    if (0.299 * original.data[i] + 0.587 * original.data[i + 1] + 0.114 * original.data[i + 2] >= 215) sourceBorderLight++
    sourceBorderCount++
  }

  const components = componentStats(mask, cutout.width, cutout.height)
  const foregroundRatio = foreground / total
  const bboxRatio = foreground ? ((maxX - minX + 1) * (maxY - minY + 1)) / total : 0
  const semiRatio = foreground ? semi / foreground : 0
  const dominantRatio = foreground ? components.largest / foreground : 0
  const edgeRatio = foreground ? edge / foreground : 0
  const lightRatio = foreground ? light / foreground : 0
  const averageChroma = foreground ? chroma / foreground : 0
  const findings = []
  const add = (severity, code, message) => findings.push({ severity, code, message })

  if (!foreground || foregroundRatio < 0.0005) {
    add('error', 'empty-cutout', 'Hasil buang latar hampir kosong; gambar asal dikekalkan.')
  } else {
    if (foregroundRatio < 0.008 && sourceBorderLight / Math.max(1, sourceBorderCount) > 0.55) {
      add('warn', 'low-retention', 'Sangat sedikit piksel produk kekal pada sumber cerah; semak produk putih tidak terpadam.')
    }
    if (components.count > 8 && dominantRatio < 0.68) {
      add('warn', 'fragmented-cutout', 'Hasil kelihatan berpecah kepada terlalu banyak bahagian kecil.')
    }
    if (semiRatio > 0.58) add('warn', 'weak-alpha', 'Kebanyakan produk separa lutsinar; tepi mungkin rosak.')
    if (edgeRatio > 0.018) add('warn', 'edge-contact', 'Produk menyentuh sempadan crop; bahagian hujung mungkin terpotong.')
  }
  if (originalImage.width < 180 || originalImage.height < 120) {
    add('info', 'low-resolution', `Resolusi sumber rendah (${originalImage.width}×${originalImage.height}px).`)
  }

  const needsReview = findings.some(f => f.severity === 'error' || f.severity === 'warn')
  const rejected = findings.some(f => f.severity === 'error')
  const displayBackground = lightRatio > 0.62 && averageChroma < 38 ? 'dark-neutral' : 'transparent'
  return {
    accepted: !rejected,
    needsReview,
    displayBackground,
    findings,
    metrics: {
      sourceWidth: originalImage.width, sourceHeight: originalImage.height,
      foregroundRatio: +foregroundRatio.toFixed(4), bboxRatio: +bboxRatio.toFixed(4),
      componentCount: components.count, dominantRatio: +dominantRatio.toFixed(4),
      semiTransparentRatio: +semiRatio.toFixed(4), edgeRatio: +edgeRatio.toFixed(4),
      lightForegroundRatio: +lightRatio.toFixed(4),
    },
  }
}
