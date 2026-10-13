import React from 'react'
import { getCategory } from '../lib/categories/index.js'

// Renders a catalogue exactly as it will print. The editor and the PDF export both
// mount this same component, which is what guarantees the exported PDF matches what
// was edited — there is no second renderer that can drift.
//
// Each category supplies its own paginator and its own page template; everything
// else is shared.

export default function Catalogue({ categoryId, category: given, products, editable = false, onEdit, onDelete }) {
  // A user-created category is not in the static registry, so it is passed in.
  const category = given ?? getCategory(categoryId)
  const pages = category.paginate(products)
  const Page = category.Page

  return (
    <div className="cat-doc">
      {pages.map(pg => (
        <Page key={pg.index} page={pg} editable={editable} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  )
}
