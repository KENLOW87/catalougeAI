import {createHash} from 'node:crypto'
// Shared, local validation for every PDF reader. Source geometry and printed
// product codes take precedence over a model's proposed example assignment.
export const associationVersion = 1
export const validBox = b => b && ['x','y','w','h'].every(k=>Number.isFinite(b[k])) &&
  b.x>=0 && b.y>=0 && b.w>0 && b.h>0 && b.x+b.w<=1.001 && b.y+b.h<=1.001
const area=b=>b.w*b.h
const overlap=(a,b)=>validBox(a)&&validBox(b)?Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)):0
const normal=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'')
const code=p=>normal(p.code || String(p.name||'').match(/\b[A-Z]+[- ]?\d+[A-Z]?\b/i)?.[0])
const technical=e=>['drawing','dimensions','technical-sketch'].includes(e.role)
const sizeOnly=e=>/\d\s*(mm|cm|inch)\b/i.test(e.caption||'') &&
 !String(e.caption).replace(/\d+(?:\.\d+)?|\b(?:mm|cm|inch|size|width|height|length|thickness|w|h|l|t)\b/gi,'').replace(/[\s():x×*.,/–—-]/gi,'')
function ownerFromGeometry(box, products) {
 if(!validBox(box))return null
 const c={x:box.x+box.w/2,y:box.y+box.h/2}
 const ranked=products.filter(p=>validBox(p.sourceBox)).map(p=>{
  const b=p.sourceBox
  return {p,dx:Math.abs(c.x-b.x-b.w/2),dy:Math.abs(c.y-b.y-b.h/2)}
 })
 if(!ranked.length)return null
 // Same-column product cards establish horizontal source bands; cards on the
 // same row establish columns. Neither rule depends on catalogue/product names.
 const xs=ranked.map(r=>r.p.sourceBox.x+r.p.sourceBox.w/2)
 const ys=ranked.map(r=>r.p.sourceBox.y+r.p.sourceBox.h/2)
 const vertical=Math.max(...xs)-Math.min(...xs)<.12
 const horizontal=Math.max(...ys)-Math.min(...ys)<.12
 if(!vertical&&!horizontal){
  const rows=[]
  for(const r of [...ranked].sort((a,b)=>a.p.sourceBox.y-b.p.sourceBox.y)){
   const cy=r.p.sourceBox.y+r.p.sourceBox.h/2
   const row=rows.find(row=>Math.abs(row.cy-cy)<.1)
   if(row){row.items.push(r);row.cy=row.items.reduce((sum,item)=>sum+item.p.sourceBox.y+item.p.sourceBox.h/2,0)/row.items.length}
   else rows.push({cy,items:[r]})
  }
  rows.sort((a,b)=>Math.abs(c.y-a.cy)-Math.abs(c.y-b.cy))
  if(Math.abs(c.y-rows[0].cy)>.25 || (rows[1]&&Math.abs(c.y-rows[1].cy)-Math.abs(c.y-rows[0].cy)<.06))return null
  const items=rows[0].items.sort((a,b)=>a.dx-b.dx)
  return items.length===1 || items[1].dx-items[0].dx>=.06 ? items[0].p : null
 }
 ranked.forEach(r=>r.distance=vertical?r.dy:r.dx)
 ranked.sort((a,b)=>a.distance-b.distance)
 if(ranked[0].distance>.25 || (ranked[1]&&ranked[1].distance-ranked[0].distance<.06))return null
 return ranked[0].p
}
export function resolveAssociation(example, proposed, pageProducts) {
 const box=example.sourceBox
 if(example.role==='primary-card')return {kind:'reference',reason:'original-product-card',owner:proposed}
 const primary=pageProducts.find(p=>example.image===p.photo || example.image===p.photoOriginal ||
  (validBox(box)&&validBox(p.sourceBox)&&overlap(box,p.sourceBox)/area(p.sourceBox)>.65))
 if(primary)return {kind:'reference',reason:'original-product-card',owner:primary}
 const drawing=pageProducts.find(p=>example.image===p.drawing ||
  (validBox(box)&&validBox(p.sourceDrawingBox)&&overlap(box,p.sourceDrawingBox)/Math.min(area(box),area(p.sourceDrawingBox))>.7))
 if(drawing)return {kind:'reference',reason:'dimension-reference',owner:drawing}
 if(example.associationEvidence==='verified-source-layout'&&example.ownerName===proposed.name)return {kind:'example',owner:proposed}
 const printed=new Set(String(example.sourceText||'').toUpperCase().match(/\b[A-Z]+[- ]?\d+[A-Z]?\b/g)?.map(normal)||[])
 const owners=pageProducts.filter(p=>code(p)&&printed.has(code(p)))
 const owner=owners.length===1?owners[0]:owners.includes(proposed)?proposed:ownerFromGeometry(box,pageProducts)
 if(!owner)return {kind:'unassigned',reason:'Image ownership could not be confirmed'}
 const measurements=String(example.sourceText||'').match(/\d+(?:\.\d+)?\s*(?:mm|cm)\b/gi)||[]
 if(technical(example)||sizeOnly(example)||(measurements.length>=2&&/size|[x×]|width|height/i.test(example.sourceText||'')))return {kind:'drawing',owner,reason:'dimension-reference'}
 return {kind:'example',owner,relatedProductCodes:owners.length>1?owners.map(p=>p.code||p.name):undefined}
}
export async function validateImportedAssociations(products,{readText=async()=>'',onProgress=()=>{}}={}) {
 const warnings=[]
 // Snapshot examples before redistributing them so a moved image is never
 // processed twice or silently assigned to two unrelated products.
 const pending=products.filter(p=>!p.isPage).flatMap(p=>(p.examples||[]).map(e=>({p,e})))
 for(const p of products)if(!p.isPage){p.examples=[];p.imageAssociationVersion=associationVersion}
 const seen=new Set()
 for(const {p,e:original} of pending){
  const e={...original}, peers=products.filter(q=>!q.isPage&&q.sourcePage===p.sourcePage&&q.categoryId===p.categoryId)
  const unique=`${p.sourcePage}:${p.categoryId}:${createHash('sha256').update(e.image||'').digest('hex')}`
  if(seen.has(unique))continue
  seen.add(unique)
  if(!e.sourceText&&e.associationEvidence!=='verified-source-layout'){
   onProgress(`Semak padanan gambar: ${p.name}…`)
   try{e.sourceText=await readText(e.image)}catch{}
  }
  const result=resolveAssociation(e,p,peers)
  if(result.kind==='example'){
   result.owner.examples.push({...e,ownerProductId:result.owner.id,associationEvidence:e.associationEvidence==='verified-source-layout'?e.associationEvidence:e.sourceText?'printed-code-and-source':'source-geometry',
    ...(result.relatedProductCodes?{relatedProductCodes:result.relatedProductCodes}:{})})
   continue
  }
  if(result.kind==='drawing'&&!result.owner.drawing){
   result.owner.drawing=e.image;result.owner.sourceDrawingBox=e.sourceBox;result.owner.drawingPreserved=true;continue
  }
  const owner=result.owner||p
  owner.sourceReferences=[...(owner.sourceReferences||[]),{...e,reason:result.reason}]
  if(result.kind==='unassigned'||result.kind==='drawing'){
   owner.imageAssociationIssues=[...(owner.imageAssociationIssues||[]),result.reason]
   warnings.push(`${owner.name}: ${result.reason}; gambar sumber disimpan untuk semakan.`)
  }
 }
 return warnings
}
