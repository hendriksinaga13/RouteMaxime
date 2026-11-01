import { parseCoord } from '../core/utils.js';

const COLUMN_PATTERNS = {
  outlet_id:   [/^(kode.?outlet|id.?outlet|outlet.?code|outlet.?id|customer.?id|kode.?toko|kode.?customer|kode|id)$/i],
  outlet_name: [/^(nama.?outlet|outlet.?name|customer.?name|nama.?toko|nama.?customer|toko|outlet|nama|name)$/i],
  address:     [/^(alamat|address|alamat.?outlet|alamat.?toko)$/i],
  latitude:    [/^(lat|latitude|latitud|gps.?lat|lintang|y)$/i],
  longitude:   [/^(lon|lng|long|longitude|gps.?lon|gps.?long|gps.?lng|bujur|x)$/i],
  salesman_name:[/^(salesman|nama.?salesman|sales.?name|sales.?id|salesman.?code|sales)$/i],
  rayon_name:  [/^(rayon|nama.?rayon|rayon.?name|kode.?rayon)$/i],
  province:    [/^(provinsi|province|prov)$/i],
  regency:     [/^(kabupaten|kab|kota|regency|city|kab.?kota)$/i],
  district:    [/^(kecamatan|kec|district|subdistrict)$/i],
  village:     [/^(desa|kelurahan|village|desa.?kelurahan|kel)$/i]
};

export function autoDetectColumn(header) {
  const h = String(header || '').trim();
  for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
    for (const p of patterns) if (p.test(h)) return field;
  }
  return null;
}

const MAX_BYTES = 40 * 1024 * 1024;

export async function parseFile(file) {
  if (file.size > MAX_BYTES) throw new Error('Ukuran file terlalu besar (maks 40 MB)');
  const name = file.name.toLowerCase();
  const clean = (h) => String(h ?? '').replace(/^\uFEFF/, '').trim();

  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    if (typeof Papa === 'undefined') throw new Error('Library PapaParse gagal dimuat (periksa koneksi internet)');
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true, skipEmptyLines: 'greedy', transformHeader: clean,
        complete: r => resolve({ rows: r.data, headers: (r.meta.fields || []).filter(Boolean) }),
        error: reject
      });
    });
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    if (typeof XLSX === 'undefined') throw new Error('Library SheetJS gagal dimuat (periksa koneksi internet)');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const rows = raw.map(r => { const o = {}; for (const k of Object.keys(r)) o[clean(k)] = r[k]; return o; });
    return { rows, headers: rows.length ? Object.keys(rows[0]) : [] };
  }
  if (name.endsWith('.json') || name.endsWith('.geojson')) {
    const data = JSON.parse(await file.text());
    let list = Array.isArray(data) ? data : (data.features || data.outlets || []);
    const rows = list.map(it => {
      if (it && it.type === 'Feature') { // GeoJSON: ratakan properti + koordinat
        const c = it.geometry && it.geometry.type === 'Point' ? it.geometry.coordinates : [];
        return { ...(it.properties || {}), longitude: c[0] ?? '', latitude: c[1] ?? '' };
      }
      return it;
    }).filter(r => r && typeof r === 'object');
    const set = new Set(); rows.slice(0, 200).forEach(r => Object.keys(r).forEach(k => set.add(k)));
    return { rows, headers: [...set] };
  }
  throw new Error('Format file tidak didukung (gunakan CSV, XLSX, XLS, JSON, GeoJSON)');
}

const str = (v) => (v == null ? '' : String(v).trim());

// Validasi + normalisasi satu baris. Mengembalikan { ok, normalized } atau { ok:false, reason }.
export function validateRow(row, mapping) {
  const get = (f) => (mapping[f] ? row[mapping[f]] : undefined);
  let lat = parseCoord(get('latitude'));
  let lon = parseCoord(get('longitude'));
  if (lat == null || lon == null) return { ok: false, reason: 'GPS kosong / bukan angka' };

  let swapped = false;
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) { [lat, lon] = [lon, lat]; swapped = true; } // lat/lon tertukar
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { ok: false, reason: 'Koordinat di luar rentang' };
  if (lat === 0 && lon === 0) return { ok: false, reason: 'Koordinat 0,0' };

  const outlet_id = str(get('outlet_id'));
  const outlet_name = str(get('outlet_name'));
  if (!outlet_id && !outlet_name) return { ok: false, reason: 'Kode & nama outlet kosong' };

  return {
    ok: true,
    normalized: {
      outlet_id, outlet_name: outlet_name || outlet_id,
      address: str(get('address')), latitude: lat, longitude: lon,
      salesman_name: str(get('salesman_name')), rayon_name: str(get('rayon_name')),
      province: str(get('province')), regency: str(get('regency')),
      district: str(get('district')), village: str(get('village')),
      swapped
    }
  };
}
