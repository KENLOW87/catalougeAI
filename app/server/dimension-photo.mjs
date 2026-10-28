import { PNG } from 'pngjs'
import { editProductImage } from './ai-image.mjs'

// A photographed white product with callouts is not black line art. Preserve
// its source pixels verbatim; AI only supplies a separate product cutout.
export async function prepareDimensionPhoto(source, edit = editProductImage) {
  const cutout = await edit(source,
    'Extract ONLY the photographed physical product from this dimension reference. Remove the paper/background, all arrows, dimension lines and dimension text. Preserve its exact shape, colour, relief, texture and finish. Return the entire product with a transparent background. Do not draw or invent any measurements. The application retains the original measurement reference separately.',
    { productOnly: true })
  return finishProductCutout(cutout)
}

export function finishProductCutout(cutout) {
  const png = PNG.sync.read(Buffer.from(cutout.split(',')[1], 'base64'))
  let solid = 0, bright = 0, transparent = 0
  let left = png.width, top = png.height, right = -1, bottom = -1
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4
    if (png.data[i + 3] < 16) { transparent++; continue }
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
    if (png.data[i + 3] >= 220) {
      solid++
      if (.2126 * png.data[i] + .7152 * png.data[i + 1] + .0722 * png.data[i + 2] >= 190) bright++
    }
  }
  if (!solid || transparent < png.width * png.height * .01) throw new Error('AI did not return an isolated product; original dimension reference retained.')
  const light = bright / solid >= .5
  const padding = Math.max(8, Math.round(Math.max(right - left + 1, bottom - top + 1) * .04))
  const out = new PNG({ width: right - left + 1 + padding * 2, height: bottom - top + 1 + padding * 2 })
  if (light) for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 48; out.data[i + 1] = 52; out.data[i + 2] = 59; out.data[i + 3] = 255
  }
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const i = (y * png.width + x) * 4
    const j = ((y - top + padding) * out.width + x - left + padding) * 4
    const a = png.data[i + 3] / 255
    if (light) {
      for (let c = 0; c < 3; c++) out.data[j + c] = Math.round(png.data[i + c] * a + out.data[j + c] * (1 - a))
    } else png.data.copy(out.data, j, i, i + 4)
  }
  return `data:image/png;base64,${PNG.sync.write(out).toString('base64')}`
}
