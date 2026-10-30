import React from 'react'
import { Badge, Hit } from './bits.jsx'

// PVC Marble template: full-width rows stacked down the page, one product per row,
// separated by a gold rule. Not a grid -- the LED category is the grid one.
//
// Each row is a left column (badge, name, size, series, gold dimension drawing) and
// a right column (the colour variants in a row with their labels underneath, plus an
// optional installed detail photo at the far right).
//
// Product 6 carries an "exception": its White finish is only made in a different
// size, so it gets its own photo, its own drawing and a printed note beneath the row.

function Variant({ v }) {
  return (
    <div className="pvc-variant">
      {v.photo
        ? (v.secondaryPhoto
          ? <div className="pvc-vphotos">
              <img className="pvc-vphoto" src={v.photo} alt={v.name} />
              <img className="pvc-vphoto" src={v.secondaryPhoto} alt="" />
            </div>
          : <img className="pvc-vphoto" src={v.photo} alt={v.name} />)
        : <span className="pvc-missing" />}
      <div className="pvc-vname">{v.name}</div>
    </div>
  )
}

function Row({ p, editable, onEdit, onDelete, highlighted }) {
  return (
    <div className={`pvc-row ${(p.exceptions?.length || p.sourceTall) ? 'pvc-row--tall' : ''} ${editable && highlighted ? 'cell--highlighted' : ''}`}
         id={editable ? `product-${p.id}` : undefined}>
      <div className="pvc-left">
        <Badge n={p.slot} variant="pvc" />
        <div className="pvc-name">{p.name}</div>
        <div className="pvc-size">{p.size ? `Size : ${p.size}` : ''}</div>
        <div className="pvc-series">{p.series}</div>
        {p.drawing && <img className="pvc-drawing" src={p.drawing} alt="" />}
      </div>

      <div className={`pvc-right ${p.sourceComposite ? `pvc-right--composite ${p.sourceTall ? 'pvc-right--composite-tall' : ''}` : ''}`}>
        {p.sourceComposite
          ? <img className="pvc-source-photo" src={p.photo} alt="" />
          : <div className="pvc-variants">
              {(p.variants ?? []).map(v => <Variant key={v.id} v={v} />)}
            </div>}
        {p.extra && <img className="pvc-extra" src={p.extra} alt="" />}
      </div>

      {p.exceptions?.length > 0 && (
        <div className={`pvc-exception ${p.exceptions.length > 1 ? 'pvc-exception--multi' : ''}`}>
          {p.exceptions.map((ex, i) => <React.Fragment key={ex.variant?.id ?? i}>
            <Variant v={ex.variant} />
            {ex.drawing && <img className="pvc-exdrawing" src={ex.drawing} alt="" />}
          </React.Fragment>)}
          {p.exceptions[0]?.note && <div className="pvc-exnote">{p.exceptions[0].note}</div>}
        </div>
      )}

      <div className="pvc-rule" />
      {editable && <Hit product={p} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  )
}

export default function PvcPage({ page, editable, onEdit, onDelete, highlight = [] }) {
  // A mixed Accessories import keeps the original PVC pages after the LED
  // pages, so sourcePage 2 is still the first PVC page even though the overall
  // catalogue page index is not 1.
  const first = page.sourcePage === 2 || (!page.sourcePage && page.index === 1)
  return (
    <div className="cat-page cat-page--pvc" data-page={page.index}>
      <div className="cat-chrome pvc-header">
        <img src={first ? '/assets/pvc/chrome-header-first.png' : '/assets/pvc/chrome-header-cont.png'} alt="" />
      </div>
      <div className="pvc-flow">
        {page.rows.map(p => (
          <Row key={p.id} p={p} editable={editable} onEdit={onEdit} onDelete={onDelete}
               highlighted={highlight.includes(p.id)} />
        ))}
      </div>
    </div>
  )
}
