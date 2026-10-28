'use strict';
(async()=>{
 const form=document.getElementById('search-form'),input=document.getElementById('search-input'),box=document.getElementById('search-results');if(!form||!input||!box)return;
 for(let i=0;i<600;i++){if(window.fireEyePreview?.ready&&typeof window.fireEyePlatform?.selectLocation==='function')break;await new Promise(r=>setTimeout(r,100));}
 const S=window.fireEyePreview,P=window.fireEyePlatform;if(!S?.ready||!P?.selectLocation)return;
 const original=form.onsubmit;let sequence=0,timer,worker,candidatesPromise,requestId=0;const pending=new Map();
 const V=window.fireEyePlaceSearchUI={ready:true,last:null,search:()=>{}};
 input.placeholder='Place, coordinates, or fire';input.maxLength=120;input.setAttribute('aria-label','Search a city, county, state, coordinates, or fire report');
 const text=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;};
 function hide(){sequence++;clearTimeout(timer);box.hidden=true;}
 function catalogURL(value){const u=new URL(value,location.href);if(u.origin===location.origin&&u.pathname===new URL('gazetteer-bootstrap.json',location.href).pathname)return u.href;if(u.href==='https://huggingface.co/datasets/yx21e/fire-eye-forecasts-preview/resolve/main/gazetteer.json')return u.href;throw Error('Unsupported catalog');}
 async function json(url,limit=262144,timeout=7000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);let reader;try{const r=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:c.signal});if(!r.ok||Number(r.headers.get('Content-Length'))>limit)throw Error('Source unavailable');reader=r.body.getReader();let n=0,chunks=[];for(;;){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>limit)throw Error('Source exceeds limit');chunks.push(p.value);}const out=new Uint8Array(n);let off=0;for(const p of chunks){out.set(p,off);off+=p.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(out));}finally{clearTimeout(t);if(reader)await reader.cancel().catch(()=>{});c.abort();}}
 async function candidates(){
  if(candidatesPromise)return candidatesPromise;
  candidatesPromise=(async()=>{const config=await json(new URL('config.json',location.href).href,65536,2500).catch(()=>({})),values=[];const catalogs=await Promise.allSettled([config.gazetteer_url?json(catalogURL(config.gazetteer_url),262144,2500):Promise.resolve(null),json(catalogURL('gazetteer-bootstrap.json'),262144,4000)]),remote=catalogs[0].status==='fulfilled'?catalogs[0].value:null,saved=catalogs[1].status==='fulfilled'?catalogs[1].value:null;for(const [m,isSaved]of [[remote,false],[saved,true]]){if(!m)continue;const sha=m.asset?.sha256,path=config.gazetteer_assets?.[sha]||(/^[a-f0-9]{64}$/.test(sha||'')?'./assets/places/'+sha+'.json.gz':null);values.push({manifest:m,saved:isSaved,local:path?new URL(path,location.href).href:null});}if(!values.length)throw Error('Place catalog unavailable');return values;})();
  try{return await candidatesPromise;}catch(e){candidatesPromise=null;throw e;}
 }
 function ensureWorker(){if(worker)return;worker=new Worker('assets/place-search-worker.js?v=3a6a5601496c9d4c');worker.onmessage=e=>{const p=pending.get(e.data?.id);if(!p)return;pending.delete(e.data.id);clearTimeout(p.timer);e.data.ok?p.resolve(e.data):p.reject(Error('Place search unavailable'));};worker.onerror=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Place search unavailable'));}pending.clear();worker?.terminate();worker=null;};}
 async function places(query){const options=await candidates();ensureWorker();const id=++requestId;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,timer:setTimeout(()=>{pending.delete(id);reject(Error('Place search unavailable'));},30000)});worker.postMessage({type:'search',id,query,candidates:options});});}
 async function choosePlace(row){
  hide();const label=row.name+(row.kind==='state'?'':', '+row.state);input.value=label;
  S.map.flyTo({center:[row.longitude,row.latitude],zoom:row.kind==='state'?5:row.kind==='county'?7:10,duration:500});
  await P.selectLocation([row.longitude,row.latitude]);
  if(S.selected&&Math.abs(S.selected[0]-row.longitude)<1e-8&&Math.abs(S.selected[1]-row.latitude)<1e-8){document.getElementById('selection-name').textContent=label;const note=document.getElementById('selection-notice');note.textContent='Local analysis around the Census reference point; the selection radius does not follow administrative boundaries.';note.hidden=false;}
 }
 async function search(query=input.value.trim()){
  clearTimeout(timer);query=query.trim();const seq=++sequence;if(!query){box.hidden=true;return;}
  const coords=query.split(/[,\s]+/).map(Number);if(coords.length===2&&coords.every(Number.isFinite)){box.hidden=true;if(original)await original.call(form,{preventDefault(){}});return;}
  const state={places:null,reports:null,placeError:false,reportError:false,metadata:null};box.hidden=false;
  function render(){if(seq!==sequence)return;const focus=document.activeElement?.dataset?.searchKey;box.replaceChildren();let count=0;
   if(state.places?.length){box.append(text('p','Places · Census '+state.metadata.vintage+(state.metadata.saved?' · saved index':''),'place-search-heading'));for(const row of state.places){const b=text('button','');b.type='button';b.dataset.searchKey=row.id;b.append(text('strong',row.name+(row.kind==='state'?'':', '+row.state)),text('span',row.kind==='state'?(row.state==='DC'?'Federal district':'State'):row.kind==='county'?'County / equivalent':'City, town or census place','place-search-kind'));b.onclick=()=>choosePlace(row).catch(()=>{});box.append(b);count++;}}
   if(state.reports?.length){box.append(text('p','Latest fire reports','place-search-heading'));for(const f of state.reports){const b=text('button',f.properties.name+(f.properties.state?' · '+f.properties.state.replace('US-',''):''));b.type='button';b.dataset.searchKey='incident:'+f.properties.name+':'+f.geometry.coordinates.join(',');b.onclick=()=>{hide();P.focusSearchIncident(f).catch(()=>{});};box.append(b);count++;}}
   if(state.places===null&&!state.placeError)box.append(text('p','Searching places…','place-search-status'));
   if(state.reports===null&&!state.reportError)box.append(text('p','Searching fire reports…','place-search-status'));
   if(state.placeError)box.append(text('p','Place search is temporarily unavailable. Try coordinates or retry your search.','place-search-status'));
   if(state.reportError)box.append(text('p','Fire report search is temporarily unavailable.','place-search-status'));
   if(!count&&!state.placeError&&!state.reportError&&state.places!==null&&state.reports!==null)box.append(text('p','No match. Add a state name or postal abbreviation.','place-search-status'));
   if(focus)Array.from(box.querySelectorAll('button')).find(b=>b.dataset.searchKey===focus)?.focus({preventScroll:true});
   V.last={query,places:state.places,reports:state.reports?.length,metadata:state.metadata,placeError:state.placeError,reportError:state.reportError};
  }
  render();
  await Promise.allSettled([places(query).then(r=>{state.places=r.results;state.metadata=r.metadata;render();},()=>{state.placeError=true;state.places=[];render();}),P.loadAsset('incidents').then(data=>{const q=query.toLocaleLowerCase();state.reports=data.features.filter(f=>typeof f.properties?.name==='string'&&f.properties.name.toLocaleLowerCase().includes(q)).slice(0,12);render();},()=>{state.reportError=true;state.reports=[];render();})]);
 }
 V.search=search;V.lookup=places;form.onsubmit=e=>{e.preventDefault();void search();};
 input.addEventListener('input',()=>{clearTimeout(timer);sequence++;const query=input.value.trim();if(query.length<2){box.hidden=true;return;}timer=setTimeout(()=>void search(query),250);});
 input.addEventListener('keydown',e=>{if(e.key==='Escape'){hide();}else if(e.key==='ArrowDown'&&!box.hidden){e.preventDefault();box.querySelector('button')?.focus();}});
 box.addEventListener('keydown',e=>{if(e.key==='Escape'){hide();input.focus();return;}if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const list=Array.from(box.querySelectorAll('button')),i=list.indexOf(document.activeElement);if(list.length)list[(i+(e.key==='ArrowDown'?1:-1)+list.length)%list.length].focus();}});
 document.addEventListener('pointerdown',e=>{if(!form.contains(e.target)&&!box.contains(e.target))hide();});
 window.addEventListener('pagehide',()=>{worker?.terminate();worker=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Page closed'));}pending.clear();clearTimeout(timer);});
})().catch(()=>{});
