'use strict';
(async function(){
 const $=id=>document.getElementById(id),mobile=matchMedia('(max-width:640px)').matches,hex=/^[a-f0-9]{64}$/;
 const R={ready:false,status:'loading',manifest:null,selected:null,requested:null,active:null,sequence:0,loadedTiles:0,events:[],tileStats:[],failures:0};window.fireEyeResolution=R;
 let S,P,map,config,archives,layerId=null,requestId=0,switchingMode=false;const slots=[],queue=[],jobs=new Map(),tileCache=new Map();let cacheBytes=0;
 const pretty=t=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date(t))+' UTC';
 function approved(a){const u=new URL(a.url);if(!hex.test(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<=0||u.origin!=='https://huggingface.co'||u.username||u.password||u.search||u.hash||!new RegExp('^/datasets/[^/]+/[^/]+/resolve/[a-f0-9]{40}/resolution/assets/'+a.sha256+'/[A-Za-z0-9.-]+$').test(u.pathname))throw Error('Invalid experimental asset');}
 function validate(m){
  if(m.schema_version!==1||m.kind!=='experimental-resolution'||m.method!=='learned-conditional-50m-v1'||m.retrospective!==true||m.grid?.crs!=='EPSG:5070'||m.grid.width!==938||m.grid.height!==609||m.grid.origin.join(',')!=='-2362425,3267405'||m.grid.native_metres!==5000||m.grid.fine_metres!==50||!hex.test(m.weights_revision)||!Number.isFinite(Date.parse(m.fitted_at_utc))||!Array.isArray(m.runs)||!m.runs.length||m.runs.length>100||new Set(m.runs.map(r=>r.target_time_utc)).size!==m.runs.length)throw Error('Invalid resolution catalog');
  for(const a of Object.values(m.assets))approved(a);
  if(m.assets.index.bytes>4*1024*1024||m.assets.archive.bytes>2*1024*1024||m.assets.weights.bytes>2e9||m.assets.weights.chunks>40000)throw Error('Resolution asset budget');
  for(const r of m.runs){approved(r.asset);if(!hex.test(r.revision)||r.revision!==r.asset.sha256||r.asset.bytes>16*1024*1024||!hex.test(r.native_grid_sha256)||![12,24,36,48].includes(r.lead_hours)||r.window_hours!==12||Date.parse(r.target_time_utc)-Date.parse(r.issue_time_utc)!==r.lead_hours*3600000)throw Error('Invalid experimental time');}return m;
 }
 async function getArchive(){
  const a=R.manifest.assets.archive,urls=[],local=config.resolution_assets?.[a.sha256];if(local){const u=new URL(local,location.href);if(u.origin===location.origin&&u.pathname.endsWith('/assets/resolution/'+a.sha256+'.gz'))urls.push(u.href);}urls.push(a.url);
  for(const url of urls){try{const r=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(12000)});if(!r.ok||Number(r.headers.get('Content-Length')||0)>a.bytes)continue;const bytes=await r.arrayBuffer();if(bytes.byteLength!==a.bytes)continue;const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==a.sha256)continue;const data=JSON.parse(new TextDecoder().decode(fflate.gunzipSync(new Uint8Array(bytes))));if(data.kind!=='resolution-native-archive'||data.schema_version!==1||!Array.isArray(data.releases)||data.releases.length>100)throw Error();
   const lookup=new Map();for(const m of data.releases){const u=new URL(m.asset_base);if(u.origin!=='https://huggingface.co'||u.username||u.password||u.search||u.hash||!/^\/datasets\/[^/]+\/[^/]+\/resolve\/[a-f0-9]{40}\/archive\//.test(u.pathname)||!m.archive||m.runs.map(r=>r.lead_hours).join(',')!=='12,24,36,48')throw Error();for(const r of m.runs)lookup.set(r.source_id,{manifest:m,run:r});}
   for(const run of R.manifest.runs){const found=lookup.get(run.source_id);if(!found||found.manifest.issue_time_utc!==run.issue_time_utc||found.run.target_time_utc!==run.target_time_utc||found.manifest.regional_assets['numeric-h'+run.lead_hours].sha256!==run.native_grid_sha256)throw Error('Mismatched native archive');}return lookup;
  }catch{}}
  throw Error('Native archive unavailable');
 }
 function localIndex(){const a=R.manifest.assets.index,p=config.resolution_assets?.[a.sha256];return p?new URL(p,location.href).href:null;}
 function spawn(){
  const slot={worker:new Worker('assets/resolution-worker.js?v=5726dce0863cd07e'),job:null};slots.push(slot);
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
   slot.worker.postMessage({type:'tile',id:job.id,revision:job.revision,z:job.z,x:job.x,y:job.y,manifest:R.manifest,mobile,localIndex:localIndex()});
  }
 }
 function cancel(job){if(job.cancelled)return;job.cancelled=true;jobs.delete(job.id);if(job.slot)job.slot.worker.postMessage({type:'cancel',id:job.id});else{const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);}}
 function protocol(params,callback){
  const match=/^detail50:\/\/([a-f0-9]{64})\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url);if(!match){callback(Error('Invalid experimental tile'));return {cancel(){}};}
  const [,revision,generation,z,x,y]=match,key=[revision,z,x,y].join('/');if(tileCache.has(key)){const bytes=tileCache.get(key);tileCache.delete(key);tileCache.set(key,bytes);if(Number(generation)===R.sequence)R.loadedTiles++;callback(null,bytes.slice().buffer);return {cancel(){}};}
  if(queue.length>=64){callback(Error('Experimental queue limit'));return {cancel(){}};}
  const job={id:++requestId,revision,z:Number(z),x:Number(x),y:Number(y),key,generation:Number(generation),cancelled:false,callback};jobs.set(job.id,job);queue.push(job);dispatch();return {cancel:()=>cancel(job)};
 }
 function visibility(id,value){if(map.getLayer(id)&&map.getLayoutProperty(id,'visibility')!==value)map.setLayoutProperty(id,'visibility',value);}
 function display(){
  const enabled=R.active&&R.active.source_id===S.active?.run.source_id&&R.status==='ready';
  if(layerId&&map.getLayer(layerId)){visibility(layerId,enabled?'visible':R.status==='loading'?'visible':'none');map.setPaintProperty(layerId,'raster-opacity',enabled?Number($('risk-opacity').value)/100:R.status==='loading'?.001:0);}
  if(enabled)visibility(S.active.id,'none');else if(S.active)visibility(S.active.id,'visible');
  $('resolution-detail-state').textContent=enabled?(map.getZoom()>=10?'50 m spatial detail':'CONUS overview · zoom in for 50 m detail'):R.status==='loading'?'Loading experimental map…':'Native 5 km map · experimental detail unavailable';
 }
 function order(){if(!layerId||!map.getLayer(layerId))return;const layers=map.getStyle().layers,anchor=layers.find(l=>/^(platform-|selection-|vector-context|hurricane-track)/.test(l.id)||l.type==='symbol');if(anchor&&layers.findIndex(l=>l.id===layerId)!==layers.indexOf(anchor)-1)map.moveLayer(layerId,anchor.id);}
 function drop(){if(layerId){if(map.getLayer(layerId))map.removeLayer(layerId);if(map.getSource(layerId))map.removeSource(layerId);layerId=null;}}
 function labels(run){
  $('resolution-target').querySelector('option[data-native-fallback]')?.remove();$('resolution-range').disabled=false;
  const u=new URL(location.href);u.searchParams.set('source',run.source_id);history.replaceState(null,'',u);
  $('resolution-target').value=run.source_id;$('resolution-range').value=R.manifest.runs.indexOf(run);$('resolution-range').setAttribute('aria-valuetext',pretty(run.target_time_utc));$('resolution-count').textContent=(R.manifest.runs.indexOf(run)+1)+' / '+R.manifest.runs.length;
  $('timeline-label').textContent='RETROSPECTIVE · 50 M DETAIL';$('heading').textContent='Experimental detail · +'+run.lead_hours+'h';$('forecast-badge').textContent='EXPERIMENT';$('issue').textContent='Native model input '+pretty(run.issue_time_utc);
  $('valid').textContent='12-hour window ending '+pretty(run.target_time_utc);$('resolution-previous').disabled=R.manifest.runs.indexOf(run)===0;$('resolution-next').disabled=R.manifest.runs.indexOf(run)===R.manifest.runs.length-1;
  for(const b of document.querySelectorAll('#horizons button')){const r=R.manifest.runs.find(r=>r.issue_time_utc===run.issue_time_utc&&r.lead_hours===Number(b.dataset.lead));b.disabled=!r;b.title=r?'Refined output for this issue':'No refined output for this lead in the October snapshot';b.onclick=()=>{if(r)select(r.source_id);};}
 }
 function readyLayer(id,sequence){return new Promise((resolve,reject)=>{let timer,finished=false;const cleanup=()=>{clearTimeout(timer);map.off('sourcedata',check);map.off('render',check);map.off('error',error);};const done=err=>{if(finished)return;finished=true;cleanup();err?reject(err):resolve();};const check=()=>{if(sequence!==R.sequence)return done(Error('Selection changed'));if(R.loadedTiles>0&&map.getSource(id)&&map.isSourceLoaded(id))done();};const error=e=>{if(e.sourceId===id)done(Error('Experimental source unavailable'));};timer=setTimeout(()=>done(Error('Experimental view timeout')),45000);map.on('sourcedata',check);map.on('render',check);map.on('error',error);check();});}
 async function select(source){
  const run=R.manifest.runs.find(r=>r.source_id===source);if(!run)return false;const sequence=++R.sequence;R.requested=run;R.selected=run;R.loadedTiles=0;R.status='loading';$('resolution-retry').hidden=true;drop();display();
  try{
   switchingMode=true;await P.setMode('forecast');switchingMode=false;S.historyPinned=true;const ref=archives.get(source);if(!await S.showManifest(ref.manifest,run.lead_hours))throw Error();if(sequence!==R.sequence)return false;
   labels(run);const id='resolution-detail-'+run.revision.slice(0,16)+'-'+sequence;layerId=id;map.addSource(id,{type:'raster',tiles:['detail50://'+run.revision+'/'+sequence+'/{z}/{x}/{y}'],tileSize:256,minzoom:2,maxzoom:12,bounds:[-128.4,22.4,-64,52.5],attribution:'RAI Lab · experimental 50 m spatial refinement · native 5 km source'});map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':.001,'raster-resampling':'nearest','raster-fade-duration':0}});order();const started=performance.now();await readyLayer(id,sequence);if(sequence!==R.sequence)return false;
   R.active=run;R.status='ready';if(R.fallbackNotice){$('resolution-context').hidden=true;R.fallbackNotice=false;}display();$('status').textContent='Experimental map';R.events.push({source_id:source,ready_ms:performance.now()-started,zoom:map.getZoom()});if(R.events.length>60)R.events.shift();return true;
  }catch{switchingMode=false;if(sequence===R.sequence){
   R.status='unavailable';R.failures++;drop();
   const actual=S.active?.run,retained=R.manifest.runs.find(r=>r.source_id===actual?.source_id);
   if(retained){R.selected=retained;labels(retained);}
   else if(actual){
    $('resolution-target').querySelector('option[data-native-fallback]')?.remove();const option=new Option('Native 5 km map retained','');option.disabled=true;option.dataset.nativeFallback='true';$('resolution-target').prepend(option);$('resolution-target').value='';
    $('resolution-range').disabled=true;$('resolution-previous').disabled=true;$('resolution-next').disabled=true;$('resolution-count').textContent='—';
    $('timeline-label').textContent='NATIVE 5 KM MAP';$('heading').textContent='Native 5 km · +'+actual.lead_hours+'h';$('forecast-badge').textContent='NATIVE';$('issue').textContent='Native model input '+pretty(S.manifest.issue_time_utc);$('valid').textContent='12-hour window ending '+pretty(actual.target_time_utc);
    for(const button of document.querySelectorAll('#horizons button'))button.disabled=true;
   }
   if(actual&&actual.source_id!==run.source_id){R.fallbackNotice=true;$('resolution-context').hidden=false;$('resolution-context').textContent='Requested window unavailable. The retained map is dated '+pretty(actual.target_time_utc)+'. Retry to load '+pretty(run.target_time_utc)+'.';}
   display();$('resolution-retry').hidden=false;$('status').textContent='Native 5 km map retained';
  }return false;}
 }
 R.select=select;R.retry=()=>select((R.requested||R.selected).source_id);R.protocol=protocol;
 for(let i=0;i<600;i++){S=window.fireEyePreview;P=window.fireEyePlatform;if(S?.ready&&P?.ready)break;await new Promise(r=>setTimeout(r,100));}if(!S?.ready||!P?.ready)throw Error();map=S.map;
 config=await fetch('config.json',{signal:AbortSignal.timeout(6000)}).then(r=>r.json());let manifest;
 try{const u=new URL(config.resolution_url);if(u.origin!=='https://huggingface.co'||u.search||u.hash||!/^\/datasets\/[^/]+\/[^/]+\/resolve\/main\/resolution[.]json$/.test(u.pathname))throw Error();const r=await fetch(u.href,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();manifest=validate(await r.json());}
 catch{const r=await fetch('resolution-bootstrap.json',{signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error();manifest=validate(await r.json());}
 R.manifest=manifest;archives=await getArchive();maplibregl.addProtocol('detail50',protocol);R.ready=true;
 $('resolution-target').replaceChildren();for(const run of manifest.runs)$('resolution-target').append(new Option(pretty(run.target_time_utc)+' · +'+run.lead_hours+'h',run.source_id));$('resolution-target').disabled=false;$('resolution-range').max=manifest.runs.length-1;$('resolution-range').disabled=false;
 $('resolution-target').onchange=e=>select(e.target.value);$('resolution-range').oninput=e=>{const run=manifest.runs[Number(e.target.value)];$('resolution-range').setAttribute('aria-valuetext',pretty(run.target_time_utc));};$('resolution-range').onchange=e=>select(manifest.runs[Number(e.target.value)].source_id);
 for(const [id,step]of [['resolution-previous',-1],['resolution-next',1]])$(id).onclick=()=>{const run=manifest.runs[manifest.runs.indexOf(R.selected)+step];if(run)select(run.source_id);};$('resolution-retry').onclick=R.retry;$('resolution-zoom').onclick=()=>map.easeTo({zoom:Math.max(12,map.getZoom()),duration:400});
 $('resolution-method').textContent='50 m terrain/fuel-conditioned redistribution of the native 5 km index. Fine-input coverage '+(100*manifest.fine_input_coverage_fraction).toFixed(1)+'%. Refiner fitted '+pretty(manifest.fitted_at_utc)+'. Retrospective; not a native 50 m forecast or ignition probability. Regional values and charts use the unchanged 5 km model fields.';
 P.onDisplayChange=display;const prior=S.onForecastChange;S.onForecastChange=()=>{prior?.();display();if(!switchingMode&&R.selected&&R.selected.source_id===S.active?.run.source_id)labels(R.selected);};
 // Active fires are an independent overlay; toggling them never removes detail tiles.
 $('archive-open').textContent='Back to standard map';$('archive-open').onclick=()=>{location.href='./';};map.on('zoomend',display);window.addEventListener('fire-eye:basemap-changed',()=>{order();display();});
 map.on('error',e=>{if(e.sourceId===layerId&&R.status==='ready'){R.status='unavailable';R.failures++;drop();display();$('resolution-retry').hidden=false;$('status').textContent='Native 5 km map retained';}});
 window.addEventListener('pagehide',()=>{for(const job of jobs.values()){clearTimeout(job.timer);job.cancelled=true;}for(const slot of slots)slot.worker.terminate();slots.length=0;});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 map.on('moveend',()=>{if(!R.selected)return;const c=map.getCenter(),u=new URL(location.href);u.searchParams.set('view',[c.lng.toFixed(5),c.lat.toFixed(5),map.getZoom().toFixed(2)].join(','));history.replaceState(null,'',u);});
 const latestIssue=manifest.runs.map(r=>r.issue_time_utc).sort().at(-1),initial=manifest.runs.find(r=>r.source_id===new URL(location.href).searchParams.get('source'))||manifest.runs.find(r=>r.source_id===manifest.default_source_id)||manifest.runs.find(r=>r.issue_time_utc===latestIssue&&r.lead_hours===12)||manifest.runs.at(-1);
 const requested=new URL(location.href).searchParams.get('source');if(requested&&!manifest.runs.some(r=>r.source_id===requested)){$('resolution-context').hidden=false;$('resolution-context').textContent='Showing the latest available October experimental issue. The selected standard-map source is outside this snapshot.';}
 const view=(new URL(location.href).searchParams.get('view')||'').split(',').map(Number);if(view.length===3&&view.every(Number.isFinite)&&view[0]>=-128&&view[0]<=-64&&view[1]>=22&&view[1]<=53&&view[2]>=2&&view[2]<=16)map.jumpTo({center:view.slice(0,2),zoom:view[2]});
 await select(initial.source_id);
})().catch(()=>{const e=document.getElementById('resolution-detail-state');if(e)e.textContent='Experimental archive is temporarily unavailable. The standard map remains available.';const retry=document.getElementById('resolution-retry');if(retry){retry.hidden=false;retry.onclick=()=>location.reload();}});
