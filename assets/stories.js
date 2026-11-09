/* Source-linked, read-only stories. Images remain tied to retained forecast evidence. */
'use strict';
(()=>{
const $=id=>document.getElementById(id);
const FEED='https://huggingface.co/datasets/yx21e/fire-eye-forecasts-preview/resolve/main/community.json';
const HF='https://huggingface.co/datasets/yx21e/fire-eye-forecasts-preview/resolve/';
const params=new URLSearchParams(location.search);
let feed,loading=false,editionId=params.get('edition')||'selected',caseId=params.get('case'),imageController;
const imageCache=new Map();
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n;};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const number=n=>finite(n)?n.toLocaleString('en-US'):'—';
function date(t){if(!t)return 'Date under review';const d=new Date(t);if(!Number.isFinite(+d))return 'Date under review';if(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(t))return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});return d.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'})+' UTC';}
function safeURL(v){try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function anchor(label,value){const a=el('a',label);const u=safeURL(value);if(u){a.href=u;a.target='_blank';a.rel='noopener noreferrer';}return a;}
function save(name,data){const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=el('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);}
async function request(url,timeout,signal){const c=new AbortController(),abort=()=>c.abort();if(signal?.aborted)c.abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeout);try{const r=await fetch(url,{signal:c.signal,cache:'no-cache'});if(!r.ok)throw Error('Unavailable publication');return await r.arrayBuffer();}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
async function json(url,timeout){const b=await request(url,timeout);if(b.byteLength>8000000)throw Error('Publication too large');const j=JSON.parse(new TextDecoder().decode(b));if(j.schema!=='fire-eye-community-v1'||!Array.isArray(j.stories))throw Error('Invalid publication');return j;}
function status(saved=false){$('community-status').textContent=(saved?'Saved publication · ':'Published ')+date(feed.published_at_utc);}
async function load(){if(loading)return;loading=true;$('community-refresh').disabled=true;try{
 if(!feed){try{feed=await json('community-bootstrap.json',3000);status(true);render();}catch{}}
 try{const next=await json(FEED,8000);const changed=!feed||next.content_sha256!==feed.content_sha256;feed=next;status();if(changed||!$('story-content').children.length)render();}
 catch{if(feed)status(true);else{$('community-status').textContent='The stories could not be loaded. Please refresh; the map remains available.';$('story-content').replaceChildren(el('p','Published stories will appear here when the connection is restored.','feature-empty'));}}
}finally{loading=false;$('community-refresh').disabled=false;}}
function collections(){const editions=(feed?.stories||[]).map(s=>({...s,cases:s.cases||[]}));return [...(feed?.casebook?.cases?.length?[feed.casebook]:[]),...editions];}
function label(s){if(s.id==='selected')return 'Selected case studies';const m=/^([0-9]{4})-([0-9]{2})$/.exec(s.id);return m?new Date(Date.UTC(+m[1],+m[2]-1,1)).toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'}):s.title||s.id;}
function presentation(c){return c.presentation||c;}
function key(c,i){return presentation(c).id||String(i);}
function locationState(){const u=new URL(location);u.searchParams.set('edition',editionId);if(caseId)u.searchParams.set('case',caseId);else u.searchParams.delete('case');history.replaceState({},'',u);}
function render(){const editions=collections(),tabs=$('story-editions');tabs.replaceChildren();const active=editions.find(s=>s.id===editionId)||editions[0];
 if(!active){$('story-navigation').hidden=true;$('story-content').replaceChildren(el('p','The first source-linked edition will appear after a completed review.','feature-empty'));$('story-review').replaceChildren();return;}
 editionId=active.id;
 for(const s of editions){const b=el('button',label(s));b.type='button';b.setAttribute('aria-pressed',String(s.id===editionId));b.addEventListener('click',()=>{editionId=s.id;caseId=null;render();});tabs.append(b);}
 const cases=active.cases;let index=cases.findIndex((c,i)=>key(c,i)===caseId);if(index<0)index=0;
 const select=$('story-select');select.replaceChildren();cases.forEach((c,i)=>{const o=el('option',presentation(c).name||c.name);o.value=key(c,i);select.append(o);});
 $('story-navigation').hidden=!cases.length;select.onchange=()=>{caseId=select.value;render();};
 $('story-previous').disabled=index<=0;$('story-next').disabled=index>=cases.length-1;
 $('story-previous').onclick=()=>{caseId=key(cases[index-1],index-1);render();};$('story-next').onclick=()=>{caseId=key(cases[index+1],index+1);render();};
 $('story-position').textContent=(index+1)+' / '+cases.length;
 if(cases.length){caseId=key(cases[index],index);select.value=caseId;renderCase(presentation(cases[index]),active,index,cases[index]);}else{$('story-content').replaceChildren(el('p','This edition has no case studies yet.','feature-empty'));}
 locationState();renderReview(active);
}
function renderCase(p,collection,index,raw){imageController?.abort();imageController=new AbortController();const root=$('story-content');root.replaceChildren();
 const article=el('article',undefined,'feature-story');article.dataset.caseId=p.id||String(index);
 const mast=el('div',undefined,'feature-masthead');mast.append(el('span','FIRE-EYE / FORECAST STORIES'),el('span',label(collection).toUpperCase()));
 const header=el('header',undefined,'feature-header');header.append(el('p',p.kicker||'A documented wildfire','feature-kicker'),el('h2',p.name),el('p',p.place||[raw.state,date(raw.date)].filter(Boolean).join(' · '),'feature-place'));
 const lead=el('div',undefined,'feature-lead');lead.append(el('strong',p.lead||'From the news'),el('span',p.lead_caption||'Evidence under review'));
 const badges={'public-archive':'Public archive verified','local-record':'Local timestamp record','retrospective':'Retrospective comparison','news-only':'News report'};
 lead.append(el('span',badges[p.timing_basis]||'News report','timing-badge'+(p.timing_basis==='public-archive'?'':' local')));
 const columns=el('div',undefined,'feature-columns'),before=el('section',undefined,'feature-before'),after=el('section',undefined,'feature-after');
 before.append(el('h3',p.before_title||'Forecast evidence'),el('p',p.before_text||'A dated, location-matched forecast has not yet been verified.'));
 const figure=el('figure',undefined,'forecast-figure');before.append(figure);after.append(el('h3',p.after_title||'The reported fire'));
 if(p.impact!=null&&String(p.impact).trim()){const impact=el('div',p.impact,'feature-impact');impact.append(el('span',p.impact_caption));after.append(impact);}
 after.append(el('p',p.after_text||raw.summary));
 const timeline=el('ol',undefined,'story-timeline');for(const item of p.timeline||[]){const li=el('li'),t=el('time',date(item.time_utc));if(item.time_utc)t.dateTime=item.time_utc;li.append(el('b',item.label),t);timeline.append(li);}if(timeline.children.length)after.append(timeline);
 const sources=el('div',undefined,'story-source-links');sources.append(el('small','Sources & reporting'));for(const item of p.sources||[]){const s=typeof item==='string'?{label:'Reporting source',url:item}:item;if(safeURL(s.url))sources.append(anchor(s.label+' ↗',s.url));}if(sources.children.length>1)after.append(sources);
 const evidence=el('details',undefined,'feature-evidence');evidence.append(el('summary','Forecast details & evidence'));const dl=el('dl');
 const facts=[['Issued',p.issue_time_utc?date(p.issue_time_utc):null],['Window ends',p.target_time_utc?date(p.target_time_utc):null],['Model lead',finite(p.nominal_lead_hours)?'+'+p.nominal_lead_hours+'h from issue time (not warning time)':null],['Location',p.coordinates?.length===2?p.coordinates[1].toFixed(4)+'°, '+p.coordinates[0].toFixed(4)+'°':null],['Point score',finite(p.point_score)?p.point_score.toFixed(3)+' (not an ignition probability)':null],['Raster SHA-256',p.raster_sha256]];
 for(const [k,v] of facts)if(v){dl.append(el('dt',k),el('dd',v));}evidence.append(dl);if(safeURL(p.archive_url))evidence.append(anchor('Verified public archive ↗',p.archive_url));
 const download=el('button','Download case evidence');download.type='button';download.addEventListener('click',()=>save('Fire-eye_'+(p.id||index)+'_evidence.json',raw));const actions=el('div',undefined,'actions');actions.append(download);evidence.append(actions);after.append(evidence);
 columns.append(before,after);article.append(mast,header,lead,columns);if(p.note)article.append(el('p',p.note,'feature-note'));root.append(article);showImage(figure,p,imageController.signal);
}
function placeholder(figure,title,copy){const n=el('div',undefined,'map-unavailable');n.append(el('strong',title),el('p',copy));figure.replaceChildren(n);}
async function imageBlob(d,signal){if(!/^[a-f0-9]{64}$/.test(d.sha256))throw Error('Unverified map');if(imageCache.has(d.sha256))return imageCache.get(d.sha256);
 const sources=['assets/story-maps/'+d.sha256+'.png'];if(safeURL(d.url)&&d.url.startsWith(HF))sources.push(d.url);
 for(const source of sources){if(signal.aborted)throw Error('Cancelled');try{const raw=await request(source,10000,signal);if(raw.byteLength>8000000||raw.byteLength!==d.bytes)throw Error('Image size mismatch');const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('');if(sha!==d.sha256)throw Error('Image checksum mismatch');if(signal.aborted)throw Error('Cancelled');const blob=URL.createObjectURL(new Blob([raw],{type:'image/png'}));imageCache.set(sha,blob);return blob;}catch{if(signal.aborted)throw Error('Cancelled');}}
 throw Error('Map not available');
}
async function showImage(figure,p,signal){const d=p.image;if(!d){placeholder(figure,'Forecast map pending','This story keeps its reporting sources while a matching archived map is verified.');return;}
 placeholder(figure,'Loading the archived map…','The image is checked against its recorded checksum.');try{const src=await imageBlob(d,signal);if(signal.aborted||!figure.isConnected)return;
 const a=el('a');a.href=src;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label','Enlarge archived forecast map for '+p.name);
 const img=el('img');img.alt='Archived forecast near '+p.name+'. The event marker was added retrospectively.';img.width=d.width;img.height=d.height;img.decoding='async';img.src=src;
 img.onerror=()=>{if(!signal.aborted)placeholder(figure,'Map preview unavailable','The written evidence and reporting sources are still available.');};a.append(img);
 const large=el('a','Enlarge forecast map ↗','map-image-action');large.href=src;large.target='_blank';large.rel='noopener noreferrer';
 figure.replaceChildren(a,el('figcaption',p.image_caption||'Retained forecast map. Event marker added after the event.'),large);
 }catch{if(!signal.aborted&&figure.isConnected)placeholder(figure,'Map preview unavailable','The written evidence and reporting sources are still available.');}}
function renderReview(active){const root=$('story-review');root.replaceChildren();const d=el('details',undefined,'review-details');
 if(active.id==='selected'){d.append(el('summary','About these selected cases'),el('p',active.selection_note),el('p','The maps and narratives reproduce the reviewed casebook. A local capture timestamp and an independently verified public archive are distinct forms of timing evidence.'));root.append(d);return;}
 d.append(el('summary',label(active)+' · monthly review & methods'),el('p',active.summary));const stats=el('div',undefined,'stats'),m=active.metrics||{};
 const items=finite(m.incidents)?[['official wildfire reports',m.incidents],['captured before discovery',m.prospective_cases],['met the screening rule',m.prospective_rule_hits]]:[['source-linked cases',active.cases.length],['before-discovery comparisons',active.cases.filter(c=>c.forecasts?.length).length],['historical comparisons',active.cases.filter(c=>c.outcome==='historical-context').length]];
 for(const [text,value] of items){const n=el('div');n.append(el('strong',number(value)),el('span',text));stats.append(n);}d.append(stats);
 if(active.screening_rule!=null)d.append(el('p','The screening rule is neighborhood maximum ≥ '+active.screening_rule+' or above the archived raster’s 90th percentile. These counts are not an accuracy percentage.'));
 for(const text of [active.coverage_note,active.method])if(text)d.append(el('p',text));const actions=el('div',undefined,'actions');
 if(safeURL(active.archive_url))actions.append(anchor('Read the Zenodo archive ↗',active.archive_url));const download=el('button','Download edition evidence');download.type='button';download.addEventListener('click',()=>save('Fire-eye_'+active.id+'_evidence.json',active));actions.append(download);d.append(actions);root.append(d);
}
$('community-refresh').addEventListener('click',load);
addEventListener('pagehide',()=>{imageController?.abort();for(const u of imageCache.values())URL.revokeObjectURL(u);imageCache.clear();});
addEventListener('pageshow',e=>{if(e.persisted&&feed)render();});
load();
})();
