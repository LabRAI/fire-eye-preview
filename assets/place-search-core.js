/* Independent, dependency-free Census place search. validate returns a boolean;
 * create throws TypeError for an invalid index. Search never changes source names
 * or coordinates. State filters accept postal codes and full state names. */
(function (root, factory) {
 'use strict';
 const api = factory();
 if (typeof module === 'object' && module.exports) module.exports = api;
 if (root) root.FireEyePlaceSearch = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
 'use strict';
 const states = 'AL:01:Alabama|AZ:04:Arizona|AR:05:Arkansas|CA:06:California|CO:08:Colorado|CT:09:Connecticut|DE:10:Delaware|DC:11:District of Columbia|FL:12:Florida|GA:13:Georgia|ID:16:Idaho|IL:17:Illinois|IN:18:Indiana|IA:19:Iowa|KS:20:Kansas|KY:21:Kentucky|LA:22:Louisiana|ME:23:Maine|MD:24:Maryland|MA:25:Massachusetts|MI:26:Michigan|MN:27:Minnesota|MS:28:Mississippi|MO:29:Missouri|MT:30:Montana|NE:31:Nebraska|NV:32:Nevada|NH:33:New Hampshire|NJ:34:New Jersey|NM:35:New Mexico|NY:36:New York|NC:37:North Carolina|ND:38:North Dakota|OH:39:Ohio|OK:40:Oklahoma|OR:41:Oregon|PA:42:Pennsylvania|RI:44:Rhode Island|SC:45:South Carolina|SD:46:South Dakota|TN:47:Tennessee|TX:48:Texas|UT:49:Utah|VT:50:Vermont|VA:51:Virginia|WA:53:Washington|WV:54:West Virginia|WI:55:Wisconsin|WY:56:Wyoming'.split('|').map(s => s.split(':'));
 const byState = new Map(states.map(s => [s[0],s]));
 const restricted = new RegExp(String.fromCodePoint(81,119,101,110),'i');
 const normalize = s => s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[’'`]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/ +/g,' ');
 const stateTerms = states.flatMap(s => [[normalize(s[2]),s[0]],[s[0].toLowerCase(),s[0]]]).concat([['d c','DC']]).sort((a,b) => b[0].length-a[0].length);
 const sizes = {place:7,county:5,state:2};
 function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.schema_version !== 1 || data.kind !== 'conus-place-index' || !Number.isInteger(data.vintage) || data.vintage < 2020 || data.vintage > 2100 || !Array.isArray(data.sources) || !data.sources.length || data.sources.length > 32 || !data.sources.every(s => typeof s === 'string' && s.length > 0 || s && typeof s === 'object' && !Array.isArray(s)) || !Array.isArray(data.rows) || data.rows.length > 100000) return false;
  const ids = new Set();
  for (const row of data.rows) {
   if (!Array.isArray(row) || row.length !== 6) return false;
   const [id,kind,name,state,lat,lon] = row, st = byState.get(state);
   if (!Object.hasOwn(sizes,kind) || !st || typeof id !== 'string' || id.length > 32 || ids.has(id) || typeof name !== 'string' || !name.trim() || name.length > 200 || /[\p{Cc}\p{Cf}<>]/u.test(name) || restricted.test(normalize(name).replace(/ /g,''))) return false;
   const match = id.match(new RegExp('^'+kind+'[:_-]?(\\d{'+sizes[kind]+'})$'));
   if (!match || match[1].slice(0,2) !== st[1] || typeof lat !== 'number' || !Number.isFinite(lat) || lat < 24 || lat > 50 || typeof lon !== 'number' || !Number.isFinite(lon) || lon < -125 || lon > -66) return false;
   ids.add(id);
  }
  return true;
 }
 function baseName(name,kind) {
  if (kind === 'place') return name.replace(/ (?:city|town|village|borough|municipality|cdp|consolidated government)(?: balance)?$/,'');
  if (kind === 'county') return name.replace(/ (?:county|parish|city)$/,'');
  return name;
 }
 function create(data) {
  if (!validate(data)) throw new TypeError('Invalid CONUS place index.');
  const entries = data.rows.map(row => {
   const [id,kind,name,state,latitude,longitude] = row, full = normalize(name), base = baseName(full,kind);
   return {value:Object.freeze({id,kind,name,state,latitude,longitude}),full,base,tokens:full.split(' '),baseTokens:base.split(' ')};
  });
  const aliases = new Map();
  // Aliases point only to an existing verified row; none creates a location.
  function alias(words,state,base,kind='place') {
   const found = entries.filter(e => e.value.kind===kind && e.value.state===state && e.base===base);
   for (const word of words) aliases.set(word,(aliases.get(word)||[]).concat(found));
  }
  alias(['nyc','new york city'],'NY','new york');
  alias(['la','l a','los angeles'],'CA','los angeles');
  alias(['sf','s f','san francisco'],'CA','san francisco');
  alias(['dc','d c','washington dc','washington d c','district of columbia'],'DC','washington');
  const exactNames = new Set(entries.flatMap(e=>[e.full,e.base]));
  function matchScore(e,text) {
   if (!text) return 100;
   if (e.full===text) return 1200;
   if (e.base===text) return 1190;
   const tokens = text.split(' ');
   // Exact tokens and token prefixes only; no arbitrary substring matches.
   const available = e.tokens.slice();
   for (const token of tokens.slice().sort((a,b)=>b.length-a.length)) {
    let at=available.indexOf(token); if(at<0)at=available.findIndex(t=>t.startsWith(token));
    if(at<0)return -1; available.splice(at,1);
   }
   const exact=tokens.every(t=>e.tokens.includes(t));
   return (e.base.startsWith(text)?900:exact?800:600) + tokens.length*5 - Math.min(50,e.base.length-text.length);
  }
  function search(query,limit=12) {
   if (typeof query !== 'string' || query.length > 120 || restricted.test(normalize(query).replace(/ /g,''))) return [];
   if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) return [];
   limit=Math.min(12,Math.floor(limit)); const q=normalize(query); if(!q)return [];
   let kind=null,clean=q;
   if(/(?:^| )county$/.test(q)){kind='county';clean=q.replace(/(?:^| )county$/,'').trim();}
   else if(/(?:^| )state$/.test(q)){kind='state';clean=q.replace(/(?:^| )state$/,'').trim();}
   const plans=[{text:clean,state:null,bonus:0}];
   for(const [term,state] of stateTerms){
    if(clean===term)plans.push({text:'',state,bonus:50});
    else if(clean.endsWith(' '+term))plans.push({text:clean.slice(0,-term.length).trim(),state,bonus:60});
    else if(clean.startsWith(term+' '))plans.push({text:clean.slice(term.length).trim(),state,bonus:50});
   }
   // A recognized explicit state suffix is a filter, including for aliases.
   const qualified=plans.filter(p=>p.state&&p.text);
   const bestPosition=Math.max(0,...qualified.map(p=>p.bonus));
   const positionPlans=qualified.filter(p=>p.bonus===bestPosition);
   const active=qualified.length && !exactNames.has(clean) && !aliases.has(clean) ? positionPlans.filter(p=>p.text.length===Math.min(...positionPlans.map(p=>p.text.length))) : plans;
   const stateOnly=stateTerms.find(([term])=>term===clean)?.[1];
   const hits=[];
   for(const e of entries){
    if(kind&&e.value.kind!==kind)continue; let score=-1;
    for(const p of active){
     if(p.state&&e.value.state!==p.state)continue;
     let candidate=matchScore(e,p.text);
     if((aliases.get(p.text)||[]).includes(e))candidate=Math.max(candidate,1300);
     if(candidate>=0)score=Math.max(score,candidate+p.bonus+(p.state&&p.text&&e.value.kind==='place'?20:0));
    }
    // Bare aliases such as LA also retain their state candidate.
    if(!qualified.length&&(aliases.get(clean)||[]).includes(e))score=Math.max(score,1300);
    if(e.value.kind==='state'&&e.value.state===stateOnly)score=Math.max(score,1250);
    if(score>=0)hits.push({e,score});
   }
   hits.sort((a,b)=>b.score-a.score || a.e.base.localeCompare(b.e.base,'en') || a.e.value.state.localeCompare(b.e.value.state) || a.e.value.kind.localeCompare(b.e.value.kind) || a.e.value.id.localeCompare(b.e.value.id));
   return hits.slice(0,limit).map(h=>({...h.e.value}));
  }
  return Object.freeze({search});
 }
 return Object.freeze({validate,create});
});
