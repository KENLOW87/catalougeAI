// Sort codes naturally within their existing family. Family order and kept PDF
// pages remain deliberate; duplicate codes keep their original relative order.
export function productSeries(product) {
  if(product.isPage)return null
  const match=String(product.code||product.name||'').trim().toUpperCase()
    .match(/^((?:[A-Z]+[ -]+)*[A-Z]+)[ -]*(\d+)([A-Z]?)(?=$|[^A-Z0-9])/)
  return match?{family:match[1].replace(/[ -]+/g,' '),number:Number(match[2]),suffix:match[3]}:null
}

export function orderProductFamilies(items) {
  // A recognised source PDF is already the authority for its sequence. The
  // Accessories March file intentionally prints LED-160/170/195/508/15/601/08
  // in that order; natural family sorting would silently move LED-08 and LED-15
  // to the front. Keep that source order for this mixed import while retaining
  // natural sorting for manually-added/product-series records elsewhere.
  if (items.some(p => p.categoryId === 'accessories' && Number.isFinite(p.sourcePage))) return items
  const output=[]
  const block=items=>{
    const sourceGroups=new Map(),families=new Map()
    for(const p of items){
      const series=productSeries(p)
      if(!series)continue
      if(!families.has(series.family))families.set(series.family,[])
      families.get(series.family).push({p,series,index:families.get(series.family).length})
      if(p.layoutRowGroup){
        if(!sourceGroups.has(series.family))sourceGroups.set(series.family,new Set())
        sourceGroups.get(series.family).add(p.layoutRowGroup)
      }
    }
    const emitted=new Set()
    for(const p of items){
      const series=productSeries(p)
      if(!series){output.push(p);continue}
      if(emitted.has(series.family))continue
      emitted.add(series.family)
      const group=sourceGroups.get(series.family)
      for(const {p:member} of families.get(series.family).sort((a,b)=>a.series.number-b.series.number||a.series.suffix.localeCompare(b.series.suffix)||a.index-b.index)){
        // Inherit grouping only, never copy another product's image or display.
        const canJoin=!member.layoutRowGroup&&!member.layoutPairGroup&&!member.layoutFullRow&&
          !(member.drawing&&!(member.drawingPresentation==='dimensions'&&member.dimensionText))&&group?.size===1
        output.push(canJoin?{...member,layoutRowGroup:[...group][0]}:member)
      }
    }
  }
  let pending=[]
  for(const item of items){
    if(item.isPage){block(pending);pending=[];output.push(item)}else pending.push(item)
  }
  block(pending)
  return output
}

export function upsertSeriesProduct(items,product) {
  const existing=items.find(p=>p.id===product.id)
  if(existing)return orderProductFamilies(items.map(p=>p.id===product.id?product:p))
  const series=productSeries(product)
  let index=items.length
  if(series){
    for(let i=items.length-1;i>=0;i--)if(productSeries(items[i])?.family===series.family){index=i+1;break}
  }
  const next=[...items];next.splice(index,0,product)
  return orderProductFamilies(next)
}
