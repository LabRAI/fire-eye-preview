'use strict';
// The standard map does not fetch experimental assets until this link is followed.
(function(){
 const experimental=document.body.classList.contains('resolution-lab'),link=document.getElementById('resolution-lab-link');if(!link)return;
 function destination(){
  const S=window.fireEyePreview,url=new URL(experimental?'./':'resolution.html',location.href);if(!S?.ready||!S.map)return url.href;
  const center=S.map.getCenter();if(S.active?.run?.source_id)url.searchParams.set('source',S.active.run.source_id);
  if(experimental&&S.manifest?.issue_time_utc)url.searchParams.set('issue',S.manifest.issue_time_utc);
  url.searchParams.set('view',[center.lng.toFixed(5),center.lat.toFixed(5),S.map.getZoom().toFixed(2)].join(','));return url.href;
 }
 for(const item of [link,...document.querySelectorAll('.resolution-return')])for(const event of ['pointerenter','focus','click'])item.addEventListener(event,()=>{item.href=destination();});
 if(experimental){document.getElementById('archive-open')?.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();location.href=destination();},true);return;}
 const params=new URL(location.href).searchParams,source=params.get('source'),issue=params.get('issue'),view=(params.get('view')||'').split(',').map(Number);
 const validView=view.length===3&&view.every(Number.isFinite)&&view[0]>=-128.4&&view[0]<=-64&&view[1]>=22&&view[1]<=53&&view[2]>=2&&view[2]<=16;
 if(!source&&!validView)return;
 (async()=>{
  for(let i=0;i<600;i++){if(window.fireEyePreview?.ready&&window.fireEyePlatform?.ready&&window.fireEyeForecastHistory?.ready)break;await new Promise(r=>setTimeout(r,100));}
  const S=window.fireEyePreview,P=window.fireEyePlatform,H=window.fireEyeForecastHistory;if(!S?.ready||!P?.ready)return;
  let restored=!source;try{
   if(source&&/^[A-Za-z0-9_]{1,160}$/.test(source)){
    const latest=S.latestManifest||S.manifest,current=latest.runs.find(r=>r.source_id===source);
    if(current){if(S.manifest.release_id!==latest.release_id)await S.showManifest(latest,current.lead_hours);else await S.select(current.lead_hours);restored=S.active?.run.source_id===source;}
    else if(H?.ready&&/^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(issue||'')){
     const catalog=H.catalog||await H.loadCatalog(),row=catalog.months.find(r=>r.month===issue.slice(0,7));
     if(row){const month=await H.loadMonth(row,AbortSignal.timeout(18000)),m=month.releases.find(r=>r.issue_time_utc===issue&&r.runs.some(x=>x.source_id===source));
      if(m){const run=m.runs.find(r=>r.source_id===source);if(await P.selectArchive(m)!==false){await S.select(run.lead_hours);restored=S.active?.run.source_id===source;}}
     }
    }
   }
  }catch{/* Preserve the native map if this archived selection cannot be retrieved. */}
  if(validView)S.map.jumpTo({center:view.slice(0,2),zoom:view[2]});
  if(source&&!restored)P.notice('The requested archived window could not be restored. The displayed map keeps its labeled date.');
  window.fireEyeResolutionNavigation={restored,source:restored?S.active?.run.source_id:null,viewRestored:validView};
 })().catch(()=>{});
})();
