/* Optional GitHub sign-in. Only the avatar is held in tab storage until sign-out. */
(function(global){
 'use strict';
 const KEY='fire-eye-account-session-v1',PENDING='fire-eye-account-pending-v1',CHECK='fire-eye-account-check-v1';
 function configuredEndpoint(config,allowOptIn=true){
  if(config?.account_gateway_url)return config.account_gateway_url;
  const endpoint=config?.account_check_gateway_url;if(!endpoint)return null;
  try{
   const optIn=allowOptIn&&new URL(location.href).searchParams.get('account_check')==='1';
   if(optIn)sessionStorage.setItem(CHECK,JSON.stringify({endpoint,expires:Date.now()+3600000}));
   const check=JSON.parse(sessionStorage.getItem(CHECK)||'null');
   if(check?.endpoint===endpoint&&check.expires>Date.now())return endpoint;
   sessionStorage.removeItem(CHECK);
  }catch{}
  return null;
 }
 function avatarURL(value){try{const u=new URL(value),parts=u.pathname.split('/');return u.protocol==='https:'&&u.hostname==='avatars.githubusercontent.com'&&!u.username&&!u.password&&!u.hash&&parts.length===3&&parts[1]==='u'&&/^[1-9][0-9]*$/.test(parts[2])&&u.search==='?s=64'?u.href:null;}catch{return null;}}
 const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 function create(endpoint){
  const url=new URL(endpoint),app=new URL('./',document.baseURI);
  if(url.protocol!=='https:'||! /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)||url.pathname!=='/functions/v1/fire-eye-account'||url.search||url.hash||url.username||url.password)throw Error('Invalid account gateway');
  const read=key=>{try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}};
  const saved=()=>{const value=read(KEY);return value?.expires_at>Date.now()/1000&&typeof value.session_token==='string'?value:null;};
  async function call(path,body={},token=null){
   const r=await fetch(url.href+'/'+path,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    body:JSON.stringify(body),signal:AbortSignal.timeout(path==='challenge-submit'?90000:path==='exchange'?40000:12000)});
   if(!r.ok){let message=r.status===401?'Please sign in again.':'Account service is temporarily unavailable. You can continue using the map.',retryAfter=0;if(path==='challenge-submit'||path==='download-permit'){try{const body=await r.json();if(typeof body.error==='string'&&body.error.length<240)message=body.error;if(r.status===429)retryAfter=Math.max(1,Math.min(180,Number(body.retry_after)||180));}catch{}}const error=Error(message);error.status=r.status;error.retryAfter=retryAfter;throw error;}
   if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Sign-in response unavailable.');return r.json();
  }
  function returnURL(value){const target=new URL(value,app);if(target.origin!==app.origin||!['','index.html','resolution.html','stories.html','challenge.html','what-if.html','team.html'].some(name=>target.pathname===app.pathname+name))return app.href;return target.href;}
  return {
   get signedIn(){return !!saved();},
   async authorize(){const s=saved();if(!s)throw Object.assign(Error('Please sign in to continue.'),{status:401});try{return await call('session',{},s.session_token);}catch(e){if(e.status===401)sessionStorage.removeItem(KEY);throw e;}},
   async permitDownload(format){const s=saved();if(!s)throw Object.assign(Error('Please sign in before downloading.'),{status:401});try{return await call('download-permit',{format},s.session_token);}catch(e){if(e.status===401)sessionStorage.removeItem(KEY);throw e;}},
   async submitForecast(data){const s=saved();if(!s)throw Error('Please sign in before submitting.');return call('challenge-submit',data,s.session_token);},
   get avatarURL(){return avatarURL(saved()?.avatar_url);},
   async restore(){const s=saved();if(!s)return false;try{await call('session',{},s.session_token);return true;}catch(e){if(e.status===401)sessionStorage.removeItem(KEY);return false;}},
   async start(target=location.href){
    const verifier=b64(crypto.getRandomValues(new Uint8Array(32))),challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))),nonce=crypto.randomUUID();
    const result=await call('start',{challenge,nonce}),authorization=new URL(result.authorize_url);
    if(authorization.origin!=='https://github.com'||authorization.pathname!=='/login/oauth/authorize'||authorization.searchParams.get('state')!==result.state)throw Error('Invalid sign-in destination.');
    sessionStorage.setItem(PENDING,JSON.stringify({verifier,state:result.state,created:Date.now(),return_url:returnURL(target)}));
    location.assign(authorization.href);
   },
   async complete(code,state){
    const pending=read(PENDING);sessionStorage.removeItem(PENDING);
    if(!pending||Date.now()-pending.created>600000||state!==pending.state||!code)throw Error('This sign-in has expired. Return to the map and try again.');
    const result=await call('exchange',{code,state,verifier:pending.verifier});
    if(typeof result.session_token!=='string'||result.session_token.length>4096||!(result.expires_at>Date.now()/1000)||result.expires_at>Date.now()/1000+29000)throw Error('Invalid account session.');
    const avatar_url=avatarURL(result.avatar_url);
    sessionStorage.setItem(KEY,JSON.stringify({session_token:result.session_token,expires_at:result.expires_at,avatar_url}));return returnURL(pending.return_url);
   },
   async logout(){const s=saved();sessionStorage.removeItem(KEY);sessionStorage.removeItem(PENDING);if(s){try{await call('logout',{},s.session_token);}catch{return false;}}return true;},
   async record(metadata){const s=saved();if(!s)return false;try{await call('event',{id:crypto.randomUUID(),kind:'risk_export_prepared',metadata},s.session_token);return true;}catch(e){if(e.status===401)sessionStorage.removeItem(KEY);return false;}}
  };
 }
 global.FireEyeAccountClient={create,configuredEndpoint};
})(window);
