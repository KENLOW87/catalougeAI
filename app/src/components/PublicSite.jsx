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

  if (error) {
    return (
      <main className="public-site">
        <p>{error}</p>
        {id && <p><a href="?">Back to all catalogues</a></p>}
      </main>
    )
  }

  if (!id) {
    return (
      <main className="public-site">
        <h1>GEOMETRA Catalogues</h1>
        {!list ? (
          <p>Loading…</p>
        ) : list.length === 0 ? (
          <p>No catalogue has been published yet.</p>
        ) : (
          <ul>
            {list.map(c => (
              <li key={c.categoryId}>
                <a href={`?id=${encodeURIComponent(c.categoryId)}`}>{c.title ?? c.categoryId}</a>
              </li>
            ))}
          </ul>
        )}
      </main>
    )
  }

  if (!snapshot) return <main className="public-site"><p>Loading…</p></main>

  const category = resolveCategory(snapshot.categoryId, snapshot.chrome)
  return <Catalogue categoryId={snapshot.categoryId} category={category} products={snapshot.products} />
}
