const COLUMN_PATTERNS = {
  outlet_id:    [/^(kode.?outlet|id.?outlet|outlet.?code|outlet.?id|kode)$/i],
  outlet_name:  [/^(nama.?outlet|outlet.?name|customer.?name|nama.?toko|toko|nama)$/i],
  address:      [/^(alamat|address|alamat.?outlet)$/i],
  latitude:     [/^(lat|latitude|latitud|gps.?lat|y)$/i],
  longitude:    [/^(lon|lng|longitude|long|gps.?lon|gps.?long|x)$/i],
  salesman_name:[/^(salesman|nama.?salesman|sales.?id|salesman.?code|sales)$/i],
  rayon_name:   [/^(rayon|nama.?rayon|rayon.?name)$/i],
  province:     [/^(prov(insi)?|province)$/i],
  regency:      [/^(kab(upaten)?|regency|city|kota)$/i],
  district:     [/^(kec(amatan)?|district)$/i],
  village:      [/^(desa|kelurahan|village)$/i]
};

export function autoDetectColumn(header) {
  const h = String(header || '').trim();
  for (const [field, patterns] of Object.entries(COLUMN_PATTERNS))
    for (const p of patterns) if (p.test(h)) return field;
  return null;
}

export function validateRow(row, mapping) {
  const get = f => mapping[f] ? row[mapping[f]] : undefined;
  const num = v => {
    if (v == null || v === '') return NaN;
    return parseFloat(String(v).replace(',', '.'));
  };
  const lat = num(get('latitude'));
  const lon = num(get('longitude'));
  if (isNaN(lat) || isNaN(lon)) return { ok: false, reason: 'Koordinat kosong/tidak valid' };
  if (lat < -90 || lat > 90) return { ok: false, reason: 'Latitude di luar rentang' };
  if (lon < -180 || lon > 180) return { ok: false, reason: 'Longitude di luar rentang' };

  return {
    ok: true,
    normalized: {
      outlet_id: String(get('outlet_id') || '').trim() || undefined,
      outlet_name: String(get('outlet_name') || '').trim(),
      address: String(get('address') || '').trim(),
      latitude: lat, longitude: lon,
      salesman_name: String(get('salesman_name') || '').trim() || null,
      rayon_name: String(get('rayon_name') || '').trim() || null,
      province: String(get('province') || '').trim(),
      regency: String(get('regency') || '').trim(),
      district: String(get('district') || '').trim(),
      village: String(get('village') || '').trim()
    }
  };
}

export async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true, skipEmptyLines: 'greedy',
        complete: r => resolve({ rows: r.data, headers: r.meta.fields || [] }),
        error: reject
      });
    });
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return { rows, headers: rows.length ? Object.keys(rows[0]) : [] };
  }
  if (name.endsWith('.json')) {
    const data = JSON.parse(await file.text());
    if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
      const rows = data.features.map(f => ({
        ...(f.properties || {}),
        latitude: f.geometry?.coordinates?.[1],
        longitude: f.geometry?.coordinates?.[0]
      }));
      return { rows, headers: rows.length ? Object.keys(rows[0]) : [] };
    }
    const rows = Array.isArray(data) ? data : (data.outlets || data.data || []);
    return { rows, headers: rows.length ? Object.keys(rows[0]) : [] };
  }
  throw new Error('Format file tidak didukung');
}