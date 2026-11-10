/* Presentation grouping only: preserve all evidence flags, maps and scores. */
(function(root){
 'use strict';
 const presentation=c=>c.presentation||c;
 const featured=c=>presentation(c).quality?.featured===true&&!!presentation(c).image;
 // Apply the current display floor even when an older feed is cached.
 // Keep this floor aligned with story_quality.RULE; neither changes model values.
 const MINIMUM_POINT_SCORE=0.30;
 const minimumScore=edition=>Math.max(MINIMUM_POINT_SCORE,typeof edition.presentation_rule?.minimum_point_score==='number'&&Number.isFinite(edition.presentation_rule.minimum_point_score)?edition.presentation_rule.minimum_point_score:MINIMUM_POINT_SCORE);
 const passesScore=(c,edition)=>{const p=presentation(c),score=p.point_score;return typeof score==='number'&&Number.isFinite(score)&&score>=minimumScore(edition)&&score<=1&&!!p.image;};
 const id=c=>presentation(c).id||c.id||c.name;
 function eventMonth(c){
  const p=presentation(c),timeline=p.timeline||[];
  // A reported fire observation can place a reviewed story in its month, even
  // when the exact discovery time is not corroborated. Never use forecast dates.
  const t=(timeline.find(x=>x.label==='Official fire discovery')||timeline.find(x=>/^Fire observed\b/i.test(x.label||'')))?.time_utc;
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
 function review(edition){
  const approved=new Set(edition.curated_ids||[]);
  return edition.cases.filter(c=>passesScore(c,edition)&&(featured(c)||c.source_article_verified===true||approved.has(id(c))));
 }
 function stories(edition){
  const allowed=review(edition);
  // The reviewed casebook includes strong shorter-lead comparisons. Featured
  // checks describe the evidence; they are not a second visibility requirement.
  if(edition.id==='selected')return allowed;
  return [...allowed.filter(featured),...allowed.filter(c=>!featured(c))];
 }
 function evidence(edition,feed){return edition.source_edition?{schema:'fire-eye-story-edition-view-v1',edition:edition.source_edition,casebook_source_sha256:feed.casebook?.source_sha256||null,curated_comparisons:edition.curated_cases||[],grouping:'Curated comparisons use official discovery month where available, otherwise the dated reported fire observation. News records retain the reporting edition.'}:feed.casebook||edition;}
 const api={presentation,featured,id,eventMonth,collections,stories,review,minimumScore,passesScore,evidence};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.FireEyeStoryCollections=api;
})(typeof window==='object'?window:globalThis);
