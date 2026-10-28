import {crop,inkFromBright} from '../imageops.mjs'
import {ocr} from '../ocr.mjs'
const normalize=text=>String(text||'').toUpperCase().replace(/[^A-Z0-9]/g,'')
function containsCode(text,code){
 if(normalize(text).includes(normalize(code)))return true
 const expected=normalize(code).match(/^([A-Z]+)(\d+)([A-Z]?)$/)
 if(!expected)return normalize(text).includes(normalize(code))
 return (String(text).toUpperCase().match(/[A-Z][A-Z0-9-]{1,15}/g)||[]).some(token=>{
  const clean=normalize(token)
  if(!clean.startsWith(expected[1]))return false
  const tail=clean.slice(expected[1].length)
  const digits=tail.replace(/[OQ]/g,'0').replace(/[IL]/g,'1').replace(/S/g,'5')
  return /^\d+$/.test(digits)&&Number(digits)===Number(expected[2])
 })
}
// Page numbers alone are never evidence of a source layout. Confirm printed
// codes inside their expected source anchors before using fixed rectangles.
export async function fixedLayoutMatches(page,spec,pageNo,{readText=async image=>(await ocr(image)).text}={}) {
 if(spec.nonProductPages){
  const rules=spec.nonProductEvidence?.[pageNo]
  if(!rules)return false
  const text=normalize(await readText(page))
  return rules.every(rule=>rule.test(text))
 }
 if(spec.anchor?.type!=='fixed')return true
 if(!spec.anchor.pages?.includes(pageNo))return false
 const nameField=spec.kinds?.[0]?.fields?.find(f=>f.key==='name')
 const names=nameField?.valueByAnchor
 if(!names?.length)return false
 const mm=page.width/210
 for(let i=0;i<names.length;i++){
  const b=spec.anchor.boxes[i]
  const code=nameField.codeByAnchor?.[i]||names[i].match(/\b[A-Z]+[- ]?\d+[A-Z]?\b/i)?.[0]
  const evidence=nameField.codeEvidenceByAnchor?.[i]
  let codeConfirmed=false
  if(evidence&&code){
   const c=evidence.box
   const image=crop(page,Math.round((b.x+c.x)*mm),Math.round((b.y+c.y)*mm),Math.round(c.w*mm),Math.round(c.h*mm))
   codeConfirmed=containsCode(await readText(evidence.lightText?inkFromBright(image):image),code)
   if(!codeConfirmed)return false
  }
  const matches=text=>(codeConfirmed||(code?containsCode(text,code):normalize(text).includes(normalize(names[i]))))&&
    (!nameField.requiredTextByAnchor?.[i]||normalize(text).includes(normalize(nameField.requiredTextByAnchor[i])))
  const label=nameField.box
  const precise=label&&label.w*label.h>100
  const top=precise?crop(page,Math.round((b.x+label.x)*mm),Math.round((b.y+label.y)*mm),Math.round(label.w*mm),Math.round(label.h*mm)):
    crop(page,Math.round(b.x*mm),Math.round(b.y*mm),Math.round(b.w*mm),Math.round(Math.min(b.h,22)*mm))
  let text=await readText(top)
  if(!matches(text))text=await readText(crop(page,Math.round(b.x*mm),Math.round(b.y*mm),Math.round(b.w*mm),Math.round(b.h*mm)))
  if(!matches(text))return false
  for(const side of ['RIGHT','LEFT'])if(names[i].toUpperCase().includes(side)&&!normalize(text).includes(side))return false
 }
 return true
}
