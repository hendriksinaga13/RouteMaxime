import * as DB from './core/db.js';
import * as S from './core/state.js';
import { navigate, defineRoute, startRouter, renderNav } from './core/router.js';
import { uuid, toast, modal, confirmDialog, escapeHtml, fmtNum, fmtMeters,
  fmtDuration, todayISO, download, parseCoord } from './core/utils.js';
import * as Imp from './import/importer.js';
import * as GPS from './gps/validator.js';
import * as M from './organization/managers.js';
import * as MapV from './territory/mapview.js';
import * as Routing from './routing/provider.js';
import * as Opt from './optimization/engine.js';
import * as Exp from './export/exporter.js';

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
    { path: '/optimize', label: 'Route Optimization' }
  ]},
  { section: 'Lainnya', items: [
    { path: '/export', label: 'Export Center' },
    { path: '/history', label: 'History / Audit' },
    { path: '/settings', label: 'Settings' }
  ]}
];

const MODE_LABEL = {
  round_trip: 'Round Trip', open_route: 'Open Route', different_end_point: 'Different End Point'
};

// Peta aktif per halaman: dibersihkan otomatis saat pindah halaman (mencegah kebocoran memori)
let pageMaps = [];
function track(mv) { pageMaps.push(mv); return mv; }
function route(path, cfg) {
  defineRoute(path, {
    title: cfg.title,
    render: async (el) => {
      pageMaps.forEach(m => m.destroy()); pageMaps = [];
      return cfg.render(el);
    }
  });
}

// ---- INIT ----
async function init() {
  await DB.openDB();
  await S.loadProvider();
  await ensureFirstProject();
  renderNav(document.getElementById('nav'), NAV);
  await refreshProjectSelector();
  const sidebar = document.getElementById('sidebar');
  document.getElementById('menu-toggle').onclick = (e) => { e.stopPropagation(); sidebar.classList.toggle('open'); };
  document.getElementById('main').addEventListener('click', () => sidebar.classList.remove('open'));
  document.getElementById('btn-new-project').onclick = newProjectDialog;
  document.getElementById('project-selector').onchange = async (e) => {
    await S.loadProjectData(e.target.value);
    navigate('/dashboard');
  };
  const pill = document.getElementById('provider-status');
  pill.style.cursor = 'pointer'; pill.title = 'Klik untuk cek ulang koneksi routing';
  pill.onclick = refreshProviderStatus;
  registerRoutes();
  await startRouter();
  refreshProviderStatus();
  setInterval(() => { if (!document.hidden) refreshProviderStatus(); }, 5 * 60 * 1000);
}

let providerCheckToken = 0;
async function refreshProviderStatus() {
  const token = ++providerCheckToken;
  const el = document.getElementById('provider-status');
  el.textContent = 'Provider: memeriksa…';
  el.className = 'status-pill status-warn';
  const r = await Routing.checkProvider();
  if (token !== providerCheckToken) return;
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
  } else if (!S.state.projectId || !projects.find(p => p.id === S.state.projectId)) {
    await S.loadProjectData(projects[0].id);
  }
}

async function refreshProjectSelector() {
  const projects = await DB.dbAll('projects');
  const sel = document.getElementById('project-selector');
  sel.innerHTML = projects.map(p =>
    `<option value="${escapeHtml(p.id)}" ${p.id === S.state.projectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');
}

function newProjectDialog() {
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
      const input = body.querySelector('#prj-name'); input.focus();
      body.querySelector('#prj-cancel').onclick = closeFn;
      const create = async () => {
        const name = input.value.trim();
        if (!name) return toast('Nama wajib diisi', 'error');
        const p = { id: uuid('PRJ'), name, created_at: Date.now() };
        await DB.dbPut('projects', p);
        await S.loadProjectData(p.id);
        await refreshProjectSelector();
        closeFn();
        toast('Proyek dibuat', 'success');
        navigate('/dashboard');
      };
      body.querySelector('#prj-create').onclick = create;
      input.onkeydown = (e) => { if (e.key === 'Enter') create(); };
    }
  });
}

// ================================================================
// ROUTES
// ================================================================
function registerRoutes() {

  // ---------------- DASHBOARD ----------------
  route('/dashboard', { title: 'Executive Dashboard', render: async (el) => {
    const o = S.state.outlets, sm = S.state.salesmen, r = S.state.rayons, a = S.state.areas;
    const valid = o.filter(x => GPS.validateOutlet(x).status === 'VALID').length;
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
  route('/outlets', { title: 'Outlet Database', render: async (el) => {
    const PAGE = 100;
    const view = outletView;
    el.innerHTML = `
      <div class="card">
        <div class="flex justify-between items-center gap-16 wrap">
          <div class="muted" id="outlet-count"></div>
          <div class="flex gap-8 wrap items-center">
            <input type="text" id="outlet-q" placeholder="Cari kode / nama / alamat…" value="${escapeHtml(view.q)}" style="width:240px">
            <select id="outlet-f" style="width:auto">
              <option value="all">Semua</option>
              <option value="unassigned">Belum ditugaskan</option>
              <option value="badgps">GPS bermasalah</option>
            </select>
            <button class="btn btn-primary btn-sm" id="add-outlet">+ Outlet</button>
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table><thead><tr>
          <th>Kode</th><th>Nama</th><th>GPS</th><th>Status</th><th>Rayon</th><th>Salesman</th><th>Urut</th><th></th>
        </tr></thead><tbody id="outlet-body"></tbody></table>
      </div>
      <div class="flex justify-between items-center mt-16" id="outlet-pager"></div>`;
    el.querySelector('#outlet-f').value = view.filter;

    const draw = () => {
      const q = view.q.trim().toLowerCase();
      let list = S.state.outlets;
      if (view.filter === 'unassigned') list = list.filter(o => !o.salesman_id);
      else if (view.filter === 'badgps') list = list.filter(o => GPS.validateOutlet(o).status !== 'VALID');
      if (q) list = list.filter(o => `${o.outlet_id} ${o.outlet_name} ${o.address}`.toLowerCase().includes(q));
      const pages = Math.max(1, Math.ceil(list.length / PAGE));
      view.page = Math.min(Math.max(1, view.page), pages);
      const slice = list.slice((view.page - 1) * PAGE, view.page * PAGE);
      el.querySelector('#outlet-count').textContent =
        `${list.length} dari ${S.state.outlets.length} outlet. Penugasan dilakukan manual oleh administrator.`;
      el.querySelector('#outlet-body').innerHTML = slice.length === 0
        ? `<tr><td colspan="8" class="empty">${S.state.outlets.length ? 'Tidak ada outlet yang cocok.' : 'Belum ada outlet. Impor data terlebih dahulu.'}</td></tr>`
        : slice.map(o => {
          const v = GPS.validateOutlet(o);
          return `<tr>
            <td class="mono">${escapeHtml(o.outlet_id)}</td>
            <td>${escapeHtml(o.outlet_name)}</td>
            <td class="mono">${typeof o.latitude === 'number' && typeof o.longitude === 'number' ? `${o.latitude.toFixed(5)}, ${o.longitude.toFixed(5)}` : '—'}</td>
            <td>${statusPill(v.status)}</td>
            <td>${rayonName(o.rayon_id)}</td>
            <td>${salesmanName(o.salesman_id)}</td>
            <td>${o.visit_order ?? '—'}</td>
            <td class="text-right">
              <button class="btn btn-sm" data-edit="${escapeHtml(o.id)}">Edit</button>
              <button class="btn btn-sm" data-assign="${escapeHtml(o.id)}">Assign</button>
            </td></tr>`;
        }).join('');
      el.querySelector('#outlet-pager').innerHTML = pages > 1 ? `
        <button class="btn btn-sm" id="pg-prev" ${view.page <= 1 ? 'disabled' : ''}>← Sebelumnya</button>
        <span class="muted">Halaman ${view.page} / ${pages}</span>
        <button class="btn btn-sm" id="pg-next" ${view.page >= pages ? 'disabled' : ''}>Berikutnya →</button>` : '';
      const prev = el.querySelector('#pg-prev'), next = el.querySelector('#pg-next');
      if (prev) prev.onclick = () => { view.page--; draw(); };
      if (next) next.onclick = () => { view.page++; draw(); };
    };
    draw();
    let timer;
    el.querySelector('#outlet-q').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { view.q = e.target.value; view.page = 1; draw(); }, 200); };
    el.querySelector('#outlet-f').onchange = (e) => { view.filter = e.target.value; view.page = 1; draw(); };
    el.querySelector('#add-outlet').onclick = () => outletFormDialog();
    el.querySelector('#outlet-body').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit) outletFormDialog(b.dataset.edit);
      else if (b.dataset.assign) assignOutletDialog(b.dataset.assign);
    };
  }});

  // ---------------- IMPORT ----------------
  route('/import', { title: 'Universal Import', render: async (el) => {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Upload Berkas</div>
        <p class="muted mb-12">Format: CSV, XLSX, XLS, JSON, GeoJSON. Setelah upload, kolom akan dideteksi otomatis.</p>
        <input type="file" id="file-input" accept=".csv,.tsv,.xlsx,.xls,.json,.geojson,.txt">
      </div>
      <div id="import-result"></div>`;
    el.querySelector('#file-input').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      e.target.value = ''; // izinkan memilih file yang sama lagi
      const out = el.querySelector('#import-result');
      out.innerHTML = '<div class="card muted">Membaca file…</div>';
      try {
        const { rows, headers } = await Imp.parseFile(f);
        renderImportPreview(out, rows, headers);
      } catch (err) {
        out.innerHTML = '';
        toast('Gagal membaca file: ' + err.message, 'error');
      }
    };
  }});

  // ---------------- GPS VALIDATION ----------------
  route('/gps', { title: 'GPS Validation Center', render: async (el) => {
    const outlets = S.state.outlets;
    const dupIds = new Set(GPS.findDuplicateCoords(outlets).flatMap(d => d.ids));
    const outliers = new Set(GPS.findOutliers(outlets));
    const rows = outlets.map(o => {
      const v = GPS.validateOutlet(o);
      const notes = []; let status = v.status;
      if (dupIds.has(o.id)) { notes.push('Koordinat duplikat'); if (status === 'VALID') status = 'DUPLICATE'; }
      if (outliers.has(o.id)) { notes.push('Outlier geografis'); if (status === 'VALID') status = 'SUSPICIOUS'; }
      return { o, status, note: notes.join(' • ') || v.reason || '—' };
    });
    const validCount = rows.filter(r => GPS.validateOutlet(r.o).status === 'VALID').length;
    const issueCount = rows.filter(r => r.status !== 'VALID').length;
    el.innerHTML = `
      <div class="card">
        <div class="grid grid-4">
          ${kpi('Total', outlets.length, '')}
          ${kpi('Valid', validCount, '', 'success')}
          ${kpi('Duplicate Coord', dupIds.size, '', dupIds.size > 0 ? 'warning' : '')}
          ${kpi('Outlier', outliers.size, '', outliers.size > 0 ? 'warning' : '')}
        </div>
      </div>
      <div class="card flex justify-between items-center">
        <label class="flex items-center gap-8"><input type="checkbox" id="only-issues" ${issueCount > 0 ? 'checked' : ''}> Hanya tampilkan yang bermasalah (${issueCount})</label>
        <span class="muted" id="gps-limit"></span>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>Outlet</th><th>GPS</th><th>Status</th><th>Catatan</th><th></th></tr></thead>
        <tbody id="gps-body"></tbody></table>
      </div>`;
    const LIMIT = 500;
    const draw = () => {
      const only = el.querySelector('#only-issues').checked;
      const list = only ? rows.filter(r => r.status !== 'VALID') : rows;
      el.querySelector('#gps-limit').textContent = list.length > LIMIT ? `Menampilkan ${LIMIT} dari ${list.length}` : '';
      el.querySelector('#gps-body').innerHTML = list.length === 0
        ? '<tr><td colspan="5" class="empty">Tidak ada data.</td></tr>'
        : list.slice(0, LIMIT).map(({ o, status, note }) => `<tr>
            <td>${escapeHtml(o.outlet_name)}</td>
            <td class="mono">${typeof o.latitude === 'number' && typeof o.longitude === 'number' ? `${o.latitude.toFixed(6)}, ${o.longitude.toFixed(6)}` : '—'}</td>
            <td>${statusPill(status)}</td>
            <td class="muted">${escapeHtml(note)}</td>
            <td><button class="btn btn-sm" data-fix="${escapeHtml(o.id)}">Koreksi</button></td></tr>`).join('');
    };
    draw();
    el.querySelector('#only-issues').onchange = draw;
    el.querySelector('#gps-body').onclick = (e) => {
      const b = e.target.closest('[data-fix]'); if (b) correctGPSDialog(b.dataset.fix);
    };
  }});

  // ---------------- AREAS ----------------
  route('/areas', { title: 'Area Management', render: async (el) => {
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
  route('/rayons', { title: 'Rayon Management', render: async (el) => {
    el.innerHTML = `
      <div class="card flex justify-between items-center">
        <div class="muted">${S.state.rayons.length} rayon. Rayon yang dikunci tidak dapat diubah penugasan outletnya.</div>
        <button class="btn btn-primary btn-sm" id="add-rayon">+ Rayon</button>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>Nama</th><th>Area</th><th>Salesman</th><th>Outlet</th><th>Status</th><th></th></tr></thead><tbody>
          ${S.state.rayons.map(r => `
            <tr>
              <td>${escapeHtml(r.name)}</td>
              <td>${areaName(r.area_id)}</td>
              <td>${S.state.salesmen.filter(s => s.rayon_id === r.id).length}</td>
              <td>${S.state.outlets.filter(o => o.rayon_id === r.id).length}</td>
              <td>${r.locked ? statusPill('LOCKED') : statusPill('OPEN')}</td>
              <td class="text-right">
                <button class="btn btn-sm" data-lock="${escapeHtml(r.id)}">${r.locked ? 'Buka Kunci' : 'Kunci'}</button>
                <button class="btn btn-sm btn-danger" data-del="${escapeHtml(r.id)}">Hapus</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty">Belum ada rayon</td></tr>'}
        </tbody></table>
      </div>`;
    el.querySelector('#add-rayon').onclick = () => {
      modal({
        title: 'Rayon Baru',
        body: `<div class="form-row"><label>Nama Rayon</label><input id="rn"></div>
               <div class="form-row"><label>Area</label><select id="ra">
                 <option value="">— pilih —</option>
                 ${S.state.areas.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('')}
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
    el.querySelectorAll('[data-lock]').forEach(b => b.onclick = async () => {
      const r = S.state.rayons.find(x => x.id === b.dataset.lock);
      await M.setRayonLocked(r.id, !r.locked); navigate('/rayons');
    });
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const r = S.state.rayons.find(x => x.id === b.dataset.del);
      if (await confirmDialog(`Hapus rayon "${r.name}"? Salesman & outlet di rayon ini akan dilepas dari rayon (tidak dihapus).`)) {
        await M.deleteRayon(r.id); navigate('/rayons');
      }
    });
  }});

  // ---------------- SALESMEN ----------------
  route('/salesmen', { title: 'Salesman Management', render: async (el) => {
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
              <td>${MODE_LABEL[s.route_mode] || escapeHtml(s.route_mode)}</td>
              <td class="text-right">
                <button class="btn btn-sm" data-cfg="${escapeHtml(s.id)}">Rute</button>
                <button class="btn btn-sm" data-edit="${escapeHtml(s.id)}">Edit</button>
                <button class="btn btn-sm btn-danger" data-del="${escapeHtml(s.id)}">Hapus</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">Belum ada salesman</td></tr>'}
        </tbody></table>
      </div>`;
    el.querySelector('#add-sm').onclick = () => salesmanFormDialog();
    el.querySelectorAll('[data-cfg]').forEach(b => b.onclick = () => salesmanConfigDialog(b.dataset.cfg));
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => salesmanFormDialog(b.dataset.edit));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const s = S.state.salesmen.find(x => x.id === b.dataset.del);
      if (await confirmDialog(`Hapus salesman "${s.salesman_name}"? Outlet miliknya menjadi belum ditugaskan.`)) {
        await M.deleteSalesman(s.id); navigate('/salesmen');
      }
    });
  }});

  // ---------------- MULTI-START POINT ----------------
  route('/startpoints', { title: 'Multi-Start Point', render: async (el) => {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Konfigurasi Titik Awal & Akhir</div>
        <p class="muted mb-12">Setiap salesman memiliki titik awal dan akhir independen. Setelah perubahan, jalankan optimasi ulang.</p>
        <div class="grid grid-2">
          ${S.state.salesmen.map(s => `
            <div class="card" style="margin:0">
              <b>${escapeHtml(s.salesman_name)}</b>
              <div class="muted" style="font-size:12px">Mode: ${MODE_LABEL[s.route_mode] || escapeHtml(s.route_mode)}</div>
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
    // Draw map
    const mv = track(MapV.createMap('start-map'));
    S.state.salesmen.forEach(s => {
      if (s.starting_point?.latitude != null) mv.drawStart(s.starting_point.latitude, s.starting_point.longitude, `Start: ${s.salesman_name}`);
      if (s.ending_point?.latitude != null) mv.drawEnd(s.ending_point.latitude, s.ending_point.longitude, `End: ${s.salesman_name}`);
    });
    S.state.outlets.forEach(o => mv.addOutlet(o));
    mv.fitToAll();
  }});

  // ---------------- OPTIMIZE ----------------
  route('/optimize', { title: 'Route Optimization', render: async (el) => {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Pilih Salesman & Jalankan Optimasi</div>
        <div class="grid grid-2">
          <div class="form-row">
            <label>Salesman</label>
            <select id="opt-sm">
              <option value="">— pilih —</option>
              ${S.state.salesmen.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.salesman_name)} (${S.state.outlets.filter(o => o.salesman_id === s.id).length} outlet)</option>`).join('')}
            </select>
          </div>
          <div class="form-row" style="display:flex;align-items:flex-end">
            <button class="btn btn-primary btn-block" id="run-opt">Jalankan Optimasi Rute</button>
          </div>
        </div>
        <div class="muted" style="font-size:12px">
          ℹ️ Optimasi memakai OSRM untuk jarak jalan sebenarnya (Nearest Neighbor + 2-opt + Or-opt).
          Baseline = urutan kunjungan sesuai input (bukan hasil optimasi). Bila server routing tidak dapat dihubungi,
          hasil dihitung dari ESTIMASI garis lurus dan ditandai jelas.
        </div>
      </div>
      <div id="opt-result"></div>
      <div class="card"><div class="card-title">Peta Rute</div><div id="route-map" class="map-container map-lg"></div></div>`;

    const mv = track(MapV.createMap('route-map'));
    const smSel = el.querySelector('#opt-sm');
    const resultEl = el.querySelector('#opt-result');

    const drawBase = (smId) => {
      mv.clearOutlets(); mv.clearRoutes();
      S.state.outlets.forEach(o => mv.addOutlet(o, smId && o.salesman_id !== smId ? '#9ca3af' : '#2563eb'));
      mv.fitToAll();
    };
    drawBase(null);

    smSel.onchange = async () => {
      resultEl.innerHTML = '';
      drawBase(smSel.value || null);
      if (!smSel.value) return;
      const saved = await S.loadRoute(smSel.value);   // tampilkan rute tersimpan
      if (saved && smSel.value === saved.salesman_id) {
        S.state.currentRoute = saved;
        renderRouteResult(resultEl, mv, saved);
      }
    };
    const btn = el.querySelector('#run-opt');
    btn.onclick = async () => {
      if (!smSel.value) return toast('Pilih salesman terlebih dahulu', 'error');
      btn.disabled = true;
      try { await runOptimization(smSel.value, resultEl, mv); }
      finally { btn.disabled = false; }
    };
  }});

  // ---------------- EXPORT ----------------
  route('/export', { title: 'Export Center', render: async (el) => {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Ekspor Data Proyek: ${escapeHtml(S.state.project?.name || '')}</div>
        <div class="grid grid-3">
          <button class="btn" id="ex-xlsx">📊 XLSX (Multi-sheet)</button>
          <button class="btn" id="ex-csv">📄 CSV Outlets</button>
          <button class="btn" id="ex-json">🗂️ JSON</button>
          <button class="btn" id="ex-geojson">🌍 GeoJSON</button>
          <button class="btn" id="ex-pdf">📕 PDF Rute (rute terakhir)</button>
          <button class="btn" id="ex-routecsv">🧾 CSV Rute (rute terakhir)</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Backup & Restore</div>
        <p class="muted mb-12">Backup berisi proyek aktif (area, rayon, salesman, outlet). Restore menimpa data dengan ID yang sama.</p>
        <div class="flex gap-8 wrap items-center">
          <button class="btn btn-primary" id="ex-backup">💾 Backup Full JSON</button>
          <label class="btn" style="cursor:pointer">♻️ Restore dari Backup
            <input type="file" id="restore-file" accept=".json" style="display:none"></label>
        </div>
      </div>`;
    const safe = (fn) => () => { try { fn(); } catch (e) { toast(e.message, 'error'); } };
    const needRoute = () => { if (!S.state.currentRoute) throw new Error('Belum ada rute. Jalankan optimasi dulu.'); return S.state.currentRoute; };
    el.querySelector('#ex-xlsx').onclick = safe(() => Exp.exportXLSX());
    el.querySelector('#ex-csv').onclick = safe(() => Exp.exportOutletsCSV());
    el.querySelector('#ex-json').onclick = safe(() => Exp.exportOutletsJSON());
    el.querySelector('#ex-geojson').onclick = safe(() => Exp.exportGeoJSON());
    el.querySelector('#ex-pdf').onclick = safe(() => Exp.exportRoutePlanPDF(needRoute()));
    el.querySelector('#ex-routecsv').onclick = safe(() => Exp.exportRouteCSV(needRoute()));
    el.querySelector('#ex-backup').onclick = () => {
      const all = {
        app: 'RouteMaximist', version: 2,
        project: S.state.project,
        areas: S.state.areas, rayons: S.state.rayons,
        salesmen: S.state.salesmen, outlets: S.state.outlets,
        exported_at: new Date().toISOString()
      };
      download(`routemaximist_backup_${todayISO()}.json`, JSON.stringify(all, null, 2), 'application/json');
    };
    el.querySelector('#restore-file').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data.project || !Array.isArray(data.outlets)) throw new Error('Bukan file backup RouteMaximist');
        if (!await confirmDialog(`Restore proyek "${data.project.name}" (${data.outlets.length} outlet)?`, 'Restore')) return;
        const id = await M.restoreBackup(data);
        await S.loadProjectData(id);
        await refreshProjectSelector();
        toast('Restore berhasil', 'success');
        navigate('/dashboard');
      } catch (err) { toast('Restore gagal: ' + err.message, 'error'); }
    };
  }});

  // ---------------- HISTORY ----------------
  route('/history', { title: 'History & Audit Log', render: async (el) => {
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
  route('/settings', { title: 'Settings', render: async (el) => {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Routing Provider</div>
        <div class="form-row"><label>Provider</label>
          <select id="set-type"><option value="osrm" selected>OSRM</option></select></div>
        <div class="form-row"><label>Endpoint URL</label>
          <input type="text" id="set-endpoint" value="${escapeHtml(S.state.provider.endpoint)}"></div>
        <div class="form-row"><label>Profile</label>
          <select id="set-profile">
            ${['driving', 'car', 'bike', 'foot'].map(p => `<option value="${p}" ${S.state.provider.profile === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
          <div class="muted" style="font-size:11px;margin-top:4px">Server publik OSRM hanya mendukung "driving". Profil lain hanya untuk server OSRM milik sendiri.</div></div>
        <div class="flex gap-8">
          <button class="btn btn-primary" id="set-save">Simpan & Tes Koneksi</button>
          <button class="btn" id="set-reset">Kembalikan Default</button>
        </div>
        <div class="muted mt-16" style="font-size:12px">
          ⚠️ Endpoint publik OSRM (<code>router.project-osrm.org</code>) hanya untuk pengujian (tanpa jaminan, ada pembatasan pemakaian).
          Untuk produksi gunakan instance self-hosted. Jangan menyimpan API secret di frontend — gunakan backend proxy.
        </div>
      </div>
      <div class="card">
        <div class="card-title text-danger">Zona Berbahaya</div>
        <p class="muted mb-12">Menghapus proyek <b>${escapeHtml(S.state.project?.name || '')}</b> beserta seluruh area, rayon, salesman, outlet, dan riwayatnya. Tidak dapat dibatalkan — buat backup dulu.</p>
        <button class="btn btn-danger" id="del-project">Hapus Proyek Ini</button>
      </div>`;
    const save = async (value) => {
      await S.saveProvider(value);
      toast('Pengaturan disimpan', 'success');
      refreshProviderStatus();
      navigate('/settings');
    };
    el.querySelector('#set-save').onclick = () => {
      const endpoint = el.querySelector('#set-endpoint').value.trim();
      if (!/^https?:\/\//i.test(endpoint)) return toast('Endpoint harus diawali http:// atau https://', 'error');
      save({ type: 'osrm', endpoint, profile: el.querySelector('#set-profile').value });
    };
    el.querySelector('#set-reset').onclick = () => save({ endpoint: 'https://router.project-osrm.org', profile: 'driving' });
    el.querySelector('#del-project').onclick = async () => {
      const p = S.state.project;
      if (!await confirmDialog(`Yakin hapus proyek "${p.name}" secara permanen?`, 'Hapus Permanen')) return;
      await M.deleteProject(p.id);
      S.state.projectId = null;
      await ensureFirstProject();
      await refreshProjectSelector();
      toast('Proyek dihapus', 'success');
      navigate('/dashboard');
    };
  }});
}


// ================================================================
// HELPERS & COMPONENTS
// ================================================================
const outletView = { q: '', page: 1, filter: 'all' };

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
  return `<span class="status-pill status-${map[status] || 'muted'}">${escapeHtml(status)}</span>`;
}
// Semua helper nama MENGEMBALIKAN HTML YANG SUDAH DI-ESCAPE (data berasal dari file impor).
function areaName(id) { return escapeHtml(S.state.areas.find(a => a.id === id)?.name || '—'); }
function rayonName(id) { return escapeHtml(S.state.rayons.find(r => r.id === id)?.name || '—'); }
function salesmanName(id) { return escapeHtml(S.state.salesmen.find(s => s.id === id)?.salesman_name || '—'); }

function barChart(data) {
  if (!data.length) return `<div class="empty">Tidak ada data</div>`;
  const max = Math.max(...data.map(d => d.value), 1);
  return `<div>${data.map(d => `
    <div style="margin-bottom:8px">
      <div class="flex justify-between" style="font-size:12px">
        <span>${escapeHtml(d.label)}</span><b>${d.value}</b></div>
      <div class="progress-bar"><div class="progress-fill" style="width:${d.value / max * 100}%"></div></div>
    </div>`).join('')}</div>`;
}

// Parse pasangan koordinat dari dua input. Return {lat, lon} | {empty:true} | {error}
function readCoordPair(latRaw, lonRaw, label = 'Koordinat') {
  const a = String(latRaw ?? '').trim(), b = String(lonRaw ?? '').trim();
  if (a === '' && b === '') return { empty: true };
  const lat = parseCoord(a), lon = parseCoord(b);
  if (lat == null || lon == null) return { error: `${label}: latitude & longitude harus berupa angka dan diisi keduanya` };
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { error: `${label}: di luar rentang (lat -90..90, lon -180..180)` };
  return { lat, lon };
}

// ---- Outlet form ----
function outletFormDialog(id) {
  const o = id ? S.state.outlets.find(x => x.id === id) : {};
  if (id && !o) return toast('Outlet tidak ditemukan', 'error');
  modal({
    title: id ? 'Edit Outlet' : 'Outlet Baru',
    body: `
      <div class="grid grid-2">
        <div class="form-row"><label>Kode Outlet</label><input id="oc" value="${escapeHtml(o.outlet_id || '')}" placeholder="otomatis bila kosong"></div>
        <div class="form-row"><label>Nama Outlet</label><input id="on" value="${escapeHtml(o.outlet_name || '')}"></div>
      </div>
      <div class="form-row"><label>Alamat</label><input id="oa" value="${escapeHtml(o.address || '')}"></div>
      <div class="grid grid-2">
        <div class="form-row"><label>Latitude</label><input id="olat" type="text" inputmode="decimal" value="${o.latitude ?? ''}"></div>
        <div class="form-row"><label>Longitude</label><input id="olon" type="text" inputmode="decimal" value="${o.longitude ?? ''}"></div>
      </div>
      <div class="form-actions">
        ${id ? `<button class="btn btn-danger" id="del">Hapus</button>` : ''}
        <button class="btn" id="x">Batal</button>
        <button class="btn btn-primary" id="y">Simpan</button>
      </div>`,
    onMount: (b, close) => {
      b.querySelector('#x').onclick = close;
      if (id) b.querySelector('#del').onclick = async () => {
        if (await confirmDialog('Hapus outlet ini?')) { await M.deleteOutlet(id); close(); navigate('/outlets'); toast('Outlet dihapus', 'success'); }
      };
      b.querySelector('#y').onclick = async () => {
        const name = b.querySelector('#on').value.trim();
        const code = b.querySelector('#oc').value.trim();
        if (!name) return toast('Nama outlet wajib diisi', 'error');
        if (code && S.state.outlets.some(x => x.outlet_id === code && x.id !== id)) return toast('Kode outlet sudah dipakai', 'error');
        const c = readCoordPair(b.querySelector('#olat').value, b.querySelector('#olon').value, 'GPS');
        if (c.error) return toast(c.error, 'error');
        const data = {
          outlet_name: name, address: b.querySelector('#oa').value.trim(),
          latitude: c.empty ? null : c.lat, longitude: c.empty ? null : c.lon
        };
        try {
          if (id) await M.updateOutlet(id, { ...data, ...(code ? { outlet_id: code } : {}) });
          else await M.createOutlet({ ...data, outlet_id: code });
          close(); navigate('/outlets'); toast('Disimpan', 'success');
        } catch (err) { toast('Gagal menyimpan: ' + err.message, 'error'); }
      };
    }
  });
}

function assignOutletDialog(outletId) {
  const o = S.state.outlets.find(x => x.id === outletId);
  modal({
    title: 'Assign Outlet ke Salesman',
    body: `
      <p class="muted mb-12">Penugasan manual oleh administrator. Sistem tidak akan mengubah otomatis.</p>
      <div class="form-row"><label>Salesman</label>
        <select id="sm"><option value="">— Unassigned —</option>
          ${S.state.salesmen.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === o?.salesman_id ? 'selected' : ''}>${escapeHtml(s.salesman_name)}</option>`).join('')}
        </select></div>
      <div class="form-actions">
        <button class="btn" id="x">Batal</button>
        <button class="btn btn-primary" id="y">Simpan</button>
      </div>`,
    onMount: (b, close) => {
      b.querySelector('#x').onclick = close;
      b.querySelector('#y').onclick = async () => {
        const smId = b.querySelector('#sm').value || null;
        const sm = smId ? S.state.salesmen.find(s => s.id === smId) : null;
        const rayonLocked = (rid) => !!S.state.rayons.find(r => r.id === rid)?.locked;
        if (smId === o.salesman_id) return close();
        if ((o.rayon_id && rayonLocked(o.rayon_id)) || (sm && sm.rayon_id && rayonLocked(sm.rayon_id)))
          return toast('Rayon terkunci — buka kunci di Rayon Management untuk mengubah penugasan.', 'error');
        await M.updateOutlet(outletId, sm
          ? { salesman_id: sm.id, rayon_id: sm.rayon_id, visit_order: null }
          : { salesman_id: null, visit_order: null });
        close(); navigate('/outlets');
        toast('Penugasan diperbarui', 'success');
      };
    }
  });
}

function correctGPSDialog(outletId) {
  const o = S.state.outlets.find(x => x.id === outletId);
  if (!o) return;
  modal({
    title: 'Koreksi Koordinat',
    body: `
      <p class="muted mb-12">Nilai asli disimpan di data outlet dan riwayat audit.</p>
      <div class="grid grid-2">
        <div class="form-row"><label>Latitude (asli: ${o.original_latitude ?? o.latitude ?? '—'})</label>
          <input id="nlat" type="text" inputmode="decimal" value="${o.latitude ?? ''}"></div>
        <div class="form-row"><label>Longitude (asli: ${o.original_longitude ?? o.longitude ?? '—'})</label>
          <input id="nlon" type="text" inputmode="decimal" value="${o.longitude ?? ''}"></div>
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
        const c = readCoordPair(b.querySelector('#nlat').value, b.querySelector('#nlon').value, 'Koordinat');
        if (c.error || c.empty) return toast(c.error || 'Koordinat wajib diisi', 'error');
        if (c.lat === 0 && c.lon === 0) return toast('Koordinat 0,0 tidak valid', 'error');
        await M.updateOutlet(outletId, {
          latitude: c.lat, longitude: c.lon,
          original_latitude: o.original_latitude ?? o.latitude ?? null,
          original_longitude: o.original_longitude ?? o.longitude ?? null,
          correction_reason: b.querySelector('#reason').value.trim() || 'manual'
        });
        close(); navigate('/gps');
        toast('Koordinat dikoreksi & dicatat di riwayat', 'success');
      };
    }
  });
}

function salesmanFormDialog(id) {
  const s = id ? S.state.salesmen.find(x => x.id === id) : null;
  modal({
    title: id ? 'Edit Salesman' : 'Salesman Baru',
    body: `
      <div class="form-row"><label>Nama Salesman</label><input id="sn" value="${escapeHtml(s?.salesman_name || '')}"></div>
      <div class="form-row"><label>Rayon</label>
        <select id="sr"><option value="">— pilih —</option>
          ${S.state.rayons.map(r => `<option value="${escapeHtml(r.id)}" ${r.id === s?.rayon_id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
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
        const rayon_id = b.querySelector('#sr').value || null;
        if (id) await M.updateSalesman(id, { salesman_name: name, rayon_id });
        else await M.createSalesman({ name, rayon_id });
        close(); navigate('/salesmen');
      };
    }
  });
}

function salesmanConfigDialog(id) {
  const s = S.state.salesmen.find(x => x.id === id);
  if (!s) return toast('Salesman tidak ditemukan', 'error');
  const sp = s.starting_point || {}, ep = s.ending_point || {};
  const mine = S.state.outlets.filter(o => o.salesman_id === id && typeof o.latitude === 'number' && typeof o.longitude === 'number');
  let mv = null;
  modal({
    title: `Konfigurasi Rute: ${s.salesman_name}`,
    size: 'lg',
    onClose: () => { if (mv) mv.destroy(); },
    body: `
      <div class="grid grid-2">
        <div>
          <div class="card-title">Titik Awal</div>
          <div class="form-row"><label>Tipe</label>
            <select id="sptype">
              <option value="fixed_depot" ${sp.type === 'fixed_depot' ? 'selected' : ''}>Fixed Depot</option>
              <option value="home_location" ${sp.type === 'home_location' ? 'selected' : ''}>Home Location</option>
              <option value="custom_coordinates" ${sp.type === 'custom_coordinates' ? 'selected' : ''}>Custom Coordinates</option>
            </select></div>
          <div class="grid grid-2">
            <div class="form-row"><label>Latitude</label><input id="splat" type="text" inputmode="decimal" value="${sp.latitude ?? ''}"></div>
            <div class="form-row"><label>Longitude</label><input id="splon" type="text" inputmode="decimal" value="${sp.longitude ?? ''}"></div>
          </div>
          <button class="btn btn-sm" id="centroid" type="button">Pakai pusat (centroid) outlet</button>
        </div>
        <div>
          <div class="card-title">Titik Akhir</div>
          <div class="form-row"><label>Mode</label>
            <select id="mode">
              <option value="round_trip" ${s.route_mode === 'round_trip' ? 'selected' : ''}>Round Trip (balik ke start)</option>
              <option value="open_route" ${s.route_mode === 'open_route' ? 'selected' : ''}>Open Route (selesai di outlet terakhir)</option>
              <option value="different_end_point" ${s.route_mode === 'different_end_point' ? 'selected' : ''}>Different End Point</option>
            </select></div>
          <div class="grid grid-2">
            <div class="form-row"><label>End Latitude</label><input id="eplat" type="text" inputmode="decimal" value="${ep.latitude ?? ''}"></div>
            <div class="form-row"><label>End Longitude</label><input id="eplon" type="text" inputmode="decimal" value="${ep.longitude ?? ''}"></div>
          </div>
        </div>
      </div>
      <div class="flex gap-16 items-center mt-16">
        <b style="font-size:12px">Klik peta untuk mengisi:</b>
        <label><input type="radio" name="pick" value="start" checked> Start</label>
        <label><input type="radio" name="pick" value="end"> End</label>
      </div>
      <div id="cfg-map" class="map-container" style="height:280px;margin-top:8px"></div>
      <div class="form-actions">
        <button class="btn" id="x">Batal</button>
        <button class="btn btn-primary" id="y">Simpan Konfigurasi</button>
      </div>`,
    onMount: (b, close) => {
      const $ = (q) => b.querySelector(q);
      const endInputs = [$('#eplat'), $('#eplon'), b.querySelector('input[name="pick"][value="end"]')];
      const syncMode = () => {
        const on = $('#mode').value === 'different_end_point';
        endInputs.forEach(i => i.disabled = !on);
        if (!on) b.querySelector('input[name="pick"][value="start"]').checked = true;
      };
      const pins = () => {
        if (!mv) return;
        mv.clearRoutes();
        const a = readCoordPair($('#splat').value, $('#splon').value);
        if (a.lat != null) mv.drawStart(a.lat, a.lon, 'Start');
        if ($('#mode').value === 'different_end_point') {
          const e = readCoordPair($('#eplat').value, $('#eplon').value);
          if (e.lat != null) mv.drawEnd(e.lat, e.lon, 'End');
        }
      };
      syncMode();
      try {
        mv = MapV.createMap('cfg-map');
        mine.forEach(o => mv.addOutlet(o));
        pins(); mv.fitToAll(); mv.invalidate();
        mv.map.on('click', (e) => {
          const pick = b.querySelector('input[name="pick"]:checked').value;
          const [la, lo] = pick === 'end' ? ['#eplat', '#eplon'] : ['#splat', '#splon'];
          $(la).value = e.latlng.lat.toFixed(6); $(lo).value = e.latlng.lng.toFixed(6);
          pins();
        });
      } catch (err) { $('#cfg-map').style.display = 'none'; }
      ['#splat', '#splon', '#eplat', '#eplon'].forEach(q => $(q).oninput = pins);
      $('#mode').onchange = () => { syncMode(); pins(); };
      $('#centroid').onclick = () => {
        if (!mine.length) return toast('Salesman belum punya outlet dengan GPS valid', 'error');
        $('#splat').value = (mine.reduce((a, o) => a + o.latitude, 0) / mine.length).toFixed(6);
        $('#splon').value = (mine.reduce((a, o) => a + o.longitude, 0) / mine.length).toFixed(6);
        pins();
      };
      $('#x').onclick = close;
      $('#y').onclick = async () => {
        const mode = $('#mode').value;
        const a = readCoordPair($('#splat').value, $('#splon').value, 'Titik awal');
        if (a.error) return toast(a.error, 'error');
        const patch = { route_mode: mode, starting_point: a.empty ? null : { type: $('#sptype').value, latitude: a.lat, longitude: a.lon } };
        if (mode === 'different_end_point') {
          const e = readCoordPair($('#eplat').value, $('#eplon').value, 'Titik akhir');
          if (e.error || e.empty) return toast(e.error || 'Titik akhir wajib diisi untuk mode Different End Point', 'error');
          patch.ending_point = { type: 'custom', latitude: e.lat, longitude: e.lon };
        } else patch.ending_point = null; // round_trip: implisit = start; open_route: bebas
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
  if (!rows.length) { container.innerHTML = '<div class="card empty">File kosong / tidak ada baris data.</div>'; return; }
  const autoMap = {};
  headers.forEach(h => { const f = Imp.autoDetectColumn(h); if (f && !autoMap[f]) autoMap[f] = h; });
  const fields = [
    ['outlet_id', 'Outlet ID'], ['outlet_name', 'Nama Outlet'], ['address', 'Alamat'],
    ['latitude', 'Latitude *'], ['longitude', 'Longitude *'],
    ['salesman_name', 'Salesman'], ['rayon_name', 'Rayon'],
    ['province', 'Provinsi'], ['regency', 'Kabupaten'], ['district', 'Kecamatan'], ['village', 'Desa']
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
              ${headers.map(h => `<option value="${escapeHtml(h)}" ${autoMap[f] === h ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>
      <label class="flex items-center gap-8 mt-16"><input type="checkbox" id="auto-create" checked>
        Buat salesman / rayon otomatis bila namanya belum ada</label>
      <div class="muted" style="font-size:12px;margin-top:4px">Outlet dengan kode yang sudah ada di proyek ini akan dilewati. Koordinat berformat desimal koma (−2,5) dan lat/lon tertukar dikoreksi otomatis.</div>
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
  const btn = container.querySelector('#confirm-import');
  btn.onclick = async () => {
    const mapping = {};
    container.querySelectorAll('[data-field]').forEach(sel => { if (sel.value) mapping[sel.dataset.field] = sel.value; });
    if (!mapping.latitude || !mapping.longitude) return toast('Mapping latitude & longitude wajib', 'error');
    if (!mapping.outlet_name && !mapping.outlet_id) return toast('Mapping kode atau nama outlet wajib', 'error');
    const normalized = [], errors = [];
    rows.forEach((r, i) => {
      const v = Imp.validateRow(r, mapping);
      if (v.ok) normalized.push(v.normalized);
      else errors.push({ row: i + 2, reason: v.reason, name: String(r[mapping.outlet_name] ?? r[mapping.outlet_id] ?? '') });
    });
    if (normalized.length === 0) return toast('Tidak ada baris valid. Periksa mapping.', 'error');
    btn.disabled = true;
    try {
      const res = await M.bulkCreateOutlets(normalized, { autoCreate: container.querySelector('#auto-create').checked });
      const swapped = normalized.filter(n => n.swapped).length;
      toast(`${res.created} outlet diimpor${errors.length ? `, ${errors.length} gagal` : ''}`, 'success');
      container.innerHTML = `
        <div class="card">
          <div class="card-title">Import Selesai</div>
          <div class="grid grid-4">
            ${kpi('Berhasil', res.created, '', 'success')}
            ${kpi('Gagal validasi', errors.length, '', errors.length ? 'danger' : '')}
            ${kpi('Duplikat dilewati', res.skippedDup, 'kode sudah ada', res.skippedDup ? 'warning' : '')}
            ${kpi('Total baris', rows.length, '')}
          </div>
          <div class="muted mt-16" style="font-size:12px">
            ${res.newSalesmen ? `${res.newSalesmen} salesman baru dibuat. ` : ''}${res.newRayons ? `${res.newRayons} rayon baru dibuat. ` : ''}${swapped ? `${swapped} baris lat/lon tertukar dikoreksi otomatis.` : ''}
          </div>
          ${errors.length ? `<div class="card-title mt-16">Baris Gagal${errors.length > 50 ? ' (50 pertama)' : ''}</div>
            <div class="table-wrap"><table><thead><tr><th>Baris</th><th>Outlet</th><th>Alasan</th></tr></thead><tbody>
            ${errors.slice(0, 50).map(e => `<tr><td>${e.row}</td><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.reason)}</td></tr>`).join('')}
            </tbody></table></div>` : ''}
          <div class="form-actions"><button class="btn btn-primary" id="goto-outlets">Lihat Outlet</button></div>
        </div>`;
      container.querySelector('#goto-outlets').onclick = () => navigate('/outlets');
    } catch (err) {
      btn.disabled = false;
      toast('Impor gagal: ' + err.message, 'error');
    }
  };
}

// ================================================================
// OPTIMIZATION RUNNER
// ================================================================
function renderRouteResult(resultEl, mv, route) {
  const saving = route.baseline_cost - route.optimized_cost;
  const savingPct = route.baseline_cost > 0 ? (saving / route.baseline_cost) * 100 : 0;
  resultEl.innerHTML = `
    <div class="card">
      <div class="card-title">Hasil Optimasi — ${escapeHtml(route.salesman_name)} <span class="muted" style="font-weight:400">(${escapeHtml(route.mode_label || '')})</span></div>
      ${route.estimated ? `<div class="banner banner-warn">⚠️ Jarak & durasi adalah <b>ESTIMASI garis lurus</b> (server routing tidak tersedia). Jalankan ulang saat OSRM terhubung untuk jarak jalan sebenarnya.</div>` : ''}
      ${(route.warnings || []).map(w => `<div class="banner banner-warn">⚠️ ${escapeHtml(w)}</div>`).join('')}
      <div class="grid grid-4">
        ${kpi('Jarak ' + (route.estimated ? '(estimasi)' : '(jalan)'), fmtMeters(route.total_distance), route.estimated ? 'garis lurus × 1,35' : 'hasil routing OSRM')}
        ${kpi('Durasi', fmtDuration(route.total_duration), 'estimasi perjalanan')}
        ${kpi('Stop', route.stops.length, '')}
        ${kpi('Hemat vs Baseline', route.baseline_cost > 0 ? fmtNum(savingPct, 1) + '%' : '—',
          route.baseline_cost > 0 ? `${fmtMeters(Math.abs(saving))} ${saving >= 0 ? 'dihemat' : 'lebih panjang'}` : 'baseline tidak tersedia',
          saving > 0 ? 'success' : '')}
      </div>
      <div class="flex gap-8 wrap mt-16">
        <button class="btn btn-primary btn-sm" id="save-order">Simpan urutan ke outlet</button>
        <button class="btn btn-sm" id="r-pdf">PDF</button>
        <button class="btn btn-sm" id="r-csv">CSV</button>
      </div>
      <div class="card-title mt-16">Urutan Kunjungan</div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Outlet</th><th>Leg Jarak</th><th>Leg Durasi</th></tr></thead>
        <tbody>${route.stops.map((s, i) => `<tr>
          <td>${i + 1}</td><td>${escapeHtml(s.outlet_name)}</td>
          <td>${fmtMeters(s.leg_distance)}</td><td>${fmtDuration(s.leg_duration)}</td></tr>`).join('')}
          ${route.return_leg ? `<tr class="muted"><td>↩</td><td>Kembali ke titik awal</td><td>${fmtMeters(route.return_leg.distance_meters)}</td><td>${fmtDuration(route.return_leg.duration_seconds)}</td></tr>` : ''}
        </tbody>
      </table></div>
    </div>`;

  resultEl.querySelector('#save-order').onclick = async () => {
    const map = {}; route.stops.forEach((s, i) => { map[s.outlet_db_id] = i + 1; });
    await M.saveVisitOrder(route.salesman_id, map);
    toast('Urutan kunjungan disimpan ke data outlet', 'success');
  };
  resultEl.querySelector('#r-pdf').onclick = () => { try { Exp.exportRoutePlanPDF(route); } catch (e) { toast(e.message, 'error'); } };
  resultEl.querySelector('#r-csv').onclick = () => { try { Exp.exportRouteCSV(route); } catch (e) { toast(e.message, 'error'); } };

  // Peta
  mv.clearOutlets(); mv.clearRoutes();
  S.state.outlets.forEach(o => mv.addOutlet(o, o.salesman_id === route.salesman_id ? '#2563eb' : '#9ca3af'));
  if (route.geometry && route.geometry.length) mv.drawRoute(route.geometry, route.estimated ? '#f59e0b' : '#2563eb');
  mv.drawStart(route.start.lat, route.start.lon, `Start: ${route.salesman_name}`);
  if (route.end) mv.drawEnd(route.end.lat, route.end.lon, 'End');
  if (route.stops.length <= 300) route.stops.forEach((s, i) => { if (s.lat != null) mv.drawStop(s.lat, s.lon, i + 1, s.outlet_name); });
  mv.fitToAll();
}

async function runOptimization(salesmanId, resultEl, mv) {
  const sm = S.state.salesmen.find(s => s.id === salesmanId);
  const assigned = S.state.outlets.filter(o => o.salesman_id === salesmanId);
  const outlets = assigned.filter(o => GPS.validateOutlet(o).status === 'VALID');
  if (!outlets.length) return toast('Salesman tidak memiliki outlet dengan GPS valid', 'error');
  const start = sm.starting_point;
  if (!start || start.latitude == null) return toast('Titik awal salesman belum diatur. Buka Multi-Start Point.', 'error');
  const mode = sm.route_mode;
  if (mode === 'different_end_point' && sm.ending_point?.latitude == null)
    return toast('Mode Different End Point membutuhkan titik akhir. Atur di Multi-Start Point.', 'error');

  const warnings = [];
  if (assigned.length > outlets.length) warnings.push(`${assigned.length - outlets.length} outlet dilewati karena GPS tidak valid.`);

  // points: [start, ...outlets, end?]
  const points = [{ lat: start.latitude, lon: start.longitude, name: 'START', type: 'start' }];
  outlets.forEach(o => points.push({ lat: o.latitude, lon: o.longitude, name: o.outlet_name, id: o.id, code: o.outlet_id, type: 'outlet' }));
  let endIdx = null, closed = false;
  if (mode === 'round_trip') { endIdx = 0; closed = true; }
  else if (mode === 'different_end_point') {
    endIdx = points.length;
    points.push({ lat: sm.ending_point.latitude, lon: sm.ending_point.longitude, name: 'END', type: 'end' });
  }

  const setProg = (pct, msg) => {
    const p = resultEl.querySelector('#prog'), m = resultEl.querySelector('#prog-msg');
    if (p) p.style.width = pct + '%'; if (m && msg) m.textContent = msg;
  };
  resultEl.innerHTML = `<div class="card">
    <div class="card-title">Menghitung matriks jarak jalan…</div>
    <div class="progress-bar"><div class="progress-fill" id="prog" style="width:10%"></div></div>
    <div class="muted mt-16" id="prog-msg">Mengirim request ke server routing…</div>
  </div>`;

  try {
    let estimated = false, matrix;
    try {
      matrix = await Routing.getMatrix(points, (p) => setProg(10 + p * 40));
    } catch (err) {
      estimated = true;
      matrix = Routing.haversineMatrix(points);
      toast('Server routing tidak dapat dihubungi — memakai ESTIMASI garis lurus.', 'warning', 6000);
    }
    setProg(55, 'Mengoptimalkan urutan kunjungan…');
    await new Promise(r => setTimeout(r, 30)); // beri kesempatan UI repaint

    const optimized = Opt.optimizeRoute(matrix, { startIdx: 0, endIdx, closed });
    const baseline = Opt.baselineCost(matrix, { startIdx: 0, endIdx, closed });
    const seq = optimized.full_order;          // indeks titik berurutan (termasuk kembali ke start bila round trip)
    const seqPoints = seq.map(i => points[i]);

    if (seq.slice(0, -1).some((a, i) => matrix[a][seq[i + 1]] >= Routing.UNREACHABLE / 2))
      warnings.push('Sebagian leg tidak terjangkau lewat jalan — periksa koordinat outlet (mungkin di laut/terpisah pulau).');

    setProg(70, 'Mengambil geometri jalan…');
    let r;
    if (estimated) r = Routing.estimateRoute(seqPoints);
    else {
      try { r = await Routing.getRouteThrough(seqPoints); }
      catch (err) {
        estimated = true; r = Routing.estimateRoute(seqPoints);
        toast('Geometri jalan gagal diambil — memakai garis lurus.', 'warning', 6000);
      }
    }

    const stops = []; let returnLeg = null;
    for (let i = 0; i < seq.length - 1; i++) {
      const target = points[seq[i + 1]];
      const leg = r.legs[i] || { distance_meters: 0, duration_seconds: 0 };
      if (target.type === 'outlet') {
        stops.push({ outlet_db_id: target.id, outlet_id: target.code, outlet_name: target.name, lat: target.lat, lon: target.lon,
          leg_distance: leg.distance_meters, leg_duration: leg.duration_seconds });
      } else if (target.type === 'end') {
        returnLeg = leg; // leg menuju titik akhir
      } else if (target.type === 'start') {
        returnLeg = leg; // leg kembali ke titik awal
      }
    }
    setProg(100);

    const endPt = mode === 'different_end_point' ? { lat: sm.ending_point.latitude, lon: sm.ending_point.longitude } : null;
    const route = {
      salesman_id: salesmanId, salesman_name: sm.salesman_name,
      mode, mode_label: MODE_LABEL[mode] || mode,
      total_distance: r.distance_meters, total_duration: r.duration_seconds,
      stops, geometry: r.geometry, return_leg: returnLeg,
      start: { lat: start.latitude, lon: start.longitude }, end: endPt,
      baseline_cost: baseline.cost, optimized_cost: optimized.total_cost,
      estimated, warnings, created_at: Date.now()
    };
    S.state.currentRoute = route;
    try { await S.saveRoute(route); } catch (e) { console.warn('Gagal menyimpan rute', e); }
    renderRouteResult(resultEl, mv, route);
  } catch (err) {
    console.error(err);
    resultEl.innerHTML = `<div class="card">
      <div class="card-title text-danger">Optimasi Gagal</div>
      <p>${escapeHtml(err.message)}</p>
      <p class="muted">Periksa koneksi provider di Settings.</p>
    </div>`;
  }
}

// ---- BOOT ----
init().catch(err => {
  console.error(err);
  document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif">
    <h2>Gagal memuat RouteMaximist</h2>
    <pre style="white-space:pre-wrap">${escapeHtml(err.message)}\n${escapeHtml(err.stack || '')}</pre>
    <p>Pastikan aplikasi dibuka lewat server lokal (http://localhost) dan perangkat terhubung internet.</p></div>`;
});
