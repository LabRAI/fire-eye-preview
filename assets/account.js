/* Optional account access never prevents browsing or downloading forecasts. */
(async()=>{
 'use strict';
 const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 const host=document.querySelector('.header-actions,.site-header nav');if(!host)return;
 const button=document.getElementById('account-open')||element('button',null,'account-open');
 button.id='account-open';button.type='button';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-label','Sign in to Fire-eye');button.title='Sign in to Fire-eye';
 const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
 for(const [tag,attrs] of [['circle',{cx:12,cy:8,r:3.5}],['path',{d:'M4.5 21v-2a7.5 7.5 0 0 1 15 0v2'}]]){const n=document.createElementNS(icon.namespaceURI,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));icon.append(n);}
 const label=element('span','Sign in','account-label');button.replaceChildren(icon,label);if(!button.isConnected)host.append(button);document.body.classList.add('account-entry-enabled');
 const dialog=element('dialog',null,'account-dialog'),heading=element('div',null,'account-heading'),title=element('h2','Sign in to Fire-eye'),close=element('button','×','account-close');
 close.type='button';close.setAttribute('aria-label','Close account');heading.append(title,close);
 const status=element('p'),privacy=element('p','GitHub verifies your identity. Fire-eye stores a pseudonymous ID and sign-in/export activity. We do not retain your GitHub profile, email or provider access token.','muted');
 const action=element('button','Checking sign-in…','account-action'),notice=element('p','Browsing and downloads remain available without signing in.','muted');action.type='button';action.disabled=true;privacy.hidden=true;
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');dialog.setAttribute('aria-label','Fire-eye account');dialog.append(heading,status,privacy,action,notice);document.body.append(dialog);
 let client=null,signedIn=false,busy=false,loading=true,configurationFailed=false;
 function paint(){
  signedIn=!!client?.signedIn&&signedIn;label.textContent=signedIn?'Account':'Sign in';title.textContent=signedIn?'Your account':'Sign in to Fire-eye';
  button.setAttribute('aria-label',signedIn?'Open your Fire-eye account':'Sign in to Fire-eye');button.title=signedIn?'Your account':'Sign in to Fire-eye';privacy.hidden=!client;
  action.disabled=busy||!client;action.textContent=loading?'Checking sign-in…':!client?'GitHub sign-in coming soon':signedIn?'Sign out':'Continue with GitHub';
  status.textContent=loading?'Checking sign-in availability…':!client?(configurationFailed?'Sign-in is currently unavailable. You can continue using Fire-eye.':'GitHub sign-in is not enabled yet. You can continue using Fire-eye without an account.'):signedIn?'Signed in with GitHub.':'Sign in using your GitHub account.';
 }
 button.onclick=()=>{paint();if(!dialog.open)dialog.showModal();};close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>button.focus());
 dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
 action.onclick=async()=>{if(busy||!client)return;busy=true;action.disabled=true;
  try{if(signedIn){const revoked=await client.logout();signedIn=false;paint();if(!revoked)status.textContent='Signed out on this device. The server session will expire automatically.';}
   else{status.textContent='Opening GitHub…';const target=new URL(location.href),map=window.fireEyePreview?.map;if(map)target.searchParams.set('view',[...map.getCenter().toArray(),map.getZoom()].join(','));await client.start(target.href);}}
  catch{signedIn=client.signedIn;paint();status.textContent='Account service is temporarily unavailable. You can continue using Fire-eye.';}
  finally{busy=false;action.disabled=!client;}
 };
 window.fireEyeAccount={get signedIn(){return signedIn;},get configured(){return !!client;},open:()=>button.click()};paint();
 try{const r=await fetch('config.json',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Account configuration unavailable');const config=await r.json(),endpoint=window.FireEyeAccountClient?.configuredEndpoint(config);if(endpoint)client=FireEyeAccountClient.create(endpoint);}
 catch{configurationFailed=true;}
 loading=false;paint();if(!client)return;
 window.addEventListener('fire-eye:risk-export-prepared',event=>{void client.record(event.detail).then(()=>{if(signedIn&&!client.signedIn){signedIn=false;paint();}}).catch(()=>{});});
 signedIn=await client.restore();paint();
})().catch(()=>{});
