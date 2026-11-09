/* Geographic adapter for the pinned upstream terrain/building extraction.
   Static assets only. No dense grass, synthetic terrain relief or forecast edits. */
(function(global){
 'use strict';
 const DEM='scene-environment-dem',OBJECTS='scene-environment-objects';
 const BUILDINGS='scene-environment-buildings',ROADS='scene-environment-roads';
 const PIN='08c2d1274a5ed29237175d6f1b771949565d87c1';
 const inBox=(p,b)=>p[0]>=b[0]&&p[0]<=b[2]&&p[1]>=b[1]&&p[1]<=b[3];
 function inRing(p,r){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){
  const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }return inside;}
 function mount(map,options){
  let disposed=false,catalog=null,catalogTask=null,active=null,controller=null,sequence=0;
  let timer=null,refreshTimer=null,cooldown=0,changing=false;
  const cache=new Map(),hidden=new Map();
  const state={status:'idle',area:null,terrain:false,buildings:false,upstream_revision:PIN};
  const notify=()=>options.onChange?.({...state});
  const url=new URL(options.url,document.baseURI);
  if(url.origin!==location.origin)throw Error('Unexpected scene environment origin');
  async function checked(descriptor,base,signal,limit){
   const u=new URL(descriptor.path,base);
   if(u.origin!==location.origin||!u.pathname.startsWith(new URL('.',base).pathname)||
      !Number.isInteger(descriptor.bytes)||descriptor.bytes<1||descriptor.bytes>limit||
      !/^[a-f0-9]{64}$/.test(descriptor.sha256))throw Error('Invalid scene environment asset');
   u.searchParams.set('v',descriptor.sha256.slice(0,16));
   const r=await fetch(u,{credentials:'omit',signal});if(!r.ok)throw Error('Scene environment asset unavailable');
   const bytes=await r.arrayBuffer();if(bytes.byteLength!==descriptor.bytes)throw Error('Scene environment asset size');
   const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
   if(sha!==descriptor.sha256)throw Error('Scene environment checksum');return bytes;
  }
  function restore(){
   for(const [id,visibility] of hidden)if(map.getLayer(id))map.setLayoutProperty(id,'visibility',visibility);
   hidden.clear();
  }
  function hide(id){if(!map.getLayer(id)||hidden.has(id))return;hidden.set(id,map.getLayoutProperty(id,'visibility')||'visible');map.setLayoutProperty(id,'visibility','none');}
  function remove(){
   changing=true;
   try{
    restore();if(map.getTerrain()?.source===DEM)map.setTerrain(null);
    for(const id of [BUILDINGS,ROADS])if(map.getLayer(id))map.removeLayer(id);
    for(const id of [OBJECTS,DEM])if(map.getSource(id))map.removeSource(id);
    state.terrain=false;state.buildings=false;
   }finally{changing=false;}
  }
  function objectVisibility(){
   if(!active||!map.getLayer(BUILDINGS))return;
   const canvas=map.getCanvas(),w=canvas.clientWidth,h=canvas.clientHeight;
   const covered=map.getZoom()>=16&&[[0,0],[w,0],[w,h],[0,h]].every(p=>inRing(map.unproject(p).toArray(),active.meta.buildings.coverage_polygon));
   map.setLayoutProperty(BUILDINGS,'visibility',covered?'visible':'none');
   map.setLayoutProperty(ROADS,'visibility',covered?'visible':'none');
   if(covered){
    // Substitute one complete viewport, avoiding competing extrusion surfaces.
    for(const layer of map.getStyle().layers){
     if(layer.source==='openmaptiles'&&layer['source-layer']==='building')hide(layer.id);
    }
    for(const id of ['mapped-scene-buildings','mapped-scene-outlines','mapped-scene-object-buildings',
                     'mapped-scene-object-footprints','mapped-scene-roads','mapped-scene-paths','mapped-scene-object-roads'])hide(id);
   }else restore();
   if(state.buildings!==covered){state.buildings=covered;notify();}
  }
  function install(){
   if(disposed||changing||!active||map.getZoom()<14)return;
   changing=true;
   try{
    const meta=active.meta,base=active.url;
    if(!map.getSource(DEM)){
     const d=meta.terrain.dem;
     map.addSource(DEM,{type:'raster-dem',tiles:[new URL(d.template+'?v='+active.revision,base).href.replaceAll('%7B','{').replaceAll('%7D','}')],
       minzoom:d.minzoom,maxzoom:d.maxzoom,tileSize:256,encoding:'terrarium',bounds:meta.bounds,
       attribution:'LANDFIRE 2020 elevation · 30 m source'});
    }
    // All published pilot DEMs are nonnegative; retain the source height datum.
    if(!map.getTerrain())map.setTerrain({source:DEM,exaggeration:1,elevationOffset:0});
    state.terrain=map.getTerrain()?.source===DEM;
    if(!map.getSource(OBJECTS))map.addSource(OBJECTS,{type:'geojson',data:active.objects,
       attribution:'© OpenStreetMap contributors · Overture Maps Foundation'});
    const before=map.getStyle().layers.find(l=>l.type==='symbol')?.id;
    if(!map.getLayer(ROADS))map.addLayer({id:ROADS,type:'line',source:OBJECTS,minzoom:16,
      filter:['==',['get','kind'],'transportation'],paint:{'line-color':'#f5e7d0',
        'line-width':['interpolate',['exponential',2],['zoom'],16,['*',.5,['get','width_m']],20,['*',8,['get','width_m']]]}},before);
    if(!map.getLayer(BUILDINGS))map.addLayer({id:BUILDINGS,type:'fill-extrusion',source:OBJECTS,minzoom:16,
      filter:['==',['get','kind'],'building'],paint:{'fill-extrusion-color':'#c4b39e',
      'fill-extrusion-height':['get','height_m'],'fill-extrusion-opacity':1}},before);
    objectVisibility();state.status='ready';notify();
   }finally{changing=false;}
  }
  async function refresh(){
   if(disposed||changing)return;
   if(map.getZoom()<14){sequence++;controller?.abort();active=null;remove();state.status='idle';state.area=null;notify();return;}
   if(Date.now()<cooldown)return;
   const seq=++sequence;controller?.abort();controller=new AbortController();
   const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]);
   try{
    if(!catalog){
     state.status='loading';notify();
     catalogTask ||= fetch(url,{credentials:'omit',cache:'no-cache',signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw Error('Scene catalog unavailable');return r.json();}).catch(e=>{catalogTask=null;throw e;});
     catalog=await catalogTask;
     if(catalog.kind!=='scene-environment'||catalog.schema_version!==1||catalog.upstream_revision!==PIN||!Array.isArray(catalog.areas)||catalog.areas.length>50)throw Error('Invalid scene environment catalog');
    }
    if(disposed||seq!==sequence)return;
    const found=catalog.areas.find(a=>inBox(map.getCenter().toArray(),a.bounds));
    if(active&&active.id===found?.id){install();return;}
    active=null;remove();state.area=null;
    if(!found){state.status='outside';notify();return;}
    state.status='loading';notify();
    let next=cache.get(found.id);
    if(!next){
     const metaURL=new URL(found.asset.path,url),meta=JSON.parse(new TextDecoder().decode(await checked(found.asset,url,signal,50000)));
     if(meta.id!==found.id||meta.bounds.join(',')!==found.bounds.join(',')||meta.terrain.dem.template!=='dem/{z}/{x}/{y}.png'||meta.terrain.dem.minzoom!==9||meta.terrain.dem.maxzoom!==14)throw Error('Invalid terrain contract');
     const renderedSampler=!!(map.queryTerrainElevation||map.transform?.getElevation);
     const [objectBytes,gridBytes]=await Promise.all([
       checked(meta.buildings.asset,metaURL,signal,8000000),renderedSampler?null:checked(meta.terrain.grid,metaURL,signal,8000000)]);
     const objects=JSON.parse(new TextDecoder().decode(objectBytes)),g=meta.terrain.grid;
     if(objects.type!=='FeatureCollection'||!Array.isArray(objects.features)||objects.features.length>20000||
        !Number.isInteger(g.width)||!Number.isInteger(g.height)||g.width*g.height>3000000||
        g.uncompressed_bytes!==g.width*g.height*4||g.dtype!=='float32-le')throw Error('Invalid environment data');
     for(const f of objects.features){if(!['building','transportation'].includes(f.properties?.kind)||
       f.properties.kind==='building'&&(!(f.properties.height_m>0)||f.properties.height_m>650))throw Error('Invalid environment object');}
     let heights=null;
     if(gridBytes){const unpack=fflate.gunzipSync(new Uint8Array(gridBytes));if(unpack.byteLength!==g.uncompressed_bytes)throw Error('Invalid elevation grid');
      heights=new Float32Array(unpack.buffer,unpack.byteOffset,unpack.byteLength/4);
      if(!heights.every(v=>Number.isNaN(v)||Number.isFinite(v)&&v>=-500&&v<=9000))throw Error('Invalid elevation');}
     next={id:found.id,url:metaURL,revision:found.asset.sha256.slice(0,16),meta,objects,heights};cache.set(found.id,next);while(cache.size>2)cache.delete(cache.keys().next().value);
    }
    if(disposed||seq!==sequence)return;
    active=next;state.area=next.id;install();
   }catch(e){
    if(disposed||seq!==sequence||e.name==='AbortError')return;
    active=null;remove();state.status='fallback';cooldown=Date.now()+30000;notify();
   }
  }
  function height(p){
   if(!active||!state.terrain||!inBox(p,active.meta.bounds))return 0;
   // Use the actual rendered DEM where supported by the pinned MapLibre 2.4
   // build; retain a verified grid fallback for newer renderers.
   if(map.queryTerrainElevation){const z=map.queryTerrainElevation(p);if(Number.isFinite(z))return z;}
   if(map.transform?.getElevation&&map.style?.terrain){
    const z=map.transform.getElevation(new maplibregl.LngLat(...p),map.style.terrain);if(Number.isFinite(z))return z;
   }
   if(!active.heights)return 0;
   const g=active.meta.terrain.grid,b=g.bounds_mercator,R=6378137,x=p[0]*Math.PI/180*R,y=R*Math.log(Math.tan(Math.PI/4+p[1]*Math.PI/360));
   const u=Math.max(0,Math.min(g.width-1,(x-b[0])/(b[2]-b[0])*g.width-.5)),v=Math.max(0,Math.min(g.height-1,(b[3]-y)/(b[3]-b[1])*g.height-.5));
   const i=Math.min(g.width-2,Math.floor(u)),j=Math.min(g.height-2,Math.floor(v)),a=active.heights,
    values=[a[j*g.width+i],a[j*g.width+i+1],a[(j+1)*g.width+i],a[(j+1)*g.width+i+1]];
   if(!values.every(Number.isFinite))return 0;
   return values[0]*(1-u+i)*(1-v+j)+values[1]*(u-i)*(1-v+j)+values[2]*(1-u+i)*(v-j)+values[3]*(u-i)*(v-j);
  }
  function changed(e){if(e.sourceId!==DEM||disposed)return;clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(!disposed&&active){objectVisibility();options.onTerrain?.();}},180);}
  function failed(e){if(e.sourceId!==DEM&&e.sourceId!==OBJECTS)return;active=null;remove();state.status='fallback';state.area=null;cooldown=Date.now()+60000;notify();}
  const moved=()=>{clearTimeout(timer);timer=setTimeout(refresh,180);};
  map.on('moveend',moved);map.on('sourcedata',changed);map.on('error',failed);
  refresh();
  return {state,height,refresh,retry(){cooldown=0;return refresh();},features:()=>state.buildings?active?.objects.features||[]:[],
    inspect(point){if(!state.buildings)return null;return map.queryRenderedFeatures(point,{layers:[BUILDINGS,ROADS]})[0]||null;},
    dispose(){disposed=true;sequence++;controller?.abort();clearTimeout(timer);clearTimeout(refreshTimer);
      map.off('moveend',moved);map.off('sourcedata',changed);map.off('error',failed);remove();cache.clear();}};
 }
 global.FireEyeSceneEnvironment={mount,inBox,inRing};
})(window);
