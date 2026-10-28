import React, { useEffect, useState } from 'react'
import { apiUrl } from '../lib/api.js'
import { flushActivity, pendingActivityCount, activityStorageError } from '../lib/activity.js'
import './activity.css'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const money = value => `$${Number(value).toFixed(6)}`
export default function ActivityPanel({ onClose }) {
  const [date, setDate] = useState(today), [tests, setTests] = useState(false), [report, setReport] = useState(null), [error, setError] = useState(''), [pending, setPending] = useState(0)
  async function refresh(signal) {
    setError('')
    try {
      await flushActivity()
      setPending(pendingActivityCount())
      const response = await fetch(apiUrl(`/api/activity?date=${date}&includeTests=${tests ? 1 : 0}`), { signal })
      if (!response.ok) throw new Error('Rekod server tidak dapat dibaca.')
      setReport(await response.json())
    } catch (e) { if (e.name !== 'AbortError') setError(e.message) }
  }
  useEffect(() => { const controller = new AbortController(); setReport(null); void refresh(controller.signal); return () => controller.abort() }, [date, tests])
  useEffect(() => { const key = e => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [onClose])
  return <div className="activity-overlay"><section className="activity-panel" role="dialog" aria-modal="true" aria-label="Aktiviti & Kos">
    <div className="activity-toolbar"><h2>Aktiviti & Kos OpenAI</h2><button onClick={onClose} autoFocus>Tutup</button></div>
    <p>Waktu Malaysia · Kos anggaran USD daripada token API. Rekod bermula selepas fungsi ini dipasang; aktiviti lama tidak direka semula.</p>
    <div className="activity-toolbar"><label>Tarikh <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><label><input type="checkbox" checked={tests} onChange={e => setTests(e.target.checked)} /> Sertakan ujian automatik</label><button onClick={() => refresh()}>Refresh</button></div>
    {pending > 0 && <p role="alert">{pending} rekod masih menunggu sambungan server. Akan dicuba semula.</p>}
    {activityStorageError() && <p role="alert">{activityStorageError()}</p>}
    {error && <p role="alert">{error} Data tidak tersedia, bukan penggunaan sifar.</p>}
    {report && <><div className="activity-totals">
      <span>PDF: <b>{report.summary.pdfUploads}</b></span><span>Gambar: <b>{report.summary.imageUploads}</b></span><span>Arahan bot: <b>{report.summary.botCommands}</b></span>
      <span>Panggilan OpenAI: <b>{report.summary.openaiCalls}</b> ({report.summary.imageCalls} edit gambar)</span><span>Anggaran diketahui: <b>{money(report.summary.estimatedUsd)}</b></span><span>Kos belum diketahui: <b>{report.summary.unknownCosts}</b></span>
    </div><p>Upload sahaja tidak semestinya guna AI. Setiap panggilan direkod di bawah job asal, termasuk panggilan gagal atau dibatalkan. Tiada token dikembalikan = kos belum diketahui. Anggaran bukan invois; pembundaran dashboard boleh berbeza.</p>
    <table><thead><tr><th>Masa / Aktiviti</th><th>Status</th><th>Kredit OpenAI</th><th>Kos USD hari dipilih</th></tr></thead><tbody>{report.jobs.map(job => <tr key={job.jobId}><td><time>{new Date(job.at).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}</time> · {job.kind}{job.origin === 'test' && ' [UJIAN]'}<div>{job.label}</div><details><summary>Butiran job</summary><small>{job.jobId}</small>{job.events.map(event => <p key={event.id}>{event.type}: {event.status || event.label} {event.result}</p>)}{job.calls.map(call => <div key={call.callId}><b>{call.operation} · {call.model}</b><p>{call.status || 'Menunggu respons'} · {call.costStatus === 'estimated' ? money(call.estimatedUsd) : 'Kos belum diketahui'}</p><pre>{JSON.stringify(call.usage, null, 2)}</pre>{call.requestId && <small>Request: {call.requestId}</small>}</div>)}</details></td><td>{job.status}</td><td>{job.credit === 'none' ? 'Tidak — tiada panggilan OpenAI' : job.credit === 'pending' ? 'Masih diproses' : `${job.calls.length} panggilan${job.unknownCosts ? ' · kos belum lengkap' : ''}`}</td><td>{money(job.estimatedUsd)}{job.unknownCosts ? ' + belum diketahui' : ''}</td></tr>)}</tbody></table>{!report.jobs.length && <p>Tiada rekod untuk tarikh ini.</p>}
    <p>Kadar standard bertarikh 28 Oktober 2026: <a href="https://developers.openai.com/api/docs/models/gpt-4o" target="_blank" rel="noreferrer">GPT-4o</a> · <a href="https://developers.openai.com/api/docs/models/gpt-image-1.5" target="_blank" rel="noreferrer">GPT-image-1.5</a>. Model atau token yang tidak dikenal pasti ditanda belum diketahui. Panggilan pembekal lain tidak termasuk dalam kos OpenAI.</p></>}
  </section></div>
}
