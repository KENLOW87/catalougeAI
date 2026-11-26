import { AsyncLocalStorage } from 'node:async_hooks'
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

export const activityContext = new AsyncLocalStorage()
export const malaysiaDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
const clean = value => String(value ?? '').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-key]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 4000)
const id = value => /^[\w-]{1,100}$/.test(value ?? '') ? value : randomUUID()
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

// Versioned standard API rates, USD / million tokens. Estimates are not invoices.
export function estimateCost(model, usage) {
  const base = { pricingDate: '2026-10-28', currency: 'USD', costStatus: 'unknown', estimatedUsd: null }
  if (!usage) return base
  if (['gpt-4o', 'gpt-4o-2024-08-06', 'gpt-4o-2024-11-20'].includes(model)) {
    const input = usage.prompt_tokens ?? usage.input_tokens, output = usage.completion_tokens ?? usage.output_tokens
    const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0
    if (![input, output, cached].every(number) || cached > input) return base
    return { ...base, costStatus: 'estimated', estimatedUsd: ((input - cached) * 2.5 + cached * 1.25 + output * 10) / 1e6, pricingSource: 'https://developers.openai.com/api/docs/models/gpt-4o' }
  }
  if (/^gpt-image-1\.5(?:-2025-12-16)?$/.test(model)) {
    const input = usage.input_tokens_details, output = usage.output_tokens_details
    if (!input || !number(input.text_tokens) || !number(input.image_tokens)) return base
    const cached = input.cached_tokens_details ?? { text_tokens: 0, image_tokens: 0 }
    // A cached total without modality breakdown cannot be priced reliably.
    if (input.cached_tokens && !input.cached_tokens_details) return base
    const ct = cached.text_tokens ?? 0, ci = cached.image_tokens ?? 0
    if (![ct, ci].every(number) || ct > input.text_tokens || ci > input.image_tokens) return base
    const inputCost = (input.text_tokens - ct) * 5 + ct * 1.25 + (input.image_tokens - ci) * 8 + ci * 2
    // Without output modalities, do not invent a text/image split.
    const ot = output?.text_tokens, oi = output?.image_tokens
    if (![ot, oi].every(number)) return base
    return { ...base, costStatus: 'estimated', estimatedUsd: (inputCost + ot * 10 + oi * 32) / 1e6, pricingSource: 'https://developers.openai.com/api/docs/models/gpt-image-1.5' }
  }
  return base
}

export function createActivityStore(directory) {
  const events = [], seen = new Set()
  mkdirSync(directory, { recursive: true })
  for (const filename of readdirSync(directory).filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort()) {
    for (const line of readFileSync(join(directory, filename), 'utf8').split('\n').filter(Boolean)) {
      try { const event = JSON.parse(line); if (!seen.has(event.id)) { events.push(event); seen.add(event.id) } } catch { /* retain other valid records after an interrupted final write */ }
    }
  }
  return {
    append(event) {
      const entry = { ...event, id: id(event.id), at: event.at ?? new Date().toISOString() }
      if (seen.has(entry.id)) return entry.id
      appendFileSync(join(directory, `${malaysiaDate(new Date(entry.at))}.jsonl`), JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 })
      seen.add(entry.id); events.push(entry)
      return entry.id
    },
    report(date = malaysiaDate(), includeTests = false) {
      const selected = events.filter(e => malaysiaDate(new Date(e.at)) === date && (includeTests || e.origin !== 'test'))
      const jobIds = [...new Set(selected.map(e => e.jobId))]
      const jobs = jobIds.map(jobId => {
        const history = events.filter(e => e.jobId === jobId).sort((a,b) => a.at.localeCompare(b.at))
        const start = history.find(e => e.type === 'job.started' && !e.fallback) ?? history.find(e => e.type === 'job.started') ?? { jobId, kind: 'activity', at: selected.find(e => e.jobId === jobId).at }
        const today = selected.filter(e => e.jobId === jobId)
        const calls = today.filter(e => e.type === 'ai.finished' || e.type === 'ai.started' && !history.some(end => end.type === 'ai.finished' && end.callId === e.callId))
        const unknown = calls.filter(e => e.costStatus !== 'estimated').length
        const latest = history.filter(e => e.type === 'job.status').at(-1)
        return { ...start, status: latest?.status ?? 'in-progress', result: latest?.result, calls,
          events: today.filter(e => !e.type.startsWith('ai.')),
          startedToday: malaysiaDate(new Date(start.at)) === date,
          estimatedUsd: calls.reduce((sum, e) => sum + (e.estimatedUsd ?? 0), 0), unknownCosts: unknown,
          credit: calls.length ? unknown ? 'unknown' : 'OpenAI' : !latest ? 'pending' : 'none' }
      }).sort((a, b) => b.at.localeCompare(a.at))
      const calls = jobs.flatMap(j => j.calls)
      return { date, timezone: 'Asia/Kuala_Lumpur', trackingSince: events[0]?.at ?? null, jobs,
        summary: { jobs: jobs.filter(j => j.startedToday).length, pdfUploads: jobs.filter(j => j.startedToday && j.kind === 'upload.pdf').length,
          imageUploads: jobs.filter(j => j.startedToday && j.kind === 'upload.image').length,
          botCommands: jobs.filter(j => j.startedToday && j.kind === 'bot.command').length,
          openaiCalls: calls.length, imageCalls: calls.filter(c => c.operation === 'image.edit').length,
          estimatedUsd: calls.reduce((sum, c) => sum + (c.estimatedUsd ?? 0), 0), unknownCosts: calls.filter(c => c.costStatus !== 'estimated').length,
          freeJobs: jobs.filter(j => j.credit === 'none').length } }
    },
  }
}

export function installActivity(app, { directory = fileURLToPath(new URL('../data/activity/', import.meta.url)), request = globalThis.fetch } = {}) {
  const store = createActivityStore(directory)
  const record = event => store.append(event)
  const kinds = { '/api/ingest': 'upload.pdf', '/api/ingest-pdf': 'upload.pdf', '/api/ingest-image': 'upload.image', '/api/interpret': 'bot.command', '/api/image/edit': 'image.edit' }
  app.get('/api/activity', (req, res) => {
    const date = req.query.date ?? malaysiaDate()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Use YYYY-MM-DD' })
    res.json(store.report(date, req.query.includeTests === '1'))
  })
  app.post('/api/activity/events', (req, res) => {
    const body = req.body ?? {}, jobId = id(body.jobId), origin = body.origin === 'test' ? 'test' : 'user'
    if (!['job.started', 'job.status'].includes(body.type)) return res.status(400).json({ error: 'Invalid event type' })
    const suppliedTime = new Date(body.at)
    const entry = { id: id(body.id), jobId, origin, type: body.type, ...(Number.isFinite(suppliedTime.getTime()) && suppliedTime <= new Date(Date.now() + 60000) ? { at: suppliedTime.toISOString() } : {}) }
    if (body.type === 'job.started') Object.assign(entry, { kind: clean(body.kind), label: clean(body.label), bytes: Number(body.bytes) || 0, category: clean(body.category) })
    else Object.assign(entry, { status: clean(body.status), result: clean(body.result) })
    record(entry); res.json({ ok: true, jobId })
  })
  app.use((req, res, next) => {
    if (req.method !== 'POST' || !kinds[req.path]) return next()
    const jobId = id(req.headers['x-activity-job-id']), origin = req.headers['x-activity-origin'] === 'test' ? 'test' : 'user'
    const context = { jobId, origin, record }
    // Idempotent start: the browser may already have queued the same start event.
    record({ id: `${jobId}-server-start`, fallback: true, type: 'job.started', jobId, origin, kind: kinds[req.path], label: clean(req.body?.filename || req.headers['x-catalogue-filename'] || req.body?.text || req.body?.instruction || 'Image edit'), bytes: Number(req.body?.bytes || req.headers['x-upload-bytes']) || 0, category: clean(req.body?.into || req.headers['x-catalogue-into']) })
    record({ type: 'request.started', status: 'running', jobId, origin, endpoint: req.path })
    let finished = false
    const finish = status => { if (!finished) { finished = true; record({ type: 'job.status', jobId, origin, status }) } }
    res.on('finish', () => finish(res.statusCode >= 400 ? 'failed' : res.locals.activityStatus ?? (req.path.startsWith('/api/ingest') ? 'ready-for-review' : 'response-received')))
    res.on('close', () => { if (!res.writableFinished) finish('cancelled') })
    activityContext.run(context, next)
  })
  // All server OpenAI fetch paths (including nested PDF readers and photo edits)
  // share this context. No request bodies, images or credentials are persisted.
  globalThis.fetch = async (url, options = {}) => {
    const context = activityContext.getStore()
    if (!context || !String(url).startsWith('https://api.openai.com/')) return request(url, options)
    const callId = randomUUID(), operation = String(url).includes('/images/') ? 'image.edit' : 'text/vision'
    let model = ''
    try { model = options.body instanceof FormData ? options.body.get('model') : JSON.parse(options.body).model } catch {}
    const base = { jobId: context.jobId, origin: context.origin, callId, operation, model }
    context.record({ ...base, type: 'ai.started', costStatus: 'unknown' })
    let response
    try {
      response = await request(url, options)
      const body = await response.clone().json().catch(() => ({}))
      const actualModel = body.model || model
      // Keep only numeric token fields; never persist arbitrary provider payloads.
      const tokensOnly = value => Object.fromEntries(Object.entries(value ?? {}).flatMap(([key, value]) => number(value) ? [[key, value]] : value && typeof value === 'object' && !Array.isArray(value) ? [[key, tokensOnly(value)]] : []))
      const usage = body.usage ? tokensOnly(body.usage) : null
      context.record({ ...base, type: 'ai.finished', model: actualModel, requestId: response.headers.get('x-request-id'), status: response.ok ? 'success' : `http-${response.status}`, usage, ...estimateCost(actualModel, usage) })
      return response
    } catch (error) {
      context.record({ ...base, type: 'ai.finished', status: error.name === 'AbortError' ? 'cancelled' : 'network-error', costStatus: 'unknown', estimatedUsd: null })
      throw error
    }
  }
  return store
}
