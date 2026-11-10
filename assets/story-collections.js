/* Presentation grouping only: preserve all evidence flags, maps and scores. */
(function(root){
 'use strict';
 const presentation=c=>c.presentation||c;
 const featured=c=>presentation(c).quality?.featured===true&&!!presentation(c).image;
 // Monthly display selection is separate from the fixed featured/evaluation
 // rules. Recompute after grouping on every refresh, including older feeds.
 const DISPLAY_POLICY=Object.freeze({version:'monthly-adaptive-display-v1',base_minimum_point_score:0.30,minimum_point_score:0.15,step:0.05,target_comparisons:3});
 const validScore=c=>{const p=presentation(c),score=p.point_score;return typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=1&&!!p.image;};
 function eligible(edition){
  const approved=new Set(edition.curated_ids||[]),seen=new Set();
  return (edition.cases||[]).filter(c=>{const key=id(c);if(seen.has(key)||!validScore(c)||!(featured(c)||c.source_article_verified===true||approved.has(key)))return false;seen.add(key);return true;});
 }
 function selection(edition={}){
  const declared=edition.presentation_rule?.minimum_point_score,base=Math.max(DISPLAY_POLICY.base_minimum_point_score,typeof declared==='number'&&Number.isFinite(declared)?declared:0);
  const monthly=/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(edition.id||''),adaptive=monthly&&base===DISPLAY_POLICY.base_minimum_point_score,cases=eligible(edition);
  const count=cutoff=>cases.filter(c=>presentation(c).point_score>=cutoff).length,baseCount=count(base);
  let cutoff=base,shown=baseCount;
  if(adaptive&&shown<DISPLAY_POLICY.target_comparisons)for(const lower of [0.25,0.20,0.15]){
   const n=count(lower);if(n>shown){cutoff=lower;shown=n;}if(n>=DISPLAY_POLICY.target_comparisons)break;
  }
  return {version:DISPLAY_POLICY.version,mode:adaptive?'monthly-adaptive':'fixed',base_minimum_point_score:base,minimum_point_score:cutoff,minimum_allowed_point_score:adaptive?DISPLAY_POLICY.minimum_point_score:base,target_comparisons:DISPLAY_POLICY.target_comparisons,eligible_comparisons:cases.length,base_count:baseCount,displayed_count:shown,relaxed:cutoff<base};
 }
 const minimumScore=edition=>selection(edition).minimum_point_score;
 const passesScore=(c,edition={})=>validScore(c)&&presentation(c).point_score>=minimumScore(edition);
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
  const cutoff=minimumScore(edition);
  return eligible(edition).filter(c=>presentation(c).point_score>=cutoff);
 }
 function stories(edition){
  const allowed=review(edition);
  // The reviewed casebook includes strong shorter-lead comparisons. Featured
  // checks describe the evidence; they are not a second visibility requirement.
  if(edition.id==='selected')return allowed;
  return [...allowed.filter(featured),...allowed.filter(c=>!featured(c))];
 }
 function evidence(edition,feed){return edition.source_edition?{schema:'fire-eye-story-edition-view-v1',edition:edition.source_edition,casebook_source_sha256:feed.casebook?.source_sha256||null,curated_comparisons:edition.curated_cases||[],display_selection:{...selection(edition),selected_case_ids:stories(edition).map(id),purpose:'Editorial display selection only; original scores, featured evidence flags and evaluation totals are unchanged.'},grouping:'Curated comparisons use official discovery month where available, otherwise the dated reported fire observation. News records retain the reporting edition.'}:feed.casebook||edition;}
 const api={DISPLAY_POLICY,presentation,featured,id,eventMonth,collections,stories,review,selection,minimumScore,passesScore,evidence};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.FireEyeStoryCollections=api;
})(typeof window==='object'?window:globalThis);
