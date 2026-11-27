// PDF -> products.
//
// Split of responsibilities, on purpose:
//   Claude reads the page   -> what the products ARE (names, colours, types, finishes)
//   Geometry fixes the boxes -> where their images actually SIT on the page
//
// Vision is good at reading a catalogue and bad at pixel-exact boxes. When I
// extracted this catalogue by hand, eyeballed cell boundaries sliced a "10mm"
// label in half; measuring the ink fixed it. So the model's boxes are treated as
// seeds and snapped onto the real content underneath.

import Anthropic from '@anthropic-ai/sdk'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, rename } from 'node:fs/promises'
import { tmpdir, cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readImage, toBuffer, toJpeg, crop, whitenBackground, keepInk, whiteToTransparent,
  trimToContent, keepLargestBlob, snapBox, flattenDarkBackground,
} from './imageops.mjs'
import { readWithRules, ruleReadIsUsable, describeReport } from './readers/index.mjs'
import { findAnchors } from './readers/spec.mjs'
import { BUILTIN_SPECS } from './readers/specs.mjs'
import { extractNativePdfImages, matchNativePdfImage } from './native-pdf-images.mjs'
import { readProductDimensions } from './read-dimensions.mjs'
import { findProductExamples, attachProductExamples, validSourceBox, coversPrimaryPhoto } from './product-examples.mjs'
import { validateImportedAssociations } from './image-association.mjs'
import {matchesRenderedPhoto} from './native-photo-evidence.mjs'
import { attachImportEvidence, sourceDocumentFor } from './import-evidence.mjs'
import { ocr, shutdownOcr } from './ocr.mjs'
import { suggestDestination, suggestedCatalogue } from '../src/lib/route.js'
import { popplerTool } from './poppler.mjs'

const execFileAsync = promisify(execFile)

// Known supplier PDFs are deterministic local imports. Keep their completed
// extraction on disk so the normal "upload again after fixing a crop" workflow
// does not rerender a complex Illustrator PDF every time. The version is part
// of the key: changing a source reader/crop rule automatically invalidates old
// results instead of reusing a stale extraction.
// Shared import-performance version for every deterministic catalogue reader.
// The cache must be invalidated globally when the common render path changes;
// it is not an Acoustic-only fix.
// Bump whenever the stored shape of a known-source result changes. The 3D
// reader now preserves each composed A/B/C source photo instead of reusing
// the old split-panel extraction.
const INGEST_CACHE_VERSION = 'local-read-v16-composed-3d-clean-measurement-crop'
const INGEST_CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../.cache/ingest')

// The PDF bytes are the identity of an import.  The supplier often uploads the
// same file again with a different WhatsApp/Downloads filename; including that
// display name here made a verified extraction needlessly run from zero again.
// Keep the destination and matched source reader in the key because those are
// the only inputs that change the returned catalogue data.
export const ingestCacheKey = (bytes, _filename, intoCategory, sourceProfile) => createHash('sha256')
  .update(INGEST_CACHE_VERSION)
  .update('\0')
  .update(sourceProfile ?? '')
  .update('\0')
  .update(intoCategory ?? '')
  .update('\0')
  .update(bytes)
  .digest('hex')

async function readIngestCache(key) {
  try {
    const raw = await readFile(join(INGEST_CACHE_DIR, `${key}.json`), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed?.products?.length ? parsed : null
  } catch { return null }
}

async function writeIngestCache(key, result) {
  try {
    await mkdir(INGEST_CACHE_DIR, { recursive: true })
    const target = join(INGEST_CACHE_DIR, `${key}.json`)
    const temporary = `${target}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(result), 'utf8')
    await rename(temporary, target)
  } catch (e) {
    // Caching is an optimization. A full successful import must never fail just
    // because the local cache directory is unavailable or locked.
    console.warn(`[ingest] cache write skipped: ${e.message}`)
  }
}

/**
 * Runs a poppler tool and, when it fails, reports WHAT IT SAID.
 *
 * `execFile` rejects with "Command failed: pdftoppm …" and the whole command line,
 * which tells the admin nothing. The reason is in stderr — "May not be a PDF file",
 * "Couldn't read xref table", "Permission Error" — and that is the one part worth
 * showing.
 */
async function run(cmd, args) {
  try {
    // On some Windows machines Defender/AppLocker rejects a direct child
    // process created by Node with EPERM, even though the same Poppler binary
    // runs normally from PowerShell.  Try the direct path first, then use the
    // Windows command shim as a narrowly-scoped fallback.  All arguments here
    // are generated by the importer (fixed temp paths and numeric flags), not
    // arbitrary shell text from the uploaded filename.
    return await execFileAsync(popplerTool(cmd), args, {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch (e) {
    if (process.platform === 'win32' && (e.code === 'EPERM' || e.errno === -4048)) {
      try {
        return await execFileAsync(popplerTool(cmd), args, {
          windowsHide: true,
          shell: true,
          maxBuffer: 4 * 1024 * 1024,
        })
      } catch (fallback) {
        e = fallback
      }
    }
    const said = String(e.stderr ?? '').split('\n').map(s => s.trim()).filter(Boolean)
    const why = said.length ? said.slice(0, 2).join(' ') : `${cmd} exited with code ${e.code ?? '?'}`
    const err = new Error(why)
    err.tool = cmd
    err.stderr = e.stderr
    err.code = e.code          // ENOENT means the tool is missing, not the file bad
    throw err
  }
}

/**
 * Catalogue AI's printed PDF is a presentation output, not an import source.
 * Its pages have already been repaginated, so feeding it back through the
 * source-layout readers can look superficially valid while losing products.
 * Detect it from embedded metadata before rendering or invoking any AI.
 */
export function isCatalogueAiExportMetadata(info = '') {
  const text = String(info)
  const title = text.match(/^Title:\s*(.+)$/mi)?.[1]?.trim() ?? ''
  const creator = text.match(/^Creator:\s*(.+)$/mi)?.[1]?.trim() ?? ''
  const producer = text.match(/^Producer:\s*(.+)$/mi)?.[1]?.trim() ?? ''
  return /^GEOMETRA\s*[—–-]?\s*Catalogue AI$/i.test(title) &&
    (/HeadlessChrome/i.test(creator) || /Skia\/PDF/i.test(producer))
}

export function sourceProfileForFilename(filename = '') {
  const value = String(filename)
  if (/carbon\s+crystal(?:\s+wall\s+panel)?/i.test(value)) return 'carbon-crystal-wall'
  if (/wainscoting/i.test(value)) return 'wainscoting'
  if (/pvc\s+foam\s+board/i.test(value)) return 'pvc-foam-board'
  if (/light\s+stone(?:\s+wall)?/i.test(value)) return 'light-stone-wall'
  // These supplier files are frequently renamed by WhatsApp/Downloads. Keep
  // both the plain and 3D PVC Marble names on the same measured sheet reader;
  // routing still uses the printed header/filename to choose the destination.
  if (/pvc\s+marble\s+sheet\s+3d/i.test(value) || /marble\s+sheet.*3d/i.test(value)) return 'pvc-marble-sheet-3d'
  if (/pvc\s+marble\s+sheet/i.test(value)) return 'pvc-marble-sheet-grid'
  if (/acoustic\s+panel.*(?:nov|2024)/i.test(value) || /acoustic\s+panel.*2024/i.test(value)) return 'acoustic-panel-2024'
  if (/acoustic\s+panel/i.test(value)) return 'acoustic-panel'
  if (/accessories\s*\(?(?:march|mac)\b/i.test(value)) return 'accessories-march'
  return null
}

// A card upload carries an explicit destination even when the supplier PDF has
// no text layer and was renamed by WhatsApp/Downloads. In that case the
// filename/content fingerprint cannot identify the reader, but the destination
// is still a safe, user-selected family hint. Keep this separate from
// sourceProfileForFilename so dashboard-neutral uploads continue to be routed by
// their own source evidence instead of whichever catalogue was open.
export function sourceProfileForCategory(category = '') {
  const id = String(category).trim().toLowerCase()
  // The dashboard normally sends the stable id, but older/live clients may
  // send the visible category title. Treat that as the same explicit hint so
  // a known 3D PDF cannot fall through to the generic 200 DPI/full-page path.
  const normalized = id.replace(/[&/]+/g, ' ').replace(/\s+/g, ' ')
  if (normalized === 'pvc marble sheet 3d') return 'pvc-marble-sheet-3d'
  return {
    'accessories': 'accessories-march',
    'pvc-marble-sheet': 'pvc-marble-sheet-grid',
    'pvc-marble-sheet-3d': 'pvc-marble-sheet-3d',
    'pvc-foam-board': 'pvc-foam-board',
    'acoustic-panel': 'acoustic-panel',
    'light-stone-wall': 'light-stone-wall',
    'carbon-crystal-wall': 'carbon-crystal-wall',
    'wainscoting-mirror': 'wainscoting',
  }[id] ?? null
}

// Resolve the deterministic reader before any PDF rendering. An explicit 3D
// source wins over a generic PVC destination because the two layouts have
// different geometry and the generic grid reader cannot recover the 3D cards.
export function sourceProfileForImport(intoCategory = '', filename = '') {
  const explicit3d = /pvc[\s-]+marble[\s-]+sheet[\s-]+3d/i.test(`${intoCategory} ${filename}`)
  return explicit3d
    ? 'pvc-marble-sheet-3d'
    : (sourceProfileForCategory(intoCategory) || sourceProfileForFilename(filename))
}

// A filename is only a hint.  Files copied from WhatsApp/Downloads are often
// renamed, but the supplier's first pages still contain a cheap, local text
// fingerprint.  Detect only the layouts we already have deterministic readers
// for; this must never turn an unknown PDF into a guessed source profile.
async function sourceProfileForPdf(pdfPath, filename = '') {
  const named = sourceProfileForFilename(filename)
  if (named) return named
  try {
    const { stdout } = await run('pdftotext', ['-f', '1', '-l', '3', '-layout', pdfPath, '-'])
    const text = String(stdout ?? '')
    if (/carbon\s+crystal\s+wall\s+panel/i.test(text)) return 'carbon-crystal-wall'
    if (/pvc\s+foam\s+board/i.test(text)) return 'pvc-foam-board'
    if (/light\s+stone\s+wall\s+panel/i.test(text)) return 'light-stone-wall'
    if (/pvc\s+marble\s+sheet\s+3d/i.test(text)) return 'pvc-marble-sheet-3d'
    if (/pvc\s+marble\s+sheet/i.test(text)) return 'pvc-marble-sheet-grid'
    if (/acoustic\s+panel/i.test(text)) return 'acoustic-panel'
  } catch {
    // Text extraction is only a fast recognition hint. Rendering remains the
    // source of truth when a PDF has no text layer.
  }
  return null
}

export function isKnownLocalCatalogueFilename(filename = '') {
  return Boolean(sourceProfileForFilename(filename))
}

async function rejectCatalogueAiExport(pdfPath) {
  let info = ''
  try {
    info = (await run('pdfinfo', [pdfPath])).stdout
  } catch {
    // Keep imports working on installations where pdftoppm exists but pdfinfo
    // does not. This guard is an extra safety check, not a new dependency.
    return
  }
  if (!isCatalogueAiExportMetadata(info)) return
  throw new Error(
    'This PDF was exported by Catalogue AI, so it cannot be used as a source PDF. ' +
    'Uploading it again would lose products because its pages have already been rearranged. ' +
    'Choose the original supplier PDF instead; no AI credit was used for this file.')
}

const VISION_DPI = 150     // what Claude looks at - keeps the image within sane token cost
// 200 DPI gives an A4 source render roughly 1650px wide, enough for the
// measured product crops and dimension drawings. 300/400 DPI multiplied the
// pixels without improving the source boxes, and made known uploads render
// heavily on the small live server.
const ASSET_DPI = 200
const MAX_PAGES = 12
// pdftoppm is single-threaded per page; rendering pages one at a time left every
// core but one idle for the whole import. Capped below the full core count so the
// machine stays usable for everything else while an import is running.
const PAGE_RENDER_CONCURRENCY = Math.max(1, Math.min(4, cpus().length - 1))

const BOX = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'w', 'h'],
  properties: {
    x: { type: 'number', description: 'left edge, 0-1 of page width' },
    y: { type: 'number', description: 'top edge, 0-1 of page height' },
    w: { type: 'number', description: 'width, 0-1 of page width' },
    h: { type: 'number', description: 'height, 0-1 of page height' },
  },
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['products'],
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'name', 'colour', 'length', 'drawing_box'],
        properties: {
          type: { type: 'string', enum: ['A', 'B'] },
          name: { type: 'string' },
          code: { type: 'string' },
          colour: { type: 'string' },
          length: { type: 'string' },
          size: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          photo_context: { type: 'string', enum: ['installed-scene', 'standalone-product'] },
          photo_box: BOX,
          drawing_box: BOX,
          examples: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['box', 'caption','role'], properties: { box: BOX, caption: { type: 'string' }, role:{type:'string',enum:['usage','supplementary','drawing','primary-card']} } } },
          finishes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'photo_box'],
              properties: {
                name: { type: 'string' },
                badge: { type: 'string' },
                photo_box: BOX,
              },
            },
          },
        },
      },
    },
  },
}

const SYSTEM = `You read GEOMETRA product-catalogue pages and return the products on them.

There are two product types:
- "A" (standard): one product in a single finish, laid out in a narrow column
  alongside others. It has a product photo and a separate dimension drawing.
- "B" (featured): ONE product shown in SEVERAL finishes, laid out full width.
  Each finish has its own photo and its own label (e.g. Black / Silver / Rose Gold).
  A featured product has a "finishes" array and usually no single photo_box.

Rules that matter:
- For unfamiliar layouts, still return every visible product card. Use "name" for
  the printed product name, "code" for the printed code when separate, "size" for
  dimensions, and "category" for the product family/section. Do not discard a
  product because it has no technical drawing; showroom/display pages may have
  product photos and captions only.
- Transcribe names EXACTLY as printed, including odd spacing around dashes.
  "Led -160" and "Led - 508" are different strings and both must be preserved
  character for character. Never tidy them up.
- For a type B product, "colour" is the DEFAULT finish printed under the name.
- The small numbered badge is a position marker, not part of the product. Ignore it:
  numbering is assigned by the catalogue system, not taken from the page.
- Ignore page furniture: the top banner, the lifestyle photo gallery, and any row
  of feature icons along the bottom. Those are template, not products.
- If a page mixes product cards with showroom/display/lifestyle photos, return the
  product cards only. A display photo is not a product unless it has its own clear
  product identity (code/name/size) printed with it.
- Return every product even when cards are scattered or the page layout changes.
  Return them in reading order: left to right, then top to bottom. Do not merge
  two cards into one product and do not invent a missing card.
- Multiple folded, rear, glue/backing or installation views of the SAME named product belong in its examples array. They are not additional products or finishes. Preserve each example image, its associated diagram and caption together in its box. Keep the main dimension sketch separate from examples.
- photo_context: use installed-scene when the main photo shows the product installed in a room/showroom, especially mirrors with reflections, walls and lighting that explain its appearance. Keep its full rectangular photo, do not silhouette-cut an installed scene. Use standalone-product only for an isolated product shot whose background can be removed without losing context.

Boxes are normalised 0-1 against the page. Give your best estimate of the tight
bounding box; it will be refined automatically, so approximate is fine, but do not
include a neighbouring product inside a box.
- photo_box  = the original product-photo rectangle only, excluding text or drawing.
  Keep the complete visible product and its original background inside that photo
  rectangle. Do not remove/whiten the background, erase highlights, isolate the
  object, or crop tightly around the silhouette.
- drawing_box = ONLY the technical measurement drawing: keep the dimension lines, numeric measurement
  labels (for example "10mm" or "20mm"), and an angle/section diagram when that diagram itself
  explains the measurement. Exclude product names, Size/Thickness/colour/material words, captions,
  instructions and every unrelated product/application photo. The numeric callout labels belong to
  the drawing; descriptive words do not.`

/** Renders every page of a PDF at a given DPI, returning file paths in page order. */
/** How many pages the PDF has, or null when pdfinfo cannot be run. */
async function pageCount(pdfPath) {
  try {
    const { stdout } = await run('pdfinfo', [pdfPath])
    const m = String(stdout).match(/^Pages:\s+(\d+)/m)
    return m ? Number(m[1]) : null
  } catch (e) {
    // pdfinfo is only an optimisation used to make progress messages precise.
    // Some Windows installs can execute pdftoppm but reject pdfinfo (or expose
    // pdfinfo through a restricted shim), so never make the entire import fail
    // before the renderer has had a chance to read the PDF.
    return null
  }
}

const sortByPage = (files, dir) => files
  .map(f => ({ f, n: Number(f.match(/-(\d+)\.png$/)?.[1] ?? 0) }))
  .sort((a, b) => a.n - b.n)
  .map(({ f }) => join(dir, f))

async function renderPages(pdfPath, dir, dpi, tag, onProgress = () => {}, shouldStop = () => false, maxPages = null) {
  // One pdftoppm call per page, on purpose — a single call over the whole PDF says
  // NOTHING until every page is done, minutes of silence at high DPI, long enough for
  // the client to abandon the request while the server was still working perfectly.
  // Per-page calls keep the progress stream moving.
  //
  // Several pages render at once (PAGE_RENDER_CONCURRENCY), each its own pdftoppm
  // process on its own core — a heavy page no longer stalls every page behind it on
  // a single core while the rest of the machine sits idle.
  const count = await pageCount(pdfPath)
  const limit = Number.isFinite(maxPages) && maxPages > 0 ? Math.floor(maxPages) : null
  if (count) {
    const renderCount = limit ? Math.min(count, limit) : count
    if (renderCount < count) onProgress(`PDF has ${count} pages; reading the first ${renderCount} pages…`)
    const queue = Array.from({ length: renderCount }, (_, i) => i + 1)
    let done = 0
    const renderOne = async () => {
      while (queue.length) {
        if (shouldStop()) throw new IngestCancelled()
        const i = queue.shift()
        await run('pdftoppm', ['-r', String(dpi), '-png', '-f', String(i), '-l', String(i),
          pdfPath, join(dir, tag)])
        done += 1
        onProgress(`Rendered ${done} of ${renderCount} pages at ${dpi} DPI…`)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(PAGE_RENDER_CONCURRENCY, count) }, renderOne))
  } else {
    // pdfinfo ships with pdftoppm, but a missing tool must never block an import.
    onProgress(`Rendering pages at ${dpi} DPI…`)
    const range = limit ? ['-f', '1', '-l', String(limit)] : []
    await run('pdftoppm', ['-r', String(dpi), ...range, '-png', pdfPath, join(dir, tag)])
  }
  const files = (await readdir(dir)).filter(f => f.startsWith(tag) && f.endsWith('.png'))
  return sortByPage(files, dir)
}

/** Cuts one asset out of the full-resolution page and cleans it up. */
function cutAsset(page, box, kind) {
  const snapped = snapBox(page, box)
  let img = crop(page, snapped.x, snapped.y, snapped.w, snapped.h)

  if (kind === 'drawing') {
    // Line art: keep the ink, drop the graded tint behind it.
    // The trim gap is deliberately narrow. A dimension label sits ~35px from its
    // drawing and must stay; a fragment of a NEIGHBOURING product sits ~75px away
    // and must go. 60 separates the two.
    img = whiteToTransparent(keepInk(img))
    img = trimToContent(img, { gap: 60, pad: 6 })
  } else {
    // Photos remain the complete source rectangle. Do not flatten the
    // background, isolate a silhouette, remove labels, or trim the crop: the
    // source frame is the catalogue's visual truth.
  }
  return `data:image/png;base64,${toBuffer(img).toString('base64')}`
}

/**
 * Cut the exact source rectangle selected by the universal PDF reader.
 * Unlike cutAsset(), this deliberately performs no whitening, blob removal,
 * ink extraction, or content trimming. Unknown layouts must not lose pale
 * product faces, shadows, texture, or the original background.
 */
export function cutSourceAsset(page, box) {
  const snapped = snapBox(page, box)
  const img = crop(page, snapped.x, snapped.y, snapped.w, snapped.h)
  return `data:image/png;base64,${toBuffer(img).toString('base64')}`
}

/**
 * Preserve source pixels for recovery; the shared final photo stage handles
 * background removal after all PDF readers finish.
 */
function cutSourcePhotoAsset(page, box, { exact = false } = {}) {
  const snapped = exact
    ? { x: Math.round(box.x * page.width), y: Math.round(box.y * page.height),
        w: Math.round(box.w * page.width), h: Math.round(box.h * page.height) }
    : snapBox(page, box)
  const img = crop(page, snapped.x, snapped.y, snapped.w, snapped.h)
  return `data:image/png;base64,${toBuffer(img).toString('base64')}`
}

/**
 * Prefer the original embedded PDF image for a locally-read product photo.
 * The reader measured its field in the asset-DPI page, while Poppler reports
 * native image coordinates in its own XML page units, so the matcher handles
 * the conversion and rejects ambiguous/background objects. If anything is
 * uncertain, the existing source crop stays untouched.
 */
function nativePhoto(nativePage, assetPage, box) {
  const image = matchNativePdfImage(nativePage, box, assetPage)
  if (!image?.data) return null
  // Embedded PNG/JPEG photos can bypass the rendered-page crop, so apply the
  // same conservative dark-background pass to them. Never trim or touch light
  // photography, and leave formats we cannot decode unchanged.
  const match = image.data.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/)
  if (!match) return null
  try {
    const source = readImage(Buffer.from(match[2], 'base64'))
    if(!matchesRenderedPhoto(source,crop(assetPage,box.x,box.y,box.w,box.h)))return null
    const cleaned = flattenDarkBackground(source)
    return cleaned === source
      ? image.data
      : `data:image/png;base64,${toBuffer(cleaned).toString('base64')}`
  } catch {
    return null
  }
}

function preferNativePhotos(product, nativePage, assetPage, preserveRendered = false, exactRendered = false) {
  if (!product?.__sourceBoxes || !assetPage) return product
  const out = { ...product }
  const boxes = product.__sourceBoxes
  const normalized=b=>b?{x:b.x/assetPage.width,y:b.y/assetPage.height,w:b.w/assetPage.width,h:b.h/assetPage.height}:null
  out.sourceBox=normalized(boxes.photo)
  out.sourceDrawingBox=normalized(boxes.drawing)
  // Wainscoting PDFs frequently reuse the same embedded raster object with
  // different transforms. pdftohtml reports those transforms as duplicate
  // image rectangles, so overlap matching can attach PW06's image to PW02 or
  // put a caption/header object into a product thumbnail. The measured rendered
  // rectangle is authoritative for this family: it keeps the complete printed
  // photo with its original background and performs no content trimming.
  if (preserveRendered) {
    const rendered = box => box
      ? cutSourcePhotoAsset(assetPage, {
          x: box.x / assetPage.width,
          y: box.y / assetPage.height,
          w: box.w / assetPage.width,
          h: box.h / assetPage.height,
        }, { exact: exactRendered })
      : null
    if (boxes.photo) {
      const image = rendered(boxes.photo)
      if (image) out.photo = image
    }
    for (const key of ['finishes', 'variants']) {
      if (!Array.isArray(out[key]) || !Array.isArray(boxes[key])) continue
      out[key] = out[key].map((item, index) => {
        const image = rendered(boxes[key][index])
        // Keep the measured source rectangle on each variation. The generic
        // import review checks variation media independently; without this
        // metadata a trusted local crop was sent through the background remover
        // again and a failed cutout blocked the whole known-source import.
        const sourceBox = normalized(boxes[key][index])
        return image
          ? { ...item, photo: image, sourceBox,
              photoTreatmentMode: 'trusted-source-crop', sourcePreserved: true }
          : item
      })
    }
    delete out.__sourceBoxes
    return out
  }
  if (!nativePage) {delete out.__sourceBoxes;return out}
  const direct = nativePhoto(nativePage, assetPage, boxes.photo)
  if (direct) {
    out.photo = direct
    out.sourcePreserved = true
  }
  for (const key of ['finishes', 'variants']) {
    if (!Array.isArray(out[key]) || !Array.isArray(boxes[key])) continue
    out[key] = out[key].map((item, index) => {
      const image = nativePhoto(nativePage, assetPage, boxes[key][index])
      return image ? { ...item, photo: image, sourcePreserved: true } : item
    })
  }
  delete out.__sourceBoxes
  return out
}

function preferNativeAiPhoto(nativePage, assetPage, box) {
  if (!nativePage || !box) return null
  return nativePhoto(nativePage, assetPage, {
    x: box.x * assetPage.width,
    y: box.y * assetPage.height,
    w: box.w * assetPage.width,
    h: box.h * assetPage.height,
  })
}

export function hasCredentials() {
  return process.env.CATALOGUE_ENABLE_AI_FALLBACK === '1' &&
    Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
}

export const hasOpenAICredentials = () => process.env.CATALOGUE_ENABLE_AI_FALLBACK === '1' &&
  Boolean(process.env.OPENAI_API_KEY)

async function readWithOpenAI(imageData, pageNo) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageData}` } },
          { type: 'text', text: `Read page ${pageNo} and return every product on it as JSON with a products array.` },
        ] },
      ],
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`OpenAI API ${response.status}: ${detail.slice(0, 300)}`)
  }
  const body = await response.json()
  return JSON.parse(body.choices?.[0]?.message?.content ?? '{}')
}

/**
 * Turns a rule-reader product into the shape the catalogue stores.
 * The rule readers work per template, so they emit either a LED-shaped product
 * (type A/B with finishes) or a PVC-shaped one (variants, size, series).
 */
/**
 * A page that is not a product grid, kept exactly as printed.
 *
 * Covers, application galleries, close-up detail spreads and installation steps
 * carry no products to extract, but they ARE the catalogue. Each is held as one
 * full-page picture that keeps its position in the flow and prints back out
 * untouched — there is nothing to reflow inside it and nothing to get wrong.
 */
function keepWholePage(page, pageNo, categoryId, details = []) {
  return {
    id: `pg${pageNo}_${Date.now().toString(36)}`,
    name: `Page ${pageNo}`,
    isPage: true,                      // a whole page, not a product
    image: `data:image/jpeg;base64,${toJpeg(page).toString('base64')}`,
    sourcePage: pageNo,
    categoryId,
    readBy: 'page',
    details,                           // close-up photos lifted off this page, see extractDetailPhotos
    issues: [],                        // nothing to fix: it is the page itself
  }
}

const PHOTO_GRID_ANCHOR = BUILTIN_SPECS.find(s => s.id === 'photo-grid').anchor

/**
 * Keeping the page whole is only half of what was asked. The client's own words:
 * "the details (not product), close up image, will be extract too. that the
 * point." — an application spread or an installation-steps page is a grid of
 * individual photos, and those photos are worth having on their own, not just
 * trapped inside one flat page picture.
 *
 * Reuses the exact shape-based detector the photo-grid reader already tries on
 * every page (large, solidly filled rectangles) — this page already failed to
 * read as PRODUCTS that way, but the blocks it found are still real photos.
 */
function extractDetailPhotos(page) {
  // The product-grid reader excludes a block wider than half the page because
  // that width, on a PRODUCT page, means "banner", not "product" — the thing
  // every grid cell sits below. A kept page has no such banner to confuse with:
  // it already failed to read as a product grid, so a near-full-width block here
  // is a genuine hero photo, not page furniture. A real banner or title still
  // will not pass — plain text has far too little ink to clear `minFill`.
  let blocks
  try { blocks = findAnchors(page, { ...PHOTO_GRID_ANCHOR, maxWidthFrac: 1 }) } catch { return [] }
  // A cover laid out borderless — photos butted edge to edge with nothing white
  // between them — has no seam for ink-connectivity to find, so the "blocks" are
  // really just the one page: dropping anything covering nearly all of it leaves
  // that case with nothing extracted, rather than a "close-up" identical to the
  // full page already kept.
  blocks = blocks.filter(b => (b.w * b.h) / (page.width * page.height) < 0.85)
  // A cap, not a guess: a page that trips dozens of tiny hits is page texture
  // (a wood-grain background, a dot pattern), not a gallery of real photos.
  return blocks.slice(0, 12).map(b => {
    try {
      return cutSourcePhotoAsset(page, { x: b.x / page.width, y: b.y / page.height, w: b.w / page.width, h: b.h / page.height })
    } catch { return null }
  }).filter(Boolean)
}

export function adoptRuleProduct(p, index, pageNo, spec) {
  const base = {
    id: `ing${index}_${Date.now().toString(36)}`,
    name: p.name ?? '',
    drawing: p.drawing ?? null,
    drawingKind: p.drawingKind ?? null,
    drawingPhoto: p.drawingPhoto ?? null,
    drawingOriginal: p.drawingOriginal ?? null,
    drawingPreserved:Boolean(p.drawingPreserved),
    photoTreatmentMode: p.photoTreatmentMode ?? null,
    examples: p.examples ?? [],
    sourceReferences:p.sourceReferences ?? [],
    extraRole:p.extraRole,
    sourceBox:p.sourceBox ?? null,
    sourceDrawingBox:p.sourceDrawingBox ?? null,
    layoutPairGroup:p.layoutPairGroup,
    layoutFullRow:p.layoutFullRow,
    layoutRowGroup:p.layoutRowGroup,
    sourceLayout:p.sourceLayout,
    supportStrip:p.supportStrip,
    supportCaption:p.supportCaption,
    productShape:p.productShape ?? spec?.productShape ?? null,
    variantTechnical:Boolean(p.variantTechnical),
    variantsRequireDrawing: p.variantsRequireDrawing ?? spec?.variantsRequireDrawing,
    sourcePreserved: Boolean(p.sourcePreserved),
    sourcePage: pageNo,
    sourceProfile: spec?.sourceProfile ?? null,
    readBy: 'rules',
  }
  const category = ['accessories-led', 'pvc-marble'].includes(spec?.category)
    ? 'accessories'
    : (spec?.category ?? 'accessories')
  base.categoryId = category      // where these products belong; the dialog routes on it

  // A category the user created has no fixed product shape — it has whatever fields
  // their layout captured. Pass those through rather than forcing it into one of the
  // two built-in shapes, which would silently drop everything that does not fit.
  const BUILTIN = ['accessories', 'accessories-led', 'pvc-marble']
  if (!BUILTIN.includes(category) || base.productShape === 'generic') {
    const finishes = (p.finishes ?? p.variants ?? []).map((f, k) => ({ id: `${base.id}f${k}`, ...f }))
    const draft = {
      ...base,
      subtitle: p.subtitle ?? p.colour ?? p.size ?? '',
      third: p.third ?? p.length ?? p.series ?? '',
      photo: p.photo ?? null,
      finishes,
      extra: p.extra ?? null,
    }
    // Only require what this layout actually captures. A sheet catalogue has a
    // photo and a code, not an engineering drawing — demanding one would block
    // every product for a field the source page does not contain. The flag is
    // carried on the draft so the review screen applies the same rule.
    const specFields = (spec?.kinds ?? [{ fields: spec?.fields }]).flatMap(kind => kind.fields ?? [])
    draft.wantsDrawing = !draft.variantTechnical && specFields.some(f => f.type === 'lineart')
    draft.issues = [
      !draft.name && 'no name was read',
      draft.wantsDrawing && !draft.drawing && 'no dimension drawing',
      draft.variantTechnical && finishes.some(f => !f.drawing) && 'a variation has no dimension drawing',
      !draft.photo && !finishes.some(f => f.photo) && 'no photos',
    ].filter(Boolean)
    return draft
  }

  if (category === 'pvc-marble' || Array.isArray(p.variants)) {
    const variants = (p.variants ?? []).map((v, k) => ({ id: `${base.id}v${k}`, ...v }))
    const draft = { ...base, size: p.size ?? '', series: p.series ?? 'PVC Marble', variants, extra: p.extra ?? null, exception: null }
    draft.issues = [
      !draft.name && 'no name was read',
      !draft.drawing && 'no dimension drawing',
      !variants.some(v => v.photo) && 'no finish photos',
    ].filter(Boolean)
    return draft
  }
  const draft = {
    ...base,
    type: p._kind === 'B' || p.type === 'B' ? 'B' : 'A',
    colour: p.colour ?? '',
    length: p.length ?? '',
    photo: p.photo ?? null,
    ...((p._kind === 'B' || p.type === 'B') ? { finishes: (p.finishes ?? []).map((f, k) => ({ id: `${base.id}f${k}`, ...f })) } : {}),
  }
  draft.issues = [
    !draft.name && 'no name was read',
    !draft.drawing && 'no dimension drawing',
    draft.type === 'A' && !draft.photo && 'no product photo',
    draft.type === 'B' && !(draft.finishes ?? []).some(f => f.photo) && 'no finish photos',
  ].filter(Boolean)
  return draft
}

/**
 * @param pdfBase64  the uploaded PDF
 * @param onProgress optional (msg) => void
 * @returns { products, pages, warnings }
 */
/**
 * @param pdfBase64  the uploaded PDF
 * @param onProgress optional (msg) => void
 * @param intoCategory  where products from a layout that declares no category of
 *                      its own should go — the catalogue the user had open
 */
/** Thrown when the admin abandons an import. Not a failure — say so differently. */
export class IngestCancelled extends Error {
  constructor() { super('Import cancelled.'); this.name = 'IngestCancelled' }
}

/**
 * @param shouldStop  asked between pages. Reading a 170 MB catalogue takes minutes
 *   and holds the one OCR worker, so an abandoned import must actually STOP —
 *   otherwise the next one queues behind work nobody is waiting for any more.
 */
export async function ingestPdf(pdfInput, onProgress = () => {}, intoCategory = null, shouldStop = () => false, filename = '', expectedBytes = 0) {
  // No credential check up front any more: a page in a layout the system already
  // knows is read locally and for free. The key is only needed when a page falls
  // through to the AI reader.
  const dir = await mkdtemp(join(tmpdir(), 'catalogue-ingest-'))
  const warnings = []
  const unread = []        // per-page evidence, used only if the whole PDF yields nothing
  // Accessories (March 2026) is one mixed catalogue whose first page happens to
  // match the built-in LED reader. Keep the whole upload together instead of
  // sending page 1 to Accessories ~ LED and the remaining profile rows to a new
  // catalogue. The source layout remains in each product; only the destination
  // grouping is unified.
  const singleAccessoriesCatalogue = /accessories\s*\(?(?:march|mac)\b/i.test(filename)
  // A card upload has an explicit destination. The helper also protects an
  // explicitly named 3D source from a generic PVC destination id.
  let sourceProfile = sourceProfileForImport(intoCategory, filename)
  // This is essential for scanned/image-only PDFs: there is no text for
  // sourceProfileForPdf() to read, and falling through would keep only whole
  // pages (0 products) or spend paid AI on a layout already covered locally.
  let localOnlyKnownCatalogue = Boolean(sourceProfile)
  let chrome = null        // the page header, lifted from the source PDF
  let client = null
  const getClient = () => {
    if (!hasCredentials()) {
      throw new Error('This layout is not one the built-in readers recognise, and ' +
        'there is no API key set for the AI reader to fall back on.')
    }
    if (hasOpenAICredentials()) return null
    return (client ??= new Anthropic())
  }

  try {
    const pdfPath = join(dir, 'upload.pdf')

    // `Buffer.from(x, 'base64')` NEVER THROWS. Given truncated or non-base64 input
    // it quietly decodes as far as it can and hands back whatever that produced, so
    // a broken upload became a corrupt file on disk and surfaced minutes later as
    // "Command failed: pdftoppm …" with no reason attached.
    //
    // Two cheap checks, before any of the slow work:
    // The browser's binary upload path passes the bytes directly. Keep the
    // base64 branch for older API clients, but never expand a new large PDF
    // again after it has already arrived at the server.
    const bytes = Buffer.isBuffer(pdfInput) ? pdfInput : Buffer.from(pdfInput, 'base64')
    if (expectedBytes && Math.abs(bytes.length - expectedBytes) > 16) {
      throw new Error(
        `The upload arrived incomplete — ${bytes.length.toLocaleString()} bytes of ` +
        `${expectedBytes.toLocaleString()}. Try it again; if it keeps happening the file ` +
        `may be too large for the browser to send in one piece.`)
    }
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new Error(
        'That file is not a PDF. It does not begin with "%PDF-", so whatever was ' +
        'uploaded is either not a PDF or did not survive the upload intact.')
    }
    await writeFile(pdfPath, bytes)
    await rejectCatalogueAiExport(pdfPath)

    // Recognise a renamed deterministic supplier PDF before the expensive page
    // render.  This also lets the content cache work when the same PDF arrives
    // later with a different filename.
    if (!sourceProfile) {
      sourceProfile = await sourceProfileForPdf(pdfPath, filename)
      localOnlyKnownCatalogue = Boolean(sourceProfile)
    }
    onProgress(sourceProfile
      ? `Using local reader profile: ${sourceProfile}…`
      : 'No known local reader matched; checking the generic layout…')

    // Cache only layouts that are fully deterministic and explicitly known.
    // Unknown PDFs may depend on AI interpretation and must always go through
    // their normal review path.
    const cacheKey = localOnlyKnownCatalogue
      ? ingestCacheKey(bytes, filename, intoCategory, sourceProfile)
      : null
    if (cacheKey) {
      const cached = await readIngestCache(cacheKey)
      if (cached) {
        onProgress('This known PDF was already extracted — reusing the verified local result.')
        return cached
      }
    }

    // Known layouts keep their verified high-resolution source render.  For a
    // new/unknown PDF, do one 150 DPI render only: the old path rendered the
    // entire document at asset DPI and then rendered it again at 150 DPI, while
    // also walking every embedded image.  That made a normal upload wait for
    // three expensive readers before the first product could be reviewed.
    //
    // The rendered page is also the safest generic source of truth.  Native
    // image order has no reliable page coordinates in many Illustrator PDFs
    // and was the cause of wrong product photos being attached.  Known source
    // readers may still opt into their trusted native pass below.
    // The rendered page is authoritative for every supported local reader.
    // Scanning the embedded-image tree is both expensive (Illustrator PDFs can
    // contain hundreds/thousands of repeated objects) and unsafe: object order
    // and transforms are not reliable evidence of product ownership. The
    // locally measured source boxes already produce the complete product crop,
    // and preferNativePhotos() is deliberately called with preserveRendered
    // for these readers. Keep the old matcher code available for recovery and
    // explicitly opt this ingestion path out of the scan until a reader has a
    // demonstrated need for it.
    // The 3D sheet reader uses fixed source rectangles and no vision fallback;
    // 150 DPI is enough for those panel crops and avoids rendering large product
    // pages at the heavier asset resolution. Other deterministic catalogues keep
    // the reviewed 200 DPI source quality.
    const renderDpi = sourceProfile === 'pvc-marble-sheet-3d'
      ? VISION_DPI
      : (localOnlyKnownCatalogue ? ASSET_DPI : VISION_DPI)
    const allowNativeExtraction = false
    const [nativePages, assetPages] = await Promise.all([
      allowNativeExtraction ? extractNativePdfImages(pdfPath, dir, onProgress) : Promise.resolve([]),
      renderPages(pdfPath, dir, renderDpi, 'a', onProgress, shouldStop, MAX_PAGES),
    ])
    // The single render above is enough for both local geometry and the AI
    // reader. Known source layouts therefore keep their high-resolution crops, while
    // generic layouts avoid a second full-document render entirely.
    const visionPages = assetPages

    if (!visionPages.length) throw new Error('No pages could be rendered from that PDF.')
    const count = Math.min(visionPages.length, MAX_PAGES)
    if (visionPages.length > MAX_PAGES) {
      warnings.push(`PDF has ${visionPages.length} pages; only the first ${MAX_PAGES} were read.`)
    }

    const products = []
    // This catalogue is fully covered by local page readers. If a future
    // geometry regression leaves a page unresolved, keep that page locally
    // instead of silently spending the user's OpenAI credit on a second guess.
    // Both catalogues have complete deterministic readers. Once the source is
    // identified, neither an incomplete geometry score nor optional example
    // enrichment may turn a normal upload into a paid vision request.
    for (let i = 0; i < count; i++) {
      if (shouldStop()) throw new IngestCancelled()
      onProgress(`Reading page ${i + 1} of ${count}…`)

      // --- free path: a layout the system already knows --------------------
      // Try the local rule readers first. They cost nothing and need no key, so
      // more pages of an existing catalogue never touch the API.
      const assetPage = readImage(assetPages[Math.min(i, assetPages.length - 1)])
      const nativePage = nativePages.find(p => p.number === i + 1) ?? null
      const enrichExamples = async rawProducts => {
        if (localOnlyKnownCatalogue) return rawProducts
        if(rawProducts.every(p=>p.examplesTrusted))return rawProducts
        if (!process.env.OPENAI_API_KEY || !rawProducts.length) return rawProducts
        if (shouldStop()) throw new IngestCancelled()
        onProgress(`Mengenal gambar contoh pada halaman ${i + 1}…`)
        const controller = new AbortController()
        const timer = setInterval(() => { if (shouldStop()) controller.abort() }, 500)
        try {
          const vision = `data:image/png;base64,${(await readFile(visionPages[i])).toString('base64')}`
          const primaryBoxes = rawProducts.flatMap(p => {
            const b = p.__sourceBoxes?.photo
            return b ? [{ x:b.x/assetPage.width, y:b.y/assetPage.height, w:b.w/assetPage.width, h:b.h/assetPage.height }] : []
          })
          const drawingBoxes=rawProducts.flatMap(p=>{
            const b=p.__sourceBoxes?.drawing
            return b?[{x:b.x/assetPage.width,y:b.y/assetPage.height,w:b.w/assetPage.width,h:b.h/assetPage.height}]:[]
          })
          const groups = await findProductExamples(vision, rawProducts.map(p => p.name).filter(Boolean), { signal: controller.signal, primaryBoxes, drawingBoxes })
          return attachProductExamples(rawProducts, groups.filter(g=>!rawProducts.find(p=>p.name===g.name)?.examplesTrusted), box => cutSourceAsset(assetPage, box), product => {
            const b = product.__sourceBoxes?.drawing
            return b ? { x: b.x / assetPage.width, y: b.y / assetPage.height, w: b.w / assetPage.width, h: b.h / assetPage.height } : null
          })
        } catch (e) {
          if (shouldStop()) throw new IngestCancelled()
          warnings.push(`Page ${i + 1}: gambar contoh belum dapat diasingkan (${e.message}); sumber asal dikekalkan.`)
          return rawProducts
        } finally { clearInterval(timer) }
      }
      let ruled = null
      try {
        ruled = await readWithRules(assetPage, onProgress, i + 1, {
          sourceImage: readImage(visionPages[i]),
          sourceProfile,
        })
      } catch (e) {
        warnings.push(`Page ${i + 1}: the local reader failed (${e.message}); using the AI reader.`)
      }

      if (ruled?.noProducts) {
        const details = extractDetailPhotos(assetPage)
        products.push(keepWholePage(readImage(visionPages[i]), i + 1, intoCategory, details))
        onProgress(`Page ${i + 1} is catalogue material, not a product grid — kept whole` +
          `${details.length ? `, ${details.length} close-up${details.length === 1 ? '' : 's'} extracted` : ''}.`)
        continue
      }

      // If the geometry detector found substantially more candidate cards than
      // the local OCR could read, let the configured vision model try the page.
      // Previously any partial local result was accepted and the missing cards
      // could never reach AI. Keep the free local path when no API is available.
      const localComplete = ruled?.spec && (localOnlyKnownCatalogue || !hasOpenAICredentials() || ruled.localEvidence ||
        ruled.products.length >= Math.max(1, Math.ceil((ruled.anchors?.length ?? ruled.products.length) * 0.8)))

      if (localComplete) {
        // Lift the page header off the source. Everything above the first product —
        // the title, the banner, the size line — is page furniture that belongs to
        // the catalogue, and inventing a plain bar in its place loses the identity
        // of the page. Only the first page's header is taken; it repeats.
        if (!chrome && !ruled.spec.category && ruled.anchors?.length) {
          const mmPx = assetPage.width / 210
          const top = Math.min(...ruled.anchors.map(a => a.y))
          const gap = Math.round(mmPx * 2)
          if (top > mmPx * 8) {
            chrome = {
              image: `data:image/png;base64,${toBuffer(
                crop(assetPage, 0, 0, assetPage.width, Math.max(1, top - gap))).toString('base64')}`,
              heightMm: +((top - gap) / mmPx).toFixed(1),
            }
            // READ the header, not just keep it. This band is the one place the PDF
            // states which product family it belongs to — "PVC Marble | Gloss/ Film",
            // "Acoustic Panel", "Carbon Crystal Wall Panel" — so it is what lets an
            // import be routed to the right catalogue instead of landing in whichever
            // one happened to be open.
            //
            // Read at vision resolution: the high-resolution band is larger than the
            // for no extra accuracy on text this large, and OCR is the slow step.
            try {
              const vis = readImage(visionPages[i])
              const band = crop(vis, 0, 0, vis.width, Math.max(1, Math.round((top - gap) / (ASSET_DPI / VISION_DPI))))
              const { text } = await ocr(band)
              chrome.text = String(text ?? '').replace(/\s+/g, ' ').trim()
              onProgress(`Page header reads: "${chrome.text.slice(0, 60)}"`)
            } catch { chrome.text = '' }
          }
        }

        for (const raw of await enrichExamples(ruled.products)) {
          // Trust the measured rendered-page crop over embedded-PDF-image matching
          // for any built-in known-source spec, not just a filename containing
          // "march"/"mac". The Accessories March layout's photos (diagonal metal
          // bars, swatch strips) are visually near-identical across pages/products,
          // so the coarse 16x16 matchesRenderedPhoto() sampling can be fooled into
          // attaching a DIFFERENT product's (even a different page's) embedded
          // image — confirmed on "Accessories (Jan 2026).pdf", whose filename never
          // matched isKnownLocalCatalogueFilename()'s march/mac check, so this
          // protection never engaged and H Micro-Seam's photo came from page 9.
          const trustedSpec = raw._spec?.startsWith('wainscoting-') ||
            raw._spec?.startsWith('accessories-march-') ||
            raw._spec?.startsWith('carbon-crystal-') ||
            raw._spec?.startsWith('pvc-marble-sheet-3d-')
          const p = preferNativePhotos(raw, nativePage, assetPage,
            localOnlyKnownCatalogue || trustedSpec,
            raw._spec?.startsWith('carbon-crystal-'))
          // A layout with no category of its own (the shape-based photo grid) lands
          // in whichever catalogue the user had open.
          const spec = ruled.spec.category ? ruled.spec : { ...ruled.spec, category: intoCategory }
          products.push(adoptRuleProduct(p, products.length + 1, i + 1, spec))
        }
        warnings.push(...(ruled.warnings ?? []).map(w => `Page ${i + 1}: ${w}`))
        onProgress(`Page ${i + 1} read locally — no API call needed.`)
        continue
      }
      // Always say what each layout made of the page. Without this a failure is
      // just 'not recognised', which does not tell anyone what to change.
      const detail = describeReport(ruled?.report)
      onProgress(`Page ${i + 1}: ${detail}`)
      warnings.push(`Page ${i + 1}: no products were read from this page. ${detail}`)
      unread.push(`Page ${i + 1}: ${detail}`)

      if (localOnlyKnownCatalogue) {
        const details = extractDetailPhotos(assetPage)
        products.push(keepWholePage(readImage(visionPages[i]), i + 1, intoCategory, details))
        onProgress(`Page ${i + 1} was kept locally; paid AI fallback is disabled for this known catalogue.`)
        continue
      }

      // --- a page that is not a product grid --------------------------------
      // KEEP IT. A catalogue is not only its product tables: the cover, the "Wide
      // Range of Application" spread, the close-up detail shots and the
      // installation steps are all part of the document the client publishes.
      // Dropping them reproduced half a catalogue.
      //
      // Such a page is taken whole, as a picture, and holds its place in the flow.
      // Nothing about it is guessed at — it is the page, exactly as printed.
      if (!hasCredentials()) {
        const details = extractDetailPhotos(assetPage)
        products.push(keepWholePage(readImage(visionPages[i]), i + 1, intoCategory, details))
        onProgress(`Page ${i + 1} is not a product grid — kept whole as a page` +
          `${details.length ? `, ${details.length} close-up${details.length === 1 ? '' : 's'} extracted` : ''}.`)
        continue
      }
      const imageData = (await readFile(visionPages[i])).toString('base64')
      let parsed
      if (hasOpenAICredentials()) {
        onProgress(`Reading page ${i + 1} with OpenAI…`)
        try {
          parsed = await readWithOpenAI(imageData, i + 1)
        } catch (e) {
          warnings.push(`Page ${i + 1}: OpenAI could not read it (${e.message}).`)
          continue
        }
      } else {
        const response = await getClient().messages.create({
          model: 'claude-opus-5',
          max_tokens: 16000,
          system: SYSTEM,
          thinking: { type: 'adaptive' },
          output_config: { format: { type: 'json_schema', schema: SCHEMA } },
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData } },
              { type: 'text', text: `Read page ${i + 1} and return every product on it.` },
            ],
          }],
        })

        if (response.stop_reason === 'refusal') {
          warnings.push(`Page ${i + 1} was declined by the safety classifier; skipped.`)
          continue
        }

        try {
          parsed = JSON.parse(response.content.find(b => b.type === 'text')?.text ?? '{}')
        } catch {
          warnings.push(`Page ${i + 1}: could not parse the model's response; skipped.`)
          continue
        }
      }

      const aiProducts = Array.isArray(parsed?.products) ? parsed.products : []
      if (!aiProducts.length) {
        // If the vision fallback declines or cannot parse a page that the local
        // reader partially understood, keep those known products rather than
        // replacing them with a blank page.
        if (ruled?.spec && ruled.products?.length) {
          const spec = ruled.spec.category ? ruled.spec : { ...ruled.spec, category: intoCategory }
          for (const raw of await enrichExamples(ruled.products)) {
            // Trust the measured rendered-page crop over embedded-PDF-image matching
          // for any built-in known-source spec, not just a filename containing
          // "march"/"mac". The Accessories March layout's photos (diagonal metal
          // bars, swatch strips) are visually near-identical across pages/products,
          // so the coarse 16x16 matchesRenderedPhoto() sampling can be fooled into
          // attaching a DIFFERENT product's (even a different page's) embedded
          // image — confirmed on "Accessories (Jan 2026).pdf", whose filename never
          // matched isKnownLocalCatalogueFilename()'s march/mac check, so this
          // protection never engaged and H Micro-Seam's photo came from page 9.
          const trustedSpec = raw._spec?.startsWith('wainscoting-') ||
            raw._spec?.startsWith('accessories-march-') ||
            raw._spec?.startsWith('carbon-crystal-') ||
            raw._spec?.startsWith('pvc-marble-sheet-3d-')
          const p = preferNativePhotos(raw, nativePage, assetPage,
            localOnlyKnownCatalogue || trustedSpec,
            raw._spec?.startsWith('carbon-crystal-'))
            products.push(adoptRuleProduct(p, products.length + 1, i + 1, spec))
          }
          warnings.push(`Page ${i + 1}: AI returned no products; kept ${ruled.products.length} local products.`)
          continue
        }
        // An AI model can correctly recognise a showroom or installation spread
        // as not being a normal product grid. Keep it and extract its photos
        // instead of silently dropping the page.
        const details = extractDetailPhotos(assetPage)
        products.push(keepWholePage(readImage(visionPages[i]), i + 1, intoCategory, details))
        onProgress(`Page ${i + 1} is a display/showroom page — kept whole` +
          `${details.length ? `, ${details.length} close-up${details.length === 1 ? '' : 's'} extracted` : ''}.`)
        continue
      }

      onProgress(`Cutting images from page ${i + 1}…`)

      for (const p of aiProducts) {
        const code = String(p.code ?? '').trim()
        const printedName = String(p.name ?? '').trim()
        const name = code && printedName && !printedName.toUpperCase().includes(code.toUpperCase())
          ? `${code} ${printedName}` : (printedName || code)
        const draft = {
          id: `ing${products.length + 1}_${Date.now().toString(36)}`,
          type: p.type === 'B' ? 'B' : 'A',
          name,
          code,
          colour: p.colour ?? '',
          length: p.length ?? p.size ?? '',
          size: p.size ?? '',
          subtitle: p.size ?? p.description ?? p.category ?? '',
          third: p.category ?? '',
          category: p.category ?? '',
          categoryId: 'generic-ai',
          readBy: 'ai',
          photo: null,
          drawing: null,
          sourcePage: i + 1,
          sourcePreserved: true,
          sourceBox: p.photo_box ?? null,
          sourceDrawingBox: p.drawing_box ?? null,
          drawingPreserved:Boolean(p.drawing_box),
          photoTreatmentMode: p.photo_context === 'installed-scene' ? 'preserve-scene' : null,
          examples: (Array.isArray(p.examples) ? p.examples : []).filter(e => validSourceBox(e.box) && !coversPrimaryPhoto(e.box, p.photo_box)).slice(0, 8).map(e => ({
            image: cutSourceAsset(assetPage, e.box), caption: String(e.caption ?? '').slice(0, 160), sourceBox: e.box, role:e.role,
          })),
        }

        try {
          if (p.drawing_box) draft.drawing = cutSourceAsset(assetPage, p.drawing_box)
        } catch { warnings.push(`${draft.name || 'A product'}: could not cut the dimension drawing.`) }

        if (draft.type === 'B') {
          draft.finishes = (p.finishes ?? []).map((f, k) => {
            let photo = null
            try {
              photo = preferNativeAiPhoto(nativePage, assetPage, f.photo_box) ??
                (f.photo_box ? cutSourcePhotoAsset(assetPage, f.photo_box) : null)
            } catch {}
            return {
              id: `${draft.id}f${k}`,
              name: f.name ?? '', badge: f.badge ?? '', photo,
              sourcePreserved: true,
              sourceBox: f.photo_box ?? null,
            }
          })
          if (!draft.finishes.length) warnings.push(`${draft.name || 'A featured product'}: no finishes found.`)
        } else {
          try {
            if (p.photo_box) draft.photo = preferNativeAiPhoto(nativePage, assetPage, p.photo_box) ??
              cutSourcePhotoAsset(assetPage, p.photo_box)
          } catch { warnings.push(`${draft.name || 'A product'}: could not cut the product photo.`) }
        }

        // Surface anything the admin must fix before this can be added.
        draft.issues = [
          !draft.name && 'no name was read',
          !draft.drawing && 'no dimension drawing',
          draft.type === 'A' && !draft.photo && 'no product photo',
          draft.type === 'B' && !(draft.finishes ?? []).some(f => f.photo) && 'no finish photos',
        ].filter(Boolean)

        products.push(draft)
      }
    }

    // Only a PDF that yielded nothing at all is a failure — no products AND not even
    // a page worth keeping. A cover-only PDF is no longer that case: its pages come
    // in whole.
    if (!products.length) {
      throw new Error(
        `Nothing could be read from any of the ${count} page(s).` +
        `\n\nWhat each layout made of each page:\n` + unread.join('\n'))
    }

    // Route only products that came from a generic/fallback layout. Named layouts
    // already carry an authoritative category id. For generic pages, use the
    // lifted header and product names as evidence; unresolved imports stay in the
    // catalogue the user had open and are shown as such in review.
    //
    // A KEPT PAGE is exactly as "unresolved" as a generic product — keepWholePage()
    // stamps it with `intoCategory` for the very same reason (nothing recognised it,
    // so the catalogue the user had open was the only category available at the
    // time). Excluding `isPage` here left every kept page stranded in whichever
    // catalogue happened to be open, even when the routing confidently knew better —
    // a Ceiling Panel PDF's own cover page stayed in Accessories ~ LED. Pages never
    // carry `readBy: 'rules'`, so this never touches a named layout's own read.
    const names = products.filter(p => !p.isPage).map(p => p.name).filter(Boolean)
    const route = suggestDestination(chrome?.text ?? '', names, intoCategory, filename)
    const destination = suggestedCatalogue(route, intoCategory)
    for (const p of products) {
      if (!p.categoryId || p.readBy !== 'rules' || p.categoryId === intoCategory) {
        if (destination.confident) p.categoryId = destination.id
      }
    }
    const routing = {
      suggestedCategoryId: destination.id,
      suggestedTitle: destination.title,
      confident: destination.confident,
      evidence: destination.why,
      header: chrome?.text ?? '',
      names,
      filename,
    }
    if (singleAccessoriesCatalogue) {
      for (const p of products) p.categoryId = 'accessories'
      routing.suggestedCategoryId = null
      routing.suggestedTitle = 'Accessories'
      routing.confident = false
      routing.evidence = [`mixed Accessories PDF kept in one catalogue`]
    }
    // On the record, because "where did this go and why" is the question asked
    // after every surprising import — and answering it from memory is guesswork.
    console.log(`[route] "${filename || '(no filename)'}" -> ${destination.id}` +
      ` (${destination.confident ? 'confident' : 'NOT confident'})` +
      `${destination.why?.length ? ' — ' + destination.why.join('; ') : ''}`)
    warnings.push(...await validateImportedAssociations(products,{onProgress,readText:async image=>{
      if(shouldStop())throw new IngestCancelled()
      const raw=readImage(Buffer.from(image.split(',')[1],'base64'))
      const ratio=Math.min(1,900/Math.max(raw.width,raw.height))
      const width=Math.max(1,Math.round(raw.width*ratio)),height=Math.max(1,Math.round(raw.height*ratio))
      const small={width,height,data:Buffer.alloc(width*height*4)}
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const i=(Math.floor(y/ratio)*raw.width+Math.floor(x/ratio))*4
        raw.data.copy?raw.data.copy(small.data,(y*width+x)*4,i,i+4):small.data.set(raw.data.subarray(i,i+4),(y*width+x)*4)
      }
      return (await ocr(small)).text
    }}))
    if(shouldStop())throw new IngestCancelled()
    warnings.push(...await readProductDimensions(products, { onProgress, shouldStop }))
    // Photo background cleanup is a paid AI call per photo — it must never run
    // automatically during import. It stays a separate, explicit step the admin
    // (or the assistant, on request) triggers after reviewing the extracted photos.
    const sourceDocument = sourceDocumentFor(bytes, filename, count)
    attachImportEvidence(products, sourceDocument)
    const photoTreatment = { processed: 0, preserved: 0, failed: 0, total: 0, warnings: [] }
    const result = { products, pages: count, warnings, chrome, routing, photoTreatment }
    if (cacheKey) await writeIngestCache(cacheKey, result)
    onProgress('Done.')
    return result
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Gemini, not Claude — its free tier is what makes checking every photo for more
// than one product affordable to run by default. The REST endpoint is called
// directly: no SDK dependency to add, and Node already ships a global fetch.
const GEMINI_MODEL = 'gemini-2.5-flash'

export function hasGeminiCredentials() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
}

// Gemini's structured-output schema is the OpenAPI subset, not JSON Schema:
// upper-case type names, and no additionalProperties.
const GEMINI_PHOTO_SCHEMA = {
  type: 'OBJECT',
  required: ['products'],
  properties: {
    products: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['name', 'box'],
        properties: {
          name: { type: 'STRING' },
          code: { type: 'STRING' },
          box: {
            type: 'OBJECT',
            required: ['x', 'y', 'w', 'h'],
            properties: {
              x: { type: 'NUMBER' }, y: { type: 'NUMBER' },
              w: { type: 'NUMBER' }, h: { type: 'NUMBER' },
            },
          },
        },
      },
    },
  },
}

const PHOTO_SYSTEM = `You look at an ordinary photograph of real products — not a scanned
catalogue page — for example several items lined up on a shelf or a table.

Find every DISTINCT product in the photo. For each one, return:
- name: its name or description, read off a label/tag if there is one, otherwise a
  short visual description ("Grey marble tile sample").
- code: a product code printed on a label or tag, if there is one. Omit it otherwise.
- box: a tight bounding box around that ONE product only, normalised 0-1 against the
  whole photo's width and height. Never let one product's box include another.

If the photo only shows one product, return exactly one entry. Ignore hands, price
tags held toward the camera, and background clutter that is not itself a product.`

/** Asks Gemini to find every distinct product in an ordinary photo. */
async function detectProductsInPhoto(imageBase64, mime) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: `${PHOTO_SYSTEM}\n\nFind every distinct product in this photo.` },
            { inline_data: { mime_type: mime, data: imageBase64 } },
          ],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: GEMINI_PHOTO_SCHEMA,
        },
      }),
    })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const said = (() => { try { return JSON.parse(body)?.error?.message } catch { return null } })()
    throw new Error(`Gemini ${res.status}: ${(said ?? body).slice(0, 200)}`)
  }

  const data = await res.json()
  const reason = data.candidates?.[0]?.finishReason
  if (reason && reason !== 'STOP') return []     // e.g. blocked by its own safety filter
  const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text ?? '{}'
  try { return JSON.parse(text).products ?? [] } catch { return [] }
}

/** Crops one detected product out of the photo, snapped onto its real edges. */
function cropDetectedProduct(page, box) {
  const snapped = snapBox(page, box)
  return crop(page, snapped.x, snapped.y, snapped.w, snapped.h)
}

/**
 * Tidies a cropped product photo — ONLY when the crop's own border is flat enough
 * to be recognised as a real background. A scanned catalogue page always clears
 * this; an arbitrary photo (a wood table, a shelf) often will not, and forcing the
 * cleanup onto a background it cannot recognise does more harm than leaving the
 * photo exactly as snapped.
 */
function cleanPhotoCrop(img) {
  const { img: whitened, changed, light } = whitenBackground(img, { tol: 30, agreement: 0.5 })
  return light ? img : changed ? trimToContent(keepLargestBlob(whitened), { gap: 45, pad: 4 }) : img
}

/** Builds one review draft in the shape its destination category expects. */
function buildImageDraft(categoryId, idx, name, clean, image) {
  const id = `img${idx}_${Date.now().toString(36)}`
  const dimension = clean.find(x => /\b\d+(?:\.\d+)?\s*(?:mm|cm|m)\b/i.test(x)) ?? ''
  const remaining = clean.filter(x => x !== dimension && x !== name)
  if (categoryId === 'accessories-led') {
    return { id, categoryId, type: 'A', name, colour: clean[1] ?? '',
      length: dimension || clean.find(x => /mm/i.test(x)) || '', photo: image, drawing: null,
      sourcePage: 1, readBy: 'image', issues: ['no dimension drawing'] }
  }
  if (categoryId === 'pvc-marble') {
    return { id, categoryId, name, size: clean.find(x => /\d.*['"]/.test(x)) ?? '',
      series: 'PVC Marble', drawing: null,
      variants: [{ id: `${id}v0`, name: clean[1] ?? '', photo: image }],
      sourcePage: 1, readBy: 'image', issues: ['no dimension drawing'] }
  }
  return { id, categoryId, name, subtitle: dimension || remaining[0] || '',
    third: remaining.find(x => x !== dimension) ?? '',
    photo: image, drawing: null, sourcePage: 1, readBy: 'image', wantsDrawing: false, issues: [] }
}

/**
 * Read one uploaded product image locally. This is intentionally a review draft,
 * not an automatic catalogue mutation: OCR can find a name/details line, while
 * the admin still confirms the destination and supplies any required drawing.
 *
 * An ordinary photo can show more than one product — several items on a shelf, not
 * a printed page — and there is no local layout for that: no fixed page size, no
 * flat background to key off the way a scanned page has. Splitting it into several
 * drafts only happens through the AI reader, and only once it clearly finds more
 * than one product. A single detection is never trusted over the plain
 * single-product reading below — one product per photo is the common case, and a
 * misfire there must stay rare.
 */
export async function ingestImage(imageBase64, mime = 'image/png', onProgress = () => {}, intoCategory = null, filename = '') {
  const dir = await mkdtemp(join(tmpdir(), 'catalogue-image-'))
  try {
    const ext = mime.includes('jpeg') || mime.includes('jpg') ? '.jpg' : '.png'
    const path = join(dir, `upload${ext}`)
    await writeFile(path, Buffer.from(imageBase64, 'base64'))
    const page = readImage(path)

    if (hasGeminiCredentials()) {
      onProgress('Checking whether the photo shows more than one product…')
      let detected = []
      try {
        detected = await detectProductsInPhoto(imageBase64, mime)
        console.log(`[ingest-image] Gemini found ${detected.length} product(s) in the photo.`)
      } catch (e) {
        console.error('[ingest-image] Gemini detection failed:', e)
        onProgress(`Could not check for multiple products (${e.message}); reading it as one.`)
      }

      if (detected.length >= 2) {
        onProgress(`Found ${detected.length} products in the photo — reading each one…`)
        const entries = []
        for (const d of detected) {
          const raw = cropDetectedProduct(page, d.box)
          const { lines, text: ocrText } = await ocr(raw)
          const clean = lines.map(x => String(x).trim()).filter(Boolean)
          const name = d.name?.trim() || clean[0] || ''
          if (d.code?.trim()) clean[1] = d.code.trim()
          const image = `data:image/png;base64,${toBuffer(cleanPhotoCrop(raw)).toString('base64')}`
          entries.push({ name, clean, image, ocrText })
        }
        const names = entries.map(e => e.name).filter(Boolean)
        const text = entries.map(e => e.ocrText).join(' ')
        const route = suggestDestination(text, names, intoCategory, filename)
        const destination = suggestedCatalogue(route, intoCategory)
        const categoryId = destination.id ?? intoCategory
        const products = entries.map((e, i) => buildImageDraft(categoryId, i + 1, e.name, e.clean, e.image))
        onProgress(`${products.length} products read from the photo — review before importing.`)
        return { products, pages: 1, warnings: [],
          chrome: null, routing: { suggestedCategoryId: categoryId, suggestedTitle: destination.title,
            confident: destination.confident, evidence: destination.why, header: text, names } }
      }
    }

    onProgress('Reading the uploaded image locally…')
    const { lines } = await ocr(page)
    const clean = lines.map(x => String(x).trim()).filter(Boolean)
    const name = clean[0] ?? ''
    const text = clean.join(' ')
    const route = suggestDestination(text, name ? [name] : [], intoCategory, filename)
    const destination = suggestedCatalogue(route, intoCategory)
    const categoryId = destination.id ?? intoCategory
    const image = `data:${mime};base64,${imageBase64}`
    const draft = buildImageDraft(categoryId, 1, name, clean, image)

    onProgress('Image read locally — review before importing.')
    return { products: [draft], pages: 1, warnings: clean.length ? [] : ['No readable text was found; enter the product name manually.'],
      chrome: null, routing: { suggestedCategoryId: categoryId, suggestedTitle: destination.title, confident: destination.confident,
        evidence: destination.why, header: text, names: name ? [name] : [] } }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
