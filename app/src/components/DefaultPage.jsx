import React from 'react'
import { Badge, Hit } from './bits.jsx'

// The default catalogue page.
//
// LED and PVC Marble have bespoke templates that reproduce their original pages.
// Every other product family gets this one: a grid of product photos with the name
// and second line beneath each — which is the shape most catalogues already use,
// and exactly what the photo-grid reader pulls out of them.
//
// It is deliberately plain. It is not trying to reproduce a specific design; it is
// trying to be a correct, consistent catalogue page with no setup at all.

function Cell({ p, editable, onEdit, onDelete }) {
  return (
    <div className="dp-item">
      <Badge n={p.slot} variant="default" />
      <div className="dp-photo">
        {p.photo
          ? <img src={p.photo} alt={p.name} />
          : <span className="dp-missing">no photo</span>}
      </div>
      <div className="dp-name">{p.name}</div>
      {(p.subtitle || p.third) && (
        <div className="dp-sub">{[p.subtitle, p.third].filter(Boolean).join(' · ')}</div>
      )}
      {p.drawing && <img className="dp-drawing" src={p.drawing} alt="" />}
      {editable && <Hit product={p} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  )
}

export default function DefaultPage({ page, editable, onEdit, onDelete, category }) {
  const columns = category?.columns ?? 4
  const headerH = category?.headerH ?? 24
  const flowTop = category?.flowTop ?? headerH + 4
  const rowH = category?.rowH ?? 118

  // A page kept from the source PDF — a cover, an application gallery, a spread of
  // close-up details, the installation steps. It prints exactly as it was printed
  // originally: no header of ours over it, no grid, nothing to reflow inside it.
  if (page.plate) {
    return (
      <div className="cat-page cat-page--plate" data-page={page.index}>
        {page.plate.image
          ? <img src={page.plate.image} alt={page.plate.name ?? ''} />
          : <span className="dp-missing">no page image</span>}
        {editable && <Hit product={page.plate} onEdit={onEdit} onDelete={onDelete} />}
      </div>
    )
  }

  return (
    <div className="cat-page cat-page--default" data-page={page.index}>
      {/* The real header, lifted off the source PDF — it carries the catalogue's
          title, banner and size line. A plain bar is only the fallback for a
          catalogue built by hand, with no PDF to take one from. */}
      {category?.chrome ? (
        <div className="dp-header dp-header--image" style={{ height: `${headerH}mm` }}>
          <img src={category.chrome} alt="" />
        </div>
      ) : (
        <header className="dp-header" style={{ height: `${headerH}mm` }}>
          <span className="dp-title">{category?.title}</span>
          {category?.subtitle && <span className="dp-subtitle">{category.subtitle}</span>}
        </header>
      )}

      <div className="dp-flow" style={{ top: `${flowTop}mm` }}>
        {page.rows.map((row, i) => (
          <div className="dp-row" key={i}
               style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, height: `${rowH}mm` }}>
            {row.map(p => (
              <Cell key={p.id} p={p} editable={editable} onEdit={onEdit} onDelete={onDelete} />
            ))}
            {Array.from({ length: columns - row.length }).map((_, k) => <div key={`s${k}`} />)}
          </div>
        ))}
      </div>
    </div>
  )
}
