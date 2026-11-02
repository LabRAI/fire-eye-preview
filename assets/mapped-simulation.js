/* Same-canvas scene adapter. Original meshes: llll0630/wildfire-simulation,
   revision eed7ae1e7b9109d1b9d13ea0f172e14900551fc3. Fire/smoke effects adapt
   Fire-eye's existing simulation viewer. This is an illustrative scenario. */
(function(global){
 'use strict';
 const ID='mapped-simulation-live',REVISION='eed7ae1e7b9109d1b9d13ea0f172e14900551fc3';
 const START=17,END=17.8;
 const smooth=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
 const hash=s=>{let n=2166136261;for(const c of String(s))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
 function random(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
 function ringContains(r,p){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
 function contains(g,p){const parts=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];return parts.some(r=>ringContains(r[0],p)&&!r.slice(1).some(h=>ringContains(h,p)));}
 // Local east/up/south metres -> Mercator -> the existing map camera.
 function cameraMatrix(matrix,origin,scale){const result=new Float32Array(16);for(let row=0;row<4;row++){result[row]=matrix[row]*scale;result[4+row]=matrix[8+row]*scale;result[8+row]=matrix[4+row]*scale;result[12+row]=matrix[row]*origin.x+matrix[4+row]*origin.y+matrix[8+row]*origin.z+matrix[12+row];}return result;}
 const meshVertex='precision highp float; attribute vec3 position; attribute vec3 normal; attribute vec3 color; attribute vec3 offset; attribute vec2 size; attribute vec2 rotation; uniform mat4 matrix; varying mediump vec3 shade; void main(){vec3 p=position*vec3(size.x,size.y,size.x);p.xz=mat2(rotation.y,rotation.x,-rotation.x,rotation.y)*p.xz;vec3 n=normal/vec3(size.x,size.y,size.x);n.xz=mat2(rotation.y,rotation.x,-rotation.x,rotation.y)*n.xz;float light=0.57+0.43*max(0.0,dot(normalize(n),normalize(vec3(-0.4,0.85,0.3))));shade=pow(max(color*light,vec3(0.0)),vec3(0.454545));gl_Position=matrix*vec4(p+offset,1.0);}';
 const meshFragment='precision mediump float; varying mediump vec3 shade; uniform float opacity; void main(){gl_FragColor=vec4(shade*opacity,opacity);}';
 const particleVertex='precision highp float; attribute vec3 position; attribute float seed; uniform mat4 matrix; uniform vec2 viewport; uniform float time; uniform float rise; uniform mediump float smoke; uniform float size; varying mediump float life; void main(){life=fract(seed+time*(smoke>0.5?0.085:0.42));vec3 p=position;p.y+=life*rise;p.x+=sin(seed*30.0+time*0.8)*life*(smoke>0.5?8.0:0.4);p.z+=cos(seed*24.0+time*0.5)*life*(smoke>0.5?6.0:0.4);vec4 clip=matrix*vec4(p,1.0);vec4 side=matrix*vec4(p+vec3(size,0.0,0.0),1.0);vec4 other=matrix*vec4(p+vec3(0.0,0.0,size),1.0);float pixels=max(length((side.xy/side.w-clip.xy/clip.w)*viewport*0.5),length((other.xy/other.w-clip.xy/clip.w)*viewport*0.5));gl_Position=clip;gl_PointSize=clamp(pixels*(smoke>0.5?0.4+life:1.0-life*0.65),1.0,160.0);}';
 const particleFragment='precision mediump float; uniform mediump float smoke; uniform float opacity; varying mediump float life; void main(){vec2 p=gl_PointCoord-0.5;float d=length(p*vec2(1.0,smoke>0.5?1.0:0.75));float soft=1.0-smoothstep(0.12,0.5,d);float alpha=soft*sin(life*3.14159)*opacity;if(smoke>0.5){alpha*=0.19;gl_FragColor=vec4(vec3(0.38,0.35,0.31)*alpha,alpha);}else{alpha*=0.85;vec3 c=mix(vec3(1.0,0.75,0.16),vec3(0.95,0.15,0.01),life);gl_FragColor=vec4(c*alpha,alpha);}}';
 function program(gl,vertex,fragment,attributes,uniforms){
  const shaders=[];let p=null;
  try{for(const [type,code] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('Scene shader unavailable');}p=gl.createProgram();shaders.forEach(s=>gl.attachShader(p,s));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Scene program unavailable');return {id:p,a:Object.fromEntries(attributes.map(n=>[n,gl.getAttribLocation(p,n)])),u:Object.fromEntries(uniforms.map(n=>[n,gl.getUniformLocation(p,n)]))};}
  catch(e){if(p)gl.deleteProgram(p);throw e;}finally{shaders.forEach(s=>gl.deleteShader(s));}
 }
 function mount(map,options={}){
  const C={phase:'mapped',alpha:0,treeCount:0,renderedTrees:0,frames:0,elapsed:0,paused:matchMedia('(prefers-reduced-motion: reduce)').matches,fireEnabled:true,ignition:null,assetBytes:0,error:null};
  let disposed=false,area=null,collection=null,assets=null,assetTask=null,controller=new AbortController(),layer=null,gpu=null,origin=null,metres=1,groups=[],fireGroups=[],timer=null,last=null,cooldown=0,lastState='',replacement=-1,installing=false,ignitionAttempted=false,sceneMatrix=null;
  const merc=p=>global.maplibregl.MercatorCoordinate.fromLngLat(p,0);
  const local=p=>{const q=merc(p);return [(q.x-origin.x)/metres,0,(q.y-origin.y)/metres];};
  const fade=()=>smooth((map.getZoom()-START)/(END-START));
  const canIgnite=()=>map.getZoom()>=START&&!map.isMoving()&&map.getSource('openmaptiles')&&map.isSourceLoaded('openmaptiles');
  const setReplacement=value=>{if(Math.abs(value-replacement)>.002){replacement=value;options.onReplacement?.(value);}};
  function notify(){const state=[C.phase,C.paused,C.fireEnabled,C.treeCount,!!C.ignition,C.error].join('|');if(state!==lastState){lastState=state;options.onChange?.({...C});}}
  function clearTimer(){clearTimeout(timer);timer=null;}
  function fail(){clearTimer();C.error='Scene detail is unavailable';C.phase='fallback';C.alpha=0;cooldown=Date.now()+30000;setReplacement(0);notify();}
  async function loadAssets(){
   if(assets)return assets;if(assetTask)return assetTask;
   assetTask=(async()=>{
    const url=new URL(options.manifestURL,document.baseURI);if(url.protocol!=='https:'&&url.origin!==location.origin&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('Invalid scene origin');
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),response=await fetch(url,{credentials:'omit',signal});if(!response.ok)throw Error('Scene assets unavailable');
    const m=await response.json();if(m.schema_version!==1||m.kind!=='mapped-simulation-assets'||m.upstream_revision!==REVISION||!Array.isArray(m.meshes)||m.meshes.length!==2)throw Error('Unsupported scene assets');
    const meshes=await Promise.all(m.meshes.map(async d=>{
     const u=new URL(d.path,url);if(u.origin!==url.origin||!u.pathname.startsWith(new URL('.',url).pathname)||!Number.isInteger(d.bytes)||d.bytes<1||d.bytes>500000||!/^[a-f0-9]{64}$/.test(d.sha256)||d.stride_bytes!==36||!Number.isInteger(d.vertex_count)||d.vertex_count<1||d.vertex_count>65535||!Number.isInteger(d.index_count)||d.index_count<3||d.index_count%3||d.index_offset!==d.vertex_count*36||d.bytes!==d.index_offset+d.index_count*2||!(d.height_m>0)||!(d.crown_diameter_m>0))throw Error('Invalid scene mesh');
     const r=await fetch(u,{credentials:'omit',signal});if(!r.ok)throw Error('Scene mesh unavailable');const b=await r.arrayBuffer();if(b.byteLength!==d.bytes)throw Error('Scene mesh size mismatch');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),n=>n.toString(16).padStart(2,'0')).join('');if(digest!==d.sha256)throw Error('Scene mesh checksum mismatch');
     const vertices=new Float32Array(b,0,d.vertex_count*9),indices=new Uint16Array(b,d.index_offset,d.index_count);if(!vertices.every(Number.isFinite)||!indices.every(n=>n<d.vertex_count))throw Error('Invalid mesh values');return {...d,vertices,indices};
    }));
    if(disposed)return null;assets=meshes;C.assetBytes=meshes.reduce((n,m)=>n+m.bytes,0);C.error=null;rebuild();install();update();return meshes;
   })().catch(()=>{assetTask=null;if(!disposed)fail();return null;});return assetTask;
  }
  function chooseIgnition(trees){
   if(!collection||!origin)return null;const center=map.getCenter().toArray(),blocked=collection.features.filter(f=>['building','water'].includes(f.properties?.kind));
   const eligible=p=>!blocked.some(f=>contains(f.geometry,p));
   // Vector tiles merge separate buildings into MultiPolygons. Their query
   // bounding boxes overestimate occlusion; test the actual projected faces.
   const canvas=map.getCanvas(),faces=[],project=(p,h)=>{const q=merc(p),z=h*q.meterInMercatorCoordinateUnits(),m=sceneMatrix,w=m[3]*q.x+m[7]*q.y+m[11]*z+m[15];if(w<=0)return null;return [((m[0]*q.x+m[4]*q.y+m[8]*z+m[12])/w+1)*canvas.clientWidth/2,(1-(m[1]*q.x+m[5]*q.y+m[9]*z+m[13])/w)*canvas.clientHeight/2];};
   const face=rings=>{if(rings.some(r=>r.some(p=>!p)))return;const xs=rings[0].map(p=>p[0]),ys=rings[0].map(p=>p[1]),b=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];if(b[2]>=0&&b[0]<=canvas.clientWidth&&b[3]>=0&&b[1]<=canvas.clientHeight)faces.push({rings,b});};
   for(const f of map.queryRenderedFeatures({layers:['mapped-scene-buildings']})){
    const h=Number(f.properties.render_height)||0,base=Number(f.properties.render_min_height)||0;if(h<=base)continue;
    for(const rings of f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[]){
     const top=rings.map(r=>r.map(p=>project(p,h))),bottom=rings.map(r=>r.map(p=>project(p,base)));face(top);
     for(let j=0;j<rings.length;j++)for(let i=1;i<rings[j].length;i++)face([[bottom[j][i-1],bottom[j][i],top[j][i],top[j][i-1]]]);
    }
   }
   const visible=p=>{const q=project(p,.2);if(!q||q[0]<32||q[1]<32||q[0]>canvas.clientWidth-32||q[1]>canvas.clientHeight-32)return false;return !faces.some(({rings,b})=>q[0]>=b[0]&&q[0]<=b[2]&&q[1]>=b[1]&&q[1]<=b[3]&&ringContains(rings[0],q)&&!rings.slice(1).some(r=>ringContains(r,q)));};
   const distance=p=>(p[0]-center[0])**2*Math.cos(center[1]*Math.PI/180)**2+(p[1]-center[1])**2;
   const tree=trees.filter(f=>eligible(f.geometry.coordinates)&&visible(f.geometry.coordinates)).sort((a,b)=>distance(a.geometry.coordinates)-distance(b.geometry.coordinates))[0];
   if(tree)return {lnglat:[...tree.geometry.coordinates],source_id:tree.properties.source_id,kind:'demonstration',ground_height_m:0};
   // An interior point of recorded greenspace; never create replacement trees.
   const candidates=[];
   for(const f of collection.features.filter(f=>['land_area','woodland_area'].includes(f.properties?.kind)&&['park','garden','grass','forest','wood','recreation_ground'].includes(f.properties?.class))){
    const rings=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
    for(const r of rings){const xs=r[0].map(p=>p[0]),ys=r[0].map(p=>p[1]),b=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];for(let i=1;i<8;i++)for(let j=1;j<8;j++){const p=[b[0]+(b[2]-b[0])*i/8,b[1]+(b[3]-b[1])*j/8];if(contains(f.geometry,p)&&eligible(p)&&visible(p))candidates.push({lnglat:p,source_id:f.properties.source_id,kind:'demonstration',ground_height_m:0});}}
   }
   return candidates.sort((a,b)=>distance(a.lnglat)-distance(b.lnglat))[0]||null;
  }
  function rebuild(ignite=false){
   if(!area||!collection||!assets){groups=[];fireGroups=[];C.treeCount=0;C.renderedTrees=0;C.ignition=null;if(gpu)uploadInstances();return;}
   const b=area.bbox_wgs84;origin=merc([(b[0]+b[2])/2,(b[1]+b[3])/2]);metres=origin.meterInMercatorCoordinateUnits();
   const trees=collection.features.filter(f=>f.properties?.kind==='tree'&&f.geometry?.type==='Point'&&f.geometry.coordinates.every(Number.isFinite));
   if(trees.length>2000)throw Error('Scene object budget exceeded');C.treeCount=trees.length;
   groups=assets.map((asset,index)=>{
    const selected=trees.filter(f=>hash(f.properties.source_id)%assets.length===index),values=[];
    for(const f of selected){const p=f.properties,h=typeof p.height_m==='number'&&p.height_m>0&&p.height_m<=120?p.height_m:8,angle=hash(p.source_id)/4294967296*Math.PI*2;values.push(...local(f.geometry.coordinates),4.8/asset.crown_diameter_m,h/asset.height_m,Math.sin(angle),Math.cos(angle));}
    return {asset,instances:new Float32Array(values),count:selected.length};
   });
   if(ignite&&!ignitionAttempted&&canIgnite()){C.ignition=chooseIgnition(trees);ignitionAttempted=true;}
   fireGroups=[];
   if(C.ignition){
    const point=local(C.ignition.lnglat),rng=random(hash(C.ignition.source_id)),make=(count,radius,base,rise,size,smoke)=>{const values=[];for(let i=0;i<count;i++){const angle=rng()*Math.PI*2,d=Math.sqrt(rng())*radius;values.push(point[0]+Math.cos(angle)*d,base,point[2]+Math.sin(angle)*d,rng());}return {values:new Float32Array(values),count,rise,size,smoke};};
    fireGroups=[make(320,6,0,4.5,1.4,false),make(130,4,0,28,14,true)];
   }
   if(gpu)uploadInstances();
  }
  function buffer(gl,target,data){const b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,data,gl.STATIC_DRAW);return b;}
  function release(){if(!gpu)return;const {gl}=gpu;for(const m of gpu.meshes){gl.deleteBuffer(m.vertex);gl.deleteBuffer(m.index);if(m.instance)gl.deleteBuffer(m.instance);}for(const f of gpu.fire)gl.deleteBuffer(f.buffer);for(const p of [gpu.meshProgram,gpu.fireProgram])if(p)gl.deleteProgram(p.id);if(gpu.vao&&gpu.vaoExt)gpu.vaoExt.deleteVertexArrayOES(gpu.vao);gpu=null;}
  function uploadInstances(){
   if(!gpu)return;const {gl}=gpu,previousArray=gl.getParameter(gl.ARRAY_BUFFER_BINDING);for(const m of gpu.meshes){if(m.instance)gl.deleteBuffer(m.instance);m.instance=null;m.count=0;}
   groups.forEach((group,i)=>{const m=gpu.meshes[i];m.instance=buffer(gl,gl.ARRAY_BUFFER,group.instances);m.count=group.count;});
   for(const f of gpu.fire)gl.deleteBuffer(f.buffer);gpu.fire=fireGroups.map(f=>({...f,buffer:buffer(gl,gl.ARRAY_BUFFER,f.values)}));gl.bindBuffer(gl.ARRAY_BUFFER,previousArray);C.renderedTrees=gpu.instanced?C.treeCount:0;
  }
  function initialize(gl){
   const vaoExt=gl.getExtension('OES_vertex_array_object'),instanced=gl.getExtension('ANGLE_instanced_arrays');
   gpu={gl,vaoExt,vao:vaoExt?.createVertexArrayOES(),instanced,meshes:[],fire:[],meshProgram:null,fireProgram:null};
   gpu.meshProgram=program(gl,meshVertex,meshFragment,['position','normal','color','offset','size','rotation'],['matrix','opacity']);
   gpu.fireProgram=program(gl,particleVertex,particleFragment,['position','seed'],['matrix','viewport','time','rise','smoke','size','opacity']);
   const previousArray=gl.getParameter(gl.ARRAY_BUFFER_BINDING),previousVao=vaoExt?gl.getParameter(vaoExt.VERTEX_ARRAY_BINDING_OES):null,previousIndex=gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);vaoExt?.bindVertexArrayOES(gpu.vao);try{gpu.meshes=assets.map(a=>({asset:a,vertex:buffer(gl,gl.ARRAY_BUFFER,a.vertices),index:buffer(gl,gl.ELEMENT_ARRAY_BUFFER,a.indices),instance:null,count:0}));uploadInstances();}finally{vaoExt?.bindVertexArrayOES(previousVao);gl.bindBuffer(gl.ARRAY_BUFFER,previousArray);if(!vaoExt)gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,previousIndex);}
  }
  function attribute(gl,location,size,stride,offset){if(location<0)return;gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,stride,offset);}
  function draw(gl,matrix){
   if(disposed||!gpu||!origin||!area||!assets||C.alpha<=.001||document.hidden)return;
   try{
    sceneMatrix=matrix;if(!ignitionAttempted&&canIgnite()){rebuild(true);notify();}
    const now=performance.now();if(!C.paused&&last!==null)C.elapsed+=Math.min(.1,(now-last)/1000);last=now;
    const projection=cameraMatrix(matrix,origin,metres),g=gpu;g.vaoExt?.bindVertexArrayOES(g.vao);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(true);
    if(g.instanced){const p=g.meshProgram;gl.useProgram(p.id);gl.uniformMatrix4fv(p.u.matrix,false,projection);gl.uniform1f(p.u.opacity,C.alpha);
     for(const m of g.meshes){if(!m.count)continue;gl.bindBuffer(gl.ARRAY_BUFFER,m.vertex);attribute(gl,p.a.position,3,36,0);attribute(gl,p.a.normal,3,36,12);attribute(gl,p.a.color,3,36,24);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.index);gl.bindBuffer(gl.ARRAY_BUFFER,m.instance);attribute(gl,p.a.offset,3,28,0);attribute(gl,p.a.size,2,28,12);attribute(gl,p.a.rotation,2,28,20);for(const name of ['offset','size','rotation'])g.instanced.vertexAttribDivisorANGLE(p.a[name],1);g.instanced.drawElementsInstancedANGLE(gl.TRIANGLES,m.asset.index_count,gl.UNSIGNED_SHORT,0,m.count);for(const name of ['offset','size','rotation'])g.instanced.vertexAttribDivisorANGLE(p.a[name],0);}
     for(const a of Object.values(p.a))if(a>=0)gl.disableVertexAttribArray(a);
    }
    if(C.fireEnabled&&C.ignition){const p=g.fireProgram;gl.useProgram(p.id);gl.uniformMatrix4fv(p.u.matrix,false,projection);gl.uniform2f(p.u.viewport,gl.drawingBufferWidth,gl.drawingBufferHeight);gl.uniform1f(p.u.time,C.elapsed);gl.uniform1f(p.u.opacity,C.alpha);gl.depthMask(false);
     for(const f of g.fire){gl.blendFunc(gl.ONE,f.smoke?gl.ONE_MINUS_SRC_ALPHA:gl.ONE);gl.bindBuffer(gl.ARRAY_BUFFER,f.buffer);attribute(gl,p.a.position,3,16,0);attribute(gl,p.a.seed,1,16,12);gl.uniform1f(p.u.rise,f.rise);gl.uniform1f(p.u.size,f.size);gl.uniform1f(p.u.smoke,f.smoke?1:0);gl.drawArrays(gl.POINTS,0,f.count);}
     for(const a of Object.values(p.a))if(a>=0)gl.disableVertexAttribArray(a);
    }
    gl.depthMask(true);g.vaoExt?.bindVertexArrayOES(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,null);C.frames++;
    if(!C.paused&&C.fireEnabled&&C.ignition&&!timer)timer=setTimeout(()=>{timer=null;if(!disposed&&C.alpha>.001&&!document.hidden)map.triggerRepaint();},innerWidth<600?50:33);
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
   install();if(!gpu||C.error){C.alpha=0;setReplacement(0);notify();return;}
   const value=fade();
   C.alpha=value;C.phase=value>0?'simulation':'mapped';setReplacement(gpu.instanced&&C.treeCount?value:0);if(!value){clearTimer();last=null;}notify();map.triggerRepaint();
  }
  const sourceReady=e=>{if(!ignitionAttempted&&e.sourceId==='openmaptiles'&&e.isSourceLoaded)update();};
  const visibility=()=>{clearTimer();last=null;if(!document.hidden)update();};
  const styled=()=>{if(assets&&area&&!map.getLayer(ID)){install();update();}};
  map.on('sourcedata',sourceReady);map.on('zoom',update);map.on('moveend',update);map.on('styledata',styled);document.addEventListener('visibilitychange',visibility);
  return {state:C,setArea(snapshot){const next=snapshot?.area;if(next?.id===area?.id&&snapshot?.collection===collection)return;area=next||null;collection=snapshot?.collection||null;C.ignition=null;ignitionAttempted=false;C.elapsed=0;last=null;try{rebuild();}catch{fail();return;}update();},pause(value){C.paused=!!value;clearTimer();last=null;notify();map.triggerRepaint();},fire(value){C.fireEnabled=!!value;clearTimer();last=null;notify();map.triggerRepaint();},retry(){C.error=null;cooldown=0;if(!gpu&&map.getLayer(ID))map.removeLayer(ID);update();},dispose(){disposed=true;controller.abort();clearTimer();map.off('sourcedata',sourceReady);map.off('zoom',update);map.off('moveend',update);map.off('styledata',styled);document.removeEventListener('visibilitychange',visibility);if(map.getLayer(ID))map.removeLayer(ID);release();setReplacement(0);}};
 }
 global.FireEyeMappedSimulation={mount};
})(window);
