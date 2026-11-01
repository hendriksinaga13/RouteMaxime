// Nearest Neighbor + 2-opt + Or-opt pada matriks jarak jalan NYATA (boleh asimetris).
// Konvensi indeks: titik 0 = start. Mode:
//   round_trip         : start -> ... -> start        (closed = true, endIdx = startIdx)
//   open_route         : start -> ... -> (outlet bebas) (closed = false, endIdx = null)
//   different_end_point: start -> ... -> endIdx       (closed = false, endIdx = indeks titik akhir)

export function nearestNeighbor(matrix, startIdx, candidates) {
  const left = new Set(candidates);
  const order = [startIdx];
  let cur = startIdx;
  while (left.size) {
    let best = -1, bestD = Infinity;
    for (const j of left) { const d = matrix[cur][j]; if (d < bestD) { bestD = d; best = j; } }
    if (best === -1) best = left.values().next().value;
    left.delete(best); order.push(best); cur = best;
  }
  return order;
}

export function tourCost(matrix, tour, wrap) {
  let c = 0;
  for (let i = 0; i < tour.length - 1; i++) c += matrix[tour[i]][tour[i + 1]];
  if (wrap && tour.length > 1) c += matrix[tour[tour.length - 1]][tour[0]];
  return c;
}

// 2-opt dengan delta O(1) (prefix sum maju & mundur => benar untuk matriks asimetris)
function twoOpt(m, t, wrap, lo, hi, deadline) {
  const L = t.length;
  let improved = true;
  while (improved && Date.now() < deadline) {
    improved = false;
    const F = new Float64Array(L), B = new Float64Array(L);
    for (let j = 0; j < L - 1; j++) { F[j + 1] = F[j] + m[t[j]][t[j + 1]]; B[j + 1] = B[j] + m[t[j + 1]][t[j]]; }
    outer:
    for (let i = lo; i < hi; i++) {
      for (let k = i + 1; k <= hi; k++) {
        const prev = t[i - 1], a = t[i], b = t[k];
        const hasNext = k < L - 1 || wrap;
        const next = k < L - 1 ? t[k + 1] : t[0];
        const oldC = m[prev][a] + (F[k] - F[i]) + (hasNext ? m[b][next] : 0);
        const newC = m[prev][b] + (B[k] - B[i]) + (hasNext ? m[a][next] : 0);
        if (newC < oldC - 1e-6) {
          for (let x = i, y = k; x < y; x++, y--) { const tmp = t[x]; t[x] = t[y]; t[y] = tmp; }
          improved = true; break outer;
        }
      }
    }
  }
}

// Or-opt: pindahkan segmen 1-3 titik ke posisi lain
function orOpt(m, t, wrap, lo, hi, deadline) {
  let improved = false, again = true;
  while (again && Date.now() < deadline) {
    again = false;
    let cur = tourCost(m, t, wrap);
    search:
    for (let len = 1; len <= 3; len++) {
      for (let i = lo; i + len - 1 <= hi; i++) {
        const seg = t.slice(i, i + len);
        const rest = t.slice(0, i).concat(t.slice(i + len));
        const maxP = rest.length - (hi === t.length - 1 ? 0 : 1); // jaga titik akhir tetap di ujung
        for (let p = lo; p <= maxP; p++) {
          if (p === i) continue;
          const cand = rest.slice(0, p).concat(seg, rest.slice(p));
          const c = tourCost(m, cand, wrap);
          if (c < cur - 1e-6) { for (let x = 0; x < cand.length; x++) t[x] = cand[x]; again = true; improved = true; break search; }
        }
      }
    }
  }
  return improved;
}

export function optimizeRoute(matrix, { startIdx = 0, endIdx = null, closed = true, timeLimitMs = 2000 } = {}) {
  const N = matrix.length;
  const fixedEnd = endIdx != null && endIdx !== startIdx;
  const mutable = [];
  for (let i = 0; i < N; i++) if (i !== startIdx && !(fixedEnd && i === endIdx)) mutable.push(i);

  let tour = nearestNeighbor(matrix, startIdx, mutable);
  if (fixedEnd) tour.push(endIdx);
  const wrap = closed && !fixedEnd;
  const lo = 1, hi = fixedEnd ? tour.length - 2 : tour.length - 1;

  if (hi - lo >= 1) {
    const deadline = Date.now() + timeLimitMs;
    let rounds = 0, prev = Infinity;
    while (Date.now() < deadline && rounds++ < 50) {
      twoOpt(matrix, tour, wrap, lo, hi, deadline);
      if (tour.length <= 150) orOpt(matrix, tour, wrap, lo, hi, deadline);
      const c = tourCost(matrix, tour, wrap);
      if (c >= prev - 1e-6) break;
      prev = c;
    }
  }
  const total_cost = tourCost(matrix, tour, wrap);
  return { order: tour, full_order: wrap ? tour.concat([startIdx]) : tour, total_cost };
}

// Baseline = urutan input (tanpa optimasi), dengan aturan start/end yang sama.
export function baselineCost(matrix, { startIdx = 0, endIdx = null, closed = true } = {}) {
  const N = matrix.length;
  const fixedEnd = endIdx != null && endIdx !== startIdx;
  const mid = [];
  for (let i = 0; i < N; i++) if (i !== startIdx && !(fixedEnd && i === endIdx)) mid.push(i);
  const order = [startIdx, ...mid];
  if (fixedEnd) order.push(endIdx);
  const wrap = closed && !fixedEnd;
  return { order: wrap ? order.concat([startIdx]) : order, cost: tourCost(matrix, order, wrap) };
}
