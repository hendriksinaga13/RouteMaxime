const routes = new Map();
let handlerRef = null;
let renderToken = 0;

export function defineRoute(path, { title, render }) { routes.set(path, { title, render }); }

// Jika hash sama, hashchange TIDAK terpicu -> paksa render ulang agar data terbaru tampil.
export function navigate(path) {
  const target = '#' + path;
  if (location.hash === target) { if (handlerRef) handlerRef(); }
  else location.hash = target;
}
export function refresh() { if (handlerRef) return handlerRef(); }

export async function startRouter(onRoute) {
  const handler = async () => {
    const token = ++renderToken;
    const path = location.hash.slice(1) || '/dashboard';
    const route = routes.get(path);
    const page = document.getElementById('page');
    document.getElementById('sidebar')?.classList.remove('open');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.path === path));
    if (route) {
      document.getElementById('page-title').textContent = route.title;
      try {
        page.innerHTML = '';
        await route.render(page);
      } catch (err) {
        console.error(err);
        if (token === renderToken) {
          const d = document.createElement('div');
          d.className = 'empty';
          d.textContent = 'Terjadi kesalahan saat memuat halaman: ' + err.message;
          page.innerHTML = ''; page.appendChild(d);
        }
      }
    } else {
      page.innerHTML = `<div class="empty">Halaman tidak ditemukan.</div>`;
    }
    if (onRoute) onRoute(path);
  };
  handlerRef = handler;
  window.addEventListener('hashchange', handler);
  await handler();
}

export function renderNav(container, items) {
  container.innerHTML = items.map(sec => `
    <div class="nav-section">${sec.section}</div>
    ${sec.items.map(it => `<a class="nav-item" data-path="${it.path}" href="#${it.path}">${it.label}</a>`).join('')}
  `).join('');
}
