// Background removal for a photo the admin attaches in the chat — entirely in
// the browser. No server call, no API key, nothing sent anywhere: the same
// privacy rule the rest of the assistant already follows for text.
//
// Model: onnx-community/ormbg-ONNX, Apache-2.0. Picked over the more common
// @imgly/background-removal specifically because that one is AGPL-3.0, which
// would obligate open-sourcing this app (or buying a commercial license) —
// Apache-2.0 has no such catch, so it is safe inside a closed-source product.
//
// Pinned to the WASM device and the q8 (model_quantized.onnx) weights: 44 MB,
// confirmed against the model's actual file listing, rather than the 176 MB
// full-precision file WebGPU auto-selection could otherwise reach for.

import { pipeline } from '@huggingface/transformers'
import { prepareProductPhoto } from './product-photo.js'

const MODEL = 'onnx-community/ormbg-ONNX'

let loading = null
let ready = false

const load = () => {
  if (!loading) {
    loading = pipeline('background-removal', MODEL, { device: 'wasm', dtype: 'q8' })
      .then(seg => { ready = true; return seg })
      .catch(e => { loading = null; throw e })  // a failed load must be retried, not cached
  }
  return loading
}

/** True once the model has loaded — lets the UI say "loading…" only the first time. */
export const modelReady = () => ready

const readImage = dataUrl => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('The image could not be read'))
  image.src = dataUrl
})

/**
 * White/light product photos are already catalogue-ready. Running segmentation
 * on them can confuse a bright product surface with the background and remove
 * part of the product (SW01 is the known example). Sample only the border so a
 * dark or colourful product in the middle does not make the photo fail this test.
 */
const hasLightBackground = async dataUrl => {
  const image = await readImage(dataUrl)
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, size, size)
  const pixels = ctx.getImageData(0, 0, size, size).data
  const luminance = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x > 3 && x < size - 4 && y > 3 && y < size - 4) continue
      const i = (y * size + x) * 4
      luminance.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2])
    }
  }
  luminance.sort((a, b) => a - b)
  const median = luminance[luminance.length >> 1]
  const bright = luminance.filter(v => v >= 205).length / luminance.length
  // Pale grey/wood backgrounds are still safer to keep than to segment: the
  // model can mistake a white product's face for the background.
  return median >= 215 && bright >= 0.60
}

/**
 * Returns the processed image plus whether the original was intentionally kept.
 * Keeping this separate from removeBackground preserves the old data-URL API for
 * any callers outside the current UI.
 */
export async function processBackground(dataUrl, { force = false, jobId } = {}) {
  // All product colours require isolation, including white products on pale
  // backgrounds. Drawings must never be passed to this photo-only function.
  return prepareProductPhoto(dataUrl, { jobId })
}

export async function adjustPhoto(dataUrl, operation, angle = 90) {
  const image = await readImage(dataUrl)
  const canvas = document.createElement('canvas')
  const turn = operation === 'rotate' && angle % 180 !== 0
  canvas.width = turn ? image.height : image.width
  canvas.height = turn ? image.width : image.height
  const ctx = canvas.getContext('2d')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  if (operation === 'rotate') ctx.rotate(angle * Math.PI / 180)
  if (operation === 'flip') ctx.scale(-1, 1)
  ctx.filter = ({ brighten: 'brightness(1.15)', darken: 'brightness(0.85)', contrast: 'contrast(1.15)' })[operation] ?? 'none'
  ctx.drawImage(image, -image.width / 2, -image.height / 2)
  return canvas.toDataURL('image/png')
}

/**
 * @param dataUrl  a product photo as a data URL (same shape every photo field
 *                 already stores, per ProductDialog's FileReader.readAsDataURL)
 * @returns a transparent-background PNG, as a data URL
 */
export async function removeBackground(dataUrl) {
  const segment = await load()
  const cut = await segment(dataUrl)
  cut.rgba()  // putAlpha already leaves 4 channels; this is a no-op safety net

  // NOT cut.toCanvas() — in a browser, transformers.js backs that with an
  // OffscreenCanvas, which has no toDataURL(). A real <canvas> does.
  const canvas = document.createElement('canvas')
  canvas.width = cut.width
  canvas.height = cut.height
  canvas.getContext('2d').putImageData(new ImageData(cut.data, cut.width, cut.height), 0, 0)
  return canvas.toDataURL('image/png')
}
