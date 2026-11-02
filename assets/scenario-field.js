/* Stable visual sampling of a forecast field. Not an ignition model. */
(function(global){
 'use strict';
 const hash=s=>{let n=2166136261;for(const c of String(s))n=Math.imul(n^c.charCodeAt(0),16777619);n^=n>>>16;n=Math.imul(n,0x7feb352d);n^=n>>>15;n=Math.imul(n,0x846ca68b);return(n^(n>>>16))>>>0;};
 const uniform=s=>(hash(s)+.5)/4294967296;
 function candidates(features,project,visible=()=>true){
  const cells=new Map();
  for(const f of features){
   const p=f.geometry?.coordinates;if(!['tree','scenario_anchor'].includes(f.properties?.kind)||f.geometry?.type!=='Point'||!p?.every(Number.isFinite)||!visible(p))continue;
   const q=project(p.slice(0,2));if(!q?.every(Number.isFinite))continue;const id='visual-cell/'+Math.floor(q[0]/50)+'/'+Math.floor(q[1]/50),rank=uniform(f.properties.source_id),old=cells.get(id);
   if(!old||rank<old.rank)cells.set(id,{id,lnglat:p.slice(0,2),source_id:f.properties.source_id,canopy_m:f.properties.kind==='tree'?Math.max(0,Math.min(20,Number(f.properties.height_m)||Number(f.properties.display_height_m)||8)):0,rank});
  }
  return [...cells.values()].sort((a,b)=>uniform('coverage/'+a.id)-uniform('coverage/'+b.id)).slice(0,192).sort((a,b)=>a.id.localeCompare(b.id));
 }
 function select(points,values){
  if(points.length!==values.length)throw Error('Forecast sample length mismatch');
  const sampled=[];let valid=0,total=0;
  for(let i=0;i<points.length;i++){const risk=values[i];if(typeof risk!=='number'||!Number.isFinite(risk)||risk<0||risk>1)continue;valid++;total+=risk;
   // The threshold is fixed by location, independent of date and device.
   // Three bounded visual trials improve legibility; this display weight is
   // explicitly not an ignition probability. Model values remain unchanged.
   // Only changes in the selected field can add/remove a sampled emitter.
   const visualWeight=1-(1-risk)**3;
   if(risk>0&&uniform('flame/'+points[i].id)<visualWeight)sampled.push({...points[i],risk,strength:Math.sqrt(risk)});
  }
  sampled.sort((a,b)=>uniform('budget/'+a.id)-uniform('budget/'+b.id));
  return {emitters:sampled.slice(0,64),sampledCount:sampled.length,validCount:valid,mean:valid?total/valid:null};
 }
 global.FireEyeScenarioField={candidates,select,uniform};
})(typeof window==='undefined'?globalThis:window);
