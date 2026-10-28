import React, { useEffect, useRef, useState } from 'react'

const PAGE_W = 210 * 96 / 25.4
const PAGE_H = 297 * 96 / 25.4
const GAP = 16
const stored = () => {
  try {
    const value=JSON.parse(sessionStorage.getItem('geometra.reader') || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}
const includesProduct = (value, id) => value && typeof value === 'object' &&
  (value.id === id || Object.values(value).some(child => child && typeof child === 'object' && includesProduct(child, id)))

// Only the reader's viewport changes. Each sheet is still the exact Page
// component used by Catalogue's full-document PDF export.
export default function CatalogueViewer({ category, pages, zoom, onZoomChange, onEdit, onDelete, highlight = [] }) {
  const [positions, setPositions] = useState(stored)
  const [mode, setMode] = useState(() => stored().mode === 'single' ? 'single' : 'spread')
  const [fit, setFit] = useState(true)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const stage = useRef(null)
  const reader = useRef(null)
  const previousZoom = useRef(zoom)
  const total = pages.length
  const selected = Math.max(0, Math.min(total - 1, Number(positions[category.id]) || 0))
  // Covers stand alone; subsequent sheets open as 2–3, 4–5, and so on.
  const index = mode === 'spread' && selected > 0 ? 1 + Math.floor((selected - 1) / 2) * 2 : selected
  const count = mode === 'spread' && index > 0 && index + 1 < total ? 2 : 1
  const visible = pages.slice(index, index + count)
  const fitScale = Math.max(.05, Math.min(1, (size.width - 32) / (PAGE_W * count + GAP * (count - 1)), (size.height - 20) / PAGE_H))
  const scale = fit ? fitScale : zoom
  const next = () => setPositions(p => ({ ...p, [category.id]: Math.min(total - 1, index + count) }))
  const previous = () => setPositions(p => ({ ...p, [category.id]: Math.max(0, index - (mode === 'spread' ? 2 : 1)) }))
  const goTo = page => setPositions(p => ({ ...p, [category.id]: Math.max(0, Math.min(total - 1, page)) }))
  const target = highlight[0]
  const targetPage = target ? pages.findIndex(page => includesProduct(page, target)) : -1

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { try { sessionStorage.setItem('geometra.reader', JSON.stringify({ ...positions, mode })) } catch {} }, [positions, mode])
  useEffect(() => {
    if (previousZoom.current !== zoom) { setFit(false); previousZoom.current = zoom }
  }, [zoom])
  useEffect(() => {
    if (target && targetPage >= 0) setPositions(p => ({ ...p, [category.id]: targetPage }))
  }, [target, targetPage, category.id])
  useEffect(() => {
    const onKey = event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,[contenteditable="true"]') || document.querySelector('.modal-backdrop')) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); if (index + count < total) next() }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); if (index > 0) previous() }
      if (event.key === 'Home') { event.preventDefault(); goTo(0) }
      if (event.key === 'End') { event.preventDefault(); goTo(total - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [category.id, index, count, total, mode])
  useEffect(() => {
    // A zoomed page may be panned, but every page turn starts at its top.
    stage.current.scrollTop = 0
    stage.current.scrollLeft = 0
  }, [index, category.id, mode, fit])

  const Page = category.Page
  const range = count === 2 ? `${index + 1}–${index + 2}` : `${index + 1}`
  const changeZoom = amount => { setFit(false); onZoomChange(Math.max(.3, Math.min(1.2, scale + amount))) }
  const fullscreen = () => {
    const operation = document.fullscreenElement ? document.exitFullscreen() : reader.current.requestFullscreen?.()
    operation?.catch(() => {})
  }
  return <section className="catalogue-viewer" ref={reader} aria-label="Catalogue reader">
    <div className="reader-toolbar">
      <strong className="reader-title">{category.title}</strong>
      <div className="reader-modes" role="group" aria-label="Page layout">
        <button aria-pressed={mode === 'single'} onClick={() => { setMode('single'); setFit(true) }}>1 page</button>
        <button aria-pressed={mode === 'spread'} onClick={() => { setMode('spread'); setFit(true) }}>2 pages</button>
      </div>
      <button onClick={() => changeZoom(-.1)} aria-label="Zoom out">−</button>
      <button className={fit ? 'reader-fit--on' : ''} onClick={() => setFit(true)}>Fit to screen</button>
      <button onClick={() => changeZoom(.1)} aria-label="Zoom in">+</button>
      <button onClick={fullscreen} aria-label="Toggle fullscreen">⛶</button>
    </div>
    <div className={`reader-stage ${fit ? 'reader-stage--fit' : ''}`} ref={stage}>
      <div className="reader-spread-size" style={{ width: (PAGE_W * count + GAP * (count - 1)) * scale, height: PAGE_H * scale }}>
        <div className="reader-spread" key={`${category.id}-${index}-${mode}`} style={{ transform: `scale(${scale})`, gap: GAP }}>
          {visible.map(page => <Page key={page.index} page={page} editable onEdit={onEdit} onDelete={onDelete} highlight={highlight} />)}
        </div>
      </div>
    </div>
    <nav className="reader-navigation" aria-label="Catalogue pages">
      <button onClick={() => goTo(0)} disabled={index === 0} aria-label="First page">|‹</button>
      <button onClick={previous} disabled={index === 0} aria-label="Previous page">‹ Previous</button>
      <label>Page <select aria-label="Go to page" value={index} onChange={event => goTo(Number(event.target.value))}>
        {pages.map((page, i) => <option key={page.index} value={i}>{i + 1}</option>)}
      </select></label>
      <span className="reader-page-count" aria-live="polite" aria-atomic="true">{range} / {total}</span>
      <button onClick={next} disabled={index + count >= total} aria-label="Next page">Next ›</button>
      <button onClick={() => goTo(total - 1)} disabled={index + count >= total} aria-label="Last page">›|</button>
    </nav>
  </section>
}
