import * as db from '../core/db.js';
import { uuid } from '../core/utils.js';
import * as S from '../core/state.js';

export async function createArea({ name, code }) {
  const area = { id: uuid('AREA'), project_id: S.state.projectId, name, code: code || '' };
  await db.dbPut('areas', area);
  await db.auditLog(S.state.projectId, 'create', 'area', area.id, { name });
  await S.reloadAreas(); return area;
}

export async function deleteArea(id) {
  await db.dbDelete('areas', id);
  await db.auditLog(S.state.projectId, 'delete', 'area', id, null);
  await S.reloadAreas();
}

export async function createRayon({ name, area_id }) {
  const r = { id: uuid('RAY'), project_id: S.state.projectId, area_id: area_id || null, name, locked: false };
  await db.dbPut('rayons', r);
  await db.auditLog(S.state.projectId, 'create', 'rayon', r.id, { name });
  await S.reloadRayons(); return r;
}

export async function createSalesman({ name, rayon_id, starting_point }) {
  const sm = {
    id: uuid('SLS'), project_id: S.state.projectId, salesman_name: name,
    rayon_id: rayon_id || null, status: 'active',
    starting_point: starting_point || null, route_mode: 'round_trip'
  };
  await db.dbPut('salesmen', sm);
  await db.auditLog(S.state.projectId, 'create', 'salesman', sm.id, { name });
  await S.reloadSalesmen(); return sm;
}

export async function updateSalesman(id, patch) {
  const sm = await db.dbGet('salesmen', id);
  const updated = { ...sm, ...patch };
  await db.dbPut('salesmen', updated);
  await db.auditLog(S.state.projectId, 'update', 'salesman', id, patch);
  await S.reloadSalesmen(); return updated;
}

export async function createOutlet(data) {
  const o = {
    id: uuid('OUT'), project_id: S.state.projectId,
    outlet_id: data.outlet_id || uuid('OID'),
    outlet_name: data.outlet_name || '',
    address: data.address || '',
    latitude: data.latitude ?? null, longitude: data.longitude ?? null,
    area_id: null, rayon_id: data.rayon_id || null, salesman_id: data.salesman_id || null
  };
  await db.dbPut('outlets', o);
  await db.auditLog(S.state.projectId, 'create', 'outlet', o.id, { outlet_name: o.outlet_name });
  await S.reloadOutlets(); return o;
}

export async function deleteOutlet(id) {
  await db.dbDelete('outlets', id);
  await db.auditLog(S.state.projectId, 'delete', 'outlet', id, null);
  await S.reloadOutlets();
}

export async function bulkCreateOutlets(list) {
  const norm = s => String(s || '').toLowerCase().trim();
  const smByName = new Map(S.state.salesmen.map(s => [norm(s.salesman_name), s.id]));
  const smRayon = new Map(S.state.salesmen.map(s => [s.id, s.rayon_id]));
  const ryByName = new Map(S.state.rayons.map(r => [norm(r.name), r.id]));

  const outlets = list.map(item => {
    let salesman_id = null, rayon_id = null;
    const smName = norm(item.salesman_name);
    const ryName = norm(item.rayon_name);
    if (smName && smByName.has(smName)) {
      salesman_id = smByName.get(smName);
      rayon_id = smRayon.get(salesman_id) || null;
    }
    if (ryName && ryByName.has(ryName)) rayon_id = ryByName.get(ryName);

    return {
      id: uuid('OUT'), project_id: S.state.projectId,
      outlet_id: item.outlet_id || uuid('OID'),
      outlet_name: item.outlet_name || '', address: item.address || '',
      latitude: item.latitude ?? null, longitude: item.longitude ?? null,
      province: item.province || '', regency: item.regency || '',
      district: item.district || '', village: item.village || '',
      area_id: null, rayon_id, salesman_id, source_data: item
    };
  });
  await db.dbBulkPut('outlets', outlets);
  await db.auditLog(S.state.projectId, 'import', 'outlet', 'bulk', { count: list.length });
  await S.reloadOutlets();
}

export async function updateOutlet(id, patch) {
  const o = await db.dbGet('outlets', id);
  const updated = { ...o, ...patch };
  await db.dbPut('outlets', updated);
  await db.auditLog(S.state.projectId, 'update', 'outlet', id, patch);
  await S.reloadOutlets(); return updated;
}