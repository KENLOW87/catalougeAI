// A matching PDF rectangle alone is insufficient when an embedded image is
// reused with several transforms. Compare its pixels with the rendered source.
export function matchesRenderedPhoto(native,rendered){
 const ratio=(native.width/native.height)/(rendered.width/rendered.height)
 if(ratio<.85||ratio>1.15)return false
 let error=0,min=255,max=0
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){
  const sample=image=>{
   const i=(Math.min(image.height-1,Math.floor((y+.5)*image.height/16))*image.width+Math.min(image.width-1,Math.floor((x+.5)*image.width/16)))*4
   return [0,1,2].map(k=>image.data[i+k]*(image.data[i+3]/255)+255*(1-image.data[i+3]/255))
  }
  const a=sample(native),b=sample(rendered)
  const light=b.reduce((sum,n)=>sum+n,0)/3;min=Math.min(min,light);max=Math.max(max,light)
  error+=a.reduce((sum,n,k)=>sum+Math.abs(n-b[k]),0)
 }
 return max-min>=25 && error/(256*3)<=18
}
