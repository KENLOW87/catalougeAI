// Every product family can hold a catalogue, with no setup.
//
// Accessories happens to have two sub-catalogues (LED and PVC Marble), each with a
// bespoke template. A family with no sub-catalogue simply IS one: pick it, import a
// PDF, and its products land there. Nothing to create, nothing to configure.
//
// The page is the default template — a grid of photos with captions. Not a
// reproduction of any particular design, but a correct catalogue with zero work.

import DefaultPage from '../../components/DefaultPage.jsx'
import { usageExamples, isDimensionReference, groupSharedUsage, needsFullTechnicalRow, orderTechnicalSpace } from '../product-layout.js'

const COLUMNS = 4
const PAGE_H = 297
const BOTTOM_MARGIN = 8
const FALLBACK_HEADER_MM = 24

// Light Stone imports are sometimes explicitly routed into the user's PU Stone
// catalogue. The destination must not erase the source layout: these records
// still have two product views (before/after backlighting) and, on the last two
// source pages, one installation strip. Keep this fallback for records saved by
// older builds before sourceProfile was persisted.
const isLightStoneProduct = product => {
  if (!product || product.isPage) return false
  if (product.sourceProfile === 'light-stone-wall') return true
  const code = String(product.code ?? product.name ?? '').trim()
  const size = `${product.size ?? ''} ${product.subtitle ?? ''}`
  return /^(?:LS\d{2}N?|ICP\d{2})\b/i.test(code) &&
    /1220\s*mm\s*x\s*2440\s*mm/i.test(size) &&
    Number.isInteger(Number(product.sourcePage)) && Number(product.sourcePage) >= 2 && Number(product.sourcePage) <= 5
}

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
    order: orderTechnicalSpace,

    // Same positional numbering as everywhere else: the badge is computed over the
    // flow order and never stored on the product.
    //
    // A KEPT PAGE (a cover, an application gallery, a detail spread) takes a whole
    // sheet of its own and holds its place in the flow. It carries no badge and does
    // not consume a number — numbering counts products, so inserting a cover cannot
    // renumber the catalogue.
    paginate: items => {
      // Explicit image-page positions are applied to completed pages. They must
      // never split an accepted product/source row or change its pagination.
      const positioned = items.filter(p => p.isPage && p.origin === 'manual-image-page' && Number.isInteger(p.pagePosition) && p.pagePosition > 0)
      const positionedIds = new Set(positioned.map(p => p.id))
      items = items.filter(p => !positionedIds.has(p.id))
      // Known source sheets already provide their printed order. Running those
      // products through the family sorter first moves codes such as LS04N ahead
      // of LS05 and breaks the supplier's two-row page grouping. Keep the source
      // order for Light Stone; all ordinary imports retain the global sorter.
      const hasLightStoneSource = items.some(isLightStoneProduct)
      items=groupSharedUsage(hasLightStoneSource ? items : orderTechnicalSpace(items))
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

      for (let itemIndex=0;itemIndex<items.length;itemIndex++) {
        const item=items[itemIndex]
        if (item.isPage) {
          flushPage()                                   // finish what is in hand…
          pages.push({ index: pages.length + 1, plate: item, rows: [], blocks: [] })
          continue                                      // …then the page, on its own
        }
        const product = { ...item, slot: ++slot }
        // PVC Foam Board's source sheet is three large stacked product rows,
        // not a four-column card grid. Keep the source order and give the whole
        // page to those rows so their photos remain readable at the same scale
        // as the supplier PDF.
        if (product.categoryId === 'pvc-foam-board' && Number.isInteger(product.sourcePage)) {
          const sourcePage = product.sourcePage
          const sourceProducts = [product]
          while (itemIndex + 1 < items.length) {
            const next = items[itemIndex + 1]
            if (!next || next.isPage || next.categoryId !== 'pvc-foam-board' || next.sourcePage !== sourcePage) break
            sourceProducts.push({ ...next, slot: ++slot })
            itemIndex++
          }
          flushPage()
          const sourceRows = sourceProducts.map(p => [p])
          const sourceGap = 3
          const available = PAGE_H - flowTop - BOTTOM_MARGIN - sourceGap * (sourceRows.length - 1)
          const sourceRowHeights = sourceRows.length === 3 ? [78, 78, Math.max(78, Math.floor(available - 156))] : null
          const sourceRowH = sourceRowHeights?.[0] ?? Math.floor(available / sourceRows.length)
          pages.push({ index: pages.length + 1, rows: sourceRows, blocks: [], rowH: sourceRowH, rowHeights: sourceRowHeights, rowGap: sourceGap, columns: 1, sourcePage })
          continue
        }
        // Light Stone's source pages are two-up product sheets. Keep the four
        // cards from pages 2-3 in two rows of two, and keep the single product
        // plus its installation strip together on pages 4-5. The cover is an
        // isPage plate and is handled above, so the source order remains 1-5.
        if (isLightStoneProduct(product) && Number.isInteger(product.sourcePage)) {
          const sourcePage = product.sourcePage
          const sourceProducts = [product]
          while (itemIndex + 1 < items.length) {
            const next = items[itemIndex + 1]
            if (!next || next.isPage || next.categoryId !== 'light-stone-wall' || next.sourcePage !== sourcePage) break
            sourceProducts.push({ ...next, slot: ++slot })
            itemIndex++
          }
          flushPage()
          if (sourcePage === 2 || sourcePage === 3) {
            const sourceRows = []
            for (let i = 0; i < sourceProducts.length; i += 2) sourceRows.push(sourceProducts.slice(i, i + 2))
            pages.push({ index: pages.length + 1, rows: sourceRows, blocks: [], rowH: 120,
              rowHeights: sourceRows.map(() => 120), rowGap: 4, columns: 2, sourcePage })
          } else {
            const sourceRows = [sourceProducts]
            const support = sourceProducts.some(p => p.supportStrip)
            if (support) { const band = []; band.supportFor = sourceProducts; sourceRows.push(band) }
            pages.push({ index: pages.length + 1, rows: sourceRows, blocks: [], rowH: 125,
              rowHeights: support ? [125, 112] : [125], rowGap: 3, columns: 2, sourcePage })
          }
          continue
        }
        // Carbon Crystal's edge-profile sheet is one source page with three
        // stacked products. Keep I/END/CORNER together; treating them as
        // ordinary cards lets I Profile spill onto the preceding finish grid.
        if (product.categoryId === 'carbon-crystal-wall' && product.sourceLayout === 'carbon-edge-profile') {
          const sourceProducts = [product]
          while (itemIndex + 1 < items.length) {
            const next = items[itemIndex + 1]
            if (!next || next.isPage || next.categoryId !== 'carbon-crystal-wall' || next.sourceLayout !== 'carbon-edge-profile') break
            sourceProducts.push({ ...next, slot: ++slot })
            itemIndex++
          }
          flushPage()
          const sourceGap = 3
          const available = PAGE_H - flowTop - BOTTOM_MARGIN - sourceGap * (sourceProducts.length - 1)
          const rowH = Math.floor(available / sourceProducts.length)
          pages.push({
            index: pages.length + 1,
            rows: sourceProducts.map(p => [p]),
            blocks: [],
            rowH,
            rowHeights: sourceProducts.map(() => rowH),
            rowGap: sourceGap,
            columns: 1,
            sourcePage: product.sourcePage,
          })
          continue
        }
        // Recognised Accessories pages are already paginated by the source PDF.
        // Keep each source page together and size its rows to the number of
        // printed products instead of letting the generic drawing rule turn it
        // into two oversized cards per page.
        if (product.categoryId === 'accessories' && Number.isInteger(product.sourcePage)) {
          const sourcePage = product.sourcePage
          const sourceProducts = [product]
          while (itemIndex + 1 < items.length) {
            const next = items[itemIndex + 1]
            if (!next || next.isPage || next.categoryId !== 'accessories' || next.sourcePage !== sourcePage) break
            sourceProducts.push({ ...next, slot: ++slot })
            itemIndex++
          }
          flushPage()
          const sourceRows = sourcePage === 1
            ? [
                sourceProducts.filter(p => !(p.finishes?.length > 1 || p.variants?.length > 1 || /^led\s*-\s*0?8$/i.test(p.name || ''))),
                ...sourceProducts.filter(p => p.finishes?.length > 1 || p.variants?.length > 1 || /^led\s*-\s*0?8$/i.test(p.name || '')).map(p => [p]),
              ].filter(row => row.length)
            : sourceProducts.flatMap(p => {
                const productRow = [p]
                if (!p.supportStrip) return [productRow]
                const supportRow = []
                supportRow.supportFor = [p]
                return [productRow, supportRow]
              })
          const sourceGap = sourcePage === 1 ? 3 : 5
          // The imported LED source page has a normal product row followed by
          // the LED-08 variation row. Equal halves leave a large artificial
          // void between the photos, drawings and captions, so keep both rows
          // compact while preserving the source page and its ordering.
          // Foam Panel page 6 has one merged 5mm/8mm product followed by its
          // original feature/support strip. Give the two technical variations
          // the larger band they need; equal halves made the photos and drawings
          // collapse into a cluttered row.
          // Page 7's T Micro-Seam carries a usage example (photo + drawing +
          // example = 3 images) while H Micro-Seam only has photo + drawing.
          // An equal split sized both rows for the lighter H Micro-Seam content,
          // so T Micro-Seam's extra example overflowed its row and visually
          // bled into H Micro-Seam's card below it.
          const sourceRowHeights = sourcePage === 1 ? [94, 102]
            : sourcePage === 6 && sourceRows.length === 3 ? [82, 82, 87]
            : sourcePage === 6 ? [150, 93]
            : sourcePage === 7 ? [142, 114]
            : null
          const sourceRowH = sourceRowHeights?.[0] ?? Math.floor((PAGE_H - flowTop - BOTTOM_MARGIN - sourceGap * (sourceRows.length - 1)) / sourceRows.length)
          pages.push({ index: pages.length + 1, rows: sourceRows, blocks: [], rowH: sourceRowH, rowHeights: sourceRowHeights, rowGap: sourceGap, columns: sourcePage === 1 ? 6 : undefined, sourcePage })
          continue
        }
        // Keep a row explicitly identified in the source together. Supporting
        // material occupies a shared band beneath the cards, not extra product
        // rows. This rule uses source metadata, never a product-name guess.
        if(product.layoutRowGroup) {
          flushRow()
          const group=[product]
          while(itemIndex+1<items.length) {
            const next=items[itemIndex+1]
            if(!next||next.isPage||next.layoutRowGroup!==product.layoutRowGroup)break
            group.push({...next,slot:++slot});itemIndex++
          }
          const support=group.some(p=>p.supportStrip||usageExamples(p).some(e=>!isDimensionReference(e)))
          // A growing family stays together: wrap cards four across, then show
          // its original supporting material once after the final product.
          if(group.length>COLUMNS&&group.length<=COLUMNS*2){
            if(rows.length)flushPage()
            group.sourceGroup=true;group.sourceGroupBundle=true
            pages.push({index:pages.length+1,rows:[group],blocks:[]})
            continue
          }
          if(group.length>COLUMNS*2){
            if(rows.length)flushPage()
            let remaining=group
            while(remaining.length>COLUMNS*2){
              const chunk=remaining.slice(0,COLUMNS*2);remaining=remaining.slice(COLUMNS*2)
              const cardRows=[]
              for(let start=0;start<chunk.length;start+=COLUMNS){const row=chunk.slice(start,start+COLUMNS);row.sourceGroup=true;cardRows.push(row)}
              pages.push({index:pages.length+1,rows:cardRows,blocks:[]})
            }
            remaining.sourceGroup=true;remaining.sourceGroupBundle=true;remaining.supportForAll=group
            pages.push({index:pages.length+1,rows:[remaining],blocks:[]})
            continue
          }
          if(rows.length&&rows.length+(support?2:1)>rowsPerPage)flushPage()
          group.sourceGroup=true
          rows.push(group)
          if(support){const band=[];band.supportFor=group;rows.push(band)}
          while(rows.length>=rowsPerPage)pages.push({index:pages.length+1,rows:rows.splice(0,rowsPerPage),blocks:[]})
          continue
        }
        // Explicit source-related technical pairs share an existing wide row.
        // Ordinary products still use four columns; other drawings retain their
        // established wide layout.
        if(product.layoutPairGroup && !needsFullTechnicalRow(product)) {
          flushRow()
          const pair=[product],next=items[itemIndex+1]
          if(next && !next.isPage && next.layoutPairGroup===product.layoutPairGroup) {
            pair.push({...next,slot:++slot});itemIndex++
          }
          rows.push(pair)
          if(rows.length===rowsPerPage) {
            pages.push({index:pages.length+1,rows:rows.splice(0,rowsPerPage),blocks:[]})
          }
          continue
        }
        // A dimension drawing needs real width beside its product photo. Do not
        // squeeze that pair into a four-column grid: finish the current grid row,
        // then give this product the whole row so both source rectangles stay clear.
        const visibleDrawing = product.drawing && !(product.drawingPresentation === 'dimensions' && product.dimensionText)
        const supplementary = usageExamples(product).filter(example => !isDimensionReference(example))
        if (needsFullTechnicalRow(product) || visibleDrawing || supplementary.length) {
          flushRow()
          rows.push([product])
          if (rows.length === rowsPerPage) {
            pages.push({ index: pages.length + 1, rows: rows.splice(0, rowsPerPage), blocks: [] })
          }
          continue
        }
        cell.push(product)
        if (cell.length === COLUMNS) flushRow()
        if (rows.length === rowsPerPage) {
          pages.push({ index: pages.length + 1, rows: rows.splice(0, rowsPerPage), blocks: [] })
        }
      }
      flushPage()

      if (!pages.length && !positioned.length) pages.push({ index: 1, rows: [], blocks: [] })
      for (const plate of [...positioned].sort((a,b)=>a.pagePosition-b.pagePosition)) {
        pages.splice(Math.min(plate.pagePosition - 1, pages.length), 0, { plate, rows: [], blocks: [] })
      }
      pages.forEach((page,i)=>{page.index=i+1})
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
      { key: 'photoTreatmentMode', label: 'Photo treatment', type: 'select', options: [
        { value: '', label: 'Automatic / standalone product' },
        { value: 'preserve-scene', label: 'Keep original rectangular scene' },
      ] },
      { key: 'drawing', label: 'Dimension drawing (optional)', type: 'image',
        hint: 'never generated — upload it if this product has one' },
      { key: 'dimensionText', label: 'Ukuran dibaca daripada sumber', type: 'text' },
      { key: 'drawingPresentation', label: 'Paparan ukuran', type: 'select', options: [
        { value: '', label: 'Drawing asal' },
        { value: 'dimensions', label: 'Ukuran di bawah gambar produk' },
      ] },
      ...(p.examples?.length ? [{ key: 'exampleImages', label: 'Gambar contoh', type: 'gallery' }] : []),
      ...(p.sourceReferences?.length ? [{ key: 'sourceReferenceImages', label: 'Rujukan sumber untuk semakan', type: 'gallery' }] : []),
    ]),
  }
}
