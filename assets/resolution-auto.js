'use strict';
(async function(){
 if(document.body.classList.contains('resolution-lab'))return;
 const $=id=>document.getElementById(id),mobile=matchMedia('(max-width:640px)').matches,hex=/^[a-f0-9]{64}$/;
 const R={ready:false,status:'overview',manifest:null,request:null,active:null,sequence:0,loadedTiles:0,events:[],tileStats:[],failures:0};window.fireEyeAdaptiveResolution=R;
 let S,P,map,config,layerId=null,requestId=0,loading=null,lastKey='',retryAfter=0;const slots=[],queue=[],jobs=new Map(),tileCache=new Map();let cacheBytes=0;
 function approved(a){const u=new URL(a.url);if(!hex.test(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<=0||u.origin!=='https://huggingface.co'||u.username||u.password||u.search||u.hash||!new RegExp('^/datasets/[^/]+/[^/]+/resolve/[a-f0-9]{40}/resolution/assets/'+a.sha256+'/[A-Za-z0-9.-]+$').test(u.pathname))throw Error('Invalid experimental asset');}
 function validate(m){
  if(m.schema_version!==1||m.kind!=='experimental-resolution'||m.method!=='learned-conditional-50m-v1'||m.retrospective!==true||m.grid?.crs!=='EPSG:5070'||m.grid.width!==938||m.grid.height!==609||m.grid.origin.join(',')!=='-2362425,3267405'||m.grid.native_metres!==5000||m.grid.fine_metres!==50||!hex.test(m.weights_revision)||!Number.isFinite(Date.parse(m.fitted_at_utc))||!Array.isArray(m.runs)||!m.runs.length||m.runs.length>100||new Set(m.runs.map(r=>r.target_time_utc)).size!==m.runs.length)throw Error('Invalid resolution catalog');
  for(const a of Object.values(m.assets))approved(a);
  if(m.assets.index.bytes>4*1024*1024||m.assets.archive.bytes>2*1024*1024||m.assets.weights.bytes>2e9||m.assets.weights.chunks>40000)throw Error('Resolution asset budget');
  for(const r of m.runs){approved(r.asset);if(!hex.test(r.revision)||r.revision!==r.asset.sha256||r.asset.bytes>16*1024*1024||!hex.test(r.native_grid_sha256)||![12,24,36,48].includes(r.lead_hours)||r.window_hours!==12||Date.parse(r.target_time_utc)-Date.parse(r.issue_time_utc)!==r.lead_hours*3600000)throw Error('Invalid experimental time');}return m;
 }
 function localIndex(){const a=R.manifest.assets.index,p=config.resolution_assets?.[a.sha256];return p?new URL(p,location.href).href:null;}
 function spawn(){
  const slot={worker:new Worker('assets/resolution-worker.js?v=b65552adcf125ba5'),job:null};slots.push(slot);
  slot.worker.onmessage=e=>{const job=slot.job;if(!job||e.data.id!==job.id)return;clearTimeout(job.timer);slot.job=null;jobs.delete(job.id);
   if(!job.cancelled){if(e.data.status==='ready'){
     const data=e.data.data;while(tileCache.size&&(tileCache.size>=(mobile?24:72)||cacheBytes+data.length>(mobile?2:6)*1024*1024)){const first=tileCache.keys().next().value;cacheBytes-=tileCache.get(first).length;tileCache.delete(first);}tileCache.set(job.key,data);cacheBytes+=data.length;
     if(job.generation===R.sequence)R.loadedTiles++;
     R.tileStats.push({z:job.z,ms:e.data.ms,...e.data.metrics});if(R.tileStats.length>120)R.tileStats.shift();job.callback(null,data.slice().buffer);
    }else job.callback(Error('Experimental detail unavailable'));}
   dispatch();
  };
  slot.worker.onerror=()=>{const job=slot.job;slot.job=null;if(job){clearTimeout(job.timer);jobs.delete(job.id);if(!job.cancelled)job.callback(Error('Experimental worker unavailable'));}slot.worker.terminate();slots.splice(slots.indexOf(slot),1);dispatch();};return slot;
 }
 function dispatch(){
  while(queue.length&&slots.length<(mobile?1:2))spawn();
  for(const slot of slots){if(slot.job)continue;let job;while(queue.length){job=queue.shift();if(!job.cancelled)break;job=null;}if(!job)continue;slot.job=job;job.slot=slot;job.timer=setTimeout(()=>{if(slot.job!==job)return;slot.worker.terminate();slots.splice(slots.indexOf(slot),1);jobs.delete(job.id);if(!job.cancelled)job.callback(Error('Experimental tile timeout'));dispatch();},30000);
   slot.worker.postMessage({type:'tile',id:job.id,revision:job.revision,z:job.z,x:job.x,y:job.y,manifest:R.manifest,native:job.native,mobile,localIndex:localIndex()});
  }
 }
 function cancel(job){if(job.cancelled)return;job.cancelled=true;jobs.delete(job.id);if(job.slot)job.slot.worker.postMessage({type:'cancel',id:job.id});else{const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);}}
 function protocol(params,callback){
  const match=/^adaptive50:\/\/([a-f0-9]{64})\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url);if(!match){callback(Error('Invalid experimental tile'));return {cancel(){}};}
  const [,revision,generation,z,x,y]=match,key=[revision,z,x,y].join('/');if(tileCache.has(key)){const bytes=tileCache.get(key);tileCache.delete(key);tileCache.set(key,bytes);if(Number(generation)===R.sequence)R.loadedTiles++;callback(null,bytes.slice().buffer);return {cancel(){}};}
  if(queue.length>=64){callback(Error('Experimental queue limit'));return {cancel(){}};}
  if(!R.request||R.request.revision!==revision||Number(generation)!==R.sequence){callback(Error('Previous time selection'));return {cancel(){}};}
  const job={id:++requestId,native:R.request.native,revision,z:Number(z),x:Number(x),y:Number(y),key,generation:Number(generation),cancelled:false,callback};jobs.set(job.id,job);queue.push(job);dispatch();return {cancel:()=>cancel(job)};
 }

 const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
 function label(text){const node=$('resolution-auto-status');if(node)node.textContent=text;const panel=document.querySelector('.mapped-scene-panel');if(panel){let note=panel.querySelector('.mapped-scene-risk');if(!note){note=document.createElement('p');note.className='mapped-scene-risk';panel.insertBefore(note,panel.querySelector('.mapped-scene-note'));}note.textContent=text;note.title='Experimental terrain/fuel-conditioned redistribution. The regional model and charts remain on the native 5 km grid; this is not a native 50 m forecast.';}}
 function order(){if(!layerId||!map.getLayer(layerId))return;const layers=map.getStyle().layers,anchor=map.getLayer('mapped-scene-buildings')?'mapped-scene-buildings':layers.find(l=>/^(platform-|selection-|vector-context|hurricane-track)/.test(l.id)||l.type==='symbol')?.id;if(anchor)map.moveLayer(layerId,anchor);}
 function display(){
  if(!S?.active)return;const selected=R.active?.source_id===S.active.run.source_id&&R.active?.issue_time_utc===S.manifest.issue_time_utc,visible=S.riskVisible!==false,z=map.getZoom(),blend=R.status==='ready'&&selected?Math.max(0,Math.min(1,z-10)):0;
  S.refinementMix=blend;S.syncHeatmapDisplay?.();
  if(layerId&&map.getLayer(layerId)){map.setLayoutProperty(layerId,'visibility',z>=10&&visible?'visible':'none');map.setPaintProperty(layerId,'raster-opacity',visible?(blend>0?(S.riskOpacity??1)*blend:.001):0);}
  label(z<10?'Zoom in for automatic 50 m detail':blend>0?'50 m fire-risk detail · Experimental refinement':R.status==='loading'?'Preparing 50 m detail · Current forecast retained':'5 km fire risk · Fine detail pending');
 }
 function drop(){if(layerId){if(map.getLayer(layerId))map.removeLayer(layerId);if(map.getSource(layerId))map.removeSource(layerId);layerId=null;}for(const job of [...jobs.values()])cancel(job);R.active=null;S.refinementMix=0;S.syncHeatmapDisplay?.();}
 async function catalog(){
  if(R.manifest)return R.manifest;if(loading)return loading;
  loading=(async()=>{config=await fetch('config.json',{signal:AbortSignal.timeout(6000)}).then(r=>r.json());let value;
   try{const u=new URL(config.resolution_url);if(u.origin!=='https://huggingface.co'||u.search||u.hash||!/^\/datasets\/[^/]+\/[^/]+\/resolve\/main\/resolution[.]json$/.test(u.pathname))throw Error();const r=await fetch(u,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();value=validate(await r.json());}
   catch{const r=await fetch('resolution-bootstrap.json',{signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error();value=validate(await r.json());}R.manifest=value;return value;
  })().finally(()=>{loading=null;});return loading;
 }
 async function resolveRun(){
  const source=S.active.run,issue=S.manifest.issue_time_utc,m=await catalog();
  const saved=m.runs.find(r=>r.source_id===source.source_id&&r.issue_time_utc===issue&&r.target_time_utc===source.target_time_utc);

  let index,assets;
  if(S.manifest.archive){assets=S.manifest.regional_assets;const a=assets?.forecast;if(!a)throw Error('Selected archive unavailable');const u=new URL(a.url,location.href);if(u.origin!=='https://huggingface.co'||!/^\/datasets\/[^/]+\/[^/]+\/resolve\/[a-f0-9]{40}\/archive\//.test(u.pathname))throw Error();const r=await fetch(u,{signal:AbortSignal.timeout(12000)}),b=new Uint8Array(await r.arrayBuffer());if(b.length!==a.bytes||Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('')!==a.sha256)throw Error();index=JSON.parse(new TextDecoder().decode(a.encoding==='gzip'?fflate.gunzipSync(b):b));}
  else{assets=P.manifest.assets;index=await P.loadAsset('forecast');}
  const actual=index.runs.find(r=>r.source_id===source.source_id&&r.lead_hours===source.lead_hours&&r.target_time_utc===source.target_time_utc),g=index.grid;
  if(index.issue_time_utc!==issue||!actual||g.crs!=='EPSG:5070'||g.width!==938||g.height!==609||g.transform.join(',')!=='5000,0,-2362425,0,-5000,3267405')throw Error('Selected forecast mismatch');
  const asset={...assets[actual.asset]};asset.url=new URL(asset.url,location.href).href;
  if(saved){if(saved.native_grid_sha256!==asset.sha256)throw Error('Refinement source mismatch');return {...saved,native:null};}
  return {...source,issue_time_utc:issue,revision:await digest(asset.sha256+'|'+m.weights_revision+'|'+source.source_id),native:{asset,source_id:source.source_id}};
 }
 function waitLoaded(id,sequence){return new Promise((resolve,reject)=>{let timer;const finish=e=>{clearTimeout(timer);map.off('render',check);map.off('sourcedata',check);map.off('error',failed);e?reject(e):resolve();};const check=()=>{if(sequence!==R.sequence)return finish(Error('Selection changed'));if(R.loadedTiles>0&&map.getSource(id)&&map.isSourceLoaded(id))finish();};const failed=e=>{if(e.sourceId===id)finish(Error('Fine detail unavailable'));};timer=setTimeout(()=>finish(Error('Fine detail timeout')),45000);map.on('render',check);map.on('sourcedata',check);map.on('error',failed);check();});}
 async function sync(){
  if(!S?.active)return;display();const key=S.active.run.source_id+'|'+S.manifest.issue_time_utc;
  if(lastKey!==key){++R.sequence;drop();lastKey=key;R.status='overview';retryAfter=0;}
  if(map.getZoom()<10||R.status==='loading'||R.status==='ready'||Date.now()<retryAfter)return;
  const sequence=++R.sequence;R.status='loading';R.loadedTiles=0;display();
  try{const run=await resolveRun();if(sequence!==R.sequence||lastKey!==key)return;R.request=run;const id='adaptive-resolution-'+run.revision.slice(0,12)+'-'+sequence;layerId=id;
   map.addSource(id,{type:'raster',tiles:['adaptive50://'+run.revision+'/'+sequence+'/{z}/{x}/{y}'],tileSize:256,minzoom:10,maxzoom:12,bounds:[-128.4,22.4,-64,52.5],attribution:'RAI Lab · experimental 50 m refinement of the selected 5 km forecast'});
   map.addLayer({id,type:'raster',source:id,minzoom:10,paint:{'raster-opacity':.001,'raster-resampling':'nearest','raster-fade-duration':0}});order();const started=performance.now();await waitLoaded(id,sequence);if(sequence!==R.sequence)return;R.active=run;R.status='ready';R.events.push({source_id:run.source_id,issue_time_utc:run.issue_time_utc,target_time_utc:run.target_time_utc,method:run.native?'selected-native-field':'published-refinement',ready_ms:performance.now()-started});if(R.events.length>30)R.events.shift();display();
  }catch{if(sequence===R.sequence){drop();R.status='unavailable';R.failures++;retryAfter=Date.now()+30000;display();}}
 }
 for(let i=0;i<600;i++){S=window.fireEyePreview;P=window.fireEyePlatform;if(S?.ready&&P?.ready)break;await new Promise(r=>setTimeout(r,100));}if(!S?.ready||!P?.ready)return;map=S.map;
 maplibregl.addProtocol('adaptive50',protocol);S.onRefinementSelection=()=>{if(R.active&&(R.active.source_id!==S.active?.run.source_id||R.active.issue_time_utc!==S.manifest?.issue_time_utc)){S.refinementMix=0;if(layerId&&map.getLayer(layerId))map.setPaintProperty(layerId,'raster-opacity',0);}};R.ready=true;R.sync=sync;R.display=display;R.retry=()=>{retryAfter=0;R.status='overview';return sync();};
 map.on('moveend',sync);map.on('zoom',display);map.on('styledata',()=>{if(layerId&&!map.getLayer(layerId)&&R.status==='ready'){R.status='overview';sync();}});
 map.on('error',e=>{if(e.sourceId===layerId&&R.status==='ready'){drop();R.status='unavailable';R.failures++;retryAfter=Date.now()+30000;display();}});
 window.addEventListener('fire-eye:forecast-changed',sync);window.addEventListener('fire-eye:basemap-changed',()=>{order();display();});
 $('risk-opacity')?.addEventListener('input',display);const prior=P.onDisplayChange;P.onDisplayChange=()=>{prior?.();display();};
 setInterval(()=>{if(!document.hidden)sync();},30000);
 window.addEventListener('pagehide',()=>{for(const job of jobs.values()){clearTimeout(job.timer);job.cancelled=true;}for(const slot of slots)slot.worker.terminate();});
 sync();
})().catch(()=>{const s=document.getElementById('resolution-auto-status');if(s)s.textContent='Native forecast available';});
