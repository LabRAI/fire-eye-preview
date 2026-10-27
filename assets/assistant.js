'use strict';
(async function(){
 const $=id=>document.getElementById(id),text=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;};
 const config=await fetch('config.json',{signal:AbortSignal.timeout(6000)}).then(r=>r.json());
 if(!config.assistant_url)return;
 const url=new URL(config.assistant_url),local=['localhost','127.0.0.1'].includes(location.hostname)&&['localhost','127.0.0.1'].includes(url.hostname);
 if((!local&&(url.protocol!=='https:'||!url.hostname.endsWith('.hf.space')))||url.username||url.password||url.search||url.hash)throw Error('Independent service configuration required');
 const endpoint=url.href.replace(/\/$/,'')+'/chat';let P,S;
 for(let i=0;i<450;i++){P=window.fireEyePlatform;S=window.fireEyePreview;if(P?.ready)break;await new Promise(r=>setTimeout(r,100));}if(!P?.ready)return;
 let controller=null,generation=0,key='',turns=[];
 function selection(){if(!S.selected)return null;return {longitude:S.selected[0],latitude:S.selected[1],radius_km:P.radius,source_id:S.active.run.source_id,incident_id:P.incident?.properties?.id,include_prescribed:$('include-prescribed').checked};}
 function reset(){controller?.abort();controller=null;generation++;turns=[];$('assistant-messages').replaceChildren();$('assistant-forecast').hidden=true;$('assistant-forecast').replaceChildren();$('assistant-status').textContent='';$('assistant-send').disabled=false;key=JSON.stringify(selection());}
 function sync(){if(JSON.stringify(selection())!==key)reset();}
 function validate(r,q){
  if(r.version!==1||!['assistant','verified-records'].includes(r.method)||!Array.isArray(r.facts)||r.facts.length>8||!Array.isArray(r.sources)||r.sources.length>8)throw Error('Invalid assistant response');
  for(const f of r.facts)if(typeof f.text!=='string'||f.text.length>5000||!Array.isArray(f.source_ids))throw Error('Invalid assistant fact');
  if(r.forecast&&(r.forecast.source_id!==q.source_id||!Array.isArray(r.forecast.points)||r.forecast.points.length!==4))throw Error('Selection changed');
  if(r.selection&&(r.selection.longitude!==q.longitude||r.selection.latitude!==q.latitude||r.selection.radius_km!==q.radius_km))throw Error('Region changed');
  return r;
 }
 function show(r){
  const entry=text('article','', 'assistant-answer');entry.append(text('strong',r.method==='assistant'?'Flamme':'Published-records summary'));
  if(r.method==='verified-records')entry.append(text('p','Showing verified records while the language service is unavailable.','context-note'));
  const references=new Map(r.sources.map((s,i)=>[s.id,i+1]));
  for(const f of r.facts)entry.append(text('p',f.text+(f.source_ids.length?' '+f.source_ids.filter(id=>references.has(id)).map(id=>'['+references.get(id)+']').join(' '):'')));
  if(r.sources.length){const details=text('details','','assistant-sources');details.append(text('summary','Sources & dates'));for(const [i,s]of r.sources.entries()){const line=text('p','['+(i+1)+'] '),label=String(s.label||'Published data');let approved=false;try{const u=new URL(s.url);approved=u.protocol==='https:'&&u.hostname==='huggingface.co';}catch{}if(approved){const a=text('a',label);a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';line.append(a);}else line.append(text('span',label));details.append(line);}entry.append(details);}
  if(r.source_errors?.length)entry.append(text('p','Some requested source records could not be retrieved for this answer. You can retry the question.','context-note'));
  $('assistant-messages').append(entry);
  if(r.forecast){const target=$('assistant-forecast');target.hidden=false;P.renderChart('forecast',{issue:r.forecast.issue_time_utc,points:r.forecast.points.map(p=>({lead:p.lead_hours,time:p.target_time_utc,value:p.value,coverage:p.coverage}))},target);}
 }
 $('assistant-info').onclick=()=>{sync();$('assistant-panel').hidden=false;$('selection-notice').hidden=true;$('assistant-question').focus({preventScroll:true});};
 $('assistant-close').onclick=()=>{controller?.abort();generation++;$('assistant-send').disabled=false;$('assistant-panel').hidden=true;};
 $('assistant-new').onclick=()=>{reset();$('assistant-question').focus({preventScroll:true});};
 $('assistant-form').onsubmit=async e=>{
  e.preventDefault();sync();const q=selection(),question=$('assistant-question').value.trim();if(!q||!question||controller)return;
  const id=++generation,abort=new AbortController();controller=abort;$('assistant-send').disabled=true;$('assistant-status').textContent='Reading published evidence…';const timer=setTimeout(()=>abort.abort(),55000);
  const item=text('p',question,'assistant-question');$('assistant-messages').append(item);
  try{
   const response=await fetch(endpoint,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({selection:q,question,history:turns.slice(-3)}),signal:abort.signal});
   if(!response.headers.get('Content-Type')?.includes('application/json'))throw Error('The assistant could not be reached. The map remains available.');
   const raw=await response.text();if(raw.length>100000)throw Error('The response could not be verified.');const r=JSON.parse(raw);
   if(!response.ok)throw Error(response.status===429?'Flamme is answering other questions. Please retry shortly.':'This answer could not be loaded. Please retry; your map remains available.');
   validate(r,q);if(id!==generation)return;show(r);turns.push({role:'user',content:question});$('assistant-question').value='';$('assistant-status').textContent='';
  }catch(error){if(id===generation)$('assistant-status').textContent=abort.signal.aborted?'This answer took too long. Please retry; your map remains available.':error instanceof SyntaxError?'The assistant returned an unreadable response. Please retry.':error.message;}
  finally{clearTimeout(timer);if(controller===abort)controller=null;if(id===generation)$('assistant-send').disabled=false;}
 };
 window.addEventListener('fire-eye:selection-changed',sync);window.addEventListener('fire-eye:selection-closed',()=>{reset();$('assistant-panel').hidden=true;});
 window.fireEyeAssistant={enabled:true};
})().catch(()=>{/* Optional service initialization never controls map startup. */});
