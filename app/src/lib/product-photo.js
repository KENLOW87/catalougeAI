import { apiUrl } from './api.js'
import { activityHeaders } from './activity.js'

const readImage = src => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Gambar tidak dapat dibaca.'))
  image.src = src
})

// Measure only the opaque product, never the old background. Crop transparent
// margins so the product occupies its frame without stretching its proportions.
export async function finishProductPhoto(src) {
  const image = await readImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1
  let solid = 0, bright = 0, transparent = 0
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      if (data[i + 3] < 16) { transparent++; continue }
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
      if (data[i + 3] < 220) continue
      solid++
      if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] >= 190) bright++
    }
  }
  if (right < left || !solid) throw new Error('Hasil potongan kosong. Gambar asal dikekalkan.')
  if (transparent < canvas.width * canvas.height * 0.01) {
    throw new Error('AI belum menghasilkan latar telus. Gambar asal dikekalkan; cuba semula.')
  }
  const light = bright / solid >= 0.5
  const width = right - left + 1, height = bottom - top + 1
  const padding = Math.max(8, Math.round(Math.max(width, height) * 0.04))
  const output = document.createElement('canvas')
  output.width = width + padding * 2
  output.height = height + padding * 2
  const out = output.getContext('2d')
  if (light) {
    out.fillStyle = '#30343b'
    out.fillRect(0, 0, output.width, output.height)
  }
  out.drawImage(canvas, left, top, width, height, padding, padding, width, height)
  return { dataUrl: output.toDataURL('image/png'), light, skipped: false }
}

export async function prepareProductPhoto(image, { jobId } = {}) {
  const response = await fetch(apiUrl('/api/image/edit'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...activityHeaders(jobId) },
    body: JSON.stringify({ image, productOnly: true, instruction:
      'Isolate ONLY the physical catalogue product. Remove the entire original background, hands, people, supports, props, printed captions, dimension labels and unrelated objects outside the product. Preserve the full product and its original geometry, finish, colour, texture and actual markings. Output the product alone on a transparent background. Do not add a shadow or dark background; the application handles contrast after extraction.' }),
    signal: AbortSignal.timeout(250_000),
  })
  const data = await response.json()
  if (!response.ok || data.error) throw new Error(data.error || 'Tidak dapat mengasingkan produk.')
  return finishProductPhoto(data.image)
}
