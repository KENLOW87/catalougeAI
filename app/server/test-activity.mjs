import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { createActivityStore, estimateCost, malaysiaDate, installActivity } from './activity.mjs'
import { editProductImage } from './ai-image.mjs'

const directory = mkdtempSync(join(tmpdir(), 'catalogue-activity-'))
const originalFetch = globalThis.fetch
let server
try {
  assert.equal(malaysiaDate(new Date('2026-10-27T16:00:00Z')), '2026-10-28')
  assert.equal(malaysiaDate(new Date('2026-10-27T15:59:59Z')), '2026-10-27')
  assert.equal(estimateCost('gpt-4o', { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200 } }).estimatedUsd, .00325)
  assert.equal(estimateCost('gpt-image-1.5', { input_tokens_details: { text_tokens: 100, image_tokens: 200 }, output_tokens_details: { text_tokens: 10, image_tokens: 1000 } }).estimatedUsd, .0342)
  assert.equal(estimateCost('unknown', {}).costStatus, 'unknown')
  assert.equal(estimateCost('gpt-image-1.5', { input_tokens_details: { text_tokens: 100, image_tokens: 200 }, output_tokens: 1000 }).costStatus, 'unknown')
  const app = express(); app.use(express.json())
  let providerCalls = 0
  const store = installActivity(app, { directory, request: async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options)
    providerCalls++
    if (options.body instanceof FormData) return new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }], usage: { input_tokens_details: { text_tokens: 100, image_tokens: 200 }, output_tokens_details: { text_tokens: 10, image_tokens: 1000 } } }), { headers: { 'content-type': 'application/json' } })
    const body = JSON.parse(options.body)
    if (body.model === 'network-failure') throw new Error('mock disconnected')
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: 'mock' } }], usage: body.model === 'no-usage' ? undefined : { prompt_tokens: 1000, completion_tokens: 100 } }), { status: body.model === 'no-usage' ? 429 : 200, headers: { 'content-type': 'application/json', 'x-request-id': 'mock-request-id' } })
  } })
  app.post('/api/interpret', async (req,res) => {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: req.body.model || 'gpt-4o' }) })
      await response.json(); res.status(response.status).json({ ok: response.ok })
    } catch { res.status(502).json({ error: 'mock network failure' }) }
  })
  app.post('/api/image/edit', async (req,res) => {
    const image = await editProductImage('data:image/png;base64,aGVsbG8=', 'Remove background', { key: 'mock-key' })
    res.json({ image })
  })
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const root = `http://127.0.0.1:${server.address().port}`
  const post = (path, body, jobId) => originalFetch(root + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-activity-origin': 'test', ...(jobId ? { 'x-activity-job-id': jobId } : {}) }, body: JSON.stringify(body) })
  const start = { id: 'first-start', jobId: 'first', origin: 'test', type: 'job.started', kind: 'bot.command', label: 'Move display sk-example-secret' }
  await post('/api/activity/events', start)
  await post('/api/activity/events', start)
  await Promise.all([post('/api/interpret', { text: 'first' }, 'first'), post('/api/interpret', { text: 'second' }, 'second')])
  await post('/api/interpret', { model: 'no-usage' }, 'failed')
  await post('/api/interpret', { model: 'network-failure' }, 'network')
  await post('/api/image/edit', {}, 'first')
  await post('/api/activity/events', { id: 'free-start', jobId: 'free', origin: 'test', type: 'job.started', kind: 'upload.image', label: 'display.jpg' })
  await post('/api/activity/events', { id: 'free-status', jobId: 'free', origin: 'test', type: 'job.status', status: 'attached-original' })
  const report = store.report(malaysiaDate(), true)
  assert.equal(providerCalls, 5)
  assert.equal(report.summary.openaiCalls, 5)
  assert.equal(report.summary.imageCalls, 1)
  assert.equal(report.summary.botCommands, 4)
  assert.equal(report.summary.imageUploads, 1)
  assert.equal(report.summary.unknownCosts, 2)
  assert.equal(report.summary.estimatedUsd, .0412)
  assert.equal(report.jobs.find(j => j.jobId === 'free').credit, 'none')
  assert.equal(report.jobs.find(j => j.jobId === 'first').calls.length, 2)
  assert.equal(report.jobs.find(j => j.jobId === 'second').calls.length, 1)
  assert.equal(store.report().summary.jobs, 0, 'automated tests excluded by default')
  const restored = createActivityStore(directory)
  assert.equal(restored.report(malaysiaDate(), true).summary.estimatedUsd, .0412, 'ledger survives restart')
  const raw = readdirSync(directory).map(f => readFileSync(join(directory, f), 'utf8')).join('')
  assert(!raw.includes('sk-example-secret'))
  assert(!raw.includes('Authorization'))
  assert(!raw.includes('aGVsbG8='), 'image bytes must never enter activity storage')
  store.append({ id: 'old-start', type: 'job.started', jobId: 'midnight', kind: 'upload.pdf', at: '2026-10-27T15:59:59Z' })
  store.append({ id: 'new-call', type: 'ai.finished', jobId: 'midnight', callId: 'midnight-call', costStatus: 'estimated', estimatedUsd: .1, at: '2026-10-27T16:00:00Z' })
  assert.equal(store.report('2026-10-28').summary.pdfUploads, 0)
  assert.equal(store.report('2026-10-28').summary.estimatedUsd, .1)
  console.log('PASS activity: durable per-job ledger, Malaysia boundaries, pricing, unknown costs, deduplication, concurrent API attribution, test separation; no real AI requests.')
} finally {
  globalThis.fetch = originalFetch
  if (server) await new Promise(resolve => server.close(resolve))
  rmSync(directory, { recursive: true, force: true })
}
