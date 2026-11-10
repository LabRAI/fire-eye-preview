/* Lazy, integrity-checked render assets. Quality never changes forecast values. */
(function(global){
 "use strict";
 const revision="08133000efa914b6e77f0cc7c33308fc4e3f65f4",tiers=["low","medium","high"];
 function preferred(){try{const value=localStorage.getItem("fire-eye-scene-quality");if(tiers.includes(value))return value;}catch{}return matchMedia("(pointer:coarse)").matches||(navigator.deviceMemory||8)<=4?"low":"medium";}
 function remember(value){if(tiers.includes(value))try{localStorage.setItem("fire-eye-scene-quality",value);}catch{}}
 // Display budgets only. The geographic sample and forecast field are shared.
 function budget(tier,mobile=false){
  const table=mobile?{
   low:{trees:1400,detailTrees:70,grass:2800,vrTrees:1000,vrDetail:40,vrGrass:2200,particles:600},
   medium:{trees:1900,detailTrees:120,grass:4000,vrTrees:1600,vrDetail:65,vrGrass:3500,particles:1000},
   high:{trees:2200,detailTrees:160,grass:5500,vrTrees:2000,vrDetail:90,vrGrass:5000,particles:1400}
  }:{
   low:{trees:2000,detailTrees:100,grass:5500,vrTrees:1600,vrDetail:55,vrGrass:4000,particles:1000},
   medium:{trees:3800,detailTrees:220,grass:8500,vrTrees:2400,vrDetail:100,vrGrass:6500,particles:2000},
   high:{trees:5200,detailTrees:360,grass:12000,vrTrees:3000,vrDetail:150,vrGrass:9500,particles:3000}
  };return {...(table[tier]||table.low)};
 }
 function createLoader(manifestURL){
  const root=new URL(manifestURL,document.baseURI),base=new URL(".",root),cache=new Map();let disposed=false;
  async function bytes(url,d,signal,max=5000000){
   if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||!Number.isInteger(d.bytes)||d.bytes<1||d.bytes>max||!/^[a-f0-9]{64}$/.test(d.sha256))throw Error("Invalid scene asset");
   const versioned=new URL(url);versioned.searchParams.set('v',d.sha256.slice(0,16));
   const r=await fetch(versioned,{credentials:"omit",signal});if(!r.ok)throw Error("Scene material unavailable");const b=await r.arrayBuffer();
   if(b.byteLength!==d.bytes)throw Error("Scene material size mismatch");
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",b)),n=>n.toString(16).padStart(2,"0")).join("");if(hash!==d.sha256)throw Error("Scene material checksum mismatch");return b;
  }
  async function load(tier,signal){
   if(!tiers.includes(tier)||disposed)throw Error("Invalid scene quality");if(cache.has(tier))return cache.get(tier);
   const images=new Set(),textureTasks=new Map();
   const cancel=()=>{for(const image of images)image.close();};signal.addEventListener("abort",cancel,{once:true});
   try{
    const r=await fetch(root,{credentials:"omit",signal});if(!r.ok)throw Error("Scene quality unavailable");const index=await r.json();
    if(index.schema_version!==2||index.kind!=="mapped-simulation-assets"||index.upstream_revision!==revision)throw Error("Unsupported scene quality");
    const d=index.tiers?.[tier];if(!d)throw Error("Missing scene quality");const url=new URL(d.path,root),m=JSON.parse(new TextDecoder().decode(await bytes(url,d,signal,60000)));
    if(m.schema_version!==2||m.quality!==tier||m.upstream_revision!==revision||!Array.isArray(m.meshes)||m.meshes.length<5||m.meshes.length>8)throw Error("Invalid scene manifest");
    function texture(d){
     if(!d)return Promise.resolve(null);if(!textureTasks.has(d.sha256))textureTasks.set(d.sha256,(async()=>{
      const body=await bytes(new URL(d.path,url),d,signal,1500000);const bitmap=await createImageBitmap(new Blob([body],{type:d.mime_type}),{premultiplyAlpha:"none",colorSpaceConversion:"none"});
      if(signal.aborted||disposed||bitmap.width>2048||bitmap.height>2048){bitmap.close();throw Error("Scene texture cancelled");}images.add(bitmap);return {bitmap,sha256:d.sha256};
     })());return textureTasks.get(d.sha256);
    }
    const results=await Promise.allSettled(m.meshes.map(async a=>{
     if(a.stride_bytes!==44||!Number.isInteger(a.vertex_count)||a.vertex_count<1||a.vertex_count>65535||!Number.isInteger(a.index_count)||a.index_count<3||a.index_count%3||a.index_offset!==a.vertex_count*44||a.bytes!==a.index_offset+a.index_count*2||!(a.height_m>0)||!(a.crown_diameter_m>0)||!["grass","tree-canopy","tree-detail"].includes(a.role)||!Array.isArray(a.parts)||a.parts.length>4)throw Error("Invalid scene mesh");
     const body=await bytes(new URL(a.path,url),a,signal),vertices=new Float32Array(body,0,a.vertex_count*11),indices=new Uint16Array(body,a.index_offset,a.index_count);
     if(!vertices.every(Number.isFinite)||!indices.every(n=>n<a.vertex_count))throw Error("Invalid scene mesh values");let count=0;
     const parts=await Promise.all(a.parts.map(async p=>{if(p.start!==count||!Number.isInteger(p.count)||p.count<3||p.count%3||p.alpha_test<0||p.alpha_test>1||p.opacity<0||p.opacity>1)throw Error("Invalid scene material");count+=p.count;return {...p,image:await texture(p.texture)};}));
     if(count!==a.index_count)throw Error("Invalid scene material range");return {...a,vertices,indices,parts};
    }));
    const failure=results.find(x=>x.status==="rejected");if(failure)throw failure.reason;
    if(disposed||signal.aborted)throw Error("Scene loading cancelled");const meshes=results.map(x=>x.value);cache.set(tier,meshes);return meshes;
   }catch(error){cancel();throw error;}finally{signal.removeEventListener("abort",cancel);}
  }
  return {load,dispose(){disposed=true;for(const meshes of cache.values())for(const a of meshes)for(const p of a.parts)p.image?.bitmap.close();cache.clear();}};
 }
 global.FireEyeSceneQuality={revision,tiers,preferred,remember,budget,createLoader};
})(window);
