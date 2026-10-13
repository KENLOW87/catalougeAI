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
