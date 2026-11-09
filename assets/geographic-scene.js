/* Geographic scene foundation: mapped geometry, one MapLibre map and camera. */
(function(global){
 'use strict';
 const PREFIX='mapped-scene-',SOURCE='openmaptiles';
 // Render-only symbols: original point geometry and unknown dimensions stay
 // untouched in the source collection and in the simulation handoff.
 function treeSymbols(collection){
  const features=[];
  for(const f of collection.features){
   if(f.properties?.kind!=='tree'||f.geometry?.type!=='Point')continue;
   const [lon,lat]=f.geometry.coordinates;if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lat)>85)continue;
   const tagged=f.properties.height_m,h=typeof tagged==='number'&&tagged>0&&tagged<=120?tagged:8;
   const parts=[['trunk',.18,0,h*.45],['lower',1.7,h*.36,h*.53],['crown',2.4,h*.53,h*.82],['upper',1.6,h*.82,h]];
   for(const [part,radius,base,height] of parts){
    const ring=[];for(let i=0;i<8;i++){const angle=i*Math.PI/4;ring.push([lon+radius*Math.cos(angle)/(111320*Math.cos(lat*Math.PI/180)),lat+radius*Math.sin(angle)/111320]);}ring.push([...ring[0]]);
    features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{kind:'tree',source_id:f.properties.source_id,render_part:part,render_base_m:base,render_height_m:height,display_only:true}});
   }
  }
  return {type:'FeatureCollection',features};
 }
 function mount(map,options={}){
  const create=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
  const panel=create('section',null,'mapped-scene-panel');panel.hidden=true;panel.setAttribute('aria-label','Digital local scene');
  const compactScreen=matchMedia('(max-width:900px), (max-height:500px) and (pointer:coarse)');
  let panelCollapsed=compactScreen.matches,panelDismissed=false,panelSuppressed=false;
  try{panelDismissed=sessionStorage.getItem('fire-eye-scene-dismissed')==='1';}catch{}
  panel.id='mapped-scene-panel';
  const top=create('div',null,'mapped-scene-heading'),title=create('strong','Digital local scene'),back=create('button','Regional view');back.type='button';
  const panelToggle=create('button',null,'mapped-scene-toggle'),chevron=create('span','⌄'),panelClose=create('button','×','mapped-scene-close');
  panelToggle.type=panelClose.type='button';panelToggle.append(title,chevron);panelToggle.setAttribute('aria-controls','mapped-scene-content');
  panelClose.setAttribute('aria-label','Close simulation controls');panelClose.title='Hide controls; simulation stays on the map';
  top.append(panelToggle,panelClose);panel.append(top);
  const status=create('p','Zoom in to explore mapped buildings and streets.','mapped-scene-status');status.setAttribute('role','status');panel.append(status);
  const actions=create('div',null,'mapped-scene-actions'),tilt=create('button','3D'),pause=create('button','Pause'),fire=create('button','Fire'),findFire=create('button','Find fire'),retry=create('button','Retry detail');
  for(const b of [tilt,pause,fire,findFire,retry,back]){b.type='button';actions.append(b);}panel.append(actions);pause.hidden=fire.hidden=findFire.hidden=retry.hidden=true;findFire.title="Center the illustrative fire in the visible map";fire.setAttribute("aria-label","Scenario fire");fire.title="Toggle illustrative scenario fire";
  const simulationNote=create('p','','mapped-simulation-status');simulationNote.hidden=true;simulationNote.setAttribute('role','status');panel.append(simulationNote);
  tilt.setAttribute('aria-pressed','false');
  const note=create('p','Mapped footprints and streets. Building heights are display estimates; tree shapes are schematic.','mapped-scene-note');panel.append(note);
  const forecastLine=create('p','','mapped-scene-forecast');forecastLine.hidden=true;panel.append(forecastLine);
  const detail=create('div',null,'mapped-scene-detail');detail.hidden=true;panel.append(detail);
  const ground=create('section',null,'mapped-ground-detail'),groundButton=create('button','Load ground detail'),groundClear=create('button','Clear'),groundStatus=create('p','Select a spot for optional ground detail.');
  ground.hidden=true;ground.setAttribute('aria-label','Optional ground detail');groundButton.type=groundClear.type='button';groundButton.disabled=true;groundClear.hidden=true;groundStatus.setAttribute('role','status');ground.append(groundButton,groundClear,groundStatus);panel.append(ground);
  const content=create('div',null,'mapped-scene-content');content.id='mapped-scene-content';
  for(const child of [...panel.children])if(child!==top)content.append(child);panel.append(content);
  (options.container||document.body).append(panel);
  const reopen=create('button','Simulation controls','wide-button');reopen.id='scene-controls-open';reopen.type='button';reopen.hidden=true;reopen.setAttribute('aria-controls',panel.id);
  document.getElementById('fit-conus')?.after(reopen);
  let ready=false,disposed=false,installing=false,previous=null,popup=null,requested=false,terrainTilt=false,metricsTimer=null;
  let catalogTask=null,areaId=null,area=null,areaData=null,areaController=null,areaSequence=0;
  let selectedObject=null;
  let groundPoint=null,groundSequence=0,groundTask=null,groundView=null,groundScript=null,groundTimer=null;
  function resetGround(){groundSequence++;ground.hidden=true;groundPoint=null;groundView?.clear();groundButton.disabled=true;groundButton.textContent='Load ground detail';groundClear.hidden=true;groundStatus.textContent='Select a spot for optional ground detail.';}
  function chooseGround(point){resetGround();ground.hidden=false;groundPoint=point.slice();groundButton.disabled=false;groundStatus.textContent=point[1].toFixed(5)+'°, '+point[0].toFixed(5)+'° · on request only';}
  function groundModule(){
   if(global.FireEyeSurfaceDetail)return Promise.resolve(global.FireEyeSurfaceDetail);
   if(groundTask)return groundTask;
   groundTask=new Promise((resolve,reject)=>{
    const script=document.createElement('script');groundScript=script;script.src='assets/surface-detail.js?v=20261102-ground-1';
    const finish=error=>{clearTimeout(groundTimer);script.onload=script.onerror=null;script.remove();groundScript=null;if(error){groundTask=null;reject(error);}else resolve(global.FireEyeSurfaceDetail);};
    script.onload=()=>finish(global.FireEyeSurfaceDetail?null:Error('Ground detail unavailable'));script.onerror=()=>finish(Error('Ground detail unavailable'));groundTimer=setTimeout(()=>finish(Error('Ground detail timeout')),8000);document.head.append(script);
   });return groundTask;
  }
  groundButton.onclick=async()=>{
   if(!groundPoint||disposed)return;const point=groundPoint.slice(),seq=++groundSequence;groundButton.disabled=true;groundStatus.textContent='Loading ground detail…';
   try{const module=await groundModule();if(disposed||seq!==groundSequence||map.getZoom()<15)return;
    groundView ||= module.mount(map);const result=groundView.show(point,areaData);groundClear.hidden=false;groundButton.textContent='Refresh ground detail';
    groundStatus.textContent=result.features?result.kinds.join(' · ')+'. Mapped features near the selected spot; outlines may be tile-clipped.':'No grass or playground detail is mapped here in the current data.';
   }catch{if(!disposed&&seq===groundSequence){groundView?.clear();groundButton.textContent='Retry ground detail';groundStatus.textContent='Ground detail is temporarily unavailable. The map remains ready.';}}
   finally{if(!disposed&&seq===groundSequence)groundButton.disabled=false;}
  };
  groundClear.onclick=()=>{const point=groundPoint?.slice();resetGround();if(point)chooseGround(point);};
  function panelLayout(){
   const eligible=map.getZoom()>=13||requested;
   const shown=selector=>{const node=document.querySelector(selector);return node&&!node.hidden&&node.getBoundingClientRect().height>0;};
   const suppressed=compactScreen.matches&&(!document.body.classList.contains('sidebar-hidden')||shown('#inspection')||shown('.assistant-global-panel')||shown('.risk-download')||!!document.querySelector('dialog[open]'));
   if(suppressed&&!panelSuppressed)panelCollapsed=true;panelSuppressed=suppressed;
   const hide=!eligible||panelDismissed||suppressed;if(panel.hidden!==hide)panel.hidden=hide;
   content.hidden=panelCollapsed;panel.classList.toggle('is-collapsed',panelCollapsed);chevron.textContent=panelCollapsed?'⌄':'⌃';
   panelToggle.setAttribute('aria-expanded',String(!panelCollapsed));panelToggle.setAttribute('aria-label',panelCollapsed?'Expand simulation controls':'Minimize simulation controls');
   reopen.hidden=!eligible;reopen.setAttribute('aria-expanded',String(!hide&&!panelCollapsed));
  }
  function openControls(fromSidebar=false){
   if(disposed)return;panelDismissed=false;panelCollapsed=false;try{sessionStorage.removeItem('fire-eye-scene-dismissed');}catch{}
   if(compactScreen.matches){if(fromSidebar)document.getElementById('sidebar-close')?.click();if(!document.getElementById('inspection')?.hidden)document.getElementById('close-inspection')?.click();}
   panelLayout();content.scrollTop=0;
  }
  function closeControls(){
   panelDismissed=true;try{sessionStorage.setItem('fire-eye-scene-dismissed','1');}catch{}resetGround();detail.hidden=true;panelLayout();map.getCanvas().focus({preventScroll:true});
  }
  panelClose.onclick=closeControls;panelToggle.onclick=()=>{panelCollapsed=!panelCollapsed;panelLayout();};reopen.onclick=()=>{openControls(true);panelToggle.focus({preventScroll:true});};
  const layoutChanged=()=>{if(compactScreen.matches)panelCollapsed=true;panelLayout();};compactScreen.addEventListener('change',layoutChanged);
  const panelObserver=new MutationObserver(records=>{if(records.some(r=>r.target===document.body||r.target.id==='inspection'||r.target.classList?.contains('assistant-global-panel')||r.target.classList?.contains('risk-download')||r.target.tagName==='DIALOG'))panelLayout();});
  panelObserver.observe(document.body,{attributes:true,subtree:true,attributeFilter:['hidden','class','open']});
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();closeControls();}});
  const emitObject=value=>{selectedObject=value;openControls();options.onObject?.(value);};
  const objectSource=PREFIX+'objects',objectLayers=[PREFIX+'object-areas',PREFIX+'object-buildings',PREFIX+'object-height',PREFIX+'object-roads',PREFIX+'object-trees',PREFIX+'object-footprints'];
  const treeSource=PREFIX+'tree-symbols',treeLayer=PREFIX+'tree-models';let treeData=null;
  const localSymbolPaint=new Map();
  const areaCache=new Map(),empty={type:'FeatureCollection',features:[]};
  let environmentKey='';
  const environment=options.environmentURL&&global.FireEyeSceneEnvironment?global.FireEyeSceneEnvironment.mount(map,{
   url:options.environmentURL,
   onChange:state=>{const key=[state.area,state.terrain,state.buildings].join('|');if(key===environmentKey)return;environmentKey=key;
    queueMicrotask(()=>{if(disposed)return;local?.invalidate();loadArea();live?.refreshTerrain();});},
   onTerrain:()=>live?.refreshTerrain()
  }):null;
  const local=options.localCoverURL&&global.FireEyeTallahassee?global.FireEyeTallahassee.create(map,options.localCoverURL,{extraFeatures:()=>environment?.features()||[]}):null;let localTimer=null;
  const layers=[PREFIX+'areas',PREFIX+'water',PREFIX+'paths',PREFIX+'roads',PREFIX+'buildings',PREFIX+'outlines'];
  const opacity=['interpolate',['linear'],['zoom'],13,0,15,1];
  const live=options.simulationAssetsURL&&global.FireEyeMappedSimulation?global.FireEyeMappedSimulation.mount(map,{
   manifestURL:options.simulationAssetsURL,forecastLinked:options.forecastLinked,
   height:point=>environment?.height(point)||0,
   exclusions:()=>environment?.features()||[],
   occlusionElements:()=>document.querySelectorAll('.panel, .mapped-scene-panel, .maplibregl-ctrl, .maplibregl-popup'),
   onReplacement:alpha=>{if(map.getLayer(treeLayer))map.setPaintProperty(treeLayer,'fill-extrusion-opacity',['interpolate',['linear'],['zoom'],16,0,17,1-alpha]);},
   onChange:state=>{const active=state.phase==='simulation',linked=state.forecastRequired,f=state.forecast;title.textContent=active?'Local simulation':'Digital local scene';pause.hidden=fire.hidden=findFire.hidden=!active;findFire.disabled=fire.disabled=linked?!state.emitters.length:!state.ignition;pause.textContent=state.paused?'Resume':'Pause';pause.setAttribute('aria-pressed',String(state.paused));fire.setAttribute('aria-pressed',String(state.fireEnabled));retry.hidden=state.phase!=='fallback';simulationNote.hidden=!active&&state.phase!=='loading'&&state.phase!=='fallback';simulationNote.textContent=state.phase==='loading'?'Preparing local simulation…':state.phase==='fallback'?'Mapped view remains available. Retry scene detail.':linked?(f?.status==='ready'?(state.emitters.length?'Risk-driven fire illustration':'No flames sampled for this view')+' · '+(f.resolution===50?'50 m experimental field':'5 km forecast'):!state.candidates.length?'No mapped vegetation samples in this view':f?.status==='missing'||f?.status==='error'?'Fire illustration unavailable for this selection':'Preparing selected risk field…'):state.ignition&&state.fireEnabled?'Illustrative fire scenario · not a reported fire':'Local scene models · zoom out to return';
    forecastLine.hidden=!linked;forecastLine.textContent=linked&&f?.target_time_utc?'+'+f.lead_hours+'h · Window ending '+new Date(f.target_time_utc).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'})+' UTC · illustration, not reported fires':linked?'Vegetation from 2020 land cover · illustrative placements':'';
    forecastLine.title=linked?'Stable random sampling follows the selected risk field. Visual sampling weights are not ignition probabilities, fire intensity or spread predictions. All rendering runs on this device.':'';
    options.onSimulationChange?.(state);
   }
  }):null;
  pause.onclick=()=>live?.pause(!live.state.paused);fire.onclick=()=>live?.fire(!live.state.fireEnabled);findFire.onclick=()=>live?.focusFire();retry.onclick=()=>{local?.invalidate();loadArea();live?.retry();};
  const firstSymbol=()=>map.getStyle()?.layers?.find(l=>l.type==='symbol')?.id;
  function ensure(){
   // Other forecast/overlay sources can still be loading or unavailable.
   // Local geometry must not wait for every source in the entire map.
   if(disposed||installing||!map.getSource(SOURCE))return;
   installing=true;
   try{
    // Keep street/area names; fade duplicate POI icons at simulation scale.
    for(const item of map.getStyle().layers.filter(l=>l.type==='symbol'&&l.source===SOURCE&&['poi','housenumber'].includes(l['source-layer']))){
     if(localSymbolPaint.has(item.id))continue;
     const old={};for(const property of ['text-opacity','icon-opacity']){old[property]=map.getPaintProperty(item.id,property)??1;if(typeof old[property]==='number')map.setPaintProperty(item.id,property,['interpolate',['linear'],['zoom'],16,old[property],17.4,0]);}localSymbolPaint.set(item.id,old);
    }
    const add=(id,type,sourceLayer,paint,filter)=>{if(map.getLayer(id))return;const layer={id,type,source:SOURCE,'source-layer':sourceLayer,minzoom:13,paint};if(filter)layer.filter=filter;map.addLayer(layer,firstSymbol());};
    add(layers[0],'fill','landuse',{'fill-color':'#8caa72','fill-opacity':['interpolate',['linear'],['zoom'],13,0,15,.16]},['match',['get','class'],['park','grass','garden','recreation_ground','village_green'],true,false]);
    add(layers[1],'fill','water',{'fill-color':'#79b3c4','fill-opacity':['interpolate',['linear'],['zoom'],13,0,15,.7]});
    add(layers[2],'line','transportation',{'line-color':'#e8d6b4','line-width':['interpolate',['exponential',1.5],['zoom'],13,.7,16,2,20,12],'line-opacity':opacity},['all',['!=',['get','brunnel'],'tunnel'],['match',['get','class'],['path','track','pedestrian'],true,false]]);
    add(layers[3],'line','transportation',{'line-color':'#fbf8ef','line-width':['interpolate',['exponential',1.5],['zoom'],13,1,16,3,20,20],'line-opacity':opacity},['all',['!=',['get','brunnel'],'tunnel'],['match',['get','class'],['motorway','trunk','primary','secondary','tertiary','minor','service','street'],true,false]]);
    add(layers[4],'fill-extrusion','building',{'fill-extrusion-color':'#c4b39e','fill-extrusion-opacity':['interpolate',['linear'],['zoom'],14,0,15.5,1],'fill-extrusion-height':['interpolate',['linear'],['zoom'],14.8,0,16,['max',0,['min',1000,['to-number',['get','render_height'],0]]]],'fill-extrusion-base':['max',0,['to-number',['get','render_min_height'],0]]},['!=',['get','hide_3d'],true]);
    add(layers[5],'line','building',{'line-color':'#705e4d','line-width':['interpolate',['linear'],['zoom'],14,.3,18,1.1],'line-opacity':opacity});
    if(options.catalogURL){
     if(!map.getSource(objectSource))map.addSource(objectSource,{type:'geojson',data:areaData||empty,attribution:'© OpenStreetMap contributors · ODbL 1.0 · LANDFIRE 2020 vegetation context'});
     const objectLayer=(id,type,paint,filter)=>{if(!map.getLayer(id))map.addLayer({id,type,source:objectSource,minzoom:14,filter,paint},firstSymbol());};
     objectLayer(objectLayers[0],'fill',{'fill-color':['match',['get','kind'],'water','#78b0bc','pedestrian_area','#e2d4be','#90af73'],'fill-opacity':.55},['all',['==',['geometry-type'],'Polygon'],['match',['get','kind'],['water','pedestrian_area','land_area','woodland_area'],true,false]]);
     objectLayer(objectLayers[5],'fill',{'fill-color':'#cbb89f','fill-opacity':.25},['==',['get','kind'],'building']);
     objectLayer(objectLayers[1],'line',{'line-color':'#735238','line-width':1.5},['==',['get','kind'],'building']);
     // Use one extrusion surface; duplicate, near-identical meshes produce
     // depth flicker. Complete source geometry/height remains in the contract.
     objectLayer(objectLayers[3],'line',{'line-color':'#fff4df','line-width':['interpolate',['linear'],['zoom'],14,1,19,4]},['all',['==',['get','kind'],'transportation'],['!=',['get','below_ground'],true],['!=',['get','indoor'],true]]);
     const pointFade=['interpolate',['linear'],['zoom'],16,1,17,0];
     objectLayer(objectLayers[4],'circle',{'circle-radius':['interpolate',['linear'],['zoom'],14,1.4,18,3.8,20,5],'circle-color':'#346f3d','circle-opacity':pointFade,'circle-stroke-opacity':pointFade,'circle-stroke-width':.7,'circle-stroke-color':'#e3efcf'},['==',['get','kind'],'tree']);
     if(!map.getSource(treeSource))map.addSource(treeSource,{type:'geojson',data:treeData||empty});
     if(!map.getLayer(treeLayer))map.addLayer({id:treeLayer,type:'fill-extrusion',source:treeSource,minzoom:16,paint:{'fill-extrusion-color':['match',['get','render_part'],'trunk','#806249','lower','#4a7759','crown','#628f69','#85a67d'],'fill-extrusion-opacity':['interpolate',['linear'],['zoom'],16,0,17,1],'fill-extrusion-base':['get','render_base_m'],'fill-extrusion-height':['get','render_height_m']}},firstSymbol());
    }
    // Ground lines and point symbols belong below buildings, not over roofs.
    for(const id of [layers[5],...objectLayers]){
     const ids=map.getStyle().layers.map(l=>l.id);
     if(map.getLayer(id)&&ids.indexOf(id)>ids.indexOf(layers[4]))map.moveLayer(id,layers[4]);
    }
    ready=layers.every(id=>!!map.getLayer(id));
   }catch{status.textContent='Local map detail is loading; the regional map remains available.';}
   finally{installing=false;}
  }
  function metrics(){
   if(disposed||panel.hidden||!ready)return;
   try{const ids=new Set(map.queryRenderedFeatures({layers:[layers[4]]}).map(f=>String(f.id??JSON.stringify(f.geometry.coordinates))));status.textContent=area?area.title+(area.synthetic_vegetation?' · schematic vegetation':(' · mapped objects'+(area.feature_counts.tree?' · 3D tree symbols':' · no tree inventory in this extract'))):ids.size?ids.size.toLocaleString()+' mapped building parts in view · select an outline to inspect':'Mapped local detail · zoom or pan to a built-up area';}catch{}
  }
  async function loadArea(){
   if(disposed||!options.catalogURL||map.getZoom()<14)return;
   try{
    if(local?.contains()&&map.getZoom()>=15.5){
     const seq=++areaSequence;areaController?.abort();const snapshot=await local.build();if(disposed||seq!==areaSequence||!snapshot||!local.contains())return;
     if(areaData!==snapshot.collection){area=snapshot.area;areaId=area.id;areaData=snapshot.collection;treeData=empty;ensure();map.getSource(objectSource)?.setData(areaData);map.getSource(treeSource)?.setData(empty);retry.hidden=live?.state.phase!=='fallback';note.textContent=environment?.state.terrain?'LANDFIRE terrain · mapped buildings and roads. Vegetation is schematic; fire is a risk-driven illustration.':'Mapped buildings and roads. Schematic vegetation from 2020 land cover; flat ground. No individual-tree or spread prediction.';live?.setArea(snapshot);metrics();scheduleMetrics();}return;
    }
    note.textContent=environment?.state.buildings?'LANDFIRE terrain · Overture buildings and streets. Heights use recorded values or labeled estimates; tree shapes are schematic.':'Mapped footprints and streets. Building heights are display estimates; tree shapes are schematic.';
    const catalogURL=new URL(options.catalogURL,document.baseURI);if(catalogURL.origin!==location.origin)throw Error('Unexpected object catalog origin');
    catalogTask ||= fetch(catalogURL,{credentials:'omit',signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw Error('Object catalog unavailable');return r.json();}).catch(e=>{catalogTask=null;throw e;});
    const catalog=await catalogTask;if(disposed||map.getZoom()<14)return;
    if(catalog.schema_version!==1||catalog.kind!=='geographic-scene-catalog'||!Array.isArray(catalog.areas)||catalog.areas.length>50)throw Error('Unsupported object catalog');
    const bounds=map.getBounds(),found=catalog.areas.find(a=>{const b=a.bbox_wgs84;return b&&b.length===4&&b.every(Number.isFinite)&&b[0]<bounds.getEast()&&b[2]>bounds.getWest()&&b[1]<bounds.getNorth()&&b[3]>bounds.getSouth();});
    const next=found?.id||null;if(areaId===next)return;areaId=next;const seq=++areaSequence;areaController?.abort();area=null;areaData=null;treeData=null;map.getSource(objectSource)?.setData(empty);map.getSource(treeSource)?.setData(empty);live?.setArea(null);
    if(!found){scheduleMetrics();return;}
    let data=areaCache.get(found.id);
    if(!data){
     const descriptor=found.asset,u=new URL(descriptor.path,catalogURL);if(u.origin!==location.origin||!u.pathname.startsWith(new URL('.',catalogURL).pathname)||!Number.isInteger(descriptor.bytes)||descriptor.bytes<1||descriptor.bytes>3000000||!/^[a-f0-9]{64}$/.test(descriptor.sha256))throw Error('Invalid object asset');
     areaController=new AbortController();const response=await fetch(u,{credentials:'omit',signal:AbortSignal.any([areaController.signal,AbortSignal.timeout(10000)])});if(!response.ok)throw Error('Object asset unavailable');
     const bytes=await response.arrayBuffer();if(bytes.byteLength!==descriptor.bytes)throw Error('Object asset size mismatch');
     const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(digest!==descriptor.sha256)throw Error('Object asset checksum mismatch');
     data=JSON.parse(new TextDecoder().decode(bytes));if(data.type!=='FeatureCollection'||!Array.isArray(data.features)||data.features.length>10000)throw Error('Invalid object collection');
     data=global.FireEyeTallahassee.addGroundCover(data);areaCache.set(found.id,data);while(areaCache.size>3)areaCache.delete(areaCache.keys().next().value);
    }
    if(disposed||seq!==areaSequence)return;area=found;areaData=data;treeData=treeSymbols(data);ensure();map.getSource(objectSource)?.setData(data);map.getSource(treeSource)?.setData(treeData);live?.setArea({area,collection:data});metrics();scheduleMetrics();
   }catch(e){if(e.name!=='AbortError'){areaId=null;status.textContent='Local detail is loading; the mapped basemap remains usable.';if(local?.contains()&&map.getZoom()>=15.5){retry.hidden=false;clearTimeout(localTimer);localTimer=setTimeout(loadArea,5000);}}}
  }
  function scheduleMetrics(){clearTimeout(metricsTimer);metricsTimer=setTimeout(metrics,350);}
  function sync(){
   if(disposed)return;const z=map.getZoom();panelLayout();
   const factor=1-.35*Math.max(0,Math.min(1,(z-13)/3));options.onDetailScale?.(factor);
   tilt.setAttribute('aria-pressed',String(map.getPitch()>15));
   if(z<12.5){requested=false;panel.hidden=true;popup?.remove();popup=null;detail.hidden=true;}
   scheduleMetrics();
  }
  function onZoomEnd(){
   ensure();sync();loadArea();
   if(map.getZoom()>=15.5&&map.getPitch()<1&&!terrainTilt){terrainTilt=true;map.easeTo({pitch:48,duration:550});}
   else if(map.getZoom()<13&&terrainTilt){terrainTilt=false;map.easeTo({pitch:0,duration:450});}
  }
  const capture=()=>({center:map.getCenter().toArray(),zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()});
  async function enter(lnglat){
   if(!Array.isArray(lnglat)||lnglat.length!==2||!lnglat.every(Number.isFinite))return false;
   previous=capture();requested=true;selectedObject=null;detail.hidden=true;openControls();
   await options.ensureStreet?.();ensure();terrainTilt=true;
   map.flyTo({center:lnglat,zoom:17.8,pitch:52,bearing:map.getBearing(),duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:1600,essential:false});
   sync();return true;
  }
  function regional(){
   requested=false;terrainTilt=false;popup?.remove();popup=null;detail.hidden=true;
   const target=previous&&previous.zoom<13?previous:{center:map.getCenter().toArray(),zoom:11.5,pitch:0,bearing:0};
   map.flyTo({...target,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:1100});previous=null;
  }
  function onMapClick(e){
   if(disposed||map.getZoom()<14||!ready)return false;
   if(panelDismissed||(compactScreen.matches&&!document.body.classList.contains('sidebar-hidden')))return false;
   const rendered=map.queryRenderedFeatures(e.point);
   if(rendered.some(f=>['WF','RX','CX','detection'].includes(f.properties?.kind))){resetGround();return false;}
   if(map.getZoom()>=15)chooseGround([e.lngLat.lng,e.lngLat.lat]);
   const mapped=environment?.inspect(e.point);
   if(mapped){const p=mapped.properties,building=p.kind==='building';
    detail.replaceChildren(create('strong',p.name||(building?'Mapped building':'Mapped street / path')),
     create('p','Overture Maps · '+p.release),create('p',e.lngLat.lat.toFixed(6)+'°, '+e.lngLat.lng.toFixed(6)));
    if(building)detail.append(create('p',p.height_source==='height'?'Source-reported height: '+p.height_m+' m.':
     'Display height: '+p.height_m+' m · '+(p.height_source==='floors'?'estimated from floors':'estimated from building category')+'.'));
    else detail.append(create('p','Mapped centerline; width may use a road-class estimate.'));
    detail.hidden=false;emitObject({kind:p.kind,selected_wgs84:[e.lngLat.lng,e.lngLat.lat],source:'Overture Maps',
     source_feature_id:p.source_id,properties:p,geometry_is_display_tile:false});return true;
   }
   const feature=rendered.find(f=>f.layer.id===treeLayer)||rendered.find(f=>f.layer.id===objectLayers[4])||rendered.find(f=>f.source===objectSource&&f.properties?.kind==='building')||rendered.find(f=>objectLayers.includes(f.layer.id))||rendered.find(f=>[layers[4],layers[5],layers[3],layers[2]].includes(f.layer.id));
   if(!feature)return false;
   if(feature.source===objectSource||feature.source===treeSource){
    if(!area)return false;
    const original=areaData?.features.find(f=>f.properties.source_id===feature.properties?.source_id),p=original?.properties||feature.properties||{};
    if(p.synthetic){detail.replaceChildren(create('strong','Schematic vegetation'),create('p','Position generated from historical land cover and mapped exclusions; not a surveyed tree.'),create('p',e.lngLat.lat.toFixed(6)+'°, '+e.lngLat.lng.toFixed(6)),create('p','LANDFIRE 2020 · schematic species, height and crown.'));detail.hidden=false;emitObject({kind:p.kind,source:'LANDFIRE 2020 EVT',geometry_is_display_tile:true,synthetic:true,selected_wgs84:[e.lngLat.lng,e.lngLat.lat]});return true;}
    if(area.synthetic_vegetation){detail.replaceChildren(create('strong',p.kind==='building'?'Mapped building':'Mapped feature'),create('p','OpenStreetMap / OpenMapTiles · tiled display geometry'),create('p',e.lngLat.lat.toFixed(6)+'°, '+e.lngLat.lng.toFixed(6)),create('p','Source geometry is not a survey; displayed height may be estimated.'));detail.hidden=false;emitObject({kind:p.kind,source:'OpenStreetMap / OpenMapTiles',geometry_is_display_tile:true,selected_wgs84:[e.lngLat.lng,e.lngLat.lat]});return true;}
    const heading=p.name||p.address||({tree:'Mapped tree location',building:'Mapped building',pedestrian_area:'Mapped pedestrian area',land_area:'Mapped land use',transportation:'Mapped street / path',water:'Mapped water'}[p.kind]||'Mapped object');
    detail.replaceChildren(create('strong',heading),create('p',p.source_id+' · OpenStreetMap'),create('p',e.lngLat.lat.toFixed(6)+'°, '+e.lngLat.lng.toFixed(6)));
    if(p.address)detail.append(create('p',p.address));
    if(['tree','building'].includes(p.kind))detail.append(create('p',typeof p.height_m==='number'?'Source-tagged height: '+p.height_m+' m; not independently surveyed here.':'Height is not mapped.'));
    if(p.kind==='tree')detail.append(create('p','Location follows a source tree record. Shape and crown size are schematic; unrecorded height uses an 8 m display symbol.'));
    if(p.kind==='transportation')detail.append(create('p','Mapped centerline; display width is schematic.'));
    detail.append(create('p','Extract retrieved '+area.retrieved_at_utc.slice(0,10)+'. Source edit date is not survey date.'));detail.hidden=false;
    emitObject({kind:p.kind,selected_wgs84:[e.lngLat.lng,e.lngLat.lat],source:'OpenStreetMap',source_feature_id:p.source_id,geometry_is_display_tile:false,geometry:original?.geometry||null,properties:original?.properties||p});return true;
   }
   const building=feature.sourceLayer==='building',p=feature.properties||{},name=p.name||p['name:en']||(building?'Mapped building':'Mapped street / path');
   detail.replaceChildren(create('strong',name),create('p',e.lngLat.lat.toFixed(6)+'°, '+e.lngLat.lng.toFixed(6)),create('p',building?'Outline: OpenStreetMap / OpenMapTiles. Display height is not a surveyed measurement.':'Mapped centerline. Display width is a styling choice, not surveyed pavement width.'));detail.hidden=false;
   const hint=create('p','Source geometry is tiled for display; this selection is not a complete survey or a building-level fire prediction.');detail.append(hint);
   emitObject({kind:building?'building':'transportation',selected_wgs84:[e.lngLat.lng,e.lngLat.lat],source:'OpenStreetMap / OpenMapTiles',source_feature_id:feature.id??null,geometry_is_display_tile:true,verified_height_m:null});
   return true;
  }
  back.onclick=regional;tilt.onclick=()=>{terrainTilt=map.getPitch()<15;map.easeTo({pitch:terrainTilt?52:0,duration:450});};
  const clearSelection=()=>{selectedObject=null;detail.hidden=true;resetGround();};
  const styled=()=>ensure();
  const moved=()=>{scheduleMetrics();loadArea();};
  const failed=e=>{if(e.sourceId===SOURCE)status.textContent='Street tiles are temporarily unavailable; the regional map remains available.';};
  const localReady=e=>{if(e.sourceId==='openmaptiles'&&e.isSourceLoaded&&local?.contains()&&map.getZoom()>=15.5){clearTimeout(localTimer);localTimer=setTimeout(loadArea,180);}};map.on('sourcedata',localReady);
  map.on('movestart',clearSelection);map.on('zoom',sync);map.on('zoomend',onZoomEnd);map.on('pitchend',sync);map.on('moveend',moved);map.on('styledata',styled);map.on('error',failed);
  map.setMaxZoom(20);ensure();sync();loadArea();
  const vrStatus=()=>({sceneBounds:area?.bbox_wgs84?.slice()||null,terrainArea:environment?.state.area||null,terrainStatus:environment?.state.status||'unavailable',terrainReady:!!(environment?.state.terrain&&environment?.state.status==='ready'&&map.isSourceLoaded('scene-environment-dem'))});
  return {ready:true,enter,regional,vrStatus,async prepareVR(isCurrent=()=>true){
   await options.ensureStreet?.();if(disposed||!isCurrent())return;
   ensure();void environment?.retry();if(!areaData)areaId=null;
   local?.invalidate();void loadArea();live?.retry();
  },vrSource(){
   const current=areaData?.features||[],mapped=environment?.features()||[];
   const geometry=mapped.length?[...mapped,...current.filter(f=>['water','land_area','pedestrian_area'].includes(f.properties?.kind))]:current;
   return {...vrStatus(),center:map.getCenter().toArray(),height:p=>environment?.height(p),features:geometry,meshSnapshot:live?.exportScene()};
  },onMapClick,panel,openControls,closeControls,simulation:live,environment,get geometryReady(){return ready;},get selectedArea(){return area?.id||null;},get localScene(){return area?.prediction_linked?{area,collection:areaData}:null;},dispose(){disposed=true;environment?.dispose();panelObserver.disconnect();compactScreen.removeEventListener("change",layoutChanged);reopen.remove();groundSequence++;groundView?.dispose();clearTimeout(groundTimer);if(groundScript){groundScript.onload=groundScript.onerror=null;groundScript.remove();groundScript=null;}clearTimeout(localTimer);map.off('sourcedata',localReady);live?.dispose();areaSequence++;areaController?.abort();clearTimeout(metricsTimer);map.off('movestart',clearSelection);map.off('zoom',sync);map.off('zoomend',onZoomEnd);map.off('pitchend',sync);map.off('moveend',moved);map.off('styledata',styled);map.off('error',failed);popup?.remove();panel.remove();for(const [id,paint] of localSymbolPaint)if(map.getLayer(id))for(const [name,value] of Object.entries(paint))map.setPaintProperty(id,name,value);for(const id of [...layers,...objectLayers,treeLayer])if(map.getLayer(id))map.removeLayer(id);if(map.getSource(treeSource))map.removeSource(treeSource);if(map.getSource(objectSource))map.removeSource(objectSource);options.onDetailScale?.(1);}};
 }
 global.FireEyeGeographicScene={mount};
})(window);
