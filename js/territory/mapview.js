export function createMap(elId, opts = {}) {
  const map = L.map(elId, { zoomControl: true }).setView(opts.center || [-2.5, 118], opts.zoom || 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
  const outletLayer = L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
  const routeLayer = L.layerGroup();
  outletLayer.addTo(map); routeLayer.addTo(map);

  const circleIcon = (bg, txt) => L.divIcon({
    html: `<div style="background:${bg};color:#fff;border-radius:50%;width:26px;height:26px;
      text-align:center;line-height:26px;font-weight:bold;border:2px solid #fff;
      box-shadow:0 1px 3px rgba(0,0,0,.3)">${txt}</div>`,
    iconSize: [26, 26], className: ''
  });

  return {
    map, outletLayer, routeLayer,
    destroy() { try { map.remove(); } catch (e) {} },
    addOutlet(o) {
      if (o.latitude == null || o.longitude == null) return;
      const m = L.circleMarker([o.latitude, o.longitude], {
        radius: 6, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.7
      });
      m.bindPopup(`<b>${o.outlet_name || 'Outlet'}</b><br>
        ${Number(o.latitude).toFixed(5)}, ${Number(o.longitude).toFixed(5)}`);
      outletLayer.addLayer(m);
    },
    clearOutlets() { outletLayer.clearLayers(); },
    clearRoutes() { routeLayer.clearLayers(); },
    drawRoute(coords, color = '#2563eb') {
      if (!coords || coords.length < 2) return;
      const latlngs = coords.map(c => [c[1], c[0]]);
      routeLayer.addLayer(L.polyline(latlngs, { color, weight: 4, opacity: 0.85 }));
    },
    drawStart(lat, lon, label = '') {
      const m = L.marker([lat, lon], { icon: circleIcon('#16a34a', 'S') });
      if (label) m.bindPopup(label);
      outletLayer.addLayer(m);
    },
    drawEnd(lat, lon, label = '') {
      const m = L.marker([lat, lon], { icon: circleIcon('#dc2626', 'E') });
      if (label) m.bindPopup(label);
      outletLayer.addLayer(m);
    },
    fitToAll() {
      try {
        let b = outletLayer.getBounds ? outletLayer.getBounds() : null;
        if (!b || !b.isValid || !b.isValid()) {
          b = routeLayer.getBounds ? routeLayer.getBounds() : null;
        }
        if (b && b.isValid && b.isValid()) map.fitBounds(b, { padding: [24, 24] });
      } catch (e) {}
    },
    invalidate() { setTimeout(() => map.invalidateSize(), 100); }
  };
}