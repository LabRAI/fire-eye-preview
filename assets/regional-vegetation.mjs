/* Render-only regional forms. Fuel describes surface behavior, not tree species.
 * Source tags win; coarse cover and geography supply an explicitly schematic mix.
 * No new locations, density, forecast changes, external requests or per-tree assets.
 */
export const NOTE='Representative regional vegetation; individual tree species are not surveyed.';
const hash=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
export function profile(feature){
 const p=feature.properties||{},xy=feature.geometry?.coordinates||[],[lon,lat]=xy;
 const value=hash((p.source_id||xy.join(','))+'/regional-form')/4294967296;
 const text=[p.species,p.genus,p.leaf_type,p.leaf_cycle,p.vegetation_type,p.evt_name,p.class,p.subclass].filter(v=>typeof v==='string').join(' ').toLowerCase();
 const fuel=String(p.fuel_model||p.fuel_group||'').toUpperCase();
 const result=(form,basis)=>({form,basis,kind:form==='broadleaf'?(value<.5?'tree_oak_01':'tree_oak_02'):form==='conifer'?'tree_pine_01':'regional_'+form,note:NOTE});
 // Explicit botanical/vegetation tags outrank geographical assumptions.
 if(/longleaf|palustris/.test(text))return result('longleaf','mapped vegetation tag');
 if(/sabal|palmetto|palm|arecaceae/.test(text))return result('palm','mapped vegetation tag');
 if(/taxodium|bald.?cypress|pond.?cypress/.test(text))return result('cypress','mapped vegetation tag');
 if(/shrub|scrub|heath/.test(text))return result('shrub','mapped cover');
 if(/broadlea[fv]|deciduous|hardwood|quercus|oak|maple|acer|betula|populus|ulmus/.test(text))return result('broadleaf','mapped vegetation tag');
 if(/pine|pinus|conifer|needle|spruce|fir|cedar|picea|abies|pseudotsuga|tsuga|cupressus|juniperus/.test(text))return result('conifer','mapped vegetation tag');
 // An explicitly shrubby surface can refine untyped schematic vegetation.
 if(!/forest|wood|park/.test(text)&&/^(SH[1-9]|14[1-9]|SHRUBLAND)$/.test(fuel))return result('shrub','surface fuel group; schematic form');
 // Broad display regions are intentionally not a species-distribution map.
 if(lon>=-98&&lon<=-75&&lat>=25&&lat<=35.5){
  if(/wetland|swamp/.test(text))return result('cypress','regional wetland form');
  const forest=/forest|wood/.test(text);
  if(forest&&value<.66)return result('longleaf','southeastern woodland display mix');
  return result('broadleaf','southeastern mixed vegetation');
 }
 if(/forest|wood/.test(text)&&lon>=-125&&lon< -103&&lat>=32&&lat<=50)
  return result(value<.8?'conifer':'broadleaf','western woodland display mix');
 if(/forest|wood/.test(text)&&lat>=43&&lat<=50&&lon>=-103&&lon<=-66)
  return result(value<.45?'conifer':'broadleaf','northern mixed woodland');
 return result('broadleaf','generic cover fallback');
}
function mesh(form,coarse=false){
 const vertices=[],indices=[];
 function triangle(a,b,c,color){
  const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n)||1;n=n.map(x=>x/l);
  const start=vertices.length/11;for(const p of [a,b,c])vertices.push(...p,...n,...color,0,0);indices.push(start,start+1,start+2);
 }
 const brown=[.36,.24,.14],green=[.21,.38,.15];
 function stem(a,b,r1,r2,color=brown,sides=coarse?4:6){
  const d=b.map((x,i)=>x-a[i]),length=Math.hypot(...d),w=d.map(x=>x/length),tmp=Math.abs(w[1])<.9?[0,1,0]:[1,0,0];let u=[w[1]*tmp[2]-w[2]*tmp[1],w[2]*tmp[0]-w[0]*tmp[2],w[0]*tmp[1]-w[1]*tmp[0]];const l=Math.hypot(...u);u=u.map(x=>x/l);const v=[w[1]*u[2]-w[2]*u[1],w[2]*u[0]-w[0]*u[2],w[0]*u[1]-w[1]*u[0]];
  const point=(p,r,t)=>p.map((x,i)=>x+r*(u[i]*Math.cos(t)+v[i]*Math.sin(t)));
  for(let i=0;i<sides;i++){const t=i*2*Math.PI/sides,s=(i+1)*2*Math.PI/sides,A=point(a,r1,t),B=point(a,r1,s),C=point(b,r2,s),D=point(b,r2,t);triangle(A,B,C,color);triangle(A,C,D,color);}
 }
 function crown(x,y,z,rx,ry,rz,color=green){
  const rings=4,sides=coarse?5:8;
  const point=(j,i)=>{const a=Math.PI*j/rings,t=i*2*Math.PI/sides;return [x+rx*Math.sin(a)*Math.cos(t),y+ry*Math.cos(a),z+rz*Math.sin(a)*Math.sin(t)];};
  for(let j=0;j<rings;j++)for(let i=0;i<sides;i++){const A=point(j,i),B=point(j+1,i),C=point(j+1,i+1),D=point(j,i+1),shade=.9+.1*((i+j)%3);if(j<rings-1)triangle(A,B,C,color.map(v=>v*shade));if(j>0)triangle(A,C,D,color.map(v=>v*shade));}
 }
 if(form==='longleaf'){
  // Open high crown and a long visible stem, unlike the generic Christmas-tree cone.
  stem([0,0,0],[.12,8.9,0],.17,.06);
  const count=coarse?4:8;
  for(let i=0;i<count;i++){const a=i*2.39996,r=1.2+(i%3)*.3,y=7.4+(i%3)*.55,x=Math.cos(a)*r,z=Math.sin(a)*r;
   if(!coarse)stem([.1,6.6,0],[x,y,z],.045,.018);
   crown(x,y+.65,z,1.05,.55,1.05,[.26,.42,.19]);
  }
  crown(.1,9.15,0,1.15,.85,1.05,[.28,.44,.19]);
 }else if(form==='palm'){
  stem([0,0,0],[.12,7.8,0],.17,.1,[.46,.38,.25]);
  const count=coarse?7:12;
  for(let i=0;i<count;i++){const a=i*2.39996,dx=Math.cos(a),dz=Math.sin(a),tip=[dx*3,7.1+(i%3)*.35,dz*3],mid=[dx*1.4,9.3,dz*1.4],root=[.12,7.8,0],left=[mid[0]-dz*.65,mid[1],mid[2]+dx*.65],right=[mid[0]+dz*.65,mid[1],mid[2]-dx*.65];triangle(root,left,tip,[.23,.42,.18]);triangle(root,tip,right,[.29,.47,.21]);if(!coarse)stem(root,tip,.035,.006,green,4);}
 }else if(form==='conifer'||form==='cypress'){
  stem([0,0,0],[0,9.8,0],form==='cypress'?.35:.18,.035);
  const n=coarse?3:5;
  for(let i=0;i<n;i++){const y=2+i*(5.5/n),r=2.25-i*(1.7/n),col=form==='cypress'?[.31,.43,.22]:[.17,.34,.25];stem([0,y,0],[0,Math.min(10,y+4),0],r,0,col,coarse?6:9);}
 }else if(form==='shrub'){
  stem([0,0,0],[0,2,0],.09,.03);
  for(let i=0;i<(coarse?3:5);i++){const a=i*2.4;crown(Math.cos(a)*.7,1.2+(i%2)*.35,Math.sin(a)*.7,1,.85,.9,[.38,.43,.25]);}
 }else{
  stem([0,0,0],[0,7.8,0],.22,.08);
  crown(0,7.3,0,2.5,2.7,2.4,[.26,.4,.17]);
  if(!coarse)for(let i=0;i<4;i++){const a=i*2.4;crown(Math.cos(a)*1.5,6.5+(i%2),Math.sin(a)*1.5,1.7,1.6,1.5);}
 }
 const data=new Float32Array(vertices),idx=new Uint16Array(indices),xs=[],ys=[],zs=[];
 for(let i=0;i<data.length;i+=11){xs.push(data[i]);ys.push(data[i+1]);zs.push(data[i+2]);}
 return {role:coarse?'tree-canopy':'tree-detail',regional_form:form,id:'regional_'+form+(coarse?'_canopy':''),height_m:Math.max(...ys),crown_diameter_m:Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs)),stride_bytes:44,vertices:data,indices:idx,parts:[{start:0,count:idx.length,texture:null,image:null,alpha_test:0,opacity:1}],bytes:data.byteLength+idx.byteLength};
}
export function library(original){
 const result=original.filter(a=>a.role!=='tree-canopy').map(a=>({...a,tree_kind:a.role==='tree-detail'?a.id.replace(/_far$/,''):null}));
 for(const form of ['broadleaf','conifer','longleaf','cypress','palm','shrub']){
  const canopy=mesh(form,true);canopy.tree_kind=form==='broadleaf'?'broadleaf':form==='conifer'?'tree_pine_01':'regional_'+form;result.push(canopy);
  if(!['broadleaf','conifer'].includes(form)){const detail=mesh(form);detail.tree_kind='regional_'+form;result.push(detail);}
 }
 return result;
}
