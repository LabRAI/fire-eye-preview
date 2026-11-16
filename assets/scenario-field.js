/* Stable, clustered visual sampling. This illustrates risk, not fire spread. */
(function(global){
 'use strict';
 const hash=s=>{let n=2166136261;for(const c of String(s))n=Math.imul(n^c.charCodeAt(0),16777619);n^=n>>>16;n=Math.imul(n,0x7feb352d);n^=n>>>15;n=Math.imul(n,0x846ca68b);return(n^(n>>>16))>>>0;};
 const uniform=s=>(hash(s)+.5)/4294967296;
 function candidates(features,project,visible=()=>true){
  const cells=new Map();
  for(const f of features){
   const p=f.geometry?.coordinates;if(!['tree','scenario_anchor'].includes(f.properties?.kind)||f.geometry?.type!=='Point'||!p?.every(Number.isFinite)||!visible(p))continue;
   const q=project(p.slice(0,2));if(!q?.every(Number.isFinite))continue;const id='visual-cell/'+Math.floor(q[0]/50)+'/'+Math.floor(q[1]/50),rank=uniform(f.properties.source_id),old=cells.get(id);
   if(!old||rank<old.rank)cells.set(id,{id,lnglat:p.slice(0,2),projected_m:q.slice(0,2),source_id:f.properties.source_id,canopy_m:f.properties.kind==='tree'?Math.max(0,Math.min(20,Number(f.properties.height_m)||Number(f.properties.display_height_m)||8)):0,rank});
  }
  return [...cells.values()].sort((a,b)=>uniform('coverage/'+a.id)-uniform('coverage/'+b.id)).slice(0,192).sort((a,b)=>a.id.localeCompare(b.id));
 }
 function select(points,values){
  if(points.length!==values.length)throw Error('Forecast sample length mismatch');
  const sampled=[],eligible=[];let valid=0,total=0;
  for(let i=0;i<points.length;i++){const risk=values[i];if(typeof risk!=='number'||!Number.isFinite(risk)||risk<0||risk>1)continue;valid++;total+=risk;
   if(risk===0)continue;
   // Preserve the established risk-to-display transfer and fixed location seed.
   // This weight controls illustration visibility only, not the model output.
   const visualWeight=1-(1-risk)**3;
   const point={...points[i],risk,visualWeight};eligible.push(point);
   if(uniform('flame/'+point.id)<visualWeight)sampled.push(point);
  }
  const result={emitters:[],sampledCount:0,validCount:valid,mean:valid?total/valid:null,cluster:null};
  if(!sampled.length)return result;
  const distance=(a,b)=>a.projected_m?.length===2&&b.projected_m?.length===2?Math.hypot(a.projected_m[0]-b.projected_m[0],a.projected_m[1]-b.projected_m[1]):Math.hypot((a.lnglat[0]-b.lnglat[0])*Math.cos((a.lnglat[1]+b.lnglat[1])*Math.PI/360),a.lnglat[1]-b.lnglat[1])*111320;
  // Select one supported local focus, not independent fires across the scene.
  // All members retain their own sampled value and original eligible position.
  const focusScore=p=>{
   let sum=0,weight=0,count=0;for(const q of eligible){const d=distance(p,q);if(d>125)continue;const w=Math.exp(-d*d/(2*65*65));sum+=q.risk*w;weight+=w;count++;}
   return p.risk*(.65+.35*(sum/weight))*(1+Math.min(count,12)/24)*(.96+.08*uniform('cluster-center/'+p.id));
  };
  const focus=sampled.map(point=>({point,score:focusScore(point)})).sort((a,b)=>b.score-a.score||a.point.id.localeCompare(b.point.id))[0].point;
  const radius=80+40*Math.sqrt(focus.risk),threshold=uniform('flame/'+focus.id),near=eligible.map(p=>({...p,distance:distance(focus,p)})).filter(p=>p.distance<=radius);
  // A shared threshold creates correlated, compact activity. A connected growth
  // step excludes isolated distant sparks; zeros/missing cells never contribute.
  const pool=near.filter(p=>p.id===focus.id||p.visualWeight>threshold+(1-threshold)*.65*(p.distance/radius)**2);
  const chosen=[pool.find(p=>p.id===focus.id)],remaining=pool.filter(p=>p.id!==focus.id),link=80;
  while(chosen.length<32){const next=remaining.map((p,i)=>({p,i,d:Math.min(...chosen.map(q=>distance(p,q)))})).filter(x=>x.d<=link).sort((a,b)=>a.p.distance-b.p.distance||a.p.id.localeCompare(b.p.id))[0];if(!next)break;chosen.push(next.p);remaining.splice(next.i,1);}
  const clusterId='cluster/'+focus.id;
  result.emitters=chosen.map(p=>{const core=1-p.distance/radius;return {...p,strength:Math.sqrt(p.risk)*(.6+.4*core),cluster_id:clusterId,cluster_core:core,cluster_radius_m:radius,cluster_distance_m:p.distance};});
  result.sampledCount=result.emitters.length;result.cluster={id:clusterId,center:focus.lnglat.slice(),radius_m:radius};return result;
 }
 global.FireEyeScenarioField={candidates,select,uniform};
})(typeof window==='undefined'?globalThis:window);
