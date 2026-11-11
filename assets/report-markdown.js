/* Export original displayed records; never rewrite forecast evidence. */
(function(root){
 'use strict';
 const plain=value=>String(value??'').replace(/\r/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/([\\*_[\]#])/g,'\\$1').replaceAll(String.fromCharCode(96),'\\'+String.fromCharCode(96));
 const url=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href.replace(/\(/g,'%28').replace(/\)/g,'%29'):null;}catch{return null;}};
 const time=value=>{const d=new Date(value);return value&&Number.isFinite(+d)?d.toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC'):'Not recorded';};
 function render({edition,feed,order='balanced',collections,baseURL='https://labrai.github.io/fire-eye-preview/'}){
  const cases=collections.stories(edition,order),month=/^\d{4}-\d{2}$/.test(edition.id),label=edition.id==='selected'?'Selected case studies':month?new Date(edition.id+'-01T00:00:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'}):edition.title||edition.id;
  const lines=['# Forecast Records','', '## '+plain(label),'','Published '+time(feed.published_at_utc),'',cases.length+' archived map comparisons.'];
  if(edition.id==='selected')lines.push('','Order: '+({balanced:'reported-area and fire-location-score ranks, equally weighted',area:'reported area, largest first',score:'fire-location score, highest first'}[order]||order)+'.');
  const selection=collections.selection(edition);lines.push('','Display cutoff: '+selection.minimum_point_score.toFixed(2)+'. Original scores and timing evidence are preserved.');
  for(const record of cases){const p=collections.presentation(record),page=new URL('stories.html',baseURL);page.searchParams.set('edition',edition.id);page.searchParams.set('case',p.id);if(order!=='balanced')page.searchParams.set('rank',order);
   lines.push('','---','','## '+plain(p.name),'',plain(p.place||record.state||''),'');
   if(p.impact!=null)lines.push('**Reported impact:** '+plain(p.impact)+' '+plain(p.impact_caption),'');
   lines.push('**Fire-location score:** '+p.point_score.toFixed(3),'','**Timing:** '+plain(p.lead||'Published record')+(p.lead_caption?' — '+plain(p.lead_caption):''),'','**Evidence:** '+plain({'public-archive':'Public archive verified','local-record':'Local timestamp record','retrospective':'Retrospective comparison','news-only':'News report'}[p.timing_basis]||p.timing_basis||'Published record'),'');
   if(p.before_text)lines.push('### Archived forecast','',plain(p.before_text),'');
   lines.push('- Forecast issued: '+time(p.issue_time_utc),'- Window ends: '+time(p.target_time_utc));
   if(p.coordinates?.length===2)lines.push('- Location: '+p.coordinates[1].toFixed(4)+'°, '+p.coordinates[0].toFixed(4)+'°');
   const descriptor=p.image;let imageURL=null;if(descriptor&&/^[a-f0-9]{64}$/.test(descriptor.sha256)){const remote=url(descriptor.url);imageURL=remote&&new URL(remote).hostname==='huggingface.co'?remote:url(new URL('assets/story-maps/'+descriptor.sha256+'.png',baseURL).href);}
   if(imageURL)lines.push('','![Archived forecast — '+plain(p.name)+']('+imageURL+')','',plain(p.image_caption||'Retained forecast map. Event marker added after the event.'));
   lines.push('','### Reported fire','',plain(p.after_text||record.summary||''),'');
   for(const t of [...(p.timeline||[])].sort((a,b)=>Date.parse(a.time_utc)-Date.parse(b.time_utc)))lines.push('- '+plain(record.discovery_verified===false&&t.label==='Official fire discovery'?'Recorded event date':t.label)+': '+time(t.time_utc));
   lines.push('','### Sources','');for(const item of p.sources||record.sources||[]){const source=typeof item==='string'?{label:'Reporting source',url:item}:item,href=url(source.url);if(href)lines.push('- ['+plain(source.label||'Reporting source')+']('+href+')');}
   if(url(p.archive_url))lines.push('- [Public forecast archive]('+url(p.archive_url)+')');lines.push('- [View this record in Fire-eye]('+url(page.href)+')');
  }
  lines.push('','---','','Fire-location scores describe modeled active-fire occupancy for the selected cell and 12-hour window. Reported acreage is the area recorded by the cited source. Case selection and ordering are presentation choices, not an overall model-performance measure.','','Images link to their archived files; viewing them requires an internet connection.','');
  return {name:'Fire-eye-Forecast-Records-'+(edition.id==='selected'?'Selected-case-studies':edition.id.replace(/[^a-zA-Z0-9-]/g,'-'))+'.md',content:lines.join('\n')};
 }
 const api={render};if(typeof module==='object'&&module.exports)module.exports=api;else root.FireEyeReportMarkdown=api;
})(typeof window==='object'?window:globalThis);
