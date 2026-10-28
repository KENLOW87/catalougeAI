import reviewedCrops from './reviewed-source-crops.js'
// One-time correction of the reviewed Jan 2026 source import. No AI image editing,
// model requests, guessed replacements, or changes to product order.
const revision = 'wains-jan2026-placement-v1'
const cropRevision = 'wains-jan2026-source-crops-v2'
export function repairSourcePlacement(products) {
  // New imports have already passed the shared source-association validator.
  // Legacy one-off source crops must never overwrite a newly uploaded PDF.
  if(products.some(p=>p.imageAssociationVersion))return products
  const names = new Map(products.map(p => [p.name,p]))
  if (!['CW02','CW03','CW04','WB06','M01 Full Mirror','M02 Quater Mirror'].every(n => names.has(n))) return products
  const patches = new Map()
  const patch = (p, changes) => {
    if (p.sourcePlacementRepair === revision) return
    patches.set(p.id, {...p, sourcePlacementBackup: p.sourcePlacementBackup || {
      drawing:p.drawing, drawingOriginal:p.drawingOriginal, drawingPresentation:p.drawingPresentation,
      dimensionText:p.dimensionText, examples:p.examples,
    }, ...changes, sourcePlacementRepair:revision})
  }
  // The first supplementary crop in these erroneous imports is the complete
  // dimension reference; the drawing field is just its severed top ruler.
  for (const name of ['CW02','CW03','CW04']) {
    const p=names.get(name)
    if (p.sourcePlacementRepair || !p.drawing || !p.examples?.length) continue
    if (p.examples.length !== (name === 'CW04' ? 1 : 2)) continue
    patch(p,{drawing:p.examples[0].image, drawingPresentation:'',
      examples:p.examples.slice(1).map(e=>({...e,role:'usage',caption:e.caption || `Pemasangan ${name}`}))})
  }
  const full=names.get('M01 Full Mirror'), quarter=names.get('M02 Quater Mirror')
  if (!full.sourcePlacementRepair && !quarter.sourcePlacementRepair && full.examples?.length===3 && !quarter.examples?.length) {
    patch(full,{examples:full.examples.slice(0,2).map(e=>({...e,role:'usage'}))})
    patch(quarter,{examples:[{...full.examples[2],role:'usage'}]})
  }
  const bend=names.get('WB06')
  if (!bend.sourcePlacementRepair && bend.examples?.length===2) {
    patch(bend,{examples:bend.examples.map((e,i)=>({...e,role:'usage',
      caption:`Pemasangan WB06 dengan ${i===0?'CW02':'CW03'}`, relatedProductCodes:['WB06',i===0?'CW02':'CW03']}))})
  }
  // These are exact rectangular crops of the source PDF, including the full
  // original dimension references. The earlier crops cut M03's product off and
  // included neighbouring photos/dividers inside mirror drawing fields.
  for (const [name,fields] of Object.entries(reviewedCrops)) {
    const original=names.get(name)
    const fieldRevision=name.startsWith('C-R')?'wains-jan2026-corner-crops-v3':cropRevision
    if (!original || original.sourceCropRepair === fieldRevision) continue
    const p=patches.get(original.id)||original
    patches.set(p.id,{...p,sourceCropBackup:p.sourceCropBackup || {
      photo:p.photo,drawing:p.drawing,examples:p.examples,
    },...fields,sourceCropRepair:fieldRevision,
    ...(name==='M03 Half Mirror'?{examples:(p.examples||[]).map(e=>({...e,role:'usage'}))}:{})})
  }
  let result=patches.size ? products.map(p=>patches.get(p.id)||p) : products
  // The source has FOUR WB cards across, followed by a shared supporting band.
  // Supplementary photos must not turn members of this source row into heroes.
  if(['WB01','WB02','WB05','WB06'].every(name=>names.has(name))) {
    let grouped=false
    result=result.map(p=>{
      if(!['WB01','WB02','WB05','WB06'].includes(p.name)||p.sourceRowRepair==='wb-source-row-v1')return p
      grouped=true
      return {...p,layoutRowGroup:'wains-bendable-profiles',sourceRowRepair:'wb-source-row-v1',
        ...(p.name==='WB01'?{supportStrip:'/assets/reviewed/wb01-support-strip.png'}:{})}
    })
    if(!grouped&&!patches.size)result=products
  }
  // The two corner close-ups and the WB06 installation scenes form ONE source
  // strip. Retain example records/ownership; only declare where they display.
  if(names.get('WB06')?.examples?.length===2 && names.has('CW02') && names.has('CW03')) {
    let shared=false
    const arranged=result.map(p=>{
      if(!['WB06','CW02','CW03'].includes(p.name)||p.sourceUsageGroupRepair==='wb06-corners-v1')return p
      shared=true
      return {...p,sourceUsageGroupRepair:'wb06-corners-v1',
        ...(p.name==='WB06'?{supportStrip:'/assets/reviewed/wb06-corner-installation-strip.png',
          supportCaption:'Contoh pemasangan WB06 bersama CW02 / CW03'}:
          {examples:(p.examples||[]).map(e=>({...e,displayWithProductCode:'WB06',relatedProductCodes:['WB06',p.name]}))})}
    })
    if(shared)result=arranged
  }
  const cornerNames=['CSW - Coner Solid Wainscoting','CSW - Coner Wainscoting']
  if (cornerNames.every(name=>names.has(name))) {
    let changed=false
    const grouped=result.map(p=>{
      if(cornerNames.includes(p.name) && p.layoutPairGroup!=='csw-corners') {
        changed=true;return {...p,layoutPairGroup:'csw-corners'}
      }
      return p
    })
    const missing=['C-R80','C-R100'].filter(name=>!names.has(name)).map(name=>({
      id:`source-jan2026-${name.toLowerCase()}`,name,subtitle:'Aluminium Corner Edge',
      ...reviewedCrops[name],layoutPairGroup:'aluminium-corners',sourcePage:4,
      sourceFile:'Wainscoting & Mirror (Jan 2026).pdf',sourceCropRepair:'wains-jan2026-corner-crops-v3',
    }))
    if (missing.length) {
      const index=grouped.findIndex(p=>p.name===cornerNames[1])+1
      grouped.splice(index,0,...missing);changed=true
    }
    if(changed)result=grouped
  }
  if(cornerNames.every(name=>names.has(name))){
    let changed=false
    const complete=result.map(p=>{
      const index=cornerNames.indexOf(p.name)
      if(index<0||p.sourceProfileCropRepair==='csw-complete-v2')return p
      changed=true
      const photo=`/assets/reviewed/csw-${index===0?'solid':'corner'}-full-photo.png`
      const drawing=`/assets/reviewed/csw-${index===0?'solid':'corner'}-full-drawing.png`
      return {...p,photo,photoOriginal:photo,drawing,drawingOriginal:drawing,drawingPreserved:true,
        layoutFullRow:true,sourceProfileCropRepair:'csw-complete-v2',
        sourceProfileCropBackup:{photo:p.photo,photoOriginal:p.photoOriginal,drawing:p.drawing,drawingOriginal:p.drawingOriginal,...p.sourceProfileCropBackup}}
    })
    if(changed)result=complete
  }
  return result
}
