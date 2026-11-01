// Nearest Neighbor + 2-opt untuk single-day TSP.
export function nearestNeighbor(matrix, startIdx) {
  const N = matrix.length;
  const visited = new Array(N).fill(false);
  const order = [startIdx];
  visited[startIdx] = true;
  let cur = startIdx;
  for (let step = 1; step < N; step++) {
    let best = -1, bestD = Infinity;
    for (let j = 0; j < N; j++) {
      if (visited[j]) continue;
      const d = matrix[cur][j];
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best === -1) {
      for (let j = 0; j < N; j++) if (!visited[j]) order.push(j);
      break;
    }
    visited[best] = true;
    order.push(best);
    cur = best;
  }
  return order;
}

function safeCost(v) { return (v == null || !isFinite(v)) ? 1e12 : v; }

function pathCost(matrix, order, closed) {
  let cost = 0;
  for (let i = 0; i < order.length - 1; i++) cost += safeCost(matrix[order[i]][order[i+1]]);
  if (closed) cost += safeCost(matrix[order[order.length - 1]][order[0]]);
  return cost;
}

export function twoOpt(matrix, order, {
  closed = false, freezeFirst = true, freezeLast = false, maxIter = 1000
} = {}) {
  const N = order.length;
  if (N < 4) return { order: order.slice(), cost: pathCost(matrix, order, closed), iterations: 0 };

  let best = order.slice();
  let bestCost = pathCost(matrix, best, closed);
  let improved = true, iterations = 0;
  const startI = freezeFirst ? 1 : 0;
  const endI = freezeLast ? N - 2 : N - 1;

  while (improved && iterations < maxIter) {
    improved = false; iterations++;
    for (let i = startI; i < endI; i++) {
      for (let k = i + 1; k <= endI; k++) {
        const candidate = best.slice(0, i)
          .concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        const cost = pathCost(matrix, candidate, closed);
        if (cost < bestCost - 1e-6) {
          best = candidate; bestCost = cost; improved = true;
        }
      }
    }
  }
  return { order: best, cost: bestCost, iterations };
}

export function optimizeRoute(matrix, { startIdx = 0, endIdx = null, closed = true } = {}) {
  const N = matrix.length;
  const effectiveClosed = closed && (endIdx == null || endIdx === startIdx);
  const effectiveEnd = (endIdx != null && endIdx !== startIdx) ? endIdx : null;

  const middle = [];
  for (let i = 0; i < N; i++) {
    if (i === startIdx) continue;
    if (effectiveEnd != null && i === effectiveEnd) continue;
    middle.push(i);
  }
  const subset = [startIdx, ...middle];
  if (effectiveEnd != null) subset.push(effectiveEnd);
  const subN = subset.length;

  if (subN <= 2) {
    const ord = subset.slice();
    if (effectiveClosed) ord.push(startIdx);
    return { order: ord, total_cost: pathCost(matrix, ord, false), iterations: 0 };
  }

  const subM = Array.from({ length: subN }, (_, i) =>
    Array.from({ length: subN }, (_, j) => matrix[subset[i]][subset[j]])
  );

  let order = nearestNeighbor(subM, 0);
  if (effectiveEnd != null) {
    const endPos = order.indexOf(subN - 1);
    if (endPos !== subN - 1) order = order.filter(x => x !== subN - 1).concat([subN - 1]);
  }

  const { order: optimized, cost, iterations } = twoOpt(subM, order, {
    closed: effectiveClosed, freezeFirst: true, freezeLast: effectiveEnd != null
  });

  const finalOrder = optimized.map(i => subset[i]);
  if (effectiveClosed) finalOrder.push(startIdx);
  return { order: finalOrder, total_cost: cost, iterations: iterations + 1 };
}

export function baselineCost(matrix, { startIdx = 0, endIdx = null, closed = true } = {}) {
  const N = matrix.length;
  const effectiveClosed = closed && (endIdx == null || endIdx === startIdx);
  const effectiveEnd = (endIdx != null && endIdx !== startIdx) ? endIdx : null;
  const order = [startIdx];
  for (let i = 0; i < N; i++) {
    if (i === startIdx) continue;
    if (effectiveEnd != null && i === effectiveEnd) continue;
    order.push(i);
  }
  if (effectiveEnd != null) order.push(effectiveEnd);
  if (effectiveClosed) order.push(startIdx);
  let cost = 0;
  for (let i = 0; i < order.length - 1; i++) cost += safeCost(matrix[order[i]][order[i+1]]);
  return { order, cost };
}