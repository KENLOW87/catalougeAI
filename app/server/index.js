import express from 'express'
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ingestPdf, ingestImage, hasCredentials, hasGeminiCredentials, hasOpenAICredentials } from './ingest.mjs'
import { BUILTIN_SPECS } from './readers/index.mjs'
import { editProductImage } from './ai-image.mjs'
import { loadEnvFile } from 'node:process'
import { randomUUID } from 'node:crypto'
import { DISPLAY_INTENT_GUIDANCE, CONVERSATION_GUIDANCE, IMAGE_PAGE_POSITION_GUIDANCE, displayIntentContext, conversationContext } from './display-intent.mjs'
import { BOT_CAPABILITY_GUIDANCE } from '../src/lib/bot-capabilities.js'
import { installActivity } from './activity.mjs'
import { installPublish } from './publish.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
if (existsSync(join(__dirname, '../.env'))) loadEnvFile(join(__dirname, '../.env'))
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Activity-Job-ID,X-Activity-Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Everything here is reachable with no login (localhost has always been
// single-user). Once deployed, the only thing meant to be open to a stranger
// is the read-only published-catalogue site — not uploads, AI edits, the
// activity/cost ledger, or publishing itself. Set ADMIN_PASSWORD (Render env
// var) to require it via HTTP Basic Auth for everything else; leaving it
// unset (plain local dev) keeps today's behaviour exactly as it is. Gating
// the admin shell ('/') makes the browser prompt once and cache the
// credential for the origin, so every later fetch() from the admin app needs
// no code change to carry it.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const PUBLIC_GET_PATHS = [/^\/api\/published$/, /^\/api\/published\/[a-zA-Z0-9_-]+$/, /^\/api\/ai\/status$/, /^\/api\/export-data\/[a-zA-Z0-9-]+$/]

// A SEPARATE, explicit opt-in from ADMIN_PASSWORD: it puts the "Catalogue
// assistant" bot on the public, no-login site itself, able to add/delete
// products and run AI photo edits on the LIVE catalogue — anyone with the
// URL, not just the admin. Requested and confirmed knowing the risk: a
// stranger can empty or deface the public catalogue, and paid AI calls are
// reachable by anyone. The admin's own working copy is never at risk either
// way — it lives only in the admin's own browser; the worst case here is
// "re-publish from the admin to restore what the public site shows."
// Defaults OFF even with ADMIN_PASSWORD already set and this code deployed,
// so turning it on is always a second, deliberate action.
const PUBLIC_CATALOGUE_EDIT = process.env.PUBLIC_CATALOGUE_EDIT === '1'
const PUBLIC_EDIT_POST_PATHS = [/^\/api\/publish\/[a-zA-Z0-9_-]+$/, /^\/api\/interpret$/, /^\/api\/image\/edit$/]
// Render sits behind a proxy; without this req.ip is the proxy's address for
// every visitor, which would rate-limit everyone as a single caller.
app.set('trust proxy', 1)

const isAdminAuthed = req => {
  if (!ADMIN_PASSWORD) return false
  const [, encoded] = (req.headers.authorization ?? '').split(' ')
  const [, suppliedPassword] = (encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '').split(':')
  return suppliedPassword === ADMIN_PASSWORD
}

app.use((req, res, next) => {
  if (!ADMIN_PASSWORD) return next()
  const isPublicGet = req.method === 'GET' && PUBLIC_GET_PATHS.some(re => re.test(req.path))
  const isPublicEditPost = PUBLIC_CATALOGUE_EDIT && req.method === 'POST' && PUBLIC_EDIT_POST_PATHS.some(re => re.test(req.path))
  const isPublicAsset = req.path === '/public.html'
  const needsAuth = !isPublicGet && !isPublicEditPost && !isPublicAsset && (req.path.startsWith('/api/') || req.path === '/' || req.path === '/index.html')
  if (!needsAuth) return next()
  if (isAdminAuthed(req)) return next()
  res.setHeader('WWW-Authenticate', 'Basic realm="GEOMETRA Admin"')
  res.status(401).send('Authentication required')
})

// Bounds the cost/abuse exposure of the two actually-costly public routes
// above (/api/interpret, /api/image/edit) — a single visitor or script could
// otherwise call either endlessly. Per-IP, in-memory, resets on a restart;
// this is "a stranger cannot run up the bill", not a precise global limiter.
// Saving an edit (/api/publish/:id) is not itself a paid call, so it is not
// limited here. Admin-authenticated requests are never limited.
const PUBLIC_RATE_LIMIT_PER_HOUR = Number(process.env.PUBLIC_BOT_RATE_LIMIT_PER_HOUR ?? 20)
const RATE_LIMITED_PATHS = [/^\/api\/interpret$/, /^\/api\/image\/edit$/]
const hitsByIp = new Map()
app.use((req, res, next) => {
  if (!PUBLIC_CATALOGUE_EDIT || !RATE_LIMITED_PATHS.some(re => re.test(req.path))) return next()
  if (isAdminAuthed(req)) return next()
  const now = Date.now()
  const ip = req.ip ?? 'unknown'
  const hits = (hitsByIp.get(ip) ?? []).filter(t => now - t < 3_600_000)
  if (hits.length >= PUBLIC_RATE_LIMIT_PER_HOUR) {
    return res.status(429).json({ error: `Too many requests from this visitor this hour (limit ${PUBLIC_RATE_LIMIT_PER_HOUR}/hour) — try again later.` })
  }
  hits.push(now)
  hitsByIp.set(ip, hits)
  next()
})

// Use the Chrome already installed on this machine rather than downloading one.
installActivity(app)
installPublish(app)

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

const INTERPRET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'text'],
  properties: {
    kind: { type: 'string', enum: ['command', 'answer', 'clarify', 'image_edit', 'display_intent', 'catalogue_intent'] },
    text: { type: 'string', description: 'The rewritten command, the answer, or the clarifying question.' },
  },
}

// ---------------------------------------------------------------- PDF export
// Point a headless Chrome at the app in print mode so the PDF is rendered by the
// exact same React components and stylesheet the editor uses. There is no second
// renderer that can drift from what was edited.
//
// One catalogue or all of them go down the same path. "Download all" is not a
// second exporter: it hands the same renderer a LIST of catalogues and prints them
// in one pass, so a combined PDF cannot differ from the individual ones.
const exportData = new Map()
app.get('/api/export-data/:token', (req,res) => {
  const data=exportData.get(req.params.token)
  if (!data) return res.sendStatus(404)
  res.setHeader('Cache-Control','no-store')
  res.json(data)
})
app.post('/api/export', async (req, res) => {
  const catalogues = Array.isArray(req.body?.products)
    ? [{ category: req.body?.category ?? 'accessories-led', products: req.body.products, chrome: req.body.chrome ?? null }]
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
  const token=randomUUID()
  try {
    // Recovery copies are not rendered and can contain several full generations
    // of source images. Keep them in the catalogue, not in the print job.
    exportData.set(token,catalogues.map(c=>({...c,products:c.products.map(p=>{
      const {sourcePlacementBackup,sourceCropBackup,...printProduct}=p
      return printProduct
    })})))
    browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] })
    const page = await browser.newPage()

    // Inject the data before the app boots so it renders straight into print mode.
    // A single catalogue is simply a list of one — there is no separate code path.
    // Fetch image data locally rather than embedding a huge script in a browser
    // protocol message, which can close the print target for real catalogues.
    await page.evaluateOnNewDocument(url => {
      window.__CATALOGUE_BOOTSTRAP__=fetch(url).then(r=>{
        if(!r.ok)throw new Error('Print data unavailable')
        return r.json()
      }).then(list=>{
        window.__CATALOGUE_ALL__=list
        window.__CATALOGUE_DATA__=list[0].products
        window.__CATALOGUE_CATEGORY__=list[0].category
      })
    }, `http://localhost:${PORT}/api/export-data/${token}`)
    await page.goto(`${APP_URL}/?print=1`, { waitUntil: 'networkidle0', timeout: 60_000 })
    await page.waitForSelector('.cat-page', {timeout:60_000})

    // Wait for the same presentation-only drawing crop used by the editor.
    await page.waitForFunction(() => !document.querySelector('[data-drawing-pending="true"], [data-examples-pending="true"]'), { timeout: 60_000 })
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
    exportData.delete(token)
    await browser?.close().catch(() => {})
  }
})

// ---------------------------------------------------------------- PDF ingest
// Upload a catalogue PDF, get back draft products for review.
// Known layouts are read locally and need no key; only an unrecognised layout
// falls through to the AI reader.
// ------------------------------------------------------------------ the bot
// Only reached when the LOCAL parser (src/lib/commands.js) could not recognise
// the sentence as either a known command or a rule-answerable question — a plain
// "delete PV07" or "how many products" never gets here, and costs nothing.
//
// Its ONE job for a command is to rewrite what the admin typed into the exact
// phrasing the local parser already knows, naming a real product copied verbatim
// from the catalogue data below. That rewrite is sent back through the SAME
// trusted local parser on the client — so every safety rule still applies
// exactly as it does to a typed command: nothing is ever changed here, and a
// destructive command still waits for a click on Apply. This endpoint never
// acts; it only translates.
//
// What arrives is a TEXT summary of the catalogue: names, codes, descriptions,
// counts. Never the images: they are almost all of a catalogue's bulk, they would
// cost a great deal to send, and they are not needed to answer questions or to
// name which product a sentence means.
function interpretSystemPrompt(summary, hasAttachment, findingTitles) {
  return 'Understand ordinary Malay and English catalogue instructions and reply in the user language. Use the entire request and conversation context, including corrections and exclusions. ' +
    'For catalogue actions return kind "catalogue_intent" with a JSON-encoded typed intent in text following the executable capability registry. ' +
    'For display/page operations, kind "display_intent" with the documented structured intent is also accepted. Do not reduce instructions to keyword command strings. ' +
    'Use kind "image_edit" only for an explicit edit to the attached photograph, with the precise editing instruction in text. Display placement/page creation never requires image editing. ' +
    'Use kind "answer" for a question using only the current catalogue data, and kind "clarify" when a necessary source, target or unsupported requirement cannot be resolved. ' +
    'Never invent catalogue content or claim that an operation is already completed; only Apply changes the data. ' +
    'Return only a JSON object {"kind":"catalogue_intent|display_intent|image_edit|answer|clarify","text":"..."}.\n' +
    (hasAttachment ? 'A photo is currently attached, waiting to be used.\n' : 'No photo is attached right now.\n') +
    (findingTitles.length ? `Open findings awaiting a decision: ${findingTitles.join(' | ')}\n` : 'No open findings right now.\n') +
    `\n${summary}`
}

async function interpretWithOpenAI(system, text) {
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
        { role: 'system', content: system },
        { role: 'user', content: text },
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

async function interpretWithAnthropic(system, text) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const reply = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 300,
    system,
    output_config: { format: { type: 'json_schema', schema: INTERPRET_SCHEMA } },
    messages: [{ role: 'user', content: text }],
  })
  if (reply.stop_reason === 'refusal') return { kind: 'clarify', text: 'I was not able to answer that one — could you say it a different way?' }
  try {
    return JSON.parse(reply.content.find(b => b.type === 'text')?.text ?? '{}')
  } catch {
    return {}
  }
}

app.post('/api/interpret', async (req, res) => {
  const text = String(req.body?.text ?? '').trim()
  const summary = String(req.body?.summary ?? '')
  const hasAttachment = Boolean(req.body?.hasAttachment)
  const findingTitles = Array.isArray(req.body?.findingTitles) ? req.body.findingTitles.map(String) : []
  if (!text) return res.status(400).json({ error: 'text required' })

  if (!process.env.OPENAI_API_KEY && !hasCredentials()) {
    return res.json({ kind: 'clarify', text:
      'I can only answer from the catalogue itself at the moment — counts, missing photos, ' +
      'duplicates, gaps in the codes, anything about a particular code, or a command typed the ' +
      'way "What can I say?" shows. Free wording needs an ANTHROPIC_API_KEY or OPENAI_API_KEY ' +
      'set on the server; without one nothing is sent anywhere and nothing is charged.' })
  }

  try {
    const system = interpretSystemPrompt(summary, hasAttachment, findingTitles) + '\n' + DISPLAY_INTENT_GUIDANCE + '\n' + CONVERSATION_GUIDANCE + '\n' + IMAGE_PAGE_POSITION_GUIDANCE + '\n' + BOT_CAPABILITY_GUIDANCE + '\n' + displayIntentContext(req.body?.displayInventory, req.body?.displayContext) + '\n' + conversationContext(req.body)
    const out = process.env.OPENAI_API_KEY
      ? await interpretWithOpenAI(system, text)
      : await interpretWithAnthropic(system, text)
    res.json(out.kind && out.text ? out : { kind: 'clarify', text: 'I am not sure what you mean — could you say it a different way?' })
  } catch (e) {
    console.error('[interpret]', e)
    res.status(500).json({ error: String(e.message ?? e) })
  }
})

app.get('/api/ai/status', (_req, res) => res.json({ openai: Boolean(process.env.OPENAI_API_KEY), ready: Boolean(process.env.OPENAI_API_KEY || hasCredentials()), publicCatalogueEdit: PUBLIC_CATALOGUE_EDIT }))
app.post('/api/image/edit', async (req, res) => {
  try {
    const image = await editProductImage(req.body?.image, req.body?.instruction, { productOnly: req.body?.productOnly === true })
    res.json({ image })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/ingest/status', (_req, res) => res.json({
  ready: true,
  automaticPhotoTreatment: false,
  photoTreatmentReady: Boolean(process.env.OPENAI_API_KEY),
  originalDrawingsPreserved: true,
  measurementReading: true,
  groupedProductExamples: true,
  localImageAssociationValidation: true,
  uncertainImagesRequireReview: true,
  preserveInstalledScenes: true,
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
      res.locals.activityStatus = 'cancelled'
      console.log(`[ingest] cancelled after ${Math.round((Date.now() - started) / 1000)}s`)
      clearInterval(beat)
      return res.end()
    }
    console.error('[ingest]', e)
    res.locals.activityStatus = 'failed'
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
  const aiProvider = hasCredentials() ? (process.env.OPENAI_API_KEY ? 'OpenAI' : 'Anthropic') : null
  console.log(`AI fallback    ${aiProvider ? `ready (${aiProvider})` : 'no API key — unknown layouts will fail'}`)
  console.log(`photo split    ${hasGeminiCredentials() ? 'ready (Gemini key found)' : 'no GEMINI_API_KEY — photos read as one product'}`)
})
