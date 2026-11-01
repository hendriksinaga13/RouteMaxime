import * as DB from './core/db.js';
import * as S from './core/state.js';
import { navigate, defineRoute, startRouter, renderNav } from './core/router.js';
import { uuid, toast, modal, confirmDialog, escapeHtml, fmtNum, fmtMeters,
  fmtDuration, todayISO, download, haversineMeters } from './core/utils.js';
import * as Imp from './import/importer.js';
import * as GPS from './gps/validator.js';
import * as M from './organization/managers.js';
import * as MapV from './territory/mapview.js';
import * as Routing from './routing/provider.js';
import * as Opt from './optimization/engine.js';
import * as MD from './optimization/multiday.js';
import * as Exp from './export/exporter.js';

let currentRouteMap = null;

// ---- NAV ----
const NAV = [
  { section: 'Ringkasan', items: [{ path: '/dashboard', label: 'Executive Dashboard' }] },
  { section: 'Data', items: [
    { path: '/outlets', label: 'Outlet Database' },
    { path: '/import', label: 'Universal Import' },
    { path: '/gps', label: 'GPS Validation' }
  ]},
  { section: 'Organisasi', items: [
    { path: '/areas', label: 'Area Management' },
    { path: '/rayons', label: 'Rayon Management' },
    { path: '/salesmen', label: 'Salesman Management' }
  ]},
  { section: 'Rute', items: [
    { path: '/startpoints', label: 'Multi-Start Point' },
    { path: '/optimize', label: 'Route Optimization' },
    { path: '/daily-plan', label: '📅 Daily Route Planner' }
  ]},
  { section: 'Lainnya', items: [
    { path: '/export', label: 'Export Center' },
    { path: '/history', label: 'History / Audit' },
    { path: '/settings', label: 'Settings' }
  ]}
];

// ---- INIT ----
async function init() {
  await DB.openDB();
  await S.loadProvider();
  await ensureFirstProject();
  renderNav(document.getElementById('nav'), NAV);
  await refreshProjectSelector();
  document.getElementById('menu-toggle').onclick = () =>
    document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('btn-new-project').onclick = newProjectDialog;
  document.getElementById('project-selector').onchange = async (e) => {
    await S.loadProjectData(e.target.value);
    navigate('/dashboard');
  };
  registerRoutes();
  await startRouter();
  refreshProviderStatus();
  setInterval(refreshProviderStatus, 30000);
}

async function refreshProviderStatus() {
  const el = document.getElementById('provider-status');
  el.textContent = 'Provider: memeriksa…';
  el.className = 'status-pill status-warn';
  const r = await Routing.checkProvider();
  if (r.ok) {
    el.textContent = `Provider: ${S.state.provider.type.toUpperCase()} ✓`;
    el.className = 'status-pill status-ok';
  } else {
    el.textContent = `Provider: OFFLINE (${r.message})`;
    el.className = 'status-pill status-error';
  }
}

async function ensureFirstProject() {
  const projects = await DB.dbAll('projects');
  if (projects.length === 0) {
    const p = { id: uuid('PRJ'), name: 'Proyek Demo', created_at: Date.now() };
    await DB.dbPut('projects', p);
    await S.loadProjectData(p.id);
  } else {
    await S.loadProjectData(projects[0].id);
  }
}

async function refreshProjectSelector() {
  const projects = await DB.dbAll('projects');
  const sel = document.getElementById('project-selector');
  sel.innerHTML = projects.map(p =>
    `<option value="${p.id}" ${p.id === S.state.projectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');
}

async function newProjectDialog() {
  modal({
    title: 'Proyek Baru',
    body: `
      <div class="form-row"><label>Nama Proyek</label>
        <input type="text" id="prj-name" placeholder="Contoh: Distribusi Area Mukomuko"></div>
      <div class="form-actions">
        <button class="btn" id="prj-cancel">Batal</button>
        <button class="btn btn-primary" id="prj-create">Buat</button>
      </div>`,
    onMount: (body, closeFn) => {
      body.querySelector('#prj-cancel').onclick = closeFn;
      body.querySelector('#prj-create').onclick = async () => {
        const name = body.querySelector('#prj-name').value.trim();
        if (!name) return toast('Nama wajib diisi', 'error');
        const p = { id: uuid('PRJ'), name, created_at: Date.now() };
        await DB.dbPut('projects', p);
        await refreshProjectSelector();
        await S.loadProjectData(p.id);
        closeFn();
        toast('Proyek dibuat', 'success');
        navigate('/dashboard');
      };
    }
  });
}

// ================================================================
// ROUTES
// ================================================================
function registerRoutes() {

  // ---------------- DASHBOARD ----------------
  defineRoute('/dashboard', { title: 'Executive Dashboard', render: async (el) => {
    const o = S.state.outlets, sm = S.state.salesmen, r = S.state.rayons, a = S.state.areas;
    const valid = o.filter(x => x.latitude != null && x.longitude != null).length;
    const invalid = o.length - valid;
    const unassigned = o.filter(x => !x.salesman_id).length;
    const assigned = o.length - unassigned;
    el.innerHTML = `
      <div class="grid grid-4 mb-12">
        ${kpi('Total Outlet', fmtNum(o.length), `${assigned} ditugaskan`)}
        ${kpi('GPS Valid', fmtNum(valid), `${invalid} bermasalah`, 'success')}
        ${kpi('Salesman', fmtNum(sm.length), `${r.length} rayon / ${a.length} area`)}
        ${kpi('Belum Ditugaskan', fmtNum(unassigned), 'outlet tanpa salesman', unassigned > 0 ? 'warning' : '')}
      </div>
      <div class="card">
        <div class="card-title">Distribusi Outlet per Salesman</div>
        ${barChart(sm.map(s => ({
          label: s.salesman_name,
          value: o.filter(x => x.salesman_id === s.id).length
        })))}
      </div>
      <div class="card">
        <div class="card-title">Status GPS</div>
        <div class="grid grid-3">
          ${kpi('VALID', fmtNum(valid), '', 'success')}
          ${kpi('INVALID / MISSING', fmtNum(invalid), '', 'danger')}
          ${kpi('Coverage', o.length ? fmtNum(valid / o.length * 100, 1) + '%' : '—', '')}
        </div>
      </div>`;
  }});

  // ---------------- OUTLET DATABASE ----------------
  defineRoute('/outlets', { title: 'Outlet Database', render: async (el) => {
    const outlets = S.state.outlets;
    el.innerHTML = `
      <div class="card flex justify-between items-center">
        <div class="muted">${outlets.length} outlet. Penugasan dilakukan manual oleh administrator.</div>
        <div class="flex gap-8"><button class="btn btn-sm" id="add-outlet">+ Outlet</button></div>
      </div>
      <div class="table-wrap">
        <table><thead><tr>
          <th>Kode</th><th>Nama</th><th>GPS</th><th>Status</th><th>Rayon</th><th>Salesman</th><th></th>
        </tr></thead><tbody>
          ${outlets.length === 0 ? `<tr><td colspan="7" class="empty">Belum ada outlet. Impor data terlebih dahulu.</td></tr>` :
            outlets.map(o => {
              const v = GPS.validateOutlet(o);
              return `<tr>
                <td class="mono">${escapeHtml(o.outlet_id)}</td>
                <td>${escapeHtml(o.outlet_name)}</td>
                <td class="mono">${o.latitude != null ? `${o.latitude.toFixed(5)}, ${o.longitude.toFixed(5)}` : '—'}</td>
                <td>${statusPill(v.status)}</td>
                <td>${rayonName(o.rayon_id)}</td>
                <td>${salesmanName(o.salesman_id)}</td>
                <td class="text-right">
                  <button class="btn btn-sm" data-edit="${o.id}">Edit</button>
                  <button class="btn btn-sm" data-assign="${o.id}">Assign</button>
                </td>
              </tr>`;
            }).join('')}
        </tbody></table>
      </div>`;
    el.querySelector('#add-outlet').onclick = () => outletFormDialog();
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => outletFormDialog(b.dataset.edit));
    el.querySelectorAll('[data-assign]').forEach(b => b.onclick = () => assignOutletDialog(b.dataset.assign));
  }});

  // ---------------- IMPORT ----------------
  defineRoute('/import', { title: 'Universal Import', render: async (el) => {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Upload Berkas</div>
        <p class="muted mb-12">Format: CSV, XLSX, XLS, JSON, GeoJSON. Kolom dideteksi otomatis.</p>
        <input type="file" id="file-input" accept=".csv,.xlsx,.xls,.json,.txt">
      </div>
      <div id="import-result"></div>`;
    el.querySelector('#file-input').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const { rows, headers } = await Imp.parseFile(f);
        renderImportPreview(el.querySelector('#import-result'), rows, headers);
      } catch (err) {
        toast('Gagal membaca file: ' + err.message, 'error');
      }
    };
  }});

  // ---------------- GPS VALIDATION ----------------
  defineRoute('/gps', { title: 'GPS Validation Center', render: async (el) => {
    const outlets = S.state.outlets;
    const dups = GPS.findDuplicateCoords(outlets);
    const outliers = new Set(GPS.findOutliers(outlets));
    const dupIds = new Set(dups.flatMap(d => d.ids));
    el.innerHTML = `
      <div class="card">
        <div class="grid grid-4">
          ${kpi('Total', outlets.length, '')}
          ${kpi('Valid', outlets.filter(o => GPS.validateOutlet(o).status === 'VALID').length, '', 'success')}
          ${kpi('Duplicate Coord', dupIds.size, '', dupIds.size > 0 ? 'warning' : '')}
          ${kpi('Outlier', outliers.size, '', outliers.size > 0 ? 'warning' : '')}
        </div>
      </div>
      <div class="table-wrap">
        <table><thead><tr>
          <th>Outlet</th><th>GPS</th><th>Status</th><th>Catatan</th><th></th>
        </tr></thead><tbody>
          ${outlets.map(o => {
            const v = GPS.validateOutlet(o);
            const notes = [];
            if (dupIds.has(o.id)) notes.push('Koordinat duplikat');
            if (outliers.has(o.id)) notes.push('Outlier geografis');
            return `<tr>
              <td>${escapeHtml(o.outlet_name)}</td>
              <td class="mono">${o.latitude != null ? `${o.latitude.toFixed(6)}, ${o.longitude.toFixed(6)}` : '—'}</td>
              <td>${statusPill(v.status)}</td>
              <td class="muted">${notes.join(' • ') || v.reason || '—'}</td>
              <td><button class="btn btn-sm" data-fix="${o.id}">Koreksi</button></td>
            </tr>`;
          }).join('')}
        </tbody></table>
      </div>`;
    el.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => correctGPSDialog(b.dataset.fix));
  }});

  // ---------------- AREAS ----------------
  defineRoute('/areas', { title: 'Area Management', render: async (el) => {
    el.innerHTML = `
      <div class="card flex justify-between items-center">
        <div class="muted">${S.state.areas.length} area</div>
        <button class="btn btn-primary btn-sm" id="add-area">+ Area</button>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>Nama</th><th>Kode</th><th>Rayon</th><th></th></tr></thead><tbody>
          ${S.state.areas.map(a => `
            <tr>
              <td>${escapeHtml(a.name)}</td>
              <td class="mono">${escapeHtml(a.code)}</td>
              <td>${S.state.rayons.filter(r => r.area_id === a.id).length}</td>
              <td><button class="btn btn-sm btn-danger" data-del="${a.id}">Hapus</button></td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty">Belum ada area</td></tr>'}
        </tbody></table>
      </div>`;
    el.querySelector('#add-area').onclick = () => {
      modal({
        title: 'Area Baru',
        body: `<div class="form-row"><label>Nama Area</label><input id="an"></div>
               <div class="form-row"><label>Kode</label><input id="ac"></div>
               <div class="form-actions"><button class="btn" id="x">Batal</button>
                 <button class="btn btn-primary" id="y">Simpan</button></div>`,
        onMount: (b, close) => {
          b.querySelector('#x').onclick = close;
          b.querySelector('#y').onclick = async () => {
            const name = b.querySelector('#an').value.trim();
            if (!name) return toast('Nama wajib', 'error');
            await M.createArea({ name, code: b.querySelector('#ac').value.trim() });
            close(); navigate('/areas');
          };
        }
      });
    };
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (await confirmDialog('Hapus area ini?')) {
        await M.deleteArea(b.dataset.del); navigate('/areas');
      }
    });
  }});

  // ---------------- RAYONS ----------------
  defineRoute('/rayons', { title: 'Rayon Management', render: async (el) => {
    el.innerHTML = `
      <div class="card flex justify-between items-center">
        <div class="muted">${S.state.rayons.length} rayon. Pembentukan rayon adalah wewenang administrator.</div>
        <button class="btn btn-primary btn-sm" id="add-rayon">+ Rayon</button>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>Nama</th><th>Area</th><th>Salesman</th><th>Outlet</th><th>Status</th></tr></thead><tbody>
          ${S.state.rayons.map(r => `
            <tr>
              <td>${escapeHtml(r.name)}</td>
              <td>${areaName(r.area_id)}</td>
              <td>${S.state.salesmen.filter(s => s.rayon_id === r.id).length}</td>
              <td>${S.state.outlets.filter(o => o.rayon_id === r.id).length}</td>
              <td>${r.locked ? statusPill('LOCKED') : statusPill('OPEN')}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="empty">Belum ada rayon</td></tr>'}
        </tbody></table>
      </div>`;
    el.querySelector('#add-rayon').onclick = () => {
      modal({
        title: 'Rayon Baru',
        body: `<div class="form-row"><label>Nama Rayon</label><input id="rn"></div>
               <div class="form-row"><label>Area</label><select id="ra">
                 <option value="">— pilih —</option>
                 ${S.state.areas.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
               </select></div>
               <div class="form-actions"><button class="btn" id="x">Batal</button>
                 <button class="btn btn-primary" id="y">Simpan</button></div>`,
        onMount: (b, close) => {
          b.querySelector('#x').onclick = close;
          b.querySelector('#y').onclick = async () => {
            const name = b.querySelector('#rn').value.trim();
            if (!name) return toast('Nama wajib', 'error');
            await M.createRayon({ name, area_id: b.querySelector('#ra').value || null });
            close(); navigate('/rayons');
          };
        }
      });
    };
  }});

  // ---------------- SALESMEN ----------------
  defineRoute('/salesmen', { title: 'Salesman Management', render: async (el) => {
    el.innerHTML = `
      <div class="card flex justify-between items-center">
        <div class="muted">${S.state.salesmen.length} salesman</div>
        <button class="btn btn-primary btn-sm" id="add-sm">+ Salesman</button>
      </div>
      <div class="table-wrap">
        <table><thead><tr>
          <th>Nama</th><th>Rayon</th><th>Outlet</th><th>Start</th><th>End</th><th>Mode</th><th></th>
        </tr></thead><tbody>
          ${S.state.salesmen.map(s => `
            <tr>
              <td>${escapeHtml(s.salesman_name)}</td>
              <td>${rayonName(s.rayon_id)}</td>
              <td>${S.state.outlets.filter(o => o.salesman_id === s.id).length}</td>
              <td class="mono">${s.starting_point?.latitude != null ? `${s.starting_point.latitude.toFixed(4)}, ${s.starting_point.longitude.toFixed(4)}` : '—'}</td>
              <td class="mono">${s.ending_point?.latitude != null ? `${s.ending_point.latitude.toFixed(4)}, ${s.ending_point.longitude.toFixed(4)}` : '—'}</td>
              <td>${s.route_mode}</td>
              <td><button class="btn btn-sm" data-cfg="${s.id}">Konfigurasi</button></td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">Belum ada salesman</td></tr>'}
        </tbody></table>
      </div>`;
    el.querySelector('#add-sm').onclick = () => salesmanFormDialog();
    el.querySelectorAll('[data-cfg]').forEach(b => b.onclick = () => salesmanConfigDialog(b.dataset.cfg));
  }});

  // ---------------- MULTI-START POINT ----------------
  defineRoute('/startpoints', { title: 'Multi-Start Point', render: async (el) => {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Konfigurasi Titik Awal & Akhir</div>
        <p class="muted mb-12">Setiap salesman memiliki titik awal dan akhir independen.</p>
        <div class="grid grid-2">
          ${S.state.salesmen.map(s => `
            <div class="card" style="margin:0">
              <b>${escapeHtml(s.salesman_name)}</b>
              <div class="muted" style="font-size:12px">Mode: ${s.route_mode}</div>
              <div class="mt-16">
                <div><b>Start:</b> ${s.starting_point?.latitude != null ?
                  `<span class="mono">${s.starting_point.latitude.toFixed(5)}, ${s.starting_point.longitude.toFixed(5)}</span>` : '<span class="text-danger">Belum diatur</span>'}</div>
                <div><b>End:</b> ${s.ending_point?.latitude != null ?
                  `<span class="mono">${s.ending_point.latitude.toFixed(5)}, ${s.ending_point.longitude.toFixed(5)}</span>` :
                  (s.route_mode === 'open_route' ? '<i>Open route</i>' : s.route_mode === 'round_trip' ? '<i>Sama dengan start</i>' : '<span class="text-danger">Belum diatur</span>')}</div>
              </div>
              <button class="btn btn-sm mt-16" data-edit="${s.id}">Atur Start & End</button>
            </div>`).join('') || '<div class="empty">Belum ada salesman</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-title">Peta Titik Awal & Akhir</div>
        <div id="start-map" class="map-container"></div>
      </div>`;
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => salesmanConfigDialog(b.dataset.edit));
    setTimeout(() => {
      const elMap = document.getElementById('start-map');
      if (!elMap) return;
      if (currentRouteMap) { currentRouteMap.destroy(); currentRouteMap = null; }
      currentRouteMap = MapV.createMap('start-map');
      S.state.salesmen.forEach(s => {
        if (s.starting_point?.latitude != null) currentRouteMap.drawStart(s.starting_point.latitude, s.starting_point.longitude, `Start: ${s.salesman_name}`);
        if (s.ending_point?.latitude != null) currentRouteMap.drawEnd(s.ending_point.latitude, s.ending_point.longitude, `End: ${s.salesman_name}`);
      });
      S.state.outlets.forEach(o => { if (o.latitude != null) currentRouteMap.addOutlet(o); });
      currentRouteMap.fitToAll();
    }, 100);
  }});

  // ---------------- OPTIMIZE ----------------
  defineRoute('/optimize', { title: 'Route Optimization', render: async (el) => {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Pilih Salesman & Jalankan Optimasi</div>
        <div class="grid grid-2">
          <div class="form-row">
            <label>Salesman</label>
            <select id="opt-sm">
              <option value="">— pilih —</option>
              ${S.state.salesmen.map(s => `<option value="${s.id}">${escapeHtml(s.salesman_name)} (${S.state.outlets.filter(o => o.salesman_id === s.id).length} outlet)</option>`).join('')}
            </select>
          </div>
          <div class="form-row" style="display:flex;align-items:flex-end">
            <button class="btn btn-primary btn-block" id="run-opt">Jalankan Optimasi Rute</button>
          </div>
        </div>
        <div class="muted" style="font-size:12px">
          ℹ️ Optimasi memakai OSRM untuk jarak jalan sebenarnya. Nearest Neighbor + 2-opt.
        </div>
      </div>
      <div id="opt-result"></div>
      <div class="card"><div class="card-title">Peta Rute</div><div id="route-map" class="map-container map-lg"></div></div>`;

    el.querySelector('#run-opt').onclick = async () => {
      const smId = el.querySelector('#opt-sm').value;
      if (!smId) return toast('Pilih salesman terlebih dahulu', 'error');
      const btn = el.querySelector('#run-opt');
      btn.disabled = true;
      try {
        await runOptimization(smId, el.querySelector('#opt-result'), el.querySelector('#route-map'));
      } finally { btn.disabled = false; }
    };
    setTimeout(() => {
      const elMap = document.getElementById('route-map');
      if (!elMap) return;
      if (currentRouteMap) { currentRouteMap.destroy(); currentRouteMap = null; }
      currentRouteMap = MapV.createMap('route-map');
      S.state.outlets.forEach(o => { if (o.latitude != null) currentRouteMap.addOutlet(o); });
      currentRouteMap.fitToAll();
    }, 100);
  }});

  // ---------------- DAILY ROUTE PLANNER ----------------
  defineRoute('/daily-plan', { title: 'Daily Route Planner', render: async (el) => {
    const smWithOutlets = S.state.salesmen.map(s => ({
      ...s,
      validCount: S.state.outlets.filter(o =>
        o.salesman_id === s.id && o.latitude != null && o.longitude != null).length
    })).filter(s => s.validCount > 0);

    el.innerHTML = `
      <div class="card">
        <div class="card-title">📅 Rancang Rute Harian Otomatis</div>
        <p class="muted mb-12">
          Tentukan berapa toko maksimal yang dapat dikunjungi salesman per hari. Sistem akan
          membagi outlet ke beberapa hari kerja secara geografis seimbang, lalu mengoptimalkan
          urutan kunjungan tiap hari secara independen.
        </p>
        <div class="grid grid-3">
          <div class="form-row">
            <label>Salesman</label>
            <select id="dp-sm">
              <option value="">— pilih —</option>
              ${smWithOutlets.map(s => `<option value="${s.id}">${escapeHtml(s.salesman_name)} (${s.validCount} outlet)</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <label>Maks. Toko / Hari</label>
            <input type="number" id="dp-max" value="8" min="1" max="100">
          </div>
          <div class="form-row" style="display:flex;align-items:flex-end">
            <button class="btn btn-primary btn-block" id="run-dp">🚀 Rancang Rute</button>
          </div>
        </div>
        <div class="muted" style="font-size:12px">
          ℹ️ Jumlah hari = ⌈total_outlet ÷ maks_per_hari⌉. Setiap hari dimulai dari Start Point
          dan berakhir sesuai mode rute salesman.
        </div>
      </div>
      <div id="dp-result"></div>
      <div class="card"><div class="card-title">Peta Rute Harian</div>
        <div id="dp-map" class="map-container map-lg"></div></div>`;

    el.querySelector('#run-dp').onclick = async () => {
      const smId = el.querySelector('#dp-sm').value;
      const maxPerDay = parseInt(el.querySelector('#dp-max').value) || 8;
      if (!smId) return toast('Pilih salesman dulu', 'error');
      if (maxPerDay < 1) return toast('Maksimal toko/hari minimal 1', 'error');
      const btn = el.querySelector('#run-dp');
      btn.disabled = true;
      try {
        await runDailyPlan(smId, maxPerDay,
          el.querySelector('#dp-result'), el.querySelector('#dp-map'));
      } finally { btn.disabled = false; }
    };

    setTimeout(() => {
      const elMap = document.getElementById('dp-map');
      if (!elMap) return;
      if (currentRouteMap) { currentRouteMap.destroy(); currentRouteMap = null; }
      currentRouteMap = MapV.createMap('dp-map');
      S.state.outlets.forEach(o => { if (o.latitude != null) currentRouteMap.addOutlet(o); });
      currentRouteMap.fitToAll();
    }, 100);
  }});

  // ---------------- EXPORT ----------------
  defineRoute('/export', { title: 'Export Center', render: async (el) => {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Ekspor Data Proyek: ${escapeHtml(S.state.project?.name || '')}</div>
        <div class="grid grid-3">
          <button class="btn" id="ex-xlsx">📊 XLSX (Multi-sheet)</button>
          <button class="btn" id="ex-csv">📄 CSV Outlets</button>
          <button class="btn" id="ex-json">🗂️ JSON</button>
          <button class="btn" id="ex-geojson">🌍 GeoJSON</button>
          <button class="btn" id="ex-pdf">📕 PDF Route (dari route terakhir)</button>
          <button class="btn" id="ex-backup">💾 Backup Full JSON</button>
        </div>
      </div>`;
    el.querySelector('#ex-xlsx').onclick = () => Exp.exportXLSX();
    el.querySelector('#ex-csv').onclick = () => Exp.exportOutletsCSV();
    el.querySelector('#ex-json').onclick = () => Exp.exportOutletsJSON();
    el.querySelector('#ex-geojson').onclick = () => Exp.exportGeoJSON();
    el.querySelector('#ex-pdf').onclick = () => {
      if (!S.state.currentRoute) return toast('Belum ada route. Jalankan optimasi dulu.', 'error');
      if (S.state.currentRoute.type === 'daily_plan') {
        Exp.exportDailyPlanPDF(S.state.currentRoute);
      } else {
        Exp.exportRoutePlanPDF(S.state.currentRoute);
      }
    };
    el.querySelector('#ex-backup').onclick = async () => {
      const all = {
        project: S.state.project,
        areas: S.state.areas, rayons: S.state.rayons,
        salesmen: S.state.salesmen, outlets: S.state.outlets,
        exported_at: new Date().toISOString()
      };
      download(`routemaximist_backup_${todayISO()}.json`, JSON.stringify(all, null, 2), 'application/json');
    };
  }});

  // ---------------- HISTORY ----------------
  defineRoute('/history', { title: 'History & Audit Log', render: async (el) => {
    const log = (await DB.dbByIndex('audit_log', 'project_id', S.state.projectId))
      .sort((a, b) => b.ts - a.ts).slice(0, 200);
    el.innerHTML = `
      <div class="table-wrap">
        <table><thead><tr><th>Waktu</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead><tbody>
          ${log.length === 0 ? '<tr><td colspan="4" class="empty">Belum ada riwayat</td></tr>' :
            log.map(l => `<tr>
              <td class="mono">${new Date(l.ts).toLocaleString('id-ID')}</td>
              <td>${escapeHtml(l.action)}</td>
              <td>${escapeHtml(l.entity)}</td>
              <td class="mono" style="font-size:11px">${escapeHtml(JSON.stringify(l.details || {}).slice(0, 80))}</td>
            </tr>`).join('')}
        </tbody></table>
      </div>`;
  }});

  // ---------------- SETTINGS ----------------
  defineRoute('/settings', { title: 'Settings', render: async (el) => {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Routing Provider</div>
        <div class="form-row"><label>Provider</label>
          <select id="set-type">
            <option value="osrm" ${S.state.provider.type==='osrm'?'selected':''}>OSRM</option>
            <option value="graphhopper" ${S.state.provider.type==='graphhopper'?'selected':''}>GraphHopper (NOT IMPLEMENTED)</option>
            <option value="openrouteservice" ${S.state.provider.type==='openrouteservice'?'selected':''}>OpenRouteService (NOT IMPLEMENTED)</option>
          </select></div>
        <div class="form-row"><label>Endpoint URL</label>
          <input type="text" id="set-endpoint" value="${escapeHtml(S.state.provider.endpoint)}"></div>
        <div class="form-row"><label>Profile</label>
          <select id="set-profile">
            <option value="driving" ${S.state.provider.profile==='driving'?'selected':''}>driving</option>
            <option value="walking" ${S.state.provider.profile==='walking'?'selected':''}>walking</option>
            <option value="cycling" ${S.state.provider.profile==='cycling'?'selected':''}>cycling</option>
          </select></div>
        <button class="btn btn-primary" id="set-save">Simpan</button>
        <div class="muted mt-16" style="font-size:12px">
          ⚠️ Endpoint public OSRM (<code>router.project-osrm.org</code>) hanya untuk pengujian.
          Untuk production gunakan instance berlisensi / self-hosted. API secret key TIDAK boleh
          disimpan di frontend — gunakan backend proxy.
        </div>
      </div>`;
    el.querySelector('#set-save').onclick = async () => {
      await S.saveProvider({
        type: el.querySelector('#set-type').value,
        endpoint: el.querySelector('#set-endpoint').value.trim(),
        profile: el.querySelector('#set-profile').value
      });
      toast('Pengaturan disimpan', 'success');
      refreshProviderStatus();
    };
  }});
}

// ================================================================
// HELPERS & COMPONENTS
// ================================================================
function kpi(label, value, sub = '', tone = '') {
  return `<div class="kpi">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : ''}">${value}</div>
    <div class="kpi-sub">${sub}</div>
  </div>`;
}
function statusPill(status) {
  const map = { VALID: 'ok', INVALID: 'error', DUPLICATE: 'warn', SUSPICIOUS: 'warn',
    UNROUTABLE: 'error', LOCKED: 'ok', OPEN: 'muted', UNASSIGNED: 'muted' };
  return `<span class="status-pill status-${map[status] || 'muted'}">${status}</span>`;
}
function areaName(id) { return S.state.areas.find(a => a.id === id)?.name || '—'; }
function rayonName(id) { return S.state.rayons.find(r => r.id === id)?.name || '—'; }
function salesmanName(id) { return S.state.salesmen.find(s => s.id === id)?.salesman_name || '—'; }

function barChart(data) {
  if (!data.length) return `<div class="empty">Tidak ada data</div>`;
  const max = Math.max(...data.map(d => d.value), 1);
  return `<div>${data.map(d => `
    <div style="margin-bottom:8px">
      <div class="flex justify-between" style="font-size:12px">
        <span>${escapeHtml(d.label)}</span><b>${d.value}</b></div>
      <div class="progress-bar"><div class="progress-fill" style="width:${d.value/max*100}%"></div></div>
    </div>`).join('')}</div>`;
}

// ---- Outlet form ----
function outletFormDialog(id) {
  const o = id ? S.state.outlets.find(x => x.id === id) : {};
  modal({
    title: id ? 'Edit Outlet' : 'Outlet Baru',
    body: `
      <div class="form-row"><label>Nama Outlet</label><input id="on" value="${escapeHtml(o.outlet_name || '')}"></div>
      <div class="form-row"><label>Alamat</label><input id="oa" value="${escapeHtml(o.address || '')}"></div>
      <div class="grid grid-2">
        <div class="form-row"><label>Latitude</label><input id="olat" type="number" step="any" value="${o.latitude ?? ''}"></div>
        <div class="form-row"><label>Longitude</label><input id="olon" type="number" step="any" value="${o.longitude ?? ''}"></div>
      </div>
      <div class="form-actions">
        ${id ? `<button class="btn btn-danger" id="del">Hapus</button>` : ''}
        <button class="btn" id="x">Batal</button>
        <button class="btn btn-primary" id="y">Simpan</button>
      </div>`,
    onMount: (b, close) => {
      b.querySelector('#x').onclick = close;
      if (id) b.querySelector('#del').onclick = async () => {
        if (await confirmDialog('Hapus outlet ini?')) { await M.deleteOutlet(id); close(); navigate('/outlets'); }
      };
      b.querySelector('#y').onclick = async () => {
        const data = {
          outlet_name: b.querySelector('#on').value.trim(),
          address: b.querySelector('#oa').value.trim(),
          latitude: parseFloat(b.querySelector('#olat').value) || null,
          longitude: parseFloat(b.querySelector('#olon').value) || null
        };
        if (id) await M.updateOutlet(id, data);
        else await M.createOutlet(data);
        close(); navigate('/outlets');
        toast('Disimpan', 'success');
      };
    }
  });
}

function assignOutletDialog(outletId) {
  modal({
    title: 'Assign Outlet ke Salesman',
    body: `
      <p class="muted mb-12">Penugasan manual oleh administrator. Sistem tidak akan mengubah otomatis.</p>
      <div class="form-row"><label>Salesman</label>
        <select id="sm"><option value="">— Unassigned —</option>
          ${S.state.salesmen.map(s => `<option value="${s.id}">${escapeHtml(s.salesman_name)}</option>`).join('')}
        </select></div>
      <div class="form-actions">
        <button class="btn" id="x">Batal</button>
        <button class="btn btn-primary" id="y">Simpan</button>
      </div>`,
    onMount: (b, close) => {
      b.querySelector('#x').onclick = close;
      b.querySelector('#y').onclick = async () => {
        const smId = b.querySelector('#sm').value || null;
        if (smId) {
          const sm = S.state.salesmen.find(s => s.id === smId);
          await M.updateOutlet(outletId, { salesman_id: smId, rayon_id: sm.rayon_id });
        } else {
          await M.updateOutlet(outletId, { salesman_id: null });
        }
        close(); navigate('/outlets');
        toast('Penugasan diperbarui', 'success');
      };
    }
  });
}

function correctGPSDialog(outletId) {
  const o = S.state.outlets.find(x => x.id === outletId);
  modal({
    title: 'Koreksi Koordinat',
    body: `
      <p class="muted mb-12">Nilai asli akan disimpan di riwayat koreksi.</p>
      <div class="grid grid-2">
        <div class="form-row"><label>Latitude (asli: ${o.latitude ?? '—'})</label>
          <input id="nlat" type="number" step="any" value="${o.latitude ?? ''}"></div>
        <div class="form-row"><label>Longitude (asli: ${o.longitude ?? '—'})</label>
          <input id="nlon" type="number" step="any" value="${o.longitude ?? ''}"></div>
      </div>
      <div class="form-row"><label>Alasan Koreksi</label>
        <input id="reason" placeholder="Contoh: verifikasi lapangan"></div>
      <div class="form-actions">
        <button class="btn" id="x">Batal</button>
        <button class="btn btn-primary" id="y">Simpan</button>
      </div>`,
    onMount: (b, close) => {
      b.querySelector('#x').onclick = close;
      b.querySelector('#y').onclick = async () => {
        const lat = parseFloat(b.querySelector('#nlat').value);
        const lon = parseFloat(b.querySelector('#nlon').value);
        if (isNaN(lat) || isNaN(lon)) return toast('Koordinat tidak valid', 'error');
        await M.updateOutlet(outletId, {
          latitude: lat, longitude: lon,
          correction_reason: b.querySelector('#reason').value || 'manual'
        });
        close(); navigate('/gps');
        toast('Koordinat dikoreksi & dicatat di riwayat', 'success');
      };
    }
  });
}

function salesmanFormDialog() {
  modal({
    title: 'Salesman Baru',
    body: `
      <div class="form-row"><label>Nama Salesman</label><input id="sn"></div>
      <div class="form-row"><label>Rayon</label>
        <select id="sr"><option value="">— pilih —</option>
          ${S.state.rayons.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}
        </select></div>
      <div class="form-actions">
        <button class="btn" id="x">Batal</button>
        <button class="btn btn-primary" id="y">Simpan</button>
      </div>`,
    onMount: (b, close) => {
      b.querySelector('#x').onclick = close;
      b.querySelector('#y').onclick = async () => {
        const name = b.querySelector('#sn').value.trim();
        if (!name) return toast('Nama wajib', 'error');
        await M.createSalesman({ name, rayon_id: b.querySelector('#sr').value || null });
        close(); navigate('/salesmen');
      };
    }
  });
}

function salesmanConfigDialog(id) {
  const s = S.state.salesmen.find(x => x.id === id);
  const sp = s.starting_point || {};
  const ep = s.ending_point || {};
  modal({
    title: `Konfigurasi Rute: ${escapeHtml(s.salesman_name)}`,
    size: 'lg',
    body: `
      <div class="grid grid-2">
        <div>
          <div class="card-title">Titik Awal</div>
          <div class="form-row"><label>Tipe</label>
            <select id="sptype">
              <option value="fixed_depot" ${sp.type==='fixed_depot'?'selected':''}>Fixed Depot</option>
              <option value="home_location" ${sp.type==='home_location'?'selected':''}>Home Location</option>
              <option value="custom_coordinates" ${sp.type==='custom_coordinates'?'selected':''}>Custom Coordinates</option>
            </select></div>
          <div class="grid grid-2">
            <div class="form-row"><label>Latitude</label><input id="splat" type="number" step="any" value="${sp.latitude ?? ''}"></div>
            <div class="form-row"><label>Longitude</label><input id="splon" type="number" step="any" value="${sp.longitude ?? ''}"></div>
          </div>
        </div>
        <div>
          <div class="card-title">Titik Akhir</div>
          <div class="form-row"><label>Mode</label>
            <select id="mode">
              <option value="round_trip" ${s.route_mode==='round_trip'?'selected':''}>Round Trip (balik ke start)</option>
              <option value="open_route" ${s.route_mode==='open_route'?'selected':''}>Open Route (selesai di outlet terakhir)</option>
              <option value="different_end_point" ${s.route_mode==='different_end_point'?'selected':''}>Different End Point</option>
            </select></div>
          <div class="grid grid-2">
            <div class="form-row"><label>End Latitude</label><input id="eplat" type="number" step="any" value="${ep.latitude ?? ''}"></div>
            <div class="form-row"><label>End Longitude</label><input id="eplon" type="number" step="any" value="${ep.longitude ?? ''}"></div>
          </div>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn" id="x">Batal</button>
        <button class="btn btn-primary" id="y">Simpan Konfigurasi</button>
      </div>`,
    onMount: (b, close) => {
      b.querySelector('#x').onclick = close;
      b.querySelector('#y').onclick = async () => {
        const spLat = parseFloat(b.querySelector('#splat').value);
        const spLon = parseFloat(b.querySelector('#splon').value);
        const epLat = parseFloat(b.querySelector('#eplat').value);
        const epLon = parseFloat(b.querySelector('#eplon').value);
        const mode = b.querySelector('#mode').value;
        const patch = { route_mode: mode };
        if (!isNaN(spLat) && !isNaN(spLon)) {
          patch.starting_point = {
            type: b.querySelector('#sptype').value,
            latitude: spLat, longitude: spLon
          };
        }
        if (mode === 'different_end_point' && !isNaN(epLat) && !isNaN(epLon)) {
          patch.ending_point = { type: 'custom', latitude: epLat, longitude: epLon };
        } else if (mode === 'round_trip' || mode === 'open_route') {
          patch.ending_point = null;
        }
        await M.updateSalesman(id, patch);
        close(); navigate('/startpoints');
        toast('Konfigurasi tersimpan', 'success');
      };
    }
  });
}

// ================================================================
// IMPORT PREVIEW
// ================================================================
function renderImportPreview(container, rows, headers) {
  const autoMap = {};
  headers.forEach(h => { const f = Imp.autoDetectColumn(h); if (f && !autoMap[f]) autoMap[f] = h; });
  const fields = [
    ['outlet_id','Outlet ID'],['outlet_name','Nama Outlet'],['address','Alamat'],
    ['latitude','Latitude'],['longitude','Longitude'],
    ['salesman_name','Salesman'],['rayon_name','Rayon'],
    ['province','Provinsi'],['regency','Kabupaten'],['district','Kecamatan'],['village','Desa']
  ];
  container.innerHTML = `
    <div class="card">
      <div class="card-title">Preview & Column Mapping (${rows.length} baris)</div>
      <div class="grid grid-2">
        ${fields.map(([f, label]) => `
          <div class="form-row">
            <label>${label}</label>
            <select data-field="${f}">
              <option value="">— tidak dipakai —</option>
              ${headers.map(h => `<option value="${escapeHtml(h)}" ${autoMap[f]===h?'selected':''}>${escapeHtml(h)}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>
      <div class="form-actions">
        <button class="btn" id="cancel-import">Batal</button>
        <button class="btn btn-primary" id="confirm-import">Validasi & Impor</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Contoh Data (10 baris pertama)</div>
      <div class="table-wrap"><table>
        <thead><tr>${headers.slice(0, 8).map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, 10).map(r => `<tr>${headers.slice(0, 8).map(h => `<td>${escapeHtml(r[h])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  container.querySelector('#cancel-import').onclick = () => container.innerHTML = '';
  container.querySelector('#confirm-import').onclick = async () => {
    const mapping = {};
    container.querySelectorAll('[data-field]').forEach(sel => {
      if (sel.value) mapping[sel.dataset.field] = sel.value;
    });
    if (!mapping.latitude || !mapping.longitude) return toast('Mapping lat/lon wajib', 'error');
    const normalized = [], errors = [];
    rows.forEach((r, i) => {
      const v = Imp.validateRow(r, mapping);
      if (v.ok) normalized.push(v.normalized);
      else errors.push({ row: i + 2, ...v });
    });
    if (normalized.length === 0) {
      return toast('Tidak ada baris valid. Periksa mapping.', 'error');
    }
    await M.bulkCreateOutlets(normalized);
    toast(`${normalized.length} outlet diimpor${errors.length ? `, ${errors.length} gagal` : ''}`, 'success');
    container.innerHTML = `
      <div class="card">
        <div class="card-title">Import Selesai</div>
        <div class="grid grid-3">
          ${kpi('Berhasil', normalized.length, '', 'success')}
          ${kpi('Gagal', errors.length, '', errors.length ? 'danger' : '')}
          ${kpi('Total', rows.length, '')}
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" onclick="location.hash='#/outlets'">Lihat Outlet</button>
        </div>
      </div>`;
  };
}

// ================================================================
// SINGLE-DAY OPTIMIZATION
// ================================================================
async function runOptimization(salesmanId, resultEl, mapEl) {
  const sm = S.state.salesmen.find(s => s.id === salesmanId);
  const outlets = S.state.outlets.filter(o => o.salesman_id === salesmanId && o.latitude != null);
  if (!outlets.length) return toast('Salesman tidak memiliki outlet dengan GPS valid', 'error');

  const start = sm.starting_point;
  if (!start || start.latitude == null) {
    return toast('Titik awal salesman belum diatur. Buka Multi-Start Point.', 'error');
  }

  const points = [{ lat: start.latitude, lon: start.longitude, name: 'START', type: 'start' }];
  outlets.forEach(o => {
    points.push({ lat: o.latitude, lon: o.longitude, name: o.outlet_name, id: o.id, type: 'outlet' });
  });
  let endIdx = null;
  if (sm.route_mode === 'different_end_point' && sm.ending_point?.latitude != null) {
    endIdx = points.length;
    points.push({ lat: sm.ending_point.latitude, lon: sm.ending_point.longitude, name: 'END', type: 'end' });
  }

  resultEl.innerHTML = `<div class="card">
    <div class="card-title">Menghitung matriks jarak jalan…</div>
    <div class="progress-bar"><div class="progress-fill" id="prog" style="width:15%"></div></div>
    <div class="muted mt-16" id="prog-msg">Mengirim request ke OSRM…</div>
  </div>`;

  try {
    const matrix = await Routing.getMatrix(points);
    resultEl.querySelector('#prog').style.width = '40%';
    resultEl.querySelector('#prog-msg').textContent = 'Mengoptimalkan urutan kunjungan…';

    const closed = sm.route_mode === 'round_trip';
    const optimized = Opt.optimizeRoute(matrix, {
      startIdx: 0,
      endIdx: sm.route_mode === 'different_end_point' ? endIdx : (closed ? 0 : null),
      closed
    });
    const baseline = Opt.baselineCost(matrix, {
      startIdx: 0,
      endIdx: sm.route_mode === 'different_end_point' ? endIdx : (closed ? 0 : null),
      closed
    });

    resultEl.querySelector('#prog').style.width = '60%';
    resultEl.querySelector('#prog-msg').textContent = 'Mengambil geometri jalan…';

    const order = optimized.order;
    const legs = [];
    for (let i = 0; i < order.length - 1; i++)
      legs.push({ a: points[order[i]], b: points[order[i + 1]] });

    const legResults = await fetchLegsConcurrent(legs, 4);

    let totalDist = 0, totalDur = 0;
    const geometry = [];
    const stops = [];
    for (let i = 0; i < legs.length; i++) {
      const r = legResults[i];
      if (r.error) { toast(`Leg ${i+1} gagal: ${r.error.message}`, 'warning'); continue; }
      totalDist += r.distance_meters;
      totalDur += r.duration_seconds;
      if (r.geometry && r.geometry.length) {
        if (geometry.length === 0) geometry.push(...r.geometry);
        else geometry.push(...r.geometry.slice(1));
      } else {
        geometry.push([legs[i].a.lon, legs[i].a.lat], [legs[i].b.lon, legs[i].b.lat]);
      }
      if (legs[i].b.type === 'outlet') {
        stops.push({
          outlet_id: legs[i].b.id, outlet_name: legs[i].b.name,
          leg_distance: r.distance_meters, leg_duration: r.duration_seconds
        });
      }
    }

    resultEl.querySelector('#prog').style.width = '100%';

    const baseCost = baseline.cost;
    const optCost = totalDist;
    const saving = baseCost - optCost;
    const savingPct = baseCost > 0 ? (saving / baseCost) * 100 : 0;

    S.state.currentRoute = {
      type: 'single_day',
      salesman_id: salesmanId,
      salesman_name: sm.salesman_name,
      total_distance: totalDist,
      total_duration: totalDur,
      stops,
      geometry
    };

    resultEl.innerHTML = `
      <div class="card">
        <div class="card-title">Hasil Optimasi — ${escapeHtml(sm.salesman_name)}</div>
        <div class="grid grid-4">
          ${kpi('Jarak (jalan)', fmtMeters(totalDist), 'hasil routing OSRM')}
          ${kpi('Durasi', fmtDuration(totalDur), 'estimasi perjalanan')}
          ${kpi('Stop', stops.length, '')}
          ${kpi('Savings vs Baseline', baseCost > 0 ? fmtNum(savingPct, 1) + '%' : '—',
            baseCost > 0 ? `${fmtMeters(saving)} dihemat` : 'baseline tidak tersedia',
            saving > 0 ? 'success' : '')}
        </div>
        <div class="card-title mt-16">Urutan Kunjungan</div>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Outlet</th><th>Leg Jarak</th><th>Leg Durasi</th></tr></thead>
          <tbody>${stops.map((s, i) => `<tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(s.outlet_name)}</td>
            <td>${fmtMeters(s.leg_distance)}</td>
            <td>${fmtDuration(s.leg_duration)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;

    if (currentRouteMap) { currentRouteMap.destroy(); currentRouteMap = null; }
    mapEl.innerHTML = '';
    setTimeout(() => {
      const elMap = document.getElementById(mapEl.id);
      if (!elMap) return;
      currentRouteMap = MapV.createMap(mapEl.id);
      S.state.outlets.forEach(o => { if (o.latitude != null) currentRouteMap.addOutlet(o); });
      if (geometry.length) currentRouteMap.drawRoute(geometry, '#2563eb');
      currentRouteMap.drawStart(start.latitude, start.longitude, `Start: ${sm.salesman_name}`);
      if (sm.route_mode === 'different_end_point' && sm.ending_point?.latitude != null) {
        currentRouteMap.drawEnd(sm.ending_point.latitude, sm.ending_point.longitude, 'End');
      }
      currentRouteMap.fitToAll();
    }, 50);

  } catch (err) {
    resultEl.innerHTML = `<div class="card">
      <div class="card-title text-danger">Optimasi Gagal</div>
      <p>${escapeHtml(err.message)}</p>
      <p class="muted">Periksa koneksi provider di Settings.</p>
    </div>`;
  }
}

// ================================================================
// FETCH LEGS CONCURRENT — dipakai runOptimization & runDailyPlan
// ================================================================
async function fetchLegsConcurrent(legs, concurrency = 4) {
  const results = new Array(legs.length);
  let idx = 0;

  async function worker() {
    while (idx < legs.length) {
      const i = idx++;
      try {
        results[i] = await Routing.getRoute(legs[i].a, legs[i].b);
      } catch (e) {
        results[i] = { error: e };
      }
    }
  }

  const workers = Math.min(Math.max(1, concurrency), Math.max(1, legs.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

// ================================================================
// DAILY ROUTE PLANNER  (fungsi ini sebelumnya terpotong — sekarang lengkap)
// ================================================================
async function runDailyPlan(salesmanId, maxPerDay, resultEl, mapEl) {
  const sm = S.state.salesmen.find(s => s.id === salesmanId);
  if (!sm) return toast('Salesman tidak ditemukan', 'error');

  const outlets = S.state.outlets.filter(o =>
    o.salesman_id === salesmanId && o.latitude != null && o.longitude != null);
  if (!outlets.length) return toast('Tidak ada outlet valid', 'error');
  if (!sm.starting_point || sm.starting_point.latitude == null)
    return toast('Atur titik awal salesman dulu (Multi-Start Point)', 'error');

  const N = outlets.length;
  const K = Math.ceil(N / maxPerDay);

  const points = [{
    lat: sm.starting_point.latitude, lon: sm.starting_point.longitude,
    name: 'START', type: 'start'
  }];
  outlets.forEach(o => points.push({
    lat: o.latitude, lon: o.longitude, name: o.outlet_name,
    id: o.id, outlet_id: o.outlet_id, address: o.address || '',
    type: 'outlet'
  }));

  let endIdx = null;
  const closed = sm.route_mode === 'round_trip';
  if (sm.route_mode === 'different_end_point' && sm.ending_point?.latitude != null) {
    endIdx = points.length;
    points.push({
      lat: sm.ending_point.latitude, lon: sm.ending_point.longitude,
      name: 'END', type: 'end'
    });
  }

  resultEl.innerHTML = `<div class="card">
    <div class="card-title">Menghitung matriks jarak jalan…</div>
    <div class="progress-bar"><div class="progress-fill" id="dp-prog" style="width:15%"></div></div>
    <div class="muted mt-16" id="dp-prog-msg">
      Mengirim request ke OSRM (${points.length} titik)…
    </div>
  </div>`;

  try {
    const matrix = await Routing.getMatrix(points);

    resultEl.querySelector('#dp-prog').style.width = '45%';
    resultEl.querySelector('#dp-prog-msg').textContent =
      `Membagi outlet ke ${K} hari & mengoptimalkan urutan kunjungan…`;

    const clusters = MD.partitionOutlets(matrix, N, K, maxPerDay);

    const plan = {
      type: 'daily_plan',
      salesman_id: salesmanId,
      salesman_name: sm.salesman_name,
      max_per_day: maxPerDay,
      days: [],
      total_distance: 0,
      total_duration: 0
    };

    for (let d = 0; d < clusters.length; d++) {
      const cluster = clusters[d];
      if (!cluster.length) continue;

      const opt = MD.optimizeCluster(matrix, cluster, { closed, endIdx });
      const order = opt.order;

      const legs = [];
      for (let i = 0; i < order.length - 1; i++)
        legs.push({ a: points[order[i]], b: points[order[i + 1]] });

      const legResults = await fetchLegsConcurrent(legs, 4);

      let dayDist = 0, dayDur = 0;
      const dayGeom = [];
      const dayStops = [];

      for (let i = 0; i < legs.length; i++) {
        const r = legResults[i];
        if (r.error) {
          toast(`Leg ${i + 1} hari ${d + 1} gagal`, 'warning');
          continue;
        }
        dayDist += r.distance_meters;
        dayDur  += r.duration_seconds;

        if (r.geometry && r.geometry.length) {
          if (dayGeom.length === 0) dayGeom.push(...r.geometry);
          else dayGeom.push(...r.geometry.slice(1));
        } else {
          dayGeom.push(
            [legs[i].a.lon, legs[i].a.lat],
            [legs[i].b.lon, legs[i].b.lat]
          );
        }

        const dest = legs[i].b;
        if (dest.type === 'outlet') {
          dayStops.push({
            outlet_id: dest.outlet_id || dest.id,
            outlet_name: dest.name,
            address: dest.address || '',
            latitude: dest.lat,
            longitude: dest.lon,
            leg_distance: r.distance_meters,
            leg_duration: r.duration_seconds
          });
        }
      }

      plan.days.push({
        day: d + 1,
        stops: dayStops,
        totalDist: dayDist,
        totalDur: dayDur,
        geometry: dayGeom
      });
      plan.total_distance += dayDist;
      plan.total_duration += dayDur;
    }

    S.state.currentRoute = plan;

    resultEl.querySelector('#dp-prog').style.width = '100%';

    const colors = ['#2563eb', '#16a34a', '#dc2626', '#9333ea',
                    '#ea580c', '#0891b2', '#ca8a04', '#db2777'];

    const totalStops = plan.days.reduce((s, d) => s + d.stops.length, 0);

    resultEl.innerHTML = `
      <div class="card">
        <div class="card-title">Hasil Daily Plan — ${escapeHtml(sm.salesman_name)}</div>
        <div class="grid grid-4">
          ${kpi('Total Hari', plan.days.length, `maks ${maxPerDay} outlet/hari`)}
          ${kpi('Total Jarak', fmtMeters(plan.total_distance), 'jalan (OSRM)')}
          ${kpi('Total Durasi', fmtDuration(plan.total_duration), 'estimasi')}
          ${kpi('Total Stop', totalStops, '')}
        </div>
        <div class="form-actions mt-16">
          <button class="btn btn-primary" id="dp-export-pdf">📕 Export PDF</button>
          <button class="btn" id="dp-export-xlsx">📊 Export XLSX</button>
        </div>
      </div>
      ${plan.days.map((day, di) => `
        <div class="card">
          <div class="card-title" style="color:${colors[di % colors.length]}">
            Hari ${day.day} — ${day.stops.length} outlet —
            ${fmtMeters(day.totalDist)} — ${fmtDuration(day.totalDur)}
          </div>
          <div class="table-wrap"><table>
            <thead><tr>
              <th>#</th><th>Outlet</th><th>Alamat</th>
              <th>Leg Jarak</th><th>Leg Durasi</th>
            </tr></thead>
            <tbody>${day.stops.map((s, i) => `<tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(s.outlet_name)}</td>
              <td>${escapeHtml(s.address || '')}</td>
              <td>${fmtMeters(s.leg_distance)}</td>
              <td>${fmtDuration(s.leg_duration)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>`).join('')}
    `;

    resultEl.querySelector('#dp-export-pdf').onclick  = () => Exp.exportDailyPlanPDF(plan);
    resultEl.querySelector('#dp-export-xlsx').onclick = () => Exp.exportDailyPlanXLSX(plan);

    // ---- Gambar peta multi-hari (satu warna per hari) ----
    if (currentRouteMap) { currentRouteMap.destroy(); currentRouteMap = null; }
    mapEl.innerHTML = '';
    setTimeout(() => {
      const elMap = document.getElementById(mapEl.id);
      if (!elMap) return;
      currentRouteMap = MapV.createMap(mapEl.id);

      S.state.outlets.forEach(o => {
        if (o.latitude != null) currentRouteMap.addOutlet(o);
      });

      plan.days.forEach((day, i) => {
        if (day.geometry.length)
          currentRouteMap.drawRoute(day.geometry, colors[i % colors.length]);
      });

      currentRouteMap.drawStart(
        sm.starting_point.latitude, sm.starting_point.longitude,
        `Start: ${sm.salesman_name}`
      );
      if (sm.route_mode === 'different_end_point' && sm.ending_point?.latitude != null) {
        currentRouteMap.drawEnd(sm.ending_point.latitude, sm.ending_point.longitude, 'End');
      }
      currentRouteMap.fitToAll();
    }, 50);

  } catch (err) {
    resultEl.innerHTML = `<div class="card">
      <div class="card-title text-danger">Daily Plan Gagal</div>
      <p>${escapeHtml(err.message)}</p>
      <p class="muted">Periksa koneksi provider di Settings.</p>
    </div>`;
  }
}