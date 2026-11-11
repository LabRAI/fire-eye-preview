/* Public browsing stays available; data tools and exports require a live session. */
(async()=>{
 'use strict';
 const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 const host=document.querySelector('.header-actions,.site-header nav');if(!host)return;
 const button=document.getElementById('account-open')||element('button',null,'account-open');
 button.id='account-open';button.type='button';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-label','Sign in to Fire-eye');button.title='Sign in to Fire-eye';
 const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
 for(const [tag,attrs] of [['circle',{cx:12,cy:8,r:3.5}],['path',{d:'M4.5 21v-2a7.5 7.5 0 0 1 15 0v2'}]]){const n=document.createElementNS(icon.namespaceURI,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));icon.append(n);}
 const label=element('span','Sign in','account-label');button.replaceChildren(icon,label);if(!button.isConnected)host.append(button);document.body.classList.add('account-entry-enabled');
 const avatar=element('img',null,'account-avatar');avatar.alt='Your GitHub avatar';avatar.width=28;avatar.height=28;avatar.referrerPolicy='no-referrer';avatar.hidden=true;button.insertBefore(avatar,label);
 avatar.onerror=()=>{avatar.hidden=true;icon.removeAttribute('hidden');};
 const dialog=element('dialog',null,'account-dialog'),heading=element('div',null,'account-heading'),title=element('h2','Sign in to Fire-eye'),close=element('button','×','account-close');
 close.type='button';close.setAttribute('aria-label','Close account');heading.append(title,close);
 const status=element('p'),privacy=element('p','GitHub verifies your identity. Supabase stores only a pseudonymous ID and activity records. Your avatar stays in this browser tab until sign-out; your email and provider access token are not retained.','muted');
 const action=element('button','Checking sign-in…','account-action'),notice=element('p','Map browsing is public. Sign in for downloads, regional analysis and simulation. Downloads are limited to one file every 3 minutes per account.','muted');action.type='button';action.disabled=true;privacy.hidden=true;
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');dialog.setAttribute('aria-label','Fire-eye account');dialog.append(heading,status,privacy,action,notice);document.body.append(dialog);
 let client=null,signedIn=false,busy=false,loading=true,ready=false,configurationFailed=false,leaseUntil=0,authorization=null,downloadBusy=false,nextDownloadAt=0,lastError='';
 const activityNames={download:'download files',details:'open regional analysis',summaries:'calculate summaries',fires:'load active fire data',simulation:'start simulation',vr:'open VR',resolution:'load 50 m detail',assistant:'use Ask Flamme',scenario:'load a scenario',layers:'load additional data layers'};
 const remaining=()=>Math.max(0,Math.ceil((nextDownloadAt-Date.now())/1000));
 const waitText=seconds=>'Next download in '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+'.';
 async function requireAccess(activity,{interactive=true}={}){
  for(let n=0;n<50&&!ready;n++)await new Promise(r=>setTimeout(r,100));
  if(!signedIn||!client?.signedIn){const changed=signedIn;signedIn=false;leaseUntil=0;if(changed)paint();lastError='Sign in to '+(activityNames[activity]||'use this data tool')+'.';if(interactive){button.click();status.textContent=lastError;}return false;}
  if(leaseUntil>Date.now())return true;
  try{authorization ||= client.authorize().finally(()=>{authorization=null;});await authorization;if(!client.signedIn)return false;leaseUntil=Date.now()+30000;return true;}
  catch(e){leaseUntil=0;if(e.status===401){signedIn=false;paint();}lastError=e.status===401?'Please sign in again.':'Account verification is temporarily unavailable. The map remains available.';if(interactive){button.click();status.textContent=lastError;}return false;}
 }
 async function download({name,blob,format}){
  lastError='';if(downloadBusy){lastError='A download is already being prepared.';return false;}
  if(!await requireAccess('download'))return false;if(downloadBusy){lastError='A download is already being prepared.';return false;}
  if(remaining()){lastError=waitText(remaining());return false;}
  if(!(blob instanceof Blob)||blob.size>15000000||typeof name!=='string'||!/^[a-zA-Z0-9_.-]{1,160}$/.test(name)){lastError='This file cannot be exported. Please select a smaller area.';return false;}
  downloadBusy=true;
  try{const permit=await client.permitDownload(format);if(permit.allowed!==true)throw Error('Download permission unavailable.');if(!client.signedIn)throw Error('Please sign in again.');nextDownloadAt=Date.now()+180000;
   const url=URL.createObjectURL(blob),link=element('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);return true;
  }catch(e){if(e.retryAfter){nextDownloadAt=Date.now()+e.retryAfter*1000;lastError=waitText(e.retryAfter);}else lastError=e.message||'Download unavailable. Please retry.';if(e.status===401){signedIn=false;leaseUntil=0;paint();}return false;}
  finally{downloadBusy=false;window.dispatchEvent(new CustomEvent('fire-eye:download-state',{detail:{remaining:remaining(),message:lastError}}));}
 }
 function paint(){
  signedIn=!!client?.signedIn&&signedIn;label.textContent=signedIn?'Account':'Sign in';title.textContent=signedIn?'Your account':'Sign in to Fire-eye';
  const avatarURL=signedIn?client?.avatarURL:null;if(avatarURL){if(avatar.src!==avatarURL)avatar.src=avatarURL;avatar.hidden=false;icon.setAttribute('hidden','');}else{avatar.hidden=true;avatar.removeAttribute('src');icon.removeAttribute('hidden');}
  button.setAttribute('aria-label',signedIn?'Open your Fire-eye account':'Sign in to Fire-eye');button.title=signedIn?'Your account':'Sign in to Fire-eye';privacy.hidden=!client;
  action.disabled=busy||loading||!client;action.textContent=loading?'Checking sign-in…':!client?'GitHub sign-in coming soon':signedIn?'Sign out':'Continue with GitHub';
  status.textContent=loading?'Checking sign-in availability…':!client?(configurationFailed?'Sign-in is currently unavailable. You can continue using Fire-eye.':'GitHub sign-in is not enabled yet. You can continue using Fire-eye without an account.'):signedIn?'Signed in with GitHub.':'Sign in using your GitHub account.';
  window.dispatchEvent(new CustomEvent('fire-eye:account-state',{detail:{ready,signedIn,configured:!!client}}));
 }
 button.onclick=()=>{paint();if(!dialog.open)dialog.showModal();};close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>button.focus());
 dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
 action.onclick=async()=>{if(busy||!client)return;busy=true;action.disabled=true;
  try{if(signedIn){const pendingLogout=client.logout();signedIn=false;leaseUntil=0;paint();const revoked=await pendingLogout;if(!revoked)status.textContent='Signed out on this device. The server session will expire automatically.';}
   else{status.textContent='Opening GitHub…';const target=new URL(location.href),map=window.fireEyePreview?.map;if(map)target.searchParams.set('view',[...map.getCenter().toArray(),map.getZoom()].join(','));await client.start(target.href);}}
  catch{signedIn=client.signedIn;paint();status.textContent='Account service is temporarily unavailable. You can continue using Fire-eye.';}
  finally{busy=false;action.disabled=!client;}
 };
 window.fireEyeAccount={get signedIn(){return signedIn&&!!client?.signedIn;},get configured(){return !!client;},get ready(){return ready;},get lastError(){return lastError;},get downloadRemaining(){return remaining();},require:requireAccess,download,open:()=>button.click(),submitForecast:data=>{if(!signedIn||!client)throw Error('Please sign in before submitting.');return client.submitForecast(data);}};paint();
 setInterval(()=>{if(signedIn&&!client?.signedIn){signedIn=false;leaseUntil=0;paint();}if(nextDownloadAt)window.dispatchEvent(new CustomEvent('fire-eye:download-state',{detail:{remaining:remaining(),message:''}}));},1000);
 try{const r=await fetch('config.json',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Account configuration unavailable');const config=await r.json(),endpoint=window.FireEyeAccountClient?.configuredEndpoint(config);if(endpoint)client=FireEyeAccountClient.create(endpoint);}
 catch{configurationFailed=true;}
 if(!client){loading=false;ready=true;paint();return;}
 window.addEventListener('fire-eye:risk-export-prepared',event=>{void client.record(event.detail).then(()=>{if(signedIn&&!client.signedIn){signedIn=false;paint();}}).catch(()=>{});});
 try{signedIn=await client.restore();}catch{signedIn=false;}finally{loading=false;ready=true;paint();}
})().catch(()=>{});
