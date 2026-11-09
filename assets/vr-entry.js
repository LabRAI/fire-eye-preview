/* Optional immersive rendering. Explicit, persistent entry; large renderer stays lazy. */
(async()=>{
 const moduleURL=new URL('./vr-viewer.js?v=5ed789199824c894',document.currentScript.src);let moduleAttempt=0;
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
 const chooser=element('section',null,'vr-chooser'),intro=element('p','Choose a mapped location to explore. A 3D preview opens here; a compatible headset can enter VR.'),current=element('button','Use map center','vr-location'),currentHint=element('p',null,'vr-location-hint'),examples=element('div',null,'vr-locations');
 chooser.id='vr-chooser';chooser.hidden=true;current.id='vr-use-center';current.type='button';examples.id='vr-locations';chooser.append(intro,current,currentHint,examples);
 const note=element('p','Trigger: point and teleport. Thumbstick: turn in 30° steps. Home, Pause fire and Exit VR are available inside the headset. The scene uses the selected forecast snapshot; fire effects are illustrative.','vr-note');
 actions.append(enter,retry,places);dialog.append(head,context,chooser,viewport,status,actions,note);document.body.append(dialog);
 let savedView=null,viewer=null,moduleTask=null,sequence=0,restorePause=null,supported=false,busy=false,areaTask=null,opener=null;
 const report=message=>{status.textContent=message;};
 function restore(){if(restorePause!==null){G.simulation.pause(restorePause);restorePause=null;}}
 function captureView(){return {center:S.map.getCenter().toArray(),zoom:S.map.getZoom(),pitch:S.map.getPitch(),bearing:S.map.getBearing()};}
 async function closeView(){sequence++;busy=false;const old=viewer;viewer=null;dialog.close();restore();if(savedView){const view=savedView;savedView=null;S.map.stop();S.map.jumpTo(view);}window.fireEyeVR.viewer=null;window.fireEyeVR.snapshot=null;opener?.focus({preventScroll:true});await old?.dispose();}
 close.onclick=()=>{void closeView();};dialog.addEventListener('cancel',e=>{e.preventDefault();void closeView();});
 async function areas(){if(!areaTask)areaTask=Promise.all(['assets/geography/environment/catalog.json','assets/geography/catalog.json'].map(u=>fetch(u,{signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw Error('Scene catalog unavailable');return r.json();}))).then(([terrain,scenes])=>{if(terrain.kind!=='scene-environment'||scenes.kind!=='geographic-scene-catalog'||!Array.isArray(terrain.areas)||!Array.isArray(scenes.areas))throw Error('Invalid scene catalog');return terrain.areas.filter(a=>Array.isArray(a.center)&&a.center.length===2&&a.center.every(Number.isFinite)&&Array.isArray(a.bounds)&&a.bounds.length===4&&a.bounds.every(Number.isFinite)&&scenes.areas.some(s=>{const b=s.bbox_wgs84;return Array.isArray(b)&&a.center[0]>b[0]&&a.center[0]<b[2]&&a.center[1]>b[1]&&a.center[1]<b[3];}));}).catch(e=>{areaTask=null;throw e;});return areaTask;}
 async function chooseLocation(){const seq=++sequence;busy=false;const old=viewer;viewer=null;window.fireEyeVR.viewer=null;await old?.dispose();if(seq!==sequence||!dialog.open)return;
  restore();chooser.hidden=false;viewport.hidden=true;viewport.replaceChildren();context.textContent='Explore a local scene';enter.hidden=true;retry.hidden=true;places.hidden=true;note.hidden=true;current.disabled=true;examples.replaceChildren();report('Loading available locations…');
  try{const locations=await areas();if(seq!==sequence||!dialog.open)return;const center=S.map.getCenter().toArray(),inside=locations.some(a=>center[0]>a.bounds[0]&&center[0]<a.bounds[2]&&center[1]>a.bounds[1]&&center[1]<a.bounds[3]);
   current.disabled=!inside;currentHint.textContent=inside?center[1].toFixed(4)+'°, '+center[0].toFixed(4)+'° · current map center':'VR terrain is available in the mapped areas below.';
   current.onclick=()=>{void loadLocation(center);};
   for(const a of locations){const b=element('button',a.title,'vr-location');b.type='button';b.dataset.area=a.id;b.addEventListener('click',()=>{void loadLocation(a.center);});examples.append(b);}report('Select a location to begin.');
  }catch{if(seq===sequence){report('Locations could not load. Retry or return to the map.');retry.hidden=false;}}
 }
 async function loadLocation(center){if(busy)return;busy=true;const seq=sequence;chooser.hidden=true;viewport.hidden=false;places.hidden=false;context.textContent=center[1].toFixed(4)+'°, '+center[0].toFixed(4)+'°';report('Preparing the selected location…');
  // Trigger the normal geographic loaders without reopening dismissed simulation controls.
  if(seq!==sequence||!dialog.open)return;S.map.stop();S.map.jumpTo({center,zoom:17.8,pitch:52,bearing:S.map.getBearing()});await prepare();
 }
 async function readyScene(seq){const locations=await areas(),center=S.map.getCenter().toArray();const contains=b=>Array.isArray(b)&&center[0]>b[0]&&center[0]<b[2]&&center[1]>b[1]&&center[1]<b[3];const target=locations.find(a=>contains(a.bounds));if(!target)throw Error('VR terrain is not published here. Select Choose location to explore a mapped area.');const start=Date.now();while(seq===sequence&&dialog.open){const source=G.vrSource(),run=S.active?.run;const field=source.meshSnapshot?.forecast,live=G.simulation.state;const settled=live.phase==='simulation'||live.phase==='fallback';const matches=live.phase==='fallback'||(field&&field.source_id===run?.source_id&&(field.status==='ready'||(field.status==='missing'&&!live.candidates.length)));
   if(!S.map.isMoving()&&source.terrainReady&&source.terrainArea===target.id&&contains(source.sceneBounds)&&run&&S.manifest&&settled&&matches)return source;
   if(Date.now()-start>1500&&source.terrainStatus==='outside')throw Error('VR terrain is not published here. Select Choose location to explore a mapped area.');
   if(Date.now()-start>35000)throw Error('Mapped terrain or forecast is still loading. Reload the scene or choose another location.');
   await new Promise(r=>setTimeout(r,250));
  }return null;}
 async function prepare(){
  const seq=++sequence;busy=true;chooser.hidden=true;viewport.hidden=false;enter.hidden=false;retry.hidden=false;places.hidden=false;note.hidden=false;enter.disabled=true;retry.disabled=true;report('Preparing the selected geographic scene…');const old=viewer;viewer=null;window.fireEyeVR.viewer=null;await old?.dispose();viewport.replaceChildren();
  try{
   const source=await readyScene(seq);if(!source||seq!==sequence||!dialog.open)return;
   supported=!!(isSecureContext&&navigator.xr&&await navigator.xr.isSessionSupported('immersive-vr').catch(()=>false));
   if(!moduleTask){const url=new URL(moduleURL);url.searchParams.set('attempt',String(moduleAttempt++));moduleTask=import(url.href).catch(error=>{moduleTask=null;throw error;});}const module=await moduleTask;
   if(seq!==sequence||!dialog.open)return;
   const run=S.active?.run,manifest=S.manifest;if(!run||!manifest)throw Error('Select a published forecast before opening VR.');
   if(source.meshSnapshot?.groups.length&&(!source.meshSnapshot.forecast||source.meshSnapshot.forecast.status==='loading'||source.meshSnapshot.forecast.source_id!==run.source_id))throw Error('The selected risk field is still loading. Reload the scene in a moment.');
   const forecast={source_id:run.source_id,issue_time_utc:manifest.issue_time_utc,target_time_utc:run.target_time_utc,lead_hours:run.lead_hours,resolution:source.meshSnapshot?.forecast?.resolution||5000,field_status:source.meshSnapshot?.forecast?.status||'unavailable'};
   const data=module.capture({...source,forecast});context.title='Issued '+forecast.issue_time_utc;
   if(restorePause===null){restorePause=G.simulation.state.paused;G.simulation.pause(true);}
   context.textContent=data.center[1].toFixed(4)+'°, '+data.center[0].toFixed(4)+'° · +'+forecast.lead_hours+'h · '+forecast.target_time_utc.replace('T',' ').replace('Z',' UTC');
   const next=await module.createViewer(viewport,data,{onSession:active=>{if(seq!==sequence||!dialog.open)return;enter.textContent=active?'Exit VR':'Enter VR';retry.disabled=places.disabled=active;report(active?'VR is active. Use the in-headset Exit VR control to return.':supported?'Ready for VR. Put on your headset, then select Enter VR.':'3D preview is available here. Enter VR using a WebXR-compatible headset browser.');},onFailure:message=>{if(seq!==sequence||!dialog.open)return;enter.disabled=true;report(message);}});
   if(seq!==sequence||!dialog.open){await next.dispose();return;}viewer=next;window.fireEyeVR.viewer=next;window.fireEyeVR.snapshot={forecast,center:data.center,counts:data.counts};enter.disabled=!supported;enter.textContent='Enter VR';
   report(supported?'Ready for VR. Put on your headset, then select Enter VR.':'3D preview is available here. Enter VR using a WebXR-compatible headset browser.');
  }catch(error){if(seq===sequence){restore();report(/^(VR terrain|Mapped terrain|Terrain is|No mapped ground|This scene exceeds|Select a published|The selected risk)/.test(error.message||'')?error.message:'VR could not load. Reload the scene or return to the map.');}}
  finally{if(seq===sequence){busy=false;retry.disabled=places.disabled=false;}}
 }
 function open(event){if(dialog.open)return;opener=event?.currentTarget instanceof HTMLElement?event.currentTarget:mapButton;window.dispatchEvent(new Event('fire-eye:vr-open'));S.map.stop();savedView=captureView();dialog.showModal();if(S.map.getZoom()>=15.5)void prepare();else void chooseLocation();}
 enter.onclick=()=>{if(!viewer||busy||!supported)return;if(viewer.sessionActive){void viewer.endSession();return;}busy=true;enter.disabled=true;
  viewer.enterVR().catch(error=>report(error.message)).finally(()=>{busy=false;enter.disabled=!supported;});
 };
 retry.onclick=()=>{if(!busy&&!viewer?.sessionActive){if(chooser.hidden)void prepare();else void chooseLocation();}};places.onclick=()=>{if(!viewer?.sessionActive)void chooseLocation();};openButton.onclick=sideButton.onclick=mapButton.onclick=open;
 window.fireEyeVR={open,close:closeView,viewer:null,snapshot:null};
 window.addEventListener('pagehide',()=>{void closeView();},{once:true});
})().catch(()=>{});
