// Presentation-only crop: retain the saved original and every measurement pixel.
// Ignore isolated long separator slivers which came from an adjacent PDF panel.
export function drawingContentBounds(width, height, pixels) {
  const ink = new Uint8Array(width * height)
  for (let p = 0; p < ink.length; p++) {
    const i = p * 4
    ink[p] = pixels[i + 3] > 16 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 250 ? 1 : 0
  }
  const stack = new Int32Array(ink.length), ignored = []
  let left = width, top = height, right = -1, bottom = -1
  for (let start = 0; start < ink.length; start++) {
    if (ink[start] !== 1) continue
    let size = 0, count = 0, x0 = width, y0 = height, x1 = -1, y1 = -1
    stack[size++] = start; ink[start] = 2
    while (size) {
      const p = stack[--size], x = p % width, y = Math.floor(p / width)
      count++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const next = ny * width + nx
        if (ink[next] === 1) { ink[next] = 2; stack[size++] = next }
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, fill = count / (w * h)
    const separator = fill > .65 && (
      (w <= Math.max(3, width * .02) && h >= height * .6 && h / w >= 35) ||
      (h <= Math.max(3, height * .02) && w >= width * .6 && w / h >= 35))
    if (separator) { ignored.push({ x:x0, y:y0, w, h }); continue }
    left = Math.min(left, x0); top = Math.min(top, y0); right = Math.max(right, x1); bottom = Math.max(bottom, y1)
  }
  if (right < left) return null
  const pad = Math.max(2, Math.round(Math.max(right - left + 1, bottom - top + 1) * .02))
  const x = Math.max(0, left - pad), y = Math.max(0, top - pad)
  return { x, y, w:Math.min(width, right + pad + 1) - x, h:Math.min(height, bottom + pad + 1) - y, ignored }
}

export async function prepareDrawingDisplay(src) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Drawing could not be read'))
    img.src = src
  })
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently:true })
  ctx.drawImage(image, 0, 0)
  const b = drawingContentBounds(canvas.width, canvas.height, ctx.getImageData(0,0,canvas.width,canvas.height).data)
  if (!b) return src
  const output = document.createElement('canvas')
  output.width = b.w; output.height = b.h
  output.getContext('2d').drawImage(canvas, b.x,b.y,b.w,b.h,0,0,b.w,b.h)
  return output.toDataURL('image/png')
}
