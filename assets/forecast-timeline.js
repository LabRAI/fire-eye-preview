'use strict';
(async()=>{
 const $=id=>document.getElementById(id);
 for(let i=0;i<600&&!window.fireEyeForecastHistory?.ready;i++)await new Promise(r=>setTimeout(r,100));
 const S=window.fireEyePreview,P=window.fireEyePlatform,H=window.fireEyeForecastHistory;if(!S?.ready||!P?.ready||!H?.ready||document.body.classList.contains('resolution-lab'))return;
 const T=window.fireEyeTimeline={ready:false,entries:[],boundary:0,errors:[]};
 const make=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text)e.textContent=text;return e;};
 const box=make('section','forecast-scrubber'),labels=make('div','scrubber-labels'),past=make('span','','Historical outputs'),future=make('button','','Forecast →');future.type='button';labels.append(past,future);
 const rail=make('div','scrubber-rail'),slider=make('input',''),marker=make('button','scrubber-boundary');slider.id='forecast-time-slider';slider.type='range';slider.min=0;slider.step=1;slider.setAttribute('aria-label','Prediction timeline');marker.type='button';marker.setAttribute('aria-label','Jump to first future forecast');marker.title='Forecast starts here';marker.tabIndex=-1;marker.setAttribute('aria-hidden','true');rail.append(slider,marker);
 const caption=make('output','scrubber-caption'),ends=make('div','scrubber-ends'),start=make('span'),end=make('span'),notice=make('button','scrubber-notice');notice.type='button';notice.hidden=true;ends.append(start,end);box.append(labels,rail,caption,ends,notice);$('horizons').after(box);
 let saved=[],loading=null,dragging=false,selectTimer=null,requested=0,selecting=false,queued=null;
 const date=v=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date(v));
 const short=v=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(v));
 function describe(i){const e=T.entries[i];if(!e)return;caption.value=(e.future?'Forecast +'+e.run.lead_hours+'h':'Historical output')+' · '+date(e.run.target_time_utc)+' UTC';slider.setAttribute('aria-valuetext',caption.value);}
 const position=i=>T.boundary?(i<T.boundary?Math.round(i/Math.max(1,T.boundary-1)*749):750+Math.round((i-T.boundary)/Math.max(1,T.entries.length-T.boundary-1)*250)):i;
 const index=v=>T.boundary?(v<750?Math.round(v/749*Math.max(0,T.boundary-1)):T.boundary+Math.round((v-750)/250*Math.max(0,T.entries.length-T.boundary-1))):v;
 function geometry(){const n=T.entries.length;if(!n)return;const fraction=T.boundary ? .75 : 0;rail.style.setProperty('--forecast-start',(fraction*100)+'%');marker.style.left=(9+Math.max(0,slider.clientWidth-18)*fraction)+'px';marker.hidden=T.boundary===0;past.hidden=T.boundary===0;}
 function reflect(){if(dragging||selecting)return;let i=T.entries.findIndex(e=>e.manifest.release_id===S.manifest?.release_id&&e.run.source_id===S.active?.run.source_id);if(i<0)i=T.entries.findIndex(e=>e.run.target_time_utc===S.active?.run.target_time_utc);if(i>=0){slider.value=String(position(i));describe(i);}geometry();}
 function rebuild(){
  const latest=S.latestManifest||S.manifest;if(!latest)return;const cutoff=Date.parse(latest.issue_time_utc),byTarget=new Map();
  for(const m of saved){const r=m.runs.find(r=>r.lead_hours===12);if(!r||Date.parse(r.target_time_utc)>cutoff)continue;const old=byTarget.get(r.target_time_utc);if(!old||Date.parse(m.issue_time_utc)>Date.parse(old.manifest.issue_time_utc))byTarget.set(r.target_time_utc,{manifest:m,run:r,future:false});}
  const history=[...byTarget.values()].sort((a,b)=>Date.parse(a.run.target_time_utc)-Date.parse(b.run.target_time_utc));T.boundary=history.length;T.entries=[...history,...latest.runs.map(run=>({manifest:latest,run,future:true}))];slider.max=String(T.boundary?1000:T.entries.length-1);slider.disabled=T.entries.length<2;T.ready=true;start.textContent=short(T.entries[0].run.target_time_utc);end.textContent=short(T.entries.at(-1).run.target_time_utc);reflect();
 }
 async function choose(i){
  const entry=T.entries[i];if(!entry)return;queued=entry;requested++;if(selecting)return;selecting=true;
  try{while(queued){const e=queued;queued=null;const seq=requested;slider.setAttribute('aria-busy','true');let ok;if(e.future){const pinned=S.historyPinned;S.historyPinned=false;ok=await S.showManifest(e.manifest,e.run.lead_hours);if(!ok)S.historyPinned=pinned;else await P.setMode('forecast');}else ok=await P.selectArchive(e.manifest);if(seq===requested&&ok===false){notice.textContent='Selected time could not load · Retry';notice.hidden=false;notice.onclick=()=>choose(T.entries.indexOf(e));}}}
  finally{selecting=false;slider.removeAttribute('aria-busy');reflect();}
 }
 slider.addEventListener('pointerdown',()=>dragging=true);slider.addEventListener('input',()=>{describe(index(Number(slider.value)));clearTimeout(selectTimer);selectTimer=setTimeout(()=>choose(index(Number(slider.value))),180);});slider.addEventListener('change',()=>{dragging=false;clearTimeout(selectTimer);choose(index(Number(slider.value)));});slider.addEventListener('pointerup',()=>dragging=false);slider.addEventListener('pointercancel',()=>{dragging=false;reflect();});
 future.onclick=marker.onclick=()=>{slider.value=String(position(T.boundary));describe(T.boundary);choose(T.boundary);};
 async function load(){if(loading)return loading;loading=(async()=>{T.errors=[];let catalog;try{catalog=await H.loadCatalog();}catch{T.errors.push('catalog');}if(catalog){const results=[];for(const row of catalog.months){try{const m=await H.loadMonth(row,new AbortController().signal);results.push(...m.releases);}catch{T.errors.push(row.month);}}saved=results;}rebuild();notice.hidden=!T.errors.length;notice.textContent='Some archive dates are unavailable · Retry';notice.onclick=load;})().finally(()=>loading=null);return loading;}
 slider.addEventListener('keydown',event=>{const delta={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageDown:-10,PageUp:10}[event.key];if(delta===undefined&&!['Home','End'].includes(event.key))return;event.preventDefault();const i=event.key==='Home'?0:event.key==='End'?T.entries.length-1:Math.max(0,Math.min(T.entries.length-1,index(Number(slider.value))+delta));slider.value=String(position(i));describe(i);choose(i);});
 T.positionForIndex=position;T.indexForPosition=index;T.select=choose;T.reload=load;T.refresh=rebuild;new ResizeObserver(geometry).observe(rail);window.addEventListener('fire-eye:forecast-changed',()=>{rebuild();reflect();});rebuild();load();
})().catch(()=>{});
