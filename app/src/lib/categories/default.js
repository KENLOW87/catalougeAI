// Every product family can hold a catalogue, with no setup.
//
// Accessories happens to have two sub-catalogues (LED and PVC Marble), each with a
// bespoke template. A family with no sub-catalogue simply IS one: pick it, import a
// PDF, and its products land there. Nothing to create, nothing to configure.
//
// The page is the default template — a grid of photos with captions. Not a
// reproduction of any particular design, but a correct catalogue with zero work.

import DefaultPage from '../../components/DefaultPage.jsx'

const COLUMNS = 4
const PAGE_H = 297
const BOTTOM_MARGIN = 8
const FALLBACK_HEADER_MM = 24

/**
 * @param parent  the product family
 * @param chrome  { image, heightMm } — the header strip lifted off the imported
 *                PDF. Without it the page gets a plain title bar, which loses the
 *                catalogue's own title, banner and size line.
 */
export function defaultCategoryFor(parent, chrome = null) {
  const headerH = chrome?.heightMm ?? FALLBACK_HEADER_MM
  const flowTop = headerH + 4

  // Fit rows to the space the header leaves, rather than fixing a row height and
  // spilling onto extra pages. With a 46mm header a fixed 118mm row left room for
  // only one row and turned a 3-page catalogue into 6.
  const ROW_GAP = 5
  const MIN_ROW_H = 95           // below this a product cell stops being readable
  const available = PAGE_H - flowTop - BOTTOM_MARGIN
  const rowsPerPage = Math.max(1, Math.floor(available / MIN_ROW_H))
  const rowH = Math.floor((available - (rowsPerPage - 1) * ROW_GAP) / rowsPerPage)

  const meta = {
    id: parent.id,
    title: parent.title,
    subtitle: parent.edition,
    parentId: parent.id,
    isDefault: true,
    columns: COLUMNS,
    chrome: chrome?.image ?? null,
    headerH,
    flowTop,
    rowH,
  }

  return {
    ...meta,
    Page: props => DefaultPage({ ...props, category: meta }),
    seed: [],
    order: products => products,

    // Same positional numbering as everywhere else: the badge is computed over the
    // flow order and never stored on the product.
    //
    // A KEPT PAGE (a cover, an application gallery, a detail spread) takes a whole
    // sheet of its own and holds its place in the flow. It carries no badge and does
    // not consume a number — numbering counts products, so inserting a cover cannot
    // renumber the catalogue.
    paginate: items => {
      const pages = []
      let rows = []          // rows waiting to be placed on the current page
      let cell = []          // products waiting to fill the current row
      let slot = 0

      const flushRow = () => { if (cell.length) { rows.push(cell); cell = [] } }
      const flushPage = () => {
        flushRow()
        while (rows.length) {
          pages.push({ index: pages.length + 1, rows: rows.splice(0, rowsPerPage), blocks: [] })
        }
      }

      for (const item of items) {
        if (item.isPage) {
          flushPage()                                   // finish what is in hand…
          pages.push({ index: pages.length + 1, plate: item, rows: [], blocks: [] })
          continue                                      // …then the page, on its own
        }
        cell.push({ ...item, slot: ++slot })
        if (cell.length === COLUMNS) flushRow()
        if (rows.length === rowsPerPage) {
          pages.push({ index: pages.length + 1, rows: rows.splice(0, rowsPerPage), blocks: [] })
        }
      }
      flushPage()

      if (!pages.length) pages.push({ index: 1, rows: [], blocks: [] })
      return pages
    },

    // Only one button. A full page is not something anyone sits down to create by
    // hand — it arrives with the PDF it came from, whole. Offering to add one
    // manually was work invented for the user, not for them.
    kinds: [{
      id: 'item', label: '+ Add product', primary: true,
      make: () => ({
        id: `d${Math.random().toString(36).slice(2, 8)}`,
        name: '', subtitle: '', third: '', photo: null, drawing: null,
      }),
    }],
    kindOf: p => (p.isPage ? 'page' : 'item'),
    kindLabel: p => (p.isPage ? 'full page' : 'product'),

    // A dimension drawing is optional here. These catalogues are sheet products —
    // they have a photo and a code, not an engineering drawing. Requiring one would
    // block every product for a field the source page does not contain.
    // A kept page has nothing to edit but the picture itself and a label for the
    // sidebar — there is no product inside it to describe.
    fields: p => (p.isPage ? [
      { key: 'name', label: 'Label', type: 'text', placeholder: 'Page 2',
        hint: 'shown in the sidebar only — never printed' },
      { key: 'image', label: 'The page', type: 'image', required: true,
        hint: 'printed full size, exactly as it came out of the PDF' },
      // Keeping the whole page was only half of what the client asked for —
      // "the details... close up image, will be extract too". Each photo on an
      // application spread or installation-steps page, pulled out on its own so
      // it is something the admin can actually use, not just look at inside a flat
      // page picture. Read-only: these are extracted, not something to upload.
      { key: 'details', label: 'Close-ups extracted from this page', type: 'gallery' },
    ] : [
      { key: 'name', label: 'Name or code', type: 'text', placeholder: 'PV01', required: true,
        hint: 'printed exactly as typed' },
      { key: 'subtitle', label: 'Description', type: 'text', placeholder: 'Fishbelly White Marble' },
      { key: 'third', label: 'Third line (optional)', type: 'text' },
      { key: 'photo', label: 'Product photo', type: 'image', required: true },
      { key: 'drawing', label: 'Dimension drawing (optional)', type: 'image',
        hint: 'never generated — upload it if this product has one' },
    ]),
  }
}
