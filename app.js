'use strict';
(async function(){
 const $=id=>document.getElementById(id),narrow=matchMedia('(max-width:640px)').matches;
 const state={manifest:null,active:null,sequence:0,lru:[],errors:[],events:[],selected:null,ready:false,gridCache:new Map(),detailFailures:new Set()};window.fireEyePreview=state;
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
 // Resolve configuration before synchronous WebGL startup can delay its timeout.
 const loadConfig=()=>fetch('config.json',{cache:'no-store',signal:AbortSignal.timeout(4000)}).then(r=>r.ok?r.json():null).catch(()=>null);
 const configuration=await loadConfig();state.manifestURL=configuration?.manifest_url||null;
 const initialTask=state.manifestURL?json(state.manifestURL).catch(()=>null):Promise.resolve(null);
 const protocol=new pmtiles.Protocol();
 // MapLibre's installed raster loader leaves null image tiles pending forever.
 // Only absent landscape display tiles become transparent; errors still fail.
 const emptyRasterCanvas=document.createElement('canvas');emptyRasterCanvas.width=emptyRasterCanvas.height=1;
 const emptyRaster=Uint8Array.from(atob(emptyRasterCanvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));
 state.backgroundNoDataTiles=0;
 maplibregl.addProtocol('pmtiles',(params,callback)=>protocol.tile(params,(err,data,cacheControl,expires)=>{
  if(!err&&data===null&&params.url.includes('/background/assets/')){state.backgroundNoDataTiles++;callback(null,emptyRaster,cacheControl,expires);}
  else callback(err,data,cacheControl,expires);
 }));
 const map=new maplibregl.Map({container:'map',antialias:false,center:[-98,38],zoom:3.2,minZoom:2,maxZoom:12,pixelRatio:Math.min(devicePixelRatio,narrow?1.5:2),maxTileCacheSize:narrow?16:32,attributionControl:false,style:{version:8,sources:{land:{type:'geojson',data:'assets/land.geojson',attribution:'RAI Lab · NOAA HRRR · Natural Earth'}},layers:[{id:'ocean',type:'background',paint:{'background-color':'#dce9e9'}},{id:'land',type:'fill',source:'land',paint:{'fill-color':'#ebe8d9'}}]}});
 state.map=map;map.addControl(new maplibregl.AttributionControl({compact:true}));map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
 map.on('error',e=>{state.errors.push({time:Date.now(),message:String(e.error?.message||'Map source failed').split('?')[0].slice(0,160)});if(e.sourceId?.startsWith('forecast-')&&!e.sourceId.endsWith('-overview')){state.detailFailures.add(e.sourceId);syncHeatmapDisplay();}});
 const urlFor=(m,path)=>new URL(path,new URL(m.asset_base,location.href)).href;
 const representation=run=>run.overview&&(!run.path||map.getZoom()<run.overview.detail_minzoom+(state.active?.kind==='vector'?-.25:.25))?'overview':'vector';
 const sourceId=(m,run,kind)=>'forecast-'+m.release_id+'-'+run.lead_hours+(kind==='overview'?'-overview':'');
 // Keep a same-window image available while detail tiles change with the view.
 state.riskOpacity=1;state.riskVisible=true;
 function syncHeatmapDisplay(){
  const active=state.active;if(!active||!map.getLayer(active.id))return;
  const fine=state.refinementDisplay,selected=!!(fine?.ready&&fine.source_id===active.run.source_id&&fine.issue_time_utc===state.manifest?.issue_time_utc&&map.getLayer(fine.id));
  state.refinementMix=selected?1:0;
  const alpha=state.riskOpacity*(state.geographyRiskFactor??1),visible=state.riskVisible!==false,fallback=state.overviewFallbackId;
  const detail=active.kind==='vector'&&(!fallback||(!state.detailFailures.has(active.id)&&!state.viewInMotion&&!map.isMoving()&&map.isSourceLoaded(active.id)));
  const nativeId=active.kind==='vector'&&!detail&&fallback?fallback:active.id;
  const winner=visible?(selected?fine.id:nativeId):null;
  let layers;try{layers=map.getStyle()?.layers||[];}catch{return;}
  // One authority owns all forecast paint. Pending layers can fetch at zero
  // opacity; cached, failed and superseded representations cannot contribute.
  const staging=new Set([!selected&&active.kind==='vector'?active.id:null,state.pendingId,state.pendingId&&!state.pendingId.endsWith('-overview')?state.pendingId+'-overview':null,fine&&!fine.ready?fine.id:null]);
  const forecastLayers=layers.filter(l=>/^(forecast-|adaptive-resolution-|resolution-detail-)/.test(l.id));
  const apply=(layer,paint,show)=>{
   const property=layer.type==='fill'?'fill-opacity':'raster-opacity';
   if(JSON.stringify(map.getPaintProperty(layer.id,property))!==JSON.stringify(paint))map.setPaintProperty(layer.id,property,paint);
   const visibility=show?'visible':'none';if((map.getLayoutProperty(layer.id,'visibility')||'visible')!==visibility)map.setLayoutProperty(layer.id,'visibility',visibility);
  };
  // Retire the previous representation before enabling its replacement.
  for(const layer of forecastLayers)if(layer.id!==winner)apply(layer,0,staging.has(layer.id));
  const chosen=forecastLayers.find(l=>l.id===winner);if(chosen)apply(chosen,chosen.type==='fill'?['*',alpha,opacity]:alpha,true);
  state.forecastDisplay={layer:winner,resolution:selected?50:5000,source_id:active.run.source_id,issue_time_utc:state.manifest?.issue_time_utc};
 }
 state.setRefinementDisplay=value=>{state.refinementDisplay=value;syncHeatmapDisplay();};
 // Keep forecast colors below actual permanent-water geometry, with roads and
 // buildings above it. Reuse the basemap source: no extra geography download.
 let coastalWater=null,orderingForecast=false;
 function orderForecastLayers(){
  if(orderingForecast)return;let layers;try{layers=map.getStyle()?.layers;}catch{state.coastalMask={ready:false};return;}if(!layers)return;
  const basemapIds=window.fireEyePlatform?.basemapLayerIds||[];
  const water=layers.find(l=>basemapIds.includes(l.id)&&l.type==='fill'&&l['source-layer']==='water');
  if(water)coastalWater=water;
  if(!coastalWater||!map.getSource(coastalWater.source))return;
  orderingForecast=true;
  try{
   const mask='risk-water-mask',foreground=layers.find(l=>/^(platform-|selection-|vector-context|hurricane-|mapped-scene-)/.test(l.id)||l.type==='symbol')?.id;
   const color=water?coastalWater.paint?.['fill-color']||'#AECFE2':map.getPaintProperty('ocean','background-color')||'#dce9e9';
   if(!map.getLayer(mask))map.addLayer({id:mask,type:'fill',source:coastalWater.source,'source-layer':coastalWater['source-layer'],...(coastalWater.filter?{filter:coastalWater.filter}:{}),paint:{'fill-color':color,'fill-opacity':1,'fill-antialias':false}},foreground);
   else if(JSON.stringify(map.getPaintProperty(mask,'fill-color'))!==JSON.stringify(color))map.setPaintProperty(mask,'fill-color',color);
   const position=id=>map.getStyle().layers.findIndex(l=>l.id===id);
   for(const layer of layers.filter(l=>/^(forecast-|adaptive-resolution-|resolution-detail-)/.test(l.id)))if(position(layer.id)>position(mask))map.moveLayer(layer.id,mask);
   // Water must not cover bridge decks, roads, buildings, or map annotations.
   for(const layer of layers.filter(l=>basemapIds.includes(l.id)&&(l.type==='line'||l.type==='fill'&&['building','transportation','aeroway'].includes(l['source-layer']))))if(position(layer.id)<position(mask))map.moveLayer(layer.id,foreground);
   state.coastalMask={ready:true,layer:mask,source:coastalWater.source};
  }catch{state.coastalMask={ready:false};}finally{orderingForecast=false;}
 }
 state.orderForecastLayers=orderForecastLayers;
 map.on('idle',orderForecastLayers);
 map.on('styledata',()=>{if(!map.getLayer('risk-water-mask')||state.coastalMask?.ready===false)orderForecastLayers();});
 window.addEventListener('fire-eye:basemap-changed',orderForecastLayers);
 state.syncHeatmapDisplay=syncHeatmapDisplay;
 state.setRiskDisplay=(alpha,visible)=>{state.riskOpacity=alpha;state.riskVisible=visible;syncHeatmapDisplay();};
 const syncDuringMove=()=>{if(!document.body.classList.contains('resolution-lab'))syncHeatmapDisplay();};
 map.on('movestart',()=>{state.viewInMotion=true;syncDuringMove();});map.on('move',syncDuringMove);map.on('moveend',()=>{state.viewInMotion=false;syncDuringMove();});map.on('idle',syncDuringMove);
 map.on('sourcedata',e=>{if(e.sourceId===state.active?.id||e.sourceId===state.overviewFallbackId)syncDuringMove();});
 // Reused sources may still hold the previous window's nonzero paint. Stage
 // them invisibly before loading so cached tiles cannot flash over the selection.
 function stageForecastLayer(id){
  const layer=map.getLayer(id);if(!layer)return;
  const owned=id===state.active?.id||id===state.overviewFallbackId;
  if(!owned||(state.refinementMix??0)>=1||map.getLayoutProperty(id,'visibility')==='none'){
   map.setPaintProperty(id,layer.type==='raster'?'raster-opacity':'fill-opacity',0);
   if(id===state.active?.id)state.paintedActive=null;
   if(id===state.overviewFallbackId)state.paintedFallback=null;
  }
  map.setLayoutProperty(id,'visibility','visible');
 }
 async function prepareFallback(m,run){
  if(!run.overview||document.body.classList.contains('resolution-lab'))return null;
  const id=sourceId(m,run,'overview');
  if(!map.getSource(id)){map.addSource(id,{type:'image',url:urlFor(m,run.overview.image.path),coordinates:run.overview.coordinates});map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':0,'raster-opacity-transition':{duration:0,delay:0},'raster-fade-duration':0,'raster-resampling':'nearest'}},state.active?.id);}
  else stageForecastLayer(id);
  await ensureLoaded(id);return id;
 }
 function drop(id){if(map.getLayer(id))map.removeLayer(id);if(map.getSource(id))map.removeSource(id);state.lru=state.lru.filter(x=>x!==id);state.detailFailures.delete(id);}
 function prune(){const limit=narrow?3:5;let guard=state.lru.length;while(state.lru.length>limit&&guard--){const id=state.lru.shift();if([state.active?.id,state.pendingId,state.overviewFallbackId].includes(id)){state.lru.push(id);continue;}drop(id);}}
 function ensureLoaded(id){return new Promise((resolve,reject)=>{let timer,settled=false;const finish=e=>{if(settled)return;settled=true;clearTimeout(timer);map.off('render',check);map.off('sourcedata',check);map.off('error',failed);e?reject(e):resolve();};const check=()=>{if(map.getSource(id)&&map.isSourceLoaded(id))finish();};const failed=e=>{if(e.sourceId===id)finish(Error('Forecast assets unavailable'));};timer=setTimeout(()=>finish(Error('Forecast assets timed out')),18000);map.on('render',check);map.on('sourcedata',check);map.on('error',failed);map.triggerRepaint();});}
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
  const run=m.runs.find(r=>r.lead_hours===lead);if(!run)return false;const kind=representation(run),id=sourceId(m,run,kind);
  if(state.active?.id===id&&!state.pendingId)return true;
  const sameSelection=m.release_id===state.manifest?.release_id&&lead===state.active?.run.lead_hours&&!!m.archive===!!state.manifest?.archive;
  const seq=++state.sequence,started=performance.now();state.pendingId=id;if(!sameSelection)status('Loading +'+lead+'h…');document.querySelectorAll('#horizons button').forEach(b=>b.dataset.pending=String(Number(b.dataset.lead)===lead));
  try{
   if(kind==='vector'&&state.detailFailures.has(id)&&id!==state.active?.id){drop(id);state.detailFailures.delete(id);}
   if(!map.getSource(id)){
    if(kind==='overview'){map.addSource(id,{type:'image',url:urlFor(m,run.overview.image.path),coordinates:run.overview.coordinates});map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':0,'raster-opacity-transition':{duration:0,delay:0},'raster-fade-duration':0,'raster-resampling':'nearest'}},state.active?.id);}
    else{map.addSource(id,{type:'vector',url:'pmtiles://'+urlFor(m,run.path),minzoom:run.minzoom,maxzoom:run.maxzoom});map.addLayer({id,type:'fill',source:id,'source-layer':'day1',layout:{'fill-sort-key':['to-number',['get','value'],0]},paint:{'fill-antialias':false,'fill-color':color,'fill-opacity':0,'fill-opacity-transition':{duration:0,delay:0}}},state.active?.id);}
   }else stageForecastLayer(id);
   const [,fallback]=await Promise.all([ensureLoaded(id),kind==='vector'?prepareFallback(m,run):Promise.resolve(null)]);const sourceMs=performance.now()-started;
   if(seq!==state.sequence){if(id!==state.active?.id&&id!==state.pendingId)drop(id);if(fallback&&![state.active?.id,state.overviewFallbackId,state.pendingId,state.pendingId+'-overview'].includes(fallback))drop(fallback);return false;}
   if(state.active&&state.active.id!==id&&map.getLayer(state.active.id))map.setLayoutProperty(state.active.id,'visibility','none');
   if(state.overviewFallbackId&&state.overviewFallbackId!==fallback&&state.overviewFallbackId!==id&&map.getLayer(state.overviewFallbackId))map.setLayoutProperty(state.overviewFallbackId,'visibility','none');
   state.overviewFallbackId=fallback;state.paintedFallback=null;if(fallback){map.moveLayer(fallback,id);state.lru=state.lru.filter(x=>x!==fallback);state.lru.push(fallback);}
   state.active={id,run,kind};state.pendingId=null;state.manifest=m;if(!m.archive)state.latestManifest=m;state.lru=state.lru.filter(x=>x!==id);state.lru.push(id);syncHeatmapDisplay();prune();orderForecastLayers();
   $('heading').textContent='Forecast +'+lead+'h';$('issue').textContent='Issued '+pretty(m.issue_time_utc);$('valid').textContent='12-hour window ending '+pretty(run.target_time_utc);
   document.querySelectorAll('#horizons button').forEach(b=>{const available=m.runs.some(r=>r.lead_hours===Number(b.dataset.lead));b.disabled=!available;b.title=available?'':'Not archived for this issue';b.setAttribute('aria-pressed',String(Number(b.dataset.lead)===lead));b.dataset.pending='false';});
   state.delivery=new URL(m.asset_base,location.href).hostname==='huggingface.co'?'huggingface':'bundled';status('Published forecast');state.ready=true;
   await new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint();});
   if(seq!==state.sequence)return false;
   state.events.push({lead,release:m.release_id,kind,delivery:state.delivery,source_ready_ms:sourceMs,ready_ms:performance.now()-started});
   try{if(!m.archive)localStorage.setItem('fire-eye-preview-last-good-v1',JSON.stringify(m));}catch{}
   ensureGrid(m,run).catch(()=>{});updateSelection();if(!sameSelection){if(state.onForecastChange)state.onForecastChange();window.dispatchEvent(new Event('fire-eye:forecast-changed'));}
   if(seq===state.sequence&&kind!==representation(run))show(m,lead);return true;
  }catch(e){if(seq===state.sequence){status(state.active?'Previous forecast retained':'Forecast temporarily unavailable');document.querySelectorAll('#horizons button').forEach(b=>b.dataset.pending='false');}
   if(seq===state.sequence)state.pendingId=null;
   const protectedIds=[state.active?.id,state.overviewFallbackId,state.pendingId,state.pendingId?state.pendingId+'-overview':null];
   for(const candidate of [id,kind==='vector'&&run.overview?sourceId(m,run,'overview'):null])if(candidate&&!protectedIds.includes(candidate))drop(candidate);
   syncHeatmapDisplay();return false;}
 }
 for(const lead of [12,24,36,48]){const b=document.createElement('button');b.textContent='+'+lead+'h';b.dataset.lead=lead;b.setAttribute('aria-pressed','false');b.onclick=()=>{if(state.manifest)show(state.manifest,lead);};$('horizons').append(b);}
 let clickSequence=0;map.on('click',async e=>{if(window.fireEyeGeography?.onMapClick?.(e))return;if(!state.active)return;if(state.onMapClick){state.onMapClick(e);return;}const seq=++clickSequence,active=state.active,lnglat=[e.lngLat.lng,e.lngLat.lat];try{const value=await valueAt(state.manifest,active.run,lnglat);if(seq!==clickSequence||state.active!==active)return;if(value===null){$('inspection').hidden=true;state.selected=null;return;}state.selected=lnglat;state.lastValue=value;$('coordinates').textContent=lnglat[1].toFixed(3)+'°, '+lnglat[0].toFixed(3)+'°';$('cell-value').textContent='Fire risk at selected location · '+value.toFixed(3);$('inspection').hidden=false;}catch{status('Location values temporarily unavailable');}});
 $('close-inspection').onclick=()=>{clickSequence++;$('inspection').hidden=true;state.selected=null;if(state.onCloseSelection)state.onCloseSelection();};
 map.on('zoomend',()=>{if(state.active&&!state.pendingId&&representation(state.active.run)!==state.active.kind)show(state.manifest,state.active.run.lead_hours);});
 await new Promise(r=>map.loaded()?r():map.once('load',r));map.fitBounds([[-125,24],[-66,50]],{padding:narrow?{top:30,bottom:35,left:20,right:20}:{top:40,bottom:40,left:335,right:40},duration:0});
 let refreshTask=null,initial=true;
 async function performRefresh(){status('Checking published forecast…');const attempted=new Set();
  async function attempt(m,saved=false){if(!m)return false;const key=m.release_id+'|'+new URL(m.asset_base,location.href).href;if(attempted.has(key))return false;attempted.add(key);
   if(state.active&&Date.parse(m.issue_time_utc)<Date.parse(state.manifest.issue_time_utc)){status('Previous forecast retained');return true;}
   if(state.historyPinned&&state.active){state.latestManifest=m;status('Viewing forecast archive');return true;}if(m.release_id===state.manifest?.release_id&&state.active){status('Published forecast');return true;}
   const ok=await show(m,state.active?.run.lead_hours||12);if(ok&&saved)status('Showing saved forecast');return ok;}
  if(!initial&&!state.manifestURL){const configuration=await loadConfig();state.manifestURL=configuration?.manifest_url||null;}
  const published=initial?await initialTask:(state.manifestURL?await json(state.manifestURL).catch(()=>null):null);initial=false;if(await attempt(published))return;
  if(state.active){status('Previous forecast retained');return;}let cached=null;try{cached=validate(JSON.parse(localStorage.getItem('fire-eye-preview-last-good-v1')));}catch{}
  if(await attempt(cached,true))return;if(await attempt(await json('bootstrap.json').catch(()=>null),true))return;status('Forecast temporarily unavailable');
 }
 function refresh(){if(!refreshTask)refreshTask=performRefresh().finally(()=>{refreshTask=null;});return refreshTask;}
 state.gridFor=ensureGrid;state.valueAt=valueAt;state.showManifest=show;state.select=lead=>show(state.manifest,lead);state.query=lnglat=>valueAt(state.manifest,state.active.run,lnglat);state.refresh=refresh;$('refresh').onclick=refresh;await refresh();setInterval(()=>{if(!document.hidden)refresh();},300000);
})().catch(()=>{document.getElementById('status').textContent='Map temporarily unavailable';});
