/* Forecast uploads only. No model code runs in the browser or on lab hardware. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);if(!$('weekly-round'))return;
 const BASE='https://huggingface.co/datasets/yx21e/fire-eye-challenge/resolve/main/';
 const GRID={width:938,height:609,transform:[5000,0,-2362425,0,-5000,3267405]};
 const AEA='+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=23 +lon_0=-96 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs';
 const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const date=value=>new Date(value).toLocaleString('en-US',{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' UTC';
 const pct=v=>typeof v==='number'?new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:1}).format(v):'—';
 let index=null,round=null,mask=null,upload=null,busy=false;
 const masks=new Map();
 const signed=()=>!!window.fireEyeAccount?.signedIn;
 const open=()=>round&&Date.now()<Date.parse(round.submission_deadline_utc);
 function access(){
  $('weekly-submit').disabled=busy||!upload||!signed()||!open();
  $('weekly-login').hidden=signed();$('weekly-login').disabled=!window.fireEyeAccount?.ready||!window.fireEyeAccount?.configured;
  $('weekly-account').textContent=signed()?'GitHub connected · Up to four submissions per seven days.':'Sign in to submit. Templates and results are available to everyone.';
 }
 $('weekly-login').onclick=()=>window.fireEyeAccount?.open();window.addEventListener('fire-eye:account-state',access);
 async function fetchData(path){const r=await fetch(BASE+path,{signal:AbortSignal.timeout(20000),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-cache'});if(!r.ok)throw Error('Challenge data is not available yet. Please retry.');return r;}
 async function choose(){
  round=index.rounds.find(r=>r.id===$('weekly-round').value);mask=null;upload=null;$('weekly-file').value='';$('weekly-validation').textContent='';
  $('weekly-template').disabled=true;$('weekly-grid').disabled=true;access();if(!round)return;
  $('weekly-deadline').textContent=(open()?'Submit by ':'Closed ')+date(round.submission_deadline_utc);
  $('weekly-dates').textContent=date(round.starts_at_utc)+' – '+date(round.ends_at_utc);
  const selected=round.id;
  try{
   if(!/^masks\/[a-f0-9]{64}\.bin$/.test(round.mask_path))throw Error('Coverage file is invalid.');
   if(!masks.has(round.mask_sha256)){const bytes=new Uint8Array(await(await fetchData(round.mask_path)).arrayBuffer());const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');if(bytes.length!==GRID.width*GRID.height||hash!==round.mask_sha256)throw Error('Coverage verification failed. Please retry.');masks.set(hash,bytes);}
   if(round.id!==selected)return;mask=masks.get(round.mask_sha256);$('weekly-template').disabled=false;$('weekly-grid').disabled=false;
  }catch(e){$('weekly-validation').textContent=e.message;}
 }
 function region(){
  const lon=Number($('weekly-lon').value),lat=Number($('weekly-lat').value),size=Number($('weekly-size').value);
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon< -125.5||lon> -66.5||lat<24||lat>49.8)throw Error('Choose a location in the contiguous United States.');
  const [x,y]=proj4('EPSG:4326',AEA,[lon,lat]);if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Location could not be projected onto the challenge grid.');return {row:Math.max(0,Math.min(GRID.height-size,Math.floor((GRID.transform[5]-y)/5000)-size/2)),column:Math.max(0,Math.min(GRID.width-size,Math.floor((x-GRID.transform[2])/5000)-size/2)),width:size,height:size};
 }
 function save(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type})),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $('weekly-template').onclick=()=>{try{if(!mask||!round)return;const r=region();let land=0;for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++)land+=mask[(r.row+y)*GRID.width+r.column+x]===1?1:0;if(!land)throw Error('Choose an area containing mapped land.');save('weekly-forecast-'+round.id+'.json',JSON.stringify({schema:'fire-eye-weekly-v1',round_id:round.id,model_name:'ConvLSTM',model_version:'v1',region:r,scores:Array.from({length:14},()=>Array(r.width*r.height).fill(null))}));$('weekly-validation').textContent='Template downloaded. Fill every mapped land cell for all 14 windows; keep masked cells null. Grid CSV identifies the land cells.';}catch(e){$('weekly-validation').textContent=e.message;}};
 $('weekly-grid').onclick=()=>{try{if(!mask)return;const r=region(),rows=['index,row,column,longitude,latitude,land'];for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){const row=r.row+y,col=r.column+x,[lon,lat]=proj4(AEA,'EPSG:4326',[GRID.transform[2]+(col+.5)*5000,GRID.transform[5]-(row+.5)*5000]);rows.push([y*r.width+x,row,col,lon.toFixed(6),lat.toFixed(6),mask[row*GRID.width+col]].join(','));}save('forecast-grid-'+round.id+'.csv',rows.join('\n'),'text/csv');}catch(e){$('weekly-validation').textContent=e.message;}};
 $('weekly-file').onchange=async()=>{
  upload=null;access();const file=$('weekly-file').files[0];if(!file)return;
  try{
   if(file.size>524288||!file.name.endsWith('.json'))throw Error('Choose a forecast JSON file of at most 512 KiB.');
   const data=JSON.parse(await file.text()),r=data.region;
   if(!round||!mask||data.schema!=='fire-eye-weekly-v1'||data.round_id!==round.id)throw Error('Use a template for the selected round.');
   if(!r||!['row','column','width','height'].every(k=>Number.isInteger(r[k]))||r.row<0||r.column<0||r.width<1||r.height<1||r.width*r.height>4096||r.row+r.height>GRID.height||r.column+r.width>GRID.width)throw Error('The region is outside the supported grid.');
   if(!Array.isArray(data.scores)||data.scores.length!==14)throw Error('Include all fourteen forecast windows.');
   for(const values of data.scores){if(!Array.isArray(values)||values.length!==r.width*r.height)throw Error('Forecast grid sizes must match.');for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){const v=values[y*r.width+x],land=mask[(r.row+y)*GRID.width+r.column+x]===1;if(land?(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1||Math.abs(v*1000-Math.round(v*1000))>1e-7):v!==null)throw Error('Supply a 0–1 value at 0.001 precision for every land cell; keep masked cells null.');}}
   upload=data;$('weekly-validation').textContent='14 windows checked locally. Submit to obtain a published receipt.';
  }catch(e){$('weekly-validation').textContent=e.message;}access();
 };
 $('weekly-submit').onclick=async()=>{
  if(busy||!upload||!signed()||!open()||!$('weekly-consent').checked){$('weekly-validation').textContent='Confirm that your forecast and model label may be published.';return;}
  busy=true;access();$('weekly-validation').textContent='Recording your forecast… Keep this page open.';
  try{const result=await window.fireEyeAccount.submitForecast(upload);const url=new URL(result.receipt_url);if(url.origin!=='https://huggingface.co'||!url.pathname.startsWith('/datasets/yx21e/fire-eye-challenge/resolve/'))throw Error('Receipt verification is pending. Retry the same file.');$('weekly-validation').replaceChildren(node('span',result.message+' '));const a=node('a','View receipt ↗');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';$('weekly-validation').append(a);upload=null;}
  catch(e){$('weekly-validation').textContent=e.message||'Submission is pending. Retry the same file.';}finally{busy=false;access();}
 };
 function results(){
  const host=$('weekly-results');host.replaceChildren();const records=(index.results||[]).filter(r=>r.model_name);
  if(!records.length){host.append(node('p','The first comparisons will appear after submitted windows have passed and observations have been checked.','quiet'));return;}
  for(const r of records){const card=node('article',undefined,'card'),heading=node('h3',r.model_name+' · '+r.model_version);card.append(heading,node('p',r.round_id+' · '+r.status,'quiet'));const disclosure=node('details'),summary=node('summary','View 12-hour comparisons');disclosure.append(summary);const wrap=node('div',undefined,'weekly-table-wrap'),table=node('table',undefined,'model-leaderboard'),head=node('thead'),tr=node('tr');for(const t of ['Window ending (UTC)','Your model','FireWx-FM','Observed cells','Status'])tr.append(node('th',t));head.append(tr);table.append(head);const body=node('tbody');for(const w of r.windows||[]){const row=node('tr');for(const t of [date(w.end_utc),pct(w.participant?.capture_top_20pct),pct(w.firewxfm?.capture_top_20pct),String(w.participant?.observed_fire_cells??'—'),w.status])row.append(node('td',t));body.append(row);}table.append(body);wrap.append(table);disclosure.append(wrap,node('p','Values show documented fire-cell capture in the top 20% of ranked land area. No observed fires means no score. A dash in the reference column means no eligible matching reference.','quiet'));card.append(disclosure);host.append(card);}
 }
 async function load(){
  $('weekly-status').textContent='Loading challenge rounds…';
  try{index=await(await fetchData('index.json')).json();if(index.schema!=='fire-eye-weekly-index-v1'||!Array.isArray(index.rounds))throw Error('Challenge configuration is being prepared.');$('weekly-round').replaceChildren();for(const r of index.rounds){const option=node('option',r.id+' · '+date(r.starts_at_utc));option.value=r.id;$('weekly-round').append(option);}const eligible=index.rounds.filter(r=>Date.now()<Date.parse(r.submission_deadline_utc)).sort((a,b)=>Date.parse(a.starts_at_utc)-Date.parse(b.starts_at_utc));if(eligible.length)$('weekly-round').value=eligible[0].id;$('weekly-status').textContent='Updated '+date(index.updated_at_utc);results();await choose();}
  catch(e){$('weekly-status').textContent=e.message+' The map remains available.';}access();
 }
 $('weekly-round').onchange=choose;$('weekly-refresh').onclick=load;
 access();void load();setInterval(access,30000);
})();
