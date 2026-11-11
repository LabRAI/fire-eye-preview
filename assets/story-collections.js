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
 const RANKING_POLICY=Object.freeze({version:'casebook-area-score-ranks-v1',default_order:'balanced',area_weight:0.5,score_weight:0.5});
 function reportedArea(c){
  const p=presentation(c),raw=p.impact;
  if(!/^\s*acres?\b/i.test(p.impact_caption||''))return null;
  const text=typeof raw==='number'?String(raw):typeof raw==='string'?raw.trim():'';
  if(!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\+?$/.test(text))return null;
  const value=Number(text.replace(/[,+]/g,''));
  return Number.isFinite(value)&&value>=0?{value,lower_bound:text.endsWith('+'),reported:text}:null;
 }
 function ranking(cases,order='balanced'){
  if(!['balanced','area','score'].includes(order))order='balanced';
  const rows=cases.map(c=>{const score=presentation(c).point_score;return {record:c,case_id:id(c),area:reportedArea(c),score:typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=1?score:null};});
  const known=rows.filter(r=>r.area&&typeof r.score==='number'&&Number.isFinite(r.score)&&r.score>=0&&r.score<=1);
  for(const r of rows){
   r.area_rank=known.includes(r)?1+known.filter(other=>other.area.value>r.area.value).length:null;
   r.score_rank=known.includes(r)?1+known.filter(other=>other.score>r.score).length:null;
  }
  const desc=(a,b)=>{const valid=x=>typeof x==='number'&&Number.isFinite(x);return valid(a)?valid(b)?b-a:-1:valid(b)?1:0;};
  rows.sort((a,b)=>{
   let comparison=0;
   if(order==='balanced'){
    comparison=desc(a.area_rank!==null?-(a.area_rank+a.score_rank):null,b.area_rank!==null?-(b.area_rank+b.score_rank):null);
   }else if(order==='area')comparison=desc(a.area?.value,b.area?.value);
   else comparison=desc(a.score,b.score);
   return comparison||desc(a.score,b.score)||desc(a.area?.value,b.area?.value)||String(a.case_id).localeCompare(String(b.case_id),'en');
  });
  return {order,rows};
 }
 function navigation(editions){
  const seen=new Set(),unique=editions.filter(e=>{if(seen.has(e.id))return false;seen.add(e.id);return true;});
  const monthly=e=>/^\d{4}-(0[1-9]|1[0-2])$/.test(e.id||'');
  const months=unique.filter(monthly).sort((a,b)=>b.id.localeCompare(a.id));
  return {primary:unique.filter(e=>!monthly(e)),recent:months.slice(0,4),older:months.slice(4),visible_month_limit:4};
 }
 function stories(edition,order='balanced'){
  const allowed=review(edition);
  // The reviewed casebook includes strong shorter-lead comparisons. Featured
  // checks describe the evidence; they are not a second visibility requirement.
  if(edition.id==='selected')return ranking(allowed,order).rows.map(row=>row.record);
  return [...allowed.filter(featured),...allowed.filter(c=>!featured(c))];
 }
 function evidence(edition,feed,order='balanced'){
  if(edition.source_edition)return {schema:'fire-eye-story-edition-view-v1',edition:edition.source_edition,casebook_source_sha256:feed.casebook?.source_sha256||null,curated_comparisons:edition.curated_cases||[],display_selection:{...selection(edition),selected_case_ids:stories(edition).map(id),purpose:'Editorial display selection only; original scores, featured evidence flags and evaluation totals are unchanged.'},grouping:'Curated comparisons use official discovery month where available, otherwise the dated reported fire observation. News records retain the reporting edition.'};
  const ranked=ranking(review(edition),order);
  return {schema:'fire-eye-casebook-view-v1',casebook:feed.casebook||edition,display_ranking:{...RANKING_POLICY,order:ranked.order,method:'Equal mean of descending acreage and fire-location-score ranks among records with both values. Ties use higher score, then area, then case ID. Missing areas sort last in the combined order. A reported plus-suffixed area is ranked by its stated lower bound.',purpose:'Case presentation order only, not a model-performance measure.',cases:ranked.rows.map((r,i)=>({position:i+1,case_id:r.case_id,reported_acres:r.area?.value??null,area_is_lower_bound:r.area?.lower_bound??null,point_score:r.score,area_rank:r.area_rank,score_rank:r.score_rank}))}};
 }
 const api={DISPLAY_POLICY,RANKING_POLICY,presentation,featured,id,eventMonth,collections,stories,review,selection,minimumScore,passesScore,reportedArea,ranking,navigation,evidence};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.FireEyeStoryCollections=api;
})(typeof window==='object'?window:globalThis);
