import { escapeHtml } from '../core/utils.js';

const pin = (bg, text) => L.divIcon({
  className: 'rm-pin',
  html: `<div style="background:${bg};color:#fff;border-radius:50%;min-width:24px;height:24px;padding:0 4px;text-align:center;line-height:20px;font:700 11px sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);">${escapeHtml(text)}</div>`,
  iconSize: [24, 24], iconAnchor: [12, 12]
});

export function createMap(elId, opts = {}) {
  if (typeof L === 'undefined') {
    const el = document.getElementById(elId);
    if (el) el.innerHTML = '<div class="empty">Library peta (Leaflet) gagal dimuat. Periksa koneksi internet lalu muat ulang.</div>';
    throw new Error('Leaflet tidak tersedia');
  }
  const map = L.map(elId, { zoomControl: true }).setView(opts.center || [-2.5, 118], opts.zoom || 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
  const outletLayer = L.markerClusterGroup ? L.markerClusterGroup({ chunkedLoading: true }) : L.layerGroup();
  const pinLayer = L.featureGroup();   // start/end & nomor stop (tidak di-cluster)
  const routeLayer = L.featureGroup();
  outletLayer.addTo(map); routeLayer.addTo(map); pinLayer.addTo(map);

  return {
    map, outletLayer, routeLayer, pinLayer,
    addOutlet(o, color = '#2563eb') {
      if (typeof o.latitude !== 'number' || typeof o.longitude !== 'number') return;
      const m = L.circleMarker([o.latitude, o.longitude], { radius: 6, color, fillColor: color, fillOpacity: 0.7 });
      m.bindPopup(`<b>${escapeHtml(o.outlet_name)}</b><br>${o.latitude.toFixed(5)}, ${o.longitude.toFixed(5)}`);
      outletLayer.addLayer(m);
    },
    clearOutlets() { outletLayer.clearLayers(); },
    clearRoutes() { routeLayer.clearLayers(); pinLayer.clearLayers(); },
    drawRoute(coords, color = '#2563eb') {
      const latlngs = coords.map(c => [c[1], c[0]]); // GeoJSON [lon,lat] -> Leaflet [lat,lon]
      routeLayer.addLayer(L.polyline(latlngs, { color, weight: 4, opacity: 0.85 }));
    },
    drawStart(lat, lon, label = 'Start') {
      pinLayer.addLayer(L.marker([lat, lon], { icon: pin('#16a34a', 'S') }).bindPopup(escapeHtml(label)));
    },
    drawEnd(lat, lon, label = 'End') {
      pinLayer.addLayer(L.marker([lat, lon], { icon: pin('#dc2626', 'E') }).bindPopup(escapeHtml(label)));
    },
    drawStop(lat, lon, n, label = '') {
      pinLayer.addLayer(L.marker([lat, lon], { icon: pin('#2563eb', String(n)) }).bindPopup(`<b>#${n}</b> ${escapeHtml(label)}`));
    },
    fitToAll() {
      try {
        let b = null;
        for (const layer of [outletLayer, pinLayer, routeLayer]) {
          try {
            const lb = layer.getBounds ? layer.getBounds() : null;
            if (lb && lb.isValid()) b = b ? b.extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast());
          } catch (e) { /* layer kosong */ }
        }
        if (!b) {
          const pts = [];
          pinLayer.eachLayer(l => l.getLatLng && pts.push(l.getLatLng()));
          if (pts.length) b = L.latLngBounds(pts);
        }
        if (b && b.isValid()) map.fitBounds(b, { padding: [24, 24], maxZoom: 16 });
      } catch (e) { /* abaikan */ }
    },
    invalidate() { setTimeout(() => map.invalidateSize(), 100); },
    destroy() { try { map.remove(); } catch (e) {} }
  };
}
