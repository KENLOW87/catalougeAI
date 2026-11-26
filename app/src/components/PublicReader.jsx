import React, { useEffect, useMemo, useRef, useState } from 'react'

// A fitted page reader for the PUBLIC site.
//
// The visitor used to get one long scrolling document: every page stacked
// vertically, so reading page 9 meant scrolling past eight A4 sheets. This
// gives the public site the same "one sheet at a time" reading model the admin
// editor already has — fit to screen, zoom, page turn, page slider — WITHOUT
// touching the printed page itself.
//
// Each sheet is still the exact `category.Page` component the admin editor and
// the PDF export render, rendered read-only (no `editable`), so nothing about
// the approved catalogue layout can drift from this file. Only the viewport
// around the sheets is new.

const PAGE_W = 210 * 96 / 25.4
const PAGE_H = 297 * 96 / 25.4
const GAP = 16
const MIN_ZOOM = 0.3
const MAX_ZOOM = 2

const stored = () => {
  try {
    const value = JSON.parse(sessionStorage.getItem('geometra.public-reader') || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

export default function PublicReader({ category, products, title }) {
  const pages = useMemo(() => category.paginate(products ?? []), [category, products])
  const total = pages.length
  const [positions, setPositions] = useState(stored)
  // Two-page spreads need room; a phone opens on a single sheet.
  const [mode, setMode] = useState(() => {
    const saved = stored().mode
    if (saved === 'single' || saved === 'spread') return saved
    return typeof window !== 'undefined' && window.innerWidth < 900 ? 'single' : 'spread'
  })
  const [fit, setFit] = useState(true)
  const [zoom, setZoom] = useState(0.7)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const stage = useRef(null)
  const reader = useRef(null)
  const swipe = useRef(null)

  const selected = Math.max(0, Math.min(total - 1, Number(positions[category.id]) || 0))
  // The cover stands alone; the rest open as 2-3, 4-5, and so on.
  const index = mode === 'spread' && selected > 0 ? 1 + Math.floor((selected - 1) / 2) * 2 : selected
  const count = mode === 'spread' && index > 0 && index + 1 < total ? 2 : 1
  const visible = pages.slice(index, index + count)
  const fitScale = Math.max(.05, Math.min(1, (size.width - 28) / (PAGE_W * count + GAP * (count - 1)), (size.height - 20) / PAGE_H))
  const scale = fit ? fitScale : zoom

  const goTo = page => setPositions(p => ({ ...p, [category.id]: Math.max(0, Math.min(total - 1, page)) }))
  const next = () => goTo(index + count)
  const previous = () => goTo(index - (mode === 'spread' ? 2 : 1))
  const atStart = index === 0
  const atEnd = index + count >= total

  useEffect(() => {
    if (!stage.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem('geometra.public-reader', JSON.stringify({ ...positions, mode })) } catch {}
  }, [positions, mode])
  useEffect(() => {
    const onKey = event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return
      if (document.querySelector('.modal-backdrop,.ps-help-overlay')) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); if (!atEnd) next() }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); if (!atStart) previous() }
      if (event.key === 'Home') { event.preventDefault(); goTo(0) }
      if (event.key === 'End') { event.preventDefault(); goTo(total - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, count, total, mode, atStart, atEnd, category.id])
  useEffect(() => {
    // A zoomed sheet can be panned, but every page turn starts at its top.
    if (!stage.current) return
    stage.current.scrollTop = 0
    stage.current.scrollLeft = 0
  }, [index, mode, fit, category.id])

  const changeZoom = amount => {
    setZoom(z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(((fit ? fitScale : z) + amount).toFixed(2)))))
    setFit(false)
  }
  const fullscreen = () => {
    const operation = document.fullscreenElement ? document.exitFullscreen() : reader.current?.requestFullscreen?.()
    operation?.catch(() => {})
  }
  // Swiping turns the page only while the sheet is fitted — once it is zoomed,
  // a drag is the visitor panning around the page.
  const onTouchStart = event => {
    swipe.current = fit && event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null
  }
  const onTouchEnd = event => {
    const start = swipe.current
    swipe.current = null
    const touch = event.changedTouches?.[0]
    if (!start || !touch) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return
    if (dx < 0 && !atEnd) next()
    if (dx > 0 && !atStart) previous()
  }

  if (!total) return <div className="ps-state"><p>This catalogue has no pages yet.</p></div>

  const Page = category.Page
  const range = count === 2 ? `${index + 1}–${index + 2}` : `${index + 1}`

  return (
    <section className="ps-reader" ref={reader} aria-label="Catalogue reader">
      <div className="ps-reader-bar">
        {/* The catalogue's name lives in the bar rather than in a heading above
            it: a separate heading row cost ~50px of the sheet's height. */}
        <h1 className="ps-reader-title">{title}</h1>
        <div className="ps-reader-group" role="group" aria-label="Page layout">
          <button type="button" className={mode === 'single' ? 'is-on' : ''} aria-pressed={mode === 'single'}
                  onClick={() => { setMode('single'); setFit(true) }}>1 page</button>
          <button type="button" className={mode === 'spread' ? 'is-on' : ''} aria-pressed={mode === 'spread'}
                  onClick={() => { setMode('spread'); setFit(true) }}>2 pages</button>
        </div>
        <div className="ps-reader-group ps-reader-zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => changeZoom(-.1)} disabled={!fit && zoom <= MIN_ZOOM} aria-label="Zoom out">&minus;</button>
          <span className="ps-reader-zoom-value" aria-live="polite">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => changeZoom(.1)} disabled={!fit && zoom >= MAX_ZOOM} aria-label="Zoom in">+</button>
        </div>
        <button type="button" className={`ps-reader-btn ${fit ? 'is-on' : ''}`} onClick={() => setFit(true)}>Fit to screen</button>
        <button type="button" className="ps-reader-btn ps-reader-icon" onClick={fullscreen}
                aria-label="Toggle fullscreen" title="Fullscreen">&#9974;</button>
      </div>

      <div className={`ps-reader-stage ${fit ? 'ps-reader-stage--fit' : ''}`} ref={stage}
           onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="ps-reader-size" style={{ width: (PAGE_W * count + GAP * (count - 1)) * scale, height: PAGE_H * scale }}>
          <div className="ps-reader-spread" key={`${category.id}-${index}-${mode}`}
               style={{ transform: `scale(${scale})`, gap: GAP }}>
            {visible.map(page => <Page key={page.index} page={page} />)}
          </div>
        </div>
        <button type="button" className="ps-reader-turn ps-reader-turn--prev" onClick={previous}
                disabled={atStart} aria-label="Previous page">&#8249;</button>
        <button type="button" className="ps-reader-turn ps-reader-turn--next" onClick={next}
                disabled={atEnd} aria-label="Next page">&#8250;</button>
      </div>

      <nav className="ps-reader-nav" aria-label="Catalogue pages">
        <button type="button" className="ps-reader-btn ps-reader-icon" onClick={() => goTo(0)}
                disabled={atStart} aria-label="First page">&#124;&#8249;</button>
        <button type="button" className="ps-reader-btn" onClick={previous} disabled={atStart}>&#8249; Prev</button>
        <input className="ps-reader-slider" type="range" min="0" max={total - 1} step="1" value={index}
               onChange={event => goTo(Number(event.target.value))} aria-label="Slide to a page" />
        <span className="ps-reader-count" aria-live="polite" aria-atomic="true">{range} / {total}</span>
        <button type="button" className="ps-reader-btn" onClick={next} disabled={atEnd}>Next &#8250;</button>
        <button type="button" className="ps-reader-btn ps-reader-icon" onClick={() => goTo(total - 1)}
                disabled={atEnd} aria-label="Last page">&#8250;&#124;</button>
      </nav>
    </section>
  )
}
