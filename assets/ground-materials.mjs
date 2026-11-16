/* Optional local ground textures. Loading failure leaves colored geometry intact. */
const cache=new Map(),hex=/^[a-f0-9]{64}$/;
async function bytes(response,limit,signal){
 if(!response.ok)throw Error('Ground material unavailable');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)throw Error('Ground material size limit');parts.push(part.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
export async function loadGroundMaterials(quality,signal){
 if(!['low','medium','high'].includes(quality))throw Error('Unknown ground quality');
 signal.throwIfAborted();if(cache.has(quality))return cache.get(quality);
 const root=new URL('./ground-materials/',import.meta.url),bounded=AbortSignal.any([signal,AbortSignal.timeout(4000)]),created=[];
 try{
  const response=await fetch(new URL('manifest.json',root),{credentials:'omit',cache:'no-cache',signal:bounded}),manifest=JSON.parse(new TextDecoder().decode(await bytes(response,20000,bounded)));
  if(manifest.kind!=='illustrative-ground-materials'||manifest.schema_version!==1)throw Error('Invalid ground catalog');
  const expected={low:128,medium:256,high:512}[quality],result={};
  const outcomes=await Promise.allSettled(['grass','litter','dry'].map(async kind=>{
   const a=manifest.tiers?.[quality]?.[kind];
   if(!a||!hex.test(a.sha256)||a.path!==kind+'-'+a.sha256+'.jpg'||!Number.isInteger(a.bytes)||a.bytes<1||a.bytes>200000||a.width!==expected||a.height!==expected||a.tile_metres!==4)throw Error('Invalid ground material');
   const response=await fetch(new URL(a.path,root),{credentials:'omit',signal:bounded}),data=await bytes(response,a.bytes,bounded),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
   if(data.length!==a.bytes||digest!==a.sha256)throw Error('Ground checksum mismatch');
   const bitmap=await createImageBitmap(new Blob([data],{type:'image/jpeg'}),{imageOrientation:'flipY',premultiplyAlpha:'none'});created.push(bitmap);
   if(bitmap.width!==a.width||bitmap.height!==a.height)throw Error('Ground dimensions mismatch');
   result[kind]={sha256:a.sha256,bitmap,repeat:true,tile_metres:a.tile_metres,bytes:a.bytes};
  }));
  bounded.throwIfAborted();if(outcomes.some(x=>x.status==='rejected'))throw Error('Ground materials unavailable');
  cache.set(quality,result);return result;
 }catch(error){created.forEach(bitmap=>bitmap.close());throw error;}
}
