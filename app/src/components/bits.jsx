import React from 'react'

// Shared pieces between category templates.

// The badge number is positional -- computed over the flow order by the paginator
// and never stored on the product. See lib/paginate.js.
export function Badge({ n, variant = 'led' }) {
  return <div className={`badge badge--${variant}`}>{n}</div>
}

// Hover controls on each product, as per the client's storyboard.
export function Hit({ product, onEdit, onDelete }) {
  return (
    <div className="hit no-print">
      <button className="hit-edit" title="Edit" onClick={() => onEdit(product)}>✎</button>
      <button className="hit-del" title="Delete" onClick={() => onDelete(product)}>✕</button>
    </div>
  )
}
