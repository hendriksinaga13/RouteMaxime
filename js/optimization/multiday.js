import { nearestNeighbor, twoOpt } from './engine.js';

/**
 * Partisi outlet menjadi K cluster berkapasitas maxPerDay.
 * matrix index 0 = depot, 1..N = outlet. Return array cluster berisi index outlet (1..N).
 */
export function partitionOutlets(matrix, N, K, maxPerDay) {
  if (N === 0) return [];
  if (K <= 1 || maxPerDay >= N) {
    return [Array.from({ length: N }, (_, i) => i + 1)];
  }

  const outletIdx = Array.from({ length: N }, (_, i) => i + 1);
  const safe = v => (v == null || !isFinite(v)) ? 1e12 : v;

  // ---- Farthest-First Seeds ----
  const seeds = [outletIdx[0]];
  const minD = new Array(N + 1).fill(Infinity);
  for (const oi of outletIdx) minD[oi] = safe(matrix[oi][seeds[0]]);

  while (seeds.length < K) {
    let best = -1, bestD = -1;
    for (const oi of outletIdx) {
      if (seeds.includes(oi)) continue;
      if (minD[oi] > bestD) { bestD = minD[oi]; best = oi; }
    }
    if (best === -1) break;
    seeds.push(best);
    for (const oi of outletIdx) {
      const d = safe(matrix[oi][best]);
      if (d < minD[oi]) minD[oi] = d;
    }
  }

  // ---- Greedy Assignment (farthest from depot first) ----
  const order = outletIdx.slice().sort((a, b) => safe(matrix[0][b]) - safe(matrix[0][a]));
  const clusters = seeds.map(() => []);
  const counts = seeds.map(() => 0);

  for (const oi of order) {
    const ranked = seeds
      .map((s, idx) => ({ idx, dist: safe(matrix[oi][s]) }))
      .sort((a, b) => a.dist - b.dist);
    let placed = false;
    for (const { idx } of ranked) {
      if (counts[idx] < maxPerDay) {
        clusters[idx].push(oi);
        counts[idx]++;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const idx = counts.indexOf(Math.min(...counts));
      clusters[idx].push(oi);
      counts[idx]++;
    }
  }

  let result = clusters.filter(c => c.length > 0);
  result = improveClustersBySwaps(matrix, result, 2);
  return result;
}

function improveClustersBySwaps(matrix, clusters, maxPasses) {
  const K = clusters.length;
  if (K < 2) return clusters;
  const safe = v => (v == null || !isFinite(v)) ? 1e12 : v;

  const cost = (arr) => {
    let s = 0;
    for (const a of arr) for (const b of arr)
      if (a !== b) s += safe(matrix[a][b]);
    return s / 2;
  };

  for (let pass = 0; pass < maxPasses; pass++) {
    let passImproved = false;

    for (let a = 0; a < K; a++) {
      for (let b = a + 1; b < K; b++) {
        const before = cost(clusters[a]) + cost(clusters[b]);
        let pairImproved = false;

        for (let i = 0; i < clusters[a].length && !pairImproved; i++) {
          for (let j = 0; j < clusters[b].length; j++) {
            const ca = clusters[a].slice();
            const cb = clusters[b].slice();
            [ca[i], cb[j]] = [cb[j], ca[i]];
            const after = cost(ca) + cost(cb);
            if (after < before - 1e-6) {
              clusters[a] = ca;
              clusters[b] = cb;
              pairImproved = true;
              passImproved = true;
              break;
            }
          }
        }
      }
    }

    if (!passImproved) break;
  }
  return clusters;
}

/** TSP per cluster menggunakan engine existing. */
export function optimizeCluster(matrix, cluster, { closed = true, endIdx = null } = {}) {
  const hasEnd = endIdx != null && endIdx !== 0;
  const points = [0, ...cluster];
  if (hasEnd) points.push(endIdx);
  const n = points.length;

  if (n <= 2) {
    const ord = points.slice();
    if (closed) ord.push(0);
    let cost = 0;
    for (let i = 0; i < ord.length - 1; i++) {
      const v = matrix[ord[i]][ord[i + 1]];
      cost += (v == null || !isFinite(v)) ? 1e12 : v;
    }
    return { order: ord, cost };
  }

  const subM = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => matrix[points[i]][points[j]])
  );

  let order = nearestNeighbor(subM, 0);
  if (hasEnd) {
    order = order.filter(x => x !== n - 1);
    order.push(n - 1);
  }

  const { order: opt } = twoOpt(subM, order, {
    closed,
    freezeFirst: true,
    freezeLast: hasEnd
  });

  const finalOrder = opt.map(i => points[i]);
  if (closed) finalOrder.push(0);

  let total = 0;
  for (let i = 0; i < finalOrder.length - 1; i++) {
    const v = matrix[finalOrder[i]][finalOrder[i + 1]];
    total += (v == null || !isFinite(v)) ? 1e12 : v;
  }
  return { order: finalOrder, cost: total };
}