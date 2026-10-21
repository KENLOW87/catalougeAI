import React, { useEffect, useMemo, useState } from 'react'
import Catalogue from './components/Catalogue.jsx'
import ProductDialog from './components/ProductDialog.jsx'
import IngestDialog from './components/IngestDialog.jsx'
import BotPanel from './components/BotPanel.jsx'
import Dashboard from './components/Dashboard.jsx'
import {
  CATEGORIES, CATEGORY_IDS, DEFAULT_CATEGORY, getCategory,
  PARENTS, DEFAULT_PARENT, getParent, parentLabel, parentOfCategory,
} from './lib/categories/index.js'
import { defaultCategoryFor } from './lib/categories/default.js'
import { apiUrl } from './lib/api.js'
import { loadAll, saveCatalogue, saveChrome, saveAccepted, removeCatalogue, markCategoryDeleted, restoreCategory, saveCustomCategory } from './lib/store.js'

const parentById = id => PARENTS.find(p => p.id === id)

// A family with no sub-catalogue is itself a catalogue, so its id doubles as a
// category id. Built-in categories keep their bespoke template; a family without one
// gets the default page, built round the header lifted from its own PDF.
const resolveCategory = (id, chrome, custom = {}) => {
  if (CATEGORIES[id]) return CATEGORIES[id]
  const family = parentById(id) ?? custom[id]
  // A created catalogue has no bespoke template, so it prints on the default page —
  // exactly like the shipped families that have none. Without this it fell through
  // to getCategory(), which returns the LED catalogue for anything it knows nothing
  // about, and a new catalogue would have rendered as LED.
  return family ? defaultCategoryFor(family, chrome) : getCategory(id)
}

/**
 * What the assistant says once an import has been applied.
 *
 * It names the catalogues it landed in, because routing means an upload does not
 * always go where you were standing — and if it went somewhere unexpected, the
 * sentence saying so is the cheapest possible way to notice.
 */
const summariseImport = byCat => {
  const parts = []
  let products = 0, pages = 0
  for (const [id, list] of Object.entries(byCat ?? {})) {
    const title = CATEGORIES[id]?.title ?? parentById(id)?.title ?? id
    const p = list.filter(x => !x.isPage).length
    const g = list.filter(x => x.isPage).length
    products += p; pages += g
    parts.push(`${title}: ${p} product${p === 1 ? '' : 's'}${g ? ` and ${g} kept page${g === 1 ? '' : 's'}` : ''}`)
  }
  if (!parts.length) return { id: `done-${Date.now()}`, text: 'Import applied — nothing changed.' }
  return {
    id: `done-${Date.now()}`,
    qc: true,
    text: `Imported. ${parts.join('; ')}.` +
      (products + pages ? ' I have checked the result — see below.' : ''),
  }
}

/** Every catalogue that holds products, in the order the families are published. */
const catalogueList = (byCategory, chromeByCategory, deleted = {}, custom = {}) => {
  const out = []
  const take = id => {
    if (deleted[id]) return
    const items = byCategory[id] ?? CATEGORIES[id]?.seed ?? []
    if (items.length) out.push({ category: id, products: items, chrome: chromeByCategory[id] ?? null })
  }
  for (const p of [...PARENTS, ...Object.values(custom)]) {
    if (p.children.length) p.children.forEach(take)
    else take(p.id)
  }
  return out
}

export default function App() {
  // Print mode: the PDF exporter loads this same app with ?print=1 so the export is
  // rendered by the very same components the editor uses.
  const params = new URLSearchParams(location.search)
  const print = params.get('print') === '1'

  const [categoryId, setCategoryId] = useState(() => {
    if (print && window.__CATALOGUE_CATEGORY__) return window.__CATALOGUE_CATEGORY__
    const fromUrl = params.get('category')
    if (fromUrl && CATEGORIES[fromUrl]) return fromUrl
    try { return localStorage.getItem('geometra.activeCategory') ?? DEFAULT_CATEGORY } catch { return DEFAULT_CATEGORY }
  })

  // Products are kept per category so switching does not disturb the other one.
  // Reading them back is asynchronous, so nothing may be SAVED until it has been
  // LOADED — see `hydrated` below.
  const [byCategory, setByCategory] = useState(() => {
    if (print && window.__CATALOGUE_DATA__) {
      return { [window.__CATALOGUE_CATEGORY__ ?? DEFAULT_CATEGORY]: window.__CATALOGUE_DATA__ }
    }
    const out = {}
    for (const id of CATEGORY_IDS) out[id] = CATEGORIES[id].seed
    return out
  })

  const [editing, setEditing] = useState(null)
  const [highlight, setHighlight] = useState([])
  const [zoom, setZoom] = useState(0.62)
  const [busy, setBusy] = useState('')
  const [ingesting, setIngesting] = useState(false)
  // What the assistant says once an import it pointed the admin toward has
  // finished. Starting a job and then going silent about it is what made the bot
  // feel like a button; the outcome is reported back into the conversation.
  // Whether the admin aimed this import at a particular catalogue, or just started
  // one. It decides whether an unidentified PDF defaults to that catalogue or to a
  // new one — guessing wrong is how PU Stone ended up inside Acoustic Panel.
  const [targetChosen, setTargetChosen] = useState(false)
  const [botNote, setBotNote] = useState(null)
  const [showDashboard, setShowDashboard] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // The catalogue canvas owns its zoom. Intercept the browser's usual Ctrl +/-
  // shortcut while the editor is open, and keep Ctrl+mouse-wheel available for
  // the same adjustment without changing the browser window's zoom.
  useEffect(() => {
    if (print) return
    const onKeyDown = e => {
      if (!e.ctrlKey && !e.metaKey) return
      const plus = e.key === '+' || e.key === '=' || e.code === 'NumpadAdd'
      const minus = e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract'
      const reset = e.key === '0'
      if (!plus && !minus && !reset) return
      e.preventDefault()
      setZoom(current => reset ? 0.62 : Math.min(1.2, Math.max(0.3, current + (plus ? 0.05 : -0.05))))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [print])

  const zoomWithWheel = e => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    setZoom(current => Math.min(1.2, Math.max(0.3, current + (e.deltaY < 0 ? 0.05 : -0.05))))
  }

  // Which product family is selected. Derived from the open catalogue so the two
  // never disagree; only an empty family is held on its own.
  // Page headers lifted from imported PDFs, one per catalogue.
  const [chromeByCategory, setChromeByCategory] = useState({})

  // Quality-check findings the admin has answered, per catalogue. An answered
  // check must stay answered — through a reload, an edit and the next import.
  const [acceptedByCategory, setAcceptedByCategory] = useState({})
  const [deletedCategories, setDeletedCategories] = useState({})
  // Catalogues the admin created during an import, for PDFs that belong to no
  // family the system ships with.
  const [customCategories, setCustomCategories] = useState({})

  // Nothing is written to storage until what is already stored has been read back.
  // Without this the first render would save an EMPTY catalogue over a full one —
  // which is precisely how an imported catalogue was lost once already.
  const [hydrated, setHydrated] = useState(print)

  useEffect(() => {
    if (print) { setHydrated(true); return }
    let alive = true
    loadAll().then(({ byCategory: saved, chromeByCategory: chromes, acceptedByCategory: accepted, deletedCategories: deleted, customCategories: custom, moved }) => {
      if (!alive) return
      setByCategory(prev => ({ ...prev, ...saved }))
      setChromeByCategory(chromes)
      setAcceptedByCategory(accepted ?? {})
      setDeletedCategories(deleted ?? {})
      setCustomCategories(custom ?? {})
      setHydrated(true)
      if (moved.length) console.log(`[store] moved ${moved.length} record(s) out of localStorage into IndexedDB`)
    }).catch(e => {
      // Better to refuse to save than to save over good data with nothing.
      if (alive) setBusy(`Could not open local storage: ${e.message}. Nothing will be saved — do not import.`)
    })
    return () => { alive = false }
  }, [print])

  const [heldParentId, setHeldParentId] = useState(null)

  // A created catalogue is a family like any other — it simply was not written into
  // parents.js. Appending it here is what makes it appear on the dashboard, in the
  // category dropdown, in the assistant's list and in the combined export, without
  // any of those needing to know it was created rather than shipped.
  const allParents = useMemo(
    () => [...PARENTS, ...Object.values(customCategories)], [customCategories])

  const visibleParents = allParents.filter(p => !deletedCategories[p.id] &&
    (p.children.length === 0 || p.children.some(id => !deletedCategories[id])))

  // The catalogue that was open is remembered across reloads, and it can since have
  // been deleted — so the app would reopen a catalogue that no longer appears on the
  // dashboard. Land on the dashboard instead of inside something that is gone.
  useEffect(() => {
    if (print || !hydrated) return
    if (deletedCategories[categoryId]) {
      setShowDashboard(true)
      setSidebarOpen(false)
    }
  }, [hydrated, deletedCategories, categoryId, print])
  const parent = heldParentId
    ? getParent(heldParentId)
    : (parentOfCategory(categoryId) ?? parentById(categoryId) ?? customCategories[categoryId] ?? getParent(DEFAULT_PARENT))
  const parentId = parent.id
  const siblings = parent.children.filter(id => !deletedCategories[id])

  const pickParent = id => {
    const p = getParent(id)
    setHeldParentId(null)
    // A family with sub-catalogues opens the first; one without opens itself.
    setCategoryId(p.children.find(id => !deletedCategories[id]) ?? p.id)
    setShowDashboard(false)
  }

  const category = resolveCategory(categoryId, chromeByCategory[categoryId], customCategories)
  const products = byCategory[categoryId] ?? category.seed ?? []
  const setProducts = updater => setByCategory(prev => ({
    ...prev,
    [categoryId]: typeof updater === 'function' ? updater(prev[categoryId] ?? category.seed) : updater,
  }))

  useEffect(() => {
    if (print || !hydrated) return
    try { localStorage.setItem('geometra.activeCategory', categoryId) } catch {}
    // A failed save is reported. It used to be swallowed, and a full localStorage
    // silently threw away 23 imported products.
    saveCatalogue(categoryId, products).catch(e => {
      setBusy(`NOT SAVED — ${category.title}: ${e.message}`)
    })
  }, [products, categoryId, print, hydrated])

  const pages = useMemo(() => category.paginate(products), [category, products])
  const pageCount = products.length ? pages.length : 0

  // Every catalogue the assistant may be asked about by name, so "open accessories"
  // resolves to something real instead of being guessed at.
  const catalogueOptions = useMemo(() => visibleParents.flatMap(p =>
    (p.children.length ? p.children : [p.id])
      .filter(id => !deletedCategories[id])
      .map(id => ({ id, title: CATEGORIES[id]?.title ?? parentLabel(p) }))),
    [visibleParents, deletedCategories])
  const ordered = useMemo(() => category.order(products), [category, products])
  const filledCount = useMemo(
    () => catalogueList(byCategory, chromeByCategory, deletedCategories, customCategories).length, [byCategory, chromeByCategory, deletedCategories, customCategories])

  const save = p => {
    setProducts(prev => prev.some(x => x.id === p.id) ? prev.map(x => (x.id === p.id ? p : x)) : [...prev, p])
    setEditing(null)
  }

  const remove = p => {
    if (!confirm(`Delete "${p.name}"?\n\nThe products after it shift up and the numbers close the gap.`)) return
    setProducts(prev => prev.filter(x => x.id !== p.id))
  }

  const removeCategory = async () => {
    if (!confirm(`Delete the whole "${category.title}" category?\n\nThis removes it from the dashboard and category tabs, as well as every product, image, drawing, imported page header, and saved quality-check answer. The built-in layout remains available in the system.`)) return
    setByCategory(prev => ({ ...prev, [categoryId]: [] }))
    setChromeByCategory(prev => {
      const next = { ...prev }
      delete next[categoryId]
      return next
    })
    setAcceptedByCategory(prev => {
      const next = { ...prev }
      delete next[categoryId]
      return next
    })
    setDeletedCategories(prev => ({ ...prev, [categoryId]: true }))
    try {
      await Promise.all([removeCatalogue(categoryId), markCategoryDeleted(categoryId)])
      setShowDashboard(true)
      setSidebarOpen(false)
      setBusy('')
    } catch (e) {
      setBusy(`Catalogue NOT fully deleted — ${e.message}`)
    }
  }

  const move = (id, dir) => {
    setProducts(prev => {
      const list = category.order(prev)
      const i = list.findIndex(x => x.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return prev
      // Products of different kinds flow in separate runs; do not interleave them.
      if (category.kindOf(list[i]) !== category.kindOf(list[j])) return prev
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  // The import dialog hands back a FINAL list per category — already reconciled
  // against what was here and put in the PDF's order. It is not appended: appending
  // is what produced duplicates and left a re-imported catalogue out of sequence.
  const applyImported = (byCat, chrome, created = null) => {
    // A catalogue the admin created during review. It is an ordinary catalogue from
    // here on: listed, editable, exported, printed on the default template. Created
    // at the moment of confirmation — never while they were still deciding.
    if (created?.id) {
      const entry = { id: created.id, title: created.title, edition: '', children: [], custom: true }
      setCustomCategories(prev => ({ ...prev, [created.id]: entry }))
      saveCustomCategory(entry).catch(e => setBusy(`New catalogue NOT saved: ${e.message}`))
    }
    // A catalogue the admin had deleted (e.g. PU Stone, after an earlier import that
    // found nothing) is still a family the routing can confidently recognise. Landing
    // products on it is deliberate, not an accident, and must bring it back — or the
    // import "succeeds" into a catalogue hidden from every screen that shows one.
    const revived = Object.keys(byCat).filter(id => deletedCategories[id])
    if (revived.length) {
      setDeletedCategories(prev => {
        const next = { ...prev }
        for (const id of revived) delete next[id]
        return next
      })
      Promise.all(revived.map(id => restoreCategory(id)))
        .catch(e => setBusy(`Catalogue NOT fully restored — ${e.message}`))
    }
    setByCategory(prev => ({ ...prev, ...byCat }))
    // A header only belongs to a catalogue that has no bespoke template of its own.
    if (chrome) {
      for (const id of Object.keys(byCat)) {
        if (CATEGORIES[id]) continue
        setChromeByCategory(prev => ({ ...prev, [id]: chrome }))
        saveChrome(id, chrome).catch(e => setBusy(`Header NOT saved: ${e.message}`))
      }
    }
    const ids = Object.keys(byCat)
    if (ids.length && !ids.includes(categoryId)) setCategoryId(ids[0])
  }

  // One route, one renderer. A single catalogue and the combined download differ
  // only in how many catalogues go in the request.
  const runExport = async (body, filename, message) => {
    setBusy(message)
    try {
      const res = await fetch(apiUrl('/api/export'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      // The anchor must be in the document: a detached one is ignored by some browsers.
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setBusy('')
    } catch (e) {
      setBusy(`Export failed: ${e.message}`)
    }
  }

  const exportPdf = () => runExport(
    { products, category: categoryId },
    `${category.title.replace(/[^\w]+/g, '-')}.pdf`,
    'Building PDF…',
  )

  // Every catalogue that has products, in one file, in publication order — rather
  // than a download per category and a manual merge afterwards.
  const exportAll = () => {
    const catalogues = catalogueList(byCategory, chromeByCategory, deletedCategories, customCategories)
    if (!catalogues.length) { setBusy('Nothing to export yet — no catalogue has products.'); return }
    const pageCount = catalogues.reduce(
      (n, c) => n + resolveCategory(c.category, c.chrome).paginate(c.products).length, 0)
    runExport(
      { catalogues },
      'GEOMETRA-Catalogue.pdf',
      `Building one PDF — ${catalogues.length} catalogues, ${pageCount} pages…`,
    )
  }

  // Print mode. The exporter always injects a LIST, so one catalogue and all of them
  // render through the same path; each catalogue is its own .cat-doc and the print
  // stylesheet breaks a page between them.
  if (print) {
    const all = window.__CATALOGUE_ALL__
    if (Array.isArray(all) && all.length) {
      return (
        <>
          {all.map((c, i) => (
            <Catalogue key={c.category ?? i} categoryId={c.category}
                       category={resolveCategory(c.category, c.chrome)} products={c.products} />
          ))}
        </>
      )
    }
    return <Catalogue categoryId={categoryId} category={category} products={products} />
  }

  return (
    <div className="shell">
      <aside className={`side no-print ${sidebarOpen ? '' : 'side--hidden'}`}>
        <div className="brand">
          <strong>GEOMETRA</strong>
          <span>Catalogue AI</span>
          <button className="side-close no-print" onClick={() => setSidebarOpen(false)} title="Hide sidebar">✕</button>
        </div>
        <button className={showDashboard ? 'primary wide' : 'wide'} onClick={() => { setShowDashboard(true); setSidebarOpen(false) }}>
          Dashboard
        </button>

        {/* Parent family, then its catalogues. A parent holds no products itself. */}
        <label className="parent-pick">
          Category
          {/* The SAME set the dashboard shows. This listed every family regardless
              of deletion, so a catalogue deleted from the dashboard was still
              offered here — and could be selected and worked in, while having no
              card. Two lists of catalogues must never disagree about what exists. */}
          <select value={parentId} onChange={e => pickParent(e.target.value)}>
            {visibleParents.map(p => (
              <option key={p.id} value={p.id}>
                {parentLabel(p)}{(p.children.length || byCategory[p.id]?.length) ? '' : ' — empty'}
              </option>
            ))}
          </select>
        </label>

        {siblings.length > 0 && (
          <div className="cats">
            {siblings.map(id => (
              <button key={id} className={`cat-tab ${id === categoryId ? 'cat-tab--on' : ''}`}
                      onClick={() => { setCategoryId(id); setShowDashboard(false) }}>
                {CATEGORIES[id].shortTitle ?? CATEGORIES[id].title}
              </button>
            ))}
          </div>
        )}

        {category.isDefault && products.length === 0 && (
          <p className="empty-parent">
            <b>{parentLabel(parent)}</b> is empty.
            <span>Go to the <b>Dashboard</b> and use <b>Upload file</b> on this catalogue.</span>
          </p>
        )}

        <>
        <div className="stats">
          <div><b>{ordered.length}</b> products</div>
          {/* Empty means no pages. `paginate` returns a blank sheet to work on, and
              counting it made the sidebar claim "1 page" for a catalogue the
              dashboard correctly called 0 — the same bug, in a second place. */}
          <div><b>{pageCount}</b> page{pageCount === 1 ? '' : 's'}</div>
        </div>

        {/* ONE place to upload: the dashboard. Scattering "Add from PDF" across the
            sidebar, the assistant and the dashboard meant the same destination bug
            had to be fixed twice in two different buttons. Existing products remain
            editable from the list; manual creation is intentionally not the normal
            workflow. */}
        <button className="wide" onClick={() => { setShowDashboard(true); setSidebarOpen(false) }}>
          Go to Dashboard to upload a file…
        </button>

        <ol className="list">
          {ordered.map((p, i) => (
            <li key={p.id} className={highlight.includes(p.id) ? 'flagged' : ''}>
              <span className="n">{i + 1}</span>
              <span className="nm" title={p.name}>{p.name}</span>
              <span className="tag">{category.kindLabel(p)}</span>
              <span className="mv">
                <button onClick={() => move(p.id, -1)} title="Move up">↑</button>
                <button onClick={() => move(p.id, 1)} title="Move down">↓</button>
                <button onClick={() => setEditing(p)} title="Edit">✎</button>
                <button className="danger" onClick={() => remove(p)} title="Delete">✕</button>
              </span>
            </li>
          ))}
        </ol>

        <div className="export">
          <button className="primary wide" onClick={exportPdf}>Download PDF</button>
          <button className="wide" onClick={() => {
            if (confirm('Reset this category to the catalogue as extracted from the PDF?')) setProducts(category.seed)
          }}>Reset to original</button>
          <button className="danger wide" onClick={removeCategory}>Delete whole catalogue</button>
          {busy && <p className="busy">{busy}</p>}
        </div>

        </>

        <div className="zoom">
          <label>Zoom {Math.round(zoom * 100)}% <span>(Ctrl +/− or Ctrl + mouse wheel)</span></label>
          <input type="range" min="0.3" max="1.2" step="0.02" value={zoom}
                 onChange={e => setZoom(Number(e.target.value))} />
        </div>
      </aside>

      <main className={`canvas ${sidebarOpen ? '' : 'canvas--full'}`} onWheel={zoomWithWheel}>
        {!sidebarOpen && (
          <button className="side-toggle no-print" onClick={() => setSidebarOpen(true)}>
            Categories
          </button>
        )}
        {showDashboard ? (
          <Dashboard
            parents={visibleParents}
            byCategory={byCategory}
            chromeByCategory={chromeByCategory}
            acceptedByCategory={acceptedByCategory}
            deletedCategories={deletedCategories}
            onOpen={id => { setCategoryId(id); setShowDashboard(false); setSidebarOpen(true) }}
            onImport={(id, explicit = true) => { if (id) setCategoryId(id); setShowDashboard(false); setSidebarOpen(true); setTargetChosen(Boolean(explicit) && Boolean(id)); setIngesting(true) }}
            onExportAll={exportAll}
            filledCount={filledCount}
          />
        ) : products.length > 0 ? (
          <div className="pages" style={{ '--zoom': zoom }}>
            <Catalogue categoryId={categoryId} category={category} products={products}
                       editable onEdit={setEditing} onDelete={remove} />
          </div>
        ) : (
          <div className="canvas-empty">
            <h2>{parentLabel(parent)}</h2>
            <p>No products yet. Go to the <b>Dashboard</b> and use <b>Upload file</b> on this catalogue.</p>
          </div>
        )}
      </main>


      {/* The assistant sits in the corner of the app, always reachable — it is not
          a screen you navigate to.
          Every action it can take is one the admin could have clicked themselves,
          and anything that CHANGES the catalogue is proposed and waits for a click.
          The bot is never the thing that decides to delete a product. */}
      <BotPanel
        items={products}
        category={category}
        accepted={acceptedByCategory[categoryId] ?? []}
        catalogues={catalogueOptions}
        note={botNote}
        actions={{
          onReveal: setHighlight,
          onOpenCatalogue: id => { setCategoryId(id); setShowDashboard(false); setSidebarOpen(true) },
          // Answering a check changes no product, and it is undoable, so it takes
          // effect at once — but it is REMEMBERED, which is the whole point.
          onAccept: key => setAcceptedByCategory(prev => {
            const next = { ...prev, [categoryId]: [...new Set([...(prev[categoryId] ?? []), key])] }
            saveAccepted(categoryId, next[categoryId]).catch(e => setBusy(`Not saved: ${e.message}`))
            return next
          }),
          onUnaccept: key => setAcceptedByCategory(prev => {
            const next = { ...prev, [categoryId]: (prev[categoryId] ?? []).filter(k => k !== key) }
            saveAccepted(categoryId, next[categoryId]).catch(e => setBusy(`Not saved: ${e.message}`))
            return next
          }),
          onExport: exportPdf,
          onExportAll: exportAll,
          onImport: () => { setTargetChosen(false); setIngesting(true) },
          // The file the assistant was handed goes straight through to review.
          // A code named in chat ("add PV23") is typed into the name field
          // already — the admin still supplies the photo, same as any add.
          onAddProduct: name => setEditing({ ...category.kinds[0].make(), ...(name ? { name } : {}) }),
          onApply: act => {
            if (act.type === 'delete') {
              setProducts(prev => prev.filter(p => !act.ids.includes(p.id)))
            } else if (act.type === 'rename') {
              setProducts(prev => prev.map(p => (act.ids.includes(p.id) ? { ...p, name: act.value } : p)))
            } else if (act.type === 'move') {
              move(act.ids[0], act.value)
            } else if (act.type === 'replacePhoto') {
              setProducts(prev => prev.map(p => {
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

      {ingesting && (
        <IngestDialog
          existingByCategory={byCategory}
          intoCategory={categoryId}
          catalogues={catalogueOptions}
          targetChosen={targetChosen}
          onCancel={() => {
            setIngesting(false)
            setBotNote({ id: `cancel-${Date.now()}`, text: 'Import cancelled — nothing was changed.' })
          }}
          onCommit={(byCat, chrome, created) => {
            applyImported(byCat, chrome, created)
            setIngesting(false)
            setBotNote(summariseImport(byCat))
          }}
        />
      )}

      {editing && (
        <ProductDialog categoryId={categoryId} category={category} initial={editing}
                       onSave={save} onCancel={() => setEditing(null)} />
      )}
    </div>
  )
}
