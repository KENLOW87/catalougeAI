import express from 'express'
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ingestPdf, ingestImage, hasCredentials, hasGeminiCredentials } from './ingest.mjs'
import { BUILTIN_SPECS } from './readers/index.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 5174)
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'

const app = express()
// PDFs are sent as base64 JSON from the browser. A 170 MB catalogue becomes
// roughly 227 MB in transit, so the request limit must cover the encoded file.
app.use(express.json({ limit: '300mb' }))

// In development the editor is served by Vite on :5173 and calls this server
// directly, because a long streamed response loses its tail through Vite's proxy.
// Only the local editor is allowed, and only the methods it uses.
app.use((req, res, next) => {
  const origin = req.headers.origin ?? ''
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):5173$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Use the Chrome already installed on this machine rather than downloading one.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ]
  return candidates.find(p => p && existsSync(p))
}

// ---------------------------------------------------------------- PDF export
// Point a headless Chrome at the app in print mode so the PDF is rendered by the
// exact same React components and stylesheet the editor uses. There is no second
// renderer that can drift from what was edited.
//
// One catalogue or all of them go down the same path. "Download all" is not a
// second exporter: it hands the same renderer a LIST of catalogues and prints them
// in one pass, so a combined PDF cannot differ from the individual ones.
app.post('/api/export', async (req, res) => {
  const catalogues = Array.isArray(req.body?.products)
    ? [{ category: req.body?.category ?? 'accessories-led', products: req.body.products, chrome: null }]
    : req.body?.catalogues
  if (!Array.isArray(catalogues) || !catalogues.length) {
    return res.status(400).send('products array, or a non-empty catalogues array, required')
  }
  if (catalogues.some(c => !Array.isArray(c?.products))) {
    return res.status(400).send('every catalogue needs a products array')
  }

  const exe = findChrome()
  if (!exe) return res.status(500).send('No Chrome or Edge found. Set CHROME_PATH.')

  let browser
  try {
    browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] })
    const page = await browser.newPage()

    // Inject the data before the app boots so it renders straight into print mode.
    // A single catalogue is simply a list of one — there is no separate code path.
    await page.evaluateOnNewDocument(list => {
      window.__CATALOGUE_ALL__ = list
      window.__CATALOGUE_DATA__ = list[0].products
      window.__CATALOGUE_CATEGORY__ = list[0].category
    }, catalogues)
    await page.goto(`${APP_URL}/?print=1`, { waitUntil: 'networkidle0', timeout: 60_000 })

    // Make sure every image has decoded before printing, or the PDF can come out blank.
    await page.evaluate(async () => {
      const imgs = [...document.images]
      await Promise.all(imgs.map(i => i.complete ? Promise.resolve() : new Promise(r => { i.onload = i.onerror = r })))
      if (document.fonts?.ready) await document.fonts.ready
    })

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="catalogue.pdf"')
    console.log(`[export] ${catalogues.length} catalogue(s), ${Math.round(pdf.length / 1024)} KB`)
    res.end(pdf)
  } catch (e) {
    console.error('[export]', e)
    res.status(500).send(String(e.message ?? e))
  } finally {
    await browser?.close().catch(() => {})
  }
})

// ---------------------------------------------------------------- PDF ingest
// Upload a catalogue PDF, get back draft products for review.
// Known layouts are read locally and need no key; only an unrecognised layout
// falls through to the AI reader.
// ------------------------------------------------------------------ the bot
// Only questions the rules could NOT answer arrive here. The client answers
// counts, gaps, duplicates and lookups itself — instantly, exactly, and for
// nothing — so the API is spent only on wording and judgement.
//
// What arrives is a TEXT summary of the catalogue: names, codes, descriptions,
// counts. Never the images: they are almost all of a catalogue's bulk, they would
// cost a great deal to send, and they answer no question that this bot is asked.
app.post('/api/ask', async (req, res) => {
  const question = String(req.body?.question ?? '').trim()
  const summary = String(req.body?.summary ?? '')
  if (!question) return res.status(400).json({ error: 'question required' })

  if (!hasCredentials()) {
    return res.json({
      source: 'none',
      text: 'I can only answer from the catalogue itself at the moment — counts, missing ' +
        'photos, duplicates, gaps in the codes, and anything about a particular code. ' +
        'Questions that need judgement or free wording need an ANTHROPIC_API_KEY set on ' +
        'the server; without one nothing is sent anywhere and nothing is charged.',
    })
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic()
    const reply = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1200,
      system:
        'You answer questions about a product catalogue for its administrator.\n' +
        'The catalogue data below is the ONLY source of truth. Never invent a product, ' +
        'a code, a size or a description that is not in it. If the data does not say, ' +
        'reply that it does not say.\n' +
        'Product names and codes are printed exactly as stored — never correct their ' +
        'spelling or spacing in your answer.\n' +
        'Be brief and concrete. Prefer naming the products involved over describing them.',
      messages: [{ role: 'user', content: `${summary}\n\nQuestion: ${question}` }],
    })
    const text = reply.content.find(b => b.type === 'text')?.text ?? ''
    res.json({ source: 'ai', text: text || 'No answer came back.' })
  } catch (e) {
    console.error('[ask]', e)
    res.status(500).json({ error: String(e.message ?? e) })
  }
})

app.get('/api/ingest/status', (_req, res) => res.json({
  ready: true,
  localReaders: BUILTIN_SPECS.map(l => l.title),
  aiFallback: hasCredentials(),
}))

// Progress streams as newline-delimited JSON so the UI can say what it is doing
// instead of sitting on a spinner for a minute.
app.post('/api/ingest', async (req, res) => {
  const pdf = req.body?.pdf
  if (typeof pdf !== 'string' || !pdf.length) {
    return res.status(400).json({ error: 'pdf (base64) required' })
  }

  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache')
  // Long silences kill this request. Rendering a 9-page catalogue at 400 DPI takes
  // minutes and used to emit a single "Rendering pages…" line, after which nothing
  // was written at all — and the client gave up mid-ingest (UND_ERR_BODY_TIMEOUT).
  // The upload looked broken while the server was still working perfectly.
  //
  // A heartbeat keeps the stream alive through EVERY slow step, not just the one
  // that happens to be slow today, and doubles as visible progress.
  res.setTimeout?.(0)
  const started = Date.now()
  let lastMsg = 'Starting…'

  // The admin can abandon an import — by pressing Cancel, closing the tab, or
  // losing the connection. Reading a 170 MB catalogue takes minutes and holds the
  // single OCR worker, so work nobody is waiting for must stop rather than block
  // the next import behind it.
  //
  // Listen on the RESPONSE, not the request. `req`'s "close" fires as soon as the
  // uploaded body has been read — which on a POST is immediately — so watching it
  // suppressed every line of a perfectly healthy import.
  let gone = false
  res.on('close', () => { gone = true })
  const send = obj => { if (!gone && !res.writableEnded) res.write(JSON.stringify(obj) + '\n') }
  const beat = setInterval(() => {
    const secs = Math.round((Date.now() - started) / 1000)
    send({ progress: `${lastMsg} (${secs}s)`, heartbeat: true })
  }, 10_000)

  try {
    // Which catalogue the user had open — where products from a layout that
    // declares no category of its own should land.
    const into = typeof req.body?.into === 'string' ? req.body.into : null
    const filename = typeof req.body?.filename === 'string' ? req.body.filename : ''
    const result = await ingestPdf(pdf, msg => { lastMsg = msg; send({ progress: msg }) }, into, () => gone, filename,
      Number(req.body?.bytes) || 0)

    // The result carries every cut image, so it runs to ~12 MB. Sent as ONE line it
    // arrived instantly straight from this server and never arrived at all through
    // the dev proxy — the line was cut mid-way and the import dialog sat on
    // "Reading…" forever while the work had actually finished.
    //
    // So it goes out in pieces. Nothing downstream depends on the payload being one
    // write, and a stream of ordinary-sized lines is what every hop in between is
    // built to carry.
    const payload = JSON.stringify(result)
    const SIZE = 256 * 1024
    const total = Math.ceil(payload.length / SIZE)
    for (let i = 0; i < total; i++) {
      send({ part: payload.slice(i * SIZE, (i + 1) * SIZE), i, total })
    }
    send({ assembled: total })
    console.log(`[ingest] sent ${Math.round(payload.length / 1048576)} MB in ${total} part(s)`)
  } catch (e) {
    // Abandoning an import is a choice, not a fault. Log it as one line, not as a
    // stack trace that makes a normal action look like a crash.
    if (e?.name === 'IngestCancelled' || gone) {
      console.log(`[ingest] cancelled after ${Math.round((Date.now() - started) / 1000)}s`)
      clearInterval(beat)
      return res.end()
    }
    console.error('[ingest]', e)
    send({ error: String(e.message ?? e) })
  } finally {
    clearInterval(beat)
  }
  res.end()
})

app.post('/api/ingest-image', async (req, res) => {
  const image = req.body?.image
  const mime = typeof req.body?.mime === 'string' ? req.body.mime : 'image/png'
  const into = typeof req.body?.into === 'string' ? req.body.into : null
  if (typeof image !== 'string' || !image.length) {
    return res.status(400).json({ error: 'image (base64) required' })
  }
  try {
    const result = await ingestImage(image, mime, () => {}, into,
      typeof req.body?.filename === 'string' ? req.body.filename : '')
    res.json(result)
  } catch (e) {
    console.error('[ingest-image]', e)
    res.status(500).json({ error: String(e.message ?? e) })
  }
})

// Serve the production build when it exists.
const dist = join(__dirname, '..', 'dist')
if (existsSync(dist)) app.use(express.static(dist))

app.listen(PORT, () => {
  console.log(`export server  http://localhost:${PORT}`)
  console.log(`rendering from ${APP_URL}`)
  console.log(`chrome         ${findChrome() ?? 'NOT FOUND'}`)
  // Name the readers rather than hardcoding a summary. Vite reloads the browser on
  // every edit but this process does not, so a stale server is easy to miss — if a
  // reader you expect is absent from this line, the code here is out of date.
  console.log(`readers        ${BUILTIN_SPECS.map(s => s.title).join(', ')}`)
  const aiProvider = process.env.OPENAI_API_KEY ? 'OpenAI' :
    (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'Anthropic' : null)
  console.log(`AI fallback    ${aiProvider ? `ready (${aiProvider})` : 'no API key — unknown layouts will fail'}`)
  console.log(`photo split    ${hasGeminiCredentials() ? 'ready (Gemini key found)' : 'no GEMINI_API_KEY — photos read as one product'}`)
})
