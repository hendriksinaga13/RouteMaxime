export function uuid(prefix = '') {
  let s;
  if (typeof crypto !== 'undefined' && crypto.randomUUID) s = crypto.randomUUID();
  else {
    s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  const compact = s.replace(/-/g, '').slice(0, 16); // 64-bit: aman dari tabrakan ID
  return prefix ? `${prefix}_${compact}` : s;
}

export function toast(msg, type = 'info', duration = 3500) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

let activeClose = null;
export function modal({ title, body, size, onMount, onClose }) {
  if (activeClose) activeClose();
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal ${size === 'lg' ? 'modal-lg' : ''}" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div class="modal-title">${escapeHtml(title)}</div>
        <button class="modal-close" aria-label="Tutup">×</button>
      </div>
      <div class="modal-body">${body}</div>
    </div>`;
  root.classList.remove('hidden');
  let closed = false;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    if (closed) return;
    closed = true;
    activeClose = null;
    document.removeEventListener('keydown', onKey);
    root.classList.add('hidden');
    root.innerHTML = '';
    if (onClose) { try { onClose(); } catch (e) { console.error(e); } }
  };
  activeClose = close;
  document.addEventListener('keydown', onKey);
  root.querySelector('.modal-close').onclick = close;
  root.onclick = (e) => { if (e.target === root) close(); };
  if (onMount) onMount(root.querySelector('.modal-body'), close);
  return close;
}

export function confirmDialog(message, okLabel = 'Ya') {
  return new Promise(resolve => {
    let answered = false;
    const answer = (v) => { if (!answered) { answered = true; resolve(v); } };
    modal({
      title: 'Konfirmasi',
      body: `<p>${escapeHtml(message)}</p><div class="form-actions"><button class="btn" id="cf-no">Batal</button><button class="btn btn-primary" id="cf-yes">${escapeHtml(okLabel)}</button></div>`,
      onClose: () => answer(false),
      onMount: (body, closeFn) => {
        body.querySelector('#cf-yes').onclick = () => { answer(true); closeFn(); };
        body.querySelector('#cf-no').onclick = () => { answer(false); closeFn(); };
      }
    });
  });
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

export function fmtNum(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('id-ID', { maximumFractionDigits: decimals });
}

export function fmtMeters(m) {
  if (m == null || isNaN(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function fmtDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '—';
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} menit`;
  return `${h}j ${m}m`;
}

// Tanggal LOKAL (bukan UTC) agar nama file tidak mundur sehari di WIB/WITA/WIT.
export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function download(filename, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Parse angka desimal gaya Indonesia ("-2,5") maupun internasional ("-2.5"). Return null bila tidak valid.
export function parseCoord(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s+/g, '');
  if (s === '') return null;
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Mencegah formula injection saat dibuka di Excel
export function safeCell(v) {
  if (typeof v === 'string' && /^[=+@\t\r]/.test(v)) return "'" + v;
  return v;
}
