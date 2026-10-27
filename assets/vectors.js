'use strict';
(async function(){
 const $=id=>document.getElementById(id),mobile=matchMedia('(max-width:640px)').matches;
 const V={ready:false,manifest:null,selected:'',status:'idle',generation:0,result:null,errors:[]};window.fireEyeVectors=V;
 const kinds={'wui':{crs:'EPSG:5070',minzoom:10},'burn-severity':{crs:'EPSG:4326',minzoom:10},'buildings':{crs:'EPSG:4326',minzoom:14}};
 const element=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
 const viewCache=new Map();let cachedCoordinates=0;
 let S,map,worker,debounce,config;const sourceId='vector-context';
 function validate(m){
  if(m.schema_version!==1||m.kind!=='indexed-vector-context'||m.layers?.length!==3||new Set(m.layers.map(l=>l.id)).size!==3)throw Error('Invalid vector catalog');
  for(const l of m.layers){const kind=kinds[l.id],a=l.asset,u=new URL(a.url);if(!Object.prototype.hasOwnProperty.call(kinds,l.id)||!kind||l.crs!==kind.crs||l.minzoom!==kind.minzoom||!a.spatial_index||!Number.isSafeInteger(a.bytes)||a.bytes<=0||a.bytes>40e9||!Number.isSafeInteger(a.features)||a.features<1||u.protocol!=='https:'||u.hostname!=='huggingface.co'||u.username||u.password||u.search||u.hash||!new RegExp('^/datasets/[^/]+/[^/]+/resolve/[a-f0-9]{40}/vectors/assets/'+a.sha256+'/'+l.id+'[.]fgb$').test(u.pathname)||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('Invalid vector asset');
   for(const field of ['label','edition','provider','description'])if(typeof l[field]!=='string'||l[field].length>1000)throw Error('Invalid vector description');
   if(!Array.isArray(l.legend)||l.legend.length>16||l.legend.some(x=>typeof x.label!=='string'||!CSS.supports('color',x.color)))throw Error('Invalid vector legend');
   if(l.id==='burn-severity'&&(!Array.isArray(l.years)||!l.years.length||!l.years.every(y=>Number.isInteger(y)&&y>=1900&&y<=2100)))throw Error('Invalid source years');
  }return m;
 }
 function selected(){return V.manifest?.layers.find(l=>l.id===V.selected);}
 function clear(){worker?.terminate();worker=null;V.generation++;V.result=null;if(map.getLayer(sourceId))map.removeLayer(sourceId);if(map.getSource(sourceId))map.removeSource(sourceId);$('vector-feature-info').replaceChildren();$('vector-feature-info').hidden=true;}
 function state(value,message){V.status=value;$('vector-status').textContent=message;$('vector-retry').hidden=value!=='unavailable';$('vector-zoom').hidden=value!=='zoom';}
 function order(){if(!map.getLayer(sourceId))return;const layers=map.getStyle().layers,anchor=layers.find(l=>/^(platform-(perimeters|incidents|detections)|selection-)/.test(l.id)||l.type==='symbol');if(anchor&&layers.findIndex(l=>l.id===sourceId)!==layers.indexOf(anchor)-1)map.moveLayer(sourceId,anchor.id);}
 function meta(){const layer=selected(),box=$('vector-info');box.replaceChildren();box.hidden=!layer;$('vector-opacity-row').hidden=!layer;$('vector-year-row').hidden=layer?.id!=='burn-severity';if(!layer)return;
  box.append(element('p',layer.provider+' · '+layer.edition,'background-source'),element('p','Feature detail does not change the 5 km forecast grid.','context-note'));const legend=element('div','','background-legend');for(const item of layer.legend){const row=element('div','','background-legend-item'),swatch=element('i','');swatch.style.backgroundColor=item.color;row.append(swatch,element('span',item.label));legend.append(row);}box.append(legend);
  const notes=element('details','','background-notes');notes.append(element('summary','Source & interpretation'),element('p',layer.description));notes.append(element('p','Static background, separate from the selected forecast date. The forecast grid remains unchanged.'));
  if(layer.years)notes.append(element('p','Available source years: '+layer.years.join(', ')+'. Other years are not included in this archive.'));
  for(const [label,url] of [['Source reference ↗',layer.reference],['Data license ↗',layer.license_url],['Full source ('+(layer.asset.bytes/1e9).toFixed(2)+' GB) ↗',layer.asset.url]]){if(!url)continue;const u=new URL(url);if(u.protocol!=='https:')continue;const a=element('a',label);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';notes.append(a);}box.append(notes);
 }
 function filterYear(){
  if(!map.getLayer(sourceId)||!V.result)return;const value=V.selected==='burn-severity'&&$('vector-year').value?Number($('vector-year').value):null;
  map.setFilter(sourceId,value===null?null:['==',['get','year'],value]);V.filteredFeatures=value===null?V.result.features:V.result.features.filter(f=>f.properties.year===value);
  state('ready',V.filteredFeatures.length?'Mapped features · static archive':value===null?'No mapped features in this view.':'No mapped polygons for '+value+' in this view.');
 }
 function show(data){
  const l=selected(),a=Number($('vector-opacity').value)/100;map.addSource(sourceId,{type:'geojson',data,attribution:l.id==='buildings'?'Microsoft · <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL</a>':l.id==='wui'?'RAI Lab · WUI baseline':'USGS / USDA Forest Service · MTBS'});
  let color='#33a69e';if(l.id!=='buildings')color=['match',['get',l.id==='wui'?'wuiClass':'burn_severity'],...l.legend.flatMap(x=>[x.value,x.color]),'#999999'];
  map.addLayer({id:sourceId,type:'fill',source:sourceId,paint:{'fill-color':color,'fill-opacity':a,'fill-outline-color':l.id==='buildings'?'#16675f':'rgba(0,0,0,0)'}});order();
 }
 function request(){
  clearTimeout(debounce);clear();const layer=selected();if(!layer){state('idle','Choose one feature overlay.');return;}
  if(map.getZoom()<layer.minzoom){state('zoom','Zoom in to see '+layer.label.toLowerCase()+'.');return;}
  const b=map.getBounds(),bounds=[Math.max(-125,b.getWest()),Math.max(24,b.getSouth()),Math.min(-66,b.getEast()),Math.min(50,b.getNorth())];
  if(bounds[0]>=bounds[2]||bounds[1]>=bounds[3]){state('outside','This view is outside the CONUS display area.');return;}
  const generation=V.generation,start=performance.now(),key=layer.asset.sha256+':'+JSON.stringify(bounds),cached=viewCache.get(key);V.lastCacheHit=false;
  if(cached&&Date.now()-cached.saved<600000){V.result={...cached.result,id:generation};V.lastCacheHit=true;show({type:'FeatureCollection',features:V.result.features});filterYear();V.lastLoadMs=performance.now()-start;return;}
  state('loading','Loading features in this view…');
  worker=new Worker('assets/vector-worker.js?v=e83c82cf44190545');worker.onmessage=e=>{const result=e.data;if(result.id!==V.generation)return;worker?.terminate();worker=null;V.result=result;V.lastLoadMs=performance.now()-start;
   if(result.status==='ready'){try{
    if(Number.isFinite(result.coordinateCount)){
     if(viewCache.has(key)){cachedCoordinates-=viewCache.get(key).result.coordinateCount;viewCache.delete(key);}
     while(viewCache.size&&(viewCache.size>=3||cachedCoordinates+result.coordinateCount>(mobile?200000:500000))){const first=viewCache.keys().next().value;cachedCoordinates-=viewCache.get(first).result.coordinateCount;viewCache.delete(first);}
     viewCache.set(key,{result,saved:Date.now()});cachedCoordinates+=result.coordinateCount;
    }
    show({type:'FeatureCollection',features:result.features});filterYear();}catch{state('unavailable','Feature overlay is temporarily unavailable.');}}
   else if(result.status==='zoom')state('zoom','Zoom in for a smaller, more detailed view.');else state('unavailable','Feature overlay is temporarily unavailable.');
  };worker.onerror=()=>{if(generation===V.generation){worker?.terminate();worker=null;state('unavailable','Feature overlay is temporarily unavailable.');}};
  const seed=layer.asset.index_seeds?.find(s=>s.tier==='compact');
  worker.postMessage({id:generation,layer,seed:seed?{...seed,local_url:config?.vector_seeds?.[seed.sha256]?new URL(config.vector_seeds[seed.sha256],location.href).href:null}:null,bounds,year:layer.id==='burn-severity'&&$('vector-year').value?Number($('vector-year').value):null,featureLimit:mobile?6000:15000,coordinateLimit:mobile?200000:500000,byteLimit:(mobile?6:12)*1024*1024});
 }
 function select(id){if(id&&!kinds[id])return;V.selected=id;$('vector-select').value=id;meta();if(id==='burn-severity'){$('vector-year').replaceChildren(new Option('All available years',''));for(const y of selected().years)$('vector-year').append(new Option(String(y),String(y)));}request();}
 async function refresh(){
  try{config ||= await fetch('config.json',{signal:AbortSignal.timeout(6000)}).then(r=>r.json());let m;try{const u=new URL(config.vectors_url);if(u.protocol!=='https:'||u.hostname!=='huggingface.co'||!new RegExp('^/datasets/[^/]+/[^/]+/resolve/main/vectors[.]json$').test(u.pathname))throw Error();const r=await fetch(u.href,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();m=validate(await r.json());V.saved=false;}catch{V.saved=true;if(V.manifest)m=V.manifest;else{const r=await fetch('vectors-bootstrap.json',{signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error();m=validate(await r.json());}}
   const old=selected()?.asset.sha256;V.manifest=m;$('vector-select').replaceChildren(new Option('None',''));for(const l of m.layers)$('vector-select').append(new Option(l.label,l.id));$('vector-select').value=V.selected;$('vector-select').disabled=false;V.ready=true;$('vector-index-retry').hidden=true;if(old&&old!==selected()?.asset.sha256){viewCache.clear();cachedCoordinates=0;select(V.selected);}else if(!V.selected)state('idle','Choose one feature overlay.');return true;
  }catch{state('catalog-unavailable','Feature catalog is temporarily unavailable.');$('vector-index-retry').hidden=false;return false;}
 }
 V.select=select;V.refresh=refresh;V.request=request;
 for(let i=0;i<600;i++){S=window.fireEyePreview;if(S?.ready)break;await new Promise(r=>setTimeout(r,100));}if(!S?.ready)throw Error();map=S.map;map.setMaxZoom(16);
 $('vector-select').onchange=e=>select(e.target.value);$('vector-year').onchange=filterYear;$('vector-retry').onclick=request;$('vector-index-retry').onclick=refresh;
 $('vector-zoom').onclick=()=>map.easeTo({zoom:Math.min(16,Math.max(selected()?.minzoom||10,map.getZoom()+1)),duration:400});
 $('vector-opacity').oninput=()=>{$('vector-opacity-value').textContent=$('vector-opacity').value+'%';if(map.getLayer(sourceId))map.setPaintProperty(sourceId,'fill-opacity',Number($('vector-opacity').value)/100);};
 map.on('moveend',()=>{if(V.selected){clearTimeout(debounce);debounce=setTimeout(request,250);}});
 map.on('click',e=>{if(!map.getLayer(sourceId)||V.status!=='ready')return;const fireIds=['platform-incidents','platform-detections'].filter(id=>map.getLayer(id));if(fireIds.length&&map.queryRenderedFeatures(e.point,{layers:fireIds}).length)return;
  const f=map.queryRenderedFeatures(e.point,{layers:[sourceId]})[0];if(!f)return;const layer=selected(),p=f.properties||{},box=$('vector-feature-info');box.replaceChildren(element('h3',layer.label));
  if(layer.id==='wui')box.append(element('p',layer.legend.find(x=>x.value===p.wuiClass)?.label||'Unclassified'));
  if(layer.id==='burn-severity'){box.append(element('p',(layer.legend.find(x=>x.value===p.burn_severity)?.label||'Unclassified')+' · '+p.year));if(Number.isFinite(p.acres))box.append(element('p','Recorded area: '+p.acres.toLocaleString('en-US',{maximumFractionDigits:2})+' acres'));box.append(element('p','May include prescribed burning; not an active-fire report.'));}
  if(layer.id==='buildings'){if(p.release!==undefined)box.append(element('p','Source release ID: '+p.release));if(p.capture_dates_range)box.append(element('p','Source capture dates: '+p.capture_dates_range));box.append(element('p','Imagery-derived outline; occupancy is not provided.'));}box.hidden=false;
 });
 window.addEventListener('fire-eye:selection-changed',()=>{$('vector-feature-info').hidden=true;order();});window.addEventListener('fire-eye:basemap-changed',order);
 await refresh();setInterval(()=>{if(!document.hidden)refresh();},3600000);
})().catch(()=>{const e=document.getElementById('vector-status');if(e)e.textContent='Feature controls are temporarily unavailable.';});
