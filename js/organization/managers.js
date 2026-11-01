import * as db from '../core/db.js';
import { uuid } from '../core/utils.js';
import * as S from '../core/state.js';

const pid = () => S.state.projectId;

// ---------- Area ----------
export async function createArea({ name, code }) {
  const area = { id: uuid('AREA'), project_id: pid(), name, code: code || '' };
  await db.dbPut('areas', area); await db.auditLog(pid(), 'create', 'area', area.id, { name });
  await S.reloadAreas(); return area;
}
export async function deleteArea(id) {
  const rayons = S.state.rayons.filter(r => r.area_id === id).map(r => ({ ...r, area_id: null }));
  await db.dbBulkPut('rayons', rayons);
  await db.dbDelete('areas', id);
  await db.auditLog(pid(), 'delete', 'area', id, null);
  await Promise.all([S.reloadAreas(), S.reloadRayons()]);
}

// ---------- Rayon ----------
export async function createRayon({ name, area_id }) {
  const rayon = { id: uuid('RAY'), project_id: pid(), area_id: area_id || null, name, locked: false };
  await db.dbPut('rayons', rayon); await db.auditLog(pid(), 'create', 'rayon', rayon.id, { name });
  await S.reloadRayons(); return rayon;
}
export async function setRayonLocked(id, locked) {
  const r = await db.dbGet('rayons', id);
  if (!r) return;
  await db.dbPut('rayons', { ...r, locked });
  await db.auditLog(pid(), locked ? 'lock' : 'unlock', 'rayon', id, null);
  await S.reloadRayons();
}
export async function deleteRayon(id) {
  await db.dbBulkPut('salesmen', S.state.salesmen.filter(s => s.rayon_id === id).map(s => ({ ...s, rayon_id: null })));
  await db.dbBulkPut('outlets', S.state.outlets.filter(o => o.rayon_id === id).map(o => ({ ...o, rayon_id: null })));
  await db.dbDelete('rayons', id);
  await db.auditLog(pid(), 'delete', 'rayon', id, null);
  await Promise.all([S.reloadRayons(), S.reloadSalesmen(), S.reloadOutlets()]);
}

// ---------- Salesman ----------
export async function createSalesman({ name, rayon_id, starting_point }) {
  const sm = { id: uuid('SLS'), project_id: pid(), salesman_name: name, rayon_id: rayon_id || null, status: 'active', starting_point: starting_point || null, ending_point: null, route_mode: 'round_trip' };
  await db.dbPut('salesmen', sm); await db.auditLog(pid(), 'create', 'salesman', sm.id, { name });
  await S.reloadSalesmen(); return sm;
}
export async function updateSalesman(id, patch) {
  const sm = await db.dbGet('salesmen', id);
  if (!sm) throw new Error('Salesman tidak ditemukan');
  const updated = { ...sm, ...patch };
  await db.dbPut('salesmen', updated); await db.auditLog(pid(), 'update', 'salesman', id, patch);
  await S.reloadSalesmen(); return updated;
}
export async function deleteSalesman(id) {
  await db.dbBulkPut('outlets', S.state.outlets.filter(o => o.salesman_id === id).map(o => ({ ...o, salesman_id: null, visit_order: null })));
  await db.dbDelete('salesmen', id);
  await db.dbDelete('settings', `route:${pid()}:${id}`);
  await db.auditLog(pid(), 'delete', 'salesman', id, null);
  await Promise.all([S.reloadSalesmen(), S.reloadOutlets()]);
}

// ---------- Outlet ----------
function buildOutlet(item, extra = {}) {
  return {
    id: uuid('OUT'), project_id: pid(), outlet_id: item.outlet_id || uuid('OID'),
    outlet_name: item.outlet_name || '', address: item.address || '',
    latitude: item.latitude ?? null, longitude: item.longitude ?? null,
    province: item.province || '', regency: item.regency || '', district: item.district || '', village: item.village || '',
    area_id: null, rayon_id: null, salesman_id: null, visit_order: null, ...extra
  };
}

export async function createOutlet(data) {
  const o = buildOutlet(data);
  await db.dbPut('outlets', o); await db.auditLog(pid(), 'create', 'outlet', o.id, { name: o.outlet_name });
  await S.reloadOutlets(); return o;
}
export async function updateOutlet(id, patch) {
  const o = await db.dbGet('outlets', id);
  if (!o) throw new Error('Outlet tidak ditemukan');
  const before = {}; for (const k of Object.keys(patch)) before[k] = o[k] ?? null;
  const updated = { ...o, ...patch };
  await db.dbPut('outlets', updated); await db.auditLog(pid(), 'update', 'outlet', id, { before, after: patch });
  await S.reloadOutlets(); return updated;
}
export async function deleteOutlet(id) {
  await db.dbDelete('outlets', id); await db.auditLog(pid(), 'delete', 'outlet', id, null);
  await S.reloadOutlets();
}

// Impor massal: satu transaksi, lewati duplikat kode outlet, cocokkan/buat salesman & rayon dari nama.
export async function bulkCreateOutlets(list, { autoCreate = true } = {}) {
  const existingIds = new Set(S.state.outlets.map(o => o.outlet_id));
  const rayonByName = new Map(S.state.rayons.map(r => [r.name.trim().toLowerCase(), r]));
  const smByName = new Map(S.state.salesmen.map(s => [s.salesman_name.trim().toLowerCase(), s]));
  const newRayons = [], newSalesmen = [], outlets = [];
  let skippedDup = 0;

  for (const item of list) {
    if (item.outlet_id && existingIds.has(item.outlet_id)) { skippedDup++; continue; }
    if (item.outlet_id) existingIds.add(item.outlet_id);

    let rayon = null, sm = null;
    const rn = (item.rayon_name || '').trim().toLowerCase();
    const sn = (item.salesman_name || '').trim().toLowerCase();
    if (rn) {
      rayon = rayonByName.get(rn) || null;
      if (!rayon && autoCreate) {
        rayon = { id: uuid('RAY'), project_id: pid(), area_id: null, name: item.rayon_name.trim(), locked: false };
        rayonByName.set(rn, rayon); newRayons.push(rayon);
      }
    }
    if (sn) {
      sm = smByName.get(sn) || null;
      if (!sm && autoCreate) {
        sm = { id: uuid('SLS'), project_id: pid(), salesman_name: item.salesman_name.trim(), rayon_id: rayon ? rayon.id : null, status: 'active', starting_point: null, ending_point: null, route_mode: 'round_trip' };
        smByName.set(sn, sm); newSalesmen.push(sm);
      }
    }
    outlets.push(buildOutlet(item, {
      rayon_id: rayon ? rayon.id : (sm ? sm.rayon_id : null),
      salesman_id: sm ? sm.id : null,
      source_data: { swapped: !!item.swapped }
    }));
  }
  await db.dbBulkPut('rayons', newRayons);
  await db.dbBulkPut('salesmen', newSalesmen);
  await db.dbBulkPut('outlets', outlets);
  await db.auditLog(pid(), 'import', 'outlet', 'bulk', { count: outlets.length, skipped_duplicates: skippedDup, new_rayons: newRayons.length, new_salesmen: newSalesmen.length });
  await Promise.all([S.reloadOutlets(), S.reloadRayons(), S.reloadSalesmen()]);
  return { created: outlets.length, skippedDup, newRayons: newRayons.length, newSalesmen: newSalesmen.length };
}

// Simpan urutan kunjungan hasil optimasi ke outlet. orderMap: { outletDbId: urutan }
export async function saveVisitOrder(salesmanId, orderMap) {
  const upd = S.state.outlets.filter(o => o.salesman_id === salesmanId)
    .map(o => ({ ...o, visit_order: orderMap[o.id] ?? null }));
  await db.dbBulkPut('outlets', upd);
  await db.auditLog(pid(), 'save_visit_order', 'salesman', salesmanId, { count: Object.keys(orderMap).length });
  await S.reloadOutlets();
}

// ---------- Proyek ----------
export async function deleteProject(id) {
  for (const store of ['areas', 'rayons', 'salesmen', 'outlets', 'audit_log']) await db.dbDeleteByIndex(store, 'project_id', id);
  const settings = await db.dbAll('settings');
  for (const s of settings) if (String(s.key).startsWith(`route:${id}:`)) await db.dbDelete('settings', s.key);
  await db.dbDelete('projects', id);
}

export async function restoreBackup(data) {
  if (!data || !data.project || !data.project.id || !Array.isArray(data.outlets)) throw new Error('Format backup tidak valid');
  const id = data.project.id;
  const tag = (arr = []) => arr.map(x => ({ ...x, project_id: id }));
  await db.dbPut('projects', data.project);
  await db.dbBulkPut('areas', tag(data.areas));
  await db.dbBulkPut('rayons', tag(data.rayons));
  await db.dbBulkPut('salesmen', tag(data.salesmen));
  await db.dbBulkPut('outlets', tag(data.outlets));
  await db.auditLog(id, 'restore', 'project', id, { outlets: data.outlets.length });
  return id;
}
