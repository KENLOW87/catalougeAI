import React, { useEffect, useState } from 'react'
import { Badge, Hit } from './bits.jsx'
import PvcPage from './PvcPage.jsx'
import { PVC_SEED } from '../lib/categories/pvc.js'
import { prepareDrawingDisplay } from '../lib/drawing-display.js'
import { usageExamples, isDimensionReference, exampleHeading, examplesBesideProduct } from '../lib/product-layout.js'
import { isOriginalProductCard } from '../lib/source-photo-match.js'

function DrawingImage({ src }) {
  const [prepared, setPrepared] = useState(null)
  useEffect(() => {
    let active = true
    prepareDrawingDisplay(src).then(image => { if (active) setPrepared({ source:src, image }) })
      .catch(() => { if (active) setPrepared({ source:src, image:src }) })
    return () => { active = false }
  }, [src])
  const ready = prepared?.source === src
  return <img src={ready ? prepared.image : src} data-drawing-pending={ready ? undefined : 'true'} alt="Dimension drawing" />
}

// The default catalogue page.
//
// LED and PVC Marble have bespoke templates that reproduce their original pages.
// Every other product family gets this one: a grid of product photos with the name
// and second line beneath each — which is the shape most catalogues already use,
// and exactly what the photo-grid reader pulls out of them.
//
// It is deliberately plain. It is not trying to reproduce a specific design; it is
// trying to be a correct, consistent catalogue page with no setup at all.

function Cell({ p, editable, onEdit, onDelete, highlighted, supplementaryInBand = false, tiledDisplays = [], stackedVisuals = false, featuredVisuals = false }) {
  const dimensionsOnly = p.drawingPresentation === 'dimensions' && p.dimensionText
  const showDrawing = p.drawing && !dimensionsOnly
  const inCell = example => !supplementaryInBand || (example.displayPlacement?.mode === 'beside-product' && !tiledDisplays.includes(example.image))
  const candidates = usageExamples(p).filter(inCell)
  const [checkedExamples, setCheckedExamples] = useState(null)
  const checkKey = p.photoOriginal || p.photo
  useEffect(() => {
    let active = true
    const list = usageExamples(p).filter(inCell).filter(example => !isDimensionReference(example))
    Promise.all(list.map(async example => ({ example, duplicate: await isOriginalProductCard(p.photoOriginal || (p.photoTreatmentMode === 'preserve-scene' ? p.photo : null), example.image) })))
      .then(results => { if(active)setCheckedExamples({ key:checkKey, source:p.examples, extra:p.extra, examples:results.filter(r=>!r.duplicate).map(r=>r.example) }) })
    return () => {active=false}
  }, [checkKey,p.examples,p.extra,p.extraRole,supplementaryInBand,tiledDisplays.join('|')])
  const checked = checkedExamples?.key === checkKey && checkedExamples?.source === p.examples && checkedExamples?.extra === p.extra
  const examples = checked ? checkedExamples.examples : candidates.filter(example => !isDimensionReference(example))
  const variants = (p.finishes ?? p.variants ?? []).filter(v => v?.photo)
  const sideBySide = examplesBesideProduct(examples)
  const technicalPair = p.layoutPairGroup === 'aluminium-corners' && showDrawing && !examples.length
  const exampleColumns = Math.min(sideBySide ? 2 : 4, examples.length)
  return (
    <div className={`dp-item ${examples.length ? 'dp-item--examples' : ''} ${sideBySide ? 'dp-item--display-examples' : ''} ${technicalPair ? 'dp-item--technical-pair' : ''} ${editable && highlighted ? 'cell--highlighted' : ''}`} id={editable ? `product-${p.id}` : undefined}
         data-examples-pending={!checked && candidates.length ? 'true' : undefined}
         style={examples.length ? { '--example-image-size': examples.length > 4 ? '22mm' : '32mm' } : undefined}>
      <Badge n={p.slot} variant="default" />
      <div className={`dp-visuals ${showDrawing ? 'dp-visuals--paired' : ''} ${variants.length ? 'dp-visuals--variants' : ''} ${stackedVisuals ? 'dp-visuals--stacked' : ''} ${featuredVisuals ? 'dp-visuals--featured' : ''}`}>
        <div className="dp-photo">
          {variants.length ? (
            <div className="dp-variants" aria-label={`${p.name} variations`}>
              {variants.map((v, i) => <figure key={v.id || i}>
                <img className={v.photoDisplayBackground === 'dark-neutral' ? 'photo-contrast-dark' : undefined} src={v.photo} alt={v.name || `${p.name} variation ${i + 1}`} />
                {v.name && <figcaption>{v.name}</figcaption>}
              </figure>)}
            </div>
          ) : p.photo
            ? <img className={p.photoDisplayBackground === 'dark-neutral' ? 'photo-contrast-dark' : undefined} src={p.photo} alt={p.name} />
            : <span className="dp-missing">no photo</span>}
        </div>
        {showDrawing && (
          <div className="dp-drawing-frame">
            {examples.length ? <img src={p.drawing} alt="Dimension drawing" /> : <DrawingImage src={p.drawing} />}
          </div>
        )}
      </div>
      {examples.length > 0 && (
        <div className="dp-examples">
          <div className="dp-examples-title">{exampleHeading(examples)}</div>
          <div className="dp-examples-grid" style={{ gridTemplateColumns: `repeat(${exampleColumns}, minmax(0, 1fr))` }}>
            {examples.map((example, i) => (
              <figure key={i}>
                <img src={example.image} alt={example.caption || `${p.name} — gambar tambahan ${i + 1}`} />
                {example.caption && <figcaption>{example.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </div>
      )}
      <div className="dp-name">{p.name}</div>
      {(dimensionsOnly || p.subtitle || p.third) && (
        <div className="dp-sub">{[dimensionsOnly ? p.dimensionText : p.subtitle, p.third].filter(Boolean).join(' · ')}</div>
      )}
      {editable && <Hit product={p} onEdit={onEdit} onDelete={onDelete} />}
    </div>
  )
}

function SourceSupportBand({ products, compact = false }) {
  const originalEntries=products.map(p=>({p,examples:usageExamples(p).filter(e=>!isDimensionReference(e)&&e.displayPlacement?.mode!=='beside-product')}))
    .filter(({p,examples})=>p.supportStrip||examples.length)
  const before = originalEntries.flatMap(({p,examples}) => {
    const selected = examples.filter(e=>e.origin==='manual-display'&&e.displayPlacement?.order==='before')
    return selected.length ? [{p:{...p,supportStrip:null,supportCaption:null},examples:selected,key:`${p.id}:before`}] : []
  })
  const after = originalEntries.map(({p,examples})=>({p,examples:examples.filter(e=>!(e.origin==='manual-display'&&e.displayPlacement?.order==='before')),key:p.id}))
    .filter(({p,examples})=>p.supportStrip||examples.length)
  const entries = [...before,...after]
  return <div className={`dp-source-support ${compact?'dp-source-support--compact':''}`} style={compact?undefined:{gridTemplateRows:`repeat(${entries.length}, minmax(0, 1fr))`}}>
    {entries.map(({p,examples,key})=><section className="dp-source-support-entry" key={key} data-support-owner={p.name}
      style={p.supportStrip&&examples.some(e=>e.origin==='manual-display')?{gridTemplateRows:compact?'4mm auto 36mm':'4mm minmax(0,1fr) minmax(0,1fr)'}:undefined}>
      <div className="dp-source-support-title">{p.supportCaption||`${p.name}${p.supportStrip?'':` — ${exampleHeading(examples)}`}`}</div>
      {p.supportStrip && <img className="dp-source-support-strip" src={p.supportStrip} alt={`${p.name} — penerangan asal`} />}
      {(!p.supportStrip || examples.some(e=>e.origin==='manual-display')) &&
        <div className="dp-source-support-gallery" style={{gridTemplateColumns:`repeat(${Math.min(4,examples.length)}, minmax(0, 1fr))`}}>
          {examples.filter(e=>!p.supportStrip||e.origin==='manual-display').map((e,i)=><figure key={i}><img src={e.image} alt={e.caption||`${p.name} — gambar sokongan ${i+1}`}/>{e.caption&&<figcaption>{e.caption}</figcaption>}</figure>)}
        </div>}
    </section>)}
  </div>
}

function SourceGroupCards({ row, columns, editable, onEdit, onDelete, highlight }) {
  // Use an existing empty grid cell beside the final product. Full source rows
  // retain their four columns; elsewhere the display shares its product panel.
  const last = row.at(-1)
  const empty = (columns - row.length % columns) % columns
  const tiles = usageExamples(last).filter(e => e.displayPlacement?.mode === 'beside-product').slice(0, empty)
  return <div className="dp-source-group-cards" style={{gridTemplateColumns:`repeat(${columns}, minmax(0,1fr))`,gridTemplateRows:`repeat(${Math.ceil(row.length/columns)}, minmax(0,1fr))`}}>
    {row.map(p=><Cell key={p.id} p={p} editable={editable} onEdit={onEdit} onDelete={onDelete} highlighted={highlight.includes(p.id)} supplementaryInBand tiledDisplays={p.id===last.id?tiles.map(e=>e.image):[]} stackedVisuals={false}/>)}
    {tiles.map((e,i)=><figure className="dp-inline-display" key={e.displayId||i} data-display-anchor={last.id}>
      <img src={e.image} alt={`Display — ${last.name}`} />
      <figcaption>{e.caption||`Display — ${last.name}`}</figcaption>
    </figure>)}
  </div>
}

export default function DefaultPage({ page, editable, onEdit, onDelete, category, highlight = [] }) {
  const columns = page.columns ?? category?.columns ?? 4
  const headerH = category?.headerH ?? 24
  const flowTop = category?.flowTop ?? headerH + 4
  const rowH = category?.rowH ?? 118
  const pageRowH = page.rowH ?? rowH
  const stackedSourcePage = page.index === 1 || page.sourcePage === 1 || page.rows.some(row => row.some(p => p?.categoryId === 'accessories' && p.sourcePage === 1))

  // Mixed Accessories PDFs contain the same PVC Marble source pages as the
  // dedicated PVC catalogue. Keep those rows on the original one-product-per-
  // row template instead of silently sending them through the generic grid.
  const pvcProducts = page.rows.flat()
  const pvcSourcePage = pvcProducts.length > 0 && pvcProducts.every(p => {
    const sourceSeries = [p?.series, p?.third, p?.subtitle, p?.size].filter(Boolean).join(' ')
    const sourceVariants = p?.variants ?? p?.finishes
    return Boolean(p?.categoryId === 'accessories' && p?.sourcePage >= 2 && (p?.photo || (Array.isArray(sourceVariants) && sourceVariants.length)) && /pvc\s*marble/i.test(String(sourceSeries)))
  })
  if (pvcSourcePage) {
    const pvcRows = pvcProducts.map((p, index) => {
      const sourceVariants = p.variants ?? p.finishes ?? []
      const sourceIndex = page.sourcePage === 2 ? index : page.sourcePage === 3 ? index + 4 : -1
      const sourceTemplate = !sourceVariants.length && PVC_SEED[sourceIndex]
      const sourceTemplateVariants = sourceTemplate?.variants ?? []
      const cornerExtra = sourceIndex === 4
        ? (sourceTemplate?.extra ?? (typeof p.extra === 'string' ? p.extra : (p.extra?.image || p.extra?.photo || null)))
        : null
      let variants = sourceVariants.length
        ? sourceVariants
        : (sourceTemplateVariants.length ? sourceTemplateVariants : (p.photo ? [{ id: `${p.id}-source-photo`, photo: p.photo, name: '' }] : []))
      if (cornerExtra && variants.length === 4 && sourceIndex === 4 && !variants[3].secondaryPhoto) {
        variants = [...variants.slice(0, 3), { ...variants[3], secondaryPhoto: cornerExtra }]
      }
      const extra = sourceIndex === 4 ? null : (sourceTemplate?.extra ?? (typeof p.extra === 'string'
        ? p.extra
        : (p.extra?.image || p.extra?.photo || (p.examples?.length === 1 ? p.examples[0]?.image : null) || null)))
      const rawSize = p.size ?? p.subtitle ?? ''
      return { ...p,
      size: String(rawSize).replace(/^size\s*:\s*/i, ''),
      series: p.series || p.third || 'PVC Marble',
      variants,
      extra,
      exceptions: p.exceptions ?? sourceTemplate?.exceptions ?? null,
      sourceComposite: !sourceTemplate && !sourceVariants.length && Boolean(p.photo),
      sourceTall: !sourceTemplate && !sourceVariants.length && Boolean(p.photo) && page.sourcePage === 3 && index === 1,
      }
    })
    return <PvcPage page={{ ...page, rows: pvcRows }} editable={editable}
      onEdit={onEdit} onDelete={onDelete} highlight={highlight} />
  }

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
          <div className={`dp-row ${row.sourceGroup ? 'dp-row--source-group' : ''} ${row.sourceGroupBundle?'dp-row--source-bundle':''} ${row.supportFor ? 'dp-row--support' : ''} ${row.length === 1 && row[0].drawing ? 'dp-row--single' : ''}`} key={i}
               style={{ gridTemplateColumns: row.sourceGroupBundle?'minmax(0,1fr)':`repeat(${Math.max(1, Math.min(columns, row.length))}, minmax(0, 1fr))`, height: `${row.sourceGroupBundle ? 289-flowTop : (page.rowHeights?.[i] ?? pageRowH)}mm`, marginBottom: `${page.rowGap ?? 5}mm` }}>
            {row.sourceGroupBundle ? <div className="dp-source-group-bundle">
              <SourceGroupCards row={row} columns={columns} editable={editable} onEdit={onEdit} onDelete={onDelete} highlight={highlight}/>
              <SourceSupportBand products={row.supportForAll||row} compact/>
            </div> : row.supportFor ? <SourceSupportBand products={row.supportFor}/> : row.map(p => (
              <Cell key={p.id} p={p} editable={editable} onEdit={onEdit} onDelete={onDelete}
                    highlighted={highlight.includes(p.id)} supplementaryInBand={Boolean(row.sourceGroup)} stackedVisuals={stackedSourcePage && !((p.finishes?.length > 1) || (p.variants?.length > 1) || /^led\s*-\s*0?8$/i.test(p.name || ''))} featuredVisuals={stackedSourcePage && ((p.finishes?.length > 1) || (p.variants?.length > 1) || /^led\s*-\s*0?8$/i.test(p.name || ''))} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
