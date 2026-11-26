import React, { useEffect, useRef, useState } from 'react'
import { TYPE_A, TYPE_B } from '../lib/model.js'
import { reconcile, applyReconcile } from '../lib/reconcile.js'
import { apiUrl } from '../lib/api.js'
import { beginActivity, activityStatus, activityHeaders, recordImageUpload } from '../lib/activity.js'
import { processBackground } from '../lib/bgremove.js'
import { finishProductPhoto } from '../lib/product-photo.js'
import { assessBackgroundRemoval } from '../lib/image-quality.js'
import { repairLegacyAccessoriesProducts } from '../lib/repair-known-source.js'

// Upload a catalogue PDF -> the AI reads it -> YOU review what it found -> it is added.
//
// The review step is deliberate. Extraction is very good but never guaranteed, and
// a catalogue is a published document. One pass by a human turns a good extraction
// into a correct one, and it costs seconds.

const referenceLabel = reason => ({
  'original-product-card':'Gambar produk asal',
  'dimension-reference':'Rujukan ukuran',
  'Image ownership could not be confirmed':'Padanan gambar belum dapat disahkan',
}[reason] || reason)

/** The grouping key used while a brand-new catalogue has no id yet. */
const NEW = '__new__'

/** A catalogue name out of a file name: "PU Stone ( Jan 2026 ).pdf" -> "PU Stone". */
const titleFromFile = name => String(name ?? '')
  .replace(/\.[a-z0-9]+$/i, '')
  .replace(/[([][^)\]]*[)\]]/g, ' ')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

/** "PU Stone" -> "pu-stone", so a created catalogue has a stable key. */
const slugOf = title => String(title ?? '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)

const readImageFile = file => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(r.result)
  r.onerror = rej
  r.readAsDataURL(file)
})

// A re-import must be able to replace a previously extracted photo/drawing.
// Reconciliation still matches by product name, but keeping `useDraft` empty
// would silently keep the old (possibly damaged) media forever.  Text edits are
// still shown for review; this helper only opts products with fresh media into
// the PDF version by default.
const hasMedia = p => Boolean(
  p?.photo || p?.drawing ||
  (p?.finishes ?? p?.variants ?? []).some(f => f?.photo || f?.drawing),
)

export default function IngestDialog({ existingByCategory, intoCategory, catalogues = [], targetChosen = false, onCommit, onCancel }) {
  const [phase, setPhase] = useState('pick')      // pick | working | review | error
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState([])
  const [warnings, setWarnings] = useState([])
  const [status, setStatus] = useState(null)
  const [plan, setPlan] = useState(null)        // reconciliation against what is already here
  const [useDraft, setUseDraft] = useState(new Set())
  const [skipAdded, setSkipAdded] = useState(new Set())
  const [dropMissing, setDropMissing] = useState(new Set())
  const [chrome, setChrome] = useState(null)   // page header lifted from the PDF
  const [routing, setRouting] = useState(null)
  // Where the generic drafts will go. Suggested by the reading, settled by the admin.
  const importTarget = targetChosen ? intoCategory : null
  const [destination, setDestination] = useState(importTarget ?? NEW)
  const [newTitle, setNewTitle] = useState('')
  const creating = destination === NEW
  const fileRef = useRef(null)
  // Reading a big catalogue takes minutes. Aborting the request also tells the
  // server to stop: it watches for the connection closing, so an abandoned import
  // stops holding the one OCR worker.
  const abortRef = useRef(null)
  const ingestJobRef = useRef(null)
  const activityJob = useRef(null)

  useEffect(() => {
    fetch(apiUrl('/api/ingest/status'))
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ ready: true, aiFallback: false, localReaders: [] }))
  }, [])

  /**
   * Which catalogue each draft belongs to, given the chosen destination.
   *
   * LED and PVC Marble are layouts inside the same Accessories catalogue. Reader
   * shape still controls their review fields, but never creates child catalogues.
   */
  const groupBy = (found, destId) => {
    const byCat = {}
    for (const d of found) {
      // Unknown-layout AI drafts must wait for routing. Treating every draft
      // without a built-in shape as LED used to put mirror/showroom products in
      // the wrong catalogue before the destination suggestion was applied.
      const own = d.categoryId ?? null
      const requested = ['accessories-led', 'pvc-marble'].includes(destId) ? 'accessories' : destId
      // Only the two legacy Accessories child layouts share the Accessories
      // destination. Other authoritative built-in catalogues (Acoustic Panel,
      // PVC Marble Sheet, Wainscoting, etc.) must keep their own category ID.
      const cat = ['accessories-led', 'pvc-marble'].includes(own)
        ? 'accessories'
        : (requested || own)
      ;(byCat[cat] ??= []).push({ ...d, categoryId: cat })
    }
    const plans = {}
    for (const [cat, list] of Object.entries(byCat)) {
      // Known Accessories source layouts have a local repair pass. Apply it to
      // fresh drafts as well as saved records: page 6 contains two separate
      // Aluminum End Bend products (5mm and 8mm), while older readers could
      // return one technical-variant record with two finishes. If we repair
      // only on load, re-import review still shows the stale merged draft as a
      // position-matched conflict.
      const repaired = ['accessories', 'carbon-crystal-wall'].includes(cat)
        ? repairLegacyAccessoriesProducts(cat, list)
        : list
      plans[cat] = reconcile(existingByCategory?.[cat] ?? [], repaired)
    }
    return plans
  }

  // Every PDF/image import gets the same local preparation pass before review.
  // It is deliberately limited to product-photo fields: drawings, original PDF
  // pages, usage galleries and installed/context scenes must remain untouched.
  const prepareImportedPhotos = async result => {
    const warnings = [...(result.warnings ?? [])]
    const found = []
    const jobs = []
    for (const source of result.products ?? []) {
      const product = { ...source }
      // Most trusted source crops are deliberately preserved because they can
      // be installed/context scenes or source-declared galleries. PVC Foam
      // Board page 2 is different: its large white-background rectangles are
      // standalone product photos, so they must go through product-only
      // treatment as well.
      const isolatePvcFoamPhoto = product.categoryId === 'pvc-foam-board' && product.sourcePage === 2
      const trustedPdfPhoto = product.readBy === 'rules' && product.sourcePage != null && product.sourceBox && !isolatePvcFoamPhoto
      if (!product.isPage) {
        if (product.photo && !trustedPdfPhoto && !['preserve-scene', 'trusted-source-crop'].includes(product.photoTreatmentMode)) {
          jobs.push({ product, owner: product, key: 'photo', label: `${product.name || 'product'} photo` })
        }
        // An unclassified extra may be an installation scene, instruction or
        // dimension reference. Only an explicitly product-only alternate is safe
        // to isolate automatically; usage/context imagery stays rectangular.
        if (product.extra && ['product', 'alternate-view'].includes(product.extraRole) && product.extraTreatmentMode !== 'preserve-scene') {
          jobs.push({ product, owner: product, key: 'extra', label: `${product.name || 'product'} extra` })
        }
        for (const key of ['finishes', 'variants']) {
          if (Array.isArray(product[key])) {
            product[key] = product[key].map(item => ({ ...item }))
            for (const item of product[key]) if (item.photo && !((product.readBy === 'rules' && product.sourcePage != null && item.sourceBox) || item.photoTreatmentMode === 'preserve-scene')) jobs.push({ product, owner: item, key: 'photo', label: `${product.name || 'product'} ${item.name || 'variant'}` })
          }
        }
      }
      found.push(product)
    }
    if (!jobs.length) return found.map(p => ({ ...p, keep: (p.issues ?? []).length === 0 }))
    for (let i = 0; i < jobs.length; i++) {
      const { product, owner, key, label } = jobs[i]
      setProgress(`Preparing product photos locally — ${i + 1} of ${jobs.length}…`)
      const original = owner[key]
      try {
        const cutout = await processBackground(original, { force: true })
        const quality = await assessBackgroundRemoval(original, cutout.dataUrl)
        // Tighten transparent bounds after segmentation. This removes the old
        // PDF rectangle/margins without changing angle or proportions, and
        // gives light products a neutral contrast background.
        const cleaned = await finishProductPhoto(cutout.dataUrl)
        owner[`${key}Original`] = original
        owner[`${key}Transparent`] = cleaned.dataUrl
        owner[`${key}Quality`] = quality
        owner[`${key}DisplayBackground`] = cleaned.light ? 'dark-neutral' : quality.displayBackground
        if (key === 'photo') owner.photoDisplayBackground = cleaned.light ? 'dark-neutral' : quality.displayBackground
        // A doubtful cutout normally keeps the intact source for review. The
        // known PVC Foam Board product-photo source is explicitly product-only,
        // so its cleaned candidate remains the published photo while the
        // quality findings stay visible in review.
        const forcePvcFoamProductOnly = product.categoryId === 'pvc-foam-board' && product.sourcePage === 2
        owner[key] = quality.needsReview && !forcePvcFoamProductOnly ? original : cleaned.dataUrl
        owner[`${key}Treatment`] = quality.needsReview && !forcePvcFoamProductOnly
          ? 'original-quality-fallback'
          : (forcePvcFoamProductOnly ? 'product-only-local-v2-forced' : 'product-only-local-v2-validated')
        const review = quality.findings.filter(finding => finding.severity !== 'info').map(finding => ({
          ...finding, asset: key, ownerId: owner.id ?? product.id, label,
        }))
        if (review.length) product.photoQualityIssues = [...(product.photoQualityIssues ?? []), ...review]
      } catch (error) {
        const warning = `${label}: background could not be removed automatically — ${error.message}. Original kept for review.`
        warnings.push(warning)
        owner.photoTreatmentErrors = [...(owner.photoTreatmentErrors ?? []), warning]
      }
    }
    result.warnings = warnings
    return found.map(p => ({ ...p, keep: (p.issues ?? []).length === 0 && !(p.photoTreatmentErrors?.length) }))
  }

  const showResult = async result => {
    const found = await prepareImportedPhotos(result)
    setDrafts(found)
    setSkipAdded(new Set(found.filter(p=>p.imageAssociationIssues?.length).map(p=>p.id)))
    setWarnings(result.warnings ?? [])
    setChrome(result.chrome ?? null)
    setRouting(result.routing ?? null)

    // Where it goes, in order of what we actually know:
    //   1. the reading identified a catalogue, confidently    -> that one
    //   2. the admin pressed Import on a particular catalogue -> respect that
    //   3. nothing identified it                              -> offer a NEW one
    //
    // The third case is the point. It used to fall back to whichever catalogue was
    // open, which is how a PU Stone catalogue ended up inside Acoustic Panel.
    const dest = result.routing?.confident
      ? result.routing.suggestedCategoryId
      : (targetChosen && intoCategory ? intoCategory : NEW)
    setDestination(dest)
    setNewTitle(titleFromFile(result.routing?.filename) || '')

    const nextPlan = groupBy(found, dest)
    setPlan(nextPlan)

    // Re-imports are otherwise misleading: the reader produces a corrected
    // image, but applyReconcile keeps the old record unless this checkbox is
    // selected.  Default only the matched records that actually carry media;
    // the administrator can still untick any individual record in the review.
    setUseDraft(new Set(Object.values(nextPlan).flatMap(p =>
      p.matched.filter(m => hasMedia(m.draft) && !m.draft.photoTreatmentErrors?.length && !m.draft.imageAssociationIssues?.length && !m.draft.photoQualityIssues?.length).map(m => m.draft.id))))
    setPhase('review')
  }

  // Changing the destination re-plans the import against THAT catalogue, so the
  // "already in the catalogue / new in this PDF" groups shown below are the ones
  // that will actually apply. Reconciling against the wrong catalogue and then
  // saving somewhere else would make the review screen a decoration.
  useEffect(() => {
    if (phase !== 'review' || !drafts.length) return
    setPlan(groupBy(drafts, destination))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination])

  const start = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    startFile(file)
  }

  const startFile = async file => {
    if (!file) return
    const jobId = beginActivity(file.type.startsWith('image/') ? 'upload.image' : 'upload.pdf', file.name, { bytes: file.size, category: importTarget })
    activityJob.current = jobId

    setPhase('working')
    setProgress('Uploading…')
    const ctl = new AbortController()
    abortRef.current = ctl
    try {
      const isImage = file.type.startsWith('image/')
      const payload = await (isImage ? readImageFile(file) : null)
      const pdfUpload = !isImage
      const res = await fetch(apiUrl(isImage ? '/api/ingest-image' : '/api/ingest-pdf/start'), {
        method: 'POST',
        signal: ctl.signal,
        headers: pdfUpload
          ? { 'Content-Type': 'application/pdf', 'X-Catalogue-Into': importTarget ?? '', 'X-Catalogue-Filename': file.name, 'X-Upload-Bytes': String(file.size), ...activityHeaders(jobId) }
          : { 'Content-Type': 'application/json', ...activityHeaders(jobId) },
        // `into` is the catalogue on screen: where products land when the layout
        // that read them has no category of its own.
        body: pdfUpload
          ? file
          : JSON.stringify({ image: payload.split(',')[1], mime: file.type, into: importTarget ?? null, filename: file.name }),
      })
      if (!res.ok) {
        const type = res.headers.get('content-type') ?? ''
        let detail = res.statusText
        if (type.includes('json')) {
          try { detail = (await res.json()).error ?? detail } catch {}
        } else {
          const text = await res.text()
          if (text.trim()) detail = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
        }
        throw new Error(`Upload failed (${res.status}): ${detail}`)
      }

      if (isImage) {
        await showResult(await res.json())
        return
      }

      // PDF work runs as a server-side job so Render's request timeout cannot
      // turn a valid, slow extraction into a generic 502 page. The initial
      // response only acknowledges the uploaded bytes; progress and the final
      // review payload are fetched through short requests.
      const started = await res.json()
      if (!started.jobId) throw new Error('The server did not return an upload job.')
      ingestJobRef.current = started.jobId
      for (;;) {
        const statusRes = await fetch(apiUrl(`/api/ingest-pdf/jobs/${started.jobId}`), { signal: ctl.signal })
        if (!statusRes.ok) {
          const detail = await statusRes.text().catch(() => '')
          throw new Error(`Upload job failed (${statusRes.status}): ${detail.slice(0, 240)}`)
        }
        const job = await statusRes.json()
        if (job.progress) setProgress(job.progress)
        if (job.status === 'complete') {
          await showResult(job.result)
          break
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
          throw new Error(job.error || 'PDF import was cancelled.')
        }
        await new Promise(resolve => setTimeout(resolve, 900))
      }
      return

      // Newline-delimited JSON: one object per line, streamed as work proceeds.
      //
      // The finished result arrives in PARTS (`{part, i, total}` then `{assembled}`)
      // because it carries every cut image and one 12 MB line does not survive the
      // trip. Anything else on the stream is progress.
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      const parts = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const msg = JSON.parse(line)
          if (msg.error) throw new Error(msg.error)
          if (msg.part != null) {
            parts[msg.i] = msg.part
            if (msg.total > 1) setProgress(`Receiving the result — ${msg.i + 1} of ${msg.total}…`)
            continue
          }
          if (msg.assembled != null) {
            if (parts.filter(p => p != null).length !== msg.assembled) {
              throw new Error(`The result arrived incomplete (${parts.filter(p => p != null).length} of ${msg.assembled} parts).`)
            }
            await showResult(JSON.parse(parts.join('')))
            continue
          }
          if (msg.progress) setProgress(msg.progress)
          if (msg.done) await showResult(msg.done)          // image uploads still reply whole
        }
      }
    } catch (err) {
      // Cancelling is not an error, and must not be reported as one.
      if (err?.name === 'AbortError') { activityStatus(jobId, 'cancelled'); return }
      activityStatus(jobId, 'failed', String(err.message ?? err))
      setError(String(err.message ?? err))
      setPhase('error')
    } finally {
      ingestJobRef.current = null
      abortRef.current = null
    }
  }

  /** Stop reading and leave. The server sees the connection close and gives up too. */
  const cancelRead = () => {
    activityStatus(activityJob.current, 'cancelled-or-review-dismissed')
    const jobId = ingestJobRef.current
    if (jobId) fetch(apiUrl(`/api/ingest-pdf/jobs/${jobId}`), { method: 'DELETE' }).catch(() => {})
    abortRef.current?.abort()
    ingestJobRef.current = null
    abortRef.current = null
    onCancel()
  }

  const patch = (id, changes) => {
    setDrafts(ds => ds.map(d => (d.id === id ? { ...d, ...changes } : d)))
    // Matched drafts are rendered from the reconciliation plan, while new ones
    // are rendered from `drafts`. Keep both views on the same reviewed record.
    setPlan(current => current && Object.fromEntries(Object.entries(current).map(([category, value]) => [category, {
      ...value,
      added: value.added.map(d => d.id === id ? { ...d, ...changes } : d),
      matched: value.matched.map(match => match.draft.id === id
        ? { ...match, draft: { ...match.draft, ...changes } }
        : match),
    }])))
  }

  // Three product shapes now: LED (type A/B, colour, length), PVC (size, series,
  // variants) and the generic shape a user-created category uses (subtitle, third,
  // finishes). Which one it is comes from the reader, not from guessing.
  const BUILTIN_CATS = ['accessories', 'accessories-led', 'pvc-marble']
  const isPvc = d => Array.isArray(d.variants)
  const isGeneric = d => d.productShape === 'generic' || (d.categoryId != null && !BUILTIN_CATS.includes(d.categoryId))

  const recheck = d => {
    if(d.imageAssociationIssues?.length)return ['padanan gambar perlu disemak',...d.imageAssociationIssues.map(referenceLabel)]
    if (d.photoTreatmentErrors?.length) return d.photoTreatmentErrors
    // A page kept whole is never "missing" anything — it IS the page.
    if (d.isPage) return []
    // A drawing is only required where the layout actually has one — a sheet
    // catalogue has a photo and a code, nothing else. The reader says which.
    if (isGeneric(d)) return [
      !d.name && 'no name',
      d.wantsDrawing && !d.drawing && 'no dimension drawing',
      d.variantTechnical && (d.finishes ?? []).some(f => !f.drawing) && 'a variation has no dimension drawing',
      !d.photo && !(d.finishes ?? []).some(f => f.photo) && 'no photos',
    ].filter(Boolean)
    if (isPvc(d)) return [
      !d.name && 'no name',
      !d.drawing && 'no dimension drawing',
      !(d.variants ?? []).some(v => v.photo) && 'no finish photos',
    ].filter(Boolean)
    return [
      !d.name && 'no name',
      !d.drawing && 'no dimension drawing',
      d.type === TYPE_A && !d.photo && 'no product photo',
      d.type === TYPE_B && !(d.finishes ?? []).some(f => f.photo) && 'no finish photos',
    ].filter(Boolean)
  }

  const upload = async (id, field, file, finishId) => {
    if (!file) return
    const jobId = recordImageUpload(file, `import-review:${field || 'finish'}`)
    let data
    try { data = await readImageFile(file); activityStatus(jobId, 'attached-original') }
    catch (error) { activityStatus(jobId, 'failed', error.message); throw error }
    setDrafts(ds => ds.map(d => {
      if (d.id !== id) return d
      if (finishId) {
        const key = Array.isArray(d.variants) ? 'variants' : 'finishes'
        return { ...d, [key]: d[key].map(f => (f.id === finishId ? { ...f, photo: data } : f)) }
      }
      return { ...d, [field]: data,
        ...(field === 'drawing' ? { drawingPresentation: '', dimensionText: '', dimensionReferenceKind: null } : {}),
      }
    }))
  }

  const strip = ({ keep, issues, categoryId, wantsDrawing, _spec, _kind, ...p }) => p

  const commit = async () => {
    // A brand-new catalogue gets its real id here, at the moment it is confirmed.
    // Nothing is created while the admin is still deciding.
    const created = creating
      ? { id: slugOf(newTitle) || `catalogue-${Date.now().toString(36)}`, title: newTitle.trim() }
      : null

    // Hand back a FINAL list per category, already merged and in the PDF's order.
    const result = {}
    for (const [cat, p] of Object.entries(plan ?? {})) {
      // Drafts that still have problems cannot go in, whatever was ticked.
      const blockedIds = new Set(drafts.filter(d => recheck(d).length > 0).map(d => d.id))
      const skip = new Set([...skipAdded, ...p.added.filter(d => blockedIds.has(d.id)).map(d => d.id)])
      const merged = applyReconcile(p, { useDraft:new Set([...useDraft].filter(id=>!blockedIds.has(id))), skipAdded: skip, dropMissing })
      const key = cat === NEW && created ? created.id : cat
      result[key] = merged.map(strip).map(d => ({ ...d, categoryId: key }))
    }
    try {
      setProgress('Saving catalogue…')
      setPhase('working')
      await onCommit(result, chrome, created)
      activityStatus(activityJob.current, 'applied', 'Upload review saved')
    } catch (err) {
      const message = `Catalogue was not saved: ${err.message ?? err}`
      activityStatus(activityJob.current, 'failed', message)
      setError(message)
      setPhase('error')
    }
  }

  // Apply is refused while a new catalogue has no name — an unnamed catalogue
  // cannot be found again, and the admin is the only one who can name it.
  const needsName = creating && !newTitle.trim()

  const toggle = (setter, id) => setter(s => {
    const n = new Set(s)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const plans = Object.entries(plan ?? {})
  const totals = plans.reduce((acc, [, p]) => ({
    added: acc.added + p.added.filter(d => !skipAdded.has(d.id) && recheck(d).length === 0).length,
    matched: acc.matched + p.matched.length,
    missing: acc.missing + p.missing.filter(m => !dropMissing.has(m.id)).length,
    removing: acc.removing + p.missing.filter(m => dropMissing.has(m.id)).length,
  }), { added: 0, matched: 0, missing: 0, removing: 0 })

  // A stray click on the dimmed backdrop must never silently throw away a
  // reviewed import — the admin may have spent minutes checking drafts and
  // typing a catalogue name. Only 'review' has anything to lose; 'pick' and
  // 'error' are one click from where a Cancel would have left them anyway.
  const closeOnBackdrop = () => {
    if (phase === 'working') return
    if (phase === 'review' && !confirm('Discard this review? Nothing has been added to the catalogue yet.')) return
    onCancel()
  }

  return (
    <div className="modal-backdrop" onClick={closeOnBackdrop}>
      <div className="modal modal--wide" onClick={e => e.stopPropagation()}>

        {phase === 'pick' && (
          <>
            <h2>Add products from a PDF or image</h2>
            <p className="lede">
              Upload a catalogue PDF or a product photo. We'll read it and show you
              what was found. <b>Nothing is added until you approve it.</b>
            </p>
            {status && !status.aiFallback && (
              <p className="warn">
                Some files can't be read yet. If this one fails, let an admin know.
              </p>
            )}
            <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={start} />
            <div className="modal-actions">
              <button onClick={onCancel}>Cancel</button>
              <button className="primary" onClick={() => fileRef.current.click()}>
                Choose PDF or image…
              </button>
            </div>
          </>
        )}

        {phase === 'working' && (
          <>
            <h2>Reading your PDF</h2>
            <div className="working">
              <div className="spinner" />
              <p>{progress}</p>
            </div>
            <p className="lede">This takes roughly 20–40 seconds per page.</p>
            {/* A long read must be escapable. Without this a 170 MB catalogue had
                to be waited out, and the only way out was closing the tab. */}
            <div className="modal-actions">
              <button onClick={cancelRead}>Cancel</button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <h2>Could not read that PDF</h2>
            {/* Keep the line breaks: the message carries a per-layout breakdown, and
                collapsing it into one paragraph makes it unreadable. */}
            <p className="warn warn--pre">{error}</p>
            <div className="modal-actions">
              <button onClick={onCancel}>Close</button>
              <button className="primary" onClick={() => setPhase('pick')}>Try another file</button>
            </div>
          </>
        )}

        {phase === 'review' && (
          <>
            <h2>Review what the PDF says</h2>
            <p className="lede">
              The catalogue will be put in <b>the PDF's order</b>. Products already here are
              kept as they are unless you say otherwise; new ones are inserted where the PDF
              puts them. Anything missing a photo or a drawing must be fixed first — a
              dimension drawing is never generated.
            </p>

            <p className="tally-row">
              <span className="pill pill--new">{totals.added} new</span>
              <span className="pill">{totals.matched} already here</span>
              {totals.missing > 0 && <span className="pill pill--miss">{totals.missing} not in this PDF, kept</span>}
              {totals.removing > 0 && <span className="pill pill--drop">{totals.removing} to remove</span>}
            </p>

            {/* WHERE THIS GOES — chosen here, after reading, not before.
                The destination used to be whichever catalogue happened to be open
                when Import was pressed, and this card only reported it. A PDF that
                matched nothing was emptied into an unrelated catalogue with no way
                to say otherwise. Now the reading suggests, and you decide — including
                making a catalogue that does not exist yet. */}
            <div className={`route-card ${routing?.confident ? 'route-card--good' : 'route-card--ask'}`}>
              <b>{routing?.confident ? 'This looks like a catalogue I recognise' : 'Which catalogue is this?'}</b>
              <span>
                {routing?.confident
                  ? 'Change it here if the suggestion is wrong.'
                  : 'Nothing in the file identified it confidently, so choose where it belongs — or make a new catalogue for it.'}
              </span>

              <label className="route-pick">
                Put these products in
                <select value={creating ? '__new__' : destination}
                        onChange={e => setDestination(e.target.value)}>
                  {/* The reading can confidently name a family the admin previously
                      deleted (PU Stone, say) — it is not in `catalogues` any more, so
                      without its own <option> a <select> given a value it cannot find
                      silently shows the FIRST option instead, and the dialog claimed
                      the import was going to whatever catalogue happened to be listed
                      first. Re-importing a deleted family is exactly what un-deletes
                      it on commit, so show it rather than hide the fact. */}
                  {!creating && destination && !catalogues.some(c => c.id === destination) && (
                    <option value={destination}>{routing?.suggestedTitle ?? destination}</option>
                  )}
                  {catalogues.map(c => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                  <option value="__new__">➕ A new catalogue…</option>
                </select>
              </label>

              {creating && (
                <label className="route-pick">
                  Name it
                  <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                         placeholder="PU Stone" />
                </label>
              )}

              {routing?.evidence?.length > 0 && <small>Evidence: {routing.evidence.join(' · ')}</small>}
              {routing?.header && <small>Header read: “{routing.header.slice(0, 140)}”</small>}
            </div>

            {warnings.map((w, i) => <p className="warn" key={i}>{w}</p>)}
            {!drafts.length && <p className="warn">No products were found on that PDF.</p>}

            {plans.map(([cat, p]) => (
              <section className="recon" key={cat}>
                {plans.length > 1 && <h3>{cat === 'pvc-marble' ? 'PVC Marble' : 'Accessories ~ LED'}</h3>}

                {p.matched.length > 0 && (
                  <>
                    <h4>Already in the catalogue — {p.matched.length}</h4>
                    <ul className="recon-list">
                      {p.matched.map(m => (
                        <li key={m.draft.id} className={m.diffs.length ? 'differs' : ''}>
                          <span className="rname">{m.existing.name}</span>
                          {m.ambiguous && <span className="rnote" title="Several products share this name, so they were paired in order">matched by position</span>}
                          {m.diffs.length === 0
                            ? <span className="rsame">no change</span>
                            : (
                              <>
                                <span className="rdiff">
                                  {m.diffs.map(d => `${d.field}: ${d.from || '—'} → ${d.to}`).join(' · ')}
                                </span>
                                <label className="rchoose">
                                  <input type="checkbox" checked={useDraft.has(m.draft.id)}
                                         onChange={() => toggle(setUseDraft, m.draft.id)} />
                                  take the PDF's version
                                </label>
                              </>
                            )}
                          {m.diffs.length === 0 && (
                            <label className="rchoose">
                              <input type="checkbox" checked={useDraft.has(m.draft.id)}
                                     onChange={() => toggle(setUseDraft, m.draft.id)} />
                              refresh images from the PDF
                            </label>
                          )}
                          {m.draft.photoQualityIssues?.length > 0 && <div className="recon-quality">
                            <span>{m.draft.photoQualityIssues.map(issue => issue.message).join(' · ')}</span>
                            {m.draft.photoOriginal && <img src={m.draft.photoOriginal} alt="Original source" />}
                            {m.draft.photo && <img className={m.draft.photoDisplayBackground === 'dark-neutral' ? 'photo-contrast-dark' : undefined} src={m.draft.photo} alt="Proposed result" />}
                            <button type="button" onClick={() => {
                              patch(m.draft.id, { photoQualityIssues: [] })
                              setUseDraft(current => new Set(current).add(m.draft.id))
                            }}>Saya sudah semak asal dan hasil</button>
                          </div>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {p.missing.length > 0 && (
                  <>
                    <h4>Not in this PDF — {p.missing.length}</h4>
                    <p className="lede">
                      These are in your catalogue but the PDF does not mention them. They are
                      <b> kept</b> unless you tick them. They will sit after the products the PDF lists.
                    </p>
                    <ul className="recon-list">
                      {p.missing.map(m => (
                        <li key={m.id}>
                          <span className="rname">{m.name}</span>
                          <label className="rchoose danger-label">
                            <input type="checkbox" checked={dropMissing.has(m.id)}
                                   onChange={() => toggle(setDropMissing, m.id)} />
                            remove from the catalogue
                          </label>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {p.added.length > 0 && <h4>New in this PDF — {p.added.length}</h4>}
              </section>
            ))}

            <div className="drafts">
              {drafts.filter(d => plans.some(([, p]) => p.added.some(a => a.id === d.id))).map(d => {
                const issues = recheck(d)

                // A page kept whole — a cover, an application gallery, a spread of
                // close-up details, the installation steps. There is no product
                // inside it to correct, so it is shown as what it is: the page.
                if (d.isPage) {
                  return (
                    <div className="draft draft--page" key={d.id}>
                      <label className="draft-keep">
                        <input type="checkbox" checked={!skipAdded.has(d.id)} title="keep this page"
                               onChange={() => toggle(setSkipAdded, d.id)} />
                        <span className="pg">p{d.sourcePage}</span>
                      </label>
                      <div className="draft-fields">
                        <input value={d.name} placeholder="label"
                               onChange={e => patch(d.id, { name: e.target.value })} />
                        <span className="dest">kept as a full page</span>
                      </div>
                      <div className="draft-assets">
                        <figure className="plate">
                          {d.image ? <img src={d.image} alt="" /> : <span className="missing">no page image</span>}
                          <figcaption>printed exactly as it is</figcaption>
                        </figure>
                      </div>
                    </div>
                  )
                }

                return (
                  <div className={`draft ${issues.length || d.photoQualityIssues?.length ? 'draft--bad' : ''}`} key={d.id}>
                    <label className="draft-keep">
                      <input type="checkbox" checked={!skipAdded.has(d.id)} title="add this new product"
                             onChange={() => toggle(setSkipAdded, d.id)} />
                      <span className="pg">p{d.sourcePage}</span>
                    </label>

                    <div className="draft-fields">
                      <input value={d.name} placeholder="name" onChange={e => patch(d.id, { name: e.target.value })} />
                      {isGeneric(d) ? (
                        <>
                          <input value={d.subtitle ?? ''} placeholder="second line"
                                 onChange={e => patch(d.id, { subtitle: e.target.value })} />
                          <input value={d.third ?? ''} placeholder="third line"
                                 onChange={e => patch(d.id, { third: e.target.value })} />
                          <span className="dest">new catalogue</span>
                        </>
                      ) : isPvc(d) ? (
                        <>
                          <input value={d.size ?? ''} placeholder="size"
                                 onChange={e => patch(d.id, { size: e.target.value })} />
                          <input value={d.series ?? ''} placeholder="series"
                                 onChange={e => patch(d.id, { series: e.target.value })} />
                          <span className="dest">→ PVC Marble</span>
                        </>
                      ) : (
                        <>
                          <input value={d.colour ?? ''} placeholder={d.type === TYPE_B ? 'default finish' : 'colour'}
                                 onChange={e => patch(d.id, { colour: e.target.value })} />
                          <input value={d.length ?? ''} placeholder="length"
                                 onChange={e => patch(d.id, { length: e.target.value })} />
                          <select value={d.type} onChange={e => patch(d.id, { type: e.target.value })}>
                            <option value={TYPE_A}>standard</option>
                            <option value={TYPE_B}>featured</option>
                          </select>
                        </>
                      )}
                    </div>

                    {d.dimensionText && <label>Ukuran dibaca daripada sumber
                      <input value={d.dimensionText} onChange={e => patch(d.id, { dimensionText: e.target.value })} />
                    </label>}
                    <div className="draft-assets">
                      {(d.sourceReferences ?? []).map((reference,index)=><figure key={`reference-${index}`}>
                        <img src={reference.image} alt="Gambar sumber untuk semakan" />
                        <figcaption>Rujukan sumber: {referenceLabel(reference.reason)}</figcaption>
                      </figure>)}
                      {(d.examples ?? []).map((example, index) => <figure key={`example-${index}`}>
                        <img src={example.image} alt={example.caption || 'Example image'} />
                        <figcaption>{example.role==='usage'?'Contoh penggunaan':'Gambar tambahan'}: {example.caption || index + 1}</figcaption>
                      </figure>)}
                      {(isGeneric(d) || (!isPvc(d) && d.type === TYPE_A)) && (
                        <>
                          {d.photoQualityIssues?.length > 0 && d.photoOriginal && <figure className="quality-original">
                            <img src={d.photoOriginal} alt="Original source" />
                            <figcaption>asal (sentiasa disimpan)</figcaption>
                          </figure>}
                          <figure>
                            {d.photo ? <img src={d.photo} alt="" /> : <span className="missing">no photo</span>}
                            <figcaption>
                              {d.photoTreatment === 'original-quality-fallback' ? 'asal digunakan — cutout ditolak' : 'cadangan transparent'}
                              <input type="file" accept="image/*"
                                     onChange={e => upload(d.id, 'photo', e.target.files?.[0])} />
                            </figcaption>
                          </figure>
                        </>
                      )}
                      <figure>
                        {d.drawing ? <img src={d.drawing} alt="" /> : <span className="missing">no drawing</span>}
                        <figcaption>
                          drawing
                          <input type="file" accept="image/*"
                                 onChange={e => upload(d.id, 'drawing', e.target.files?.[0])} />
                        </figcaption>
                      </figure>
                      {(isPvc(d) ? d.variants : (isGeneric(d) || d.type === TYPE_B) ? d.finishes ?? [] : []).map(f => (
                        <React.Fragment key={f.id}>
                          {d.photoQualityIssues?.some(issue => issue.ownerId === f.id) && f.photoOriginal && <figure className="quality-original">
                            <img src={f.photoOriginal} alt="Original source" />
                            <figcaption>{f.name || 'finish'} — asal</figcaption>
                          </figure>}
                          <figure>
                            {f.photo ? <img src={f.photo} alt="" /> : <span className="missing">no photo</span>}
                            <figcaption>
                              {f.name || 'finish'} — {f.photoTreatment === 'original-quality-fallback' ? 'asal digunakan' : 'transparent'}
                              <input type="file" accept="image/*"
                                     onChange={e => upload(d.id, null, e.target.files?.[0], f.id)} />
                            </figcaption>
                          </figure>
                        </React.Fragment>
                      ))}
                      {(isPvc(d) || isGeneric(d)) && d.extra && (
                        <figure>
                          <img src={d.extra} alt="" />
                          <figcaption>{d.extraRole==='usage'?'Contoh penggunaan':'Gambar tambahan'}</figcaption>
                        </figure>
                      )}
                    </div>

                    {issues.length > 0 && <p className="draft-issues">needs: {issues.join(', ')}</p>}
                    {d.photoQualityIssues?.length > 0 && <p className="draft-issues">gambar asal digunakan: {d.photoQualityIssues.map(issue => issue.message).join(' · ')}</p>}
                    {d.imageAssociationIssues?.length>0 && <button type="button" onClick={()=>{
                      patch(d.id,{imageAssociationIssues:[]})
                      setSkipAdded(current=>{const next=new Set(current);next.delete(d.id);return next})
                    }}>Sahkan produk, kekalkan gambar rujukan</button>}
                    {d.photoQualityIssues?.length>0 && <button type="button" onClick={()=>{
                      patch(d.id,{photoQualityIssues:[]})
                      setSkipAdded(current=>{const next=new Set(current);next.delete(d.id);return next})
                    }}>Saya sudah semak gambar asal dan hasil</button>}
                  </div>
                )
              })}
            </div>

            <div className="modal-actions">
              <span className="tally">
                Result: {totals.matched + totals.added + totals.missing} products, in the PDF’s order
              </span>
              <button onClick={onCancel}>Cancel</button>
              <button className="primary" disabled={!plans.length || needsName} onClick={commit}
                      title={needsName ? 'Give the new catalogue a name first' : undefined}>
                {creating ? `Create “${newTitle.trim() || '…'}” and apply` : 'Apply'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
