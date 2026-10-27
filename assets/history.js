'use strict';
(function(){
 const $=id=>document.getElementById(id),section=$('history-section'),body=$('history-body');
 const node=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
 const date=v=>v?new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(v))+' UTC':'Not reported';
 let worker=null,generation=0,currentKey='',result=null,indexCache=null,loadedAt=0;
 const config=fetch('config.json',{signal:AbortSignal.timeout(6000)}).then(r=>r.json());config.catch(()=>{});
 function selected(){const S=window.fireEyePreview,P=window.fireEyePlatform;if(!S?.selected||!P?.ready)return null;return {lnglat:[...S.selected],radius:P.radius,cutoff:S.manifest.archive?new Date(Math.min(Date.now(),Date.parse(S.active.run.target_time_utc))).toISOString():new Date().toISOString(),includePrescribed:$('history-prescribed').checked,source:S.active.run.source_id};}
 function key(q){return JSON.stringify([q.lnglat,q.radius,q.cutoff.slice(0,16),q.includePrescribed,q.source]);}
 function retry(message){body.replaceChildren(node('p',message,'context-note'));const b=node('button','Retry past reports','wide-button');b.onclick=()=>load(true);body.append(b);body.setAttribute('aria-busy','false');}
 function render(m){
  body.replaceChildren();body.setAttribute('aria-busy','false');if(m.error){retry(m.error);return;}
  if(m.beforeArchive){body.append(node('p','This date precedes the retained report archive.','context-note'));return;}
  body.append(node('p',m.count.toLocaleString()+' distinct reported incidents','history-count'),node('p','Saved reports · '+date(m.first)+' – '+date(m.last),'context-note'));
  if(!m.count)body.append(node('p','No saved reports intersect this selection in the archive period. This does not establish that no fire occurred.','context-note'));
  let shown=0;const list=node('div','','history-list'),more=node('button','Show more reports','wide-button');
  function append(){for(const r of m.records.slice(shown,shown+10)){const item=node('details','','history-record'),summary=node('summary',r.name||'Unnamed reported incident'),fields=node('div','','history-record-body');item.append(summary);fields.append(node('p',(r.type==='RX'?'Prescribed fire':r.type==='CX'?'Incident complex':'Wildfire')+(typeof r.acres==='number'?' · '+r.acres.toLocaleString('en-US',{maximumFractionDigits:1})+' acres reported':'')));if(r.discoveredAt)fields.append(node('p','Discovery reported '+date(r.discoveredAt)));if(r.updatedAt)fields.append(node('p','Report updated '+date(r.updatedAt)));if(typeof r.contained==='number')fields.append(node('p',r.contained.toFixed(0)+'% reported containment'));fields.append(node('p','Saved revision last seen '+date(r.report_last_seen_utc)));item.append(fields);list.append(item);}shown+=10;more.hidden=shown>=m.records.length;}
  append();more.onclick=append;body.append(list,more,node('p','NIFC / WFIGS · one record per incident ID; complex totals are omitted when member reports match. Areas describe the whole incident. Saved reports do not confirm current burning.','context-note'));
  if(m.rejected)body.append(node('p','Some saved geometries could not be evaluated.','context-note'));
  const download=node('button','Download matching reports (CSV)','wide-button');download.onclick=()=>{const fields=['id','name','type','acres','contained','longitude','latitude','discoveredAt','updatedAt','report_last_seen_utc'];const safe=v=>{const s=String(v??'');return '"'+(/^[=+@\-]/.test(s)?"'":'')+s.replaceAll('"','""')+'"';};const csv=[fields,...m.records.map(r=>fields.map(f=>r[f]))].map(row=>row.map(safe).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'})),a=node('a','');a.href=url;a.download='Fire-eye-past-reports.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};download.disabled=!m.count;body.append(download);
 }
 async function load(force=false){
  const q=selected();if(!q)return;const k=key(q);if(!force&&k===currentKey){if(result)render(result);return;}currentKey=k;result=null;const id=++generation;body.replaceChildren(node('p','Loading nearby saved reports…','context-note'));body.setAttribute('aria-busy','true');
  try{
   if(!indexCache||Date.now()-loadedAt>120000){const c=await config;if(!c.history_url)throw Error();const r=await fetch(c.history_url,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const m=await r.json();if(m.schema_version!==2||!Array.isArray(m.tiles)||m.tiles.length>500||!Array.isArray(m.snapshot_times_ms)||m.snapshot_times_ms.length>100000||!m.assets)throw Error();for(const a of Object.values(m.assets))if(!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isInteger(a.bytes)||a.bytes<=0||a.bytes>8*1024*1024)throw Error();indexCache=m;loadedAt=Date.now();}
   if(id!==generation)return;
   if(!worker){worker=new Worker('assets/history-worker.js?v=e1f64ff049f2f76d');worker.onmessage=e=>{const m=e.data;if(m.id!==generation)return;result=m;window.fireEyeHistory.result=m;render(m);};worker.onerror=()=>{worker.terminate();worker=null;result=null;retry('Past reports are temporarily unavailable. Other map features remain available.');};}
   worker.postMessage({...q,id,manifest:indexCache});
  }catch{if(id===generation)retry('Past reports could not be loaded. Retry this section when ready.');}
 }
 section.addEventListener('toggle',()=>{if(section.open)load();});$('history-prescribed').onchange=()=>load(true);
 window.addEventListener('fire-eye:regional-details',()=>{const q=selected();if(!q||key(q)===currentKey)return;generation++;currentKey='';result=null;body.replaceChildren(node('p','Open to explore dated reports near this selection.','context-note'));if(section.open)load();});
 window.addEventListener('fire-eye:selection-closed',()=>{generation++;currentKey='';result=null;worker?.terminate();worker=null;});
 window.fireEyeHistory={load,get result(){return result;},set result(value){result=value;}};
})();
