import React, { useMemo, useRef, useState } from 'react'
import ActivityPanel from './ActivityPanel.jsx'
import HelpPanel from './HelpPanel.jsx'
import { CATEGORIES, parentLabel } from '../lib/categories/index.js'
import { defaultCategoryFor } from '../lib/categories/default.js'
import { runQc } from '../lib/qc.js'

const categoryFor = (id, parent, chrome) =>
  CATEGORIES[id] ?? defaultCategoryFor(parent, chrome)

export default function Dashboard({ parents, byCategory, chromeByCategory, acceptedByCategory, deletedCategories = {}, onOpen, onImport, onExportAll, onResetAll, onExportData, onImportData, filledCount }) {
  const [showActivity, setShowActivity] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const importFileRef = useRef(null)
  const dropImportFile = e => {
    e.preventDefault()
    setDragOver(false)
    const file = [...e.dataTransfer.files].find(f => f.type === 'application/json' || f.name.endsWith('.json'))
    if (file) onImportData?.(file)
  }
  const rows = useMemo(() => parents.flatMap(parent => {
    const ids = (parent.children.length ? parent.children : [parent.id]).filter(id => !deletedCategories[id])
    return ids.map(id => {
      const category = categoryFor(id, parent, chromeByCategory[id])
      const products = byCategory[id] ?? category.seed ?? []
      const items = products.filter(p => !p.isPage)
      // An EMPTY catalogue has no pages. `paginate` always returns at least one so
      // the editor can show a blank sheet to work on, but counting that as a page
      // made every one of the twelve empty families report "0 products, 1 page" —
      // and the headline claimed 15 pages when three existed.
      const pages = products.length ? category.paginate(products).length : 0
      const findings = runQc(products, category, acceptedByCategory[id] ?? [])
      return {
        id, parent, category, products, count: items.length, pages,
        // A catalogue can hold nothing but KEPT PAGES — a cover-only import is a
        // case the system supports on purpose. Counting only products called such a
        // catalogue "Empty" while the combined export included it, so the dashboard
        // and the export disagreed about whether it had anything in it.
        used: products.length > 0,
        errors: findings.filter(f => f.level === 'error').length,
        warnings: findings.filter(f => f.level === 'warn').length,
      }
    })
  }), [parents, byCategory, chromeByCategory, acceptedByCategory, deletedCategories])

  const totals = rows.reduce((out, row) => ({
    products: out.products + row.count,
    pages: out.pages + row.pages,
    filled: out.filled + (row.used ? 1 : 0),
    errors: out.errors + row.errors,
    warnings: out.warnings + row.warnings,
  }), { products: 0, pages: 0, filled: 0, errors: 0, warnings: 0 })

  return (
    <div className="dashboard">
      {showActivity && <ActivityPanel onClose={() => setShowActivity(false)} />}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      <div className="dashboard-head">
        <div>
          <p className="dashboard-kicker">GEOMETRA CATALOGUE AI</p>
          <h1>Catalogue dashboard</h1>
          <p>Overview of every product family and catalogue in this browser.</p>
        </div>
        <div className="dashboard-head-actions">
          <button onClick={() => setShowActivity(true)}>Aktiviti &amp; Kos</button>
          <button onClick={() => setShowHelp(true)}>Bantuan</button>
          <button onClick={() => onExportAll?.()} disabled={!filledCount}>Download all as PDF{filledCount ? ` — ${filledCount} catalogues` : ''}</button>
          {/* "Add catalogue" names NO destination at all. It used to preselect one —
              first a catalogue that already had products, then the first empty one —
              and either way an upload the reader could not identify was emptied into
              a catalogue nobody had chosen. The file is read first, and the review
              screen then asks where it belongs, offering a new catalogue when the
              answer is none of the existing ones. Importing INTO a particular
              catalogue is still the card's own button. */}
          <button className="primary"
                  onClick={() => onImport(null, false)}>
            Upload file
          </button>
        </div>
      </div>

      <div className="dashboard-stats">
        <div className="dashboard-stat"><b>{totals.products}</b><span>products</span></div>
        <div className="dashboard-stat"><b>{totals.filled}</b><span>catalogues in use</span></div>
        <div className="dashboard-stat"><b>{totals.pages}</b><span>pages</span></div>
        <div className={`dashboard-stat ${totals.errors ? 'dashboard-stat--bad' : ''}`}><b>{totals.errors}</b><span>quality errors</span></div>
        <div className={`dashboard-stat ${totals.warnings ? 'dashboard-stat--warn' : ''}`}><b>{totals.warnings}</b><span>quality warnings</span></div>
      </div>

      <div className="dashboard-section-head">
        <h2>Catalogues</h2>
        <span>{rows.length} catalogue{rows.length === 1 ? '' : 's'}</span>
      </div>

      <div className="dashboard-grid">
        {rows.map(row => (
          <article className={`dashboard-card ${row.used ? '' : 'dashboard-card--empty'}`} key={row.id}>
            <div className="dashboard-card-top">
              <div>
                <span className="dashboard-parent">{parentLabel(row.parent)}</span>
                <h3>{row.category.title}</h3>
                <span className="dashboard-edition">{row.category.subtitle ?? row.parent.edition}</span>
              </div>
              <span className={`dashboard-status ${row.used ? 'dashboard-status--on' : ''}`}>
                {row.used ? 'In use' : 'Empty'}
              </span>
            </div>
            <div className="dashboard-card-metrics">
              <span><b>{row.count}</b> product{row.count === 1 ? '' : 's'}</span>
              <span><b>{row.pages}</b> page{row.pages === 1 ? '' : 's'}</span>
            </div>
            {(row.errors || row.warnings) ? (
              <p className="dashboard-health">
                {row.errors > 0 && <b>{row.errors} error{row.errors === 1 ? '' : 's'}</b>}
                {row.errors > 0 && row.warnings > 0 && ' · '}
                {row.warnings > 0 && <span>{row.warnings} warning{row.warnings === 1 ? '' : 's'}</span>}
              </p>
            ) : <p className="dashboard-health dashboard-health--ok">No quality findings</p>}
            <div className="dashboard-card-actions">
              <button className="primary" onClick={() => onOpen(row.id)}>Open catalogue</button>
              <button onClick={() => onImport(row.id, true)}>Upload file</button>
              {row.used && <button onClick={() => onExportData?.(row.id)}>Export</button>}
            </div>
          </article>
        ))}
      </div>

      {/* Catalogue data lives in THIS browser only — localhost and a deployed
          site never share it. This is the bridge between them: download one
          catalogue here (use a card's own "Export" button above — scoped to
          one catalogue, because every photo is stored inline and "everything"
          can run to hundreds of MB), then import that file wherever the admin
          is opened from next (e.g. a live deployment), without re-reading the
          source PDF and losing every manual edit made since. */}
      <div className={`dashboard-danger${dragOver ? ' dashboard-danger--dragover' : ''}`}
           onDragOver={e => { e.preventDefault(); setDragOver(true) }}
           onDragLeave={() => setDragOver(false)}
           onDrop={dropImportFile}>
        <div>
          <h2>Move data to another browser/site</h2>
          <p>Use a catalogue card's own "Export" button above for one catalogue at a time (recommended — stays a reasonable size). "Export data" below bundles every catalogue into one file, which can be very large. Importing replaces only the catalogue(s) the file contains; everything else already here is left alone. Drag a backup .json file anywhere onto this box to import it.</p>
        </div>
        <div className="dashboard-card-actions">
          <button onClick={() => onExportData?.()}>Export data (everything, can be huge)</button>
          <input ref={importFileRef} type="file" accept="application/json" style={{ display: 'none' }}
                 onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImportData?.(f) }} />
          <button onClick={() => importFileRef.current?.click()}>Import data</button>
        </div>
      </div>

      {/* Separated from the everyday actions above — wiping everything is rare
          and deliberate, e.g. before demoing this app to a different company. */}
      <div className="dashboard-danger">
        <div>
          <h2>Danger zone</h2>
          <p>Clears every catalogue in this browser — products, photos, drawings, imported headers and quality-check answers — so it is ready to demo to a different company. Categories stay, empty.</p>
        </div>
        <button className="danger" onClick={() => onResetAll?.()}>Reset all catalogues</button>
      </div>
    </div>
  )
}
