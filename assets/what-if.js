'use strict';
// Published results only. This page never computes a prediction or submits a job.
(async function () {
 const $ = id => document.getElementById(id);
 const LIMIT = 2 * 1024 * 1024, MAX_FEATURES = 2000, VERSION = 'fuel-sensitivity-v1';
 const HF = 'https://huggingface.co/datasets/yx21e/fire-eye-forecasts-preview/resolve/';
 const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
 const SOURCE = /^firewxfm_forecast_[A-Za-z0-9_]{1,160}$/;
 const restricted = new RegExp(String.fromCodePoint(81, 119, 101, 110), 'ig');
 const clean = value => String(value).replace(restricted, '[restricted identifier]');
 const put = (id, value) => { $(id).textContent = clean(value); };
 const query = new URLSearchParams(location.search), cache = new Map();
 const W = window.fireEyeWhatIf = {ready: false, selected: null, maps: [], selectCase, manifest: null, status: 'loading'};
 let config = {}, sequence = 0, activeController, loadingCatalog = false, draftTouched = false, lookupCase = null;
 let currentSource = null, synchronization = false, disposed = false, retryId = null;
 const empty = () => ({type: 'FeatureCollection', features: []});
 const colors = key => ['interpolate', ['linear'], ['get', key], 0, '#25572b', .03, '#25572b', .05, '#2f7136', .08, '#6f9641', .15, '#b7bb3e', .25, '#e0b433', .4, '#dd702d', .6, '#a92f2b', 1, '#a92f2b'];
 const deltaColors = ['interpolate', ['linear'], ['get', 'delta'], -.2, '#2166ac', 0, '#f7f7f1', .2, '#b2182b'];
 const same = (a, b) => canonical(a) === canonical(b);
 function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
 }
 function ensure(condition) { if (!condition) throw new Error('Published data did not pass verification.'); }
 function keys(value, list) { ensure(value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).sort().join(',') === list.split(',').sort().join(',')); }
 function finite(value, min, max) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
 function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
 function stamp(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(value) && Number.isFinite(Date.parse(value)); }
 function safeText(value, max = 1000) { return typeof value === 'string' && value.length <= max && clean(value) === value && !/[\u0000-\u0008\u000b-\u001f]/.test(value); }
 function runValid(source, issue, target, lead) { ensure(SOURCE.test(source) && stamp(issue) && stamp(target) && [12, 24, 36, 48].includes(lead) && Date.parse(target) - Date.parse(issue) === lead * 3600000); }
 function specValid(spec, issue, fuels) {
  keys(spec, 'source,lat,lng,radiusKm,fuelCode,treatmentDate');
  ensure(SOURCE.test(spec.source) && finite(spec.lat, 24, 50) && finite(spec.lng, -125, -66) && [5, 10, 25].includes(spec.radiusKm));
  ensure(integer(spec.fuelCode, 1, 999) && (!fuels || fuels.some(f => f.code === spec.fuelCode)));
  ensure(typeof spec.treatmentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(spec.treatmentDate) && Number.isFinite(Date.parse(spec.treatmentDate)));
  ensure(new Date(spec.treatmentDate).toISOString().slice(0, 10) === spec.treatmentDate && spec.treatmentDate >= '2000-01-01' && spec.treatmentDate < issue.slice(0, 10));
 }
 function summaryValid(s) {
  keys(s, 'baseline,scenario,delta,selectedCells,eligibleCells,changedCells,changedAreaKm2,originalFuels');
  ensure(finite(s.baseline, 0, 1) && finite(s.scenario, 0, 1) && finite(s.delta, -1, 1) && Math.abs(s.scenario - s.baseline - s.delta) < 1e-6);
  ensure(integer(s.selectedCells, 1, MAX_FEATURES) && integer(s.eligibleCells, 0, s.selectedCells) && integer(s.changedCells, 0, s.eligibleCells));
  ensure(finite(s.changedAreaKm2, 0, 50000) && Math.abs(s.changedAreaKm2 - s.changedCells * 25) < 1e-6);
  ensure(Array.isArray(s.originalFuels) && s.originalFuels.length <= 300);
  const codes = new Set(); let total = 0;
  for (const f of s.originalFuels) { keys(f, 'code,cells'); ensure(integer(f.code, 0, 999) && integer(f.cells, 1, MAX_FEATURES) && !codes.has(f.code)); codes.add(f.code); total += f.cells; }
  ensure(total === s.eligibleCells);
 }
 function assetValid(a, id) {
  keys(a, 'path,sha256,bytes,url'); ensure(HASH.test(a.sha256) && integer(a.bytes, 1, LIMIT));
  const path = 'scenarios/assets/' + a.sha256 + '/' + id + '.json';
  ensure(a.path === id + '.json' && typeof a.url === 'string' && a.url.startsWith(HF));
  const u = new URL(a.url), tail = a.url.slice(HF.length);
  ensure(!u.username && !u.password && !u.search && !u.hash && /^[a-f0-9]{40}\//.test(tail) && tail.slice(41) === path);
 }
 function validateCatalog(m) {
  keys(m, 'schema_version,kind,version,published_at_utc,request_policy,request_runs,fuels,cases,requests');
  ensure(m.schema_version === 1 && m.kind === 'fuel-sensitivity-library' && m.version === VERSION && stamp(m.published_at_utc));
  const p = m.request_policy; keys(p, 'github_repo,issue_template,approval_required,max_daily,max_pending,enabled,public_settings');
  ensure(p.github_repo === 'LabRAI/fire-eye-preview' && p.issue_template === 'scenario.md' && p.approval_required === true && p.public_settings === true && typeof p.enabled === 'boolean');
  ensure(p.max_daily === 8 && p.max_pending === 2);
  ensure(Array.isArray(m.fuels) && m.fuels.length <= 100 && Array.isArray(m.request_runs) && m.request_runs.length <= 1000 && Array.isArray(m.cases) && m.cases.length <= 1000 && Array.isArray(m.requests) && m.requests.length <= 3000);
  const fuels = new Set(), runs = new Set(), cases = new Set(), requests = new Set();
  for (const f of m.fuels) { keys(f, 'code,label'); ensure(integer(f.code, 1, 999) && safeText(f.label, 160) && f.label.length > 0 && !fuels.has(f.code)); fuels.add(f.code); }
  for (const r of m.request_runs) { keys(r, 'source_id,issue_time_utc,target_time_utc,lead_hours'); runValid(r.source_id, r.issue_time_utc, r.target_time_utc, r.lead_hours); ensure(!runs.has(r.source_id)); runs.add(r.source_id); }
  for (const c of m.cases) {
   keys(c, 'id,created_at_utc,spec,issue_time_utc,target_time_utc,lead_hours,summary,asset');
   ensure(ID.test(c.id) && !cases.has(c.id) && stamp(c.created_at_utc)); cases.add(c.id);
   runValid(c.spec?.source, c.issue_time_utc, c.target_time_utc, c.lead_hours); specValid(c.spec, c.issue_time_utc); summaryValid(c.summary); assetValid(c.asset, c.id);
  }
  for (const r of m.requests) {
   keys(r, 'issue,id,status,message,case_id,updated_at_utc');
   // id is GitHub's database identifier, not the scenario/job identity.
   ensure(integer(r.issue, 1, 1000000000) && !requests.has(r.issue) && (r.id === null || typeof r.id === 'string' && ID.test(r.id)) && safeText(r.status, 64) && /^[a-z][a-z0-9_-]{0,63}$/.test(r.status));
   ensure(safeText(r.message, 1000) && (r.case_id === null || ID.test(r.case_id)) && stamp(r.updated_at_utc)); requests.add(r.issue);
  }
  return m;
 }
 function validateResult(r, entry) {
  keys(r, 'version,createdAt,spec,issueTime,targetTime,leadHours,cells,summary,provenance');
  ensure(r.version === VERSION && r.createdAt === entry.created_at_utc && same(r.spec, entry.spec) && r.issueTime === entry.issue_time_utc && r.targetTime === entry.target_time_utc && r.leadHours === entry.lead_hours && same(r.summary, entry.summary));
  specValid(r.spec, r.issueTime); summaryValid(r.summary);
  keys(r.provenance, 'source,checkpointSha256,normalizationSha256,inputSha256,numericSha256,baselineMaxAbsError,changedChannels,phases,scope');
  const p = r.provenance; ensure(p.source === r.spec.source && ['checkpointSha256', 'normalizationSha256', 'inputSha256', 'numericSha256'].every(k => HASH.test(p[k])));
  ensure(finite(p.baselineMaxAbsError, 0, 1) && Array.isArray(p.changedChannels) && p.changedChannels.length <= 16 && p.changedChannels.every(c => integer(c, 0, 15)) && integer(p.phases, 1, 1000) && safeText(p.scope));
  keys(r.cells, 'type,features'); ensure(r.cells.type === 'FeatureCollection' && Array.isArray(r.cells.features) && r.cells.features.length > 0 && r.cells.features.length <= MAX_FEATURES);
  let selected = 0, changed = 0, baseline = 0, scenario = 0, vertices = 0;
  for (const f of r.cells.features) {
   keys(f, 'type,geometry,properties'); keys(f.geometry, 'type,coordinates'); keys(f.properties, 'baseline,scenario,delta,treated,selected');
   ensure(f.type === 'Feature' && f.geometry.type === 'Polygon' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length > 0 && f.geometry.coordinates.length <= 8);
   for (const ring of f.geometry.coordinates) {
    ensure(Array.isArray(ring) && ring.length >= 4 && ring.length <= 100);
    for (const xy of ring) { ensure(Array.isArray(xy) && xy.length === 2 && finite(xy[0], -130, -60) && finite(xy[1], 20, 55)); vertices++; }
    ensure(same(ring[0], ring[ring.length - 1]));
   }
   const q = f.properties;
   ensure(finite(q.baseline, 0, 1) && finite(q.scenario, 0, 1) && finite(q.delta, -1, 1) && Math.abs(q.scenario - q.baseline - q.delta) < 1e-6 && typeof q.treated === 'boolean' && typeof q.selected === 'boolean' && (!q.treated || q.selected));
   if (q.selected) { selected++; baseline += q.baseline; scenario += q.scenario; } if (q.treated) changed++;
  }
  ensure(vertices <= 40000 && selected === r.summary.selectedCells && changed === r.summary.changedCells && Math.abs(baseline / selected - r.summary.baseline) < 1e-6 && Math.abs(scenario / selected - r.summary.scenario) < 1e-6);
  return r;
 }
 function catalogURL(url) {
  ensure(typeof url === 'string' && url.startsWith(HF));
  ensure(/^(main|[a-f0-9]{40})\/scenarios\.json$/.test(url.slice(HF.length))); return url;
 }
 async function readBytes(url, limit, signal, timeout = 10000) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort(); signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(abort, timeout); let reader;
  try {
   const response = await fetch(url, {signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'});
   ensure(response.ok && response.type !== 'opaque');
   const finalURL = new URL(response.url || url, location.href);
   ensure(!finalURL.username && !finalURL.password && (finalURL.origin === location.origin || finalURL.protocol === 'https:' && (finalURL.hostname === 'huggingface.co' || finalURL.hostname.endsWith('.hf.co') || finalURL.hostname === 'cdn-lfs.huggingface.co')));
   const length = response.headers.get('content-length'); ensure(!length || Number(length) <= limit);
   ensure(response.body); reader = response.body.getReader(); const chunks = []; let size = 0;
   for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength; ensure(size <= limit); chunks.push(value); }
   const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; } return bytes;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (reader) await reader.cancel().catch(() => {}); controller.abort(); }
 }
 function parse(bytes) { const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); ensure(clean(text) === text); return JSON.parse(text); }
 async function sha(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join(''); }
 async function verifiedCase(entry, signal) {
  const a = entry.asset, old = cache.get(a.sha256);
  if (old) { validateResult(old.result, entry); cache.delete(a.sha256); cache.set(a.sha256, old); return old; }
  const candidates = [], local = config.scenario_assets?.[a.sha256];
  if (local === './assets/scenarios/' + a.sha256 + '.json') candidates.push(new URL(local, location.href).href);
  candidates.push(a.url);
  for (const url of candidates) {
   if (signal.aborted) throw new Error('Selection changed.');
   try {
    const bytes = await readBytes(url, LIMIT, signal, url.startsWith(location.origin + '/') ? 4000 : 12000);
    ensure(bytes.byteLength === a.bytes && await sha(bytes) === a.sha256);
    const item = {bytes, result: validateResult(parse(bytes), entry)};
    cache.set(a.sha256, item); while (cache.size > (innerWidth <= 640 ? 2 : 4)) cache.delete(cache.keys().next().value); return item;
   } catch { if (signal.aborted) throw new Error('Selection changed.'); }
  }
  throw new Error('Result could not be verified.');
 }
 function exactTime(value) { return value.replace('T', ' ').replace(/\+00:00$/, 'Z').replace(/Z$/, ' UTC'); }
 function number(value, signed = false) {
  if (value === 0) return '0.000';
  if (Math.abs(value) < .001) return (value < 0 ? '−' : signed ? '+' : '') + '<0.001';
  return (value < 0 ? '−' : signed ? '+' : '') + Math.abs(value).toFixed(3);
 }
 function fuelName(code) { return W.manifest?.fuels.find(f => f.code === code)?.label || 'Fuel code ' + code; }
 function element(tag, value, className) { const e = document.createElement(tag); if (value !== undefined) e.textContent = clean(value); if (className) e.className = className; return e; }
 function option(parent, value, label) { const node = element('option', label); node.value = value; parent.append(node); }
 function renderMetadata(entry, r) {
  put('result-location', r.spec.lat.toFixed(4) + '°, ' + r.spec.lng.toFixed(4) + '° · ' + r.spec.radiusKm + ' km radius');
  put('result-dates', 'Issued ' + exactTime(r.issueTime) + ' · 12h window ending ' + exactTime(r.targetTime) + ' · +' + r.leadHours + 'h');
  put('result-condition', fuelName(r.spec.fuelCode) + ' · Treatment date ' + r.spec.treatmentDate + ' (context only)');
  const box = $('result-summary'); box.replaceChildren();
  for (const [label, key] of [['Baseline mean', 'baseline'], ['Scenario mean', 'scenario'], ['Signed change', 'delta']]) {
   const stat = element('div', label, 'stat'), value = element('strong', number(r.summary[key], key === 'delta')); value.title = String(r.summary[key]); stat.append(value); box.append(stat);
  }
  box.append(element('p', r.summary.selectedCells + ' selected cells · ' + r.summary.eligibleCells + ' eligible · ' + r.summary.changedCells + ' changed · ' + r.summary.changedAreaKm2 + ' km² modified. Means refer to selected model cells.', 'summary-note')); box.hidden = false;
  const list = $('metadata-list'); list.replaceChildren();
  const rows = [['Result', entry.id], ['Created (UTC)', exactTime(r.createdAt)], ['Issued (UTC)', exactTime(r.issueTime)], ['Window ending (UTC)', exactTime(r.targetTime)], ['Lead', r.leadHours + ' hours'], ['Radius', r.spec.radiusKm + ' km'], ['Coordinates', r.spec.lat + ', ' + r.spec.lng], ['Fuel condition', r.spec.fuelCode + ' · ' + fuelName(r.spec.fuelCode)], ['Treatment date', r.spec.treatmentDate + ' · context only'], ['Baseline mean (stored)', r.summary.baseline], ['Scenario mean (stored)', r.summary.scenario], ['Delta (stored)', r.summary.delta], ['Selected cells', r.summary.selectedCells], ['Eligible cells', r.summary.eligibleCells], ['Changed cells', r.summary.changedCells], ['Changed area', r.summary.changedAreaKm2 + ' km²'], ['Original eligible fuels', r.summary.originalFuels.map(f => f.code + ': ' + f.cells + ' cells').join('; ') || 'None'], ['Scope', r.provenance.scope], ['Source', r.provenance.source], ['Checkpoint SHA256', r.provenance.checkpointSha256], ['Normalization SHA256', r.provenance.normalizationSha256], ['Input SHA256', r.provenance.inputSha256], ['Numeric SHA256', r.provenance.numericSha256], ['Baseline max. error', r.provenance.baselineMaxAbsError], ['Changed channels', r.provenance.changedChannels.join(', ')], ['Phases', r.provenance.phases], ['Verified asset SHA256', entry.asset.sha256]];
  for (const [k, v] of rows) list.append(element('dt', k), element('dd', v)); $('result-metadata').hidden = false;
  $('download-result').disabled = false; $('copy-result-settings').disabled = false;
  const share = new URL(location.href); share.search = ''; share.searchParams.set('case', entry.id); $('share-result').href = share.href; $('share-result').hidden = false;
  history.replaceState(null, '', share); put('cell-values', 'Tap a cell on either map to inspect both values.');
 }
 function baseStyle() { return {version: 8, sources: {land: {type: 'geojson', data: 'assets/land.geojson', attribution: 'RAI Lab · Natural Earth'}}, layers: [{id: 'ocean', type: 'background', paint: {'background-color': '#dce9e9'}}, {id: 'land', type: 'fill', source: 'land', paint: {'fill-color': '#ebe8d9'}}]}; }
 function waitSource(map, id, signal) {
  return new Promise((resolve, reject) => {
   let timer; const done = ok => { clearTimeout(timer); map.off('sourcedata', check); map.off('error', error); signal?.removeEventListener('abort', abort); ok ? resolve() : reject(new Error('Map unavailable.')); };
   const check = () => { if (map.getSource(id) && map.isSourceLoaded(id)) done(true); };
   const error = e => { if (e.sourceId === id) done(false); }, abort = () => done(false);
   timer = setTimeout(abort, 12000); map.on('sourcedata', check); map.on('error', error); signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort(); else check();
  });
 }
 async function setupMaps() {
  try {
   ensure(window.maplibregl && window.proj4);
   for (const [index, container] of ['baseline-map', 'scenario-map'].entries()) {
    const map = new maplibregl.Map({container, style: baseStyle(), center: [-98, 38], zoom: 3.2, minZoom: 2, maxZoom: 13, attributionControl: false, antialias: false, pixelRatio: Math.min(devicePixelRatio, 1.5), maxTileCacheSize: 16, dragRotate: false, pitchWithRotate: false, touchPitch: false,
     transformRequest: url => { const u = new URL(url, location.href); if (u.origin !== location.origin) throw new Error('Map resource blocked.'); return {url: u.href, credentials: 'omit'}; }});
    W.maps.push(map); map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({compact: true})); map.addControl(new maplibregl.NavigationControl({showCompass: false}), 'bottom-right');
    map.on('error', e => { if (e.sourceId === 'land' && map.isStyleLoaded()) { try { map.getSource('land')?.setData(empty()); } catch {} } });
    map.on('move', () => {
     if (synchronization || W.maps.length !== 2 || disposed) return;
     synchronization = true;
     try { W.maps[1 - index].jumpTo({center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch()}); } finally { synchronization = false; }
    });
    map.on('click', e => inspectCell(map, e.point)); map.on('mousemove', e => { if (!matchMedia('(pointer:coarse)').matches) inspectCell(map, e.point); });
   }
   await Promise.all(W.maps.map(map => new Promise((resolve, reject) => { if (map.isStyleLoaded()) return resolve(); const timer = setTimeout(() => reject(new Error('Map unavailable.')), 10000); map.once('load', () => { clearTimeout(timer); resolve(); }); })));
   return true;
  } catch { for (const map of W.maps) { try { map.remove(); } catch {} } W.maps = []; $('map-unavailable').hidden = false; return false; }
 }
 function radiusGeometry(spec) {
  const crs = '+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs';
  const center = proj4('EPSG:4326', crs, [spec.lng, spec.lat]), ring = [];
  for (let i = 0; i < 96; i++) { const angle = i * Math.PI / 48; ring.push(proj4(crs, 'EPSG:4326', [center[0] + Math.cos(angle) * spec.radiusKm * 1000, center[1] + Math.sin(angle) * spec.radiusKm * 1000])); } ring.push(ring[0]);
  return {type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [ring]}};
 }
 function removeMapSet(id) { if (!id) return; for (const map of W.maps) { for (const suffix of ['-cells', '-treated', '-focus', '-radius']) if (map.getLayer(id + suffix)) map.removeLayer(id + suffix); for (const name of [id, id + '-outline']) if (map.getSource(name)) map.removeSource(name); } }
 async function stageMaps(r, seq, signal) {
  if (!W.maps.length) return null;
  const id = 'case-' + seq, geo = {type: 'FeatureCollection', features: r.cells.features.map((f, i) => ({...f, id: i}))}, radius = radiusGeometry(r.spec);
  try { for (const [i, map] of W.maps.entries()) {
   map.addSource(id, {type: 'geojson', data: geo}); map.addSource(id + '-outline', {type: 'geojson', data: radius});
   map.addLayer({id: id + '-cells', source: id, type: 'fill', layout: {visibility: 'none'}, paint: {'fill-color': colors(i ? 'scenario' : 'baseline'), 'fill-opacity': .85, 'fill-antialias': false}});
   map.addLayer({id: id + '-treated', source: id, type: 'line', filter: ['==', ['get', 'treated'], true], layout: {visibility: 'none'}, paint: {'line-color': '#173d35', 'line-width': 1.2}});
   map.addLayer({id: id + '-focus', source: id, type: 'line', filter: ['==', ['id'], -1], layout: {visibility: 'none'}, paint: {'line-color': '#111f1a', 'line-width': 2.5}});
   map.addLayer({id: id + '-radius', source: id + '-outline', type: 'line', layout: {visibility: 'none'}, paint: {'line-color': '#183c32', 'line-width': 1.5, 'line-dasharray': [3, 2]}});
  }
   await Promise.all(W.maps.map(m => waitSource(m, id, signal))); ensure(seq === sequence && !signal.aborted); return id; }
  catch (e) { removeMapSet(id); throw e; }
 }
 function fitResult() {
  if (!W.selected || !W.maps.length) return;
  const points = radiusGeometry(W.selected.result.spec).geometry.coordinates[0], bounds = points.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds());
  W.maps[0].fitBounds(bounds, {padding: innerWidth <= 640 ? 12 : 35, duration: 0, maxZoom: 11});
 }
 function inspectCell(map, point) {
  if (!currentSource || !W.selected || !map.getLayer(currentSource + '-cells')) return;
  const feature = map.queryRenderedFeatures(point, {layers: [currentSource + '-cells']})[0], index = feature?.id;
  for (const m of W.maps) m.setFilter(currentSource + '-focus', ['==', ['id'], Number.isInteger(index) ? index : -1]);
  const cell = W.selected.result.cells.features[index];
  if (!cell) { put('cell-values', 'No published model cell at this location.'); return; }
  const p = cell.properties;
  put('cell-values', 'Baseline ' + number(p.baseline) + ' · Scenario ' + number(p.scenario) + ' · Δ ' + number(p.delta, true) + ' · ' + (p.selected ? 'Within selection' : 'Surrounding context') + ' · ' + (p.treated ? 'Fuel modified' : 'Fuel unchanged'));
  $('cell-values').title = 'Stored values: ' + p.baseline + ' / ' + p.scenario + ' / ' + p.delta;
 }
 function deltaView() {
  const on = $('delta-toggle').checked; put('scenario-title', on ? 'Signed change (Δ)' : 'Scenario'); $('delta-legend').hidden = !on;
  if (currentSource && W.maps.length === 2) W.maps[1].setPaintProperty(currentSource + '-cells', 'fill-color', on ? deltaColors : colors('scenario'));
 }
 const mapsReady = setupMaps();
 async function selectCase(id) {
  const entry = W.manifest?.cases.find(c => c.id === id); if (!entry) return false;
  retryId = id;
  const seq = ++sequence; activeController?.abort(); activeController = new AbortController(); const signal = activeController.signal;
  W.status = 'loading'; $('comparison').setAttribute('aria-busy', 'true'); $('retry-result').hidden = true;
  put('result-status', W.selected ? 'Loading selected result. The displayed comparison remains unchanged.' : 'Verifying published result…');
  let staged;
  try {
   const item = await verifiedCase(entry, signal); await mapsReady; if (seq !== sequence || signal.aborted) return false;
   staged = await stageMaps(item.result, seq, signal); if (seq !== sequence || signal.aborted) { removeMapSet(staged); return false; }
   const oldSource = currentSource;
   if (staged) for (const map of W.maps) for (const suffix of ['-cells', '-treated', '-focus', '-radius']) map.setLayoutProperty(staged + suffix, 'visibility', 'visible');
   currentSource = staged;
   W.selected = {id: entry.id, entry, result: item.result}; renderMetadata(entry, item.result); deltaView(); removeMapSet(oldSource);
   $('case-select').value = id; $('delta-toggle').disabled = !W.maps.length; $('fit-result').disabled = !W.maps.length;
   W.status = 'ready'; put('result-status', 'Verified published comparison · original result values'); fitResult(); updateRequest(); return true;
  } catch {
   if (seq !== sequence || signal.aborted) return false;
   if (staged && staged !== currentSource) removeMapSet(staged);
   W.status = 'unavailable'; put('result-status', W.selected ? 'Selected result unavailable. The previous verified comparison is still displayed.' : 'This result could not be verified. Retry or choose another published comparison.');
   $('retry-result').hidden = false; return false;
  } finally { if (seq === sequence) $('comparison').setAttribute('aria-busy', 'false'); }
 }
 function sourceLabel(r) { return exactTime(r.target_time_utc) + ' · +' + r.lead_hours + 'h · issued ' + exactTime(r.issue_time_utc); }
 function fillLibrary() {
  const m = W.manifest, select = $('case-select'), previous = select.value; select.replaceChildren();
  option(select, '', m.cases.length ? 'Choose a published comparison' : 'No published comparisons yet');
  for (const c of m.cases) option(select, c.id, c.spec.lat.toFixed(4) + '°, ' + c.spec.lng.toFixed(4) + '° · ' + c.spec.radiusKm + ' km · ' + exactTime(c.target_time_utc) + ' · fuel ' + c.spec.fuelCode + ' · treatment ' + c.spec.treatmentDate);
  if (m.cases.some(c => c.id === previous)) select.value = previous; select.disabled = !m.cases.length;
  const source = $('request-source'), fuel = $('request-fuel'), oldSource = source.value, oldFuel = fuel.value;
  source.replaceChildren(); fuel.replaceChildren(); option(source, '', 'Choose a forecast window'); option(fuel, '', 'Choose a fuel condition');
  for (const r of m.request_runs) option(source, r.source_id, sourceLabel(r)); for (const f of m.fuels) option(fuel, String(f.code), f.label);
  if (m.request_runs.some(r => r.source_id === oldSource)) source.value = oldSource; if (m.fuels.some(f => String(f.code) === oldFuel)) fuel.value = oldFuel;
  $('request-fields').disabled = !m.request_policy.enabled || !m.request_runs.length || !m.fuels.length;
  put('request-policy', 'GitHub login required. Settings are public. Every new request awaits maintainer approval before computation. Up to ' + m.request_policy.max_daily + ' requests/day and ' + m.request_policy.max_pending + ' pending requests under the published queue policy. This page only opens a draft; nothing is submitted automatically.');
  updateRequest();
 }
 function prefillQuery() {
  const lat = query.get('lat'), lng = query.get('lng'), source = query.get('source'), radius = query.get('radius');
  if (lat !== null && lng !== null && lat.trim() && lng.trim() && finite(Number(lat), 24, 50) && finite(Number(lng), -125, -66)) { $('request-lat').value = Number(lat).toFixed(4); $('request-lng').value = Number(lng).toFixed(4); draftTouched = true; }
  if (source && W.manifest.request_runs.some(r => r.source_id === source)) { $('request-source').value = source; draftTouched = true; }
  if (radius !== null && ['5', '10', '25'].includes(radius)) { $('request-radius').value = radius; draftTouched = true; }
  if (lat !== null || lng !== null || source !== null) { $('request-panel').open = true; put('result-status', 'Location settings are a request draft. Select a published comparison to view a verified result.'); }
  updateRequest();
 }
 function requestSpec() {
  const r = W.manifest?.request_runs.find(r => r.source_id === $('request-source').value); ensure(r);
  ensure($('request-lat').value.trim() && $('request-lng').value.trim() && $('request-fuel').value);
  const s = {source: r.source_id, lat: Number(Number($('request-lat').value).toFixed(4)), lng: Number(Number($('request-lng').value).toFixed(4)), radiusKm: Number($('request-radius').value), fuelCode: Number($('request-fuel').value), treatmentDate: $('request-date').value};
  specValid(s, r.issue_time_utc, W.manifest.fuels); return s;
 }
 function updateRequest() {
  const link = $('request-link'); link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true');
  const r = W.manifest?.request_runs.find(r => r.source_id === $('request-source').value);
  if (r) $('request-date').max = new Date(Date.parse(r.issue_time_utc.slice(0, 10)) - 86400000).toISOString().slice(0, 10); else $('request-date').removeAttribute('max');
  if (!W.manifest) return;
  if (!W.manifest.request_policy.enabled) { put('request-validation', 'New requests are paused. Published comparisons remain available.'); return; }
  try {
   const spec = requestSpec(), fence = String.fromCharCode(96).repeat(3), body = '<!-- fire-eye-scenario:v1 -->\n' + fence + 'json\n' + JSON.stringify(spec, null, 2) + '\n' + fence;
   const url = new URL('https://github.com/LabRAI/fire-eye-preview/issues/new'); url.searchParams.set('template', 'scenario.md'); url.searchParams.set('title', 'What-if request: ' + spec.lat.toFixed(4) + ', ' + spec.lng.toFixed(4)); url.searchParams.set('body', body);
   link.href = url.href; link.setAttribute('aria-disabled', 'false');
   put('request-validation', W.selected && !same(spec, W.selected.result.spec) ? 'Draft differs from the displayed result. Review these settings on GitHub to request a new comparison.' : 'Draft ready for review on GitHub. Treatment date is context only.');
  } catch { put('request-validation', draftTouched ? 'Complete valid source, coordinates, fuel and an earlier treatment date. The displayed result has not changed.' : 'Choose a forecast window, coordinates, fuel condition and treatment date.'); }
 }
 function useDisplayedSettings() {
  if (!W.selected) return; const s = W.selected.result.spec;
  $('request-source').value = W.manifest.request_runs.some(r => r.source_id === s.source) ? s.source : '';
  $('request-lat').value = s.lat; $('request-lng').value = s.lng; $('request-radius').value = s.radiusKm; $('request-date').value = s.treatmentDate;
  $('request-fuel').value = W.manifest.fuels.some(f => f.code === s.fuelCode) ? s.fuelCode : ''; draftTouched = true; updateRequest();
  if (!$('request-source').value) put('request-validation', 'Location and fuel copied. Choose a currently requestable forecast window; the displayed result stays unchanged.');
 }
 function lookupRequest(event) {
  event?.preventDefault(); lookupCase = null; $('lookup-open').hidden = true;
  const issue = Number($('lookup-issue').value); if (!integer(issue, 1, 1000000000)) { put('lookup-status', 'Enter a valid GitHub issue number.'); return; }
  const r = W.manifest?.requests.find(r => r.issue === issue);
  if (!r) { put('lookup-status', 'Issue #' + issue + ' is not in this published snapshot. Refresh the library for newer status.'); return; }
  put('lookup-status', '#' + issue + ' · Last published status: ' + r.status.replace(/[_-]/g, ' ') + ' · ' + r.message + ' · Record updated ' + exactTime(r.updated_at_utc) + ' · Library published ' + exactTime(W.manifest.published_at_utc) + '. Not a live queue.');
  if (r.case_id && W.manifest.cases.some(c => c.id === r.case_id)) { lookupCase = r.case_id; $('lookup-open').hidden = false; }
 }
 async function loadCatalog(initial = false) {
  if (loadingCatalog) return; loadingCatalog = true; $('reload-catalog').disabled = true;
  put('catalog-status', 'Checking published library…');
  try {
   let m, bundled = false;
   try { m = validateCatalog(parse(await readBytes(catalogURL(config.scenarios_url), LIMIT, null, 9000))); }
   catch { m = validateCatalog(parse(await readBytes('scenarios-bootstrap.json', LIMIT, null, 4000))); bundled = true; }
   W.manifest = m; fillLibrary(); put('catalog-status', (bundled ? 'Bundled library snapshot · ' : 'Published library · ') + exactTime(m.published_at_utc) + ' · ' + m.cases.length + ' verified-result entries');
   if (initial) {
    prefillQuery(); const requested = query.get('case'), locationDraft = ['lat', 'lng', 'source'].some(k => query.has(k));
    if (requested && m.cases.some(c => c.id === requested)) { $('case-select').value = requested; await selectCase(requested); }
    else if (requested) { W.status = 'not-found'; put('result-status', 'That comparison is not in this library. Choose an available published result.'); }
    else if (!locationDraft && m.cases.length) await selectCase(m.cases[0].id);
    else { W.status = 'empty'; if (!locationDraft) put('result-status', 'No published comparisons yet. You can prepare a request below.'); }
   }
   if ($('lookup-issue').value) lookupRequest();
  } catch {
   put('catalog-status', W.manifest ? 'Library refresh unavailable. The last verified library remains available.' : 'Library unavailable. Retry to load published comparisons.');
   if (!W.manifest) { W.status = 'unavailable'; put('result-status', 'No verified result loaded.'); }
  } finally { loadingCatalog = false; W.ready = true; $('reload-catalog').disabled = false; if (W.status !== 'loading') $('comparison').setAttribute('aria-busy', 'false'); }
 }
 $('case-select').addEventListener('change', () => selectCase($('case-select').value));
 $('reload-catalog').addEventListener('click', () => loadCatalog(!W.manifest));
 $('retry-result').addEventListener('click', () => { if (retryId) selectCase(retryId); });
 $('fit-result').addEventListener('click', fitResult); $('delta-toggle').addEventListener('change', deltaView);
 $('request-form').addEventListener('submit', e => e.preventDefault());
 $('request-form').addEventListener('input', () => { draftTouched = true; updateRequest(); }); $('request-form').addEventListener('change', () => { draftTouched = true; updateRequest(); });
 $('copy-result-settings').addEventListener('click', useDisplayedSettings);
 $('request-link').addEventListener('click', e => { updateRequest(); if ($('request-link').getAttribute('aria-disabled') === 'true') e.preventDefault(); });
 $('lookup-form').addEventListener('submit', lookupRequest); $('lookup-open').addEventListener('click', () => { if (lookupCase) selectCase(lookupCase); });
 $('download-result').addEventListener('click', async () => {
  const selected = W.selected; if (!selected) return; const button = $('download-result'); button.disabled = true;
  try {
   const item = await verifiedCase(selected.entry, new AbortController().signal), blob = new Blob([item.bytes], {type: 'application/json'}), url = URL.createObjectURL(blob), a = element('a');
   a.href = url; a.download = 'fire-eye-what-if-' + selected.id + '.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { put('result-status', 'Verified download unavailable. Retry the result before downloading.'); }
  finally { button.disabled = !W.selected; }
 });
 window.addEventListener('pagehide', () => { disposed = true; sequence++; activeController?.abort(); cache.clear(); for (const map of W.maps) { try { map.remove(); } catch {} } });
 window.addEventListener('pageshow', e => { if (e.persisted && disposed) location.reload(); });
 try { config = parse(await readBytes('config.json', 65536, null, 4000)); } catch { config = {}; }
 await loadCatalog(true);
})().catch(() => {
 const state = window.fireEyeWhatIf; if (state) { state.ready = true; state.status = 'unavailable'; }
 const target = document.getElementById('result-status'); if (target) target.textContent = 'Comparison viewer unavailable. The main map remains accessible.';
});
