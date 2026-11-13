'use strict';
// Opening this dedicated route is the user's explicit request for a local scene.
// WebXR session creation stays in the Enter VR click handler, never a timer.
(async()=>{
 if(!document.body.classList.contains('vr-standalone'))return;
 const params=new URL(location.href).searchParams,view=(params.get('view')||'').split(',').map(Number),source=params.get('source'),issue=params.get('issue');
 const valid=view.length===3&&view.every(Number.isFinite)&&Math.abs(view[0])<=180&&Math.abs(view[1])<=85&&view[2]>=2&&view[2]<=20;
 const shell=document.getElementById('vr-launch-shell'),status=document.getElementById('vr-launch-status'),back=document.getElementById('vr-page-back');
 const destination=new URL('./',location.href);if(valid)destination.searchParams.set('view',[view[0],view[1],17.8].join(','));
 if(/^[A-Za-z0-9_]{1,160}$/.test(source||'')&&/^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(issue||'')){destination.searchParams.set('source',source);destination.searchParams.set('issue',issue);}
 back.href=destination.href;
 let stopped=false,retryTimer=null,automaticRetries=0;
 window.fireEyeVRPage={state:'loading',back:async()=>{if(stopped)return;stopped=true;clearTimeout(retryTimer);await window.fireEyeVR?.close();location.assign(destination.href);}};
 window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(retryTimer);},{once:true});
 // A page restored from the back/forward cache has already disposed its GPU scene.
 window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
 window.addEventListener('fire-eye:vr-state',event=>{
  if(stopped)return;clearTimeout(retryTimer);retryTimer=null;
  const phase=event.detail?.phase;window.fireEyeVRPage.state=phase==='loading'?'preparing':phase;
  if(phase==='unavailable'&&automaticRetries<1){automaticRetries++;window.fireEyeVRPage.state='retrying';retryTimer=setTimeout(()=>{retryTimer=null;if(!stopped&&document.getElementById('vr-dialog')?.open)void window.fireEyeVR?.reload();},1200);}
 });
 const fail=message=>{window.fireEyeVRPage.state='unavailable';status.textContent=message;document.getElementById('vr-page-retry').hidden=false;};
 document.getElementById('vr-page-retry').onclick=()=>location.reload();
 if(!valid){fail('Choose a location in Fire-eye, then open its VR scene.');return;}
 const deadline=Date.now()+65000;
 while(!stopped&&Date.now()<deadline){
  const V=window.fireEyeVR,N=window.fireEyeResolutionNavigation,S=window.fireEyePreview;
  if(V&&N&&S?.ready){
   if(!N.viewRestored||!N.restored||source&&(S.active?.run.source_id!==source||S.manifest.issue_time_utc!==issue)){fail('The linked forecast window could not be loaded. Retry, or return to the map to choose a published window.');return;}
   // No latest-window substitution and no synthetic example location.
   S.selected=view.slice(0,2);await V.open();if(stopped)return;shell.hidden=true;if(window.fireEyeVRPage.state==='loading')window.fireEyeVRPage.state='preparing';return;
  }
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 if(!stopped)fail('The scene could not connect. Retry, or return to Fire-eye.');
})().catch(()=>{const status=document.getElementById('vr-launch-status');if(status)status.textContent='The scene could not open. Return to Fire-eye and try again.';});
