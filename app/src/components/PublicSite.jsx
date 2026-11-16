import React, { useEffect, useState } from 'react'
import Catalogue from './Catalogue.jsx'
import ProductDialog from './ProductDialog.jsx'
import BotPanel from './BotPanel.jsx'
import { resolveCategory } from '../lib/resolveCategory.js'
import { upsertSeriesProduct } from '../lib/product-order.js'
import { apiUrl } from '../lib/api.js'

// The public face of a catalogue. `Catalogue.jsx` is rendered exactly the way
// the admin editor and the PDF export already render it (`editable` defaults
// to false), so the catalogue PAGES themselves can never visually drift from
// what the admin last published.
//
// PUBLIC_CATALOGUE_EDIT (server opt-in, off by default) additionally puts the
// SAME "Catalogue assistant" bot here that the admin uses — add/delete
// products, run background-removal/photo edits — reachable by ANY visitor,
// not only the admin. This is a deliberate, explicitly requested exception to
// "the public site is read-only": every edit applied here is immediately
// re-published (same /api/publish/:id the admin's own Publish button calls),
// so it is visible to the next visitor, not just this browser's session. The
// admin's own working copy (IndexedDB, in the admin's browser) is never
// touched by any of this — the worst case is re-publishing from the admin to
// restore what this page shows.
//
// No `id` in the query string: list every published catalogue. `id` present:
// fetch and render that one snapshot.
export default function PublicSite() {
  const id = new URLSearchParams(location.search).get('id')
  const [list, setList] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [products, setProducts] = useState(null)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [botEnabled, setBotEnabled] = useState(false)

  useEffect(() => {
    fetch(apiUrl('/api/ai/status')).then(r => r.json()).then(s => setBotEnabled(Boolean(s.publicCatalogueEdit))).catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    setError('')
    setSnapshot(null)
    setProducts(null)
    setList(null)
    if (!id) {
      fetch(apiUrl('/api/published'))
        .then(res => { if (!res.ok) throw new Error(`Could not load the catalogue list (${res.status}).`); return res.json() })
        .then(data => { if (alive) setList(data) })
        .catch(e => { if (alive) setError(e.message) })
    } else {
      fetch(apiUrl(`/api/published/${encodeURIComponent(id)}`))
        .then(res => {
          if (!res.ok) throw new Error(res.status === 404 ? 'This catalogue is not published.' : `Could not load this catalogue (${res.status}).`)
          return res.json()
        })
        .then(data => { if (alive) { setSnapshot(data); setProducts(data.products ?? []) } })
        .catch(e => { if (alive) setError(e.message) })
    }
    return () => { alive = false }
  }, [id])

  const category = snapshot ? resolveCategory(snapshot.categoryId, snapshot.chrome) : null

  // Re-publishes immediately after every bot-applied edit, so the change is
  // live for the NEXT visitor, not just reflected in this browser tab.
  const persist = async nextProducts => {
    setSaveError('')
    try {
      const res = await fetch(apiUrl(`/api/publish/${encodeURIComponent(snapshot.categoryId)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: nextProducts, chrome: snapshot.chrome ?? null, title: snapshot.title ?? snapshot.categoryId }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch (e) { setSaveError(`Not saved to the live site: ${e.message}`) }
  }

  const applyProducts = updater => {
    setProducts(prev => {
      const next = updater(prev)
      persist(next)
      return next
    })
  }

  const save = p => {
    applyProducts(prev => (category.isDefault ? upsertSeriesProduct(prev, p) : (
      prev.some(x => x.id === p.id) ? prev.map(x => (x.id === p.id ? p : x)) : [...prev, p]
    )))
    setEditing(null)
  }

  const header = (
    <header className="ps-header">
      <a className="ps-brand" href="?" style={{ textDecoration: 'none', color: 'inherit' }}>
        <b>GEOMETRA</b><span>Catalogues</span>
      </a>
      {id && <a className="ps-back" href="?">&larr; All catalogues</a>}
    </header>
  )

  if (error) {
    return (
      <div className="public-site">
        {header}
        <main className="ps-main">
          <div className="ps-state ps-state--error">
            <span className="ps-state-icon">!</span>
            <p>{error}</p>
            {id && <p style={{ marginTop: 10 }}><a href="?">Back to all catalogues</a></p>}
          </div>
        </main>
      </div>
    )
  }

  if (!id) {
    return (
      <div className="public-site">
        {header}
        <main className="ps-main">
          <div className="ps-intro">
            <h1>Our catalogues</h1>
            <p>Browse every catalogue currently published.</p>
          </div>
          {!list ? (
            <div className="ps-state"><p>Loading catalogues…</p></div>
          ) : list.length === 0 ? (
            <div className="ps-state">
              <span className="ps-state-icon">&#128214;</span>
              <p>No catalogue has been published yet.</p>
            </div>
          ) : (
            <div className="ps-grid">
              {list.map(c => (
                <a className="ps-card" key={c.categoryId} href={`?id=${encodeURIComponent(c.categoryId)}`}>
                  <h3>{c.title ?? c.categoryId}</h3>
                  {c.publishedAt && (
                    <p className="ps-date">Updated {new Date(c.publishedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  )}
                  <span className="ps-cta">View catalogue</span>
                </a>
              ))}
            </div>
          )}
        </main>
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="public-site">
        {header}
        <main className="ps-main"><div className="ps-state"><p>Loading…</p></div></main>
      </div>
    )
  }

  return (
    <div className="public-site">
      {header}
      <main className="ps-main">
        <div className="ps-doc-head"><h1>{snapshot.title ?? snapshot.categoryId}</h1></div>
        {saveError && <div className="ps-state ps-state--error" style={{ marginBottom: 16 }}><p>{saveError}</p></div>}
        <div className="ps-pages-scroll">
          <div className="ps-pages">
            <Catalogue categoryId={snapshot.categoryId} category={category} products={products ?? []} />
          </div>
        </div>
      </main>

      {botEnabled && (
        <BotPanel
          items={products ?? []}
          category={category}
          actions={{
            onAddProduct: (name, photo) => {
              const product = { ...category.kinds[0].make(), ...(name ? { name } : {}) }
              const field = category.fields(product).find(f => f.type === 'image' && f.key !== 'drawing')
              if (photo && field) product[field.key] = photo
              setEditing(product)
            },
            onApply: act => {
              if (act.type === 'delete') {
                applyProducts(prev => prev.filter(p => !act.ids.includes(p.id)))
              } else if (act.type === 'rename') {
                applyProducts(prev => prev.map(p => (act.ids.includes(p.id) ? { ...p, name: act.value } : p)))
              } else if (['replacePhoto', 'removeBackground', 'adjustPhoto'].includes(act.type)) {
                applyProducts(prev => prev.map(p => {
                  if (!act.ids.includes(p.id)) return p
                  if (act.targetItemId) {
                    return { ...p, [act.targetKey]: (p[act.targetKey] ?? []).map(it =>
                      (it.id === act.targetItemId ? { ...it, photo: act.value } : it)) }
                  }
                  return { ...p, [act.targetKey]: act.value }
                }))
              }
            },
          }}
        />
      )}
      {editing && (
        <ProductDialog categoryId={snapshot.categoryId} category={category} initial={editing}
                       onSave={save} onCancel={() => setEditing(null)} />
      )}
    </div>
  )
}
