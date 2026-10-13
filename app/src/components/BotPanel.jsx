import React, { useEffect, useMemo, useRef, useState } from 'react'
import { runQc, qcSummary } from '../lib/qc.js'
import { answerLocally, summarise } from '../lib/ask.js'
import { parseCommand, COMMAND_HELP } from '../lib/commands.js'
import { apiUrl } from '../lib/api.js'
import { removeBackground, modelReady } from '../lib/bgremove.js'

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
  // A photo attached for a "replace this product's photo" command: { raw, clean,
  // useClean, name }. `clean` arrives once background removal finishes; until
  // then, or if it fails, `raw` is what a command would use.
  const [attachment, setAttachment] = useState(null)
  const [bgBusy, setBgBusy] = useState(false)
  const boxRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)

  const findings = useMemo(() => runQc(items, category, accepted), [items, category, accepted])
  const summary = qcSummary(findings)
  const problems = findings.filter(f => f.level !== 'info').length

  const say = entry => setLog(prev => [...prev, entry])

  useEffect(() => { boxRef.current?.scrollTo(0, boxRef.current.scrollHeight) }, [log, busy, open, showHelp])

  // What happened after an import is reported back HERE. The assistant starting a
  // job and then saying nothing about how it went is the thing that made it feel
  // like a button rather than an assistant.
  useEffect(() => {
    if (!note?.id) return
    setOpen(true)
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
        actions.onAddProduct?.(act.value)
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
        say({ who: "bot", source: "local", undo: act.key,
          text: `Noted — "${act.label}" is correct. I will not raise it again.` })
      },
    }[act.type]
    call?.()
  }

  const apply = (i, action) => {
    actions.onApply?.(action)
    setLog(prev => prev.map((m, k) => (k === i ? { ...m, done: true } : m)))
    // The attachment has done its job — clear it so the next photo starts clean.
    if (action.type === 'replacePhoto') setAttachment(null)
  }

  // A photo picked via the 📎 button. Background removal runs right away, not
  // on send: seeing the cutout before typing a command is the chance to catch a
  // bad result and keep the original instead, rather than finding out after
  // a product's photo has already been proposed for swapping.
  const pickAttachment = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const raw = await readFile(file)
    setAttachment({ raw, clean: null, useClean: false, name: file.name })
    say({ who: 'you', text: `📎 ${file.name}` })
    setBgBusy(true)
    say({ who: 'bot', source: 'local',
      text: modelReady() ? 'Removing the background…' : 'Loading the background-removal model — this happens once…' })
    try {
      const clean = await removeBackground(raw)
      setAttachment(a => (a && a.raw === raw ? { ...a, clean, useClean: true } : a))
      say({ who: 'bot', source: 'local', text: 'Background removed. Tell me which product this replaces — ' +
        'for example "replace PV07 with this photo".' })
    } catch (err) {
      say({ who: 'bot', text: `Could not remove the background: ${err.message}. ` +
        'I kept the photo as you attached it — tell me which product it replaces and I will use it as is.' })
    } finally {
      setBgBusy(false)
    }
  }

  const runCheck = (quiet = false) => {
    if (!quiet) say({ who: 'you', text: 'Run a quality check' })
    if (!items.length) { say({ who: 'bot', source: 'local', text: 'This catalogue is empty — nothing to check yet.' }); return }
    if (!findings.length) {
      say({ who: 'bot', source: 'local', text: `I checked all ${items.length} item(s). No problems found.` })
      return
    }
    say({ who: 'bot', source: 'local', qc: findings,
      text: `I checked ${items.length} item(s) and found ${findings.length}:` })
  }

  const ask = async question => {
    const text = question.trim()
    if (!text || busy) return
    setQ(''); setShowHelp(false)
    say({ who: 'you', text })

    // 1. A command? Data-changing ones are proposed, never done.
    const activeAttachment = attachment ? (attachment.useClean && attachment.clean ? attachment.clean : attachment.raw) : null
    const cmd = parseCommand(text, items, category, findings, catalogues, activeAttachment)
    if (cmd?.reply) { say({ who: 'bot', source: 'local', text: cmd.reply }); return }
    if (cmd?.propose) { say({ who: 'bot', source: 'local', text: '', propose: cmd.propose }); return }
    if (cmd?.run) { runSafe(cmd.run); return }

    // 2. Answerable from the data alone? Never leaves the browser.
    const local = answerLocally(text, items, category)
    if (local) { say({ who: 'bot', ...local }); return }

    // 3. Only now is anything sent anywhere — and only text.
    setBusy(true)
    try {
      const res = await fetch(apiUrl('/api/ask'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, summary: summarise(items, category) }),
      })
      const data = await res.json()
      say({ who: 'bot', text: data.error ? `That failed: ${data.error}` : data.text, source: data.source })
    } catch (e) {
      say({ who: 'bot', text: `Could not reach the server: ${e.message}` })
    } finally {
      setBusy(false)
    }
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
                                onClick={() => apply(i, m.propose.action)}>
                          {m.propose.danger ? 'Yes, delete it' : 'Apply'}
                        </button>
                        <button onClick={() => setLog(prev => prev.map((x, k) => (k === i ? { ...x, done: true, text: 'Left as it was.' , propose: null } : x)))}>
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
                    setLog(prev => prev.map((x, k) => (k === i ? { ...x, undone: true } : x)))
                  }}>undo</button>
                )}
                {m.undone && <span className="bot-src">put back — it will be checked again</span>}

                {m.who === 'bot' && m.source === 'local' && !m.propose && !m.undo && <span className="bot-src">from your data</span>}
                {m.who === 'bot' && m.source === 'ai' && <span className="bot-src">answered by AI</span>}
              </div>
            ))}

            {busy && <div className="bot-msg bot-msg--bot">Thinking…</div>}
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

          <form className="bot-ask" onSubmit={e => { e.preventDefault(); ask(q) }}>
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
