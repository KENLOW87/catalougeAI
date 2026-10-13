// Cancelling an import must STOP THE SERVER, not just close the dialog.
//
// Reading a large catalogue takes minutes and holds the single OCR worker. If an
// abandoned import kept running, the next one would queue behind work nobody is
// waiting for — which is exactly what happened while debugging: several abandoned
// reads left the server busy and a later import looked broken.
//
// So the test does not check the button. It checks that after a cancelled import
// the server is free to serve the next one promptly.
//
//   node server/test-cancel.mjs
//
// Needs `npm start` running.

import { readFile } from 'node:fs/promises'

const API = process.env.API_URL ?? 'http://localhost:5174'
const PDF = '../test 3.pdf'

let failed = 0
const check = (ok, label) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${label}`)
  if (!ok) failed++
}

const pdf = (await readFile(PDF)).toString('base64')

// --- start an import, then abandon it a few seconds in -------------------------
const ctl = new AbortController()
let progressSeen = 0
const started = Date.now()

const run = (async () => {
  const res = await fetch(`${API}/api/ingest`, {
    method: 'POST', signal: ctl.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf, into: 'pvc-marble-sheet' }),
  })
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const l of lines) if (l.trim() && JSON.parse(l).progress) progressSeen++
  }
})().catch(e => e)

// Let it get properly under way, then walk away.
await new Promise(r => setTimeout(r, 6000))
check(progressSeen > 0, `the import was running (${progressSeen} progress lines)`)
ctl.abort()
const err = await run
check(err?.name === 'AbortError', 'the client request aborted cleanly')

// --- the server must now be free ----------------------------------------------
// A cancelled read that kept going would still hold the OCR worker, and this next
// request would sit behind it.
const t0 = Date.now()
const status = await fetch(`${API}/api/ingest/status`).then(r => r.json())
check(status.ready === true, 'the server answers immediately after a cancel')
check(Date.now() - t0 < 2000, `it answered in ${Date.now() - t0}ms, not queued behind abandoned work`)

// And a fresh import must start promptly rather than waiting out the cancelled one.
const ctl2 = new AbortController()
let firstLine = 0
const second = (async () => {
  const res = await fetch(`${API}/api/ingest`, {
    method: 'POST', signal: ctl2.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf, into: 'pvc-marble-sheet' }),
  })
  const reader = res.body.getReader()
  const { value } = await reader.read()
  if (value) firstLine = Date.now()
})().catch(e => e)

await new Promise(r => setTimeout(r, 8000))
ctl2.abort()
await second
check(firstLine > 0, 'a new import starts straight after a cancelled one')

console.log(`\n(total ${Math.round((Date.now() - started) / 1000)}s)`)
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
