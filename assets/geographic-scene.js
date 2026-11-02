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
  const top=create('div',null,'mapped-scene-heading'),title=create('strong','Digital local scene'),back=create('button','Regional view');back.type='button';
  top.append(title,back);panel.append(top);
  const status=create('p','Zoom in to explore mapped buildings and streets.','mapped-scene-status');status.setAttribute('role','status');panel.append(status);
  const actions=create('div',null,'mapped-scene-actions'),tilt=create('button','3D'),simulation=create('button','Simulation');
  for(const b of [tilt,simulation]){b.type='button';actions.append(b);}panel.append(actions);
  tilt.setAttribute('aria-pressed','false');
  const note=create('p','Mapped footprints and streets. Building heights are display estimates; tree shapes are schematic.','mapped-scene-note');panel.append(note);
  const detail=create('div',null,'mapped-scene-detail');detail.hidden=true;panel.append(detail);
  (options.container||document.body).append(panel);
  let ready=false,disposed=false,installing=false,previous=null,popup=null,requested=false,terrainTilt=false,metricsTimer=null;
  let catalogTask=null,areaId=null,area=null,areaData=null,areaController=null,areaSequence=0;
  let selectedObject=null;
  const emitObject=value=>{selectedObject=value;options.onObject?.(value);};
  const objectSource=PREFIX+'objects',objectLayers=[PREFIX+'object-areas',PREFIX+'object-buildings',PREFIX+'object-height',PREFIX+'object-roads',PREFIX+'object-trees',PREFIX+'object-footprints'];
  const treeSource=PREFIX+'tree-symbols',treeLayer=PREFIX+'tree-models';let treeData=null;
  const areaCache=new Map(),empty={type:'FeatureCollection',features:[]};
  const layers=[PREFIX+'areas',PREFIX+'water',PREFIX+'paths',PREFIX+'roads',PREFIX+'buildings',PREFIX+'outlines'];
  const opacity=['interpolate',['linear'],['zoom'],13,0,15,1];
  const firstSymbol=()=>map.getStyle()?.layers?.find(l=>l.type==='symbol')?.id;
  function ensure(){
   // Other forecast/overlay sources can still be loading or unavailable.
   // Local geometry must not wait for every source in the entire map.
   if(disposed||installing||!map.getSource(SOURCE))return;
   installing=true;
   try{
    const add=(id,type,sourceLayer,paint,filter)=>{if(map.getLayer(id))return;const layer={id,type,source:SOURCE,'source-layer':sourceLayer,minzoom:13,paint};if(filter)layer.filter=filter;map.addLayer(layer,firstSymbol());};
    add(layers[0],'fill','landuse',{'fill-color':'#8caa72','fill-opacity':['interpolate',['linear'],['zoom'],13,0,15,.16]},['match',['get','class'],['park','grass','garden','recreation_ground','village_green'],true,false]);
    add(layers[1],'fill','water',{'fill-color':'#79b3c4','fill-opacity':['interpolate',['linear'],['zoom'],13,0,15,.7]});
    add(layers[2],'line','transportation',{'line-color':'#e8d6b4','line-width':['interpolate',['exponential',1.5],['zoom'],13,.7,16,2,20,12],'line-opacity':opacity},['all',['!=',['get','brunnel'],'tunnel'],['match',['get','class'],['path','track','pedestrian'],true,false]]);
    add(layers[3],'line','transportation',{'line-color':'#fbf8ef','line-width':['interpolate',['exponential',1.5],['zoom'],13,1,16,3,20,20],'line-opacity':opacity},['all',['!=',['get','brunnel'],'tunnel'],['match',['get','class'],['motorway','trunk','primary','secondary','tertiary','minor','service','street'],true,false]]);
    add(layers[4],'fill-extrusion','building',{'fill-extrusion-color':'#c4b39e','fill-extrusion-opacity':['interpolate',['linear'],['zoom'],14,0,15.5,1],'fill-extrusion-height':['interpolate',['linear'],['zoom'],14.8,0,16,['max',0,['min',1000,['to-number',['get','render_height'],0]]]],'fill-extrusion-base':['max',0,['to-number',['get','render_min_height'],0]]},['!=',['get','hide_3d'],true]);
    add(layers[5],'line','building',{'line-color':'#705e4d','line-width':['interpolate',['linear'],['zoom'],14,.3,18,1.1],'line-opacity':opacity});
    if(options.catalogURL){
     if(!map.getSource(objectSource))map.addSource(objectSource,{type:'geojson',data:areaData||empty,attribution:'© OpenStreetMap contributors · ODbL 1.0 · dated research extracts'});
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
   try{const ids=new Set(map.queryRenderedFeatures({layers:[layers[4]]}).map(f=>String(f.id??JSON.stringify(f.geometry.coordinates))));status.textContent=area?area.title+' · mapped objects'+(area.feature_counts.tree?' · 3D tree symbols':' · no tree inventory in this extract'):ids.size?ids.size.toLocaleString()+' mapped building parts in view · select an outline to inspect':'Mapped local detail · zoom or pan to a built-up area';}catch{}
  }
  async function loadArea(){
   if(disposed||!options.catalogURL||map.getZoom()<14)return;
   try{
    const catalogURL=new URL(options.catalogURL,document.baseURI);if(catalogURL.origin!==location.origin)throw Error('Unexpected object catalog origin');
    catalogTask ||= fetch(catalogURL,{credentials:'omit',signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw Error('Object catalog unavailable');return r.json();}).catch(e=>{catalogTask=null;throw e;});
    const catalog=await catalogTask;if(disposed||map.getZoom()<14)return;
    if(catalog.schema_version!==1||catalog.kind!=='geographic-scene-catalog'||!Array.isArray(catalog.areas)||catalog.areas.length>50)throw Error('Unsupported object catalog');
    const bounds=map.getBounds(),found=catalog.areas.find(a=>{const b=a.bbox_wgs84;return b&&b.length===4&&b.every(Number.isFinite)&&b[0]<bounds.getEast()&&b[2]>bounds.getWest()&&b[1]<bounds.getNorth()&&b[3]>bounds.getSouth();});
    const next=found?.id||null;if(areaId===next)return;areaId=next;const seq=++areaSequence;areaController?.abort();area=null;areaData=null;treeData=null;map.getSource(objectSource)?.setData(empty);map.getSource(treeSource)?.setData(empty);
    if(!found){scheduleMetrics();return;}
    let data=areaCache.get(found.id);
    if(!data){
     const descriptor=found.asset,u=new URL(descriptor.path,catalogURL);if(u.origin!==location.origin||!u.pathname.startsWith(new URL('.',catalogURL).pathname)||!Number.isInteger(descriptor.bytes)||descriptor.bytes<1||descriptor.bytes>3000000||!/^[a-f0-9]{64}$/.test(descriptor.sha256))throw Error('Invalid object asset');
     areaController=new AbortController();const response=await fetch(u,{credentials:'omit',signal:AbortSignal.any([areaController.signal,AbortSignal.timeout(10000)])});if(!response.ok)throw Error('Object asset unavailable');
     const bytes=await response.arrayBuffer();if(bytes.byteLength!==descriptor.bytes)throw Error('Object asset size mismatch');
     const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(digest!==descriptor.sha256)throw Error('Object asset checksum mismatch');
     data=JSON.parse(new TextDecoder().decode(bytes));if(data.type!=='FeatureCollection'||!Array.isArray(data.features)||data.features.length>10000)throw Error('Invalid object collection');
     areaCache.set(found.id,data);while(areaCache.size>3)areaCache.delete(areaCache.keys().next().value);
    }
    if(disposed||seq!==areaSequence)return;area=found;areaData=data;treeData=treeSymbols(data);ensure();map.getSource(objectSource)?.setData(data);map.getSource(treeSource)?.setData(treeData);scheduleMetrics();
   }catch(e){if(e.name!=='AbortError'){areaId=null;status.textContent='Detailed object extract is unavailable; the mapped basemap remains usable.';}}
  }
  function scheduleMetrics(){clearTimeout(metricsTimer);metricsTimer=setTimeout(metrics,350);}
  function sync(){
   if(disposed)return;const z=map.getZoom();panel.hidden=z<13&&!requested;
   const factor=1-.78*Math.max(0,Math.min(1,(z-13)/3));options.onDetailScale?.(factor);
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
   previous=capture();requested=true;selectedObject=null;detail.hidden=true;panel.hidden=false;
   await options.ensureStreet?.();ensure();terrainTilt=true;
   map.flyTo({center:lnglat,zoom:17.1,pitch:52,bearing:map.getBearing(),duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:1600,essential:false});
   sync();return true;
  }
  function regional(){
   requested=false;terrainTilt=false;popup?.remove();popup=null;detail.hidden=true;
   const target=previous&&previous.zoom<13?previous:{center:map.getCenter().toArray(),zoom:11.5,pitch:0,bearing:0};
   map.flyTo({...target,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:1100});previous=null;
  }
  function onMapClick(e){
   if(disposed||map.getZoom()<14||!ready)return false;
   const rendered=map.queryRenderedFeatures(e.point);
   if(rendered.some(f=>['WF','RX','CX','detection'].includes(f.properties?.kind)))return false;
   const feature=rendered.find(f=>f.layer.id===treeLayer)||rendered.find(f=>f.layer.id===objectLayers[4])||rendered.find(f=>f.source===objectSource&&f.properties?.kind==='building')||rendered.find(f=>objectLayers.includes(f.layer.id))||rendered.find(f=>[layers[4],layers[5],layers[3],layers[2]].includes(f.layer.id));
   if(!feature)return false;
   if(feature.source===objectSource||feature.source===treeSource){
    if(!area)return false;
    const original=areaData?.features.find(f=>f.properties.source_id===feature.properties?.source_id),p=original?.properties||feature.properties||{},heading=p.name||p.address||({tree:'Mapped tree location',building:'Mapped building',pedestrian_area:'Mapped pedestrian area',land_area:'Mapped land use',transportation:'Mapped street / path',water:'Mapped water'}[p.kind]||'Mapped object');
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
  const launchSimulation=options.openSimulation||options.openIllustration;
  simulation.onclick=()=>launchSimulation?.({lnglat:[...(selectedObject?.selected_wgs84||map.getCenter().toArray())],object:selectedObject});simulation.hidden=!launchSimulation;
  const clearSelection=()=>{selectedObject=null;detail.hidden=true;};
  const styled=()=>ensure();
  const moved=()=>{scheduleMetrics();loadArea();};
  const failed=e=>{if(e.sourceId===SOURCE)status.textContent='Street tiles are temporarily unavailable; the regional map remains available.';};
  map.on('movestart',clearSelection);map.on('zoom',sync);map.on('zoomend',onZoomEnd);map.on('pitchend',sync);map.on('moveend',moved);map.on('styledata',styled);map.on('error',failed);
  map.setMaxZoom(20);ensure();sync();
  return {ready:true,enter,regional,onMapClick,panel,get geometryReady(){return ready;},get selectedArea(){return area?.id||null;},dispose(){disposed=true;areaSequence++;areaController?.abort();clearTimeout(metricsTimer);map.off('movestart',clearSelection);map.off('zoom',sync);map.off('zoomend',onZoomEnd);map.off('pitchend',sync);map.off('moveend',moved);map.off('styledata',styled);map.off('error',failed);popup?.remove();panel.remove();for(const id of [...layers,...objectLayers,treeLayer])if(map.getLayer(id))map.removeLayer(id);if(map.getSource(treeSource))map.removeSource(treeSource);if(map.getSource(objectSource))map.removeSource(objectSource);options.onDetailScale?.(1);}};
 }
 global.FireEyeGeographicScene={mount};
})(window);
