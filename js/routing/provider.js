import { state } from '../core/state.js';

function profileOf() { return state.provider.profile || 'driving'; }

export async function checkProvider() {
  try {
    const p = state.provider;
    if (p.type !== 'osrm') return { ok: false, message: `Provider '${p.type}' belum diimplementasikan` };
    const url = `${p.endpoint}/route/v1/${profileOf()}/106.8,-6.2;106.81,-6.21?overview=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const j = await res.json();
    return j.code === 'Ok' ? { ok: true, message: 'Terhubung' }
                          : { ok: false, message: j.message || j.code };
  } catch (e) { return { ok: false, message: e.message }; }
}

export async function getMatrix(points) {
  const p = state.provider;
  const coords = points.map(pt => `${pt.lon},${pt.lat}`).join(';');
  const url = `${p.endpoint}/table/v1/${profileOf()}/${coords}?annotations=distance`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Matrix gagal HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 'Ok') throw new Error('Matrix gagal: ' + (json.message || json.code));
  return json.distances.map(row => row.map(v => (v == null ? Infinity : v)));
}

export async function getRoute(from, to) {
  const p = state.provider;
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${p.endpoint}/route/v1/${profileOf()}/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Route gagal HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 'Ok') throw new Error('Route gagal: ' + (json.message || json.code));
  const r = json.routes[0];
  return {
    distance_meters: r.distance,
    duration_seconds: r.duration,
    geometry: r.geometry?.coordinates || []
  };
}