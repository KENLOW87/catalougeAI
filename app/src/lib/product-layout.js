import {orderProductFamilies} from './product-order.js'
import {withDisplaySeriesLayout} from './display-image.js'

export const usageExamples = product => (product.examples ?? []).filter(example =>
  example.role !== 'primary-card' && example.image !== product.photo && example.image !== product.photoOriginal)
  .concat(!product.examples?.length && product.extra && product.extraRole === 'usage'
    ? [{ image: product.extra, caption: '' }] : [])

// A size-only caption describes a product reference, not its use. Keep the
// original record and pagination input; exclude it only from the example view.
export function isDimensionReference(example) {
  const caption = (example.caption || '').trim()
  return /\d\s*(?:mm|cm|m|inch|inches)\b/i.test(caption) &&
    !caption.replace(/\d+(?:\.\d+)?/g, '').replace(/\b(?:mm|cm|m|inch|inches|size|w|h|l|t|width|height|length|thickness)\b/gi, '').replace(/[\s():×xX*.,/–—-]/g, '')
}

export function exampleHeading(examples) {
  return examples.every(e => e.role === 'usage' || /fold|backward|sticker|installed|installation|application|penggunaan|pemasangan/i.test(e.caption || ''))
    ? 'Contoh penggunaan' : 'Gambar tambahan'
}

// Display/installation photos belong beside the product, including when there
// is also a drawing or more than one display photo. Folding instruction
// sequences retain the approved horizontal gallery beneath the main/drawing.
export function examplesBesideProduct(examples) {
  return examples.length > 0 && !examples.some(example =>
    example.presentation === 'sequence' || /\bfold(?:ed|ing)?\b|\blipat\b/i.test(example.caption || '') ||
    (examples.length > 1 && /\bsticker\b|\bbacking\b|\brear\b/i.test(example.caption || '')))
}

// A shared installation may contain several product codes. Display its close-up
// references once in the explicitly declared source band, keeping stored owners
// and source records intact. Missing destinations retain the original display.
export function groupSharedUsage(items) {
  const destinations=new Map(items.filter(p=>p.supportStrip&&p.layoutRowGroup)
    .map(p=>[(p.code||p.name||'').trim().toUpperCase(),p]))
  const patches=new Map()
  for(const source of items) {
    for(const example of source.examples||[]) {
      const target=destinations.get((example.displayWithProductCode||'').trim().toUpperCase())
      if(!target||target.id===source.id)continue
      const currentSource=patches.get(source.id)||source
      patches.set(source.id,{...currentSource,examples:(currentSource.examples||[]).filter(e=>e!==example)})
      const currentTarget=patches.get(target.id)||target
      if(!(currentTarget.examples||[]).some(e=>e.image===example.image))
        patches.set(target.id,{...currentTarget,examples:[...(currentTarget.examples||[]),{...example,sourceOwnerName:source.name}]})
    }
  }
  return patches.size ? items.map(p=>patches.get(p.id)||p) : items
}

export const needsFullTechnicalRow = product => Boolean(product.layoutFullRow ||
  ['csw-corners','aluminium-corners'].includes(product.layoutPairGroup))

// A complete ordinary grid can fill the row after a photo/display product,
// ahead of a contiguous technical section. Never cross kept source pages or
// move an incomplete grid, another drawing, or a source-declared support group.
export function orderTechnicalSpace(items) {
  items=withDisplaySeriesLayout(orderProductFamilies(items))
  const output=[]
  const ordinary=p=>p&&!p.isPage&&!p.layoutRowGroup&&!p.layoutPairGroup&&!needsFullTechnicalRow(p)&&
    !(p.drawing&&!(p.drawingPresentation==='dimensions'&&p.dimensionText))&&
    !usageExamples(p).some(e=>!isDimensionReference(e))
  for(let i=0;i<items.length;i++){
    const previous=output.at(-1)
    if(needsFullTechnicalRow(items[i])&&previous&&!previous.isPage&&!previous.drawing&&
      usageExamples(previous).some(e=>!isDimensionReference(e))){
      let end=i
      while(end<items.length&&needsFullTechnicalRow(items[end]))end++
      const fill=items.slice(end,end+4)
      if(fill.length===4&&fill.every(ordinary)){
        output.push(...fill,...items.slice(i,end));i=end+3;continue
      }
    }
    output.push(items[i])
  }
  return output
}
