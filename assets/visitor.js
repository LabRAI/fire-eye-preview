'use strict';
// Preview-only telemetry. No geolocation permission, IP lookup, cookies or storage.
(function () {
 if (window.fireEyeVisitor) return;
 const V = window.fireEyeVisitor = {ready:false, enabled:false, status:'disabled', recording:'disabled', page:null, summary:null, mapReady:false, groups:[], refresh:() => Promise.resolve(false), retry:() => Promise.resolve(false)};
 const forbidden = new RegExp(String.fromCodePoint(81,119,101,110), 'ig');
 const clean = value => String(value).replace(forbidden, '[restricted identifier]');
 const MAX_BYTES = 1024 * 1024, MAX_LOCATIONS = 2000, TIMEOUT = 5000;
 const SVG = 'http://www.w3.org/2000/svg', WIDTH = 360, HEIGHT = 145;
 const local = location.protocol === 'http:' && ['127.0.0.1','localhost'].includes(location.hostname);
 const publicPreview = location.origin === 'https://labrai.github.io' && location.pathname.startsWith('/fire-eye-preview/');
 const leaf = location.pathname.split('/').pop();
 V.page = !leaf || leaf === 'index.html' ? 'map' : leaf === 'resolution.html' ? 'resolution' : leaf === 'what-if.html' ? 'what-if' : null;
 if ((!local && !publicPreview) || !V.page) { V.ready = true; return; }
 const STATES = Object.fromEntries(('AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming|AS:American Samoa|GU:Guam|MP:Northern Mariana Islands|PR:Puerto Rico|VI:U.S. Virgin Islands|UM:U.S. Minor Outlying Islands').split('|').map(s=>s.split(':')));
 let countryNames; try { countryNames = new Intl.DisplayNames(['en'], {type:'region', fallback:'none'}); } catch {}
 let origin, widget, totalNode, totalLabel, statusNode, refreshButton, frame, svg, targets, mapState, popup, popupName, popupViews, popupNav, popupCount;
 let activeGroup, popupIndex = 0, persistent = false, suppressFocus = false, refreshSequence = 0, refreshController;
 let eventId, attempts = 0, recorded = false, recordTask, retryTimer, resizeObserver, intersectionObserver, landTask, disposed = false;
 const controllers = new Set();
 function ensure(condition) { if (!condition) throw new Error('Visitor data unavailable.'); }
 function objectKeys(value, fields) { ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === fields.split(',').sort().join(',')); }
 function integer(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
 function safeText(value, max, nullable = false) { return nullable && value === null || typeof value === 'string' && value.length <= max && value.trim() === value && clean(value) === value && !/[\u0000-\u001f\u007f<>]/.test(value); }
 function utc(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19); }
 function validSummary(s) {
  objectKeys(s, 'schema_version,site,total_views,updated_at_utc,locations,locations_truncated');
  ensure(s.schema_version === 1 && s.site === 'fire-eye-preview' && integer(s.total_views) && (s.updated_at_utc === null || utc(s.updated_at_utc)) && typeof s.locations_truncated === 'boolean');
  ensure(Array.isArray(s.locations) && s.locations.length <= MAX_LOCATIONS);
  const keys = new Set(); let sum = 0;
  for (const p of s.locations) {
   objectKeys(p, 'key,city,region_code,country_code,latitude,longitude,views');
   ensure(safeText(p.key,160) && p.key.length > 0 && !keys.has(p.key) && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(p.key) && !/^[a-f0-9]*:[a-f0-9:]+$/i.test(p.key)); keys.add(p.key);
   ensure(safeText(p.city,100,true) && (p.city === null || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(p.city)));
   ensure(p.country_code === null || typeof p.country_code === 'string' && /^[A-Z]{2}$/.test(p.country_code));
   ensure(p.region_code === null || typeof p.region_code === 'string' && /^(?:[A-Z0-9-]{1,16})?$/.test(p.region_code));
   if (p.country_code === 'US' && p.region_code) ensure(Object.hasOwn(STATES,p.region_code));
   const unknown = p.latitude === null && p.longitude === null;
   ensure(unknown || typeof p.latitude === 'number' && Number.isFinite(p.latitude) && p.latitude >= -90 && p.latitude <= 90 && typeof p.longitude === 'number' && Number.isFinite(p.longitude) && p.longitude >= -180 && p.longitude <= 180);
   // The independent collector publishes coordinates rounded to 0.1 degree.
   ensure(unknown || [p.latitude,p.longitude].every(v=>Math.abs(v*10-Math.round(v*10))<1e-8));
   ensure(!(p.latitude === 0 && p.longitude === 0 && (p.country_code === null || ['XX','ZZ'].includes(p.country_code))));
   ensure(integer(p.views) && p.views > 0); sum += p.views; ensure(Number.isSafeInteger(sum));
  }
  ensure(sum <= s.total_views); return s;
 }
 function collectorURL(value) {
  if (typeof value !== 'string' || value.length > 300 || clean(value) !== value) return null;
  try {
   const u = new URL(value);
   if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || u.port) {
    // A same-origin HTTP loopback collector is permitted only in local tests.
    if (!(local && u.origin === location.origin && u.protocol === 'http:' && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/')) return null;
   }
   if (local && u.origin === location.origin && u.protocol === 'http:') return u.origin;
   const parts = u.hostname.split('.');
   if (u.protocol !== 'https:' || parts.length !== 4 || parts[2] !== 'workers' || parts[3] !== 'dev' || !parts.slice(0,2).every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))) return null;
   return u.origin;
  } catch { return null; }
 }
 function optedOut() { return navigator.globalPrivacyControl === true || [navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack].some(v => v === '1' || v === 'yes'); }
 async function bytes(url, limit, options = {}) {
  const c = new AbortController(), abort = () => c.abort(); controllers.add(c);
  if (options.signal?.aborted) abort(); options.signal?.addEventListener('abort', abort, {once:true});
  const timer = setTimeout(abort,TIMEOUT); let reader;
  try {
   const r = await fetch(url,{method:options.method || 'GET', body:options.body, headers:options.body ? {'Content-Type':'application/json'} : undefined, credentials:'omit', referrerPolicy:'no-referrer', redirect:'error', cache:'no-store', signal:c.signal});
   if (!r.ok) { const error = new Error('Visitor request unavailable.'); error.status = r.status; throw error; }
   const length = r.headers.get('content-length'); ensure(!length || Number(length) <= limit); ensure(r.body);
   reader = r.body.getReader(); const chunks = []; let size = 0;
   for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; ensure(size <= limit); chunks.push(chunk.value); }
   const out = new Uint8Array(size); let at = 0; for (const chunk of chunks) { out.set(chunk,at); at += chunk.byteLength; } return out;
  } finally { clearTimeout(timer); controllers.delete(c); options.signal?.removeEventListener('abort',abort); if (reader) await reader.cancel().catch(()=>{}); c.abort(); }
 }
 function parse(data) { const text = new TextDecoder('utf-8',{fatal:true}).decode(data); ensure(clean(text) === text); return JSON.parse(text); }
 function text(tag,value,className) { const e = document.createElement(tag); if (value !== undefined) e.textContent = clean(value); if (className) e.className = className; return e; }
 function shape(tag, attrs = {}) { const e = document.createElementNS(SVG,tag); for (const [key,value] of Object.entries(attrs)) e.setAttribute(key,String(value)); return e; }
 function say(value) { if (statusNode) statusNode.textContent = value; }
 function label(p) {
  let city = p.city;
  if (p.country_code === 'US') {
   const aliases = {'CA:la':'Los Angeles','CA:l.a.':'Los Angeles','CA:sf':'San Francisco','NY:nyc':'New York City','DC:dc':'Washington'};
   if (city) city = aliases[p.region_code + ':' + city.toLowerCase()] || city;
  }
  const country = p.country_code && !['XX','ZZ'].includes(p.country_code) ? countryNames?.of(p.country_code) || p.country_code : null;
  const region = p.country_code === 'US' && !city ? STATES[p.region_code] : p.region_code;
  return [city,region,country].filter(Boolean).join(', ') || 'Location unavailable';
 }
 function mount() {
  const footer = document.querySelector('#sidebar .sidebar-footer'); if (!footer || V.page === 'what-if') return;
  widget = text('section',undefined,'visitor-widget'); widget.id = 'visitor-map'; widget.setAttribute('aria-label','Visitor map');
  const heading = text('div',undefined,'visitor-heading'), countWrap = text('div',undefined,'visitor-total-wrap'), count = text('div',undefined,'visitor-total');
  totalNode = text('strong','—'); totalNode.id = 'visitor-total'; totalNode.setAttribute('aria-label','Total view unavailable'); totalLabel = text('span','Total view'); count.append(totalNode,totalLabel);
  refreshButton = text('button','↻','visitor-refresh'); refreshButton.type = 'button'; refreshButton.setAttribute('aria-label','Refresh visitor statistics'); refreshButton.title = 'Refresh visitor statistics'; refreshButton.addEventListener('click',()=>V.retry()); countWrap.append(count,refreshButton); heading.append(text('h3','Visitor map'),countWrap);
  frame = text('div',undefined,'visitor-map-frame'); svg = shape('svg',{viewBox:'0 0 360 145',class:'visitor-world',role:'group','aria-label':'World visitor locations, excluding Antarctica'});
  const title = shape('title'); title.textContent = 'World visitor map'; const defs = shape('defs'), clip = shape('clipPath',{id:'visitor-world-clip'}); clip.append(shape('rect',{x:0,y:0,width:WIDTH,height:HEIGHT})); defs.append(clip);
  const clipped = shape('g',{'clip-path':'url(#visitor-world-clip)'}), land = shape('g',{id:'visitor-land'}); targets = shape('g',{id:'visitor-locations'}); clipped.append(land,targets); svg.append(title,defs,clipped);
  mapState = text('div','Loading map…','visitor-map-state'); mapState.setAttribute('role','status');
  frame.append(svg,text('span','Natural Earth','visitor-attribution'),mapState);
  popup = text('div',undefined,'visitor-popup'); popup.hidden = true; popup.setAttribute('role','dialog'); popup.setAttribute('aria-label','Visitor location');
  popupName = text('strong',undefined,'visitor-popup-name'); popupViews = text('div',undefined,'visitor-popup-views');
  const close = text('button','×','visitor-popup-close'); close.type = 'button'; close.setAttribute('aria-label','Close visitor location'); close.addEventListener('click',()=>hidePopup(true));
  popupNav = text('div',undefined,'visitor-popup-nav'); popupCount = text('span');
  for (const [name,glyph,direction] of [['Previous location','‹',-1],['Next location','›',1]]) { const b = text('button',glyph); b.type = 'button'; b.setAttribute('aria-label',name); b.addEventListener('click',()=>showPopup(activeGroup,popupIndex+direction,true)); popupNav.append(b); if (direction === -1) popupNav.append(popupCount); }
  popup.append(popupName,popupViews,close,popupNav); frame.append(popup);
  popup.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();hidePopup(true);}});
  popup.addEventListener('focusin',()=>{persistent=true;});
  statusNode = text('span','Loading visitor statistics…','visitor-sr-only'); statusNode.setAttribute('role','status'); statusNode.setAttribute('aria-live','polite');
  widget.append(heading,frame,statusNode); footer.before(widget);
  if ('ResizeObserver' in window) { resizeObserver = new ResizeObserver(()=>renderLocations()); resizeObserver.observe(frame); }
  if ('IntersectionObserver' in window) { intersectionObserver = new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){intersectionObserver.disconnect();void loadLand();}}); intersectionObserver.observe(frame); }
  else void loadLand();
 }
 function landPaths(data) {
  ensure(data?.type === 'FeatureCollection' && Array.isArray(data.features) && data.features.length <= 5000);
  let points = 0; const paths = [];
  for (const feature of data.features) {
   const g = feature.geometry; ensure(g && ['Polygon','MultiPolygon'].includes(g.type) && Array.isArray(g.coordinates));
   const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
   for (const polygon of polygons) {
    ensure(Array.isArray(polygon) && polygon.length <= 2000); let commands = '';
    for (const ring of polygon) {
     ensure(Array.isArray(ring) && ring.length >= 4 && ring.length <= 100000);
     let north = -90;
     for (const p of ring) { ensure(Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0])<=180 && Math.abs(p[1])<=90); north = Math.max(north,p[1]); points++; ensure(points <= 200000); }
     if (north < -60) continue;
     commands += ring.map((p,i)=>(i ? 'L' : 'M') + (p[0]+180).toFixed(4) + ' ' + (85-p[1]).toFixed(4)).join(' ') + 'Z';
    }
    if (commands) paths.push(commands);
   }
  }
  ensure(paths.length > 0); return paths;
 }
 async function loadLand() {
  if (!frame || disposed || V.mapReady) return;
  if (landTask) return landTask;
  landTask = (async()=>{
   try {
    const data = parse(await bytes(new URL('assets/land.geojson',location.href).href,2*1024*1024)); if (disposed) return;
    const paths = landPaths(data), land = svg.querySelector('#visitor-land'); land.replaceChildren(...paths.map(d=>shape('path',{d,class:'visitor-land'})));
    V.mapReady = true; mapState.hidden = true; renderLocations();
   } catch { if (!disposed) { mapState.textContent = 'Map unavailable'; mapState.hidden = false; } }
   finally { landTask = null; }
  })(); return landTask;
 }
 function hidePopup(focus = false) {
  if (!popup) return;
  popup.hidden = true; persistent = false;
  const g = activeGroup; if (g?.element) g.element.setAttribute('aria-expanded','false'); activeGroup = null;
  if (focus && g?.element?.isConnected) { suppressFocus = true; g.element.focus({preventScroll:true}); suppressFocus = false; }
 }
 function showPopup(group,index = 0,pin = false) {
  if (!group || !popup) return;
  if (activeGroup && activeGroup !== group) activeGroup.element.setAttribute('aria-expanded','false');
  activeGroup = group; popupIndex = (index + group.points.length) % group.points.length; persistent = pin;
  const point = group.points[popupIndex]; popupName.textContent = clean(label(point.location)); popupViews.textContent = new Intl.NumberFormat('en-US').format(point.location.views) + (point.location.views === 1 ? ' view' : ' views');
  popupNav.hidden = group.points.length < 2; popupCount.textContent = (popupIndex+1) + ' of ' + group.points.length; popup.hidden = false; group.element.setAttribute('aria-expanded','true');
  const w = frame.clientWidth, h = frame.clientHeight;
  popup.style.left = Math.max(4,Math.min(point.x/WIDTH*w-popup.offsetWidth/2,w-popup.offsetWidth-4)) + 'px';
  popup.style.top = Math.max(4,Math.min(point.y/HEIGHT*h+10,h-popup.offsetHeight-4)) + 'px';
 }
 function renderLocations() {
  if (!V.mapReady || !V.summary || !targets || frame.clientWidth === 0 || frame.clientHeight === 0) return;
  hidePopup(); targets.replaceChildren();
  const sx = frame.clientWidth/WIDTH, sy = frame.clientHeight/HEIGHT;
  const points = V.summary.locations.filter(p=>p.views>0 && p.latitude!==null && p.latitude>=-60 && p.latitude<=85).map(location=>({location,x:location.longitude+180,y:85-location.latitude}));
  const parents = points.map((_,i)=>i), buckets = new Map(), gap = 22;
  const root = i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  points.forEach((p,i)=>{const x=p.x*sx,y=p.y*sy,bx=Math.floor(x/gap),by=Math.floor(y/gap);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of buckets.get((bx+dx)+','+(by+dy))||[]){const q=points[j];if(Math.hypot(x-q.x*sx,y-q.y*sy)<gap)parents[root(i)]=root(j);}const key=bx+','+by;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);});
  const grouped = new Map(); points.forEach((p,i)=>{const key=root(i);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(p);});
  V.groups = Array.from(grouped.values()).map(members=>({points:members}));
  for (const group of V.groups) {
   const g = shape('g',{class:'visitor-location-target',role:'button',tabindex:0,'aria-haspopup':'dialog','aria-expanded':'false','aria-label':group.points.length===1 ? label(group.points[0].location) : group.points.length+' nearby locations; '+label(group.points[0].location)}); group.element = g;
   for (const p of group.points) g.append(shape('ellipse',{cx:p.x,cy:p.y,rx:11/sx,ry:11/sy,class:'visitor-hit','aria-hidden':'true'}));
   for (const p of group.points) g.append(shape('ellipse',{cx:p.x,cy:p.y,rx:2.6/sx,ry:2.6/sy,class:'visitor-point','aria-hidden':'true','data-location':p.location.key}));
   const nearest = e=>{const rect=svg.getBoundingClientRect();let chosen=0,d=Infinity;group.points.forEach((p,i)=>{const distance=Math.hypot(e.clientX-rect.left-p.x*sx,e.clientY-rect.top-p.y*sy);if(distance<d){d=distance;chosen=i;}});return chosen;};
   g.addEventListener('click',e=>{e.stopPropagation();showPopup(group,nearest(e),true);});
   g.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch'&&!persistent)showPopup(group,nearest(e),false);});
   g.addEventListener('pointerleave',e=>{if(!persistent&&!popup.contains(e.relatedTarget)&&document.activeElement!==g)hidePopup();});
   g.addEventListener('focus',()=>{if(!suppressFocus)showPopup(group,0,false);});
   g.addEventListener('blur',e=>{if(!persistent&&!popup.contains(e.relatedTarget))hidePopup();});
   g.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();showPopup(group,activeGroup===group?popupIndex:0,true);}else if(e.key==='Escape'){e.preventDefault();hidePopup();}else if(['ArrowLeft','ArrowRight'].includes(e.key)&&group.points.length>1){e.preventDefault();showPopup(group,(activeGroup===group?popupIndex:0)+(e.key==='ArrowRight'?1:-1),true);}});
   targets.append(g);
  }
  svg.setAttribute('aria-label',V.summary.locations_truncated?'World visitor map; a limited set of published locations, excluding Antarctica':'World visitor locations, excluding Antarctica');
 }
 function applySummary(next) {
  const old = V.summary;
  if (old && (next.total_views < old.total_views || old.updated_at_utc !== null && (next.updated_at_utc === null || Date.parse(next.updated_at_utc) < Date.parse(old.updated_at_utc)))) { V.status = 'stale'; say('Previous published total retained.'); return false; }
  V.summary = next; V.status = 'ready';
  if (totalNode) { totalNode.textContent = new Intl.NumberFormat('en-US').format(next.total_views); totalNode.setAttribute('aria-label',next.total_views+' total views'); widget.dataset.truncated = String(next.locations_truncated); }
  say('Published visitor statistics loaded.'); renderLocations(); return true;
 }
 async function refresh() {
  if (!V.enabled || disposed || V.page === 'what-if') return false;
  const seq = ++refreshSequence; refreshController?.abort(); refreshController = new AbortController();
  if (refreshButton) refreshButton.disabled = true;
  try { const s = validSummary(parse(await bytes(origin+'/v1/summary',MAX_BYTES,{signal:refreshController.signal}))); if(seq!==refreshSequence||disposed)return false; return applySummary(s); }
  catch { if(seq===refreshSequence&&!disposed){V.status=V.summary?'stale':'unavailable';say(V.summary?'Previous published total retained.':'Visitor statistics unavailable.');} return false; }
  finally { if(seq===refreshSequence&&refreshButton)refreshButton.disabled=false; }
 }
 function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;const h=Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
 }
 async function record() {
  if (disposed || !V.enabled || recorded || recordTask || attempts >= 3) return recordTask;
  if (optedOut()) { V.recording='opted-out'; return false; }
  // A development page cannot add visits to the real independent collector.
  if (!publicPreview && origin !== location.origin) { V.recording='local-read-only'; return false; }
  if (!eventId) { try { eventId=uuid(); } catch { V.recording='unavailable'; return false; } }
  attempts++; V.recording='pending';
  recordTask=(async()=>{
   try {
    const ack=parse(await bytes(origin+'/v1/view',4096,{method:'POST',body:JSON.stringify({schema_version:1,page:V.page,event_id:eventId})})); objectKeys(ack,'ok,counted');ensure(typeof ack.ok==='boolean'&&typeof ack.counted==='boolean'&&(!ack.counted||ack.ok));
    if (!ack.ok) { V.recording='rejected'; return false; }
    recorded=true;V.recording='accepted';if(V.page==='what-if')V.status='ready';else await refresh();return true;
   } catch(error) {
    V.recording='unavailable';
    if(attempts<2&&!disposed&&(!error.status||error.status>=500||error.status===429))retryTimer=setTimeout(()=>{retryTimer=null;void record();},700);
    return false;
   } finally {recordTask=null;}
  })();return recordTask;
 }
 V.refresh=refresh;
 V.retry=async()=>{if(!V.enabled||disposed)return false;if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}const results=await Promise.allSettled([refresh(),record(),frame&&!V.mapReady?loadLand():Promise.resolve()]);return results.some(r=>r.status==='fulfilled'&&r.value===true);};
 window.addEventListener('pagehide',()=>{disposed=true;refreshSequence++;clearTimeout(retryTimer);retryTimer=null;for(const c of controllers)c.abort();intersectionObserver?.disconnect();resizeObserver?.disconnect();hidePopup();});
 window.addEventListener('pageshow',e=>{if(e.persisted){disposed=false;if(frame)resizeObserver?.observe(frame);void V.retry();}});
 (async()=>{
  let config;try{config=parse(await bytes(new URL('config.json',location.href).href,65536));}catch{V.ready=true;return;}
  if(!config||typeof config!=='object'||Array.isArray(config)){V.ready=true;return;}
  origin=collectorURL(config.visitor_url);if(!origin){V.ready=true;return;}
  V.enabled=true;V.status='loading';
  try{mount();}catch{widget?.remove();widget=null;frame=null;}
  await Promise.allSettled([refresh(),record()]);V.ready=true;
 })().catch(()=>{V.ready=true;V.status=V.summary?'stale':'unavailable';});
})();
