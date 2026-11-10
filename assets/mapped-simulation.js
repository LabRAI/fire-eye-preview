/* Same-canvas scene adapter. Original meshes: llll0630/wildfire-simulation,
   revision 08133000efa914b6e77f0cc7c33308fc4e3f65f4. Fire/smoke effects adapt
   Fire-eye's existing simulation viewer. This is an illustrative scenario. */
(function(global){
 'use strict';
 const ID='mapped-simulation-live';
 const START=17,END=17.8;
 const smooth=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
 const hash=s=>{let n=2166136261;for(const c of String(s))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
 function random(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
 function ringContains(r,p){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
 function contains(g,p){const parts=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];return parts.some(r=>ringContains(r[0],p)&&!r.slice(1).some(h=>ringContains(h,p)));}
 // Local east/up/south metres -> Mercator -> the existing map camera.
 function cameraMatrix(matrix,origin,scale){const result=new Float32Array(16);for(let row=0;row<4;row++){result[row]=matrix[row]*scale;result[4+row]=matrix[8+row]*scale;result[8+row]=matrix[4+row]*scale;result[12+row]=matrix[row]*origin.x+matrix[4+row]*origin.y+matrix[8+row]*origin.z+matrix[12+row];}return result;}
 const meshVertex='precision highp float; attribute vec3 position; attribute vec3 normal; attribute vec3 color; attribute vec2 uv; attribute vec3 offset; attribute vec2 size; attribute vec2 rotation; uniform mat4 matrix; varying mediump vec3 shade; varying mediump vec2 texCoord; void main(){vec3 p=position*vec3(size.x,size.y,size.x);p.xz=mat2(rotation.y,rotation.x,-rotation.x,rotation.y)*p.xz;vec3 n=normal/vec3(size.x,size.y,size.x);n.xz=mat2(rotation.y,rotation.x,-rotation.x,rotation.y)*n.xz;float light=0.57+0.43*max(0.0,dot(normalize(n),normalize(vec3(-0.4,0.85,0.3))));shade=max(color*light,vec3(0.0));texCoord=uv;gl_Position=matrix*vec4(p+offset,1.0);}';
 const meshFragment='precision mediump float; varying mediump vec3 shade; varying mediump vec2 texCoord; uniform sampler2D materialMap; uniform float opacity; uniform float alphaTest; uniform float materialOpacity; void main(){vec4 tex=texture2D(materialMap,texCoord);if(tex.a*materialOpacity<alphaTest)discard;vec3 c=pow(max(shade*pow(tex.rgb,vec3(2.2)),vec3(0.0)),vec3(0.454545));float a=opacity*materialOpacity;gl_FragColor=vec4(c*a,a);}';
 const particleVertex='precision highp float; attribute vec3 position; attribute float seed; uniform mat4 matrix; uniform vec2 viewport; uniform float time; uniform float rise; uniform mediump float smoke; uniform float size; varying mediump float life; void main(){life=fract(seed+time*(smoke>0.5?0.085:0.42));vec3 p=position;p.y+=life*rise;p.x+=sin(seed*30.0+time*0.8)*life*(smoke>0.5?8.0:0.4);p.z+=cos(seed*24.0+time*0.5)*life*(smoke>0.5?6.0:0.4);vec4 clip=matrix*vec4(p,1.0);vec4 side=matrix*vec4(p+vec3(size,0.0,0.0),1.0);vec4 other=matrix*vec4(p+vec3(0.0,0.0,size),1.0);float pixels=max(length((side.xy/side.w-clip.xy/clip.w)*viewport*0.5),length((other.xy/other.w-clip.xy/clip.w)*viewport*0.5));gl_Position=clip;gl_PointSize=clamp(pixels*(smoke>0.5?0.4+life:1.0-life*0.65),1.0,160.0);}';
 const particleFragment='precision mediump float; uniform mediump float smoke; uniform float opacity; varying mediump float life; void main(){vec2 p=gl_PointCoord-0.5;float d=length(p*vec2(1.0,smoke>0.5?1.0:0.75));float soft=1.0-smoothstep(0.12,0.5,d);float alpha=soft*sin(life*3.14159)*opacity;if(smoke>0.5){alpha*=0.075;gl_FragColor=vec4(vec3(0.38,0.35,0.31)*alpha,alpha);}else{alpha*=0.9;vec3 c=mix(vec3(1.0,0.75,0.16),vec3(0.95,0.15,0.01),life);gl_FragColor=vec4(c*alpha,alpha);}}';
 function program(gl,vertex,fragment,attributes,uniforms){
  const shaders=[];let p=null;
  try{for(const [type,code] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('Scene shader unavailable');}p=gl.createProgram();shaders.forEach(s=>gl.attachShader(p,s));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Scene program unavailable');return {id:p,a:Object.fromEntries(attributes.map(n=>[n,gl.getAttribLocation(p,n)])),u:Object.fromEntries(uniforms.map(n=>[n,gl.getUniformLocation(p,n)]))};}
  catch(e){if(p)gl.deleteProgram(p);throw e;}finally{shaders.forEach(s=>gl.deleteShader(s));}
 }
 function mount(map,options={}){
  const C={phase:'mapped',alpha:0,treeCount:0,renderedTrees:0,grassCount:0,detailTrees:0,canopyTrees:0,frames:0,elapsed:0,paused:matchMedia('(prefers-reduced-motion: reduce)').matches,fireEnabled:true,ignition:null,forecastRequired:false,forecast:null,fireEmphasis:1,candidates:[],candidateKey:"",emitters:[],sampledCount:0,validCount:0,particleBudget:(navigator.hardwareConcurrency||4)<=4?1200:3000,quality:(navigator.hardwareConcurrency||4)<=4?"balanced":"high",frameMs:0,performanceSamples:0,assetBytes:0,error:null};
  let disposed=false,area=null,collection=null,assets=null,assetTask=null,controller=new AbortController(),layer=null,gpu=null,origin=null,metres=1,groups=[],fireGroups=[],timer=null,last=null,cooldown=0,lastState='',replacement=-1,installing=false,ignitionAttempted=false,ignitionView=null,sceneMatrix=null,siteVisible=null,sightView=null;
  const qualityLoader=global.FireEyeSceneQuality.createLoader(options.manifestURL);let assetController=null,assetSequence=0;
  C.assetQuality=global.FireEyeSceneQuality.preferred();C.loadedQuality=null;C.qualityLoading=false;C.qualityError=false;
  const merc=p=>global.maplibregl.MercatorCoordinate.fromLngLat(p,0);
  const height=p=>{const value=options.height?.(p);return Number.isFinite(value)?value:0;};
  const local=p=>{const q=merc(p);return [(q.x-origin.x)/metres,height(p),(q.y-origin.y)/metres];};
  function terrainMatrix(matrix){
   // MapLibre 2.4 forms customLayerMatrix before its terrain camera translation.
   // Apply that missing translation once; future renderer matrices must not be
   // shifted again. Geographic coordinates and all prediction values stay intact.
   if(!global.maplibregl.version.startsWith('2.4.')||!map.getTerrain())return matrix;
   const offset=map.transform.elevation*merc(map.getCenter().toArray()).meterInMercatorCoordinateUnits();
   const adjusted=new Float64Array(matrix);for(let r=0;r<4;r++)adjusted[12+r]-=matrix[8+r]*offset;return adjusted;
  }
  function groundScreen(p){
   if(!sceneMatrix)return null;const q=merc(p),z=height(p)*q.meterInMercatorCoordinateUnits(),m=sceneMatrix,
    w=m[3]*q.x+m[7]*q.y+m[11]*z+m[15];if(w<=0)return null;
   return [((m[0]*q.x+m[4]*q.y+m[8]*z+m[12])/w+1)*map.getCanvas().clientWidth/2,
     (1-(m[1]*q.x+m[5]*q.y+m[9]*z+m[13])/w)*map.getCanvas().clientHeight/2];
  }
  const fade=()=>smooth((map.getZoom()-START)/(END-START));
  const canIgnite=()=>map.getZoom()>=END&&!map.isMoving()&&map.getSource('openmaptiles')&&(map.isSourceLoaded('openmaptiles')||map.queryRenderedFeatures({layers:['mapped-scene-buildings']}).length>0)&&ignitionView!==viewKey();
  const viewKey=()=>map.getCenter().toArray().join(',')+'|'+map.getZoom()+'|'+map.getBearing()+'|'+map.getPitch();
  const setReplacement=value=>{if(Math.abs(value-replacement)>.002){replacement=value;options.onReplacement?.(value);}};
  function notify(){const state=[C.phase,C.paused,C.fireEnabled,C.treeCount,C.ignition?.source_id,C.forecastRequired,C.forecast?.key,C.forecast?.status,C.forecast?.risk,C.forecast?.resolution,C.candidateKey,C.emitters.length,C.error,C.assetQuality,C.loadedQuality,C.qualityLoading,C.qualityError].join('|');if(state!==lastState){lastState=state;options.onChange?.({...C});}}
  function clearTimer(){clearTimeout(timer);timer=null;}
  function fail(){clearTimer();C.error='Scene detail is unavailable';C.phase='fallback';C.alpha=0;cooldown=Date.now()+30000;setReplacement(0);notify();}
  async function loadAssets(){
   if(assets&&C.loadedQuality===C.assetQuality)return assets;if(assetTask)return assetTask;
   const tier=C.assetQuality,seq=++assetSequence;assetController?.abort();assetController=new AbortController();C.qualityLoading=true;C.qualityError=false;notify();
   assetTask=(async()=>{
    const signal=AbortSignal.any([controller.signal,assetController.signal,AbortSignal.timeout(20000)]),meshes=await qualityLoader.load(tier,signal);
    if(disposed||seq!==assetSequence)return null;const gl=gpu?.gl;release();assets=meshes;C.loadedQuality=tier;C.assetBytes=meshes.reduce((n,m)=>n+m.bytes,0);C.error=null;rebuild();if(gl)initialize(gl);install();update();return meshes;
   })().catch(()=>{if(!disposed&&seq===assetSequence){C.qualityError=true;cooldown=Date.now()+30000;if(!assets)fail();}return null;}).finally(()=>{if(seq===assetSequence){assetTask=null;C.qualityLoading=false;notify();}});return assetTask;
  }
  function setQuality(value){if(!global.FireEyeSceneQuality.tiers.includes(value))return Promise.resolve(null);global.FireEyeSceneQuality.remember(value);C.assetQuality=value;C.qualityError=false;assetSequence++;assetController?.abort();assetTask=null;cooldown=0;notify();if(area&&map.getZoom()>=15.5)return loadAssets();return Promise.resolve(null);}
  function visibleMapLayout(){
   const canvas=map.getCanvas(),bounds=canvas.getBoundingClientRect(),width=canvas.clientWidth,height=canvas.clientHeight,obstacles=[];
   // Read layout only when placing/finding the scenario, never per frame.
   for(const element of options.occlusionElements?.()||[]){
    if(!element.getClientRects().length)continue;const style=getComputedStyle(element);if(style.visibility==='hidden'||Number(style.opacity)===0)continue;
    const r=element.getBoundingClientRect(),b=[Math.max(0,r.left-bounds.left),Math.max(0,r.top-bounds.top),Math.min(width,r.right-bounds.left),Math.min(height,r.bottom-bounds.top)];
    if(b[0]<b[2]&&b[1]<b[3])obstacles.push(b);
   }
   const clear=b=>b[0]>=16&&b[1]>=16&&b[2]<=width-16&&b[3]<=height-16&&!obstacles.some(r=>b[0]<r[2]+12&&b[2]>r[0]-12&&b[1]<r[3]+12&&b[3]>r[1]-12);
   let target=[width/2,height*.45],best=Infinity;
   for(let x=1;x<20;x++)for(let y=1;y<20;y++){const p=[width*x/20,height*y/20];if(!clear([p[0]-32,p[1]-55,p[0]+32,p[1]+16]))continue;const score=(p[0]-width/2)**2+(p[1]-height*.45)**2;if(score<best){best=score;target=p;}}
   return {width,height,clear,target};
  }
  function visibleFireCount(){if(!sceneMatrix||!C.emitters.length)return 0;if(sightView!==viewKey())chooseIgnition(collection.features.filter(f=>f.properties?.kind==='tree'&&f.geometry?.type==='Point'));return C.emitters.filter(e=>siteVisible?.(e.lnglat)).length;}
  function focusFire(){
   const clear=C.emitters.filter(e=>siteVisible?.(e.lnglat,false)),pool=clear.length?clear:C.emitters;
   const focus=C.forecastRequired?pool.slice().sort((a,b)=>{const center=map.getCenter();return (a.lnglat[0]-center.lng)**2+(a.lnglat[1]-center.lat)**2-((b.lnglat[0]-center.lng)**2+(b.lnglat[1]-center.lat)**2);})[0]:C.ignition;if(!focus)return false;
   const {width,height,target}=visibleMapLayout();C.fireEnabled=true;notify();
   map.easeTo({center:focus.lnglat,zoom:Math.max(END,map.getZoom()),pitch:48,offset:[target[0]-width/2,target[1]-height/2],duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:600});return true;
  }
  function chooseIgnition(trees){
   if(!collection||!origin)return null;const blocked=collection.features.filter(f=>['building','water'].includes(f.properties?.kind));
   const eligible=p=>!blocked.some(f=>contains(f.geometry,p));
   // Vector tiles merge separate buildings into MultiPolygons. Their query
   // bounding boxes overestimate occlusion; test the actual projected faces.
   const canvas=map.getCanvas(),faces=[],project=(p,h)=>{const q=merc(p),z=(h+height(p))*q.meterInMercatorCoordinateUnits(),m=sceneMatrix,w=m[3]*q.x+m[7]*q.y+m[11]*z+m[15];if(w<=0)return null;return [((m[0]*q.x+m[4]*q.y+m[8]*z+m[12])/w+1)*canvas.clientWidth/2,(1-(m[1]*q.x+m[5]*q.y+m[9]*z+m[13])/w)*canvas.clientHeight/2];};
   const face=rings=>{if(rings.some(r=>r.some(p=>!p)))return;const xs=rings[0].map(p=>p[0]),ys=rings[0].map(p=>p[1]),b=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];if(b[2]>=0&&b[0]<=canvas.clientWidth&&b[3]>=0&&b[1]<=canvas.clientHeight)faces.push({rings,b});};
   for(const f of map.queryRenderedFeatures({layers:['mapped-scene-buildings','scene-environment-buildings'].filter(id=>map.getLayer(id))})){
    const h=Number(f.properties.height_m??f.properties.render_height)||0,base=Number(f.properties.render_min_height)||0;if(h<=base)continue;
    for(const rings of f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[]){
     const top=rings.map(r=>r.map(p=>project(p,h))),bottom=rings.map(r=>r.map(p=>project(p,base)));face(top);
     for(let j=0;j<rings.length;j++)for(let i=1;i<rings[j].length;i++)face([[bottom[j][i-1],bottom[j][i],top[j][i],top[j][i-1]]]);
    }
   }
   const layout=visibleMapLayout();
   // The whole flame needs clearance from HTML panels, not only its ground
   // point. Reserve room for the scenario notice when it becomes visible.
   const visible=(p,avoidUI=true)=>{const q=project(p,.2),top=project(p,18);if(!q||q[0]<32||q[1]<32||q[0]>canvas.clientWidth-32||q[1]>canvas.clientHeight-32)return false;if(avoidUI&&(!top||!layout.clear([Math.min(q[0],top[0])-28,Math.min(q[1],top[1])-28,Math.max(q[0],top[0])+28,Math.max(q[1],top[1])+16])))return false;return !faces.some(({rings,b})=>q[0]>=b[0]&&q[0]<=b[2]&&q[1]>=b[1]&&q[1]<=b[3]&&ringContains(rings[0],q)&&!rings.slice(1).some(r=>ringContains(r,q)));};
   siteVisible=visible;sightView=viewKey();
   const distance=p=>{const q=project(p,.2);return q?(q[0]-layout.target[0])**2+(q[1]-layout.target[1])**2:Infinity;};
   const available=[...trees,...collection.features.filter(f=>f.properties?.kind==='scenario_anchor'&&f.geometry?.type==='Point')].filter(f=>eligible(f.geometry.coordinates)&&visible(f.geometry.coordinates,false)).sort((a,b)=>distance(a.geometry.coordinates)-distance(b.geometry.coordinates));
   const ignition=f=>({lnglat:[...f.geometry.coordinates],source_id:f.properties.source_id,kind:area?.prediction_linked?'forecast-scenario':'demonstration',ground_height_m:height(f.geometry.coordinates)});
   const tree=available.find(f=>visible(f.geometry.coordinates));if(tree)return ignition(tree);
   // An interior point of recorded greenspace; never create replacement trees.
   const candidates=[];
   for(const f of collection.features.filter(f=>['land_area','woodland_area'].includes(f.properties?.kind)&&['park','garden','grass','forest','wood','recreation_ground'].includes(f.properties?.class))){
    const rings=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
    for(const r of rings){const xs=r[0].map(p=>p[0]),ys=r[0].map(p=>p[1]),b=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];for(let i=1;i<8;i++)for(let j=1;j<8;j++){const p=[b[0]+(b[2]-b[0])*i/8,b[1]+(b[3]-b[1])*j/8];if(contains(f.geometry,p)&&eligible(p)&&visible(p))candidates.push({lnglat:p,source_id:f.properties.source_id,kind:'demonstration',ground_height_m:height(p)});}}
   }
   // A crowded viewport must not turn a valid forecast into missing data.
   // Keep an eligible anchor; Find fire can bring it into the clear map area.
   return candidates.sort((a,b)=>distance(a.lnglat)-distance(b.lnglat))[0]||(available[0]?ignition(available[0]):null);
  }
  function rebuild(ignite=false){
   if(!area||!collection||!assets){groups=[];fireGroups=[];C.treeCount=0;C.renderedTrees=0;C.grassCount=0;C.detailTrees=0;C.canopyTrees=0;C.ignition=null;C.candidates=[];C.candidateKey="";C.emitters=[];if(gpu)uploadInstances();return;}
   const b=area.bbox_wgs84;origin=merc([(b[0]+b[2])/2,(b[1]+b[3])/2]);metres=origin.meterInMercatorCoordinateUnits();
   const extra=(options.exclusions?.()||[]).map(f=>({...f,b:global.FireEyeTallahassee.boundsOf?.(f.geometry)}));
   const extraAt=global.FireEyeTallahassee.spatial(extra,.0004);
   const allowed=p=>!extraAt(p).some(f=>{if(f.b&&(p[0]<f.b[0]-.0003||p[0]>f.b[2]+.0003||p[1]<f.b[1]-.0003||p[1]>f.b[3]+.0003))return false;return f.properties.kind==='building'?contains(f.geometry,p):global.FireEyeTallahassee.roadDistance(f.geometry,p)<f.properties.width_m/2+1;});
   const trees=collection.features.filter(f=>f.properties?.kind==='tree'&&f.geometry?.type==='Point'&&f.geometry.coordinates.every(Number.isFinite)&&allowed(f.geometry.coordinates));
   if(trees.length>6000)throw Error('Scene object budget exceeded');C.treeCount=trees.length;
   if(C.forecastRequired&&global.FireEyeScenarioField&&global.proj4){
    const project=global.proj4('EPSG:4326','+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs'),bounds=map.getBounds(),excluded=collection.features.filter(f=>['building','water'].includes(f.properties?.kind)).map(f=>({...f,b:global.FireEyeTallahassee.boundsOf(f.geometry)})),excludedAt=global.FireEyeTallahassee.spatial(excluded);
    const points=global.FireEyeScenarioField.candidates(collection.features,p=>project.forward(p),p=>bounds.contains(p)&&allowed(p)&&!excludedAt(p).some(f=>contains(f.geometry,p))),key=points.map(p=>p.id+'@'+p.lnglat.join(',')).join('|');
    if(key!==C.candidateKey){C.candidates=points;C.candidateKey=key;C.emitters=[];C.forecast=null;C.fireEmphasis=0;}
   }
   const center=map.getCenter().toArray(),scale=Math.cos(center[1]*Math.PI/180),distance=f=>Math.hypot((f.geometry.coordinates[0]-center[0])*scale,f.geometry.coordinates[1]-center[1])*111320;
   const mobile=innerWidth<=640,near=trees.filter(f=>distance(f)<(mobile?100:160)).sort((a,b)=>distance(a)-distance(b)).slice(0,mobile?160:360),detailed=new Set(near);
   const grass=collection.features.filter(f=>f.properties?.kind==='grass'&&f.geometry?.type==='Point'&&allowed(f.geometry.coordinates)).sort((a,b)=>distance(a)-distance(b)).slice(0,mobile?4000:10000);
   C.grassCount=grass.length;C.detailTrees=near.length;C.canopyTrees=trees.length-near.length;
   const treeKind=f=>/pine|conifer|needleleaf|evergreen/i.test(String(f.properties.class||''))?'tree_pine_01':hash(f.properties.source_id)%2?'tree_oak_02':'tree_oak_01';
   groups=assets.map(asset=>{
    const selected=asset.role==='grass'?grass:asset.role==='tree-canopy'?trees.filter(f=>!detailed.has(f)):near.filter(f=>treeKind(f)===asset.id.replace(/_far$/,'')&&(C.loadedQuality!=='high'||(asset.lod==='far'?distance(f)>60:distance(f)<=60))),values=[];
    for(const f of selected){const p=f.properties,h=typeof p.height_m==='number'&&p.height_m>0&&p.height_m<=120?p.height_m:(p.synthetic?p.display_height_m:8)||8,angle=hash(p.source_id)/4294967296*Math.PI*2;values.push(...local(f.geometry.coordinates),(p.synthetic?p.display_crown_m||4.8:4.8)/asset.crown_diameter_m,h/asset.height_m,Math.sin(angle),Math.cos(angle));}
    return {asset,instances:new Float32Array(values),count:selected.length};
   });
   if(ignite&&!ignitionAttempted&&canIgnite()){C.ignition=chooseIgnition(trees);ignitionAttempted=!!C.ignition;ignitionView=viewKey();}
   rebuildFire();
   if(gpu)uploadInstances();
  }
  function rebuildFire(){
   fireGroups=[];
   const emitters=C.forecastRequired?C.emitters:(C.ignition?[{...C.ignition,id:C.ignition.source_id,strength:1}]:[]);
   for(const emitter of emitters){
    const point=local(emitter.lnglat),rng=random(hash(emitter.id)),make=(count,radius,base,rise,size,smoke)=>{const values=[];for(let i=0;i<count;i++){const angle=rng()*Math.PI*2,d=Math.sqrt(rng())*radius;values.push(point[0]+Math.cos(angle)*d,point[1]+base,point[2]+Math.sin(angle)*d,rng());}return {values:new Float32Array(values),count,rise,size,smoke,strength:emitter.strength};};
    // Vegetation fire symbols rise above the schematic canopy so nearby
    // tree meshes do not hide the entire effect. This is display geometry.
    const canopy=C.forecastRequired?(emitter.canopy_m||0):0;
    fireGroups.push(make(180,4.5,.3,Math.max(11,canopy+10),4.2,false),make(80,3,Math.max(9,canopy+6),25,9,true));
   }
  }
  function setForecast(value){
   if(!C.forecastRequired||value.candidateKey!==C.candidateKey)return;C.forecast={...value};C.emitters=[];C.sampledCount=0;C.validCount=0;
   if(value.status==='ready'){
    if(!Array.isArray(value.values)||value.values.length!==C.candidates.length)C.forecast.status='missing';
    else{const result=global.FireEyeScenarioField.select(C.candidates,value.values);C.emitters=result.emitters;C.sampledCount=result.sampledCount;C.validCount=result.validCount;C.forecast.risk=result.mean;if(!result.validCount)C.forecast.status='missing';}
   }
   C.fireEmphasis=C.forecast.status==='ready'?1:0;clearTimer();last=null;rebuildFire();if(gpu)uploadInstances();notify();map.triggerRepaint();
  }
  function buffer(gl,target,data){const b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,data,gl.STATIC_DRAW);return b;}
  function release(){if(!gpu)return;const {gl}=gpu;for(const m of gpu.meshes){gl.deleteBuffer(m.vertex);gl.deleteBuffer(m.index);if(m.instance)gl.deleteBuffer(m.instance);}for(const t of gpu.textures.values())gl.deleteTexture(t);for(const f of gpu.fire)gl.deleteBuffer(f.buffer);for(const p of [gpu.meshProgram,gpu.fireProgram])if(p)gl.deleteProgram(p.id);if(gpu.vao&&gpu.vaoExt)gpu.vaoExt.deleteVertexArrayOES(gpu.vao);gpu=null;}
  function uploadInstances(){
   if(!gpu)return;const {gl}=gpu,previousArray=gl.getParameter(gl.ARRAY_BUFFER_BINDING);for(const m of gpu.meshes){if(m.instance)gl.deleteBuffer(m.instance);m.instance=null;m.count=0;}
   groups.forEach((group,i)=>{const m=gpu.meshes[i];m.instance=buffer(gl,gl.ARRAY_BUFFER,group.instances);m.count=group.count;});
   for(const f of gpu.fire)gl.deleteBuffer(f.buffer);gpu.fire=fireGroups.map(f=>({...f,buffer:buffer(gl,gl.ARRAY_BUFFER,f.values)}));gl.bindBuffer(gl.ARRAY_BUFFER,previousArray);C.renderedTrees=gpu.instanced?C.treeCount:0;
  }
  function initialize(gl){
   const vaoExt=gl.getExtension('OES_vertex_array_object'),instanced=gl.getExtension('ANGLE_instanced_arrays');
   gpu={gl,vaoExt,vao:vaoExt?.createVertexArrayOES(),instanced,meshes:[],fire:[],textures:new Map(),meshProgram:null,fireProgram:null};
   gpu.meshProgram=program(gl,meshVertex,meshFragment,['position','normal','color','uv','offset','size','rotation'],['matrix','opacity','materialMap','alphaTest','materialOpacity']);
   gpu.fireProgram=program(gl,particleVertex,particleFragment,['position','seed'],['matrix','viewport','time','rise','smoke','size','opacity']);
   const previousTexture=gl.getParameter(gl.TEXTURE_BINDING_2D),flip=gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),premultiply=gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
   function texture(part){const key=part.image?.sha256||'white';if(gpu.textures.has(key))return gpu.textures.get(key);const t=gl.createTexture();gpu.textures.set(key,t);gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);if(part.image)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,part.image.bitmap);else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;}
   const previousArray=gl.getParameter(gl.ARRAY_BUFFER_BINDING),previousVao=vaoExt?gl.getParameter(vaoExt.VERTEX_ARRAY_BINDING_OES):null,previousIndex=gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);vaoExt?.bindVertexArrayOES(gpu.vao);try{gpu.meshes=assets.map(a=>({asset:a,vertex:buffer(gl,gl.ARRAY_BUFFER,a.vertices),index:buffer(gl,gl.ELEMENT_ARRAY_BUFFER,a.indices),parts:a.parts.map(p=>({...p,texture:texture(p)})),instance:null,count:0}));uploadInstances();}finally{vaoExt?.bindVertexArrayOES(previousVao);gl.bindBuffer(gl.ARRAY_BUFFER,previousArray);if(!vaoExt)gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,previousIndex);gl.bindTexture(gl.TEXTURE_2D,previousTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,flip);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiply);}
  }
  function attribute(gl,location,size,stride,offset){if(location<0)return;gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,stride,offset);}
  function draw(gl,matrix){
   if(disposed||!gpu||!origin||!area||!assets||C.alpha<=.001||document.hidden)return;
   try{
    matrix=terrainMatrix(matrix);sceneMatrix=matrix;if(!ignitionAttempted&&canIgnite()){rebuild(true);notify();}
    const now=performance.now();
    if(!C.paused&&last!==null&&!map.isMoving()&&gpu.fire.length){const dt=now-last;C.frameMs=C.frameMs?C.frameMs*.9+dt*.1:dt;if(++C.performanceSamples%40===0&&C.frameMs>95){C.particleBudget=Math.max(600,Math.floor(C.particleBudget*.65));C.quality='economy';if(typeof map.setPixelRatio==='function'){const ratio=map.getCanvas().width/map.getCanvas().clientWidth;if(ratio>1.1)map.setPixelRatio(Math.max(1,ratio-.25));}}}
    if(!C.paused&&last!==null)C.elapsed+=Math.min(.1,(now-last)/1000);last=now;
    const projection=cameraMatrix(matrix,origin,metres),g=gpu;g.vaoExt?.bindVertexArrayOES(g.vao);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(true);
    if(g.instanced){const p=g.meshProgram;gl.useProgram(p.id);gl.uniformMatrix4fv(p.u.matrix,false,projection);gl.uniform1f(p.u.opacity,C.alpha);
     const activeTexture=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE0);const previousTexture=gl.getParameter(gl.TEXTURE_BINDING_2D);gl.uniform1i(p.u.materialMap,0);
     try{for(const m of g.meshes){if(!m.count)continue;gl.bindBuffer(gl.ARRAY_BUFFER,m.vertex);attribute(gl,p.a.position,3,44,0);attribute(gl,p.a.normal,3,44,12);attribute(gl,p.a.color,3,44,24);attribute(gl,p.a.uv,2,44,36);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.index);gl.bindBuffer(gl.ARRAY_BUFFER,m.instance);attribute(gl,p.a.offset,3,28,0);attribute(gl,p.a.size,2,28,12);attribute(gl,p.a.rotation,2,28,20);for(const name of ['offset','size','rotation'])g.instanced.vertexAttribDivisorANGLE(p.a[name],1);for(const part of m.parts){gl.bindTexture(gl.TEXTURE_2D,part.texture);gl.uniform1f(p.u.alphaTest,part.alpha_test);gl.uniform1f(p.u.materialOpacity,part.opacity);g.instanced.drawElementsInstancedANGLE(gl.TRIANGLES,part.count,gl.UNSIGNED_SHORT,part.start*2,m.count);}for(const name of ['offset','size','rotation'])g.instanced.vertexAttribDivisorANGLE(p.a[name],0);}}finally{gl.bindTexture(gl.TEXTURE_2D,previousTexture);gl.activeTexture(activeTexture);}
     for(const a of Object.values(p.a))if(a>=0)gl.disableVertexAttribArray(a);
    }
    if(C.fireEnabled&&g.fire.length&&C.fireEmphasis>0){const p=g.fireProgram;gl.useProgram(p.id);gl.uniformMatrix4fv(p.u.matrix,false,projection);gl.uniform2f(p.u.viewport,gl.drawingBufferWidth,gl.drawingBufferHeight);gl.uniform1f(p.u.time,C.elapsed);gl.uniform1f(p.u.opacity,C.alpha*C.fireEmphasis);gl.depthMask(false);
     for(const f of g.fire){gl.uniform1f(p.u.opacity,C.alpha*C.fireEmphasis*f.strength);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.bindBuffer(gl.ARRAY_BUFFER,f.buffer);attribute(gl,p.a.position,3,16,0);attribute(gl,p.a.seed,1,16,12);gl.uniform1f(p.u.rise,f.rise);gl.uniform1f(p.u.size,f.size);gl.uniform1f(p.u.smoke,f.smoke?1:0);gl.drawArrays(gl.POINTS,0,Math.min(f.count,Math.max(f.smoke?6:12,Math.floor(C.particleBudget/g.fire.length))));}
     for(const a of Object.values(p.a))if(a>=0)gl.disableVertexAttribArray(a);
    }
    gl.depthMask(true);g.vaoExt?.bindVertexArrayOES(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,null);C.frames++;
    if(!C.paused&&C.fireEnabled&&g.fire.length&&C.fireEmphasis>0&&!timer)timer=setTimeout(()=>{timer=null;if(!disposed&&C.alpha>.001&&!document.hidden)map.triggerRepaint();},C.quality==="economy"||innerWidth<600?50:33);
   }catch{fail();}
  }
  function install(){
   if(disposed||installing||!assets||!area||map.getLayer(ID)||!map.getLayer('mapped-scene-buildings'))return;
   installing=true;layer={id:ID,type:'custom',renderingMode:'3d',onAdd:(m,gl)=>{try{initialize(gl);}catch{release();fail();}},render:draw,onRemove:()=>{clearTimer();release();}};
   try{map.addLayer(layer,map.getStyle().layers.find(l=>l.type==='symbol')?.id);}catch{release();fail();}finally{installing=false;}
  }
  function update(){
   if(disposed)return;const z=map.getZoom();
   if(!area||!collection||z<15.5){C.alpha=0;C.phase='mapped';clearTimer();last=null;setReplacement(0);notify();return;}
   if(!assets){C.alpha=0;C.phase=C.error?'fallback':'loading';setReplacement(0);notify();if(Date.now()>=cooldown)loadAssets();return;}
   if(C.loadedQuality!==C.assetQuality&&!assetTask&&Date.now()>=cooldown)void loadAssets();
   install();if(!gpu||C.error){C.alpha=0;setReplacement(0);notify();return;}
   const value=fade();
   C.alpha=value;C.phase=value>0?'simulation':'mapped';setReplacement(gpu.instanced&&C.treeCount?value:0);if(!value){clearTimer();last=null;}notify();map.triggerRepaint();
  }
  const moved=()=>{if(C.forecastRequired&&assets&&collection&&map.getZoom()>=17){try{rebuild();}catch{fail();}}update();};
  const sourceReady=e=>{if(!ignitionAttempted&&e.sourceId==='openmaptiles'&&e.isSourceLoaded)update();};
  const visibility=()=>{clearTimer();last=null;if(!document.hidden)update();};
  const styled=()=>{if(assets&&area&&!map.getLayer(ID)){install();update();}};
  map.on('sourcedata',sourceReady);map.on('zoom',update);map.on('moveend',moved);map.on('styledata',styled);document.addEventListener('visibilitychange',visibility);
  return {state:C,groundScreen,setQuality,exportScene(){return !origin||!assets?null:{origin:[origin.x,origin.y],mercatorUnitsPerMetre:metres,quality:C.loadedQuality,groups:groups.map(g=>({asset:g.asset,instances:g.instances.slice()})),emitters:C.fireEnabled&&C.forecast?.status==='ready'?C.emitters.map(e=>({...e,lnglat:e.lnglat.slice()})):[],forecast:C.forecast?{...C.forecast}:null};},refreshTerrain(){if(disposed||!assets)return;try{rebuild();sightView=null;map.triggerRepaint();}catch{fail();}},focusFire,visibleFireCount,setArea(snapshot){const next=snapshot?.area;if(!next){assetSequence++;assetController?.abort();assetTask=null;C.qualityLoading=false;}if(next?.id===area?.id&&snapshot?.collection===collection)return;const previous=C.ignition,keep=next?.prediction_linked&&area?.id===next.id&&snapshot?.collection?.features.some(f=>f.properties?.source_id===previous?.source_id);area=next||null;collection=snapshot?.collection||null;C.forecastRequired=!!area&&(!!area.prediction_linked||!!options.forecastLinked);if(!keep){C.forecast=null;C.fireEmphasis=C.forecastRequired?0:1;}C.ignition=keep?previous:null;ignitionAttempted=!!C.ignition;ignitionView=null;if(!keep)C.elapsed=0;last=null;try{rebuild();}catch{fail();return;}update();},setForecast,getCandidates(){return C.candidates;},pause(value){C.paused=!!value;clearTimer();last=null;notify();map.triggerRepaint();},fire(value){C.fireEnabled=!!value;clearTimer();last=null;notify();map.triggerRepaint();},retry(){C.error=null;cooldown=0;if(!gpu&&map.getLayer(ID))map.removeLayer(ID);update();},dispose(){disposed=true;controller.abort();assetController?.abort();qualityLoader.dispose();clearTimer();map.off('sourcedata',sourceReady);map.off('zoom',update);map.off('moveend',moved);map.off('styledata',styled);document.removeEventListener('visibilitychange',visibility);if(map.getLayer(ID))map.removeLayer(ID);release();setReplacement(0);}};
 }
 global.FireEyeMappedSimulation={mount};
})(window);
