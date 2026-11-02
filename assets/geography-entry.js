'use strict';
(async function(){
 for(let n=0;n<600&&!window.fireEyePlatform?.ready;n++)await new Promise(r=>setTimeout(r,100));
 const S=window.fireEyePreview,P=window.fireEyePlatform;if(!P?.ready||!S?.map||!window.FireEyeGeographicScene)return;
 let controller,pendingKey='',sequence=0,retryAt=0;
 const selected=()=>{const r=S.active?.run,m=S.manifest;return r&&m?{release_id:m.release_id,issue_time_utc:m.issue_time_utc,source_id:r.source_id,target_time_utc:r.target_time_utc,lead_hours:r.lead_hours,numeric_sha256:r.overview?.values?.sha256}:null;};
 async function syncForecast(){
  const sim=controller?.simulation,f=selected();if(!sim?.state.forecastRequired||!f)return;
  const ignition=sim.state.ignition,point=ignition?.lnglat,anchor=ignition?.source_id;
  const key=JSON.stringify([f,anchor]);if(key===pendingKey&&(sim.state.forecast?.status!=='error'||Date.now()<retryAt))return;
  pendingKey=key;const seq=++sequence,manifest=S.manifest,run=S.active.run;
  sim.setForecast({...f,key,status:point?'loading':'missing',risk:null});if(!point)return;
  try{
   // Query the verified numeric grid, never infer risk from a display colour.
   const risk=await S.valueAt(manifest,run,point);
   if(seq!==sequence||JSON.stringify([selected(),sim.state.ignition?.source_id])!==key||!sim.state.forecastRequired)return;
   sim.setForecast({...f,key,status:risk===null?'missing':'ready',risk,location:[...point],method:'Selected published 5 km model score; illustrative flame visibility only'});
  }catch{if(seq===sequence&&sim.state.forecastRequired){retryAt=Date.now()+30000;sim.setForecast({...f,key,status:'error',risk:null});}}
 }
 controller=FireEyeGeographicScene.mount(S.map,{
  catalogURL:'assets/geography/catalog.json',
  localCoverURL:'assets/geography/tallahassee/manifest.json',
  simulationAssetsURL:'assets/mapped-simulation/manifest.json',
  ensureStreet:async()=>{const select=document.getElementById('basemap');if(select.value!=='street'){select.value='street';await select.onchange();}},
  onDetailScale:factor=>{S.geographyRiskFactor=factor;S.syncHeatmapDisplay?.();},
  onObject:detail=>window.dispatchEvent(new CustomEvent('fire-eye:mapped-object',{detail})),
  onSimulationChange:()=>queueMicrotask(syncForecast)
 });
 const changed=()=>{pendingKey='';syncForecast();};
 window.addEventListener('fire-eye:forecast-changed',changed);
 const timer=setInterval(()=>{if(!document.hidden)syncForecast();},10000);
 window.addEventListener('pagehide',()=>{sequence++;clearInterval(timer);window.removeEventListener('fire-eye:forecast-changed',changed);},{once:true});
 controller.syncForecast=syncForecast;
 window.fireEyeGeography=controller;
})().catch(()=>{});
