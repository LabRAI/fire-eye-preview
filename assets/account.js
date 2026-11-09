(async()=>{
 'use strict';
 const config=await fetch('config.json',{signal:AbortSignal.timeout(5000)}).then(r=>r.json()).catch(()=>null);
 if(!config?.account_gateway_url||!window.FireEyeAccountClient)return;
 let client;try{client=FireEyeAccountClient.create(config.account_gateway_url);}catch{return;}
 const element=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text||'';if(cls)e.className=cls;return e;};
 const button=element('button','Sign in','account-open'),mobile=element('button','Sign in with GitHub','wide-button account-mobile');
 button.id='account-open';mobile.id='account-mobile';button.type=mobile.type='button';
 document.querySelector('.header-actions')?.append(button);document.getElementById('fit-conus')?.before(mobile);
 const dialog=element('dialog',null,'account-dialog'),heading=element('div',null,'account-heading'),title=element('h2','Your account'),close=element('button','×','account-close');
 close.type='button';close.setAttribute('aria-label','Close account');heading.append(title,close);
 const status=element('p'),privacy=element('p','GitHub verifies your identity. Fire-eye stores a pseudonymous ID and sign-in/export activity. We do not retain your GitHub profile, email or provider access token.','muted');
 const action=element('button','Continue with GitHub','account-action'),notice=element('p','Browsing and downloads remain available without signing in.','muted');action.type='button';
 status.setAttribute('role','status');dialog.setAttribute('aria-label','GitHub account');dialog.append(heading,status,privacy,action,notice);document.body.append(dialog);
 let signedIn=false,busy=false;
 function paint(){signedIn=client.signedIn&&signedIn;button.textContent=signedIn?'Account':'Sign in';mobile.textContent=signedIn?'GitHub account':'Sign in with GitHub';action.textContent=signedIn?'Sign out':'Continue with GitHub';status.textContent=signedIn?'Signed in with GitHub.':'Sign in using your GitHub account.';}
 button.onclick=mobile.onclick=()=>{paint();dialog.showModal();};close.onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
 action.onclick=async()=>{if(busy)return;busy=true;action.disabled=true;
  try{if(signedIn){const revoked=await client.logout();signedIn=false;paint();if(!revoked)status.textContent='Signed out on this device. The server session will expire automatically.';}else{status.textContent='Opening GitHub…';
   const target=new URL(location.href),map=window.fireEyePreview?.map;if(map)target.searchParams.set('view',[...map.getCenter().toArray(),map.getZoom()].join(','));await client.start(target.href);}}
  catch{signedIn=client.signedIn;paint();status.textContent='Account service is temporarily unavailable. You can continue using the map.';}
  finally{busy=false;action.disabled=false;}
 };
 window.addEventListener('fire-eye:risk-export-prepared',event=>{void client.record(event.detail).then(()=>{if(signedIn&&!client.signedIn){signedIn=false;paint();}}).catch(()=>{});});
 paint();signedIn=await client.restore();paint();
 window.fireEyeAccount={get signedIn(){return signedIn;},open:()=>button.click()};
})().catch(()=>{});
