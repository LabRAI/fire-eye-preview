(function(root){
 'use strict';
 const CRS='+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=23 +lon_0=-96 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs';
 const gridOK=g=>g?.crs==='EPSG:5070'&&g.width===938&&g.height===609&&g.transform?.join(',')==='5000,0,-2362425,0,-5000,3267405';
 const area=polys=>polys.reduce((sum,p)=>sum+p.reduce((s,r,j)=>{let a=0;for(let i=1;i<r.length;i++)a+=r[i-1][0]*r[i][1]-r[i][0]*r[i-1][1];return s+(j?-1:1)*Math.abs(a/2);},0),0);
 const project=(ps,pr)=>ps.map(p=>p.map(r=>r.map(v=>pr.forward(v))));
 const bounds=points=>points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 function intersects(a,b,c,d){const v=[cross(a,b,c),cross(a,b,d),cross(c,d,a),cross(c,d,b)],epsilon=1e-10;return Math.max(a[0],b[0])+epsilon>=Math.min(c[0],d[0])&&Math.max(c[0],d[0])+epsilon>=Math.min(a[0],b[0])&&Math.max(a[1],b[1])+epsilon>=Math.min(c[1],d[1])&&Math.max(c[1],d[1])+epsilon>=Math.min(a[1],b[1])&&v[0]*v[1]<=epsilon&&v[2]*v[3]<=epsilon;}
 function selection(geometry){
  if(geometry?.type!=='Polygon'||geometry.coordinates?.length!==1)throw Error('Draw one polygon to select an area.');
  const ring=geometry.coordinates[0].map(p=>[...p]);if(ring.length<4||ring.length>129||ring.some(p=>p.length!==2||!p.every(Number.isFinite)||p[0]<-125||p[0]>-66||p[1]<24||p[1]>50))throw Error('Draw a polygon within the continental United States.');
  if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw Error('Finish the polygon before downloading.');
  if(new Set(ring.slice(0,-1).map(p=>p.join(','))).size!==ring.length-1)throw Error('Polygon vertices must be distinct.');
  for(let i=0;i<ring.length-1;i++)for(let j=i+2;j<ring.length-1;j++)if(!(i===0&&j===ring.length-2)&&intersects(ring[i],ring[i+1],ring[j],ring[j+1]))throw Error('Polygon edges cannot cross.');
  const pr=proj4('EPSG:4326',CRS),projected=project([[ring]],pr),size=area(projected);
  if(size<10000)throw Error('Select at least 0.01 square kilometres.');
  if(size>100000*1e6)throw Error('Select a smaller area (maximum 100,000 square kilometres).');
  return {geometry:{type:'Polygon',coordinates:[ring]},pr,projected,area:size,bounds:bounds(projected[0][0])};
 }
 function extent(b,g){if(!gridOK(g))throw Error('Unsupported forecast grid');const t=g.transform;return [Math.max(0,Math.floor((b[0]-t[2])/t[0])),Math.max(0,Math.floor((b[3]-t[5])/t[4])),Math.min(g.width,Math.ceil((b[2]-t[2])/t[0])),Math.min(g.height,Math.ceil((b[1]-t[5])/t[4]))];}
 function cellRing(row,col,g,pr){const t=g.transform,x=t[2]+col*t[0],y=t[5]+row*t[4];return [[x,y],[x+5000,y],[x+5000,y-5000],[x,y-5000],[x,y]].map(p=>pr.inverse(p));}
 function selectedCells(geometry,g){
  const s=selection(geometry),[x0,y0,x1,y1]=extent(s.bounds,g);if((x1-x0)*(y1-y0)>20000)throw Error('Select a more compact area.');
  const cells=[];for(let row=y0;row<y1;row++)for(let col=x0;col<x1;col++){
   const clipped=polygonClipping.intersection([cellRing(row,col,g,s.pr)],s.geometry.coordinates);if(!clipped.length)continue;
   const size=area(project(clipped,s.pr));if(size>1){cells.push({row,col,index:row*g.width+col,area:size,geometry:{type:clipped.length===1?'Polygon':'MultiPolygon',coordinates:clipped.length===1?clipped[0]:clipped}});}
   if(cells.length>10000)throw Error('Select a smaller area.');
  }
  return {...s,cells};
 }
 function exportRisk(s,values,run,issue){
  let validArea=0;const features=s.cells.map(c=>{const v=values.get(c.index),value=Number.isFinite(v)&&v>=0&&v<=1?v:null;if(value!==null)validArea+=c.area;return {type:'Feature',geometry:c.geometry,properties:{fire_risk:value,grid_row:c.row,grid_col:c.col,area_km2:c.area/1e6}};});
  if(!validArea)throw Error('No forecast coverage in this polygon.');
  return {type:'FeatureCollection',metadata:{model_input_utc:issue,target_time_utc:run.target_time_utc,lead_hours:run.lead_hours,source_id:run.source_id,native_resolution_m:5000,measure:'Modeled active-fire occupancy, not ignition probability',selected_area_km2:s.area/1e6,coverage_fraction:Math.min(1,validArea/s.area),selection:s.geometry,missing_value:null},features};
 }
 function summary(grid,view,bbox,features){
  if(!gridOK(grid)||view.byteLength!==grid.width*grid.height*4||!Array.isArray(bbox)||bbox.length!==4||!bbox.every(Number.isFinite))throw Error('Invalid summary grid');
  const pr=proj4('EPSG:4326',CRS),t=grid.transform,value=(r,c)=>view.getFloat32((r*grid.width+c)*4,true),valid=v=>Number.isFinite(v)&&v>=0&&v<=1;
  let count=0,elevated=0;for(let r=0;r<grid.height;r++)for(let c=0;c<grid.width;c++){const v=value(r,c);if(!valid(v))continue;const [x,y]=pr.inverse([t[2]+(c+.5)*5000,t[5]-(r+.5)*5000]);if(x<bbox[0]||x>bbox[2]||y<bbox[1]||y>bbox[3])continue;count++;if(v>=.08)elevated++;}
  const unique=new Map();for(const f of features){const p=f.properties,[lng,lat]=f.geometry.coordinates;if(p.kind!=='WF'||lng<bbox[0]||lng>bbox[2]||lat<bbox[1]||lat>bbox[3])continue;unique.set(p.id,{lng,lat,acres:typeof p.acres==='number'?p.acres:null});}
  const fires=[...unique.values()],candidates=new Map();
  for(const fire of fires){const [x,y]=pr.forward([fire.lng,fire.lat]),r0=Math.floor((t[5]-y)/5000),c0=Math.floor((x-t[2])/5000);for(let r=Math.max(0,r0-8);r<Math.min(grid.height,r0+9);r++)for(let c=Math.max(0,c0-8);c<Math.min(grid.width,c0+9);c++){
   const v=value(r,c),key=r*grid.width+c;if(!valid(v)||v<.08||candidates.has(key))continue;const ring=cellRing(r,c,grid,pr);candidates.set(key,{value:60,probFire:v,geometry:{type:'Polygon',coordinates:[ring]},bounds:bounds(ring)});
  }}
  const matched=FireMatch.calculateFireMatch({cells:[...candidates.values()],totalCells:count,fires,toleranceKm:25});return {...matched,forecastArea:count?elevated/count:null,validCells:count,elevatedCells:elevated,significantFires:fires.filter(f=>f.acres!==null&&f.acres>=100).length};
 }
 const api={gridOK,selection,selectedCells,exportRisk,summary,area,CRS};if(typeof module!=='undefined')module.exports=api;else root.FireRisk=api;
})(globalThis);
