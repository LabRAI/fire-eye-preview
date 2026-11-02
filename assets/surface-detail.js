/* Optional surface inspection. Loaded only after an explicit user request.
 * Reuses mapped geometry already on the device; no generated ground meshes. */
(function(global){
 'use strict';
 const SOURCE='requested-ground-detail',LAYERS=[SOURCE+'-fill',SOURCE+'-line',SOURCE+'-points'];
 const labels={grass:'Grass',meadow:'Meadow',park:'Park',garden:'Garden',flowerbed:'Flowerbed',playground:'Playground',pitch:'Sports pitch',recreation_ground:'Recreation ground'};
 const empty=()=>({type:'FeatureCollection',features:[]});
 function nearby(geometry,point,radius){
  const scale=111320,cos=Math.cos(point[1]*Math.PI/180),xy=p=>[(p[0]-point[0])*scale*cos,(p[1]-point[1])*scale];
  if(geometry.type==='Point')return Math.hypot(...xy(geometry.coordinates))<=radius;
  const inside=ring=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=xy(ring[i]),b=xy(ring[j]);if((a[1]>0)!==(b[1]>0)&&0<(b[0]-a[0])*(-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
  const boundary=ring=>ring.some((p,i)=>{if(!i)return false;const a=xy(ring[i-1]),b=xy(p),x=b[0]-a[0],y=b[1]-a[1],d=x*x+y*y,t=d?Math.max(0,Math.min(1,-(a[0]*x+a[1]*y)/d)):0;return Math.hypot(a[0]+t*x,a[1]+t*y)<=radius;});
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  return polygons.some(rings=>rings.length&&((inside(rings[0])&&!rings.slice(1).some(inside))||rings.some(boundary)));
 }
 function collect(map,point,collection){
  const radius=100,dy=radius/111320,dx=dy/Math.cos(point[1]*Math.PI/180),box=[point[0]-dx,point[1]-dy,point[0]+dx,point[1]+dy];
  const selected=[],seen=new Set();
  function add(f,source){
   const p=f.properties||{},kind=[p.subclass,p.leisure,p.landuse,p.class].find(x=>Object.hasOwn(labels,x));
   if(!kind||!['Point','Polygon','MultiPolygon'].includes(f.geometry?.type)||selected.length>=100)return;
   let count=0,valid=true,b=[Infinity,Infinity,-Infinity,-Infinity];
   function visit(a){if(!Array.isArray(a)){valid=false;return;}if(typeof a[0]==='number'){count++;if(a.length<2||!Number.isFinite(a[0])||!Number.isFinite(a[1])||Math.abs(a[0])>180||Math.abs(a[1])>85){valid=false;return;}b=[Math.min(b[0],a[0]),Math.min(b[1],a[1]),Math.max(b[2],a[0]),Math.max(b[3],a[1])];}else for(const x of a){if(count>12000){valid=false;break;}visit(x);}}
   visit(f.geometry.coordinates);if(!valid||!count||b[0]>box[2]||b[2]<box[0]||b[1]>box[3]||b[3]<box[1]||!nearby(f.geometry,point,radius))return;
   const id=p.source_id??f.id,key=kind+'|'+(id??'')+'|'+JSON.stringify(f.geometry.coordinates);if(seen.has(key))return;seen.add(key);
   selected.push({type:'Feature',geometry:f.geometry,properties:{kind,label:labels[kind],name:typeof p.name==='string'?p.name.slice(0,160):'',source,source_id:String(id??''),display_geometry:true}});
  }
  // Use verified local extracts where available, then the current basemap.
  for(const f of (collection?.features||[]).slice(0,10000))add(f,'OpenStreetMap local extract');
  for(const sourceLayer of ['landuse','landcover','park','poi']){
   let rows=[];try{rows=map.querySourceFeatures('openmaptiles',{sourceLayer});}catch{}
   for(const f of rows.slice(0,6000))add(f,'OpenStreetMap / OpenMapTiles');
  }
  return {type:'FeatureCollection',features:selected};
 }
 function mount(map){
  let disposed=false,shown=null;
  function clear(){shown=null;map.getSource(SOURCE)?.setData(empty());}
  function show(point,collection){
   if(disposed||map.getZoom()<15||!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||Math.abs(point[0])>180||Math.abs(point[1])>85)throw Error('Invalid detail selection');
   const data=collect(map,point,collection);
   if(!map.getSource(SOURCE))map.addSource(SOURCE,{type:'geojson',data,attribution:'© OpenStreetMap contributors · ODbL 1.0'});else map.getSource(SOURCE).setData(data);
   const before=map.getLayer('mapped-scene-buildings')?'mapped-scene-buildings':undefined;
   if(!map.getLayer(LAYERS[0]))map.addLayer({id:LAYERS[0],type:'fill',source:SOURCE,filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['match',['get','kind'],'playground','#c89a61','pitch','#8fbdab','#9bbe83'],'fill-opacity':.18}},before);
   if(!map.getLayer(LAYERS[1]))map.addLayer({id:LAYERS[1],type:'line',source:SOURCE,filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':'#386e51','line-width':1.5,'line-opacity':.8}},before);
   if(!map.getLayer(LAYERS[2]))map.addLayer({id:LAYERS[2],type:'circle',source:SOURCE,filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#ad7443','circle-radius':5,'circle-stroke-color':'#fffdf2','circle-stroke-width':1.5}},before);
   shown={point:point.slice(),features:data.features.length,kinds:[...new Set(data.features.map(f=>f.properties.label))]};return shown;
  }
  return {show,clear,get selection(){return shown;},dispose(){disposed=true;clear();for(const id of LAYERS)if(map.getLayer(id))map.removeLayer(id);if(map.getSource(SOURCE))map.removeSource(SOURCE);}};
 }
 global.FireEyeSurfaceDetail={mount,collect};
})(typeof window==='undefined'?globalThis:window);
