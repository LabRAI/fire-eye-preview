/* Optional, read-only simulation entry for the public geographic-scene demo. */
(async function(){
 'use strict';
 const query=new URLSearchParams(location.search);if(query.get('simulation')!=='1')return;
 const point=[Number(query.get('lng')),Number(query.get('lat'))];
 const valid=query.has('lng')&&query.has('lat')&&point.every(Number.isFinite)&&Math.abs(point[0])<=180&&Math.abs(point[1])<=90;
 const session=query.get('scene_session')||'';let parentOrigin=null;
 try{const origin=new URL(query.get('parent_origin'));if(origin.origin===location.origin||origin.origin==='https://labrai.github.io'||(origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname)))parentOrigin=origin.origin;}catch{}
 const embedded=window.parent!==window&&query.get('simulation_embed')==='1'&&parentOrigin&&/^[a-zA-Z0-9-]{10,80}$/.test(session);
 const send=(type,extra={})=>{if(embedded)window.parent.postMessage({channel:'fire-eye-simulation',type,session,...extra},parentOrigin);};
 if(embedded)document.body.classList.add('simulation-embedded');
 if(!valid){send('error');return;}
 send('loading');
 for(let n=0;n<600&&!(window.fireEyeScene?.ready&&window.fireEyePreview?.active);n++)await new Promise(r=>setTimeout(r,100));
 const scene=window.fireEyeScene;if(!scene?.ready||!window.fireEyePreview?.active){send('error');return;}
 const dialog=document.getElementById('scene-dialog'),stage=document.getElementById('scene-stage'),retry=document.getElementById('scene-retry');
 if(embedded){
  document.getElementById('scene-map-location')?.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();send('return-map',{lnglat:scene.selection?.lnglat});scene.close();},true);
  dialog.addEventListener('close',()=>{if(!dialog.open)send('closed');});
  const ready=new MutationObserver(()=>{if(stage.dataset.ready==='true')send('ready',{lnglat:scene.selection?.lnglat,sourceId:scene.selection?.run.source_id,targetTime:scene.selection?.run.target_time_utc});});ready.observe(stage,{attributes:true,attributeFilter:['data-ready']});
  const failed=new MutationObserver(()=>{if(!retry.hidden)send('error');});failed.observe(retry,{attributes:true,attributeFilter:['hidden']});
  addEventListener('pagehide',()=>{ready.disconnect();failed.disconnect();scene.close();},{once:true});
 }
 if(!scene.openAt(point))send('error');
})().catch(()=>{});
