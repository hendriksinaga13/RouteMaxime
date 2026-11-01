export function validateOutlet(o) {
  const lat = o.latitude, lon = o.longitude;
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return { status: 'INVALID', reason: 'GPS kosong / tidak valid' };
  if (lat < -90 || lat > 90) return { status: 'INVALID', reason: 'Latitude di luar rentang' };
  if (lon < -180 || lon > 180) return { status: 'INVALID', reason: 'Longitude di luar rentang' };
  return { status: 'VALID', reason: '' };
}

export function findDuplicateCoords(outlets) {
  const map = new Map();
  for (const o of outlets) {
    if (o.latitude == null || o.longitude == null) continue;
    const key = `${o.latitude.toFixed(6)},${o.longitude.toFixed(6)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(o.id);
  }
  const dups = [];
  for (const [k, ids] of map) if (ids.length > 1) dups.push({ key: k, ids });
  return dups;
}

export function findOutliers(outlets) {
  const valid = outlets.filter(o => o.latitude != null && o.longitude != null);
  if (valid.length < 5) return [];
  const meanLat = valid.reduce((s, o) => s + o.latitude, 0) / valid.length;
  const meanLon = valid.reduce((s, o) => s + o.longitude, 0) / valid.length;
  const dists = valid.map(o => Math.hypot(o.latitude - meanLat, o.longitude - meanLon));
  const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
  const variance = dists.reduce((s, d) => s + (d - mean) ** 2, 0) / dists.length;
  const sd = Math.sqrt(variance);
  const out = [];
  valid.forEach((o, i) => { if (sd > 0 && (dists[i] - mean) / sd > 3) out.push(o.id); });
  return out;
}