import * as S from '../core/state.js';
import { download, fmtMeters, fmtDuration, todayISO } from '../core/utils.js';

export function exportOutletsCSV() {
  const rows = S.state.outlets.map(o => ({
    outlet_id: o.outlet_id, outlet_name: o.outlet_name, address: o.address,
    latitude: o.latitude, longitude: o.longitude,
    province: o.province, regency: o.regency, district: o.district, village: o.village,
    rayon_id: o.rayon_id || '', salesman_id: o.salesman_id || ''
  }));
  const csv = Papa.unparse(rows);
  download(`outlets_${todayISO()}.csv`, csv, 'text/csv');
}

export function exportOutletsJSON() {
  download(`outlets_${todayISO()}.json`, JSON.stringify(S.state.outlets, null, 2), 'application/json');
}

export function exportGeoJSON() {
  const features = [];
  for (const o of S.state.outlets) {
    if (o.latitude == null) continue;
    features.push({
      type: 'Feature',
      properties: {
        outlet_id: o.outlet_id, outlet_name: o.outlet_name, address: o.address,
        rayon_id: o.rayon_id, salesman_id: o.salesman_id
      },
      geometry: { type: 'Point', coordinates: [o.longitude, o.latitude] }
    });
  }
  for (const sm of S.state.salesmen) {
    if (sm.starting_point?.latitude != null) {
      features.push({
        type: 'Feature',
        properties: { type: 'start_point', salesman_id: sm.id, name: sm.salesman_name },
        geometry: { type: 'Point', coordinates: [sm.starting_point.longitude, sm.starting_point.latitude] }
      });
    }
    if (sm.ending_point?.latitude != null) {
      features.push({
        type: 'Feature',
        properties: { type: 'end_point', salesman_id: sm.id, name: sm.salesman_name },
        geometry: { type: 'Point', coordinates: [sm.ending_point.longitude, sm.ending_point.latitude] }
      });
    }
  }
  download(`routemaximist_${todayISO()}.geojson`,
    JSON.stringify({ type: 'FeatureCollection', features }, null, 2), 'application/geo+json');
}

export function exportXLSX() {
  const wb = XLSX.utils.book_new();
  const summary = [
    ['RouteMaximist — Executive Summary'],
    ['Tanggal Ekspor', todayISO()],
    ['Proyek', S.state.project?.name || '-'],
    ['Total Area', S.state.areas.length],
    ['Total Rayon', S.state.rayons.length],
    ['Total Salesman', S.state.salesmen.length],
    ['Total Outlet', S.state.outlets.length],
    ['Outlet dengan GPS valid', S.state.outlets.filter(o => o.latitude != null && o.longitude != null).length],
    ['Outlet belum ditugaskan', S.state.outlets.filter(o => !o.salesman_id).length]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Executive Summary');

  const outletRows = S.state.outlets.map(o => ({
    'Outlet ID': o.outlet_id, 'Nama': o.outlet_name, 'Alamat': o.address,
    Latitude: o.latitude, Longitude: o.longitude,
    Provinsi: o.province, Kabupaten: o.regency, Kecamatan: o.district, Desa: o.village,
    'Rayon ID': o.rayon_id || '', 'Salesman ID': o.salesman_id || ''
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(outletRows), 'Outlet Database');

  const smRows = S.state.salesmen.map(s => ({
    'Salesman ID': s.id, 'Nama': s.salesman_name, 'Rayon ID': s.rayon_id || '',
    'Start Lat': s.starting_point?.latitude ?? '', 'Start Lon': s.starting_point?.longitude ?? '',
    'Start Type': s.starting_point?.type ?? '',
    'End Lat': s.ending_point?.latitude ?? '', 'End Lon': s.ending_point?.longitude ?? '',
    'End Type': s.ending_point?.type ?? '', 'Route Mode': s.route_mode
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(smRows), 'Start & End Config');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  download(`routemaximist_${todayISO()}.xlsx`, new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }));
}

export function exportRoutePlanPDF(route) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text('RouteMaximist — Route Report', 14, 20);
  doc.setFontSize(10);
  doc.text(`Salesman: ${route.salesman_name}`, 14, 30);
  doc.text(`Tanggal: ${todayISO()}`, 14, 36);
  doc.text(`Total jarak (jalan): ${fmtMeters(route.total_distance)}`, 14, 42);
  doc.text(`Total durasi perjalanan: ${fmtDuration(route.total_duration)}`, 14, 48);
  doc.text(`Jumlah stop: ${route.stops.length}`, 14, 54);
  let y = 66;
  doc.setFontSize(11);
  doc.text('Urutan Kunjungan:', 14, y); y += 6;
  doc.setFontSize(9);
  route.stops.forEach((s, i) => {
    if (y > 275) { doc.addPage(); y = 20; }
    doc.text(`${i+1}. ${s.outlet_name} — ${fmtMeters(s.leg_distance)} / ${fmtDuration(s.leg_duration)}`, 16, y);
    y += 5;
  });
  doc.save(`route_${route.salesman_name.replace(/\s+/g,'_')}_${todayISO()}.pdf`);
}

export function exportDailyPlanPDF(plan) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text('RouteMaximist — Daily Route Plan', 14, 20);
  doc.setFontSize(10);
  doc.text(`Salesman: ${plan.salesman_name}`, 14, 28);
  doc.text(`Tanggal: ${todayISO()}`, 14, 34);
  doc.text(`Total Hari: ${plan.days.length}`, 14, 40);
  doc.text(`Total Jarak: ${fmtMeters(plan.total_distance)}`, 14, 46);
  doc.text(`Total Durasi: ${fmtDuration(plan.total_duration)}`, 14, 52);

  let y = 64;
  plan.days.forEach(day => {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setTextColor(30, 80, 200);
    doc.text(`Hari ${day.day} — ${day.stops.length} outlet — ${fmtMeters(day.totalDist)} — ${fmtDuration(day.totalDur)}`, 14, y);
    y += 6;
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    day.stops.forEach((s, i) => {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.text(`  ${i + 1}. ${s.outlet_name}  (${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)})`, 18, y);
      y += 5;
    });
    y += 4;
  });
  doc.save(`daily_plan_${plan.salesman_name.replace(/\s+/g,'_')}_${todayISO()}.pdf`);
}

export function exportDailyPlanXLSX(plan) {
  const wb = XLSX.utils.book_new();
  const summary = [
    ['RouteMaximist — Daily Route Plan'],
    ['Tanggal Ekspor', todayISO()],
    ['Salesman', plan.salesman_name],
    ['Total Hari', plan.days.length],
    ['Total Jarak (m)', plan.total_distance],
    ['Total Durasi (s)', plan.total_duration]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');

  const rows = [];
  plan.days.forEach(day => {
    day.stops.forEach((s, i) => {
      rows.push({
        'Hari': `Hari ${day.day}`,
        'Urutan': i + 1,
        'Outlet ID': s.outlet_id,
        'Nama Outlet': s.outlet_name,
        'Alamat': s.address,
        'Latitude': s.latitude,
        'Longitude': s.longitude,
        'Jarak Hari (m)': Math.round(day.totalDist),
        'Durasi Hari (s)': Math.round(day.totalDur)
      });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Daily Routes');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  download(`daily_plan_${todayISO()}.xlsx`, new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }));
}