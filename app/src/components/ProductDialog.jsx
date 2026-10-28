import React, { useState } from 'react'
import { TYPE_B, blankFinish } from '../lib/model.js'
import { getCategory } from '../lib/categories/index.js'
import { processBackground } from '../lib/bgremove.js'
import { beginActivity, recordImageUpload, activityStatus } from '../lib/activity.js'

// One dialog for every category. The field list comes from the category
// (`fields(product)`), so adding a category does not mean adding a dialog.
//
// A dimension drawing carries real millimetre measurements. The AI must never
// invent one, so Save stays disabled until the admin supplies the file.

const readFile = file => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(r.result)
  r.onerror = rej
  r.readAsDataURL(file)
})

const defaultMake = () => blankFinish()

export default function ProductDialog({ categoryId, category: given, initial, onSave, onCancel }) {
  const [p, setP] = useState(initial)
  // The open category is passed in. Looking it up by id here was wrong: a family
  // with no bespoke template is not in the static registry, and `getCategory` falls
  // back to the LED category for anything it does not know — so every add and edit
  // in a sheet catalogue opened the LED form, asking for a colour, a length and a
  // dimension drawing that those products do not have.
  const category = given ?? getCategory(categoryId)
  const configuredFields = category.fields(p)
  const fields = p.sourceReferences?.length && !configuredFields.some(f=>f.key==='sourceReferenceImages')
    ? [...configuredFields,{key:'sourceReferenceImages',label:'Rujukan sumber untuk semakan',type:'gallery'}] : configuredFields
  const set = (k, v) => setP(prev => ({ ...prev, [k]: v,
    ...(k === 'drawing' ? { drawingPresentation: '', dimensionText: '', dimensionReferenceKind: null } : {}),
    ...(k === 'photoTreatmentMode' && v === 'preserve-scene' && prev.photoOriginal ? { photo: prev.photoOriginal, photoTreatment: 'original-scene-v1' } : {}),
  }))

  // Changing a LED product's type swaps which fields apply.
  const setType = t => setP(prev => ({
    ...prev, type: t, finishes: t === TYPE_B ? (prev.finishes ?? [blankFinish()]) : undefined,
  }))

  const pick = async (e, apply) => {
    const f = e.target.files?.[0]
    if (f) {
      const jobId = recordImageUpload(f, `product-dialog:${p.name || categoryId}`)
      try { apply(await readFile(f)); activityStatus(jobId, 'attached-original') }
      catch (error) { activityStatus(jobId, 'failed', error.message); throw error }
    }
    e.target.value = ''
  }

  // Background removal runs entirely in the browser (see lib/bgremove.js) — keyed
  // per field (or per finish, by id) so cleaning one photo does not disable the
  // others. Only ever offered for an actual PRODUCT PHOTO: a dimension drawing is
  // line art, not a picture with a background to strip.
  const [bgBusy, setBgBusy] = useState(new Set())
  const [bgError, setBgError] = useState({})
  const isPhotoField = key => key === 'photo' || key === 'extra'
  const cleanBackground = async (key, dataUrl, apply) => {
    const jobId = beginActivity('image.edit', `Remove background: ${p.name || categoryId} / ${key}`)
    setBgBusy(prev => new Set(prev).add(key))
    setBgError(prev => ({ ...prev, [key]: null }))
    try {
      const result = await processBackground(dataUrl, { jobId })
      apply(result.dataUrl)
      activityStatus(jobId, 'prepared-for-save')
      if (result.skipped) setBgError(prev => ({ ...prev, [key]: 'Background is already light, so the original photo was kept.' }))
    } catch (e) {
      activityStatus(jobId, 'failed', e.message)
      setBgError(prev => ({ ...prev, [key]: `Could not remove the background: ${e.message}` }))
    } finally {
      setBgBusy(prev => { const next = new Set(prev); next.delete(key); return next })
    }
  }

  const setItem = (listKey, id, patch) =>
    set(listKey, (p[listKey] ?? []).map(it => (it.id === id ? { ...it, ...patch } : it)))

  const missing = fields.flatMap(f => {
    if (f.type === 'list') {
      const list = p[f.key] ?? []
      if (f.requireOne && !list.some(it => it[f.requireOne])) {
        return [`at least one ${f.label.toLowerCase()} needs a photo`]
      }
      return []
    }
    if (!f.required) return []
    return p[f.key] ? [] : [f.label.toLowerCase()]
  })

  const renderField = f => {
    if (f.type === 'select') {
      return (
        <label key={f.key}>{f.label}
          <select value={p[f.key]} onChange={e => (f.key === 'type' ? setType(e.target.value) : set(f.key, e.target.value))}>
            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      )
    }
    if (f.type === 'text') {
      return (
        <label key={f.key}>{f.label} {f.hint && <span className="hint">{f.hint}</span>}
          <input value={p[f.key] ?? ''} placeholder={f.placeholder}
                 onChange={e => set(f.key, e.target.value)} />
        </label>
      )
    }
    if (f.type === 'image') {
      return (
        <label key={f.key}>{f.label} {f.hint && <span className="hint">{f.hint}</span>}
          <input type="file" accept="image/*" onChange={e => pick(e, v => {
            set(f.key, v)
            if (isPhotoField(f.key)) setP(prev => ({ ...prev, [`${f.key}Original`]: v }))
          })} />
          {p[f.key] && <img className="thumb" src={p[f.key]} alt="" />}
          {isPhotoField(f.key) && p[`${f.key}Original`] && (
            <button type="button" className="link" onClick={() => setP(prev => ({
              ...prev, [f.key]: prev[`${f.key}Original`],
              ...(f.key === 'photo' ? { photoTreatmentMode: 'preserve-scene', photoTreatment: 'original-scene-v1' } : {}),
            }))}>Restore original rectangular photo</button>
          )}
          {isPhotoField(f.key) && p[f.key] && (
            <div className="bg-remove">
              <button type="button" className="link" disabled={bgBusy.has(f.key)}
                      onClick={() => cleanBackground(f.key, p[f.key], v => set(f.key, v))}>
                {bgBusy.has(f.key)
                  ? 'AI sedang mengasingkan produk…'
                  : 'Asingkan produk sahaja (AI)'}
              </button>
              {bgError[f.key] && <span className="warn">{bgError[f.key]}</span>}
            </div>
          )}
        </label>
      )
    }
    if (f.type === 'gallery') {
      const list = f.key === 'exampleImages' ? (p.examples ?? []).map(e => e.image) : f.key === 'sourceReferenceImages' ? (p.sourceReferences ?? []).map(e=>e.image) : p[f.key] ?? []
      if (!list.length) return null
      return (
        <div key={f.key} className="gallery-field">
          <span>{f.label}</span>
          <div className="gallery-grid">
            {list.map((src, i) => <img key={i} className="thumb thumb--sm" src={src} alt="" />)}
          </div>
        </div>
      )
    }
    if (f.type === 'list') {
      const list = p[f.key] ?? []
      const make = f.make ?? defaultMake
      return (
        <div className="finishes-edit" key={f.key}>
          <div className="fe-head">
            <span>{f.label}</span>
            <button onClick={() => set(f.key, [...list, make()])}>+ add</button>
          </div>
          {list.map(it => (
            <div className="fe-row" key={it.id}>
              {f.itemFields.map(itf => itf.type === 'image' ? (
                <input key={itf.key} type="file" accept="image/*"
                       onChange={e => pick(e, v => setItem(f.key, it.id, { [itf.key]: v }))} />
              ) : (
                <input key={itf.key} value={it[itf.key] ?? ''} placeholder={itf.placeholder}
                       style={itf.width ? { maxWidth: itf.width } : undefined}
                       onChange={e => setItem(f.key, it.id, { [itf.key]: e.target.value })} />
              ))}
              {it.photo && <img className="thumb thumb--sm" src={it.photo} alt="" />}
              {it.photo && (
                <button type="button" className="link" disabled={bgBusy.has(`${f.key}:${it.id}`)}
                        onClick={() => cleanBackground(`${f.key}:${it.id}`, it.photo, v => setItem(f.key, it.id, { photo: v }))}>
                  {bgBusy.has(`${f.key}:${it.id}`) ? '…' : 'clean bg'}
                </button>
              )}
              <button className="danger" onClick={() => set(f.key, list.filter(x => x.id !== it.id))}>✕</button>
            </div>
          ))}
        </div>
      )
    }
    return null
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{category.kindLabel?.(p) === 'full page'
          ? (initial.image ? 'Edit page' : 'Add a full page')
          : (initial.name ? 'Edit product' : 'Add product')}</h2>
        {fields.map(renderField)}

        {missing.length > 0 && (
          <p className="warn">Still needed: {missing.join(', ')}.</p>
        )}

        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={missing.length > 0 || bgBusy.size > 0} onClick={() => onSave(p)}>Save</button>
        </div>
      </div>
    </div>
  )
}
