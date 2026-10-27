'use strict';
// Sampling and color rules retained from the established experiment renderer.
function sample(f,x,y,fine){
 const [a,b]=project.forward([x,y]);const xx=(a-f.ox)/f.size,yy=(f.oy-b)/f.size;
 const col=Math.floor(xx),row=Math.floor(yy);if(col<0||row<0||col>=f.width||row>=f.height)return NaN;
 const n=f.width*f.height,i=row*f.width+col,c=f.values[i];if(!Number.isFinite(c))return NaN;
 if(fine&&f.weightsRevision){
  if(c===0||c===1)return c;const bias=f.values[3*n+i];if(!Number.isFinite(bias))return c;
  const chunk=weightChunk(f,row,col),sr=Math.min(99,Math.floor((yy-row)*100)),sc=Math.min(99,Math.floor((xx-col)*100));
  const code=chunk.codes[((row-chunk.row)*100+sr)*chunk.cols*100+(col-chunk.col)*100+sc];
  if(code===255)return c;
  return 1/(1+Math.exp(-(-6+code/254*12+bias)));
 }
 const u=(Math.floor((xx-col)*100)+.5)/100-.5,v=(Math.floor((yy-row)*100)+.5)/100-.5;
 return Math.max(0,Math.min(1,c+f.values[n+i]*u+f.values[2*n+i]*v));
}
const thresholds=[0,.03,.05,.08,.15,.25,.4,.6,1];
const colors=['25572b','25572b','2f7136','6f9641','b7bb3e','e0b433','dd702d','a92f2b','a92f2b'].map(s=>[0,2,4].map(i=>parseInt(s.slice(i,i+2),16)));
const alphaX=[0,.03,.05,.08,.15,.25,.4,1],alphaY=[.16,.22,.32,.45,.58,.68,.76,.82];
function interpolate(value,x,y){let k=0;while(k<x.length-2&&value>x[k+1])k++;const t=(value-x[k])/(x[k+1]-x[k]);return y[k]*(1-t)+y[k+1]*t;}
function render(job,f){
 const pixels=new Uint8Array(256*256*4),world=40075016.68557849,tile=world/(2**job.z),left=-world/2+job.x*tile,top=world/2-job.y*tile;
 const offsets=job.z<=5?[[.25,.25],[.75,.25],[.25,.75],[.75,.75]]:[[.5,.5]];
 for(let row=0;row<256;row++)for(let col=0;col<256;col++){
  let total=0,valid=0;for(const [dx,dy] of offsets){const value=sample(f,left+(col+dx)*tile/256,top-(row+dy)*tile/256,job.z>=10);if(Number.isFinite(value)){total+=value;valid++;}}
  if(!valid)continue;const value=total/valid,index=(row*256+col)*4;
  for(let channel=0;channel<3;channel++)pixels[index+channel]=Math.round(interpolate(value,thresholds,colors.map(c=>c[channel])));
  pixels[index+3]=Math.round(255*interpolate(value,alphaX,alphaY)*valid/offsets.length);
 }
 return png(pixels);
}
