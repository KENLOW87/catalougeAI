import { apiUrl } from './api.js'

const storageKey = 'catalogue-activity-outbox-v1'
const origin = () => navigator.webdriver ? 'test' : 'user'
let sending = null
let storageError = ''
export const activityStorageError = () => storageError
export function pendingActivityCount() { try { return JSON.parse(localStorage.getItem(storageKey) || '[]').length } catch { return 0 } }
export function flushActivity() {
  if (sending) return sending
  sending = Promise.resolve().then(async () => { try {
    while (true) {
      const queue = JSON.parse(localStorage.getItem(storageKey) || '[]')
      if (!queue.length) break
      const response = await fetch(apiUrl('/api/activity/events'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queue[0]), signal: AbortSignal.timeout(8000), keepalive: true })
      if (!response.ok) break
      // New events may have arrived while the network was busy.
      const current = JSON.parse(localStorage.getItem(storageKey) || '[]')
      localStorage.setItem(storageKey, JSON.stringify(current.filter(e => e.id !== queue[0].id)))
    }
  } catch { /* retained durably for retry, including after reload */ }
  finally { sending = null }
  })
  return sending
}
function enqueue(event) {
  const redact = text => typeof text === 'string' ? text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-key]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 4000) : text
  const entry = { ...Object.fromEntries(Object.entries(event).map(([key, value]) => [key, redact(value)])), at: new Date().toISOString(), origin: origin() }
  try {
    const queue = JSON.parse(localStorage.getItem(storageKey) || '[]')
    localStorage.setItem(storageKey, JSON.stringify([...queue, entry]))
  } catch { storageError = 'Browser tidak dapat menyimpan rekod aktiviti. Semak ruang simpanan; rekod mungkin tidak lengkap.'; window.dispatchEvent(new CustomEvent('activity-storage-error', { detail: storageError })) }
  void flushActivity()
}
export function beginActivity(kind, label, details = {}) {
  const jobId = crypto.randomUUID()
  enqueue({ ...details, id: `${jobId}-start`, jobId, type: 'job.started', kind, label })
  return jobId
}
export function activityStatus(jobId, status, result = '') {
  if (jobId) enqueue({ id: crypto.randomUUID(), jobId, type: 'job.status', status, result })
}
export function activityHeaders(jobId) { return { ...(jobId ? { 'X-Activity-Job-ID': jobId } : {}), 'X-Activity-Origin': origin() } }
export function recordImageUpload(file, source) {
  const jobId = beginActivity('upload.image', file.name, { bytes: file.size, category: source })
  return jobId
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', flushActivity)
  window.addEventListener('pagehide', flushActivity)
  setInterval(flushActivity, 30000)
  void flushActivity()
}
