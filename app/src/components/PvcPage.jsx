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
        ? <img className="pvc-vphoto" src={v.photo} alt={v.name} />
        : <span className="pvc-missing" />}
      <div className="pvc-vname">{v.name}</div>
    </div>
  )
}

function Row({ p, editable, onEdit, onDelete, highlighted }) {
  return (
    <div className={`pvc-row ${p.exception ? 'pvc-row--tall' : ''} ${editable && highlighted ? 'cell--highlighted' : ''}`}
         id={editable ? `product-${p.id}` : undefined}>
      <div className="pvc-left">
        <Badge n={p.slot} variant="pvc" />
        <div className="pvc-name">{p.name}</div>
        <div className="pvc-size">{p.size ? `Size : ${p.size}` : ''}</div>
        <div className="pvc-series">{p.series}</div>
        {p.drawing && <img className="pvc-drawing" src={p.drawing} alt="" />}
      </div>

      <div className="pvc-right">
        <div className="pvc-variants">
          {(p.variants ?? []).map(v => <Variant key={v.id} v={v} />)}
        </div>
        {p.extra && <img className="pvc-extra" src={p.extra} alt="" />}
      </div>

      {p.exception && (
        <div className="pvc-exception">
          <Variant v={p.exception.variant} />
          {p.exception.drawing && <img className="pvc-exdrawing" src={p.exception.drawing} alt="" />}
          {p.exception.note && <div className="pvc-exnote">{p.exception.note}</div>}
        </div>
      )}

      <div className="pvc-rule" />
      {editable && <Hit product={p} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  )
}

export default function PvcPage({ page, editable, onEdit, onDelete, highlight = [] }) {
  const first = page.index === 1
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
