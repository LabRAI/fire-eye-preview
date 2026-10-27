'use strict';
(async function(){
 const $=id=>document.getElementById(id),narrow=matchMedia('(max-width:640px)').matches;
 const state={manifest:null,active:null,sequence:0,lru:[],errors:[],events:[],selected:null,ready:false,gridCache:new Map()};window.fireEyePreview=state;
 const status=text=>{$('status').textContent=text;};
 const pretty=value=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date(value))+' UTC';
 const field=['to-number',['get','prob_fire'],0];
 const opacity=['interpolate',['linear'],field,0,.16,.03,.22,.05,.32,.08,.45,.15,.58,.25,.68,.4,.76,1,.82];
 const color=['interpolate',['linear'],field,0,'#25572b',.03,'#25572b',.05,'#2f7136',.08,'#6f9641',.15,'#b7bb3e',.25,'#e0b433',.4,'#dd702d',.6,'#a92f2b',1,'#a92f2b'];
 function validate(m){
  if(m.schema_version!==1||!Array.isArray(m.runs)||m.runs.length!==4||typeof m.release_id!=='string'||!/^[0-9TZ-]+[a-f0-9]{16}$/.test(m.release_id)||!Number.isFinite(Date.parse(m.issue_time_utc)))throw Error('Invalid forecast release');
  if(m.runs.map(r=>r.lead_hours).join(',')!=='12,24,36,48')throw Error('Incomplete forecast release');
  const base=new URL(m.asset_base,location.href);if(base.protocol!=='https:'&&base.origin!==location.origin)throw Error('Invalid asset origin');
  if(base.origin!==location.origin&&!(base.hostname==='huggingface.co'&&new RegExp('^/datasets/[^/]+/[^/]+/resolve/[a-f0-9]{40}/').test(base.pathname)))throw Error('Unapproved asset origin');
  for(const r of m.runs){
   if(r.path!=='forecast-h'+r.lead_hours+'.pmtiles'||!/^[a-f0-9]{64}$/.test(r.sha256)||Date.parse(r.target_time_utc)-Date.parse(m.issue_time_utc)!==r.lead_hours*3600000)throw Error('Invalid forecast entry');
   if(r.overview){const o=r.overview,g=o.grid;
    if(o.image.path!=='overview-h'+r.lead_hours+'.png'||o.values.path!=='values-h'+r.lead_hours+'.bin'||![o.image,o.values].every(a=>/^[a-f0-9]{64}$/.test(a.sha256))||!Array.isArray(o.coordinates)||o.coordinates.length!==4||!o.coordinates.every(p=>p.length===2&&p.every(Number.isFinite)))throw Error('Invalid display assets');
    if(g.crs!=='EPSG:5070'||g.width!==938||g.height!==609||g.scale!==.001||g.nodata!==65535||g.transform.join(',')!=='5000,0,-2362425,0,-5000,3267405'||o.values.bytes!==g.width*g.height*2||o.detail_minzoom!==6)throw Error('Unsupported numeric grid');
   }
  }return m;
 }
 async function json(url){const r=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Forecast index unavailable');return validate(await r.json());}
 // Fetch the small publication index while the basemap and renderer start.
 const configTask=fetch('config.json',{cache:'no-store',signal:AbortSignal.timeout(4000)}).then(r=>r.json()).catch(()=>({}));
 const initialTask=configTask.then(c=>{state.manifestURL=c.manifest_url||'latest.json';return json(state.manifestURL);}).catch(()=>null);
 const protocol=new pmtiles.Protocol();maplibregl.addProtocol('pmtiles',protocol.tile);
 const map=new maplibregl.Map({container:'map',antialias:false,center:[-98,38],zoom:3.2,minZoom:2,maxZoom:12,pixelRatio:Math.min(devicePixelRatio,narrow?1.5:2),maxTileCacheSize:narrow?16:32,attributionControl:false,style:{version:8,sources:{land:{type:'geojson',data:'assets/land.geojson',attribution:'RAI Lab · NOAA HRRR · Natural Earth'}},layers:[{id:'ocean',type:'background',paint:{'background-color':'#dce9e9'}},{id:'land',type:'fill',source:'land',paint:{'fill-color':'#ebe8d9'}}]}});
 state.map=map;map.addControl(new maplibregl.AttributionControl({compact:true}));map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
 map.on('error',e=>{state.errors.push({time:Date.now(),message:String(e.error?.message||'Map source failed').split('?')[0].slice(0,160)});});
 const urlFor=(m,path)=>new URL(path,new URL(m.asset_base,location.href)).href;
 const representation=run=>run.overview&&map.getZoom()<run.overview.detail_minzoom?'overview':'vector';
 const sourceId=(m,run,kind)=>'forecast-'+m.release_id+'-'+run.lead_hours+(kind==='overview'?'-overview':'');
 function drop(id){if(map.getLayer(id))map.removeLayer(id);if(map.getSource(id))map.removeSource(id);state.lru=state.lru.filter(x=>x!==id);}
 function prune(){const limit=narrow?2:4;while(state.lru.length>limit){const id=state.lru.shift();if(id===state.active?.id){state.lru.push(id);continue;}drop(id);}}
 function ensureLoaded(id){return new Promise((resolve,reject)=>{let timer,settled=false;const finish=e=>{if(settled)return;settled=true;clearTimeout(timer);map.off('render',check);map.off('sourcedata',check);map.off('error',failed);e?reject(e):resolve();};const check=()=>{if(map.getSource(id)&&map.isSourceLoaded(id))finish();};const failed=e=>{if(e.sourceId===id||!e.sourceId)finish(Error('Forecast assets unavailable'));};timer=setTimeout(()=>finish(Error('Forecast assets timed out')),18000);map.on('render',check);map.on('sourcedata',check);map.on('error',failed);map.triggerRepaint();});}
 async function ensureGrid(m,run){
  if(!run.overview)return null;const key=urlFor(m,run.overview.values.path);
  if(state.gridCache.has(key))return state.gridCache.get(key);
  const promise=(async()=>{const r=await fetch(key,{credentials:'omit',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Location values unavailable');const buffer=await r.arrayBuffer();if(buffer.byteLength!==run.overview.values.bytes)throw Error('Numeric grid size mismatch');
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),x=>x.toString(16).padStart(2,'0')).join('');if(hash!==run.overview.values.sha256)throw Error('Numeric grid checksum mismatch');return {view:new DataView(buffer),grid:run.overview.grid};})();
  state.gridCache.set(key,promise);while(state.gridCache.size>(narrow?2:4))state.gridCache.delete(state.gridCache.keys().next().value);
  try{return await promise;}catch(e){state.gridCache.delete(key);throw e;}
 }
 async function valueAt(m,run,lnglat){
  const loaded=await ensureGrid(m,run);
  if(loaded){const g=loaded.grid,[x,y]=proj4('EPSG:4326','+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs',lnglat),t=g.transform;
   if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Coordinate conversion failed');const col=Math.floor((x-t[2])/t[0]),row=Math.floor((y-t[5])/t[4]);if(col<0||row<0||col>=g.width||row>=g.height)return null;
   const raw=loaded.view.getUint16(2*(row*g.width+col),true);if(raw===g.nodata)return null;if(raw>1000)throw Error('Invalid numeric grid value');return raw*g.scale;
  }
  const f=map.queryRenderedFeatures(map.project(lnglat),{layers:[state.active.id]}).find(f=>!Number(f.properties.background));return f?Number(f.properties.prob_fire):null;
 }
 async function updateSelection(){
  if(!state.selected||!state.active)return;const active=state.active,selected=state.selected;
  try{const value=await valueAt(state.manifest,active.run,selected);if(state.active!==active||state.selected!==selected)return;state.lastValue=value;$('cell-value').textContent=value===null?'Outside forecast coverage':'Fire risk at selected location · '+value.toFixed(3);}catch{if(state.active===active)$('cell-value').textContent='Location values temporarily unavailable';}
 }
 async function show(m,lead){
  const run=m.runs.find(r=>r.lead_hours===lead),kind=representation(run),id=sourceId(m,run,kind);
  if(state.active?.id===id&&!state.pendingId)return true;
  const seq=++state.sequence,started=performance.now();state.pendingId=id;status('Loading +'+lead+'h…');document.querySelectorAll('#horizons button').forEach(b=>b.dataset.pending=String(Number(b.dataset.lead)===lead));
  try{
   if(!map.getSource(id)){
    if(kind==='overview'){map.addSource(id,{type:'image',url:urlFor(m,run.overview.image.path),coordinates:run.overview.coordinates});map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':0.001,'raster-fade-duration':0,'raster-resampling':'nearest'}},state.active?.id);}
    else{map.addSource(id,{type:'vector',url:'pmtiles://'+urlFor(m,run.path),minzoom:run.minzoom,maxzoom:run.maxzoom});map.addLayer({id,type:'fill',source:id,'source-layer':'day1',layout:{'fill-sort-key':['to-number',['get','value'],0]},paint:{'fill-antialias':false,'fill-color':color,'fill-opacity':0.001}},state.active?.id);}
   }else map.setLayoutProperty(id,'visibility','visible');
   await ensureLoaded(id);const sourceMs=performance.now()-started;
   if(seq!==state.sequence){if(id!==state.active?.id&&id!==state.pendingId)drop(id);return false;}
   if(state.active&&state.active.id!==id&&map.getLayer(state.active.id))map.setLayoutProperty(state.active.id,'visibility','none');
   map.setPaintProperty(id,kind==='overview'?'raster-opacity':'fill-opacity',kind==='overview'?1:opacity);
   state.active={id,run,kind};state.pendingId=null;state.manifest=m;state.lru=state.lru.filter(x=>x!==id);state.lru.push(id);prune();
   $('heading').textContent='Forecast +'+lead+'h';$('issue').textContent='Issued '+pretty(m.issue_time_utc);$('valid').textContent='12-hour window ending '+pretty(run.target_time_utc);
   document.querySelectorAll('#horizons button').forEach(b=>{b.setAttribute('aria-pressed',String(Number(b.dataset.lead)===lead));b.dataset.pending='false';});
   state.delivery=new URL(m.asset_base,location.href).hostname==='huggingface.co'?'huggingface':'bundled';status('Published forecast');state.ready=true;
   await new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint();});
   if(seq!==state.sequence)return false;
   state.events.push({lead,release:m.release_id,kind,delivery:state.delivery,source_ready_ms:sourceMs,ready_ms:performance.now()-started});
   try{localStorage.setItem('fire-eye-preview-last-good-v1',JSON.stringify(m));}catch{}
   ensureGrid(m,run).catch(()=>{});updateSelection();
   if(seq===state.sequence&&kind!==representation(run))show(m,lead);return true;
  }catch(e){if(seq===state.sequence){status(state.active?'Previous forecast retained':'Forecast temporarily unavailable');document.querySelectorAll('#horizons button').forEach(b=>b.dataset.pending='false');}
   if(id!==state.active?.id&&(seq===state.sequence||id!==state.pendingId))drop(id);if(seq===state.sequence)state.pendingId=null;return false;}
 }
 for(const lead of [12,24,36,48]){const b=document.createElement('button');b.textContent='+'+lead+'h';b.dataset.lead=lead;b.setAttribute('aria-pressed','false');b.onclick=()=>{if(state.manifest)show(state.manifest,lead);};$('horizons').append(b);}
 let clickSequence=0;map.on('click',async e=>{if(!state.active)return;const seq=++clickSequence,active=state.active,lnglat=[e.lngLat.lng,e.lngLat.lat];try{const value=await valueAt(state.manifest,active.run,lnglat);if(seq!==clickSequence||state.active!==active)return;if(value===null){$('inspection').hidden=true;state.selected=null;return;}state.selected=lnglat;state.lastValue=value;$('coordinates').textContent=lnglat[1].toFixed(3)+'°, '+lnglat[0].toFixed(3)+'°';$('cell-value').textContent='Fire risk at selected location · '+value.toFixed(3);$('inspection').hidden=false;}catch{status('Location values temporarily unavailable');}});
 $('close-inspection').onclick=()=>{clickSequence++;$('inspection').hidden=true;state.selected=null;};
 map.on('zoomend',()=>{if(state.active&&!state.pendingId&&representation(state.active.run)!==state.active.kind)show(state.manifest,state.active.run.lead_hours);});
 await new Promise(r=>map.loaded()?r():map.once('load',r));map.fitBounds([[-125,24],[-66,50]],{padding:narrow?{top:210,bottom:180,left:10,right:10}:{top:95,bottom:180,left:315,right:40},duration:0});
 let refreshTask=null,initial=true;
 async function performRefresh(){status('Checking published forecast…');const attempted=new Set();
  async function attempt(m,saved=false){if(!m)return false;const key=m.release_id+'|'+new URL(m.asset_base,location.href).href;if(attempted.has(key))return false;attempted.add(key);
   if(state.active&&Date.parse(m.issue_time_utc)<Date.parse(state.manifest.issue_time_utc)){status('Previous forecast retained');return true;}
   if(m.release_id===state.manifest?.release_id&&state.active){status('Published forecast');return true;}
   const ok=await show(m,state.active?.run.lead_hours||12);if(ok&&saved)status('Showing saved forecast');return ok;}
  const published=initial?await initialTask:await json(state.manifestURL).catch(()=>null);initial=false;if(await attempt(published))return;
  if(state.active){status('Previous forecast retained');return;}let cached=null;try{cached=validate(JSON.parse(localStorage.getItem('fire-eye-preview-last-good-v1')));}catch{}
  if(await attempt(cached,true))return;if(await attempt(await json('bootstrap.json').catch(()=>null),true))return;status('Forecast temporarily unavailable');
 }
 function refresh(){if(!refreshTask)refreshTask=performRefresh().finally(()=>{refreshTask=null;});return refreshTask;}
 state.select=lead=>show(state.manifest,lead);state.query=lnglat=>valueAt(state.manifest,state.active.run,lnglat);state.refresh=refresh;$('refresh').onclick=refresh;await refresh();setInterval(()=>{if(!document.hidden)refresh();},300000);
})().catch(()=>{document.getElementById('status').textContent='Map temporarily unavailable';});
