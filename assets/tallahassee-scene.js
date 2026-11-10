/* Bounded, source-constrained schematic vegetation. No surveyed tree claims. */
(function(global){
 'use strict';
 const PILOT=[-84.45,30.30,-84.10,30.65],R=6378137,STEP=12;
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
 // Index source geometry so denser vegetation does not multiply polygon scans.
 function spatial(items,pad=0){
  const bins=new Map(),large=[],cell=100;
  for(const f of items){const a=project([f.b[0]-pad,f.b[1]-pad]),b=project([f.b[2]+pad,f.b[3]+pad]),x0=Math.floor(a[0]/cell),y0=Math.floor(a[1]/cell),x1=Math.floor(b[0]/cell),y1=Math.floor(b[1]/cell);
   if((x1-x0+1)*(y1-y0+1)>2500){large.push(f);continue;}
   for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=x+','+y;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(f);}
  }
  return p=>{const q=project(p);return [...large,...bins.get(Math.floor(q[0]/cell)+','+Math.floor(q[1]/cell))||[]];};
 }
 function sample(m,data,p){const t=m.grid.transform,col=Math.floor((p[0]-t[2])/t[0]),row=Math.floor((p[1]-t[5])/t[4]);return inBox(p,m.bbox_wgs84)&&row>=0&&col>=0&&row<m.grid.height&&col<m.grid.width?data[row*m.grid.width+col]:0;}
 // Stable, source-constrained local grass. Fine clumps near the viewer, sparse
 // clumps farther away; density is bounded independently of regional extent.
 function grassGrid(center,eligible,mobile=false){
  const q=project(center),scale=Math.cos(center[1]*Math.PI/180),band=Math.floor(center[1]/5)*5+2.5;
  const step=2/Math.max(.09,Math.cos(band*Math.PI/180)),radius=mobile?95:150,nearRadius=mobile?48:78,limit=mobile?4000:10000,candidates=[];
  for(let x=Math.floor((q[0]-radius/scale)/step);x<=Math.ceil((q[0]+radius/scale)/step);x++)for(let y=Math.floor((q[1]-radius/scale)/step);y<=Math.ceil((q[1]+radius/scale)/step);y++){
   const id='local-grass/'+band+'/'+x+'/'+y,h=hash(id),xy=[(x+.2+(h%1000)/1667)*step,(y+.2+((h>>>12)%1000)/1667)*step],d=Math.hypot(xy[0]-q[0],xy[1]-q[1])*scale;
   const t=Math.max(0,Math.min(1,(d-nearRadius)/(radius-nearRadius))),density=.14+.86*(1-t)*(1-t);
   if(d>radius||h/4294967296>density)continue;candidates.push({id,h,d,p:unproject(xy)});
  }
  candidates.sort((a,b)=>a.d-b.d);const points=[];
  for(const v of candidates){if(points.length>=limit)break;if(!eligible(v.p))continue;
   points.push({type:'Feature',geometry:{type:'Point',coordinates:v.p},properties:{kind:'grass',source_id:v.id,synthetic:true,display_height_m:.28+(v.h%23)/100,display_crown_m:1.8,source:'Mapped vegetated ground',placement:'Schematic ground cover; not surveyed plants'}});
  }return points;
 }
 function addGroundCover(collection,options={}){
  const lawns=collection.features.filter(f=>f.properties?.kind==='land_area'&&['grass','garden','meadow','grassland','recreation_ground'].includes(f.properties?.class)&&['Polygon','MultiPolygon'].includes(f.geometry?.type)).map(f=>({...f,b:bounds(f.geometry)}));
  if(!lawns.length)return collection;
  const blocked=collection.features.filter(f=>['building','water','pedestrian_area'].includes(f.properties?.kind)).map(f=>({...f,b:bounds(f.geometry)})),at=spatial(blocked),lawnAt=spatial(lawns);
  const roads=collection.features.filter(f=>f.properties?.kind==='transportation'&&['LineString','MultiLineString'].includes(f.geometry?.type)).map(f=>({...f,b:bounds(f.geometry)})),roadsAt=spatial(roads,.0005);
  const b=lawns[0].b,center=options.center||[(b[0]+b[2])/2,(b[1]+b[3])/2];
  const added=grassGrid(center,p=>lawnAt(p).some(f=>contains(f.geometry,p))&&!at(p).some(o=>contains(o.geometry,p))&&!roadsAt(p).some(o=>roadDistance(o.geometry,p)<(Number(o.properties.width_m)||4)/2+1),!!options.mobile);
  return {...collection,features:[...collection.features.filter(f=>f.properties?.kind!=='grass'),...added]};
 }
 function create(map,url,options={}){
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
     if(['building','water'].includes(kind)||['parking','sand','rock','ice'].includes(p.class))polygons.push(item);
     else if(kind==='transportation'&&p.brunnel!=='tunnel'&&p.brunnel!=='bridge'){item.gap=['motorway','trunk','primary','secondary'].includes(p.class)?12:['path','track'].includes(p.class)?3:6;roads.push(item);}
     else if(['wood','forest','grass','park','garden','recreation_ground','scrub'].includes(p.class))greens.push(item);
     if(['building','water'].includes(kind))features.push({type:'Feature',geometry,properties:{kind,source_id:'map/'+String(f.id??seen.size),class:p.class}});
    }
   }
   for(const f of options.extraFeatures?.()||[]){
    const geometry=f.geometry,b=bounds(geometry),p=f.properties;
    if(b[0]>box[2]||b[2]<box[0]||b[1]>box[3]||b[3]<box[1])continue;
    if(p.kind==='building'){polygons.push({geometry,b,kind:'building',properties:p});features.push(f);}
    else if(p.kind==='transportation')roads.push({geometry,b,kind:'transportation',properties:p,gap:p.width_m/2+1});
   }
   if(polygons.length>8000||roads.length>6000)throw Error('Local object budget');
   return {polygons,roads,greens,features,polygonsAt:spatial(polygons),roadsAt:spatial(roads,.0004),greensAt:spatial(greens)};
  }
  async function build(){
   await load();const c=map.getCenter().toArray();if(!inBox(c,PILOT)||map.getZoom()<15.5)return null;
   if(!map.getSource('openmaptiles')||!map.isSourceLoaded('openmaptiles'))throw Error('Street geometry loading');
   const key=[...c.map(x=>x.toFixed(5)),map.getZoom().toFixed(2),map.getPitch().toFixed(1),map.getBearing().toFixed(1),map.getCanvas().clientWidth].join('|');if(last?.key===key)return last.snapshot;
   const center=project(c),radius=(mobile?420:650)/Math.cos(c[1]*Math.PI/180),sw=unproject([center[0]-radius,center[1]-radius]),ne=unproject([center[0]+radius,center[1]+radius]),box=[sw[0],sw[1],ne[0],ne[1]],mask=masks(box),candidates=[];
   for(let x=Math.floor((center[0]-radius)/STEP);x<=Math.ceil((center[0]+radius)/STEP);x++)for(let y=Math.floor((center[1]-radius)/STEP);y<=Math.ceil((center[1]+radius)/STEP);y++){
    const id='tallahassee-cover/'+x+'/'+y,seed=hash(id),p=unproject([(x+.2+(seed%1000)/1667)*STEP,(y+.2+((seed>>>12)%1000)/1667)*STEP]);
    const cover=sample(manifest,data,p);if(!cover||cover===6||cover===7||cover===8)continue;
    const screen=map.project(p),canvas=map.getCanvas();if(screen.x< -70||screen.y< -100||screen.x>canvas.clientWidth+70||screen.y>canvas.clientHeight+100)continue;
    if(mask.polygonsAt(p).some(f=>near(p,f.b)&&contains(f.geometry,p))||mask.roadsAt(p).some(f=>near(p,f.b,.0004)&&roadDistance(f.geometry,p)<f.gap))continue;
    const greens=mask.greensAt(p).filter(f=>near(p,f.b)&&contains(f.geometry,p));
    const has=names=>greens.some(f=>names.includes(f.properties.class));
    // A broad park polygon must not erase forest mapped by the land-cover grid.
    const lawn=has(['grass','garden']),forest=has(['wood','forest'])||(cover===1&&!lawn),shrub=has(['scrub'])||(cover===2&&!lawn);
    const urban=has(['park','garden','recreation_ground']),grassy=lawn||cover===3;
    if(!forest&&!shrub&&!grassy&&!urban)continue;
    const chance=forest ? .96 : shrub ? .65 : urban ? .48 : 0,plant=seed%10000<chance*10000;
    candidates.push({id,p,forest,shrub,cover,plant,grass:grassy||forest&&seed%5===0,seed,
     d:(p[0]-c[0])**2*Math.cos(c[1]*Math.PI/180)**2+(p[1]-c[1])**2});
   }
   // Stable spatial sampling spans the visible view; a nearest-only cap made
   // the far half of a forest look bare on phones.
   const features=mask.features,limit=mobile?2200:5200;let trees=0,anchors=0,grass=0;
   candidates.sort((a,b)=>hash(a.id+'budget')-hash(b.id+'budget'));
   for(const v of candidates){
    if(v.plant&&trees<limit){
     features.push({type:'Feature',geometry:{type:'Point',coordinates:v.p},properties:{kind:'tree',source_id:v.id,synthetic:true,source:'LANDFIRE 2020 EVT + mapped greenspace and exclusions',class:manifest.classes[v.cover],height_m:null,
      display_height_m:v.shrub?3: v.forest?14+(v.seed%900)/100:8+(v.seed%500)/100,
      display_crown_m:v.shrub?4:v.forest?9+(v.seed%300)/100:6+(v.seed%200)/100,
      placement:'Schematic vegetation; not a measured tree location'}});trees++;
    }else if(!v.plant&&anchors<160){features.push({type:'Feature',geometry:{type:'Point',coordinates:v.p},properties:{kind:'scenario_anchor',source_id:v.id,synthetic:true,class:manifest.classes[v.cover]}});anchors++;}
   }
   const added=grassGrid(c,p=>{
    if(mask.polygonsAt(p).some(f=>contains(f.geometry,p))||mask.roadsAt(p).some(f=>roadDistance(f.geometry,p)<f.gap))return false;
    const cover=sample(manifest,data,p),greens=mask.greensAt(p).filter(f=>contains(f.geometry,p));
    return greens.some(f=>['grass','garden','meadow','recreation_ground'].includes(f.properties.class))||cover===3||cover===1&&hash(p.map(v=>v.toFixed(5)).join(','))%3===0;
   },mobile);features.push(...added);grass=added.length;
   const snapshot={area:{id:'tallahassee',title:'Tallahassee',bbox_wgs84:box,prediction_linked:true,synthetic_vegetation:true,source_edition:2020,feature_counts:{tree:trees,grass}},collection:{type:'FeatureCollection',features},metrics:{trees,anchors,grass,mask_features:mask.features.length,cover_bytes:manifest.asset.bytes,key}};
   last={key,snapshot};return snapshot;
  }
  return {contains:()=>inBox(map.getCenter().toArray(),PILOT),build,sample:p=>data?sample(manifest,data,p):null,get manifest(){return manifest;},invalidate:()=>{last=null;}};
 }
 global.FireEyeTallahassee={create,contains,inBox,roadDistance,sample,hash,boundsOf:bounds,spatial,grassGrid,addGroundCover,bounds:()=>PILOT.slice()};
})(typeof window==='undefined'?globalThis:window);
