'use strict';
(async function(){
 for(let n=0;n<600&&!window.fireEyePlatform?.ready;n++)await new Promise(r=>setTimeout(r,100));
 const S=window.fireEyePreview,P=window.fireEyePlatform;if(!P?.ready||!S?.map||!window.FireEyeGeographicScene)return;
 let controller,pendingKey='',sequence=0,retryAt=0,framedArea=null,userMoved=false;
 const selected=()=>{const r=S.active?.run,m=S.manifest,R=window.fireEyeAdaptiveResolution;const fine=S.refinementMix===1&&R?.status==='ready'&&R.active?.source_id===r?.source_id&&R.active?.issue_time_utc===m?.issue_time_utc;return r&&m?{release_id:m.release_id,issue_time_utc:m.issue_time_utc,source_id:r.source_id,target_time_utc:r.target_time_utc,lead_hours:r.lead_hours,numeric_sha256:r.overview?.values?.sha256,resolution:fine?50:5000,refinement_revision:fine?R.active.revision:null}:null;};
 async function syncForecast(){
  const sim=controller?.simulation,f=selected();if(!sim?.state.forecastRequired||!f||sim.state.alpha<=0)return;
  const points=sim.getCandidates(),candidateKey=sim.state.candidateKey,key=JSON.stringify([f,candidateKey]);
  if(key===pendingKey&&sim.state.forecast?.key===key&&(sim.state.forecast?.status!=='error'||Date.now()<retryAt))return;
  pendingKey=key;const seq=++sequence,manifest=S.manifest,run=S.active.run;
  const context={...f,key,candidateKey,method:'Stable visual sampling of selected risk values; not ignition probabilities or spread'};
  sim.setForecast({...context,status:points.length?'loading':'missing',values:[]});if(!points.length)return;
  try{
   // Sample the same verified numeric field used by the visible heatmap.
   // Refinement samples use the existing on-device worker and weight cache.
   const values=f.resolution===50?await window.fireEyeAdaptiveResolution.sampleAt(points.map(p=>p.lnglat)):await Promise.all(points.map(p=>S.valueAt(manifest,run,p.lnglat)));
   if(seq!==sequence||JSON.stringify([selected(),sim.state.candidateKey])!==key||!sim.state.forecastRequired)return;
   sim.setForecast({...context,status:'ready',values});
   // Frame an actual sampled location once if every flame is behind a card
   // or building. Never relocate emitters or move the camera on time changes.
   if(f.resolution===50&&framedArea!==controller.selectedArea&&!S.map.isMoving()){
    framedArea=controller.selectedArea;if(!userMoved&&sim.state.emitters.length&&!sim.visibleFireCount())sim.focusFire();
   }
  }catch{if(seq===sequence&&sim.state.forecastRequired&&JSON.stringify([selected(),sim.state.candidateKey])===key){retryAt=Date.now()+10000;sim.setForecast({...context,status:'error',values:[]});}}
 }
 controller=FireEyeGeographicScene.mount(S.map,{
  catalogURL:'assets/geography/catalog.json',localCoverURL:'assets/geography/tallahassee/manifest.json',simulationAssetsURL:'assets/mapped-simulation/manifest.json',environmentURL:'assets/geography/environment/catalog.json',forecastLinked:true,
  ensureStreet:async()=>{const select=document.getElementById('basemap');if(select.value!=='street'){select.value='street';await select.onchange();}},
  onDetailScale:factor=>{S.geographyRiskFactor=factor;S.syncHeatmapDisplay?.();window.fireEyeAdaptiveResolution?.display?.();},
  onObject:detail=>window.dispatchEvent(new CustomEvent('fire-eye:mapped-object',{detail})),
  onSimulationChange:()=>queueMicrotask(syncForecast)
 });
 const interacted=()=>{userMoved=true;};S.map.on('dragstart',interacted);S.map.on('rotatestart',event=>{if(event.originalEvent)interacted();});S.map.on('zoomstart',event=>{if(event.originalEvent)interacted();});
 const changed=()=>{pendingKey='';syncForecast();};
 window.addEventListener('fire-eye:forecast-changed',changed);window.addEventListener('fire-eye:refinement-changed',changed);
 const timer=setInterval(()=>{if(!document.hidden)syncForecast();},10000);
 window.addEventListener('pagehide',()=>{sequence++;clearInterval(timer);window.removeEventListener('fire-eye:forecast-changed',changed);window.removeEventListener('fire-eye:refinement-changed',changed);},{once:true});
 controller.syncForecast=syncForecast;window.fireEyeGeography=controller;
})().catch(()=>{});
