import * as S from '../core/state.js';
import { download, fmtMeters, fmtDuration, todayISO, safeCell } from '../core/utils.js';

const rayonName = (id) => S.state.rayons.find(r => r.id === id)?.name || '';
const salesmanName = (id) => S.state.salesmen.find(s => s.id === id)?.salesman_name || '';
const areaOfRayon = (id) => {
  const r = S.state.rayons.find(x => x.id === id);
  return r ? (S.state.areas.find(a => a.id === r.area_id)?.name || '') : '';
};
const need = (lib, label) => { if (typeof window[lib] === 'undefined') throw new Error(`Library ${label} belum termuat (periksa koneksi internet)`); };
const clean = (o) => { const r = {}; for (const k of Object.keys(o)) r[k] = safeCell(o[k]); return r; };

function outletRows() {
  return S.state.outlets.map(o => clean({
    outlet_id: o.outlet_id, outlet_name: o.outlet_name, address: o.address,
    latitude: o.latitude, longitude: o.longitude,
    province: o.province || '', regency: o.regency || '', district: o.district || '', village: o.village || '',
    area: areaOfRayon(o.rayon_id), rayon: rayonName(o.rayon_id), salesman: salesmanName(o.salesman_id),
    visit_order: o.visit_order ?? ''
  }));
}

export function exportOutletsCSV() {
  need('Papa', 'PapaParse');
  const csv = '\uFEFF' + Papa.unparse(outletRows()); // BOM agar Excel membaca UTF-8
  download(`outlets_${todayISO()}.csv`, csv, 'text/csv;charset=utf-8');
}

export function exportOutletsJSON() {
  download(`outlets_${todayISO()}.json`, JSON.stringify(S.state.outlets, null, 2), 'application/json');
}

export function exportGeoJSON() {
  const features = [];
  for (const o of S.state.outlets) {
    if (typeof o.latitude !== 'number' || typeof o.longitude !== 'number') continue;
    features.push({
      type: 'Feature',
      properties: {
        outlet_id: o.outlet_id, outlet_name: o.outlet_name, address: o.address,
        rayon: rayonName(o.rayon_id), salesman: salesmanName(o.salesman_id), visit_order: o.visit_order ?? null
      },
      geometry: { type: 'Point', coordinates: [o.longitude, o.latitude] }
    });
  }
  for (const sm of S.state.salesmen) {
    if (sm.starting_point?.latitude != null) features.push({
      type: 'Feature', properties: { type: 'start_point', salesman_id: sm.id, name: sm.salesman_name },
      geometry: { type: 'Point', coordinates: [sm.starting_point.longitude, sm.starting_point.latitude] }
    });
    if (sm.ending_point?.latitude != null) features.push({
      type: 'Feature', properties: { type: 'end_point', salesman_id: sm.id, name: sm.salesman_name },
      geometry: { type: 'Point', coordinates: [sm.ending_point.longitude, sm.ending_point.latitude] }
    });
  }
  const route = S.state.currentRoute;
  if (route?.geometry?.length) features.push({
    type: 'Feature', properties: { type: 'route', salesman: route.salesman_name, distance_m: Math.round(route.total_distance) },
    geometry: { type: 'LineString', coordinates: route.geometry }
  });
  download(`routemaximist_${todayISO()}.geojson`,
    JSON.stringify({ type: 'FeatureCollection', features }, null, 2), 'application/geo+json');
}

export function exportXLSX() {
  need('XLSX', 'SheetJS');
  const wb = XLSX.utils.book_new();
  const O = S.state.outlets;
  const summary = [
    ['RouteMaximist — Executive Summary'],
    ['Tanggal Ekspor', todayISO()],
    ['Proyek', S.state.project?.name || '-'],
    ['Total Area', S.state.areas.length],
    ['Total Rayon', S.state.rayons.length],
    ['Total Salesman', S.state.salesmen.length],
    ['Total Outlet', O.length],
    ['Outlet dengan GPS valid', O.filter(o => typeof o.latitude === 'number' && typeof o.longitude === 'number').length],
    ['Outlet belum ditugaskan', O.filter(o => !o.salesman_id).length]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Executive Summary');

  const rows = outletRows().map(r => ({
    'Outlet ID': r.outlet_id, 'Nama': r.outlet_name, 'Alamat': r.address,
    Latitude: r.latitude, Longitude: r.longitude,
    Provinsi: r.province, Kabupaten: r.regency, Kecamatan: r.district, Desa: r.village,
    Area: r.area, Rayon: r.rayon, Salesman: r.salesman, 'Urutan Kunjungan': r.visit_order
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Outlet Database');

  const smRows = S.state.salesmen.map(s => clean({
    'Salesman ID': s.id, 'Nama': s.salesman_name, 'Rayon': rayonName(s.rayon_id),
    'Jumlah Outlet': O.filter(o => o.salesman_id === s.id).length,
    'Start Lat': s.starting_point?.latitude ?? '', 'Start Lon': s.starting_point?.longitude ?? '',
    'Start Type': s.starting_point?.type ?? '',
    'End Lat': s.ending_point?.latitude ?? '', 'End Lon': s.ending_point?.longitude ?? '',
    'Route Mode': s.route_mode
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(smRows), 'Start & End Config');

  const route = S.state.currentRoute;
  if (route) {
    const rr = route.stops.map((s, i) => clean({
      Urutan: i + 1, Outlet: s.outlet_name, Latitude: s.lat ?? '', Longitude: s.lon ?? '',
      'Jarak Leg (m)': Math.round(s.leg_distance), 'Durasi Leg (menit)': Math.round(s.leg_duration / 60)
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rr), 'Rute Terakhir');
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  download(`routemaximist_${todayISO()}.xlsx`, new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }));
}

export function exportRouteCSV(route) {
  need('Papa', 'PapaParse');
  const rows = route.stops.map((s, i) => clean({
    urutan: i + 1, outlet: s.outlet_name, latitude: s.lat ?? '', longitude: s.lon ?? '',
    jarak_leg_m: Math.round(s.leg_distance), durasi_leg_menit: Math.round(s.leg_duration / 60)
  }));
  download(`rute_${route.salesman_name.replace(/\W+/g, '_')}_${todayISO()}.csv`, '\uFEFF' + Papa.unparse(rows), 'text/csv;charset=utf-8');
}

export function exportRoutePlanPDF(route) {
  if (!window.jspdf) throw new Error('Library jsPDF belum termuat (periksa koneksi internet)');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const line = (txt, x, y) => doc.text(String(txt), x, y);
  doc.setFontSize(16); line('RouteMaximist - Route Report', 14, 20);
  doc.setFontSize(10);
  line(`Salesman: ${route.salesman_name}`, 14, 30);
  line(`Tanggal: ${todayISO()}`, 14, 36);
  line(`Total jarak: ${fmtMeters(route.total_distance)}${route.estimated ? ' (ESTIMASI garis lurus)' : ''}`, 14, 42);
  line(`Total durasi perjalanan: ${fmtDuration(route.total_duration)}`, 14, 48);
  line(`Jumlah stop: ${route.stops.length}`, 14, 54);
  if (route.mode_label) line(`Mode: ${route.mode_label}`, 14, 60);
  let y = 72;
  doc.setFontSize(11); line('Urutan Kunjungan:', 14, y); y += 7;
  doc.setFontSize(9);
  route.stops.forEach((s, i) => {
    const text = doc.splitTextToSize(`${i + 1}. ${s.outlet_name}  -  ${fmtMeters(s.leg_distance)} / ${fmtDuration(s.leg_duration)}`, 178);
    if (y + text.length * 5 > 282) { doc.addPage(); y = 20; }
    doc.text(text, 16, y);
    y += text.length * 5;
  });
  if (route.return_leg) {
    if (y > 282) { doc.addPage(); y = 20; }
    line(`Kembali ke titik awal: ${fmtMeters(route.return_leg.distance_meters)} / ${fmtDuration(route.return_leg.duration_seconds)}`, 16, y);
  }
  doc.save(`route_${route.salesman_name.replace(/\W+/g, '_')}_${todayISO()}.pdf`);
}
