/* Local schematic vegetation, generated only after explicit simulation intent. */
'use strict';
importScripts('tallahassee-scene.js?v=e7350c12496318f1');
const H=FireEyeTallahassee,R=6378137;
const project=p=>[p[0]*Math.PI/180*R,Math.log(Math.tan(Math.PI/4+p[1]*Math.PI/360))*R];
const unproject=p=>[p[0]/R*180/Math.PI,(2*Math.atan(Math.exp(p[1]/R))-Math.PI/2)*180/Math.PI];
function generate({center,features,mobile,coverContext},sampleCover=()=>null){
 if(!Array.isArray(center)||center.length!==2||!center.every(Number.isFinite)||Math.abs(center[1])>85||!Array.isArray(features)||features.length>18000)throw Error('Invalid local scene');
 const scale=Math.cos(center[1]*Math.PI/180),q=project(center),radius=650/scale;
 const sw=unproject([q[0]-radius,q[1]-radius]),ne=unproject([q[0]+radius,q[1]+radius]),box=[...sw,...ne];
 const polygons=[],roads=[],cover=[],objects=[];let vertices=0,contextTrees=0,contextGrass=0;
 for(const f of features){
  if(!f.geometry?.coordinates||!f.properties)continue;
  const scan=a=>{if(typeof a[0]==='number'){if(!a.slice(0,2).every(Number.isFinite))throw Error('Invalid mapped coordinate');vertices++;}else for(const p of a)scan(p);};scan(f.geometry.coordinates);if(vertices>400000)throw Error('Local geometry budget');
  const item={...f,b:H.boundsOf(f.geometry)},p=f.properties,c=p.class,kind=p.kind;
  if(item.b[0]>box[2]||item.b[2]<box[0]||item.b[1]>box[3]||item.b[3]<box[1])continue;
  if(['building','water','pedestrian_area'].includes(kind)||['parking','cemetery','sand','rock','bare_rock','bare_ground','barren','beach','scree','shingle','mud','quarry','ice','glacier'].includes(c)){polygons.push(item);objects.push(f);}
  else if(kind==='transportation'){if(!p.below_ground){roads.push(item);objects.push(f);}}
  else if(kind==='land_area'){
   // Park boundaries alone include deserts and forests. Use classified cover;
   // only explicit urban landuse=park gets a schematic mixed-park treatment.
   item.cover=['wood','forest','orchard'].includes(c)?'forest':['scrub','shrub','heath'].includes(c)?'shrub':['grass','meadow','grassland','garden','recreation_ground','village_green'].includes(c)?'grass':['farmland','farm','agriculture'].includes(c)?'agriculture':c==='park'&&p.source_layer==='landuse'?'park':null;
   // Explicit local surfaces, including nonvegetated/unknown landuse, suppress
   // the coarse fallback. Administrative park boundaries alone do not.
   if(item.cover||(c&&p.source_layer!=='park'&&!['national_park','nature_reserve','protected_area','boundary'].includes(c))){cover.push(item);objects.push(f);}
  }
 }
 const blockedAt=H.spatial(polygons),roadsAt=H.spatial(roads,.0005/scale),coverAt=H.spatial(cover);
 const eligible=p=>!blockedAt(p).some(f=>H.contains(f.geometry,p))&&!roadsAt(p).some(f=>H.contains(f.geometry,p)||H.roadDistance(f.geometry,p)<(Number(f.properties.width_m)||12)/2+1);
 const vegetationAt=p=>{
  const local=coverAt(p).filter(f=>H.contains(f.geometry,p));
  if(local.length)return {classes:local.map(f=>f.cover),sample:null};
  const sample=sampleCover(p),classification=sample?.classification;
  const type=classification==='forest_woodland'?'forest':classification==='shrubland'?'shrub':classification==='grass_herbaceous'?'grass':null;
  return {classes:type?[type]:[],sample};
 };
 const grassy=(v,p)=>v.classes.includes('grass')||v.classes.includes('park')||v.classes.includes('forest')&&H.grassCluster(p);
 const contextProps=sample=>sample?{source:'Published CONUS 3 km cover composition',source_cell_id:sample.cell_id,source_edition:coverContext?.source_edition,source_resolution_m:3000,placement:'Schematic clusters from historical 3 km cover fractions; not exact plants, tree density, or current conditions.'}:{};
 const candidates=[];
 // Latitude bands belong to the locations, not the selected center. Enumerate
 // both at a band edge so panning cannot move the same source ID.
 for(let band=Math.floor(box[1]/5)*5;band<=Math.floor(box[3]/5)*5;band+=5){
 const step=9/Math.max(.09,Math.cos((band+2.5)*Math.PI/180)),y0=project([0,Math.max(box[1],band)])[1],y1=project([0,Math.min(box[3],band+5)])[1];
 for(let x=Math.floor((q[0]-radius)/step);x<=Math.ceil((q[0]+radius)/step);x++)for(let y=Math.floor(y0/step);y<=Math.ceil(y1/step);y++){
  const id='mapped-cover/'+band+'/'+x+'/'+y,seed=H.hash(id),p=unproject([(x+.2+(seed%1000)/1667)*step,(y+.2+((seed>>>12)%1000)/1667)*step]);
  if(p[0]<box[0]||p[0]>box[2]||p[1]<box[1]||p[1]>box[3]||Math.floor(p[1]/5)*5!==band||!eligible(p))continue;
  const v=vegetationAt(p),classes=v.classes;if(!classes.length)continue;
  const lawn=classes.includes('grass'),forest=!lawn&&classes.includes('forest'),shrub=!lawn&&!forest&&classes.includes('shrub'),park=!lawn&&!forest&&!shrub&&classes.includes('park');
  const tree=seed%10000<(forest?.96:shrub?.65:park?.38:0)*10000;
  candidates.push({id,seed,p,tree,forest,shrub,grass:grassy(v,p),sample:v.sample,d:Math.hypot(...project(p).map((v,i)=>v-q[i]))*scale});
 }}
 candidates.sort((a,b)=>H.hash(a.id+'/budget')-H.hash(b.id+'/budget'));
 let trees=0,grass=0,anchors=0;const treeLimit=mobile?2200:5200;
 const point=(kind,id,p,props)=>({type:'Feature',geometry:{type:'Point',coordinates:p},properties:{kind,source_id:id,synthetic:true,source:'OpenStreetMap mapped land cover',placement:'Schematic vegetation; not surveyed plant locations',...props}});
 for(const v of candidates){
  if(v.tree&&trees<treeLimit){objects.push(point('tree',v.id,v.p,{height_m:null,class:v.forest?'forest':v.shrub?'shrub':'park',display_height_m:v.shrub?3:v.forest?14+(v.seed%900)/100:8+(v.seed%500)/100,display_crown_m:v.shrub?4:v.forest?9+(v.seed%300)/100:6+(v.seed%200)/100,...contextProps(v.sample)}));trees++;if(v.sample)contextTrees++;}
  else if(!v.tree&&anchors<160){objects.push(point('scenario_anchor',v.id,v.p,contextProps(v.sample)));anchors++;}
 }
 const grassEligible=p=>eligible(p)&&grassy(vegetationAt(p),p);
 const grassFeatures=H.grassGrid(center,grassEligible,mobile,H.grassMask(grassEligible,{surfaces:cover,blocked:polygons,roads}));
 for(const f of grassFeatures){const sample=vegetationAt(f.geometry.coordinates).sample;if(sample){Object.assign(f.properties,contextProps(sample));contextGrass++;}}
 objects.push(...grassFeatures);grass=grassFeatures.length;
 return {area:{id:'on-demand',title:'Selected area',bbox_wgs84:box,prediction_linked:true,synthetic_vegetation:true,vegetation_source:contextTrees||contextGrass?'Mapped local cover + published CONUS 3 km composition':'OpenStreetMap mapped land cover',vegetation_context_status:coverContext?.status||'not_requested',vegetation_context_note:coverContext?.note||null,vegetation_context_partial:!!coverContext?.partial,source_edition:coverContext?.source_edition,feature_counts:{tree:trees,grass}},collection:{type:'FeatureCollection',features:objects},metrics:{trees,grass,anchors,cover_polygons:cover.length,source_features:features.length,context_trees:contextTrees,context_grass:contextGrass,context_cells:coverContext?.cells?.length||0,generated_on_device:true}};
}
self.onmessage=e=>{
 const req=e.data,send=sample=>{try{self.postMessage({id:req.id,snapshot:generate(req,sample)});}catch{self.postMessage({id:req.id,error:'Mapped vegetation could not be prepared for this view.'});}};
 // Preserve the synchronous OSM-only path used by existing generation callers.
 if(req.coverContext?.status!=='ok'){send();return;}
 import('./scene-cover.mjs?v=26fc19104245d70e').then(module=>send(module.createCoverSampler(req.coverContext))).catch(()=>{req.coverContext={status:'unavailable',cells:[]};send();});
};
