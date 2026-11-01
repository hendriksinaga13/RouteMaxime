export function uuid(prefix = '') {
  const s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
  return prefix ? `${prefix}_${s.slice(0,8)}` : s;
}

export function toast(msg, type = 'info', duration = 3500) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

export function modal({ title, body, size, onMount }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal ${size === 'lg' ? 'modal-lg' : ''}">
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button class="modal-close" aria-label="Tutup">×</button>
      </div>
      <div class="modal-body">${body}</div>
    </div>`;
  root.classList.remove('hidden');
  const close = () => { root.classList.add('hidden'); root.innerHTML = ''; };
  root.querySelector('.modal-close').onclick = close;
  root.onclick = (e) => { if (e.target === root) close(); };
  if (onMount) onMount(root.querySelector('.modal-body'), close);
  return close;
}

export function confirmDialog(message) {
  return new Promise(resolve => {
    modal({
      title: 'Konfirmasi',
      body: `<p>${message}</p><div class="form-actions"><button class="btn" id="cf-no">Batal</button><button class="btn btn-primary" id="cf-yes">Ya</button></div>`,
      onMount: (body, closeFn) => {
        body.querySelector('#cf-yes').onclick = () => { closeFn(); resolve(true); };
        body.querySelector('#cf-no').onclick = () => { closeFn(); resolve(false); };
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
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} menit`;
  return `${h}j ${m}m`;
}

export function todayISO() { return new Date().toISOString().slice(0, 10); }

export function download(filename, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}