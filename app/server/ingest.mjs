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
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readImage, toBuffer, toJpeg, crop, whitenBackground, keepInk,
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
import { ocr, shutdownOcr } from './ocr.mjs'
import { suggestDestination, suggestedCatalogue } from '../src/lib/route.js'

const execFileAsync = promisify(execFile)

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
    return await execFileAsync(cmd, args)
  } catch (e) {
    const said = String(e.stderr ?? '').split('\n').map(s => s.trim()).filter(Boolean)
    const why = said.length ? said.slice(0, 2).join(' ') : `${cmd} exited with code ${e.code ?? '?'}`
    const err = new Error(why)
    err.tool = cmd
    err.stderr = e.stderr
    err.code = e.code          // ENOENT means the tool is missing, not the file bad
    throw err
  }
}

const VISION_DPI = 150     // what Claude looks at - keeps the image within sane token cost
const ASSET_DPI = 400      // what we actually cut the assets from
const SCALE = ASSET_DPI / VISION_DPI
const MAX_PAGES = 12

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
- drawing_box = the original technical line-drawing rectangle with millimetre callouts. Include the
  callout text ("10mm", "20mm") INSIDE this box - it is part of the drawing.`

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

async function renderPages(pdfPath, dir, dpi, tag, onProgress = () => {}, shouldStop = () => false) {
  // Rendered a page at a time, on purpose. One pdftoppm call over the whole PDF is
  // marginally faster but says NOTHING until every page is done — minutes of silence
  // at 400 DPI, long enough for the client to abandon the request while the server
  // was still working perfectly. Per-page calls keep the progress stream moving.
  const count = await pageCount(pdfPath)
  if (count) {
    for (let i = 1; i <= count; i++) {
      if (shouldStop()) throw new IngestCancelled()
      onProgress(`Rendering page ${i} of ${count} at ${dpi} DPI…`)
      await run('pdftoppm', ['-r', String(dpi), '-png', '-f', String(i), '-l', String(i),
        pdfPath, join(dir, tag)])
    }
  } else {
    // pdfinfo ships with pdftoppm, but a missing tool must never block an import.
    onProgress(`Rendering pages at ${dpi} DPI…`)
    await run('pdftoppm', ['-r', String(dpi), '-png', pdfPath, join(dir, tag)])
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
    img = keepInk(img)
    img = trimToContent(img, { gap: 60, pad: 6 })
  } else {
    // Photo: flatten a flat background, then discard slivers of the neighbour.
    const { img: whitened, light } = whitenBackground(img, { tol: 30, agreement: 0.5 })
    // Preserve already-light product photography. The crop is layout-bounded;
    // running blob removal here can mistake white product facets for background.
    img = light ? img : trimToContent(keepLargestBlob(whitened), { gap: 45, pad: 4 })
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
function cutSourcePhotoAsset(page, box) {
  const snapped = snapBox(page, box)
  const img = crop(page, snapped.x, snapped.y, snapped.w, snapped.h)
  return `data:image/png;base64,${toBuffer(img).toString('base64')}`
}

/**
 * Prefer the original embedded PDF image for a locally-read product photo.
 * The reader measured its field in the 400-DPI page, while Poppler reports
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

function preferNativePhotos(product, nativePage, assetPage, preserveRendered = false) {
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
        })
      : null
    if (boxes.photo) {
      const image = rendered(boxes.photo)
      if (image) out.photo = image
    }
    for (const key of ['finishes', 'variants']) {
      if (!Array.isArray(out[key]) || !Array.isArray(boxes[key])) continue
      out[key] = out[key].map((item, index) => {
        const image = rendered(boxes[key][index])
        return image ? { ...item, photo: image } : item
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
    supportStrip:p.supportStrip,
    supportCaption:p.supportCaption,
    sourcePreserved: Boolean(p.sourcePreserved),
    sourcePage: pageNo,
    readBy: 'rules',
  }
  const category = spec?.category ?? (Array.isArray(p.variants) ? 'pvc-marble' : 'accessories-led')
  base.categoryId = category      // where these products belong; the dialog routes on it

  // A category the user created has no fixed product shape — it has whatever fields
  // their layout captured. Pass those through rather than forcing it into one of the
  // two built-in shapes, which would silently drop everything that does not fit.
  const BUILTIN = ['accessories-led', 'pvc-marble']
  if (!BUILTIN.includes(category)) {
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
    draft.wantsDrawing = (spec?.fields ?? []).some(f => f.type === 'lineart')
    draft.issues = [
      !draft.name && 'no name was read',
      draft.wantsDrawing && !draft.drawing && 'no dimension drawing',
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
export async function ingestPdf(pdfBase64, onProgress = () => {}, intoCategory = null, shouldStop = () => false, filename = '', expectedBytes = 0) {
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
    const bytes = Buffer.from(pdfBase64, 'base64')
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

    // This is deliberately additive. Text/layout recognition still uses the
    // rendered pages below, while embedded raster objects are kept available
    // as higher-fidelity photo sources for products whose boxes can be matched.
    const nativePages = await extractNativePdfImages(pdfPath, dir, onProgress)
    const visionPages = await renderPages(pdfPath, dir, VISION_DPI, 'v', onProgress, shouldStop)
    const assetPages = await renderPages(pdfPath, dir, ASSET_DPI, 'a', onProgress, shouldStop)

    if (!visionPages.length) throw new Error('No pages could be rendered from that PDF.')
    const count = Math.min(visionPages.length, MAX_PAGES)
    if (visionPages.length > MAX_PAGES) {
      warnings.push(`PDF has ${visionPages.length} pages; only the first ${MAX_PAGES} were read.`)
    }

    const products = []
    // This catalogue is fully covered by local page readers. If a future
    // geometry regression leaves a page unresolved, keep that page locally
    // instead of silently spending the user's OpenAI credit on a second guess.
    const localOnlyWainscoting = /wainscoting/i.test(filename)
    for (let i = 0; i < count; i++) {
      if (shouldStop()) throw new IngestCancelled()
      onProgress(`Reading page ${i + 1} of ${count}…`)

      // --- free path: a layout the system already knows --------------------
      // Try the local rule readers first. They cost nothing and need no key, so
      // more pages of an existing catalogue never touch the API.
      const assetPage = readImage(assetPages[Math.min(i, assetPages.length - 1)])
      const nativePage = nativePages.find(p => p.number === i + 1) ?? null
      const enrichExamples = async rawProducts => {
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
        ruled = await readWithRules(assetPage, onProgress, i + 1,{sourceImage:readImage(visionPages[i])})
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
      const localComplete = ruled?.spec && (!hasOpenAICredentials() || ruled.localEvidence ||
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
            // Read at vision resolution: the 400 DPI band is four times the pixels
            // for no extra accuracy on text this large, and OCR is the slow step.
            try {
              const vis = readImage(visionPages[i])
              const band = crop(vis, 0, 0, vis.width, Math.max(1, Math.round((top - gap) / SCALE)))
              const { text } = await ocr(band)
              chrome.text = String(text ?? '').replace(/\s+/g, ' ').trim()
              onProgress(`Page header reads: "${chrome.text.slice(0, 60)}"`)
            } catch { chrome.text = '' }
          }
        }

        for (const raw of await enrichExamples(ruled.products)) {
          const p = preferNativePhotos(raw, nativePage, assetPage, localOnlyWainscoting || raw._spec?.startsWith('wainscoting-'))
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

      if (localOnlyWainscoting) {
        const details = extractDetailPhotos(assetPage)
        products.push(keepWholePage(readImage(visionPages[i]), i + 1, intoCategory, details))
        onProgress(`Page ${i + 1} was kept locally; OpenAI fallback is disabled for this Wainscoting catalogue.`)
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
            const p = preferNativePhotos(raw, nativePage, assetPage, localOnlyWainscoting || raw._spec?.startsWith('wainscoting-'))
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
    const photoTreatment = { processed: 0, preserved: 0, failed: 0, total: 0, warnings: [] }
    onProgress('Done.')
    return { products, pages: count, warnings, chrome, routing, photoTreatment }
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
