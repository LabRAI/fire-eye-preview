'use strict';
// Reuse the tested projection, geodesic circle, hashing and bounded asset reader.
// This is a separate worker: its queries never hold up the four regional charts.
importScripts('regional-worker.js?v=c7a68fe954284c92','history-query.js?v=2e0bac91844bd92a');
function inside(point,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(((a[1]>point[1])!==(b[1]>point[1]))&&(point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]))hit=!hit;}return hit;}
onmessage=async e=>{
 const req=e.data;current=req.id;
 try{
  const region=circle(req.lnglat,req.radius),b=bounds([region.coordinates]),tiles=req.manifest.tiles.filter(t=>overlaps(t.bounds,b));
  const payloads=[];
  for(let offset=0;offset<tiles.length;offset+=3){if(req.id!==current)return;payloads.push(...await Promise.all(tiles.slice(offset,offset+3).map(t=>asset(req.manifest,t.asset))));}
  const result=FireHistory.select(req.manifest,payloads,{cutoff:req.cutoff,bounds:b,includePrescribed:req.includePrescribed},g=>{
   if(g.type==='Point')return inside(g.coordinates,region.coordinates[0]);
   if(!['Polygon','MultiPolygon'].includes(g.type))throw Error('Unsupported report geometry');
   return polygonClipping.intersection([region.coordinates],polygons(g)).length>0;
  });
  send(req.id,'history',{...result,tiles:tiles.length,bytes:tiles.reduce((s,t)=>s+req.manifest.assets[t.asset].bytes,0)});
 }catch{send(req.id,'history',{error:'Past reports could not be loaded. Retry this section; the map and charts remain available.'});}
};
