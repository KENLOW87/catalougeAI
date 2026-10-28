import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { editProductImage } from './ai-image.mjs'
import { finishProductCutout } from './dimension-photo.mjs'

const instruction = 'Isolate ONLY the actual catalogue product. Remove the original background, hands, people, props, supports, and captions or dimension labels outside the product. Preserve the full product, original shape, colour, finish, texture and actual markings. Return a transparent PNG. Do not add a background or shadow. Do not invent or redraw dimensions.'

// One final pass for ALL PDF readers/categories, after extraction/native-image
// selection. Only explicit photo fields are eligible; drawings/pages never enter.
export async function prepareImportPhotos(products, {
  onProgress = () => {}, shouldStop = () => false,
  edit = editProductImage, keyAvailable = Boolean(process.env.OPENAI_API_KEY),
} = {}) {
  const jobs = []
  let preserved = 0
  for (const product of products) {
    if (product.isPage) continue
    for (const key of ['photo', 'extra']) if (product[key]) {
      if (key === 'photo' && product.photoTreatmentMode === 'preserve-scene') {
        product.photo = product.photoOriginal || product.photo
        product.photoTreatment = 'original-scene-v1'
        preserved++
        onProgress(`Mengekalkan foto asal berbentuk segi empat: ${product.name || 'produk'}…`)
      } else jobs.push({ product, owner: product, key, label: key })
    }
    for (const key of ['finishes', 'variants']) for (const finish of product[key] ?? []) {
      if (finish.photo) jobs.push({ product, owner: finish, key: 'photo', label: `${key} ${finish.name ?? ''}` })
    }
    if (product.exception?.variant?.photo) jobs.push({ product, owner: product.exception.variant, key: 'photo', label: 'exception variant' })
  }
  if (!jobs.length) return { processed: 0, preserved, failed: 0, total: preserved, warnings: [] }
  if (!keyAvailable) throw new Error('OPENAI_API_KEY diperlukan untuk mengasingkan foto produk semasa upload PDF. Drawing asal akan dikekalkan.')
  const warnings = [], cache = new Map()
  let processed = 0, failed = 0
  for (const [index, job] of jobs.entries()) {
    if (shouldStop()) { const error = new Error('Import cancelled.'); error.name = 'IngestCancelled'; throw error }
    const { product, owner, key, label } = job
    onProgress(`Mengasingkan produk ${index + 1}/${jobs.length}: ${product.name || 'produk'} (${label})…`)
    const original = owner[key]
    try {
      let source = original
      if (source.startsWith('/assets/')) {
        const root = resolve('public/assets')
        const path = resolve('public', source.slice(1))
        if (!path.startsWith(root + sep)) throw new Error('Invalid local photo path')
        source = `data:image/png;base64,${(await readFile(path)).toString('base64')}`
      }
      const hash = createHash('sha256').update(source).digest('hex')
      let treated = cache.get(hash)
      if (!treated) {
        const controller = new AbortController()
        const timer = setInterval(() => { if (shouldStop()) controller.abort() }, 500)
        try {
          treated = finishProductCutout(await edit(source, instruction, { productOnly: true, signal: controller.signal }))
        } finally { clearInterval(timer) }
        cache.set(hash, treated)
      }
      if (shouldStop()) { const error = new Error('Import cancelled.'); error.name = 'IngestCancelled'; throw error }
      owner[`${key}Original`] = original
      owner[key] = treated
      owner[`${key}Treatment`] = 'product-only-v1'
      processed++
    } catch (e) {
      if (shouldStop()) { const error = new Error('Import cancelled.'); error.name = 'IngestCancelled'; throw error }
      if (e.name === 'IngestCancelled') throw e
      failed++
      const message = `${product.name || 'Produk'} (${label}): latar belum dibuang — ${e.message}. Gambar asal dikekalkan.`
      warnings.push(message)
      product.issues = [...(product.issues ?? []), message]
      product.photoTreatmentErrors = [...(product.photoTreatmentErrors ?? []), message]
    }
  }
  onProgress(`Foto siap: ${processed}/${jobs.length}; ${failed} perlu semakan. Drawing ukuran asal dikekalkan.`)
  return { processed, preserved, failed, total: jobs.length + preserved, warnings }
}
