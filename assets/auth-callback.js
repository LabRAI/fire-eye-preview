(async()=>{
 const query=new URL(location.href).searchParams,code=query.get('code'),state=query.get('state'),denied=query.has('error');
 // Remove the one-use OAuth code before loading any other document or resource.
 history.replaceState({},'',location.pathname);
 const status=document.getElementById('callback-status');
 try{
  if(denied||!code||!state)throw Error('Sign-in was not completed. Return to the map to try again.');
  const config=await fetch('config.json',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
  if(!config.account_gateway_url)throw Error('GitHub sign-in is not enabled yet.');
  const client=FireEyeAccountClient.create(config.account_gateway_url),target=await client.complete(code,state);location.replace(target);
 }catch(error){status.textContent=error.message||'Sign-in is temporarily unavailable. You can continue using the map.';}
})().catch(()=>{});
