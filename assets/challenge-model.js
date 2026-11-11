/* The model track is a local UI prototype. It never uploads or executes models. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 if(!$('model-form'))return;
 const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const tabs=[...document.querySelectorAll('.challenge-tabs [role=tab]')];
 let activeTab='results',step=0,guestDemo=false,draft=null,runToken=0,runComplete=false,wasSignedIn=false;
 const signedIn=()=>!!window.fireEyeAccount?.signedIn;
 function showTab(name,focus=false){
  activeTab=name;
  for(const tab of tabs){const selected=tab.dataset.tab===name;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;$(tab.getAttribute('aria-controls')).hidden=!selected;}
  if(name==='workspace')paintWorkspace();
  if(focus)$('tab-'+name).focus({preventScroll:true});
 }
 for(const tab of tabs){tab.addEventListener('click',()=>showTab(tab.dataset.tab));tab.addEventListener('keydown',event=>{const index=tabs.indexOf(tab);let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();showTab(tabs[next].dataset.tab,true);});}
 function enter(){showTab('enter');$('challenge-main').querySelector('.challenge-tabs').scrollIntoView({block:'start',behavior:'instant'});paintAccess();}
 $('model-start').onclick=enter;
 function openAccount(){
  const url=new URL(location.href);url.searchParams.set('challenge','enter');history.replaceState(null,'',url);
  if(window.fireEyeAccount)window.fireEyeAccount.open();else $('model-auth-message').textContent='Sign-in is temporarily unavailable. You can still explore the demo.';
 }
 $('model-sign-in').onclick=openAccount;
 function setStep(next){
  step=next;
  document.querySelectorAll('#model-form [data-step]').forEach(field=>{const active=Number(field.dataset.step)===step;field.hidden=!active;field.disabled=!active;});
  document.querySelectorAll('.wizard-progress li').forEach((item,i)=>{if(i===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});
  $('model-back').hidden=step===0;$('model-next').hidden=step===2;$('model-run').hidden=step!==2;$('model-save').hidden=step!==2||!signedIn()||guestDemo;
  $('model-form-status').textContent='';
  if(step===2)paintReview();
 }
 function metadata(){return {schema:'fire-eye-model-draft-v1',prototype:true,submission_status:'not_submitted',execution_enabled:false,model:{name:$('model-name').value.trim(),version:$('model-version').value.trim(),description:$('model-description').value.trim(),package_preference:$('model-format').value,license:$('model-license').value},evaluation:{track:document.querySelector('input[name=track]:checked').value,grid:'CONUS-5km-EPSG5070',lead_hours:[12,24,36,48],input_policy:'common-cutoff',round_id:null},artifact:null,receipt:null};}
 function appendDefinition(dl,label,value){const row=node('div');row.append(node('dt',label),node('dd',value));dl.append(row);}
 function paintReview(){const value=metadata(),dl=$('model-review');dl.replaceChildren();for(const [label,text]of [['Model',value.model.name],['Version',value.model.version],['Description',value.model.description],['Package',value.model.package_preference==='onnx'?'ONNX export':'Container image'],['License',value.model.license==='not-selected'?'Not selected yet':value.model.license],['Track',value.evaluation.track==='prospective'?'Future observations':'Historical backtest'],['Forecasts','+12, +24, +36, +48 hours'],['Submission','Draft only · no receipt issued']])appendDefinition(dl,label,text);}
 function reset(){runToken++;runComplete=false;draft=null;guestDemo=false;$('model-form').reset();$('model-demo-run').hidden=true;$('model-demo-result').hidden=true;$('model-run').disabled=false;$('model-name').setCustomValidity('');$('model-version').setCustomValidity('');$('model-description').setCustomValidity('');setStep(0);}
 function example(){const savedDraft=draft;reset();draft=savedDraft;guestDemo=true;$('model-name').value='ConvLSTM';$('model-version').value='v0.1';$('model-description').value='Demonstration draft for a spatiotemporal wildfire forecasting model.';enter();}
 $('model-example').onclick=example;$('model-guest').onclick=example;
 function paintAccess(){
  const auth=window.fireEyeAccount,connected=signedIn(),ready=auth?.ready===true;
  if(wasSignedIn&&!connected){reset();}
  wasSignedIn=connected;
  $('model-auth-gate').hidden=connected||guestDemo;$('model-editor').hidden=!(connected||guestDemo);
  $('model-auth-message').textContent=!ready?'Checking sign-in…':auth.configured?'GitHub sign-in opens a private draft workspace. You can explore the example without an account.':'Sign-in is temporarily unavailable. The example walkthrough remains available.';
  $('model-sign-in').disabled=!ready||!auth?.configured;
  $('model-editor-context').textContent=guestDemo?'Example mode. All steps are simulated; no files are uploaded.':'Signed in with GitHub. Your draft stays in this page until you leave or sign out.';
  $('model-save').hidden=step!==2||!connected||guestDemo;
  paintWorkspace();
 }
 function validStep(){
  if(step===0)for(const id of ['model-name','model-version','model-description']){const input=$(id),restricted=String.fromCharCode(81,119,101,110).toLowerCase(),normalized=input.value.normalize('NFKC').toLowerCase().replace(/[^a-z]/g,'');input.setCustomValidity(!input.value.trim()?'Please enter a value.':normalized.includes(restricted)?'Please use neutral model wording.':'');}
  return $('model-form').reportValidity();
 }
 for(const id of ['model-name','model-version','model-description'])$(id).addEventListener('input',()=>$(id).setCustomValidity(''));
 $('model-next').onclick=()=>{if(validStep())setStep(Math.min(step+1,2));};
 $('model-back').onclick=()=>setStep(Math.max(step-1,0));
 $('model-save').onclick=()=>{if(!signedIn()||guestDemo)return;if(!validStep())return;draft=metadata();$('model-form-status').textContent='Local draft kept for this page session. Nothing has been submitted.';paintWorkspace();};
 function paintWorkspace(){
  const host=$('model-workspace');host.replaceChildren();const card=node('div',undefined,'workspace-card');
  if(!signedIn()){card.append(node('h3','Sign in to prepare your model'),node('p','Browse results and explore the demonstration without an account. GitHub sign-in opens your local draft workspace.'));const button=node('button','Sign in with GitHub','primary');button.type='button';button.onclick=openAccount;button.disabled=window.fireEyeAccount?.ready!==true||!window.fireEyeAccount?.configured;card.append(button);}
  else if(!draft){card.append(node('span','GitHub connected','workspace-status'),node('h3','Your next model starts here.'),node('p','Create a draft, choose a track and preview the evaluation process. Model intake will open with the first round.'));const button=node('button','Create local draft','primary');button.type='button';button.onclick=()=>{reset();enter();};card.append(button);}
  else{card.append(node('span','Local draft · not submitted','workspace-status'),node('h3',draft.model.name),node('p',draft.model.version+' · '+(draft.evaluation.track==='prospective'?'Future observations':'Historical backtest')));const actions=node('div',undefined,'actions'),edit=node('button','Edit draft'),download=node('button','Download draft JSON'),remove=node('button','Discard draft');for(const b of [edit,download,remove])b.type='button';edit.onclick=()=>{loadDraft(draft);enter();setStep(0);};download.onclick=()=>downloadDraft(draft);remove.onclick=()=>{reset();paintAccess();};actions.append(edit,download,remove);card.append(actions);}
  host.append(card);
 }
 function loadDraft(value){guestDemo=false;$('model-name').value=value.model.name;$('model-version').value=value.model.version;$('model-description').value=value.model.description;$('model-format').value=value.model.package_preference;$('model-license').value=value.model.license;document.querySelector('input[name=track][value='+value.evaluation.track+']').checked=true;$('model-confirm').checked=false;}
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 $('model-form').addEventListener('submit',async event=>{
  event.preventDefault();if(step!==2){$('model-next').click();return;}if(!validStep()||(!guestDemo&&!signedIn()))return;
  if(signedIn()&&!guestDemo)draft=metadata();
  const token=++runToken;runComplete=false;$('model-run').disabled=true;$('model-demo-run').hidden=false;$('model-demo-result').hidden=true;
  const items=[...$('model-job-stages').children];for(const item of items){item.removeAttribute('data-done');item.removeAttribute('aria-current');}
  const messages=['Draft fields checked locally. No model file received.','Simulating an evaluation queue. No worker or compute job is running.','Demo complete. No model was evaluated and no public receipt was created.'];
  for(let i=0;i<items.length;i++){
   if(token!==runToken)return;
   if(i>0){items[i-1].setAttribute('data-done','true');items[i-1].removeAttribute('aria-current');}
   items[i].setAttribute('aria-current','step');$('model-job-status').textContent=messages[i];
   if(i<items.length-1)await pause(650);
  }
  if(token!==runToken)return;items.at(-1).setAttribute('data-done','true');items.at(-1).removeAttribute('aria-current');runComplete=true;$('model-demo-result').hidden=false;$('model-run').disabled=false;paintWorkspace();
 });
 async function downloadDraft(value){const account=window.fireEyeAccount;if(!account)return;const ok=await account.download({name:'fire-eye-model-draft.json',blob:new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),format:'challenge-template'});if(!ok&&document.getElementById('community-status'))document.getElementById('community-status').textContent=account.lastError;}
 $('model-export').onclick=()=>{if(runComplete)downloadDraft(metadata());};
 $('model-see-results').onclick=()=>{showTab('results',true);$('tab-results').scrollIntoView({block:'start',behavior:'instant'});};
 // Model-family labels demonstrate the interface; these values are not measured performance.
 const examples=[{name:'Swin Transformer',capture:[.72,.67,.62,.58],auc:[.43,.39,.35,.31]},{name:'ConvLSTM',capture:[.66,.65,.64,.61],auc:[.38,.37,.36,.33]},{name:'Random Forest',capture:[.60,.58,.55,.51],auc:[.32,.30,.28,.25]}];
 const offsets={conus:[0,0,0],west:[.03,-.02,.01],central:[-.08,-.02,-.03],east:[.01,.04,-.02]};
 let selectedExample='Swin Transformer';
 const areaName=()=>$('model-region').selectedOptions[0].textContent;
 function exampleRows(){const lead=Number($('model-lead').value),offset=offsets[$('model-region').value];return examples.map((e,i)=>({...e,values:e.capture.map(v=>v+offset[i]),score:e.capture[lead]+offset[i],metric:e.auc[lead]+offset[i]/2})).sort((a,b)=>b.score-a.score);}
 const percent=v=>(v*100).toFixed(0)+'%';
 function paintResults(){
  const rows=exampleRows(),body=$('model-leaderboard');body.replaceChildren();$('model-table-caption').textContent='Illustrative leaderboard · +'+((Number($('model-lead').value)+1)*12)+' h · '+areaName();
  for(const [index,row]of rows.entries()){const tr=node('tr');tr.dataset.selected=String(row.name===selectedExample);tr.append(node('td',String(index+1)));const td=node('td'),button=node('button',row.name);button.type='button';button.setAttribute('aria-pressed',String(row.name===selectedExample));button.onclick=()=>{selectedExample=row.name;paintResults();$('model-leaderboard').querySelector('[aria-pressed=true]').focus({preventScroll:true});};td.append(button);tr.append(td,node('td',percent(row.score)),node('td',row.metric.toFixed(2)));body.append(tr);}
  const row=rows.find(e=>e.name===selectedExample);$('model-chart-title').textContent=row.name+' · '+areaName();paintChart(row);
 }
 function paintChart(row){
  const host=$('model-comparison-chart');host.replaceChildren();const ns='http://www.w3.org/2000/svg';
  const shape=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;return el;};
  const svg=shape('svg',{viewBox:'0 0 320 185',class:'model-chart',role:'img','aria-label':'Illustrative fire-cell capture for '+row.name+' at four leads: '+row.values.map((v,i)=>'+'+(i+1)*12+' hours '+percent(v)).join(', ')});
  for(const v of [0,.5,1]){const y=146-v*112;svg.append(shape('line',{x1:35,y1:y,x2:306,y2:y,stroke:'#dce5d8','stroke-width':1}),shape('text',{x:0,y:y+4},percent(v)));}
  const points=row.values.map((v,i)=>[48+i*82,146-v*112]);svg.append(shape('polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:'#477746','stroke-width':2.5}));
  points.forEach(([x,y],i)=>{svg.append(shape('circle',{cx:x,cy:y,r:4.5,fill:'#477746',stroke:'#fff','stroke-width':2}),shape('text',{x,y:y-12,'text-anchor':'middle',class:'chart-value'},percent(row.values[i])),shape('text',{x,y:171,'text-anchor':'middle'},'+'+(i+1)*12+' h'));});
  host.append(svg);const list=node('ul',undefined,'chart-values');row.values.forEach((value,i)=>{const li=node('li','+'+(i+1)*12+' h');li.append(node('b',percent(value)));list.append(li);});host.append(list);
 }
 $('model-lead').onchange=paintResults;$('model-region').onchange=paintResults;
 window.addEventListener('fire-eye:account-state',paintAccess);
 setStep(0);paintResults();paintAccess();
 const intent=new URLSearchParams(location.search).get('challenge');if(intent==='enter')showTab('enter');
})();
