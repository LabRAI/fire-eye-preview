'use strict';
(async function(){
 const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const H={ready:false,enabled:false,status:'idle',season:null,storm:'',data:null,manifest:null,generation:0};window.fireEyeHurricanes=H;
 const colors=['#22c55e','#facc15','#fb923c','#ef4444','#a855f7','#701a75'];
 let S,map,config,controller,popup;const cache=new Map(),ids=['hurricane-track-line','hurricane-track-point','hurricane-track-hit'];
 function state(status,message){H.status=status;$('hurricane-status').textContent=message;$('hurricane-retry').hidden=status!=='unavailable';}
 function validate(m){
  if(m.schema_version!==1||m.kind!=='atlantic-advisory-archive'||m.live!==false||!Array.isArray(m.seasons)||!m.seasons.length||m.seasons.length>150||new Set(m.seasons).size!==m.seasons.length)throw Error('Invalid storm catalog');
  for(const year of m.seasons){const a=m.assets?.[year];if(!Number.isInteger(year)||year<1900||year>new Date().getUTCFullYear()||!a||a.path!==year+'.geojson'||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>2e6||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('Invalid storm asset');const u=new URL(a.url);if(u.origin!=='https://huggingface.co'||u.username||u.password||u.search||u.hash||!new RegExp('^/datasets/[^/]+/[^/]+/resolve/[a-f0-9]{40}/hurricanes/assets/'+a.sha256+'/'+year+'[.]geojson$').test(u.pathname))throw Error('Invalid storm origin');}return m;
 }
 function clear(){for(const id of ids)if(map.getLayer(id))map.removeLayer(id);if(map.getSource('hurricane-tracks'))map.removeSource('hurricane-tracks');popup?.remove();popup=null;}
 function order(){const layers=map.getStyle().layers,anchor=layers.find(l=>/^(platform-(perimeters|incidents|detections)|selection-)/.test(l.id)||l.type==='symbol');if(!anchor)return;for(const id of ids)if(map.getLayer(id))map.moveLayer(id,anchor.id);}
 function applyFilter(){
  H.storm=$('hurricane-storm').value;popup?.remove();
  for(const id of ids){if(!map.getLayer(id))continue;const part=id==='hurricane-track-point'?'positions':'track';map.setFilter(id,['all',['==',['get','part'],part],...(H.storm?[['==',['get','storm_key'],H.storm]]:[])]);}
 }
 function render(){
  clear();if(!H.enabled||!H.data)return;
  map.addSource('hurricane-tracks',{type:'geojson',data:H.data,attribution:'NOAA / National Hurricane Center · archived advisory positions'});
  const color=['match',['get','max_category'],...colors.flatMap((c,i)=>[i,c]),'#66776a'];
  map.addLayer({id:ids[0],type:'line',source:'hurricane-tracks',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':color,'line-width':['interpolate',['linear'],['zoom'],2,1.7,8,3],'line-opacity':.9}});
  map.addLayer({id:ids[1],type:'circle',source:'hurricane-tracks',minzoom:5,paint:{'circle-color':color,'circle-radius':2.6,'circle-stroke-color':'#fff','circle-stroke-width':.7}});
  map.addLayer({id:ids[2],type:'line',source:'hurricane-tracks',paint:{'line-color':'rgba(0,0,0,0)','line-width':18}});
  applyFilter();order();
 }
 function verifyData(data,year){
  if(data.type!=='FeatureCollection'||!Array.isArray(data.features)||data.features.length>1000)throw Error('Invalid storm features');let count=0;
  const check=value=>{if(!Array.isArray(value))throw Error('Invalid storm geometry');if(typeof value[0]==='number'){if(++count>100000||value.length!==2||!value.every(Number.isFinite)||Math.abs(value[0])>180||Math.abs(value[1])>90)throw Error('Invalid storm coordinate');}else value.forEach(check);};
  for(const f of data.features){const p=f.properties;if(f.type!=='Feature'||p?.season!==year||!['positions','track'].includes(p.part)||typeof p.name!=='string'||p.name.length>160||!Number.isInteger(p.max_category)||p.max_category<0||p.max_category>5||!Number.isFinite(Date.parse(p.first_valid_utc))||!Number.isFinite(Date.parse(p.last_valid_utc))||f.geometry.type!==(p.part==='positions'?'MultiPoint':'MultiLineString'))throw Error('Invalid storm record');check(f.geometry.coordinates);}return data;
 }
 async function readSeason(year,signal){
  const a=H.manifest.assets[year];if(cache.has(a.sha256))return cache.get(a.sha256);const urls=[],local=config.hurricane_assets?.[a.sha256];
  if(local){const u=new URL(local,location.href);if(u.origin===location.origin&&u.pathname.endsWith('/assets/hurricanes/'+a.sha256+'.geojson')&&!u.search&&!u.hash)urls.push(u.href);}urls.push(a.url);
  for(const url of urls){try{const r=await fetch(url,{credentials:'omit',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});if(!r.ok||Number(r.headers.get('Content-Length')||0)>a.bytes){await r.body?.cancel();continue;}const reader=r.body.getReader(),chunks=[];let n=0;while(true){const x=await reader.read();if(x.done)break;n+=x.value.length;if(n>a.bytes){await reader.cancel();throw Error('Oversized storm asset');}chunks.push(x.value);}if(n!==a.bytes)continue;const bytes=new Uint8Array(n);let off=0;for(const chunk of chunks){bytes.set(chunk,off);off+=chunk.length;}const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==a.sha256)continue;const data=verifyData(JSON.parse(new TextDecoder().decode(bytes)),year);cache.set(a.sha256,data);if(cache.size>4)cache.delete(cache.keys().next().value);return data;}catch{if(signal.aborted)throw Error('Cancelled');}}
  throw Error('Storm season unavailable');
 }
 async function selectSeason(year){
  if(!H.manifest?.assets[year])return;controller?.abort();controller=new AbortController();const sequence=++H.generation;H.season=year;H.data=null;H.storm='';clear();$('hurricane-season').value=year;$('hurricane-storm').disabled=true;$('hurricane-fit').disabled=true;
  if(!H.enabled){state('idle','Historical archive · latest stored season '+Math.max(...H.manifest.seasons)+'.');return;}
  state('loading','Loading archived '+year+' tracks…');
  try{const data=await readSeason(year,controller.signal);if(sequence!==H.generation)return;H.data=data;const storms=data.features.filter(f=>f.properties.part==='positions');$('hurricane-storm').replaceChildren(new Option('All archived storms',''));for(const f of storms)$('hurricane-storm').append(new Option(f.properties.name,f.properties.storm_key));$('hurricane-storm').disabled=false;$('hurricane-fit').disabled=false;render();const last=storms.map(f=>f.properties.last_valid_utc).sort().at(-1);state('ready',year+' archive · '+storms.length+' storms · through '+last.slice(0,10)+'. Not live.');}
  catch{if(sequence===H.generation)state('unavailable','Archived tracks are temporarily unavailable.');}
 }
 function fit(){if(!H.data)return;const coords=H.data.features.filter(f=>f.properties.part==='positions'&&(!H.storm||f.properties.storm_key===H.storm)).flatMap(f=>f.geometry.coordinates);if(!coords.length)return;const bounds=new maplibregl.LngLatBounds();coords.forEach(c=>bounds.extend(c));map.fitBounds(bounds,{padding:innerWidth<=640?{top:45,bottom:200,left:35,right:35}:{top:45,bottom:190,left:335,right:45},maxZoom:7,duration:350});}
 function click(event){
  if(!H.enabled||!map.getLayer(ids[2]))return false;const fireIds=['platform-incidents','platform-detections'].filter(id=>map.getLayer(id));if(fireIds.length&&map.queryRenderedFeatures(event.point,{layers:fireIds}).length)return false;const f=map.queryRenderedFeatures(event.point,{layers:ids})[0];if(!f)return false;const p=f.properties,box=el('div','','hurricane-popup');
  box.append(el('h3',p.name+' · '+p.season),el('p',p.first_valid_utc.slice(0,10)+' – '+p.last_valid_utc.slice(0,10)+' UTC'));
  box.append(el('p',p.max_category?'Highest recorded category: '+p.max_category:'No hurricane category in stored positions'));
  if(Number.isFinite(p.max_wind_kt))box.append(el('p','Peak recorded sustained wind: '+p.max_wind_kt+' kt'));
  box.append(el('p',p.positions+' archived positions'),el('p','Historical advisory archive, separate from the fire forecast.','context-note'));
  const link=el('a','NOAA / NHC source ↗');link.href='https://www.nhc.noaa.gov/gis/';link.target='_blank';link.rel='noopener noreferrer';box.append(link);popup?.remove();popup=new maplibregl.Popup({closeOnClick:true,maxWidth:'280px',className:'hurricane-popup-container'}).setLngLat(event.lngLat).setDOMContent(box).addTo(map);$('hurricane-popups').append(popup.getElement());return true;
 }
 H.selectSeason=selectSeason;H.fit=fit;H.selectStorm=key=>{$('hurricane-storm').value=key;applyFilter();};H.enable=async enabled=>{H.enabled=enabled;$('hurricane-enable').checked=enabled;$('hurricane-controls').hidden=!enabled;if(enabled)await selectSeason(H.season||Math.max(...H.manifest.seasons));else{++H.generation;controller?.abort();clear();state('idle','Historical archive · latest stored season '+Math.max(...H.manifest.seasons)+'.');}};
 for(let i=0;i<600;i++){S=window.fireEyePreview;if(S?.ready&&window.fireEyePlatform?.ready)break;await new Promise(r=>setTimeout(r,100));}if(!S?.ready)throw Error();map=S.map;
 config=await fetch('config.json',{signal:AbortSignal.timeout(6000)}).then(r=>r.json());let m;
 try{const u=new URL(config.hurricanes_url);if(u.origin!=='https://huggingface.co'||u.search||u.hash||!/^\/datasets\/[^/]+\/[^/]+\/resolve\/main\/hurricanes[.]json$/.test(u.pathname))throw Error();const r=await fetch(u.href,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();m=validate(await r.json());}
 catch{const r=await fetch('hurricanes-bootstrap.json',{signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error();m=validate(await r.json());}
 H.manifest=m;H.season=Math.max(...m.seasons);for(const year of [...m.seasons].reverse())$('hurricane-season').append(new Option(String(year),String(year)));$('hurricane-enable').disabled=false;H.ready=true;
 $('hurricane-enable').onchange=e=>H.enable(e.target.checked);$('hurricane-season').onchange=e=>selectSeason(Number(e.target.value));$('hurricane-storm').onchange=applyFilter;$('hurricane-fit').onclick=fit;$('hurricane-retry').onclick=()=>selectSeason(H.season);
 const legend=$('hurricane-legend');colors.forEach((color,i)=>{const row=el('div','','background-legend-item'),swatch=el('i','');swatch.style.backgroundColor=color;row.append(swatch,el('span',i?'Category '+i:'Below category 1'));legend.append(row);});
 const original=S.onMapClick;S.onMapClick=event=>{if(!click(event))return original?.(event);};
 map.on('mouseenter',ids[2],()=>{map.getCanvas().style.cursor='pointer';});map.on('mouseleave',ids[2],()=>{map.getCanvas().style.cursor='';});
 window.addEventListener('fire-eye:basemap-changed',order);window.addEventListener('fire-eye:selection-changed',order);state('idle','Historical archive · latest stored season '+H.season+'.');
})().catch(()=>{const n=document.getElementById('hurricane-status');if(n)n.textContent='Storm archive is temporarily unavailable.';});
