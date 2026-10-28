import React, { useEffect, useMemo, useRef, useState } from 'react'
import { runQc, qcSummary } from '../lib/qc.js'
import { answerLocally } from '../lib/ask.js'
import { parseCommand, COMMAND_HELP } from '../lib/commands.js'
import { apiUrl } from '../lib/api.js'
import { beginActivity, activityStatus, activityHeaders, recordImageUpload } from '../lib/activity.js'
import { processBackground, adjustPhoto } from '../lib/bgremove.js'
import { isDisplayRequest, isRemoveDisplayRequest } from '../lib/display-image.js'
import { isDisplayConversation } from '../lib/display-planner.js'
import { interpreterPayload, resolveInterpretedIntent, resolveCatalogueIntent } from '../lib/bot-interpreter.js'
import { needsSemanticReview } from '../lib/bot-capabilities.js'
import { isImageRemovalRequest, recentImageContext, proposeImageRemoval } from '../lib/image-removal.js'

const readFile = file => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(r.result)
  r.onerror = rej
  r.readAsDataURL(file)
})

// The assistant: a bubble in the corner that opens a chat window.
//
// It does three things, in this order of preference:
//   1. obeys a COMMAND        — and anything that changes data is only PROPOSED
//   2. answers from the DATA  — instant, free, exact
//   3. asks the API           — only for wording and judgement, and text only
//
// THE BOT NEVER CHANGES THE CATALOGUE BY ITSELF. A command that would alter
// anything comes back as a card describing exactly what it would do, and waits for
// a click. That is the whole safety model: a misheard instruction costs a glance,
// never a product.

const QUICK = ['How many products?', 'Which ones have no photo?', 'Any gaps in the codes?']

// Inline, because the page must never depend on an external asset to render.
const Avatar = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="20" fill="#0d7fc4" />
    <rect x="11" y="14" width="18" height="14" rx="5" fill="#fff" />
    <circle cx="16.5" cy="21" r="2.1" fill="#0d7fc4" />
    <circle cx="23.5" cy="21" r="2.1" fill="#0d7fc4" />
    <rect x="19" y="8.5" width="2" height="4" rx="1" fill="#fff" />
    <circle cx="20" cy="8" r="2" fill="#fff" />
  </svg>
)

export default function BotPanel({ items, category, accepted = [], note = null, catalogues = [], actions = {} }) {
  const [open, setOpen] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [log, setLog] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  // Attachments start as originals. Only an explicit edit adds a clean preview;
  // display-image commands always use raw, even when a clean preview exists.
  const [attachment, setAttachment] = useState(null)
  const [bgBusy, setBgBusy] = useState(false)
  const boxRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const lastTarget = useRef(null)
  const displayContext = useRef(null)
  useEffect(() => { lastTarget.current = null }, [category?.id])
  useEffect(() => { displayContext.current = null }, [category?.id])

  const findings = useMemo(() => runQc(items, category, accepted), [items, category, accepted])
  const summary = qcSummary(findings)
  const problems = findings.filter(f => f.level !== 'info').length

  const activityJob = useRef(null)
  const say = entry => {
    const jobId = Object.hasOwn(entry, 'activityJobId') ? entry.activityJobId : activityJob.current
    if (entry.who === 'bot' && jobId) activityStatus(jobId, entry.propose ? 'awaiting-apply' : 'answered', entry.propose?.summary || entry.text)
    setLog(prev => [...prev, { ...entry, activityJobId: jobId }])
  }

  useEffect(() => { boxRef.current?.scrollTo(0, boxRef.current.scrollHeight) }, [log, busy, open, showHelp])

  // What happened after an import is reported back HERE. The assistant starting a
  // job and then saying nothing about how it went is the thing that made it feel
  // like a button rather than an assistant.
  useEffect(() => {
    if (!note?.id) return
    setLog(prev => (prev.some(m => m.noteId === note.id) ? prev : [...prev, {
      who: 'bot', source: 'local', noteId: note.id,
      // Checking the result of an import is the moment it is worth checking: a bad
      // read is cheapest to fix while you still remember uploading it.
      text: note.qc && !findings.length
        ? `${note.text.replace(' I have checked the result — see below.', '')} I checked it and found no problems.`
        : note.text,
      qc: note.qc && findings.length ? findings : null,
    }]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id])

  // Safe work only: nothing here alters the catalogue's contents.
  const runSafe = act => {
    const call = {
      preparePhotos: async () => {
        setBusy(true)
        const jobs = items.filter(p => !p.isPage).flatMap(p => category.fields(p).flatMap(f => {
          if (f.type === 'image' && ['photo', 'extra'].includes(f.key) && p[f.key] &&
              !(f.key === 'photo' && p.photoTreatmentMode === 'preserve-scene')) {
            return [{ p, value: p[f.key], targetKey: f.key }]
          }
          if (f.type === 'list' && f.requireOne === 'photo') return (p[f.key] ?? []).filter(it => it.photo).map(it => ({
            p, value: it.photo, targetKey: f.key, targetItemId: it.id,
          }))
          return []
        }))
        say({ who: 'bot', text: `Memproses ${jobs.length} foto produk dengan AI. Drawing dan halaman penuh dikekalkan. Setiap hasil perlu disemak sebelum Apply.` })
        try {
          for (const job of jobs) {
            await presentPropose({ summary: `Asingkan produk — ${job.p.name}`, action: {
              type: 'removeBackground', ids: [job.p.id], label: job.p.name,
              value: job.value, targetKey: job.targetKey, targetItemId: job.targetItemId,
            } }, 'ai')
            setBusy(true)
          }
        } finally { setBusy(false) }
      },
      qc: () => runCheck(true),
      export: () => { actions.onExport?.(); say({ who: 'bot', source: 'local', text: 'Building the PDF for this catalogue…' }) },
      exportAll: () => { actions.onExportAll?.(); say({ who: 'bot', source: 'local', text: 'Building one PDF with every catalogue that has products…' }) },
      // A blank dialog, same as clicking "+ Add product" — with the code already
      // typed in if one was named. It still needs a real photo from the admin;
      // the bot never invents one, the same rule that keeps it from inventing a
      // dimension drawing.
      addProduct: () => {
        if (act.more?.length) {
          say({ who: 'bot', source: 'local', text: `Starting ${act.value} — I can only open one at a time, ` +
            `since each needs its own photo. Once it is saved, ask me to add ${act.more.join(', ')}.` })
        }
        actions.onAddProduct?.(act.value, act.photo)
        setOpen(false)
      },
      // Uploading has ONE place now: the dashboard. Scattering it across the
      // sidebar, the assistant and the dashboard meant the same destination bug
      // ("an unrecognised PDF silently fills whatever is open") had to be found
      // and fixed twice, in two different buttons.
      import: () => say({ who: 'bot', source: 'local',
        text: 'Go to the Dashboard and use Upload file — either the one at the top for a new catalogue, or the one on a specific catalogue’s card. That is the one place uploads happen.' }),
      reveal: () => { actions.onReveal?.(act.ids); setOpen(false) },
      open: () => { actions.onOpenCatalogue?.(act.id); say({ who: "bot", source: "local", text: `Opened ${act.label}.` }) },
      accept: () => {
        actions.onAccept?.(act.key)
        // The finding was answered, but any earlier qc list still showing in the
        // chat (the one just answered from, or an older "Quality check" result)
        // kept listing it — nothing about it looked different after the click.
        // Strike it from every qc snapshot already in the log, not just future ones.
        setLog(prev => prev.map(m => (m.qc ? { ...m, qc: m.qc.filter(f => f.key !== act.key) } : m)))
        say({ who: "bot", source: "local", undo: act.key,
          text: `Noted — "${act.label}" is correct. I will not raise it again.` })
      },
      // The attachment was never saved anywhere, so discarding it changes
      // nothing in the catalogue — safe to do at once, no Apply needed.
      clearAttachment: () => {
        setAttachment(null)
        say({ who: 'bot', source: 'local', text: 'Discarded that photo — attach another whenever you are ready.' })
      },
      cleanAttachment: async () => {
        if (!attachment || bgBusy) return
        setBgBusy(true)
        try {
          const result = await processBackground(attachment.raw, { force: true, jobId: activityJob.current })
          setAttachment(a => a?.raw === attachment.raw ? { ...a, clean: result.dataUrl, useClean: true } : a)
          say({ who: 'bot', text: 'Latar belakang dibuang. Semak gambar lampiran sebelum guna.' })
        } catch (e) { say({ who: 'bot', text: `Gagal buang latar: ${e.message}` }) }
        finally { setBgBusy(false) }
      },
    }[act.type]
    call?.()
  }

  const apply = (i, action) => {
    const jobId = log[i]?.activityJobId
    if (action.type === 'addDisplayImage') action = { ...action, displayId: action.displayId ?? crypto.randomUUID(), addedAt: Date.now() }
    if (['addDisplayImage', 'moveDisplayImage'].includes(action.type)) displayContext.current = action
    if (['removeDisplayImage', 'removeImagePage', 'clearProductPhoto'].includes(action.type)) displayContext.current = null
    if (['addImagePage', 'positionImagePage'].includes(action.type)) displayContext.current = { kind: 'image-page', pageId: action.pageId, ids: [action.pageId], value: action.value }
    if (['replacePhoto', 'adjustPhoto', 'removeBackground'].includes(action.type)) displayContext.current = { ...action, kind: 'product-photo' }
    if (action.type === 'discardImageAttachment') setAttachment(null)
    else if (action.type === 'editAttachment') {
      setAttachment({ raw: action.value, clean: null, useClean: false, name: 'AI edited product.png' })
      say({ who: 'bot', text: 'Gambar edit dipilih. Sekarang sebut kod produk untuk ganti atau tambah ke katalog.' })
    } else actions.onApply?.(action)
    activityStatus(jobId, 'applied', action.type)
    setLog(prev => prev.map((m, k) => (k === i ? { ...m, done: true } : m)))
    // The attachment has done its job — clear it so the next photo starts clean.
    if (['replacePhoto', 'addDisplayImage', 'addImagePage'].includes(action.type)) setAttachment(null)
    if (['addImagePage', 'positionImagePage'].includes(action.type)) setOpen(false)
  }

  // Attachment intent is not known until the admin gives an instruction.
  // Preserve the original; only an explicit cleaning command invokes image AI.
  const pickAttachment = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const uploadJob = recordImageUpload(file, 'bot-attachment')
    let raw
    try { raw = await readFile(file); activityStatus(uploadJob, 'attached-original') }
    catch (error) { activityStatus(uploadJob, 'failed', error.message); throw error }
    setAttachment({ raw, clean: null, useClean: false, name: file.name })
    say({ who: 'you', activityJobId: uploadJob, text: `📎 ${file.name}` })
    say({ who: 'bot', activityJobId: null, source: 'local', text: 'Gambar asal dikekalkan, tanpa proses AI. Sebut arahan, contohnya "Tambah gambar display untuk WB07", "Gantikan gambar WB07", atau "Buang background gambar ini".' })
  }

  const runCheck = (quiet = false) => {
    if (!quiet) activityJob.current = beginActivity('bot.command', 'Run a quality check', { category: category.id })
    if (!quiet) say({ who: 'you', text: 'Run a quality check' })
    if (!items.length) { say({ who: 'bot', source: 'local', text: 'This catalogue is empty — nothing to check yet.' }); return }
    if (!findings.length) {
      say({ who: 'bot', source: 'local', text: `I checked all ${items.length} item(s). No problems found.` })
      return
    }
    say({ who: 'bot', source: 'local', qc: findings,
      text: `I checked ${items.length} item(s) and found ${findings.length}:` })
  }

  // Shown for a `propose` result from EITHER path — a command typed in a style
  // the local parser knows, or one the AI rewrote into that style. `removeBackground`
  // needs an extra step first: the photo is processed locally so the preview
  // shown IS what Apply would save, not the untouched original.
  const presentPropose = async (propose, source) => {
    if (['addDisplayImage', 'moveDisplayImage', 'removeDisplayImage', 'addImagePage', 'positionImagePage'].includes(propose.action?.type)) {
      // A refinement replaces the pending display plan; an older placement can
      // no longer be applied accidentally after the admin changes the instruction.
      setLog(prev => prev.map(m => !m.done && ['addDisplayImage', 'moveDisplayImage', 'removeDisplayImage', 'addImagePage', 'positionImagePage'].includes(m.propose?.action?.type)
        ? { ...m, done: true, propose: null, text: 'Cadangan display dikemas kini mengikut arahan terkini.' } : m))
    }
    if (propose.action?.ids?.length) lastTarget.current = propose.action
    if (['removeBackground', 'adjustPhoto'].includes(propose.action?.type)) {
      setBusy(true)
      try {
        const result = propose.action.type === 'adjustPhoto'
          ? { dataUrl: await adjustPhoto(propose.action.value, propose.action.operation, propose.action.angle) }
          : await processBackground(propose.action.value, { force: true, jobId: activityJob.current })
        const cleaned = result.dataUrl
        say({ who: 'bot', source, text: '', propose: {
          ...propose,
          preview: cleaned,
          detail: result.skipped
            ? 'The background is already light, so I kept the original photo. Nothing changes until you click Apply.'
            : propose.action.type === 'removeBackground'
              ? `Produk sahaja diasingkan. ${result.light ? 'Produk cerah diberi latar gelap supaya jelas.' : 'Latar belakang telus dikekalkan.'} Semak hasil sebelum Apply.`
              : 'Gambar telah diproses. Semak hasil ini, kemudian klik Apply untuk simpan.',
          action: { ...propose.action, value: cleaned },
        } })
      } catch (e) {
        say({ who: 'bot', source, text: `I could not remove that background: ${e.message}. The catalogue was not changed.` })
      } finally {
        setBusy(false)
      }
    } else {
      say({ who: 'bot', source, text: '', propose })
    }
  }

  const ask = async question => {
    const text = question.trim()
    // Upload alone never starts image processing.
    if (!text || busy) return
    activityJob.current = beginActivity('bot.command', text, { category: category.id })
    setQ(''); setShowHelp(false)
    say({ who: 'you', text })

    // 1. A command? Data-changing ones are proposed, never done.
    displayContext.current ??= recentImageContext(items)
    const activeAttachment = attachment ? (attachment.useClean && attachment.clean ? attachment.clean : attachment.raw) : null
    // Object removal must reach the image editor before the product-delete parser.
    if (activeAttachment && !/\b(jangan|bukan|do not|don't)\b/i.test(text) && !isDisplayRequest(text, true) && /\b(hand|hands|finger|fingers|tangan|jari|retouch|only keep|keep only|kekalkan sahaja|buang orang|remove person)\b/i.test(text)) {
      await editAttachment(text, activeAttachment)
      return
    }
    const previous = lastTarget.current
    const hasName = items.some(p => p.name && text.toLowerCase().includes(p.name.toLowerCase()))
    const contextText = !isImageRemovalRequest(text) && !isDisplayConversation(text, displayContext.current) && !isRemoveDisplayRequest(text) && !(activeAttachment && /\b(background|latar belakang)\b/i.test(text)) && !isDisplayRequest(text, Boolean(activeAttachment)) && !hasName && previous && items.some(p => p.id === previous.ids[0]) &&
      /\b(it|this|that|dia|ni|ini|tu|itu|gambar|photo|background|cerahkan|gelapkan|rotate|flip)\b/i.test(text)
      ? `${text} ${previous.label} ${previous.match ?? ''}` : text
    const cmd = parseCommand(contextText, items, category, findings, catalogues, activeAttachment, attachment?.raw, displayContext.current)
    const semanticReview = needsSemanticReview(text, cmd)
    // A local clarification is a hint for the interpreter, not a dead end. The
    // model receives conversation context and proposes only validated actions.
    let interpretationReady = true
    if (cmd?.reply || semanticReview) {
      setBusy(true)
      try {
        const status = await fetch(apiUrl('/api/ai/status')).then(response => response.json())
        interpretationReady = Boolean(status.ready ?? status.openai)
      } catch { interpretationReady = false }
      if (!interpretationReady) { setBusy(false); say({ who: 'bot', source: 'local', text: cmd?.reply ?? 'Arahan ini mempunyai beberapa syarat dan memerlukan tafsiran AI. Sambungan AI belum tersedia; tiada perubahan dibuat.' }); return }
    }
    if (!semanticReview && cmd?.propose) { await presentPropose(cmd.propose, 'local'); return }
    if (!semanticReview && cmd?.run) { runSafe(cmd.run); return }

    // 2. Answerable from the data alone? Never leaves the browser.
    const local = answerLocally(text, items, category)
    if (local && !semanticReview && !cmd?.reply && !cmd?.needsInterpret) { say({ who: 'bot', ...local }); return }

    // 3. Neither a known command nor a rule-answerable question — only now is
    // anything sent anywhere, and only text, never the photo itself. The AI's
    // one job for a command is to rewrite it into the exact phrasing the LOCAL
    // parser already knows; running that rewrite back through parseCommand means
    // every safety rule still applies — a destructive command still waits for
    // Apply, and a product the AI got wrong is simply not found, same as today.
    setBusy(true)
    try {
      const res = await fetch(apiUrl('/api/interpret'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...activityHeaders(activityJob.current) },
        body: JSON.stringify(interpreterPayload({ text, items, category, log,
          hasAttachment: Boolean(activeAttachment), findings, context: displayContext.current, localReply: cmd?.reply, catalogues })),
      })
      const data = await res.json()
      if (data.error) { say({ who: 'bot', text: `That failed: ${data.error}` }); return }

      if (data.kind === 'catalogue_intent') {
        const result = resolveCatalogueIntent(data, { items, category, attachment: attachment?.raw, context: displayContext.current, text, catalogues, findings })
        if (result.propose) await presentPropose(result.propose, 'ai')
        else if (result.run) runSafe(result.run)
        else say({ who: 'bot', source: 'ai', text: result.reply ?? 'Nyatakan sasaran atau pilihan yang belum jelas.' })
        return
      }

      if (data.kind === 'display_intent') {
        const planned = resolveInterpretedIntent(data, { items, category, attachment: attachment?.raw, context: displayContext.current, text })
        if (planned.propose) await presentPropose(planned.propose, 'ai')
        else say({ who: 'bot', source: 'ai', text: planned.reply ?? 'Produk/siri sasaran belum jelas. Nyatakan sasaran display ini.' })
        return
      }

      if (data.kind === 'image_edit') {
        if (!activeAttachment) { say({ who: 'bot', text: 'Lampirkan gambar yang hendak diedit dahulu.' }); return }
        await editAttachment(data.text, activeAttachment)
        return
      }

      if (data.kind === 'command') {
        if (isImageRemovalRequest(text)) {
          const removal = proposeImageRemoval(text, items, category, attachment?.raw, displayContext.current)
          if (removal.propose) await presentPropose(removal.propose, 'ai')
          else say({ who: 'bot', source: 'ai', text: removal.reply })
          return
        }
        const rewritten = parseCommand(data.text, items, category, findings, catalogues, activeAttachment, attachment?.raw, displayContext.current)
        if (rewritten?.reply) { say({ who: 'bot', source: 'ai', text: rewritten.reply }); return }
        if (rewritten?.propose) { await presentPropose(rewritten.propose, 'ai'); return }
        if (rewritten?.run) { runSafe(rewritten.run); return }
        say({ who: 'bot', source: 'ai', text: "I thought I understood that, but it did not match anything I can do — could you say it a different way?" })
        return
      }
      say({ who: 'bot', source: 'ai', text: data.text })
    } catch (e) {
      say({ who: 'bot', text: `Could not reach the server: ${e.message}` })
    } finally {
      setBusy(false)
    }
  }

  const editAttachment = async (instruction, image) => {
    setBusy(true)
    say({ who: 'bot', text: 'AI sedang menyunting gambar. Ini mungkin mengambil beberapa minit…' })
    try {
      const response = await fetch(apiUrl('/api/image/edit'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...activityHeaders(activityJob.current) },
        body: JSON.stringify({ image, instruction }), signal: AbortSignal.timeout(250_000),
      })
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || 'Image edit failed')
      say({ who: 'bot', source: 'ai', propose: {
        summary: 'Hasil edit gambar', preview: data.image,
        detail: 'Semak bentuk, warna dan bahagian produk yang sebelum ini terlindung. Apply memilih hasil ini sebagai lampiran untuk katalog.',
        action: { type: 'editAttachment', value: data.image },
      } })
    } catch (e) { say({ who: 'bot', text: `Gambar belum diedit: ${e.message}` }) }
    finally { setBusy(false) }
  }

  // Clicking a suggestion FILLS the box rather than firing it, so every command is
  // read before it is sent.
  const suggest = phrase => {
    setQ(phrase)
    setShowHelp(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <>
      {open && (
        <div className="bot-dock" role="dialog" aria-label="Catalogue assistant">
          <header className="bot-head">
            <Avatar size={26} />
            <div>
              <b>Catalogue assistant</b>
              <span>{category?.title ?? 'No catalogue open'} — {summary.text}</span>
            </div>
            <button className="bot-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </header>

          <div className="bot-log" ref={boxRef}>
            {log.length === 0 && !showHelp && (
              <div className="bot-msg bot-msg--bot">
                Ask me about this catalogue, press <b>Quality check</b>, or tell me what to do.
                <span className="bot-src">
                  Press <b>What can I say?</b> for the full list. Nothing in your catalogue is
                  changed unless you click Apply.
                </span>
              </div>
            )}

            {showHelp && (
              <div className="bot-help">
                {COMMAND_HELP.map(g => (
                  <div key={g.group} className="bot-help-group">
                    <b>{g.group}</b>
                    <span>{g.note}</span>
                    <div className="bot-help-items">
                      {g.items.map(it => (
                        <button key={it} className="chip" onClick={() => suggest(it)}>{it}</button>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="bot-help-foot">
                  Clicking one puts it in the box — it is not sent until you press Send.
                </p>
              </div>
            )}

            {log.map((m, i) => (
              <div key={i} className={`bot-msg bot-msg--${m.who}`}>
                {m.text && <span className="bot-text">{m.text}</span>}

                {m.propose && (
                  <div className={`proposal ${m.propose.danger ? 'proposal--danger' : ''}`}>
                    <b>{m.propose.summary}</b>
                    {/* Seeing the actual photo before clicking Apply is the real
                        safeguard here — there is no name or code to double-check
                        against, only the picture itself. */}
                    {m.propose.preview && <img className="thumb thumb--sm" src={m.propose.preview} alt="" />}
                    <p>{m.propose.detail}</p>
                    {m.done ? (
                      <span className="proposal-done">Done.</span>
                    ) : (
                      <div className="proposal-acts">
                        <button className={m.propose.danger ? 'danger' : 'primary'}
                                disabled={busy}
                                onClick={() => apply(i, m.propose.action)}>
                          {m.propose.danger ? 'Yes, delete it' : 'Apply'}
                        </button>
                        <button onClick={() => { activityStatus(m.activityJobId, 'not-applied'); setLog(prev => prev.map((x, k) => (k === i ? { ...x, done: true, text: 'Left as it was.' , propose: null } : x))) }}>
                          No, leave it
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {m.qc && (
                  <ul className="qc-list">
                    {m.qc.map((f, k) => (
                      <li key={k} className={`qc-item qc-item--${f.level}`}>
                        <span className="qc-tag">
                          {f.level === 'error' ? 'fix' : f.level === 'warn' ? 'check' : 'note'}
                        </span>
                        <div>
                          <b>{f.title}</b>
                          <p>{f.detail}</p>
                          <div className="qc-acts">
                            {f.ids.length > 0 && actions.onReveal && (
                              <button className="link" onClick={() => { actions.onReveal(f.ids); setOpen(false) }}>
                                show {f.ids.length === 1 ? 'it' : `these ${f.ids.length}`}
                              </button>
                            )}
                            {/* Answering the check by clicking, for when typing
                                "PV18 and PV18N are correct" is more effort than it
                                is worth. Same result, same memory. */}
                            <button className="link" onClick={() => runSafe({ type: 'accept', key: f.key, label: f.title })}>
                              mark as correct
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {m.undo && !m.undone && (
                  <button className="link" onClick={() => {
                    actions.onUnaccept?.(m.undo)
                    activityStatus(m.activityJobId, 'undone')
                    setLog(prev => prev.map((x, k) => (k === i ? { ...x, undone: true } : x)))
                  }}>undo</button>
                )}
                {m.undone && <span className="bot-src">put back — it will be checked again</span>}

                {m.who === 'bot' && m.source === 'local' && !m.propose && !m.undo && <span className="bot-src">from your data</span>}
                {m.who === 'bot' && m.source === 'ai' && <span className="bot-src">answered by AI</span>}
              </div>
            ))}

            {busy && <div className="bot-msg bot-msg--bot bot-thinking" role="status">Sedang memahami arahan…</div>}
          </div>

          <div className="bot-tools">
            <button className={`qc-btn qc-btn--${summary.level}`} onClick={() => runCheck()}>
              Quality check{problems > 0 && <span className="qc-count">{problems}</span>}
            </button>
            <button className={`chip chip--help ${showHelp ? 'chip--on' : ''}`}
                    onClick={() => setShowHelp(v => !v)}>
              What can I say?
            </button>
            {QUICK.map(e => <button key={e} className="chip" onClick={() => ask(e)}>{e}</button>)}
          </div>

          {attachment && (
            <div className="bot-attachment">
              <img className="thumb thumb--sm" src={attachment.useClean && attachment.clean ? attachment.clean : attachment.raw} alt="" />
              <div className="bot-attachment-info">
                <span>{attachment.name}</span>
                {bgBusy ? (
                  <span className="bot-src">removing background…</span>
                ) : attachment.clean && (
                  <button className="link" onClick={() => setAttachment(a => ({ ...a, useClean: !a.useClean }))}>
                    {attachment.useClean ? 'keep the original photo instead' : 'use the cleaned version'}
                  </button>
                )}
              </div>
              <button className="bot-x" onClick={() => setAttachment(null)} aria-label="Remove attachment">✕</button>
            </div>
          )}

          <form className="bot-ask" aria-busy={busy} onSubmit={e => { e.preventDefault(); ask(q) }}>
            <input className="bot-photo-input" type="file" accept="image/*" ref={fileRef}
                   style={{ display: 'none' }} onChange={pickAttachment} />
            <button type="button" className="chip" title="Attach a photo" aria-label="Attach a photo"
                    onClick={() => fileRef.current?.click()}>📎</button>
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                   placeholder="Ask, or tell me what to do…" />
            <button className="primary" type="submit" disabled={busy || !q.trim()}>Send</button>
          </form>
        </div>
      )}

      <button className={`bot-bubble ${open ? 'bot-bubble--open' : ''}`}
              onClick={() => setOpen(v => !v)}
              title="Catalogue assistant" aria-label="Catalogue assistant">
        <Avatar size={34} />
        {!open && problems > 0 && <span className="bot-badge">{problems}</span>}
      </button>
    </>
  )
}
