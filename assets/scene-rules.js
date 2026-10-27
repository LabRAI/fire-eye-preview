'use strict';
// Browser port of the pinned upstream scene rules. Constants are exported from
// the original Python module; CPython's integer-seeded RNG preserves realizations.
(function(root){
 class PythonRandom {
  constructor(seed){this.mt=new Uint32Array(624);this.mt[0]=19650218;for(let i=1;i<624;i++)this.mt[i]=(Math.imul(1812433253,this.mt[i-1]^(this.mt[i-1]>>>30))+i)>>>0;let i=1,j=0;const key=[seed>>>0];for(let k=624;k;k--){this.mt[i]=((this.mt[i]^Math.imul(this.mt[i-1]^(this.mt[i-1]>>>30),1664525))+key[j]+j)>>>0;i++;j++;if(i>=624){this.mt[0]=this.mt[623];i=1;}if(j>=key.length)j=0;}for(let k=623;k;k--){this.mt[i]=((this.mt[i]^Math.imul(this.mt[i-1]^(this.mt[i-1]>>>30),1566083941))-i)>>>0;i++;if(i>=624){this.mt[0]=this.mt[623];i=1;}}this.mt[0]=0x80000000;this.index=624;}
  uint(){if(this.index>=624){for(let k=0;k<624;k++){const y=(this.mt[k]&0x80000000)|(this.mt[(k+1)%624]&0x7fffffff);this.mt[k]=(this.mt[(k+397)%624]^(y>>>1)^((y&1)?0x9908b0df:0))>>>0;}this.index=0;}let y=this.mt[this.index++];y^=y>>>11;y^=(y<<7)&0x9d2c5680;y^=(y<<15)&0xefc60000;y^=y>>>18;return y>>>0;}
  random(){return ((this.uint()>>>5)*67108864+(this.uint()>>>6))/9007199254740992;}
  uniform(a,b){return a+(b-a)*this.random();}
  choice(a){const k=32-Math.clz32(a.length);let v;do{v=this.uint()>>>(32-k);}while(v>=a.length);return a[v];}
  weighted(entries){const total=entries.reduce((s,x)=>s+x[1],0),v=this.random()*total;let t=0;for(const [name,w]of entries){t+=w;if(v<t)return name;}return entries.at(-1)[0];}
 }
 function pyRound(value,digits=0){if(digits)return Number(value.toFixed(digits));const n=Math.floor(value),r=value-n;return r===.5?(n%2?n+1:n):Math.round(value);}
 const numeric=(v,lo=-Infinity,hi=Infinity)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi?v:null;
 function tier(value,edges,names){for(let i=0;i<edges.length;i++)if(value<edges[i])return names[i];return names.at(-1);}
 function decide(inputs,rng,c){
  const density=numeric(inputs.housing_density,0),fuel=numeric(inputs.fuel_fbfm40),canopy=numeric(inputs.canopy_cover),risk=numeric(inputs.occupancy_probability,0,1),frp=numeric(inputs.fire_radiative_power,0);
  const ground=c.GROUND_BY_FUEL[fuel]||'grassland';let canopyTier=c.CANOPY_TIER[canopy]||'none';if(ground==='water')canopyTier='none';
  const [lo,hi]=c.COVER_RANGE[canopyTier],treeCover=hi>0?rng.uniform(lo,hi):0,expected=(density||0)*(c.SCENE_SIZE/1000)**2;
  let houseCount=Math.trunc(expected)+(rng.random()<expected-Math.trunc(expected)?1:0);houseCount=ground==='water'?0:Math.min(houseCount,c.MAX_HOUSES);
  const riskTier=risk===null?'low':tier(risk,c.RISK_EDGES,['low','medium','high','very_high']),fireProb=c.BURNABLE.includes(ground)?c.FIRE_PROB[riskTier]:0,fire=rng.random()<fireProb;
  let level='none',frpSource=null;if(fire){if(frp!==null){level=tier(frp,c.FRP_EDGES,['small','medium','large','extreme']);frpSource='observed';}else{level=rng.weighted(Object.entries(c.FRP_DRAW));frpSource='sampled';}}
  return {ground,tree_cover:treeCover,house_count:houseCount,grass_count:pyRound((c.GRASS_PER_M2[ground]||0)*c.AREA),shrub_count:pyRound((c.SHRUB_PER_M2[ground]||0)*c.AREA),fire,fire_level:level,fire_location:fire?(c.FIRE_LOCATION[ground]||'none'):'none',crown_fire:fire&&['large','extreme'].includes(level)&&['medium','dense'].includes(canopyTier),smoke_level:c.SMOKE[level],sky:c.SKY[level],debug:{inputs,canopy_tier:canopyTier,expected_houses:pyRound(expected,3),risk_tier:riskTier,fire_probability:fireProb,frp_source:frpSource}};
 }
 function smooth(rng,scale){const waves=Array.from({length:4},()=>[rng.uniform(0,2*Math.PI),rng.uniform(0,2*Math.PI),rng.uniform(.6,1.4)*scale]);return(x,y)=>.5+waves.reduce((s,[a,p,k])=>s+Math.sin((x*Math.cos(a)+y*Math.sin(a))*k+p),0)/8;}
 function place(d,rng,c,assets){
  const half=c.SCENE_SIZE/2,all=Object.values(assets),treesM=all.filter(a=>a.kind==='tree'),shrubsM=all.filter(a=>a.kind==='shrub'),greenM=all.filter(a=>a.kind==='grass'&&a.species==='green'),dryM=all.filter(a=>a.kind==='grass'&&a.species==='dry'),housesM=all.filter(a=>a.kind==='house');
  const houses=[],trees=[],shrubs=[],grass=[],clear=(x,y,r)=>houses.every(h=>(x-h.x)**2+(y-h.y)**2>(r+h.r)**2);
  let tries=0;while(houses.length<d.house_count&&tries<5000){tries++;const hm=rng.choice(housesM),r=Math.hypot(hm.footprint_x_m,hm.footprint_y_m)/2+.5,x=rng.uniform(-half+r,half-r),y=rng.uniform(-half+r,half-r);if(clear(x,y,r+.5))houses.push({name:hm.name,x,y,rot:rng.uniform(0,2*Math.PI),r});}
  const target=c.SCENE_SIZE**2*d.tree_cover;let covered=0;tries=0;while(covered<target&&tries<30000){tries++;const tm=rng.choice(treesM),s=rng.uniform(.8,1.2),r=tm.crown_diameter_m*s/2,x=rng.uniform(-half,half),y=rng.uniform(-half,half);if(!clear(x,y,r*.5)||trees.some(t=>(x-t.x)**2+(y-t.y)**2<((r+t.r)*.6)**2))continue;trees.push({name:tm.name,x,y,rot:rng.uniform(0,2*Math.PI),s,sz:s*rng.uniform(.9,1.15),r,h:tm.height_m*s});covered+=Math.PI*r*r;}
  tries=0;while(shrubs.length<d.shrub_count&&tries<d.shrub_count*20){tries++;const x=rng.uniform(-half,half),y=rng.uniform(-half,half);if(clear(x,y,1.5))shrubs.push({name:rng.choice(shrubsM).name,x,y,rot:rng.uniform(0,2*Math.PI),s:rng.uniform(.6,1.1)});}
  const density=smooth(rng,.08),dryness=smooth(rng,.06);tries=0;while(grass.length<d.grass_count&&tries<d.grass_count*6){tries++;const x=rng.uniform(-half,half),y=rng.uniform(-half,half);if(rng.random()>.35+density(x,y)*.65||!clear(x,y,.5))continue;const pool=dryness(x,y)>.55?dryM:greenM;grass.push({name:rng.choice(pool).name,x,y,rot:rng.uniform(0,2*Math.PI),s:rng.uniform(1,1.8)});}
  let fire=null;if(d.fire){const radius=c.FIRE_RADIUS[d.fire_level];let center=null;for(let i=0;i<2000;i++){const x=rng.uniform(-half*.8,half*.8),y=rng.uniform(-half*.8,half*.8);if(clear(x,y,c.FIRE_HOUSE_GAP)){center=[x,y];break;}}if(!center){let best=-Infinity;for(let i=0;i<500;i++){const point=[rng.uniform(-half,half),rng.uniform(-half,half)],distance=houses.length?Math.min(...houses.map(h=>(point[0]-h.x)**2+(point[1]-h.y)**2)):0;if(distance>best){best=distance;center=point;}}}fire={center,radius,burning_trees:d.crown_fire?trees.filter(t=>(t.x-center[0])**2+(t.y-center[1])**2<radius**2):[]};}
  return {houses,trees,shrubs,grass,fire};
 }
 function runRules(inputs,seed,c,assets){const rng=new PythonRandom(seed),decision=decide(inputs,rng,c),layout=place(decision,rng,c,assets),three=(x,y,z=0)=>[pyRound(x,2),pyRound(z,2),pyRound(-y,2)];
  let fire={enabled:false,level:'none',location:'none',center:null,radius:0,crown_fire:false,burning_trees:[]};if(layout.fire){const f=layout.fire;fire={enabled:true,level:decision.fire_level,location:decision.fire_location,center:three(...f.center),radius:f.radius,crown_fire:decision.crown_fire,burning_trees:f.burning_trees.map(t=>({position:three(t.x,t.y),height:pyRound(t.h,2)}))};}
  const scene={seed,scene_size:c.SCENE_SIZE,ground:decision.ground,fire,smoke_level:decision.smoke_level,sky:decision.sky,spawn:{position:three(...c.SPAWN),look_at:three(0,0,c.SPAWN[2])},debug:{...decision.debug,counts:Object.fromEntries(['trees','shrubs','grass','houses'].map(k=>[k,layout[k].length])),tree_cover:pyRound(decision.tree_cover,3)}};
  const placements={};for(const group of ['trees','shrubs','grass','houses'])for(const item of layout[group]){(placements[item.name]||=[]).push([pyRound(item.x,3),pyRound(item.y,3),pyRound(item.rot,5),pyRound(item.s??1,4),pyRound(item.sz??item.s??1,4)]);}
  return {decision,scene,placements};
 }
 root.FireEyeRules={PythonRandom,decide,runRules};if(typeof module!=='undefined')module.exports=root.FireEyeRules;
})(typeof self!=='undefined'?self:globalThis);
