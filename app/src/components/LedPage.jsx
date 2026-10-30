import React from 'react'
import { isTinted } from '../lib/paginate.js'
import { GRID } from '../lib/geometry.js'
import { Badge, Hit } from './bits.jsx'

// "Accessories ~ LED" template: a 6-across grid strip of standard products, with
// full-width featured blocks flowing after them.

function CellA({ p, editable, onEdit, onDelete, highlighted }) {
  return (
    <div className={`cellA ${editable && highlighted ? 'cell--highlighted' : ''}`} id={editable ? `product-${p.id}` : undefined}>
      <Badge n={p.slot} />
      <div className="name">{p.name}</div>
      <div className="colour">{p.colour}</div>
      <div className="length">{p.length ? `Length : ${p.length}` : ''}</div>
      {/* The tint follows the SLOT, not the product: a product moving from slot 3
          to slot 2 must lose it. */}
      <div className={`panel ${isTinted(p.slot) ? 'panel--tint' : ''}`}>
        {p.photo && <img className={`photo ${p.photoDisplayBackground === 'dark-neutral' ? 'photo-contrast-dark' : ''}`} src={p.photo} alt={p.name} />}
        {p.drawing && <img className="drawing" src={p.drawing} alt="" />}
      </div>
      {editable && <Hit product={p} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  )
}

function BlockB({ p, editable, onEdit, onDelete, highlighted }) {
  return (
    <div className={`blockB ${editable && highlighted ? 'cell--highlighted' : ''}`} id={editable ? `product-${p.id}` : undefined}>
      <Badge n={p.slot} />
      <div className="name">{p.name}</div>
      <div className="colour">{p.colour}</div>
      <div className="length">{p.length ? `Length : ${p.length}` : ''}</div>
      <div className={`panel ${isTinted(p.slot) ? 'panel--tint' : ''}`}>
        <div className="finishes">
          {(p.finishes ?? []).map(f => (
            <div className="finish" key={f.id}>
              {f.badge && <span className="ribbon">{f.badge}</span>}
              {f.photo && <img className={`fphoto ${f.photoDisplayBackground === 'dark-neutral' ? 'photo-contrast-dark' : ''}`} src={f.photo} alt={f.name} />}
              <div className="fname">{f.name}</div>
            </div>
          ))}
        </div>
        {p.drawing && <img className="drawing" src={p.drawing} alt="" />}
      </div>
      {editable && <Hit product={p} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  )
}

export default function LedPage({ page, editable, onEdit, onDelete, highlight = [] }) {
  const first = page.index === 1
  return (
    <div className="cat-page" data-page={page.index}>
      <div className="cat-chrome cat-header"><img src="/assets/chrome/header.png" alt="" /></div>
      {first && <div className="cat-chrome cat-gallery"><img src="/assets/chrome/gallery.png" alt="" /></div>}
      {first && <div className="cat-chrome cat-footer"><img src="/assets/chrome/footer.png" alt="" /></div>}

      <div className={`cat-flow ${first ? 'cat-flow--first' : 'cat-flow--cont'}`}>
        {page.rows.map((row, i) => (
          <div className="cat-row" key={`r${i}`}>
            {row.map(p => (
              <CellA key={p.id} p={p} editable={editable} onEdit={onEdit} onDelete={onDelete}
                     highlighted={highlight.includes(p.id)} />
            ))}
            {/* keep the grid honest when the last row is short */}
            {Array.from({ length: GRID.columns - row.length }).map((_, k) => <div key={`s${k}`} />)}
          </div>
        ))}
        {page.blocks.map(p => (
          <BlockB key={p.id} p={p} editable={editable} onEdit={onEdit} onDelete={onDelete}
                  highlighted={highlight.includes(p.id)} />
        ))}
      </div>
    </div>
  )
}
