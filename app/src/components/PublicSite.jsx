import React, { useEffect, useState } from 'react'
import Catalogue from './Catalogue.jsx'
import { resolveCategory } from '../lib/resolveCategory.js'
import { apiUrl } from '../lib/api.js'

// The public, read-only face of a catalogue. No store, no bot, no edit
// affordances — `Catalogue.jsx` is rendered exactly the way the admin editor and
// the PDF export already render it (`editable` defaults to false), so this page
// can never visually drift from what the admin last published.
//
// No `id` in the query string: list every published catalogue. `id` present:
// fetch and render that one snapshot.
export default function PublicSite() {
  const id = new URLSearchParams(location.search).get('id')
  const [list, setList] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setError('')
    setSnapshot(null)
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
        .then(data => { if (alive) setSnapshot(data) })
        .catch(e => { if (alive) setError(e.message) })
    }
    return () => { alive = false }
  }, [id])

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

  const category = resolveCategory(snapshot.categoryId, snapshot.chrome)
  return (
    <div className="public-site">
      {header}
      <main className="ps-main">
        <div className="ps-doc-head"><h1>{snapshot.title ?? snapshot.categoryId}</h1></div>
        <div className="ps-pages-scroll">
          <div className="ps-pages">
            <Catalogue categoryId={snapshot.categoryId} category={category} products={snapshot.products} />
          </div>
        </div>
      </main>
    </div>
  )
}
