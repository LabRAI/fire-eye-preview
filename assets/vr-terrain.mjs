/* On-demand terrain for one 480 m scene. No regional preprocessing or server. */
const SIZE=256,ZOOM=12,N=2**ZOOM,cache=new Map();
export const terrainCredit='Terrain: Mapzen Terrain Tiles · USGS and other open-data providers';
export function tilePoint(p){
 if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>85)throw Error('Choose a location within the map coverage.');
 return [(p[0]+180)/360*N*SIZE,(1-Math.log(Math.tan(Math.PI/4+p[1]*Math.PI/360))/Math.PI)/2*N*SIZE];
}
export const decode=(r,g,b)=>r*256+g+b/256-32768;
async function tile(x,y,signal){
 x=((x%N)+N)%N;const key=x+'/'+y;if(cache.has(key))return cache.get(key);
 const response=await fetch('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/'+ZOOM+'/'+key+'.png',{credentials:'omit',signal});
 if(!response.ok)throw Error('Local terrain could not load. Reload the scene to retry.');
 const blob=await response.blob();if(blob.size>700000)throw Error('Unexpected terrain tile size.');
 const bitmap=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
 try{
  if(bitmap.width!==SIZE||bitmap.height!==SIZE)throw Error('Unexpected terrain tile dimensions.');
  const canvas=document.createElement('canvas');canvas.width=canvas.height=SIZE;const context=canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(bitmap,0,0);const rgba=context.getImageData(0,0,SIZE,SIZE).data,heights=new Float32Array(SIZE*SIZE);
  for(let i=0;i<heights.length;i++)heights[i]=rgba[i*4+3]===255?decode(rgba[i*4],rgba[i*4+1],rgba[i*4+2]):NaN;
  if(signal.aborted)throw signal.reason;cache.set(key,heights);while(cache.size>24)cache.delete(cache.keys().next().value);return heights;
 }finally{bitmap.close();}
}
export async function loadTerrain(center,{signal,radius=265}={}){
 const q=tilePoint(center),metresPerPixel=40075016.68557849*Math.cos(center[1]*Math.PI/180)/(N*SIZE),padding=radius/metresPerPixel+2,tiles=new Map(),jobs=[];
 const bounded=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)]);
 for(let x=Math.floor((q[0]-padding)/SIZE);x<=Math.floor((q[0]+padding)/SIZE);x++)for(let y=Math.floor((q[1]-padding)/SIZE);y<=Math.floor((q[1]+padding)/SIZE);y++){
  if(y<0||y>=N)throw Error('Choose a location within the map coverage.');
  jobs.push({x,y});
 }
 if(jobs.length>9)throw Error('Local terrain request exceeds the scene budget.');
 await Promise.all(jobs.map(async({x,y})=>{tiles.set(x+'/'+y,await tile(x,y,bounded));}));
 const at=(x,y)=>{const tx=Math.floor(x/SIZE),ty=Math.floor(y/SIZE),values=tiles.get(tx+'/'+ty);return values?values[((y%SIZE)+SIZE)%SIZE*SIZE+((x%SIZE)+SIZE)%SIZE]:NaN;};
 const height=p=>{const q=tilePoint(p),x=q[0]-.5,y=q[1]-.5,i=Math.floor(x),j=Math.floor(y),a=x-i,b=y-j,v=[at(i,j),at(i+1,j),at(i,j+1),at(i+1,j+1)];return v.every(Number.isFinite)?v[0]*(1-a)*(1-b)+v[1]*a*(1-b)+v[2]*(1-a)*b+v[3]*a*b:NaN;};
 return {height,terrainReady:true,terrainStatus:'ready',terrainSource:terrainCredit,terrainResolutionMetres:metresPerPixel,tileCount:jobs.length};
}
