import { loadImageForCanvas } from './load-image.js'

const memo = new Map()
async function pixels(src) {
  const image = await loadImageForCanvas(src)
  const ratio = Math.min(1, 160 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
  const ctx = canvas.getContext('2d', { willReadFrequently:true })
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height)
  ctx.drawImage(image,0,0,canvas.width,canvas.height)
  return { width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data }
}

// Existing catalogues may already carry the original product card as an example.
// Match the ORIGINAL photo, never an AI-altered silhouette, inside that card.
// This is local pixel matching; it does not call OpenAI or alter source images.
export function isOriginalProductCard(original, candidate) {
  if (!original || !candidate) return Promise.resolve(false)
  if (original === candidate) return Promise.resolve(true)
  const key = original + '\n' + candidate
  if (memo.has(key)) return memo.get(key)
  const work = (async () => {
    const [source, card] = await Promise.all([pixels(original),pixels(candidate)])
    const samples = []
    for(let y=0;y<10;y++)for(let x=0;x<10;x++){
      const sx=Math.min(source.width-1,Math.floor((x+.5)*source.width/10))
      const sy=Math.min(source.height-1,Math.floor((y+.5)*source.height/10))
      const i=(sy*source.width+sx)*4
      samples.push({x:(x+.5)/10,y:(y+.5)/10,r:source.data[i],g:source.data[i+1],b:source.data[i+2]})
    }
    if(samples.filter(s=>Math.min(s.r,s.g,s.b)<225).length<15) return false
    const aspect=source.height/source.width
    for(let w=Math.max(12,Math.floor(card.width*.3));w<=card.width;w+=2){
      const h=Math.round(w*aspect)
      if(h>card.height)continue
      for(let y=0;y<=card.height-h;y+=2)for(let x=0;x<=card.width-w;x+=2){
        let error=0
        for(const s of samples){
          const i=((y+Math.min(h-1,Math.floor(s.y*h)))*card.width+x+Math.min(w-1,Math.floor(s.x*w)))*4
          error+=Math.abs(s.r-card.data[i])+Math.abs(s.g-card.data[i+1])+Math.abs(s.b-card.data[i+2])
          if(error>2400)break
        }
        if(error<=2400)return true
      }
    }
    return false
  })().catch(()=>false)
  if(memo.size>=32)memo.clear()
  memo.set(key,work)
  return work
}
