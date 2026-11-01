import * as db from './db.js';

const listeners = new Set();
export const state = {
  projectId: null, project: null, areas: [], rayons: [], salesmen: [], outlets: [],
  provider: { type: 'osrm', endpoint: 'https://router.project-osrm.org', profile: 'driving' },
  currentRoute: null
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) fn(state); }

export async function loadProjectData(projectId) {
  state.projectId = projectId;
  state.currentRoute = null;
  state.project = await db.dbGet('projects', projectId);
  const [areas, rayons, salesmen, outlets] = await Promise.all([
    db.dbByIndex('areas', 'project_id', projectId),
    db.dbByIndex('rayons', 'project_id', projectId),
    db.dbByIndex('salesmen', 'project_id', projectId),
    db.dbByIndex('outlets', 'project_id', projectId)
  ]);
  state.areas = areas; state.rayons = rayons; state.salesmen = salesmen; state.outlets = outlets;
  emit();
}

export async function reloadOutlets() { state.outlets = await db.dbByIndex('outlets', 'project_id', state.projectId); emit(); }
export async function reloadRayons() { state.rayons = await db.dbByIndex('rayons', 'project_id', state.projectId); emit(); }
export async function reloadSalesmen() { state.salesmen = await db.dbByIndex('salesmen', 'project_id', state.projectId); emit(); }
export async function reloadAreas() { state.areas = await db.dbByIndex('areas', 'project_id', state.projectId); emit(); }

export async function loadProvider() {
  const s = await db.dbGet('settings', 'routing_provider');
  if (s && s.value) state.provider = { ...state.provider, ...s.value };
  state.provider.type = 'osrm'; // hanya OSRM yang diimplementasikan
}

export async function saveProvider(value) {
  state.provider = { ...state.provider, ...value, type: 'osrm' };
  state.provider.endpoint = String(state.provider.endpoint || '').trim().replace(/\/+$/, '');
  await db.dbPut('settings', { key: 'routing_provider', value: state.provider });
}

// Simpan / ambil rute terakhir per salesman agar tidak hilang saat reload
export async function saveRoute(route) {
  await db.dbPut('settings', { key: `route:${state.projectId}:${route.salesman_id}`, value: route });
}
export async function loadRoute(salesmanId) {
  const r = await db.dbGet('settings', `route:${state.projectId}:${salesmanId}`);
  return r ? r.value : null;
}
