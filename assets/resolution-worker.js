'use strict';
importScripts('proj4.js?v=fda669d2769f96a2','fflate.js?v=462ef8041fc970e3');
const project=proj4('EPSG:3857','+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=23 +lon_0=-96 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs');
const fields=new Map(),chunks=new Map();let index=null,indexHash=null,query,aborter,deliveryUrl=null,deliveryIdentity=null,cancelRequested=false;
const metrics={rangeRequests:0,rangeBytes:0,fullBytes:0,cacheHits:0};
const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
function origin(asset){const u=new URL(asset.url);if(u.origin!=='https://huggingface.co'||u.username||u.password||u.search||u.hash||!/^[a-f0-9]{64}$/.test(asset.sha256)||!Number.isSafeInteger(asset.bytes)||asset.bytes<=0||!new RegExp('^/datasets/[^/]+/[^/]+/resolve/[a-f0-9]{40}/resolution/assets/'+asset.sha256+'/[A-Za-z0-9.-]+$').test(u.pathname))throw Error('Unapproved experimental asset');return u.href;}
async function readBody(r,size){const reader=r.body.getReader(),parts=[];let total=0;while(true){aborter.signal.throwIfAborted();const x=await reader.read();if(x.done)break;total+=x.value.length;if(total>size){await reader.cancel();throw Error('Oversized experimental response');}parts.push(x.value);}if(total!==size)throw Error('Incomplete experimental response');const out=new Uint8Array(total);let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;}
async function full(asset,max,local){
 const remote=origin(asset);if(asset.bytes>max)throw Error('Experimental asset budget exceeded');const urls=[];
 if(local){const u=new URL(local);if(u.origin===self.location.origin&&u.pathname.endsWith('/assets/resolution/'+asset.sha256+'.gz')&&!u.search&&!u.hash)urls.push(u.href);}urls.push(remote);
 for(const url of urls){try{const r=await fetch(url,{credentials:'omit',signal:aborter.signal});if(r.status!==200){await r.body?.cancel();continue;}const bytes=await readBody(r,asset.bytes);metrics.fullBytes+=bytes.length;if(await hash(bytes)!==asset.sha256)throw Error('Experimental checksum mismatch');return bytes;}catch(e){if(aborter.signal.aborted)throw e;}}
 throw Error('Experimental asset unavailable');
}
async function unzip(bytes,max){const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),parts=[];let n=0;while(true){const x=await reader.read();if(x.done)break;n+=x.value.length;if(n>max){await reader.cancel();throw Error('Expanded asset exceeds limit');}parts.push(x.value);}const raw=new Uint8Array(n);let off=0;for(const p of parts){raw.set(p,off);off+=p.length;}return raw;}
async function getField(run){
 if(fields.has(run.revision)){const f=fields.get(run.revision);fields.delete(run.revision);fields.set(run.revision,f);return f;}
 const bytes=await full(run.asset,16*1024*1024),raw=await unzip(bytes,16*1024*1024),d=new DataView(raw.buffer);if(raw.length<72||new TextDecoder().decode(raw.subarray(0,8))!=='FIRE50M2')throw Error('Invalid experimental field');
 const width=d.getUint32(8,true),height=d.getUint32(12,true),ox=d.getFloat64(16,true),oy=d.getFloat64(24,true),size=d.getFloat64(32,true),weightsRevision=Array.from(raw.subarray(40,72),b=>b.toString(16).padStart(2,'0')).join(''),g=query.manifest.grid;
 if(width!==g.width||height!==g.height||width>1200||height>1000||ox!==g.origin[0]||oy!==g.origin[1]||size!==5000||weightsRevision!==query.manifest.weights_revision||raw.length!==72+width*height*16)throw Error('Experimental grid mismatch');
 const f={width,height,ox,oy,size,weightsRevision,values:new Float32Array(raw.buffer,72,width*height*4)};fields.set(run.revision,f);while(fields.size>(query.mobile?1:2))fields.delete(fields.keys().next().value);return f;
}
async function getIndex(){
 const a=query.manifest.assets.index;if(index&&indexHash===a.sha256)return index;
 const bytes=await full(a,4*1024*1024,query.localIndex),raw=await unzip(bytes,8*1024*1024),value=JSON.parse(new TextDecoder().decode(raw)),pack=query.manifest.assets.weights;
 if(value.version!=='FIRE50W1-PACK'||value.weights_revision!==query.manifest.weights_revision||value.pack_sha256!==pack.sha256||value.pack_bytes!==pack.bytes||value.low!==-6||value.high!==6||value.chunk_parents!==5||Object.keys(value.chunks).length!==pack.chunks||pack.chunks>40000)throw Error('Invalid weight index');
 let offset=0;for(const [id,m]of Object.entries(value.chunks).sort(([a],[b])=>a.localeCompare(b))){if(!/^r\d{4}c\d{4}$/.test(id)||!/^[a-f0-9]{64}$/.test(m.sha256)||!Number.isSafeInteger(m.offset)||m.offset!==offset||!Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>1024*1024||m.rows<1||m.rows>5||m.cols<1||m.cols>5)throw Error('Invalid weight block');offset+=m.bytes;}if(offset!==pack.bytes)throw Error('Incomplete weight index');
 if(indexHash!==a.sha256)chunks.clear();index=value;indexHash=a.sha256;return index;
}
function keyFor(row,col){return 'r'+String(Math.floor(row/5)*5).padStart(4,'0')+'c'+String(Math.floor(col/5)*5).padStart(4,'0');}
function weightChunk(f,row,col){const key=f.weightsRevision+'/'+keyFor(row,col),value=chunks.get(key);if(!value)throw Error('Required detail block not loaded');chunks.delete(key);chunks.set(key,value);return value;}
async function getChunk(id,f){
 const key=f.weightsRevision+'/'+id;if(chunks.has(key)){metrics.cacheHits++;return;}
 const m=index.chunks[id];if(!m)throw Error('Required detail block absent');const asset=query.manifest.assets.weights,url=origin(asset),end=m.offset+m.bytes-1;
 if(end>=asset.bytes)throw Error('Invalid weight range');if(deliveryIdentity!==asset.sha256){deliveryUrl=null;deliveryIdentity=asset.sha256;}
 metrics.rangeRequests++;metrics.rangeBytes+=m.bytes;
 const opts={credentials:'omit',headers:{Range:'bytes='+m.offset+'-'+end},signal:aborter.signal};let r=await fetch(deliveryUrl||url,opts);
 if(deliveryUrl&&[401,403].includes(r.status)){await r.body?.cancel();deliveryUrl=null;r=await fetch(url,opts);}
 if(r.status!==206||r.headers.get('Content-Range')!=='bytes '+m.offset+'-'+end+'/'+asset.bytes){await r.body?.cancel();throw Error('Experimental ranged source unavailable');}
 const bytes=await readBody(r,m.bytes);if(await hash(bytes)!==m.sha256)throw Error('Experimental weight checksum mismatch');const resolved=new URL(r.url);if(resolved.protocol==='https:'&&resolved.hostname==='us.aws.cdn.hf.co'&&!resolved.username&&!resolved.password)deliveryUrl=resolved.href;
 const raw=await unzip(bytes,1024*1024),v=new DataView(raw.buffer),row=Number(id.slice(1,5)),col=Number(id.slice(6,10)),nr=v.getUint32(16,true),nc=v.getUint32(20,true);
 if(new TextDecoder().decode(raw.subarray(0,8))!=='FIRE50W1'||v.getUint32(8,true)!==row||v.getUint32(12,true)!==col||nr!==m.rows||nc!==m.cols||raw.length!==32+nr*nc*10510||v.getFloat32(24,true)!==-6||v.getFloat32(28,true)!==6)throw Error('Experimental weight format mismatch');
 chunks.set(key,{row,col,rows:nr,cols:nc,codes:raw.subarray(32,32+nr*nc*10000)});
}
function needed(f,job){
 const keys=new Set(),add=(row,col)=>{if(row<0||col<0||row>=f.height||col>=f.width)return;const i=row*f.width+col,c=f.values[i],bias=f.values[3*f.width*f.height+i];if(Number.isFinite(c)&&c!==0&&c!==1&&Number.isFinite(bias))keys.add(keyFor(row,col));};
 if(job.type==='probe'){for(const p of job.points){const [x,y]=project.forward(p);add(Math.floor((f.oy-y)/f.size),Math.floor((x-f.ox)/f.size));}return keys;}
 if(job.z<10)return keys;const world=40075016.68557849,tile=world/(2**job.z),left=-world/2+job.x*tile,top=world/2-job.y*tile,points=[];
 for(let i=0;i<=16;i++){const t=i/16;for(const p of [[left+t*tile,top],[left+t*tile,top-tile],[left,top-t*tile],[left+tile,top-t*tile]])points.push(project.forward(p));}
 const minC=Math.max(0,Math.floor((Math.min(...points.map(p=>p[0]))-f.ox)/f.size)-1),maxC=Math.min(f.width-1,Math.floor((Math.max(...points.map(p=>p[0]))-f.ox)/f.size)+1),minR=Math.max(0,Math.floor((f.oy-Math.max(...points.map(p=>p[1])))/f.size)-1),maxR=Math.min(f.height-1,Math.floor((f.oy-Math.min(...points.map(p=>p[1])))/f.size)+1);
 for(let r=minR;r<=maxR;r++)for(let c=minC;c<=maxC;c++)add(r,c);if(keys.size>32)throw Error('Experimental view exceeds detail budget');return keys;
}
const table=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function join(parts){const out=new Uint8Array(parts.reduce((a,p)=>a+p.length,0));let off=0;for(const p of parts){out.set(p,off);off+=p.length;}return out;}
function chunk(name,body){const tag=new TextEncoder().encode(name),data=join([tag,body]),length=new Uint8Array(4),sum=new Uint8Array(4);new DataView(length.buffer).setUint32(0,body.length);new DataView(sum.buffer).setUint32(0,crc(data));return join([length,data,sum]);}
function png(rgba){const header=new Uint8Array(13),d=new DataView(header.buffer);d.setUint32(0,256);d.setUint32(4,256);header[8]=8;header[9]=6;const rows=new Uint8Array(256*1025);for(let y=0;y<256;y++)rows.set(rgba.subarray(y*1024,(y+1)*1024),y*1025+1);return join([new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',fflate.zlibSync(rows,{level:3})),chunk('IEND',new Uint8Array(0))]);}
importScripts('resolution-math.js?v=77964490e07e5b44');
self.onmessage=async event=>{
 if(event.data.type==='cancel'){if(query?.id===event.data.id){cancelRequested=true;aborter?.abort();}return;}
 query=event.data;cancelRequested=false;aborter=new AbortController();const started=performance.now(),before={...metrics},timer=setTimeout(()=>aborter.abort(),24000);
 try{
  const m=query.manifest,run=m.runs.find(r=>r.revision===query.revision);if(!run||m.method!=='learned-conditional-50m-v1'||m.retrospective!==true||m.grid.fine_metres!==50)throw Error('Unsupported experimental request');
  if(query.type==='probe'){if(!Array.isArray(query.points)||query.points.length>256||query.points.some(p=>p.length!==2||!p.every(Number.isFinite)))throw Error('Invalid experimental probes');}
  else if(![query.z,query.x,query.y].every(Number.isInteger)||query.z<2||query.z>12||query.x<0||query.y<0||query.x>=2**query.z||query.y>=2**query.z)throw Error('Invalid experimental tile');
  const f=await getField(run),keys=[...needed(f,query)];if(keys.length){await getIndex();let next=0;const outcomes=await Promise.allSettled(Array.from({length:Math.min(query.mobile?2:4,keys.length)},async()=>{try{while(next<keys.length){aborter.signal.throwIfAborted();const id=keys[next++];await getChunk(id,f);}}catch(error){aborter.abort();throw error;}}));if(outcomes.some(r=>r.status==='rejected'))throw Error('Experimental block unavailable');}aborter.signal.throwIfAborted();
  if(query.type==='probe'){const values=query.points.map(p=>{const [a,b]=project.forward(p),col=Math.floor((a-f.ox)/f.size),row=Math.floor((f.oy-b)/f.size),native=col<0||row<0||col>=f.width||row>=f.height?NaN:f.values[row*f.width+col];return {fine:sample(f,p[0],p[1],true),native};});self.postMessage({id:query.id,status:'ready',values});}
  else{const data=render(query,f);self.postMessage({id:query.id,status:'ready',data,ms:performance.now()-started,metrics:Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,v-before[k]]))},[data.buffer]);}
  while(chunks.size>(query.mobile?24:80))chunks.delete(chunks.keys().next().value);
 }catch{aborter.abort();self.postMessage({id:query.id,status:cancelRequested?'cancelled':'unavailable'});}finally{clearTimeout(timer);}
};
