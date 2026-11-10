/* Reuse local map geometry; request bounded cover context only on scene intent. */
(function(global){
 'use strict';
 const scriptURL=new URL(document.currentScript.src),workerURL=new URL('./on-demand-scene-worker.js?v=62666f50291ac339',scriptURL),coverURL=new URL('./scene-cover.mjs?v=26fc19104245d70e',scriptURL);
 let coverModule=null,coverFailureAt=0;
 const loadCoverModule=()=>{if(coverFailureAt&&Date.now()-coverFailureAt>30000){coverModule=null;coverFailureAt=0;}return coverModule||(coverModule=import(coverURL.href).catch(error=>{coverFailureAt=Date.now();throw error;}));};
 function create(map,options={}){
  const H=global.FireEyeTallahassee;let worker=null,sequence=0,last=null,pending=null;
  const contains=()=>{const p=map.getCenter().toArray();return p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;};
  function cancel(){sequence++;if(pending){clearTimeout(pending.timer);pending.controller.abort();pending.reject(new DOMException('Scene selection changed','AbortError'));pending=null;}worker?.terminate();worker=null;}
  function collect(center){
   const radius=700/111320,box=[center[0]-radius/Math.cos(center[1]*Math.PI/180),center[1]-radius,center[0]+radius/Math.cos(center[1]*Math.PI/180),center[1]+radius],features=[],seen=new Set();
   for(const sourceLayer of ['landcover','landuse','park','building','water','waterway','transportation']){
    let rows=[];try{rows=map.querySourceFeatures('openmaptiles',{sourceLayer});}catch{}
    for(const f of rows){
     if(!f.geometry?.coordinates||!['Polygon','MultiPolygon','LineString','MultiLineString'].includes(f.geometry.type))continue;
     const b=H.boundsOf(f.geometry);if(b[0]>box[2]||b[2]<box[0]||b[1]>box[3]||b[3]<box[1])continue;
     const p=f.properties||{},identity=sourceLayer+'|'+String(f.id??'')+'|'+JSON.stringify(f.geometry.coordinates);if(seen.has(identity))continue;seen.add(identity);
     const c=p.class||p.subclass||'',kind=sourceLayer==='building'?'building':sourceLayer==='water'?'water':['waterway','transportation'].includes(sourceLayer)?'transportation':'land_area';
     const height=Number(p.render_height??p.height),width=Number(p.width),fallback=sourceLayer==='waterway'?8:['motorway','trunk','primary','secondary'].includes(c)?24:['path','track','footway','cycleway','pedestrian'].includes(c)?4:12;
     features.push({type:'Feature',geometry:f.geometry,properties:{kind,class:c,source_layer:sourceLayer,source_id:'map/'+sourceLayer+'/'+String(f.id??seen.size),height_m:Number.isFinite(height)&&height>0?Math.min(height,650):8,width_m:Number.isFinite(width)&&width>0?Math.min(width,100):fallback,below_ground:p.brunnel==='tunnel',source:'OpenStreetMap / OpenMapTiles',height_source:Number.isFinite(height)&&height>0?'mapped':'display estimate'}});
    }
   }
   for(const f of options.extraFeatures?.()||[]){const b=H.boundsOf(f.geometry);if(b[0]<=box[2]&&b[2]>=box[0]&&b[1]<=box[3]&&b[3]>=box[1])features.push(f);}
   if(features.length>18000)throw Error('Local geometry budget');return features;
  }
  async function build(){
   const center=map.getCenter().toArray();if(!contains()||map.getZoom()<15.5)return null;
   if(!map.getSource('openmaptiles')||!map.isSourceLoaded('openmaptiles'))throw Error('Street geometry loading');
   const key=[...center.map(v=>v.toFixed(5)),map.getZoom().toFixed(2),map.getBearing().toFixed(1),map.getPitch().toFixed(1),matchMedia('(max-width:640px),(max-height:500px) and (pointer:coarse)').matches].join('|');
   if(last?.key===key&&Date.now()<last.expires)return last.snapshot;if(pending?.key===key)return pending.promise;
   const features=collect(center);cancel();const id=sequence;worker=new Worker(workerURL.href);
   let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
   const controller=new AbortController();
   let timer;
   pending={id,key,promise,resolve,reject,timer,controller};
   const finish=(error,snapshot)=>{if(pending?.id!==id)return;clearTimeout(timer);controller.abort();pending=null;worker?.terminate();worker=null;if(error)reject(error);else{const retry=snapshot.area?.vegetation_context_status==='unavailable'||snapshot.area?.vegetation_context_partial;last={key,snapshot,expires:retry?Date.now()+30000:Infinity};resolve(snapshot);}};
   worker.onmessage=e=>{if(e.data.id===id)finish(e.data.error?Error(e.data.error):null,e.data.snapshot);};worker.onerror=()=>finish(Error('Local scene generation unavailable'));
   // Import, index, boundary and local tiles share a single fixed preparation
   // deadline. Slow or absent context must still allow mapped OSM scenes.
   let coverTimer;
   const fallback=new Promise(resolve=>{coverTimer=setTimeout(()=>{controller.abort();resolve({status:'unavailable',cells:[]});},4500);controller.signal.addEventListener('abort',()=>{clearTimeout(coverTimer);resolve({status:'unavailable',cells:[]});},{once:true});});
   const context=loadCoverModule().then(module=>{if(controller.signal.aborted)return {status:'unavailable',cells:[]};return module.loadSceneCover(center,{signal:controller.signal});}).catch(()=>({status:'unavailable',cells:[]}));
   Promise.race([context,fallback]).then(coverContext=>{
    clearTimeout(coverTimer);if(pending?.id!==id)return;
    // Preparation has its own 4.5 s bound; preserve the worker's complete
    // 12 s generation allowance even on a cold or slow source connection.
    timer=setTimeout(()=>{if(pending?.id===id)finish(Error('Local scene generation timed out'));},12000);pending.timer=timer;
    worker.postMessage({id,center,features,coverContext,mobile:matchMedia('(max-width:640px),(max-height:500px) and (pointer:coarse)').matches});
   }).catch(()=>finish(Error('Local scene generation unavailable')));
   return promise;
  }
  return {contains,build,invalidate(){last=null;},cancel,dispose:cancel};
 }
 global.FireEyeOnDemandScene={create};
})(window);
