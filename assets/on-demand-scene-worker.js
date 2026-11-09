/* Local schematic vegetation, generated only after explicit simulation intent. */
'use strict';
importScripts('tallahassee-scene.js?v=1dfe8d1325a4fe4e');
const H=FireEyeTallahassee,R=6378137,STEP=12;
const project=p=>[p[0]*Math.PI/180*R,Math.log(Math.tan(Math.PI/4+p[1]*Math.PI/360))*R];
const unproject=p=>[p[0]/R*180/Math.PI,(2*Math.atan(Math.exp(p[1]/R))-Math.PI/2)*180/Math.PI];
function generate({center,features,mobile}){
 if(!Array.isArray(center)||center.length!==2||!center.every(Number.isFinite)||Math.abs(center[1])>60||!Array.isArray(features)||features.length>18000)throw Error('Invalid local scene');
 const scale=Math.cos(center[1]*Math.PI/180),q=project(center),radius=(mobile?420:650)/scale;
 const sw=unproject([q[0]-radius,q[1]-radius]),ne=unproject([q[0]+radius,q[1]+radius]),box=[...sw,...ne];
 const polygons=[],roads=[],cover=[],objects=[];let vertices=0;
 for(const f of features){
  if(!f.geometry?.coordinates||!f.properties)continue;
  const scan=a=>{if(typeof a[0]==='number'){if(!a.slice(0,2).every(Number.isFinite))throw Error('Invalid mapped coordinate');vertices++;}else for(const p of a)scan(p);};scan(f.geometry.coordinates);if(vertices>400000)throw Error('Local geometry budget');
  const item={...f,b:H.boundsOf(f.geometry)},p=f.properties,c=p.class,kind=p.kind;
  if(item.b[0]>box[2]||item.b[2]<box[0]||item.b[1]>box[3]||item.b[3]<box[1])continue;
  if(['building','water','pedestrian_area'].includes(kind)||['parking','cemetery','sand','rock','bare_rock','ice','glacier'].includes(c)){polygons.push(item);objects.push(f);}
  else if(kind==='transportation'){if(!p.below_ground){roads.push(item);objects.push(f);}}
  else if(kind==='land_area'){
   // Park boundaries alone include deserts and forests. Use classified cover;
   // only explicit urban landuse=park gets a schematic mixed-park treatment.
   item.cover=['wood','forest','orchard'].includes(c)?'forest':['scrub','shrub','heath'].includes(c)?'shrub':['grass','meadow','grassland','garden','recreation_ground','village_green'].includes(c)?'grass':['farmland','farm','agriculture'].includes(c)?'agriculture':c==='park'&&p.source_layer==='landuse'?'park':null;
   if(item.cover){cover.push(item);objects.push(f);}
  }
 }
 const blockedAt=H.spatial(polygons),roadsAt=H.spatial(roads,.0005),coverAt=H.spatial(cover);
 const eligible=p=>!blockedAt(p).some(f=>H.contains(f.geometry,p))&&!roadsAt(p).some(f=>H.roadDistance(f.geometry,p)<f.properties.width_m/2+1);
 const candidates=[];
 for(let x=Math.floor((q[0]-radius)/STEP);x<=Math.ceil((q[0]+radius)/STEP);x++)for(let y=Math.floor((q[1]-radius)/STEP);y<=Math.ceil((q[1]+radius)/STEP);y++){
  const id='mapped-cover/'+x+'/'+y,seed=H.hash(id),p=unproject([(x+.2+(seed%1000)/1667)*STEP,(y+.2+((seed>>>12)%1000)/1667)*STEP]);
  const classes=coverAt(p).filter(f=>H.contains(f.geometry,p)).map(f=>f.cover);if(!classes.length||!eligible(p))continue;
  const lawn=classes.includes('grass'),forest=!lawn&&classes.includes('forest'),shrub=!lawn&&!forest&&classes.includes('shrub'),park=!lawn&&!forest&&!shrub&&classes.includes('park');
  const tree=seed%10000<(forest?.96:shrub?.65:park?.38:0)*10000;
  candidates.push({id,seed,p,tree,forest,shrub,grass:lawn||park||forest&&seed%5===0,d:Math.hypot(...project(p).map((v,i)=>v-q[i]))*scale});
 }
 candidates.sort((a,b)=>H.hash(a.id+'/budget')-H.hash(b.id+'/budget'));
 let trees=0,grass=0,anchors=0;const treeLimit=mobile?2200:5200,grassLimit=mobile?1200:3000;
 const point=(kind,id,p,props)=>({type:'Feature',geometry:{type:'Point',coordinates:p},properties:{kind,source_id:id,synthetic:true,source:'OpenStreetMap mapped land cover',placement:'Schematic vegetation; not surveyed plant locations',...props}});
 for(const v of candidates){
  if(v.tree&&trees<treeLimit){objects.push(point('tree',v.id,v.p,{height_m:null,class:v.forest?'forest':v.shrub?'shrub':'park',display_height_m:v.shrub?3:v.forest?14+(v.seed%900)/100:8+(v.seed%500)/100,display_crown_m:v.shrub?4:v.forest?9+(v.seed%300)/100:6+(v.seed%200)/100}));trees++;}
  else if(!v.tree&&anchors<160){objects.push(point('scenario_anchor',v.id,v.p,{}));anchors++;}
 }
 for(const v of candidates.filter(v=>v.grass&&v.d<220).sort((a,b)=>a.d-b.d)){
  if(grass>=grassLimit)break;const origin=project(v.p);
  for(let j=0;j<4&&grass<grassLimit;j++){const id=v.id+'/grass/'+j,h=H.hash(id),p=unproject([origin[0]+((h%100)/100-.5)*7,origin[1]+(((h>>>8)%100)/100-.5)*7]);
   if(!eligible(p)||!coverAt(p).some(f=>['grass','forest','park'].includes(f.cover)&&H.contains(f.geometry,p)))continue;
   objects.push(point('grass',id,p,{display_height_m:.35+(h%25)/100,display_crown_m:1.2}));grass++;
  }
 }
 return {area:{id:'on-demand',title:'Selected area',bbox_wgs84:box,prediction_linked:true,synthetic_vegetation:true,vegetation_source:'OpenStreetMap mapped land cover',feature_counts:{tree:trees,grass}},collection:{type:'FeatureCollection',features:objects},metrics:{trees,grass,anchors,cover_polygons:cover.length,source_features:features.length,generated_on_device:true}};
}
self.onmessage=e=>{try{self.postMessage({id:e.data.id,snapshot:generate(e.data)});}catch{self.postMessage({id:e.data.id,error:'Mapped vegetation could not be prepared for this view.'});}};
