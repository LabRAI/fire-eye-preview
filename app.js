'use strict';
(async function(){
 const $=id=>document.getElementById(id);const narrow=matchMedia('(max-width:640px)').matches;
 const state={manifest:null,active:null,sequence:0,lru:[],errors:[],events:[],selected:null,ready:false};window.fireEyePreview=state;
 const protocol=new pmtiles.Protocol();maplibregl.addProtocol('pmtiles',protocol.tile);
 const map=new maplibregl.Map({container:'map',antialias:true,center:[-98,38],zoom:3.2,minZoom:2,maxZoom:12,pixelRatio:Math.min(devicePixelRatio,narrow?1.5:2),maxTileCacheSize:narrow?16:32,attributionControl:false,style:{version:8,sources:{land:{type:'geojson',data:'assets/land.geojson',attribution:'RAI Lab · NOAA HRRR · Natural Earth'}},layers:[{id:'ocean',type:'background',paint:{'background-color':'#dce9e9'}},{id:'land',type:'fill',source:'land',paint:{'fill-color':'#ebe8d9'}}]}});
 state.map=map;map.addControl(new maplibregl.AttributionControl({compact:true}));map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
 map.on('error',e=>{state.errors.push({time:Date.now(),message:String(e.error?.message||'Map source failed').split('?')[0].slice(0,160)});});
 const field=['to-number',['get','prob_fire'],0];
 const opacity=['interpolate',['linear'],field,0,.16,.03,.22,.05,.32,.08,.45,.15,.58,.25,.68,.4,.76,1,.82];
 const color=['interpolate',['linear'],field,0,'#25572b',.03,'#25572b',.05,'#2f7136',.08,'#6f9641',.15,'#b7bb3e',.25,'#e0b433',.4,'#dd702d',.6,'#a92f2b',1,'#a92f2b'];
 const pretty=value=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date(value))+' UTC';
 const status=text=>{$('status').textContent=text;};
 function validate(m){
  if(m.schema_version!==1||!Array.isArray(m.runs)||m.runs.length!==4||typeof m.release_id!=='string'||!/^[0-9TZ-]+[a-f0-9]{16}$/.test(m.release_id)||!Number.isFinite(Date.parse(m.issue_time_utc)))throw Error('Invalid forecast release');
  if(m.runs.map(r=>r.lead_hours).join(',')!=='12,24,36,48')throw Error('Incomplete forecast release');
  const base=new URL(m.asset_base,location.href);if(base.protocol!=='https:'&&base.origin!==location.origin)throw Error('Invalid asset origin');
  if(base.origin!==location.origin&&!(base.hostname==='huggingface.co'&&new RegExp('^/datasets/[^/]+/[^/]+/resolve/[a-f0-9]{40}/').test(base.pathname)))throw Error('Unapproved asset origin');
  for(const r of m.runs){if(!/^forecast-h(12|24|36|48)[.]pmtiles$/.test(r.path)||!/^[a-f0-9]{64}$/.test(r.sha256)||Date.parse(r.target_time_utc)-Date.parse(m.issue_time_utc)!==r.lead_hours*3600000)throw Error('Invalid forecast entry');}
  return m;
 }
 async function json(url){const r=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Forecast index unavailable');return validate(await r.json());}
 function updateSelection(){if(!state.selected||!state.active)return;const f=map.queryRenderedFeatures(map.project(state.selected),{layers:[state.active.id]})[0];if(f){$('cell-value').textContent='Displayed fire risk · '+Number(f.properties.prob_fire).toFixed(3);state.lastValue=Number(f.properties.prob_fire);}else{$('cell-value').textContent='Outside the displayed forecast coverage';state.lastValue=null;}}
 function ensureLoaded(id){return new Promise((resolve,reject)=>{let timer,frames=0;const finish=e=>{clearTimeout(timer);map.off('render',check);map.off('error',failed);e?reject(e):resolve();};const check=()=>{frames++;if(frames===1)map.triggerRepaint();if(frames>=2&&map.getSource(id)&&map.isSourceLoaded(id))finish();};const failed=e=>{if(e.sourceId===id||!e.sourceId)finish(Error('Forecast tiles unavailable'));};timer=setTimeout(()=>finish(Error('Forecast tiles timed out')),18000);map.on('render',check);map.on('error',failed);map.triggerRepaint();});}
 function prune(){const limit=narrow?2:4;while(state.lru.length>limit){const id=state.lru.shift();if(id===state.active?.id){state.lru.push(id);continue;}if(map.getLayer(id))map.removeLayer(id);if(map.getSource(id))map.removeSource(id);}}
 async function show(m,lead){
  const seq=++state.sequence,started=performance.now(),run=m.runs.find(r=>r.lead_hours===lead);const id='forecast-'+m.release_id+'-'+lead;state.pendingId=id;
  status('Loading +'+lead+'h…');document.querySelectorAll('#horizons button').forEach(b=>b.dataset.pending=String(Number(b.dataset.lead)===lead));
  try{
   if(!map.getSource(id)){const url=new URL(run.path,new URL(m.asset_base,location.href)).href;map.addSource(id,{type:'vector',url:'pmtiles://'+url,minzoom:run.minzoom,maxzoom:run.maxzoom});map.addLayer({id,type:'fill',source:id,'source-layer':'day1',layout:{'fill-sort-key':['to-number',['get','value'],0]},paint:{'fill-antialias':false,'fill-color':color,'fill-opacity':0.001}},state.active?.id);}
   else map.setLayoutProperty(id,'visibility','visible');
   await ensureLoaded(id);if(seq!==state.sequence){if(id!==state.active?.id&&id!==state.pendingId){if(map.getLayer(id))map.removeLayer(id);if(map.getSource(id))map.removeSource(id);state.lru=state.lru.filter(x=>x!==id);}return false;}
   if(state.active&&state.active.id!==id&&map.getLayer(state.active.id))map.setLayoutProperty(state.active.id,'visibility','none');
   map.setPaintProperty(id,'fill-opacity',opacity);state.active={id,run};state.pendingId=null;state.manifest=m;state.lru=state.lru.filter(x=>x!==id);state.lru.push(id);prune();
   $('heading').textContent='Forecast +'+lead+'h';$('issue').textContent='Issued '+pretty(m.issue_time_utc);$('valid').textContent='12-hour window ending '+pretty(run.target_time_utc);
   document.querySelectorAll('#horizons button').forEach(b=>{b.setAttribute('aria-pressed',String(Number(b.dataset.lead)===lead));b.dataset.pending='false';});
   state.delivery=new URL(m.asset_base,location.href).hostname==='huggingface.co'?'huggingface':'bundled';status('Published forecast');state.ready=true;state.events.push({lead,release:m.release_id,delivery:state.delivery,ready_ms:performance.now()-started});
   try{localStorage.setItem('fire-eye-preview-last-good-v1',JSON.stringify(m));}catch{}
   updateSelection();return true;
  }catch(e){
   if(seq===state.sequence){status(state.active?'Previous forecast retained':'Forecast temporarily unavailable');document.querySelectorAll('#horizons button').forEach(b=>b.dataset.pending='false');}
   if(id!==state.active?.id&&(seq===state.sequence||id!==state.pendingId)){if(map.getLayer(id))map.removeLayer(id);if(map.getSource(id))map.removeSource(id);state.lru=state.lru.filter(x=>x!==id);}if(seq===state.sequence)state.pendingId=null;return false;
  }
 }
 for(const lead of [12,24,36,48]){const b=document.createElement('button');b.textContent='+'+lead+'h';b.dataset.lead=lead;b.setAttribute('aria-pressed','false');b.onclick=()=>{if(state.manifest)show(state.manifest,lead);};$('horizons').append(b);}
 map.on('click',e=>{if(!state.active)return;const features=map.queryRenderedFeatures(e.point,{layers:[state.active.id]});if(!features.length)return;state.selected=[e.lngLat.lng,e.lngLat.lat];$('coordinates').textContent=e.lngLat.lat.toFixed(3)+'°, '+e.lngLat.lng.toFixed(3)+'°';$('inspection').hidden=false;updateSelection();});$('close-inspection').onclick=()=>{$('inspection').hidden=true;state.selected=null;};
 await new Promise(r=>map.loaded()?r():map.once('load',r));map.fitBounds([[-125,24],[-66,50]],{padding:narrow?{top:210,bottom:180,left:10,right:10}:{top:95,bottom:180,left:315,right:40},duration:0});
 let manifestURL='latest.json';try{const c=await(await fetch('config.json',{cache:'no-store',signal:AbortSignal.timeout(4000)})).json();if(c.manifest_url)manifestURL=c.manifest_url;}catch{}
 state.manifestURL=manifestURL;let refreshTask=null;
 async function performRefresh(){
  status('Checking published forecast…');const attempted=new Set();
  async function attempt(m,saved=false){
   if(!m)return false;const key=m.release_id+'|'+new URL(m.asset_base,location.href).href;if(attempted.has(key))return false;attempted.add(key);
   if(state.active&&Date.parse(m.issue_time_utc)<Date.parse(state.manifest.issue_time_utc)){status('Previous forecast retained');return true;}
   if(m.release_id===state.manifest?.release_id&&state.active){status('Published forecast');return true;}
   const ok=await show(m,state.active?.run.lead_hours||12);if(ok&&saved)status('Showing saved forecast');return ok;
  }
  const published=await json(manifestURL).catch(()=>null);if(await attempt(published))return;
  if(state.active){status('Previous forecast retained');return;}
  let cached=null;try{cached=validate(JSON.parse(localStorage.getItem('fire-eye-preview-last-good-v1')));}catch{}
  if(await attempt(cached,true))return;
  if(await attempt(await json('bootstrap.json').catch(()=>null),true))return;
  status('Forecast temporarily unavailable');
 }
 function refresh(){if(!refreshTask)refreshTask=performRefresh().finally(()=>{refreshTask=null;});return refreshTask;}
 state.select=lead=>show(state.manifest,lead);state.refresh=refresh;$('refresh').onclick=refresh;await refresh();setInterval(()=>{if(!document.hidden)refresh();},300000);
})().catch(()=>{document.getElementById('status').textContent='Map temporarily unavailable';});
