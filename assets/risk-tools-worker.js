'use strict';
importScripts('regional-worker.js?v=1dda24e6ca5f3517','risk-matching.js?v=2ca5972bd9d65530','risk-geometry.js?v=1c0440a3a10b1bfe');
let requestGeneration=0;
onmessage=async e=>{
 const req=e.data;requestGeneration=req.id;
 try{
  const index=await asset(req.manifest,'forecast');if(index.issue_time_utc!==req.issue)throw Error('Selected forecast does not match the numeric source.');
  const run=index.runs.find(r=>r.lead_hours===req.lead);if(!run||run.target_time_utc!==req.target)throw Error('This forecast window is not archived.');
  let result;
  if(req.task==='download'){
   const selected=FireRisk.selectedCells(req.geometry,index.grid),needed=new Set(selected.cells.map(c=>c.index)),values=new Map(),descriptor=req.manifest.assets[run.asset];
   for(const block of descriptor.blocks){if(requestGeneration!==req.id)return;const rows=Array.from(needed).filter(i=>i*4>=block.offset&&i*4<block.offset+block.bytes);if(!rows.length)continue;const data=await gridBlock(req.manifest,run.asset,block);for(const i of rows)values.set(i,data.getFloat32(i*4-block.offset,true));}
   result=FireRisk.exportRisk(selected,values,run,index.issue_time_utc);
  }else if(req.task==='summary'){
   if(!req.historical||Date.parse(req.target)>Date.now()||Math.abs(Date.parse(req.snapshot)-Date.parse(req.target))>21600000)throw Error('Observations are not available for this forecast window.');
   const data=await asset(req.manifest,run.asset);result=FireRisk.summary(index.grid,data,req.bounds,req.fires);
  }else throw Error('Unsupported regional operation.');
  if(requestGeneration===req.id)postMessage({id:req.id,task:req.task,result});
 }catch(e){if(requestGeneration===req.id)postMessage({id:req.id,task:req.task,error:req.task==='download'&&/^(Draw|Finish|Polygon|Select|No forecast)/.test(e.message)?e.message:'Published values are temporarily unavailable for this selection.'});}
};
