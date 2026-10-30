// Extract raster image objects embedded in a PDF, together with their page
// positions.  This is deliberately an optional layer: the catalogue still
// renders a page for reading text and measuring layout, but product photos can
// use the original embedded image instead of a screenshot crop when Poppler can
// identify a safe match.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { readImage } from './imageops.mjs'
import { popplerTool } from './poppler.mjs'

const execFileAsync = promisify(execFile)

const decodeXml = value => String(value ?? '')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')

const attr = (tag, name) => {
  const m = String(tag).match(new RegExp(`\\b${name}="([^"]*)"`))
  return m ? decodeXml(m[1]) : ''
}

const number = (tag, name) => Number(attr(tag, name))

const normalBox = (left, top, width, height) => {
  const x1 = Math.min(left, left + width)
  const y1 = Math.min(top, top + height)
  const x2 = Math.max(left, left + width)
  const y2 = Math.max(top, top + height)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

const area = b => Math.max(0, b.w) * Math.max(0, b.h)

// Illustrator/PDF files can store a product as RGB pixels plus a separate
// soft-mask. Some Poppler HTML exports expose only the RGB layer, which turns
// transparent pixels black. Do not pass that damaged object to the catalogue;
// the caller will use the full rendered-page photo rectangle instead.
function hasMissingMask(img) {
  const { width, height, data } = img
  if (width < 8 || height < 8) return false
  let darkBorder = 0, border = 0, brightInside = 0, inside = 0
  const step = Math.max(1, Math.round(Math.min(width, height) / 80))
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      const edge = x < width * 0.08 || x >= width * 0.92 || y < height * 0.08 || y >= height * 0.92
      if (edge) { border++; if (lum < 28) darkBorder++ }
      else { inside++; if (lum > 175) brightInside++ }
    }
  }
  return border > 0 && inside > 0 && darkBorder / border >= 0.45 && brightInside / inside >= 0.25
}

function parsePages(xml, outputDir) {
  const pages = []
  const pageRe = /<page\b([^>]*)>([\s\S]*?)<\/page>/gi
  let pageMatch
  while ((pageMatch = pageRe.exec(xml))) {
    const pageTag = pageMatch[1]
    const body = pageMatch[2]
    const page = {
      number: number(pageTag, 'number'),
      width: number(pageTag, 'width'),
      height: number(pageTag, 'height'),
      images: [],
    }
    const imageRe = /<image\b[^>]*\/?>(?:<\/image>)?/gi
    let imageMatch
    while ((imageMatch = imageRe.exec(body))) {
      const tag = imageMatch[0]
      const srcAttr = attr(tag, 'src')
      if (!srcAttr) continue
      const left = number(tag, 'left')
      const top = number(tag, 'top')
      const width = number(tag, 'width')
      const height = number(tag, 'height')
      if (![left, top, width, height].every(Number.isFinite) || !width || !height) continue
      const box = normalBox(left, top, width, height)
      if (box.w < 2 || box.h < 2) continue
      const path = isAbsolute(srcAttr) ? srcAttr : join(outputDir, srcAttr)
      const ext = path.toLowerCase().endsWith('.png') ? 'png' :
        path.toLowerCase().endsWith('.webp') ? 'webp' : 'jpeg'
      page.images.push({ ...box, path, mime: `image/${ext === 'jpeg' ? 'jpeg' : ext}` })
    }
    pages.push(page)
  }
  return pages
}

/**
 * Extract image objects and their PDF-page coordinates. Failures are returned
 * as an empty list so a PDF that Poppler cannot describe still follows the
 * existing rendered-page path.
 */
export async function extractNativePdfImages(pdfPath, outputDir, onProgress = () => {}) {
  const prefix = join(outputDir, 'native.html')
  try {
    onProgress('Checking for embedded PDF product images…')
    await execFileAsync(popplerTool('pdftohtml'), ['-xml', '-hidden', '-nodrm', pdfPath, prefix], {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
    const xmlPath = `${prefix}.xml`
    const xml = await readFile(xmlPath, 'utf8')
    const pages = parsePages(xml, dirname(xmlPath))
    let count = 0
    for (const page of pages) {
      const kept = []
      for (const image of page.images) {
        try {
          await access(image.path)
          const bytes = await readFile(image.path)
          if (bytes.length < 256) continue
          image.data = `data:${image.mime};base64,${bytes.toString('base64')}`
          try { image.unsafe = hasMissingMask(readImage(bytes)) } catch { image.unsafe = false }
          kept.push(image)
        } catch { /* an optional object disappeared; keep the rest */ }
      }
      page.images = kept
      count += kept.length
    }
    onProgress(count
      ? `Found ${count} embedded PDF image${count === 1 ? '' : 's'}; embedded image data will be used when it matches a product.`
      : 'No usable embedded PDF images found; using the rendered-page fallback.')
    return pages
  } catch {
    onProgress('Embedded image extraction was unavailable; using the rendered-page fallback.')
    return []
  }
}

function intersection(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h)
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
}

function centreIn(inner, outer) {
  const cx = inner.x + inner.w / 2, cy = inner.y + inner.h / 2
  return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h
}

/**
 * Pick one embedded image for a rendered-page field box. Large page banners and
 * backgrounds are rejected; a native object must be reasonably image-sized and
 * have its centre inside the measured product-photo region.
 */
export function matchNativePdfImage(nativePage, sourceBox, renderedPage) {
  if (!nativePage?.images?.length || !sourceBox || !renderedPage?.width || !renderedPage?.height) return null
  const target = {
    x: sourceBox.x / renderedPage.width * nativePage.width,
    y: sourceBox.y / renderedPage.height * nativePage.height,
    w: sourceBox.w / renderedPage.width * nativePage.width,
    h: sourceBox.h / renderedPage.height * nativePage.height,
  }
  if (target.w < 2 || target.h < 2) return null
  const targetArea = area(target)
  const candidates = nativePage.images.map(image => {
    const imageArea = area(image)
    const overlap = intersection(image, target)
    const inTarget = overlap / Math.max(1, imageArea)
    const inImage = overlap / Math.max(1, targetArea)
    const centre = centreIn(image, target)
    const pageSized = image.w > nativePage.width * 0.82 || image.h > nativePage.height * 0.82
    const tooLarge = imageArea > targetArea * 8
    const ratio = Math.abs(Math.log((image.w / Math.max(1, image.h)) /
      (target.w / Math.max(1, target.h))))
    const score = (centre ? 3 : 0) + inTarget * 4 + inImage * 2 - ratio * 0.35 - (pageSized ? 5 : 0) - (tooLarge ? 3 : 0)
    return { image, score, overlap, centre, inTarget, inImage, pageSized, tooLarge }
  }).filter(c => c.overlap > 0 && c.centre && !c.image.unsafe && !c.pageSized && !c.tooLarge && c.inTarget >= 0.2)
    .sort((a, b) => b.score - a.score)
  return candidates[0]?.image ?? null
}

