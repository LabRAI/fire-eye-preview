'use strict';
(async function(){
 for(let n=0;n<600&&!window.fireEyePlatform?.ready;n++)await new Promise(r=>setTimeout(r,100));
 const S=window.fireEyePreview,P=window.fireEyePlatform;if(!P?.ready||!S?.map||!window.FireEyeGeographicScene)return;
 const controller=FireEyeGeographicScene.mount(S.map,{
  catalogURL:'assets/geography/catalog.json',
  ensureStreet:async()=>{const select=document.getElementById('basemap');if(select.value!=='street'){select.value='street';await select.onchange();}},
  onDetailScale:factor=>{S.geographyRiskFactor=factor;S.syncHeatmapDisplay?.();},
  openIllustration:()=>window.fireEyeScene?.openIllustrative?.(),
  onObject:detail=>window.dispatchEvent(new CustomEvent('fire-eye:mapped-object',{detail}))
 });
 window.fireEyeGeography=controller;
})().catch(()=>{});
