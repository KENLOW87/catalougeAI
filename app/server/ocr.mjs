// Local OCR via tesseract.js (WASM — no system install, no API key).
//
// Reads characters out of pixels. It does NOT understand structure: that is the
// job of the per-template readers, which know where each field sits before they
// ever ask for text.

import { createWorker } from 'tesseract.js'
import { toBuffer } from './imageops.mjs'

let workerPromise = null

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, { logger: () => {}, errorHandler: () => {} })
  }
  return workerPromise
}

export async function shutdownOcr() {
  if (!workerPromise) return
  const w = await workerPromise
  await w.terminate()
  workerPromise = null
}

/**
 * @param img    an image object from imageops (or a Buffer/path)
 * @param opts.singleLine  treat the crop as one line — much more reliable for
 *                         short labels like "Silver" than page-segmentation mode
 * @param opts.whitelist   restrict the character set (e.g. digits + "mm")
 */
export async function ocr(img, { singleLine = false, whitelist = null } = {}) {
  const worker = await getWorker()
  const params = {}
  // 7 = single text line, 6 = uniform block of text.
  params.tessedit_pageseg_mode = singleLine ? '7' : '6'
  // ALWAYS set the whitelist, even when there isn't one. The worker is reused, so a
  // whitelist set for one field stays in force for the next — which silently
  // stripped the spaces out of every description after a code was read.
  params.tessedit_char_whitelist = whitelist ?? ''
  await worker.setParameters(params)

  const buf = Buffer.isBuffer(img) || typeof img === 'string' ? img : toBuffer(img)
  const { data } = await worker.recognize(buf)
  return {
    text: (data.text ?? '').trim(),
    confidence: data.confidence ?? 0,
    lines: (data.text ?? '').split('\n').map(s => s.trim()).filter(Boolean),
  }
}

/** Reads a crop expected to hold one short label. */
export async function ocrLabel(img, opts = {}) {
  const { text, confidence } = await ocr(img, { singleLine: true, ...opts })
  return { text: text.replace(/\s+/g, ' ').trim(), confidence }
}
