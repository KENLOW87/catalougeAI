// Parent categories — the product families GEOMETRA publishes.
//
// Every published family is one catalogue. Accessories used to be split into LED
// and PVC Marble children, but the source PDF is one catalogue and must stay one
// catalogue throughout upload, review, editing and export.
//
// Taken from the client's catalogue folder, with the edition date shown on each
// file. The date matters: two editions of the same family exist (PVC Rattan
// Webbing appears as both August 2025 and Jan 2026), so a family is identified by
// id and the edition is carried alongside rather than being part of the name.
//
// NOTE: "PVC Marble Sheet" here is NOT the "PVC Marble" child under Accessories.
// The child is *aluminium accessories for* PVC Marble (Edge Display); this parent
// is the marble sheet product itself. Keep them separate.

export const PARENTS = [
  { id: 'accessories',            title: 'Accessories',              edition: 'March 2026',     children: [] },
  { id: 'acoustic-panel',         title: 'Acoustic Panel',           edition: 'August 2025',    children: [] },
  { id: 'carbon-crystal-wall',    title: 'Carbon Crystal Wall Panel', edition: 'Jan 2026',      children: [] },
  { id: 'ceiling-panel',          title: 'Ceiling Panel',            edition: 'December 2025',  children: [] },
  { id: 'light-stone-wall',       title: 'Light Stone Wall Panel',   edition: 'Feb 2026',       children: [] },
  { id: 'mdf-wave-panel',         title: 'MDF Wave Panel',           edition: 'September 2025', children: [] },
  { id: 'pu-stone',               title: 'PU Stone',                 edition: 'Jan 2026',       children: [] },
  { id: 'pvc-marble-sheet',       title: 'PVC Marble Sheet',         edition: 'Jan 2026',       children: [] },
  { id: 'pvc-marble-sheet-3d',    title: 'PVC Marble Sheet 3D',      edition: 'September 2025', children: [] },
  { id: 'pvc-rattan-webbing-aug', title: 'PVC Rattan Webbing',       edition: 'August 2025',    children: [] },
  { id: 'pvc-rattan-webbing-jan', title: 'PVC Rattan Webbing',       edition: 'Jan 2026',       children: [] },
  { id: 'wainscoting-mirror',     title: 'Wainscoting & Mirror',     edition: 'Jan 2026',       children: [] },
  { id: 'wpc-fluted-wall',        title: 'WPC Fluted Wall Panel',    edition: 'Jan 2026',       children: [] },
]

export const DEFAULT_PARENT = 'accessories'

export const getParent = id => PARENTS.find(p => p.id === id) ?? PARENTS[0]

/** Two families share the name "PVC Rattan Webbing", so the edition disambiguates. */
export const parentLabel = p => {
  const sameName = PARENTS.filter(x => x.title === p.title)
  return sameName.length > 1 ? `${p.title} (${p.edition})` : p.title
}

/** Which parent a child belongs to. */
export const parentOfCategory = categoryId =>
  PARENTS.find(p => p.children.includes(categoryId)) ?? null
