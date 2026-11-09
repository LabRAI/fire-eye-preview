/* Presentation grouping only: preserve all evidence flags, maps and scores. */
(function(root){
 'use strict';
 const presentation=c=>c.presentation||c;
 const featured=c=>presentation(c).quality?.featured===true&&!!presentation(c).image;
 const id=c=>presentation(c).id||c.id||c.name;
 function eventMonth(c){
  const p=presentation(c),t=p.timeline?.find(x=>x.label==='Official fire discovery')?.time_utc;
  return typeof t==='string'&&/^\d{4}-\d{2}-/.test(t)?t.slice(0,7):null;
 }
 function collections(feed){
  const approved=feed.casebook?.cases||[],editions=(feed.stories||[]).map(s=>({...s,cases:[...(s.cases||[])],source_edition:s}));
  for(const e of editions){
   const additions=approved.filter(c=>eventMonth(c)===e.id),keys=new Set(additions.map(id));
   e.cases=[...additions,...e.cases.filter(c=>!keys.has(id(c)))];
    e.curated_ids=additions.map(id);e.curated_cases=additions;
  }
  return [...(approved.length?[{...feed.casebook,cases:[...approved],curated_ids:approved.map(id)}]:[]),...editions];
 }
 function stories(edition){
  if(edition.id==='selected')return edition.cases.filter(featured);
  const approved=new Set(edition.curated_ids||[]);
  const allowed=edition.cases.filter(c=>featured(c)||c.source_article_verified===true||approved.has(id(c)));
  return [...allowed.filter(featured),...allowed.filter(c=>!featured(c))];
 }
 function evidence(edition,feed){return edition.source_edition?{schema:'fire-eye-story-edition-view-v1',edition:edition.source_edition,casebook_source_sha256:feed.casebook?.source_sha256||null,curated_comparisons:edition.curated_cases||[],grouping:'Curated comparisons use official fire discovery month; news records retain the reporting edition.'}:feed.casebook||edition;}
 const api={presentation,featured,id,eventMonth,collections,stories,evidence};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.FireEyeStoryCollections=api;
})(typeof window==='object'?window:globalThis);
