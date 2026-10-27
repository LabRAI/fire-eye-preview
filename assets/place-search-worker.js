'use strict';
importScripts('fflate.js?v=462ef8041fc970e3','place-search-core.js?v=636d6417ffcc34be');
let engine, metadata, loading;
const MAX_COMPRESSED=2000000, MAX_RAW=8000000;
const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),n=>n.toString(16).padStart(2,'0')).join('');
function assetURL(value){
 const u=new URL(value,self.location.href);
 if(u.origin===self.location.origin&&u.pathname.startsWith(new URL('.',self.location.href).pathname+'places/')&&!u.search&&!u.hash)return u.href;
 if(u.protocol==='https:'&&u.hostname==='huggingface.co'&&/^\/datasets\/yx21e\/fire-eye-forecasts-preview\/resolve\/[a-f0-9]{40}\/gazetteer\//.test(u.pathname)&&!u.search&&!u.hash&&!u.username&&!u.password)return u.href;
 throw Error('Unsupported source');
}
async function read(url,limit){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);let reader;
 try{
  const response=await fetch(assetURL(url),{credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
  if(!response.ok||Number(response.headers.get('Content-Length'))>limit)throw Error('Source unavailable');
  reader=response.body.getReader();let size=0,chunks=[];
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)throw Error('Source exceeds limit');chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
 }finally{clearTimeout(timer);if(reader)await reader.cancel().catch(()=>{});controller.abort();}
}
function unpack(bytes,expected){
 if(bytes.length<18||new DataView(bytes.buffer,bytes.byteOffset+bytes.length-4,4).getUint32(0,true)!==expected)throw Error('Invalid compressed length');
 let size=0;const chunks=[],stream=new fflate.Gunzip(chunk=>{size+=chunk.length;if(size>expected)throw Error('Source exceeds limit');chunks.push(chunk);});
 for(let offset=0;offset<bytes.length;offset+=65536)stream.push(bytes.subarray(offset,offset+65536),offset+65536>=bytes.length);
 if(size!==expected)throw Error('Invalid source length');const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result));
}
async function initialize(candidates){
 if(engine)return;if(loading)return loading;
 loading=(async()=>{
  if(!Array.isArray(candidates)||!candidates.length||candidates.length>2)throw Error('Source unavailable');
  for(const candidate of candidates){
   try{
    const m=candidate.manifest,a=m.asset;
    if(m.schema_version!==1||m.kind!=='conus-place-search'||!Number.isInteger(m.vintage)||m.vintage<2020||m.vintage>2100||!Number.isInteger(a.bytes)||a.bytes<1||a.bytes>MAX_COMPRESSED||!Number.isInteger(a.uncompressed_bytes)||a.uncompressed_bytes<1||a.uncompressed_bytes>MAX_RAW||!(/^[a-f0-9]{64}$/).test(a.sha256))throw Error('Invalid catalog');
    const urls=[...(candidate.local?[candidate.local]:[]),a.url];
    for(const url of urls){
     try{const bytes=await read(url,a.bytes);if(bytes.length!==a.bytes||await hash(bytes)!==a.sha256)throw Error('Source checksum mismatch');const data=unpack(bytes,a.uncompressed_bytes);if(data.vintage!==m.vintage)throw Error('Source vintage mismatch');const counts={place:0,county:0,state:0};if(!Array.isArray(data.rows))throw Error('Invalid source rows');for(const row of data.rows)counts[row[1]]++;if(Object.keys(counts).some(k=>counts[k]!==m.counts?.[k])||counts.state!==49)throw Error('Source counts mismatch');engine=FireEyePlaceSearch.create(data);metadata={vintage:data.vintage,count:data.rows.length,sha256:a.sha256,saved:!!candidate.saved};return;}catch{}
    }
   }catch{}
  }
  throw Error('Place search unavailable');
 })();
 try{await loading;}finally{loading=null;}
}
self.onmessage=async event=>{const m=event.data;try{if(!m||m.type!=='search'||!Number.isSafeInteger(m.id)||typeof m.query!=='string'||m.query.length>120)throw Error('Invalid request');await initialize(m.candidates);const results=engine.search(m.query,12);self.postMessage({id:m.id,ok:true,results,metadata});}catch{self.postMessage({id:m?.id,ok:false,error:'Place search unavailable'});}};
