const routes = new Map();
let currentHandler = null;

export function defineRoute(path, { title, render }) { routes.set(path, { title, render }); }

export function navigate(path) {
  const target = '#' + path;
  if (location.hash === target) {
    // Sudah di path yang sama → paksa re-render agar perubahan data langsung terlihat
    if (currentHandler) currentHandler();
  } else {
    location.hash = target;
  }
}

export async function startRouter(onRoute) {
  const handler = async () => {
    const path = location.hash.slice(1) || '/dashboard';
    const route = routes.get(path);
    if (route) {
      document.querySelectorAll('.nav-item').forEach(n =>
        n.classList.toggle('active', n.dataset.path === path));
      document.getElementById('page-title').textContent = route.title;
      await route.render(document.getElementById('page'));
    } else {
      document.getElementById('page').innerHTML = `<div class="empty">Halaman tidak ditemukan.</div>`;
    }
    if (onRoute) onRoute(path);
  };
  currentHandler = handler;
  window.addEventListener('hashchange', handler);
  await handler();
}

export function renderNav(container, items) {
  container.innerHTML = items.map(sec => `
    <div class="nav-section">${sec.section}</div>
    ${sec.items.map(it => `<a class="nav-item" data-path="${it.path}" href="#${it.path}">${it.label}</a>`).join('')}
  `).join('');
}