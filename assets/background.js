'use strict';
(async function(){
 const $=id=>document.getElementById(id);
 const B={ready:false,manifest:null,selected:'',status:'idle',errors:[],saved:false};
 window.fireEyeBackground=B;
 const ids=['landcover','canopy','population','dead-down-carbon','standing-dead-carbon','dry-dead-biomass'];
 const text=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;};
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let sourceId='landscape-background',generation=0;
 let S,map,timeout,indexTask,configuration,readyCheck;
 function validate(m){
  if(m.schema_version!==1||m.kind!=='background-layers'||m.display_maxzoom!==10||!Array.isArray(m.layers)||m.layers.length!==ids.length||new Set(m.layers.map(l=>l.id)).size!==ids.length)throw Error('Invalid background catalog');
  for(const layer of m.layers){
   const a=layer.asset;
   if(!ids.includes(layer.id)||!a||a.path!==layer.id+'.pmtiles'||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isInteger(a.bytes)||a.bytes<=0||a.bytes>1e9||a.maxzoom!==10||a.minzoom!==0||a.tile_size!==512||!a.verification?.all_retained_tiles_byte_identical||a.verification.tiles_verified!==a.tile_count)throw Error('Invalid background layer');
   const u=new URL(a.url);
   if(u.protocol!=='https:'||u.hostname!=='huggingface.co'||u.username||u.password||u.search||u.hash||!new RegExp('^/datasets/[^/]+/[^/]+/resolve/[a-f0-9]{40}/background/assets/'+a.sha256+'/'+layer.id+'[.]pmtiles$').test(u.pathname))throw Error('Invalid background asset origin');
   if(!Array.isArray(layer.legend)||layer.legend.length>64||layer.legend.some(x=>typeof x.label!=='string'||x.label.length>160||!CSS.supports('color',x.color)))throw Error('Invalid background legend');
   for(const key of ['label','edition','provider','units'])if(typeof layer[key]!=='string'||layer[key].length>250)throw Error('Invalid background description');
  }
  return m;
 }
 async function index(){
  configuration ||= await fetch('config.json',{signal:AbortSignal.timeout(6000)}).then(r=>r.ok?r.json():{}).catch(()=>({}));
  if(configuration.background_url){
   try{const u=new URL(configuration.background_url);if(u.protocol!=='https:'||u.hostname!=='huggingface.co'||!new RegExp('^/datasets/[^/]+/[^/]+/resolve/main/background[.]json$').test(u.pathname))throw Error();
    const r=await fetch(u.href,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();const m=validate(await r.json());B.saved=false;return m;
   }catch{}
  }
  B.saved=true;if(B.manifest)return B.manifest;
  const r=await fetch('background-bootstrap.json',{credentials:'omit',signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error('Background index unavailable');return validate(await r.json());
 }
 function order(){
  if(!map?.getLayer(sourceId))return;
  const layers=map.getStyle()?.layers||[],anchor=layers.find(l=>/^(forecast-|platform-|selection-)/.test(l.id));
  if(anchor&&layers.findIndex(l=>l.id===sourceId)!==layers.indexOf(anchor)-1)map.moveLayer(sourceId,anchor.id);
 }
 function showMeta(layer){
  const container=$('background-info');container.replaceChildren();container.hidden=!layer;
  $('background-opacity-row').hidden=!layer;$('background-opacity').disabled=!layer;
  if(!layer)return;
  container.append(text('p',layer.provider+' · '+layer.edition,'background-source'),text('p',layer.units,'background-units'));
  const legend=text('div','','background-legend');legend.setAttribute('aria-label',layer.label+' legend');
  for(const item of layer.legend){const row=text('div','','background-legend-item'),swatch=text('i','');swatch.style.backgroundColor=item.color;row.append(swatch,text('span',item.label));legend.append(row);}container.append(legend);
  const details=text('details','','background-notes');details.append(text('summary','Source & display detail'));
  details.append(text('p','Static baseline imagery, separate from the selected forecast date. Display detail is retained through zoom 10; closer views enlarge the same tiles.','context-note'));
  if(layer.citation?.Title)details.append(text('p',String(layer.citation.Title)));
  const doi=layer.citation?.DOI;
  if(typeof doi==='string'&&new RegExp('^https://doi[.]org/[A-Za-z0-9./_-]+$').test(doi)){const a=text('a','Source reference ↗');a.href=doi;a.target='_blank';a.rel='noopener noreferrer';details.append(a);}
  container.append(details);
 }
 function fail(){
  if(!B.selected)return;clearTimeout(timeout);B.status='unavailable';
  if(map.getLayer(sourceId))map.setLayoutProperty(sourceId,'visibility','none');
  $('background-status').textContent='Background tiles are temporarily unavailable.';$('background-retry').hidden=false;
  B.errors.push({layer:B.selected,kind:'tiles-unavailable'});B.errors=B.errors.slice(-10);
 }
 function selectedLayer(){return B.manifest?.layers.find(l=>l.id===B.selected);}
 function loaded(){
  if(B.status!=='loading'||!map.getSource(sourceId)||!map.isSourceLoaded(sourceId))return;
  clearTimeout(timeout);B.status='ready';$('background-status').textContent='Static baseline · '+selectedLayer().edition;$('background-retry').hidden=true;
 }
 function scheduleLoaded(){if(B.status==='loading'&&!readyCheck)readyCheck=setTimeout(()=>{readyCheck=null;loaded();},150);}
 function select(id){
  if(id&&!B.manifest?.layers.some(l=>l.id===id))return;
  clearTimeout(timeout);clearTimeout(readyCheck);readyCheck=null;
  if(map.getLayer(sourceId))map.removeLayer(sourceId);if(map.getSource(sourceId))map.removeSource(sourceId);
  sourceId='landscape-background-'+(++generation);B.sourceId=sourceId;B.selected=id;$('background-select').value=id;$('background-retry').hidden=true;
  const layer=selectedLayer();showMeta(layer);
  if(!layer){B.status='idle';$('background-status').textContent='Choose one background to explore.';return;}
  B.status='loading';$('background-status').textContent='Loading '+layer.label.toLowerCase()+'…';
  try{
   map.addSource(sourceId,{type:'raster',url:'pmtiles://'+layer.asset.url,tileSize:layer.asset.tile_size,minzoom:0,maxzoom:10,bounds:[-125,24,-66,50],attribution:escape(layer.provider+' · '+layer.edition)});
   map.addLayer({id:sourceId,type:'raster',source:sourceId,paint:{'raster-opacity':Number($('background-opacity').value)/100,'raster-fade-duration':0,'raster-resampling':'nearest'}});
   order();timeout=setTimeout(()=>{if(B.status==='loading')fail();},20000);
  }catch{fail();}
 }
 B.select=select;
 async function refresh(){
  if(indexTask)return indexTask;
  indexTask=(async()=>{
   try{const old=selectedLayer()?.asset.url;B.manifest=await index();
    const control=$('background-select');control.replaceChildren(new Option('None',''));for(const layer of B.manifest.layers)control.append(new Option(layer.label+' · '+layer.edition,layer.id));control.disabled=false;control.value=B.selected;
    if(B.selected&&old!==selectedLayer()?.asset.url)select(B.selected);
    else if(!B.selected)$('background-status').textContent='Choose one background to explore.';
    $('background-index-retry').hidden=true;B.ready=true;return true;
   }catch{$('background-status').textContent='Landscape catalog is temporarily unavailable.';$('background-index-retry').hidden=false;return false;}
  })();try{return await indexTask;}finally{indexTask=null;}
 }
 B.refresh=refresh;
 for(let i=0;i<600;i++){S=window.fireEyePreview;if(S?.ready)break;await new Promise(r=>setTimeout(r,100));}
 if(!S?.ready)throw Error('Map not ready');map=S.map;
 $('background-select').onchange=e=>select(e.target.value);
 $('background-opacity').oninput=()=>{$('background-opacity-value').textContent=$('background-opacity').value+'%';if(map.getLayer(sourceId))map.setPaintProperty(sourceId,'raster-opacity',Number($('background-opacity').value)/100);};
 $('background-retry').onclick=()=>select(B.selected);$('background-index-retry').onclick=refresh;
 map.on('sourcedata',e=>{if(e.sourceId===sourceId)scheduleLoaded();});
 map.on('render',scheduleLoaded);
 map.on('sourcedataloading',e=>{if(e.sourceId===sourceId){clearTimeout(readyCheck);readyCheck=null;}});
 map.on('error',e=>{if(e.sourceId===sourceId&&B.status!=='unavailable')fail();});
 map.on('style.load',()=>{if(B.selected&&!map.getLayer(sourceId))select(B.selected);else order();});
 window.addEventListener('fire-eye:selection-changed',order);
 window.addEventListener('fire-eye:basemap-changed',order);
 await refresh();setInterval(()=>{if(!document.hidden)refresh();},3600000);
})().catch(()=>{const e=document.getElementById('background-status');if(e)e.textContent='Landscape controls are temporarily unavailable.';});
