'use strict';
importScripts('flatgeobuf.js?v=e650c7105ca96e3a','proj4.js?v=fda669d2769f96a2');
proj4.defs('EPSG:5070','+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=23 +lon_0=-96 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs');
const fetchNative=self.fetch.bind(self);
let query,controller,bytes=0,requests=0,active=0,queue=[],coordinateCount=0,seedData=null,seedHits=0,seedBytes=0,seedTransferBytes=0,networkBytes=0,networkRequests=0,rangeTimings=[],deliveryUrl=null;
class ViewLimit extends Error{}
function approved(url){const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='huggingface.co'||u.username||u.password||u.search||u.hash||!new RegExp('^/datasets/[^/]+/[^/]+/resolve/[a-f0-9]{40}/vectors/assets/[a-f0-9]{64}/(wui|burn-severity|buildings)[.]fgb$').test(u.pathname))throw Error('Unapproved vector asset');return u.href;}
self.fetch=async(input,options={})=>{
 if(approved(String(input))!==query.layer.asset.url)throw Error('Unexpected range origin');
 const range=new Headers(options.headers).get('Range'),match=/^bytes=([0-9]+)-([0-9]+)$/.exec(range||'');
 if(!match)throw Error('A bounded byte range is required');
 const start=Number(match[1]),end=Math.min(Number(match[2]),query.layer.asset.bytes-1),length=end-start+1;
 if(start<0||length<=0||length>4*1024*1024||++requests>240)throw new ViewLimit();
 if(seedData&&end<seedData.byteLength){seedHits++;return new Response(seedData.slice(start,end+1),{status:206,headers:{'Content-Range':'bytes '+start+'-'+end+'/'+query.layer.asset.bytes,'Content-Length':String(length)}});}
 if(bytes+length>query.byteLimit)throw new ViewLimit();bytes+=length;networkBytes+=length;networkRequests++;
 const began=performance.now();
 if(active>=4)await new Promise(resolve=>queue.push(resolve));controller.signal.throwIfAborted();active++;
 try{
  const opts={...options,credentials:'omit',signal:controller.signal};
  // Reuse only a delivery URL returned by a verified immutable HF range response.
  // It stays inside this short-lived worker; never persist or expose signed URLs.
  let r=await fetchNative(deliveryUrl||input,opts);
  if(deliveryUrl&&[401,403].includes(r.status)){await r.body?.cancel();deliveryUrl=null;r=await fetchNative(input,opts);}

  if(r.status!==206||r.headers.get('Content-Range')!=='bytes '+start+'-'+end+'/'+query.layer.asset.bytes){await r.body?.cancel();throw Error('Indexed range response unavailable');}
  const data=await r.arrayBuffer();if(data.byteLength!==length)throw Error('Invalid range length');
  const resolved=new URL(r.url);if(resolved.protocol==='https:'&&resolved.hostname==='us.aws.cdn.hf.co'&&!resolved.username&&!resolved.password)deliveryUrl=resolved.href;
  return new Response(data,{status:206,headers:r.headers});
 }finally{if(rangeTimings.length<64)rangeTimings.push({start,end,ms:Math.round(performance.now()-began)});active--;queue.shift()?.();}
};
async function loadSeed(){
 const seed=query.seed;if(!seed)return;
 if(seed.source_sha256!==query.layer.asset.sha256||!['compact','full'].includes(seed.tier)||!Number.isSafeInteger(seed.bytes)||seed.bytes<1||seed.bytes>2*1024*1024||seed.bytes>query.byteLimit||!/^[a-f0-9]{64}$/.test(seed.sha256))return;
 const remote=new URL(seed.url);
 if(remote.origin!=='https://huggingface.co'||remote.search||remote.hash||remote.username||remote.password||!new RegExp('^/datasets/[^/]+/[^/]+/resolve/[a-f0-9]{40}/vectors/index/'+seed.sha256+'[.]bin$').test(remote.pathname))return;
 const urls=[];
 if(seed.local_url){const local=new URL(seed.local_url,self.location.href);if(local.origin===self.location.origin&&local.pathname.endsWith('/assets/vector-index/'+seed.sha256+'.bin')&&!local.search&&!local.hash)urls.push(local.href);}
 urls.push(remote.href);
 for(const url of urls){
  if(bytes+seed.bytes>query.byteLimit)return;
  try{
   const r=await fetchNative(url,{credentials:'omit',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(3000)])});
   if(!r.ok||Number(r.headers.get('Content-Length')||0)>seed.bytes){await r.body?.cancel();continue;}
   const chunks=[];let n=0;const reader=r.body.getReader();
   while(true){const x=await reader.read();if(x.done)break;n+=x.value.byteLength;bytes+=x.value.byteLength;seedTransferBytes+=x.value.byteLength;if(bytes>query.byteLimit){await reader.cancel();throw new ViewLimit();}if(n>seed.bytes){await reader.cancel();throw Error('Invalid seed size');}chunks.push(x.value);}
   if(n!==seed.bytes)continue;const data=new Uint8Array(n);let p=0;for(const chunk of chunks){data.set(chunk,p);p+=chunk.length;}
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==seed.sha256)continue;
   seedData=data.buffer;seedBytes=n;return;
  }catch(error){if(error instanceof ViewLimit)throw error;if(controller.signal.aborted)return;}
 }
}
function stats(){return {bytes,requests,seedBytes,seedTransferBytes,seedHits,networkBytes,networkRequests,coordinateCount,rangeTimings};}
function nativeBounds(bounds,crs){
 if(crs==='EPSG:4326')return {minX:bounds[0],minY:bounds[1],maxX:bounds[2],maxY:bounds[3]};
 const points=[];for(let i=0;i<=16;i++){const x=bounds[0]+(bounds[2]-bounds[0])*i/16,y=bounds[1]+(bounds[3]-bounds[1])*i/16;for(const p of [[x,bounds[1]],[x,bounds[3]],[bounds[0],y],[bounds[2],y]])points.push(proj4('EPSG:4326',crs,p));}
 return {minX:Math.min(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxX:Math.max(...points.map(p=>p[0])),maxY:Math.max(...points.map(p=>p[1]))};
}
function coordinates(value,crs){
 if(typeof value[0]==='number'){
  if(++coordinateCount>query.coordinateLimit)throw new ViewLimit();const p=crs==='EPSG:4326'?value:proj4(crs,'EPSG:4326',value);
  if(!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>90)throw Error('Invalid source coordinates');return [p[0],p[1]];
 }
 return value.map(p=>coordinates(p,crs));
}
self.onmessage=async e=>{
 query=e.data;controller=new AbortController();let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},18000);
 try{
  approved(query.layer.asset.url);const bounds=query.bounds;if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]>=bounds[2]||bounds[1]>=bounds[3])throw Error('Invalid viewport');
  await loadSeed();
  const features=[];let seen=0,headerChecked=false;
  const header=h=>{if(!h.indexNodeSize||h.featuresCount!==query.layer.asset.features||Number(h.crs?.code)!==Number(query.layer.crs.split(':')[1]))throw Error('Source schema changed');headerChecked=true;};
  for await(const f of flatgeobuf.deserialize(query.layer.asset.url,nativeBounds(bounds,query.layer.crs),header)){
   if(++seen>query.featureLimit)throw new ViewLimit();
   const p=f.properties||{};
   if(!['Polygon','MultiPolygon'].includes(f.geometry?.type))throw Error('Unsupported source geometry');
   const properties={};for(const k of query.layer.fields){const v=p[k];if(typeof v==='number'&&Number.isFinite(v))properties[k]=v;else if(typeof v==='string'&&v.length<=300)properties[k]=v;}
   features.push({type:'Feature',id:f.id,geometry:{type:f.geometry.type,coordinates:coordinates(f.geometry.coordinates,query.layer.crs)},properties});
  }
  if(!headerChecked)throw Error('Source header not verified');
  self.postMessage({id:query.id,status:'ready',type:'FeatureCollection',features,...stats(),source_crs:query.layer.crs});
 }catch(error){controller.abort();self.postMessage({id:query.id,status:error instanceof ViewLimit?'zoom':'unavailable',features:[],...stats()});}
 finally{clearTimeout(timer);}
};
