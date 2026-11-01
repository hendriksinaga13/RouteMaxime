import { state } from '../core/state.js';
import { haversineMeters } from '../core/utils.js';

export const UNREACHABLE = 1e9;      // jarak "tak terjangkau" pada matriks
const TABLE_MAX = 100;               // batas koordinat per request OSRM publik
const TILE = 50;                     // ukuran blok saat matriks > TABLE_MAX
const ROUTE_CHUNK = 90;              // maks waypoint per request rute

function base() {
  const p = state.provider;
  return { endpoint: String(p.endpoint || '').trim().replace(/\/+$/, ''), profile: p.profile || 'driving' };
}
const coordStr = (pts) => pts.map(pt => `${pt.lon},${pt.lat}`).join(';');

async function getJSON(url, timeout) {
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw new Error(e.name === 'TimeoutError' ? 'Server routing tidak merespons (timeout)' : 'Tidak dapat terhubung ke server routing'); }
  if (!res.ok) throw new Error(`Server routing HTTP ${res.status}`);
  return res.json();
}

export async function checkProvider() {
  try {
    const { endpoint, profile } = base();
    if (!endpoint) return { ok: false, message: 'Endpoint kosong' };
    const j = await getJSON(`${endpoint}/route/v1/${profile}/106.8,-6.2;106.81,-6.21?overview=false`, 8000);
    return j.code === 'Ok' ? { ok: true, message: 'Terhubung' } : { ok: false, message: j.message || j.code };
  } catch (e) { return { ok: false, message: e.message }; }
}

async function tableRequest(pts, sources, destinations) {
  const { endpoint, profile } = base();
  let url = `${endpoint}/table/v1/${profile}/${coordStr(pts)}?annotations=distance`;
  if (sources) url += `&sources=${sources.join(';')}`;
  if (destinations) url += `&destinations=${destinations.join(';')}`;
  const json = await getJSON(url, 30000);
  if (json.code !== 'Ok') throw new Error('Matriks gagal: ' + (json.message || json.code));
  return json.distances;
}

// Matriks jarak jalan (meter). Otomatis dipecah per blok bila titik > 100.
export async function getMatrix(points, onProgress) {
  const n = points.length;
  const fix = (v) => (v == null ? UNREACHABLE : v);
  if (n <= TABLE_MAX) {
    const d = await tableRequest(points);
    return d.map(row => row.map(fix));
  }
  const M = Array.from({ length: n }, () => new Array(n).fill(UNREACHABLE));
  const blocks = []; for (let i = 0; i < n; i += TILE) blocks.push([i, Math.min(i + TILE, n)]);
  let done = 0; const total = blocks.length * blocks.length;
  for (const [r0, r1] of blocks) {
    for (const [c0, c1] of blocks) {
      const rows = points.slice(r0, r1), cols = points.slice(c0, c1);
      const pts = rows.concat(cols);
      const src = rows.map((_, i) => i);
      const dst = cols.map((_, j) => rows.length + j);
      const d = await tableRequest(pts, src, dst);
      for (let i = 0; i < rows.length; i++) for (let j = 0; j < cols.length; j++) M[r0 + i][c0 + j] = fix(d[i][j]);
      if (onProgress) onProgress(++done / total);
    }
  }
  for (let i = 0; i < n; i++) M[i][i] = 0;
  return M;
}

// Satu rute melewati semua titik berurutan. Mengembalikan geometri + jarak/durasi tiap leg.
export async function getRouteThrough(points) {
  const { endpoint, profile } = base();
  const legs = [], geometry = [];
  for (let s = 0; s < points.length - 1; s += ROUTE_CHUNK - 1) {
    const chunk = points.slice(s, Math.min(s + ROUTE_CHUNK, points.length));
    if (chunk.length < 2) break;
    const json = await getJSON(`${endpoint}/route/v1/${profile}/${coordStr(chunk)}?overview=full&geometries=geojson&steps=false`, 30000);
    if (json.code !== 'Ok') throw new Error('Rute gagal: ' + (json.message || json.code));
    const r = json.routes[0];
    for (const l of r.legs) legs.push({ distance_meters: l.distance, duration_seconds: l.duration });
    const g = r.geometry.coordinates;
    if (geometry.length) geometry.push(...g.slice(1)); else geometry.push(...g);
  }
  return {
    legs, geometry,
    distance_meters: legs.reduce((a, l) => a + l.distance_meters, 0),
    duration_seconds: legs.reduce((a, l) => a + l.duration_seconds, 0)
  };
}

// ---------- Fallback offline (estimasi garis lurus x faktor jalan) ----------
const ROAD_FACTOR = 1.35, AVG_SPEED_MS = 30 / 3.6; // 30 km/j
export function haversineMatrix(points) {
  return points.map(a => points.map(b => haversineMeters(a.lat, a.lon, b.lat, b.lon) * ROAD_FACTOR));
}
export function estimateRoute(points) {
  const legs = [], geometry = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const d = haversineMeters(a.lat, a.lon, b.lat, b.lon) * ROAD_FACTOR;
    legs.push({ distance_meters: d, duration_seconds: d / AVG_SPEED_MS });
    if (!geometry.length) geometry.push([a.lon, a.lat]);
    geometry.push([b.lon, b.lat]);
  }
  return {
    legs, geometry,
    distance_meters: legs.reduce((s, l) => s + l.distance_meters, 0),
    duration_seconds: legs.reduce((s, l) => s + l.duration_seconds, 0)
  };
}
