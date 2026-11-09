/* Optional immersive rendering. No XR session or large module without a click. */
(async()=>{
 const moduleURL=new URL('./vr-viewer.js?v=14ebbca45b6628f2',document.currentScript.src);let moduleAttempt=0;
 for(let i=0;i<600&&!window.fireEyeGeography;i++)await new Promise(r=>setTimeout(r,100));
 const G=window.fireEyeGeography,S=window.fireEyePreview;if(!G||!S)return;
 const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 const openButton=element('button','VR'),sideButton=element('button','Virtual reality','wide-button');openButton.id='scene-vr-open';sideButton.id='scene-vr-sidebar';openButton.type=sideButton.type='button';
 G.panel.querySelector('.mapped-scene-actions')?.append(openButton);document.getElementById('scene-controls-open')?.after(sideButton);
 const visibility=()=>{sideButton.hidden=S.map.getZoom()<15.5;};S.map.on('zoomend',visibility);visibility();
 const dialog=element('dialog',null,'vr-dialog');dialog.id='vr-dialog';dialog.setAttribute('aria-label','Virtual reality');
 const head=element('div',null,'vr-heading'),title=element('h2','Virtual reality'),close=element('button','×','vr-close');close.id='vr-close';close.type='button';close.setAttribute('aria-label','Close virtual reality');head.append(title,close);
 const context=element('p',null,'vr-context'),viewport=element('div',null,'vr-viewport'),status=element('p',null,'vr-status'),actions=element('div',null,'vr-actions'),enter=element('button','Enter VR'),retry=element('button','Reload scene');enter.id='vr-enter';retry.id='vr-reload';enter.type=retry.type='button';status.setAttribute('role','status');
 const note=element('p','Trigger: point and teleport. Thumbstick: turn in 30° steps. Home, Pause fire and Exit VR are available inside the headset. The scene uses the selected forecast snapshot; fire effects are illustrative.','vr-note');
 actions.append(enter,retry);dialog.append(head,context,viewport,status,actions,note);document.body.append(dialog);
 let savedView=null,viewer=null,moduleTask=null,sequence=0,restorePause=null,supported=false,busy=false;
 const report=(message)=>{status.textContent=message;};
 function restore(){if(restorePause!==null){G.simulation.pause(restorePause);restorePause=null;}}
 async function closeView(){sequence++;const old=viewer;viewer=null;dialog.close();restore();if(savedView){const view=savedView;savedView=null;S.map.jumpTo(view);}window.fireEyeVR.viewer=null;await old?.dispose();}
 close.onclick=()=>{void closeView();};dialog.addEventListener('cancel',e=>{e.preventDefault();void closeView();});
 async function prepare(){
  const seq=++sequence;busy=true;enter.disabled=true;retry.disabled=true;report('Preparing the selected geographic scene…');const old=viewer;viewer=null;window.fireEyeVR.viewer=null;await old?.dispose();viewport.replaceChildren();
  try{
   supported=!!(isSecureContext&&navigator.xr&&await navigator.xr.isSessionSupported('immersive-vr').catch(()=>false));
   if(!moduleTask){const url=new URL(moduleURL);url.searchParams.set('attempt',String(moduleAttempt++));moduleTask=import(url.href).catch(error=>{moduleTask=null;throw error;});}const module=await moduleTask;
   if(seq!==sequence||!dialog.open)return;
   const source=G.vrSource(),run=S.active?.run,manifest=S.manifest;if(!run||!manifest)throw Error('Select a published forecast before opening VR.');
   if(source.meshSnapshot?.groups.length&&(!source.meshSnapshot.forecast||source.meshSnapshot.forecast.status==='loading'||source.meshSnapshot.forecast.source_id!==run.source_id))throw Error('The selected risk field is still loading. Reload the scene in a moment.');
   const forecast={source_id:run.source_id,issue_time_utc:manifest.issue_time_utc,target_time_utc:run.target_time_utc,lead_hours:run.lead_hours,resolution:source.meshSnapshot?.forecast?.resolution||5000,field_status:source.meshSnapshot?.forecast?.status||'unavailable'};
   const data=module.capture({...source,forecast});context.title='Issued '+forecast.issue_time_utc;
   if(restorePause===null){restorePause=G.simulation.state.paused;G.simulation.pause(true);}
   context.textContent=data.center[1].toFixed(4)+'°, '+data.center[0].toFixed(4)+'° · +'+forecast.lead_hours+'h · '+forecast.target_time_utc.replace('T',' ').replace('Z',' UTC');
   const next=await module.createViewer(viewport,data,{onSession:active=>{enter.textContent=active?'Exit VR':'Enter VR';retry.disabled=active;report(active?'VR is active. Use the in-headset Exit VR control to return.':supported?'Ready for VR. Put on your headset, then select Enter VR.':'3D preview is available here. Enter VR using a WebXR-compatible headset browser.');},onFailure:message=>{enter.disabled=true;report(message);}});
   if(seq!==sequence||!dialog.open){await next.dispose();return;}viewer=next;window.fireEyeVR.viewer=next;window.fireEyeVR.snapshot={forecast,center:data.center,counts:data.counts};enter.disabled=!supported;enter.textContent='Enter VR';
   report(supported?'Ready for VR. Put on your headset, then select Enter VR.':'3D preview is available here. Enter VR using a WebXR-compatible headset browser.');
  }catch(error){if(seq===sequence){restore();report(/^(Mapped terrain|Terrain is|No mapped ground|This scene exceeds|Select a published|The selected risk)/.test(error.message||'')?error.message:'VR could not load. Reload the scene or return to the map.');}}
  finally{if(seq===sequence){busy=false;retry.disabled=false;}}
 }
 function open(){if(dialog.open)return;window.dispatchEvent(new Event('fire-eye:vr-open'));S.map.stop();savedView={center:S.map.getCenter().toArray(),zoom:S.map.getZoom(),pitch:S.map.getPitch(),bearing:S.map.getBearing()};dialog.showModal();void prepare();}
 enter.onclick=()=>{if(!viewer||busy||!supported)return;if(viewer.sessionActive){void viewer.endSession();return;}busy=true;enter.disabled=true;
  viewer.enterVR().catch(error=>report(error.message)).finally(()=>{busy=false;enter.disabled=!supported;});
 };
 retry.onclick=()=>{if(!busy&&!viewer?.sessionActive)void prepare();};openButton.onclick=sideButton.onclick=open;
 window.fireEyeVR={open,close:closeView,viewer:null,snapshot:null};
 window.addEventListener('pagehide',()=>{void closeView();},{once:true});
})().catch(()=>{});
