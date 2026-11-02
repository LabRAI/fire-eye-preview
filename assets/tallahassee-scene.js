/* Bounded, source-constrained schematic vegetation. No surveyed tree claims. */
(function(global){
 'use strict';
 const PILOT=[-84.45,30.30,-84.10,30.65],R=6378137,STEP=20;
 const inBox=(p,b)=>p[0]>=b[0]&&p[0]<b[2]&&p[1]>=b[1]&&p[1]<b[3];
 const hash=s=>{let n=2166136261;for(const c of String(s))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
 const project=p=>[p[0]*Math.PI/180*R,Math.log(Math.tan(Math.PI/4+p[1]*Math.PI/360))*R];
 const unproject=p=>[p[0]/R*180/Math.PI,(2*Math.atan(Math.exp(p[1]/R))-Math.PI/2)*180/Math.PI];
 function ringContains(r,p){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
 function contains(g,p){return (g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[]).some(r=>ringContains(r[0],p)&&!r.slice(1).some(h=>ringContains(h,p)));}
 function bounds(g){let b=[Infinity,Infinity,-Infinity,-Infinity];const visit=a=>{if(typeof a[0]==='number'){b=[Math.min(b[0],a[0]),Math.min(b[1],a[1]),Math.max(b[2],a[0]),Math.max(b[3],a[1])];}else for(const v of a)visit(v);};visit(g.coordinates);return b;}
 const near=(p,b,pad=0)=>p[0]>=b[0]-pad&&p[0]<=b[2]+pad&&p[1]>=b[1]-pad&&p[1]<=b[3]+pad;
 function roadDistance(g,p){
  const scale=111320,cos=Math.cos(p[1]*Math.PI/180),lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];let best=Infinity;
  for(const l of lines)for(let i=1;i<l.length;i++){const a=[(l[i-1][0]-p[0])*scale*cos,(l[i-1][1]-p[1])*scale],b=[(l[i][0]-p[0])*scale*cos,(l[i][1]-p[1])*scale],dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/d)):0;best=Math.min(best,Math.hypot(a[0]+t*dx,a[1]+t*dy));}return best;
 }
 function sample(m,data,p){const t=m.grid.transform,col=Math.floor((p[0]-t[2])/t[0]),row=Math.floor((p[1]-t[5])/t[4]);return inBox(p,m.bbox_wgs84)&&row>=0&&col>=0&&row<m.grid.height&&col<m.grid.width?data[row*m.grid.width+col]:0;}
 function create(map,url){
  let manifest=null,data=null,task=null,last=null;const mobile=matchMedia('(max-width:640px)').matches;
  async function load(){
   if(data)return;if(task)return task;
   task=(async()=>{const u=new URL(url,document.baseURI);if(u.origin!==location.origin)throw Error('Local scene origin');const r=await fetch(u,{credentials:'omit',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Local cover unavailable');const m=await r.json(),g=m.grid,a=m.asset;
    if(m.kind!=='local-scene-cover'||m.id!=='tallahassee'||m.bbox_wgs84.join(',')!==PILOT.join(',')||g?.crs!=='EPSG:4326'||g.width!==1260||g.height!==1260||!Array.isArray(g.transform)||g.transform.length!==6||!g.transform.every(Number.isFinite)||g.transform[0]<=0||g.transform[4]>=0||g.transform[1]||g.transform[3]||a.path!=='cover.u8.gz'||a.bytes>1000000||a.bytes<1||a.uncompressed_bytes!==g.width*g.height||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('Invalid local cover');
    const response=await fetch(new URL(a.path,u),{credentials:'omit',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Local cover unavailable');const bytes=new Uint8Array(await response.arrayBuffer());
    const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');if(bytes.length!==a.bytes||sha!==a.sha256)throw Error('Local cover checksum');
    const unpacked=fflate.gunzipSync(bytes);if(unpacked.length!==a.uncompressed_bytes||unpacked.some(x=>x>8))throw Error('Local cover values');manifest=m;data=unpacked;
   })().catch(e=>{task=null;throw e;});return task;
  }
  function masks(box){
   const polygons=[],roads=[],greens=[],features=[],seen=new Set();
   for(const sourceLayer of ['building','water','transportation','landcover','landuse','park']){
    let rows=[];try{rows=map.querySourceFeatures('openmaptiles',{sourceLayer});}catch{}
    for(const f of rows){
     if(!f.geometry?.coordinates)continue;let geometry=f.geometry;if(geometry.type==='MultiPolygon'){const parts=geometry.coordinates.filter(r=>{const b=bounds({coordinates:r});return b[0]<=box[2]&&b[2]>=box[0]&&b[1]<=box[3]&&b[3]>=box[1];});if(!parts.length)continue;geometry={type:'MultiPolygon',coordinates:parts};}const b=bounds(geometry);if(b[0]>box[2]||b[2]<box[0]||b[1]>box[3]||b[3]<box[1])continue;
     const p=f.properties||{},key=sourceLayer+'|'+(f.id??'')+'|'+JSON.stringify(geometry.coordinates);if(seen.has(key))continue;seen.add(key);
     const kind=sourceLayer==='building'?'building':sourceLayer==='water'?'water':sourceLayer==='transportation'?'transportation':'land_area';
     const item={geometry,b,kind,properties:p};
     if(['building','water'].includes(kind))polygons.push(item);
     else if(kind==='transportation'&&p.brunnel!=='tunnel'&&p.brunnel!=='bridge'){item.gap=['motorway','trunk','primary','secondary'].includes(p.class)?12:['path','track'].includes(p.class)?3:6;roads.push(item);}
     else if(['wood','forest','grass','park','garden','recreation_ground','scrub'].includes(p.class))greens.push(item);
     if(['building','water'].includes(kind))features.push({type:'Feature',geometry,properties:{kind,source_id:'map/'+String(f.id??seen.size),class:p.class}});
    }
   }
   if(polygons.length>5000||roads.length>4000)throw Error('Local object budget');
   return {polygons,roads,greens,features};
  }
  async function build(){
   await load();const c=map.getCenter().toArray();if(!inBox(c,PILOT)||map.getZoom()<15.5)return null;
   if(!map.getSource('openmaptiles')||!map.isSourceLoaded('openmaptiles'))throw Error('Street geometry loading');
   const key=[...c.map(x=>x.toFixed(5)),map.getZoom().toFixed(2),map.getPitch().toFixed(1),map.getBearing().toFixed(1),map.getCanvas().clientWidth].join('|');if(last?.key===key)return last.snapshot;
   const center=project(c),radius=(mobile?420:650)/Math.cos(c[1]*Math.PI/180),sw=unproject([center[0]-radius,center[1]-radius]),ne=unproject([center[0]+radius,center[1]+radius]),box=[sw[0],sw[1],ne[0],ne[1]],mask=masks(box),candidates=[];
   for(let x=Math.floor((center[0]-radius)/STEP);x<=Math.ceil((center[0]+radius)/STEP);x++)for(let y=Math.floor((center[1]-radius)/STEP);y<=Math.ceil((center[1]+radius)/STEP);y++){
    const id='tallahassee-cover/'+x+'/'+y,seed=hash(id),p=unproject([(x+.2+(seed%1000)/1667)*STEP,(y+.2+((seed>>>12)%1000)/1667)*STEP]);
    const cover=sample(manifest,data,p);if(!cover||cover===6||cover===7||cover===8)continue;
    if(mask.polygons.some(f=>near(p,f.b)&&contains(f.geometry,p))||mask.roads.some(f=>near(p,f.b,.0002)&&roadDistance(f.geometry,p)<f.gap))continue;
    const local=mask.greens.find(f=>near(p,f.b)&&contains(f.geometry,p)),forest=local?['wood','forest'].includes(local.properties.class):cover===1,shrub=local?local.properties.class==='scrub':cover===2;
    const vegetated=forest||shrub||cover===3||['grass','garden','park','recreation_ground'].includes(local?.properties.class);if(!vegetated)continue;
    if(forest&&seed%100>=60||shrub&&seed%100>=25)continue;
    candidates.push({id,p,forest,shrub,cover,d:(p[0]-c[0])**2*Math.cos(c[1]*Math.PI/180)**2+(p[1]-c[1])**2,seed});
   }
   candidates.sort((a,b)=>a.d-b.d||a.id.localeCompare(b.id));const features=mask.features,limit=mobile?320:900;let trees=0,anchors=0;
   for(const v of candidates){const plant=v.forest||v.shrub;if(plant?trees>=limit:anchors>=80)continue;
    features.push({type:'Feature',geometry:{type:'Point',coordinates:v.p},properties:{kind:plant?'tree':'scenario_anchor',source_id:v.id,synthetic:true,source:'LANDFIRE 2020 EVT + mapped exclusions',class:manifest.classes[v.cover],height_m:null,display_height_m:v.shrub?2.5:7+(v.seed%500)/100,display_crown_m:v.shrub?2.2:4.8,placement:'Schematic vegetation; not a measured tree location'}});if(plant)trees++;else anchors++;
   }
   const snapshot={area:{id:'tallahassee',title:'Tallahassee',bbox_wgs84:box,prediction_linked:true,synthetic_vegetation:true,source_edition:2020,feature_counts:{tree:trees}},collection:{type:'FeatureCollection',features},metrics:{trees,anchors,mask_features:mask.features.length,cover_bytes:manifest.asset.bytes,key}};
   last={key,snapshot};return snapshot;
  }
  return {contains:()=>inBox(map.getCenter().toArray(),PILOT),build,sample:p=>data?sample(manifest,data,p):null,get manifest(){return manifest;},invalidate:()=>{last=null;}};
 }
 global.FireEyeTallahassee={create,contains,inBox,roadDistance,sample,hash,bounds:()=>PILOT.slice()};
})(typeof window==='undefined'?globalThis:window);
