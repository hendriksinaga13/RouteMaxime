export function validateOutlet(o) {
  const lat = o.latitude, lon = o.longitude;
  if (lat == null || lon == null || typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { status: 'INVALID', reason: 'GPS kosong / tidak valid' };
  }
  if (lat < -90 || lat > 90) return { status: 'INVALID', reason: 'Latitude di luar rentang' };
  if (lon < -180 || lon > 180) return { status: 'INVALID', reason: 'Longitude di luar rentang' };
  if (lat === 0 && lon === 0) return { status: 'INVALID', reason: 'Koordinat 0,0 (GPS belum terisi)' };
  return { status: 'VALID', reason: '' };
}

export function findDuplicateCoords(outlets) {
  const map = new Map();
  for (const o of outlets) {
    if (typeof o.latitude !== 'number' || typeof o.longitude !== 'number') continue;
    const key = `${o.latitude.toFixed(6)},${o.longitude.toFixed(6)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(o.id);
  }
  const dups = [];
  for (const [k, ids] of map) if (ids.length > 1) dups.push({ key: k, ids });
  return dups;
}

// Outlier berbasis jarak ke MEDIAN (robust). Rata-rata/SD klasik bisa "tertarik" oleh outlier itu sendiri.
export function findOutliers(outlets) {
  const valid = outlets.filter(o => validateOutlet(o).status === 'VALID');
  if (valid.length < 5) return [];
  const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const medLat = median(valid.map(o => o.latitude));
  const medLon = median(valid.map(o => o.longitude));
  const kx = Math.cos(medLat * Math.PI / 180);
  const dists = valid.map(o => Math.hypot(o.latitude - medLat, (o.longitude - medLon) * kx));
  const medD = median(dists);
  const mad = median(dists.map(d => Math.abs(d - medD)));
  const scale = mad > 0 ? mad * 1.4826 : (medD > 0 ? medD : 0);
  if (scale === 0) return [];
  const out = [];
  valid.forEach((o, i) => { if ((dists[i] - medD) / scale > 6) out.push(o.id); });
  return out;
}
