'use strict';
(async()=>{
 for(let i=0;i<600;i++){if(window.fireEyePreview?.ready&&window.fireEyePlatform?.ready)break;await new Promise(r=>setTimeout(r,100));}
 const button=document.getElementById('what-if-region');if(!button)return;
 button.onclick=()=>{const S=window.fireEyePreview,P=window.fireEyePlatform,u=new URL('what-if.html',location.href);if(S?.selected){u.searchParams.set('lng',S.selected[0].toFixed(4));u.searchParams.set('lat',S.selected[1].toFixed(4));}if(S?.active?.run.source_id)u.searchParams.set('source',S.active.run.source_id);if(P?.radius)u.searchParams.set('radius',P.radius);location.href=u.href;};
})().catch(()=>{});
