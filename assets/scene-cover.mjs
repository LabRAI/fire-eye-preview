/* Historical 3 km composition, never plant locations, density, or fire inputs.
 * No I/O at import time. The shared loader is called only by scene.build().
 */
export const COVER_CLASSES = Object.freeze(['forest_woodland', 'shrubland', 'grass_herbaceous', 'agriculture', 'developed', 'open_water', 'sparse_barren', 'snow_ice']);
export const COVER_NOTE = 'Schematic clusters from historical 3 km cover fractions; not exact plants, tree density, or current conditions.';
const R = 6378137, RAD = Math.PI / 180, E2 = 0.006694380022900787, E = Math.sqrt(E2);
const aq = p => { const s = Math.sin(p); return (1 - E2) * (s / (1 - E2 * s * s) - Math.log((1 - E * s) / (1 + E * s)) / (2 * E)); };
const am = p => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
const N = (am(29.5 * RAD) ** 2 - am(45.5 * RAD) ** 2) / (aq(45.5 * RAD) - aq(29.5 * RAD));
const C = am(29.5 * RAD) ** 2 + N * aq(29.5 * RAD), RHO0 = R * Math.sqrt(C - N * aq(23 * RAD)) / N;
// NAD83 / GRS80 Albers, matching the published EPSG:5070 grid.
export function projectCover([lon, lat]) {
 const rho = R * Math.sqrt(C - N * aq(lat * RAD)) / N, theta = N * (lon + 96) * RAD;
 return [rho * Math.sin(theta), RHO0 - rho * Math.cos(theta)];
}
export function sceneFootprint(center, radius = 650) {
 const scale = Math.cos(center[1] * RAD), y = R * Math.log(Math.tan(Math.PI / 4 + center[1] * RAD / 2)), d = radius / scale;
 return [center[0] - d / R / RAD, (2 * Math.atan(Math.exp((y - d) / R)) - Math.PI / 2) / RAD, center[0] + d / R / RAD, (2 * Math.atan(Math.exp((y + d) / R)) - Math.PI / 2) / RAD];
}
const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function ringContains(ring, p) {
 let inside = false;
 for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
  const a = ring[i], b = ring[j];
  if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
 }
 return inside;
}
const contains = (polygons, p) => polygons.some(rings => ringContains(rings[0], p) && !rings.slice(1).some(r => ringContains(r, p)));
function clipRing(ring, box) {
 let out = ring;
 for (const [axis, edge, sign] of [[0, box[0], 1], [0, box[2], -1], [1, box[1], 1], [1, box[3], -1]]) {
  const input = out; out = []; if (!input.length) break;
  let a = input[input.length - 1], ai = (a[axis] - edge) * sign >= 0;
  for (const b of input) {
   const bi = (b[axis] - edge) * sign >= 0;
   if (ai !== bi) { const t = (edge - a[axis]) / (b[axis] - a[axis]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
   if (bi) out.push(b); a = b; ai = bi;
  }
 }
 if (out.length) out.push(out[0]);
 return out.length >= 4 ? out : [];
}
function localBoundary(boundary, box) {
 return boundary.map(rings => { const outer = clipRing(rings[0], box); return outer.length ? [outer, ...rings.slice(1).map(r => clipRing(r, box)).filter(r => r.length)] : null; }).filter(Boolean);
}
function validateBoundary(data) {
 if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw Error('Invalid cover boundary');
 let vertices = 0; const polygons = [];
 for (const f of data.features) {
  const g = f.geometry, parts = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : null;
  if (!Array.isArray(parts)) throw Error('Invalid cover boundary');
  for (const rings of parts) {
   if (!Array.isArray(rings) || !rings.length) throw Error('Invalid cover boundary');
   for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) throw Error('Invalid cover boundary');
    for (const p of ring) if (++vertices > 200000 || !Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw Error('Invalid cover boundary');
   }
   polygons.push(rings);
  }
 }
 return polygons;
}
function validateIndex(m) {
 const l = m?.landscape, g = l?.grid;
 if (m?.schema_version !== 1 || m.kind !== 'independent-scene-context' || g?.crs !== 'EPSG:5070' || g.cell_size_m !== 3000 || l.tile_side !== 64 || !Array.isArray(g.origin_upper_left_m) || g.origin_upper_left_m.length !== 2 || !g.origin_upper_left_m.every(Number.isFinite) || ![g.width, g.height].every(n => Number.isInteger(n) && n > 0 && n <= 4096) || JSON.stringify(l.classes) !== JSON.stringify(COVER_CLASSES) || !l.tiles || !m.assets?.boundary) throw Error('Invalid cover index');
 return m;
}
function validateTile(tile, row, col) {
 const a = tile?.arrays, counts = a?.counts, domain = a?.domain_count;
 if (tile?.row !== row || tile?.col !== col || !Array.isArray(counts) || counts.length !== 8 || !Array.isArray(domain) || !domain.length || domain.length > 64) throw Error('Invalid cover tile');
 const height = domain.length, width = domain[0]?.length;
 if (!Number.isInteger(width) || width < 1 || width > 64) throw Error('Invalid cover tile');
 for (const matrix of [domain, ...counts]) {
  if (!Array.isArray(matrix) || matrix.length !== height || matrix.some(r => !Array.isArray(r) || r.length !== width || r.some(v => !Number.isInteger(v) || v < 0 || v > 10000))) throw Error('Invalid cover counts');
 }
 for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) if (counts.reduce((n, a) => n + a[r][c], 0) > domain[r][c]) throw Error('Invalid cover coverage');
 // Retain only composition counts, not unused terrain/tag arrays.
 return { row, col, arrays: { counts, domain_count: domain } };
}
const aborted = signal => { if (signal?.aborted) throw new DOMException('Scene selection changed', 'AbortError'); };
function waitFor(promise, signal) {
 if (!signal) return promise;
 return new Promise((resolve, reject) => {
  const stop = () => reject(new DOMException('Scene selection changed', 'AbortError'));
  if (signal.aborted) { promise.catch(() => {}); stop(); return; }
  signal.addEventListener('abort', stop, { once: true });
  promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
 });
}
async function readBounded(stream, limit, signal) {
 if (!stream?.getReader) throw Error('Cover streaming unavailable');
 const reader = stream.getReader(), parts = []; let length = 0;
 try {
  for (;;) {
   const part = await waitFor(reader.read(), signal); aborted(signal);
   if (part.done) break; length += part.value.byteLength;
   if (length > limit) throw Error('Cover asset exceeds bound'); parts.push(part.value);
  }
 } finally { reader.cancel().catch(() => {}); }
 const out = new Uint8Array(length); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out;
}
export function createCoverLoader({ indexURL = new URL('../scene-bootstrap.json', import.meta.url), fetchImpl = globalThis.fetch, timeoutMs = 4500, maxTiles = 4, cacheTiles = 12, retryMs = 30000 } = {}) {
 const base = new URL(indexURL), shared = new Map(), tiles = new Map(), queue = []; let active = 0;
 timeoutMs = Math.max(1, Math.min(4500, timeoutMs)); maxTiles = Math.max(1, Math.min(4, maxTiles)); cacheTiles = Math.max(maxTiles, Math.min(12, cacheTiles));
 function schedule(task) {
  if (queue.length >= 12) return Promise.reject(Error('Cover request budget'));
  return new Promise((resolve, reject) => {
   queue.push({ task, resolve, reject }); drain();
  });
 }
 function drain() {
  while (active < 3 && queue.length) {
   const job = queue.shift(); active++;
   job.task().then(job.resolve, job.reject).finally(() => { active--; drain(); });
  }
 }
 function memo(cache, key, factory, limit) {
  const old = cache.get(key);
  if (old && (!old.failedAt || Date.now() - old.failedAt < retryMs)) { cache.delete(key); cache.set(key, old); return old.promise; }
  if (old) cache.delete(key);
  if (cache.size >= limit) { const victim = [...cache].find(([, e]) => e.settled); if (!victim) return Promise.reject(Error('Cover cache budget')); cache.delete(victim[0]); }
  const entry = { settled: false, failedAt: 0 };
  entry.promise = factory().then(value => { entry.settled = true; return value; }, error => { entry.settled = true; entry.failedAt = Date.now(); throw error; });
  cache.set(key, entry); return entry.promise;
 }
 function approved(value) {
  const u = new URL(value, base);
  if (u.username || u.password) throw Error('Invalid cover origin');
  if (u.origin === base.origin && ['https:', 'http:'].includes(u.protocol)) return u.href;
  const parts = u.pathname.split('/');
  if (u.protocol === 'https:' && u.hostname === 'huggingface.co' && parts[1] === 'datasets' && parts[4] === 'resolve' && /^[a-f0-9]{40}$/.test(parts[5])) return u.href;
  throw Error('Invalid cover origin');
 }
 async function jsonAsset(descriptor, limit, decodedLimit) {
  if (descriptor && (!Number.isInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > limit || !/^[a-f0-9]{64}$/.test(descriptor.sha256) || !['gzip', 'identity', undefined].includes(descriptor.encoding))) throw Error('Invalid cover descriptor');
  const url = descriptor ? approved(descriptor.url) : base.href;
  return schedule(async () => {
   const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
   try {
    const response = await waitFor(fetchImpl(url, { credentials: 'omit', signal: controller.signal, cache: 'force-cache' }), controller.signal);
    if (!response.ok || Number(response.headers.get('content-length')) > limit) throw Error('Cover unavailable');
    let raw = await readBounded(response.body, limit, controller.signal);
    if (descriptor) {
     const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), n => n.toString(16).padStart(2, '0')).join('');
     if (raw.length !== descriptor.bytes || digest !== descriptor.sha256) throw Error('Cover checksum mismatch');
     if (descriptor.encoding === 'gzip') raw = await readBounded(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip')), decodedLimit, controller.signal);
    }
    aborted(controller.signal); return JSON.parse(new TextDecoder().decode(raw));
   } finally { clearTimeout(timer); }
  });
 }
 async function load(center, { signal } = {}) {
  if (!Array.isArray(center) || center.length !== 2 || !center.every(Number.isFinite) || Math.abs(center[0]) > 180 || Math.abs(center[1]) > 85) return { status: 'unavailable', cells: [] };
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), timeoutMs), stop = () => deadline.abort();
  signal?.addEventListener('abort', stop, { once: true });
  try {
   aborted(signal);
   const m = await waitFor(memo(shared, 'index', () => jsonAsset(null, 512 * 1024, 512 * 1024).then(validateIndex), 2), deadline.signal);
   aborted(deadline.signal); const g = m.landscape.grid, box = sceneFootprint(center), positions = [];
   // Densify the small footprint edge before projecting; use cell indices, not
   // a WGS84 bounding-box lookup into the Albers grid.
   for (let i = 0; i <= 8; i++) { const t = i / 8, x = box[0] + (box[2] - box[0]) * t, y = box[1] + (box[3] - box[1]) * t; positions.push(...[[x, box[1]], [x, box[3]], [box[0], y], [box[2], y]].map(projectCover)); }
   const cols = positions.map(p => Math.floor((p[0] - g.origin_upper_left_m[0]) / 3000)), rows = positions.map(p => Math.floor((g.origin_upper_left_m[1] - p[1]) / 3000));
   const c0 = Math.max(0, Math.min(...cols)), c1 = Math.min(g.width - 1, Math.max(...cols)), r0 = Math.max(0, Math.min(...rows)), r1 = Math.min(g.height - 1, Math.max(...rows));
   if (c0 > c1 || r0 > r1) return { status: 'outside_conus', cells: [] };
   if ((c1 - c0 + 1) * (r1 - r0 + 1) > 16) return { status: 'unavailable', cells: [] };
   const wanted = new Map();
   for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) { const tr = Math.floor(row / 64), tc = Math.floor(col / 64), key = m.landscape.tiles[tr + ':' + tc]; if (key) wanted.set(key, [tr * 64, tc * 64]); }
   if (wanted.size > maxTiles) return { status: 'unavailable', cells: [] };
   // Start local tiles alongside the boundary. The national mask is reused
   // across pans, and a cold boundary must not serialize every tile request.
   const boundaryTask = memo(shared, 'boundary', () => jsonAsset(m.assets.boundary, 2 * 1024 * 1024, 6 * 1024 * 1024).then(validateBoundary), 2);
   const tileTask = Promise.allSettled([...wanted].map(([key, [row, col]]) => { const a = m.assets[key]; return memo(tiles, a?.sha256 || key, () => a ? jsonAsset(a, 128 * 1024, 4 * 1024 * 1024).then(t => validateTile(t, row, col)) : Promise.reject(Error('Cover tile not published')), cacheTiles); }));
   const boundary = await waitFor(boundaryTask, deadline.signal);
   aborted(deadline.signal); const local = localBoundary(boundary, box);
   if (!local.length) return { status: 'outside_conus', cells: [] };
   const loaded = await waitFor(tileTask, deadline.signal);
   const cells = [];
   for (const result of loaded) if (result.status === 'fulfilled') {
    const t = result.value;
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
     if (row < t.row || row >= t.row + 64 || col < t.col || col >= t.col + 64) continue;
     const r = row - t.row, c = col - t.col, domain = t.arrays.domain_count[r]?.[c];
     if (!domain) continue; const counts = t.arrays.counts.map(a => a[r][c]), covered = counts.reduce((a, b) => a + b, 0);
     if (!covered) continue;
     cells.push({ row, col, cell_id: 'c3k-r' + row + '-c' + col, composition: Object.fromEntries(COVER_CLASSES.map((name, i) => [name, counts[i] / covered])), coverage: { cover_fraction_of_conus: covered / domain, conus_fraction_of_footprint: domain / 10000 } });
    }
   }
   return { status: cells.length ? 'ok' : loaded.some(r => r.status === 'rejected') ? 'unavailable' : 'no_landcover_data', grid: g, cells, boundary: local, bbox_wgs84: box, source_edition: m.landscape.source_edition, source_atlas_sha256: m.landscape.source_atlas_sha256, note: COVER_NOTE, partial: loaded.some(r => r.status === 'rejected') };
  } catch {
   aborted(signal); return { status: 'unavailable', cells: [], note: COVER_NOTE };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
 }
 return { load };
}
// Voronoi patches are anchored in projected metres, independent of viewport,
// device, quality, forecast, tile fetch order, and the scene's random budget.
function clusterClass(cell, xy) {
 const side = 80, ix = Math.floor(xy[0] / side), iy = Math.floor(xy[1] / side); let best = Infinity, key;
 for (let x = ix - 1; x <= ix + 1; x++) for (let y = iy - 1; y <= iy + 1; y++) {
  const id = 'cover-patch/' + x + '/' + y, h = hash(id), px = (x + .2 + (h % 1000) / 1667) * side, py = (y + .2 + ((h >>> 12) % 1000) / 1667) * side, d = (px - xy[0]) ** 2 + (py - xy[1]) ** 2;
  if (d < best) { best = d; key = id; }
 }
 let value = hash(key + '/class') / 4294967296;
 const known = cell.coverage?.cover_fraction_of_conus;
 // Unknown source coverage keeps a schematic share unclassified. Do not
 // expand a partially mapped cell's known vegetation to its whole footprint.
 if (!Number.isFinite(known) || known <= 0 || known > 1 || value >= known) return null;
 value /= known;
 for (const name of COVER_CLASSES) { value -= cell.composition[name]; if (value < 0) return name; }
 return null;
}
export function createCoverSampler(context) {
 const g = context?.grid, cells = new Map();
 if (context?.status !== 'ok' || g?.crs !== 'EPSG:5070' || g.cell_size_m !== 3000 || !Array.isArray(g.origin_upper_left_m) || g.origin_upper_left_m.length !== 2 || !g.origin_upper_left_m.every(Number.isFinite) || !Array.isArray(context.boundary) || !Array.isArray(context.cells) || context.cells.length > 16) return () => null;
 for (const cell of context.cells) {
  const values = COVER_CLASSES.map(k => cell.composition?.[k]);
  if (Number.isInteger(cell.row) && Number.isInteger(cell.col) && values.every(v => Number.isFinite(v) && v >= 0 && v <= 1) && Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 1e-6) cells.set(cell.row + ':' + cell.col, cell);
 }
 return p => {
  if (!Array.isArray(p) || !p.every(Number.isFinite) || !contains(context.boundary, p)) return null;
  const xy = projectCover(p), col = Math.floor((xy[0] - g.origin_upper_left_m[0]) / 3000), row = Math.floor((g.origin_upper_left_m[1] - xy[1]) / 3000), cell = cells.get(row + ':' + col);
  return cell ? { ...cell, classification: clusterClass(cell, xy) } : null;
 };
}
let sharedLoader;
export const loadSceneCover = (center, options) => (sharedLoader ||= createCoverLoader()).load(center, options);
