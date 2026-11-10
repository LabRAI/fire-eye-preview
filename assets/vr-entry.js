/* Optional immersive rendering. Explicit, persistent entry; large renderer stays lazy. */
(async()=>{
 const moduleURL=new URL('./vr-viewer.js?v=f7af2b58588363b0',document.currentScript.src),terrainURL=new URL('./vr-terrain.mjs?v=5f5ed23adb84968f',document.currentScript.src);let moduleAttempt=0,terrainModule=null,terrainController=null;
 for(let i=0;i<600&&!window.fireEyeGeography;i++)await new Promise(r=>setTimeout(r,100));
 const G=window.fireEyeGeography,S=window.fireEyePreview;if(!G||!S)return;
 const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 const openButton=element('button','VR'),sideButton=element('button','Virtual reality','wide-button'),mapButton=element('button','VR','vr-map-button');
 openButton.id='scene-vr-open';sideButton.id='scene-vr-sidebar';mapButton.id='vr-map-open';
 for(const b of [openButton,sideButton,mapButton]){b.type='button';b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-controls','vr-dialog');}
 mapButton.title='Explore in virtual reality';mapButton.setAttribute('aria-label','Open VR · virtual reality');
 const control=element('div',null,'maplibregl-ctrl maplibregl-ctrl-group vr-map-control');control.append(mapButton);
 S.map.addControl({onAdd(){return control;},onRemove(){control.remove();}},'bottom-right');
 G.panel.querySelector('.mapped-scene-actions')?.append(openButton);document.getElementById('scene-controls-open')?.after(sideButton);
 const dialog=element('dialog',null,'vr-dialog');dialog.id='vr-dialog';dialog.setAttribute('aria-label','Virtual reality');
 const head=element('div',null,'vr-heading'),title=element('h2','Virtual reality'),close=element('button','×','vr-close');close.id='vr-close';close.type='button';close.setAttribute('aria-label','Close virtual reality');head.append(title,close);
 const context=element('p',null,'vr-context'),viewport=element('div',null,'vr-viewport'),status=element('p',null,'vr-status'),actions=element('div',null,'vr-actions'),enter=element('button','Enter VR'),retry=element('button','Reload scene'),places=element('button','Choose location');
 enter.id='vr-enter';retry.id='vr-reload';places.id='vr-places';enter.type=retry.type=places.type='button';status.setAttribute('role','status');
 const chooser=element('section',null,'vr-chooser'),intro=element('p','Choose the current map center or your selected point. Only this local area is prepared on your device.'),current=element('button','Use map center','vr-location'),currentHint=element('p',null,'vr-location-hint'),examples=element('div',null,'vr-locations');
 chooser.id='vr-chooser';chooser.hidden=true;current.id='vr-use-center';current.type='button';examples.id='vr-locations';chooser.append(intro,current,currentHint,examples);
 const note=element('p','Trigger: point and teleport. Thumbstick: turn in 30° steps. Home, Pause fire and Exit VR are available inside the headset. The scene uses the selected forecast snapshot; fire effects are illustrative.','vr-note');
 const qualityLabel=element('label','Quality','scene-quality'),qualitySelect=element('select');qualitySelect.id='vr-quality';qualitySelect.setAttribute('aria-label','VR quality');qualitySelect.title='Controls vegetation density, mesh detail and rendering resolution. Forecast values stay the same.';
 for(const value of window.FireEyeSceneQuality.tiers){const item=element('option',value[0].toUpperCase()+value.slice(1));item.value=value;qualitySelect.append(item);}qualitySelect.value=G.simulation.state.assetQuality;qualityLabel.append(qualitySelect);
 actions.append(qualityLabel,enter,retry,places);dialog.append(head,context,chooser,viewport,status,actions,note);document.body.append(dialog);
 let savedView=null,viewer=null,moduleTask=null,sequence=0,restorePause=null,restoreIntent=null,supported=false,busy=false,areaTask=null,opener=null;
 const report=message=>{status.textContent=message;};
 function restore(){if(restorePause!==null){G.simulation.pause(restorePause);restorePause=null;}}
 function captureView(){return {center:S.map.getCenter().toArray(),zoom:S.map.getZoom(),pitch:S.map.getPitch(),bearing:S.map.getBearing()};}
 async function closeView(){sequence++;terrainController?.abort();terrainController=null;busy=false;const old=viewer;viewer=null;dialog.close();restore();if(restoreIntent===false)G.stopSimulation();restoreIntent=null;if(savedView){const view=savedView;savedView=null;S.map.stop();S.map.jumpTo(view);}window.fireEyeVR.viewer=null;window.fireEyeVR.snapshot=null;opener?.focus({preventScroll:true});await old?.dispose();}
 close.onclick=()=>{void closeView();};dialog.addEventListener('cancel',e=>{e.preventDefault();void closeView();});
 const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;
 async function chooseLocation(){const seq=++sequence;terrainController?.abort();busy=false;const old=viewer;viewer=null;window.fireEyeVR.viewer=null;await old?.dispose();if(seq!==sequence||!dialog.open)return;
  restore();chooser.hidden=false;viewport.hidden=true;viewport.replaceChildren();context.textContent='Choose a point on the map';enter.hidden=true;retry.hidden=true;places.hidden=true;note.hidden=true;examples.replaceChildren();
  const center=S.map.getCenter().toArray();current.disabled=!valid(center);currentHint.textContent=center[1].toFixed(4)+'°, '+center[0].toFixed(4)+'° · current map center';current.onclick=()=>{void loadLocation(center);};
  if(valid(S.selected)){const point=S.selected.slice(),button=element('button','Use selected point · '+point[1].toFixed(4)+'°, '+point[0].toFixed(4)+'°','vr-location');button.onclick=()=>{void loadLocation(point);};examples.append(button);}
  const pick=element('button','Choose another point on the map','vr-location');pick.onclick=()=>{void closeView();};examples.append(pick);report('Any mapped land location can be requested. Scene detail depends on the available source data.');
 }
 async function loadLocation(center){if(busy)return;busy=true;const seq=sequence;chooser.hidden=true;viewport.hidden=false;places.hidden=false;context.textContent=center[1].toFixed(4)+'°, '+center[0].toFixed(4)+'°';report('Preparing the selected location…');
  // Trigger the normal geographic loaders without reopening dismissed simulation controls.
  if(seq!==sequence||!dialog.open)return;S.map.stop();S.map.jumpTo({center,zoom:17.8,pitch:52,bearing:S.map.getBearing()});await prepare();
 }
 const sameForecast=(field,run,manifest)=>field&&run&&manifest&&field.source_id===run.source_id&&field.issue_time_utc===manifest.issue_time_utc&&field.target_time_utc===run.target_time_utc;
 async function readyScene(seq){
  const center=S.map.getCenter().toArray(),contains=b=>Array.isArray(b)&&center[0]>=b[0]&&center[0]<=b[2]&&center[1]>=b[1]&&center[1]<=b[3],start=Date.now();
  terrainController?.abort();terrainController=new AbortController();const signal=terrainController.signal;
  terrainModule ||= import(terrainURL.href).catch(error=>{terrainModule=null;throw error;});
  const terrain=terrainModule.then(m=>m.loadTerrain(center,{signal})).catch(error=>({error}));
  while(seq===sequence&&dialog.open){
   const state=G.vrStatus(),run=S.active?.run,live=G.simulation.state,field=live.forecast;
   const settled=live.phase==='simulation'||live.phase==='fallback',forecastSettled=!run||!live.candidates.length||(sameForecast(field,run,S.manifest)&&['ready','missing','error'].includes(field.status))||Date.now()-start>10000;
   if(!S.map.isMoving()&&contains(state.sceneBounds)&&settled&&forecastSettled){
    const source=G.vrSource();if(source.terrainReady){source.terrainSource='Published local terrain';terrainController.abort();return source;}
    const local=await terrain;if(seq!==sequence||!dialog.open)return null;if(local.error)throw local.error;return {...source,...local};
   }
   report(!contains(state.sceneBounds)||!settled?'Preparing buildings, vegetation and local ground…':'Preparing the selected forecast…');
   if(Date.now()-start>30000)throw Error('Local scene could not finish loading. Reload the scene to retry.');
   await new Promise(r=>setTimeout(r,200));
  }return null;
 }
 async function prepare(){
  const seq=++sequence;busy=true;qualitySelect.disabled=true;qualitySelect.value=G.simulation.state.assetQuality;chooser.hidden=true;viewport.hidden=false;enter.hidden=false;retry.hidden=false;places.hidden=false;note.hidden=false;enter.disabled=true;retry.disabled=true;report('Preparing the selected geographic scene…');const old=viewer;viewer=null;window.fireEyeVR.viewer=null;await old?.dispose();if(seq!==sequence||!dialog.open)return;restore();viewport.replaceChildren();
  try{
   // Direct entry at zoom 15.5–17 previously waited forever: simulation only
   // starts above 17. Load at its full scene scale, then restore on close.
   if(S.map.getZoom()<17.8){S.map.stop();S.map.jumpTo({zoom:17.8,pitch:Math.max(48,S.map.getPitch())});}
   await G.prepareVR(()=>seq===sequence&&dialog.open);if(seq!==sequence||!dialog.open)return;
   void G.retryForecast();
   const source=await readyScene(seq);if(!source||seq!==sequence||!dialog.open)return;
   supported=!!(isSecureContext&&navigator.xr&&await navigator.xr.isSessionSupported('immersive-vr').catch(()=>false));
   if(!moduleTask){const url=new URL(moduleURL);url.searchParams.set('attempt',String(moduleAttempt++));moduleTask=import(url.href).catch(error=>{moduleTask=null;throw error;});}const module=await moduleTask;
   if(seq!==sequence||!dialog.open)return;
   const run=S.active?.run,manifest=S.manifest,field=source.meshSnapshot?.forecast;
   const matches=sameForecast(field,run,manifest)&&['ready','missing','error'].includes(field.status);
   const forecast={source_id:run?.source_id||null,issue_time_utc:manifest?.issue_time_utc||null,target_time_utc:run?.target_time_utc||null,lead_hours:run?.lead_hours||null,resolution:matches?field.resolution||5000:5000,field_status:matches?field.status:'unavailable'};
   if(source.meshSnapshot&&!matches)source.meshSnapshot={...source.meshSnapshot,emitters:[],forecast};
   const readyMessage=()=>(supported?'Ready for VR. Put on your headset, then select Enter VR.':'3D preview is available here. Enter VR using a WebXR-compatible headset browser.')+(forecast.field_status==='ready'?'':' Forecast fire effects are unavailable for this selection.');
   const data=module.capture({...source,forecast,mobile:matchMedia('(max-width:640px),(max-height:500px) and (pointer:coarse)').matches});context.title=forecast.field_status==='ready'?'Issued '+forecast.issue_time_utc:'Local landscape; forecast effects are not shown.';
   if(restorePause===null){restorePause=G.simulation.state.paused;G.simulation.pause(true);}
   context.textContent=data.center[1].toFixed(4)+'°, '+data.center[0].toFixed(4)+'°'+(forecast.field_status==='ready'?' · +'+forecast.lead_hours+'h · '+forecast.target_time_utc.replace('T',' ').replace('Z',' UTC'):' · Local landscape');
   note.replaceChildren(document.createTextNode('Trigger: teleport · Thumbstick: turn. Home, Pause fire and Exit VR are available inside the headset. '+data.terrainSource+'. '));
   const credit=element('a','Terrain sources');credit.href='assets/Terrain-ATTRIBUTION.txt';credit.target='_blank';credit.rel='noopener noreferrer';note.append(credit);note.hidden=false;
   const next=await module.createViewer(viewport,data,{onSession:active=>{if(seq!==sequence||!dialog.open)return;enter.textContent=active?'Exit VR':'Enter VR';retry.disabled=places.disabled=qualitySelect.disabled=active;report(active?'VR is active. Use the in-headset Exit VR control to return.':readyMessage());},onFailure:message=>{if(seq!==sequence||!dialog.open)return;enter.disabled=true;report(message);}});
   if(seq!==sequence||!dialog.open){await next.dispose();return;}viewer=next;window.fireEyeVR.viewer=next;window.fireEyeVR.snapshot={forecast,center:data.center,counts:data.counts,quality:data.quality,terrainSource:data.terrainSource,terrainResolutionMetres:source.terrainResolutionMetres||null};enter.disabled=!supported;enter.textContent='Enter VR';
   report(readyMessage());
  }catch(error){if(seq===sequence){restore();report(/^(VR (?:terrain|scene)|Mapped terrain|Local (?:terrain|scene)|Terrain is|No mapped ground|This scene exceeds|Choose a location|The selected risk)/.test(error.message||'')?error.message:'VR could not load. Reload the scene or return to the map.');}}
  finally{if(seq===sequence){busy=false;retry.disabled=places.disabled=false;qualitySelect.disabled=!!viewer?.sessionActive;qualitySelect.value=G.simulation.state.loadedQuality||G.simulation.state.assetQuality;}}
 }
 function open(event){if(dialog.open)return;opener=event?.currentTarget instanceof HTMLElement?event.currentTarget:mapButton;window.dispatchEvent(new Event('fire-eye:vr-open'));S.map.stop();savedView=captureView();restoreIntent=G.requested;dialog.showModal();const point=valid(S.selected)&&S.map.getBounds().contains(S.selected)?S.selected.slice():S.map.getCenter().toArray();void loadLocation(point);}
 enter.onclick=()=>{if(!viewer||busy||!supported)return;if(viewer.sessionActive){void viewer.endSession();return;}busy=true;enter.disabled=true;
  viewer.enterVR().catch(error=>report(error.message)).finally(()=>{busy=false;enter.disabled=!supported;});
 };
 retry.onclick=()=>{if(!busy&&!viewer?.sessionActive){if(chooser.hidden)void prepare();else void chooseLocation();}};places.onclick=()=>{if(!viewer?.sessionActive)void chooseLocation();};openButton.onclick=sideButton.onclick=mapButton.onclick=open;
 qualitySelect.onchange=async()=>{if(busy||viewer?.sessionActive)return;busy=true;qualitySelect.disabled=true;const seq=sequence;report('Loading selected materials…');await G.simulation.setQuality(qualitySelect.value);if(seq!==sequence||!dialog.open)return;busy=false;if(G.simulation.state.qualityError){qualitySelect.disabled=false;qualitySelect.value=G.simulation.state.loadedQuality;report('The selected materials could not load. Your previous scene is still available.');return;}await prepare();};
 window.fireEyeVR={open,close:closeView,viewer:null,snapshot:null};
 window.addEventListener('pagehide',()=>{void closeView();},{once:true});
})().catch(()=>{});
