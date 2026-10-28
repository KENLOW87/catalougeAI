import assert from 'node:assert/strict'
import {readWithRules} from './readers/index.mjs'
import {readImage} from './imageops.mjs'
import {shutdownOcr} from './ocr.mjs'
let network=0
globalThis.fetch=async()=>{network++;throw new Error('Network forbidden in local source import test')}
try{
 for(const [n,names,counts] of [
  [4,['CSW - Coner Solid Wainscoting','CSW - Coner Wainscoting','C-R80','C-R100','GOLD PW02','GOLD PW03','GOLD PW05','GOLD PW06'],[0,0,0,0,0,0,0,0]],
  [5,['WB01','WB02','WB05','WB06','CW02','CW03','CW04'],[4,0,0,2,1,1,0]],
  [8,['M01 Full Mirror','M02 Quater Mirror','M03 Half Mirror'],[2,1,1]],
  [9,['M04 Full Diamond Mirror','M05 Bronze Brick Mirror'],[4,3]],
 ]){
  const image=readImage(`../.tmp/wains-inspect/page-${String(n).padStart(2,'0')}.png`)
  const result=await readWithRules(image,()=>{},n,{sourceImage:image})
  assert.deepEqual(result.products.map(p=>p.name),names,`Source page ${n}: printed-code recognition and source order`)
  assert.deepEqual(result.products.map(p=>p.examples?.length||0),counts,`Source page ${n}: correct example ownership`)
 }
 assert.equal(network,0)
 console.log('Actual local reader dispatch: source OCR confirms template before fixed crops; C-R products included in source order; WB/CW/M01-M05 examples correctly owned; zero network calls.')
}finally{await shutdownOcr()}
