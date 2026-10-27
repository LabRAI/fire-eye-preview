'use strict';
importScripts('flatgeobuf.js?v=e650c7105ca96e3a','proj4.js?v=fda669d2769f96a2');
proj4.defs('EPSG:5070','+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=23 +lon_0=-96 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs');
const fetchNative=self.fetch.bind(self);
let query,controller,bytes=0,requests=0,active=0,queue=[],coordinateCount=0;
class ViewLimit extends Error{}
function approved(url){const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='huggingface.co'||u.username||u.password||u.search||u.hash||!new RegExp('^/datasets/[^/]+/[^/]+/resolve/[a-f0-9]{40}/vectors/assets/[a-f0-9]{64}/(wui|burn-severity|buildings)[.]fgb$').test(u.pathname))throw Error('Unapproved vector asset');return u.href;}
self.fetch=async(input,options={})=>{
 if(approved(String(input))!==query.layer.asset.url)throw Error('Unexpected range origin');
 const range=new Headers(options.headers).get('Range'),match=/^bytes=([0-9]+)-([0-9]+)$/.exec(range||'');
 if(!match)throw Error('A bounded byte range is required');
 const start=Number(match[1]),end=Math.min(Number(match[2]),query.layer.asset.bytes-1),length=end-start+1;
 if(start<0||length<=0||length>4*1024*1024||bytes+length>query.byteLimit||++requests>240)throw new ViewLimit();bytes+=length;
 if(active>=4)await new Promise(resolve=>queue.push(resolve));controller.signal.throwIfAborted();active++;
 try{
  const r=await fetchNative(input,{...options,credentials:'omit',signal:controller.signal});
  if(r.status!==206||r.headers.get('Content-Range')!=='bytes '+start+'-'+end+'/'+query.layer.asset.bytes){await r.body?.cancel();throw Error('Indexed range response unavailable');}
  const data=await r.arrayBuffer();if(data.byteLength!==length)throw Error('Invalid range length');
  return new Response(data,{status:206,headers:r.headers});
 }finally{active--;queue.shift()?.();}
};
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
  self.postMessage({id:query.id,status:'ready',type:'FeatureCollection',features,bytes,requests,source_crs:query.layer.crs});
 }catch(error){controller.abort();self.postMessage({id:query.id,status:error instanceof ViewLimit?'zoom':'unavailable',features:[],bytes,requests});}
 finally{clearTimeout(timer);}
};
