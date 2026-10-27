/* Dated report selection shared by browser queries and regression fixtures. */
(function(root){
 'use strict';
 const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
 function lastAt(values,limit){let lo=0,hi=values.length;while(lo<hi){const mid=(lo+hi)>>>1;if(values[mid]<=limit)lo=mid+1;else hi=mid;}return lo-1;}
 function select(index,payloads,query,intersects){
  const cutoff=Date.parse(query.cutoff),times=index.snapshot_times_ms,limit=lastAt(times,cutoff),seen=new Set(),latest=new Map();let rejected=0;
  if(!Number.isFinite(cutoff))throw Error('Invalid archive cutoff');
  for(const data of payloads)for(const report of data.reports){
   if(seen.has(report.revision)||!overlaps(report.bounds,query.bounds))continue;
   seen.add(report.revision);const at=lastAt(report.snapshot_indices,limit),record=report.record;
   if(at<0||(!query.includePrescribed&&record.type==='RX'))continue;
   if([record.discoveredAt,record.updatedAt].some(t=>t&&(!Number.isFinite(Date.parse(t))||Date.parse(t)>cutoff)))continue;
   try{if(!intersects(data.geometries[report.geometry_index]))continue;}catch{rejected++;continue;}
   const last=times[report.snapshot_indices[at]],old=latest.get(record.id);
   if(!old||last>old.last||last===old.last&&report.revision>old.revision)latest.set(record.id,{report,last,first:times[report.snapshot_indices[0]]});
  }
  const parents=new Set([...latest.values()].map(r=>r.report.parent).filter(Boolean));
  const records=[...latest.values()].filter(r=>!parents.has(r.report.record.id)).sort((a,b)=>b.last-a.last||a.report.record.id.localeCompare(b.report.record.id)).map(r=>({...r.report.record,revision:r.report.revision,report_first_seen_utc:new Date(r.first).toISOString(),report_last_seen_utc:new Date(r.last).toISOString()}));
  return {records,count:records.length,first:index.first_snapshot_utc,last:limit>=0?new Date(Math.min(cutoff,Date.parse(index.last_snapshot_utc))).toISOString():null,beforeArchive:limit<0,rejected};
 }
 const api={select,lastAt,overlaps};if(typeof module!=='undefined')module.exports=api;else root.FireHistory=api;
})(globalThis);
