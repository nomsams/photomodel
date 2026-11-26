/* PhotoModel 3D — solvers: camera resection from pins (Levenberg–Marquardt), triangulation, simple bundle refinement. */
(() => {
'use strict';
const T = window.THREE;
const P3 = window.P3;
const U = P3.util;
const idx = P3.idx;
const D2R = U.D2R;

const solve = (P3.solve = {});

function rotVecQuat(rx, ry, rz) {
  const a = Math.hypot(rx, ry, rz);
  if (a < 1e-14) return new T.Quaternion();
  return new T.Quaternion().setFromAxisAngle(new T.Vector3(rx / a, ry / a, rz / a), a);
}
function makeCam(pos, q, fov, w, h) { return { pos, q, qi: q.clone().invert(), fov, w, h }; }
const camOfImg = img => makeCam(P3.cam.position(img), P3.cam.quat(img), img.fov, img.w, img.h);

const tmp = new T.Vector3();
function projectPx(c, X) {
  tmp.copy(X).sub(c.pos).applyQuaternion(c.qi);
  if (tmp.z > -1e-9) return null;
  const th = Math.tan((c.fov * D2R) / 2), a = c.w / c.h;
  return [((tmp.x / -tmp.z) / (th * a) + 1) / 2 * c.w, (1 - (tmp.y / -tmp.z) / th) / 2 * c.h];
}
function residuals(c, obs) {
  const r = new Array(obs.length * 2);
  obs.forEach((o, i) => {
    const p = projectPx(c, o.X);
    if (!p) { r[2 * i] = 1e4; r[2 * i + 1] = 1e4; }
    else { r[2 * i] = p[0] - o.u; r[2 * i + 1] = p[1] - o.v; }
  });
  return r;
}
const cost = r => r.reduce((s, x) => s + x * x, 0);

function applyDelta(c, d, k, scale) {
  const pos = c.pos.clone().add(new T.Vector3(d[0], d[1], d[2]).multiplyScalar(scale));
  const q = c.q.clone().multiply(rotVecQuat(d[3], d[4], d[5])).normalize();
  const fov = k > 6 ? U.clamp(c.fov * Math.exp(d[6]), 1, 170) : c.fov;
  return makeCam(pos, q, fov, c.w, c.h);
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-18) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Levenberg–Marquardt refinement of a camera against observations [{X, u, v}] (pixels). */
function lm(c0, obs, { solveFov = false, iters = 60, scale = 1 } = {}) {
  const k = solveFov ? 7 : 6;
  let c = c0, r = residuals(c, obs), f = cost(r), lambda = 1e-3;
  const eps = 1e-6;
  for (let it = 0; it < iters; it++) {
    const m = r.length;
    const J = [];
    for (let j = 0; j < k; j++) {
      const d = new Array(k).fill(0);
      d[j] = eps;
      const rc = residuals(applyDelta(c, d, k, scale), obs);
      J.push(rc.map((x, i) => (x - r[i]) / eps));
    }
    const A = Array.from({ length: k }, () => new Array(k).fill(0));
    const g = new Array(k).fill(0);
    for (let a = 0; a < k; a++) {
      for (let b = a; b < k; b++) {
        let s = 0;
        for (let i = 0; i < m; i++) s += J[a][i] * J[b][i];
        A[a][b] = A[b][a] = s;
      }
      let s = 0;
      for (let i = 0; i < m; i++) s += J[a][i] * r[i];
      g[a] = s;
    }
    let improved = false, done = false;
    for (let tries = 0; tries < 12; tries++) {
      const Ad = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const d = solveLinear(Ad, g.map(x => -x));
      if (!d || d.some(x => !Number.isFinite(x))) { lambda *= 10; continue; }
      const cn = applyDelta(c, d, k, scale);
      const rn = residuals(cn, obs);
      const fn = cost(rn);
      if (fn < f) {
        if ((f - fn) / Math.max(f, 1e-12) < 1e-12) done = true;
        c = cn; r = rn; f = fn;
        lambda = Math.max(1e-12, lambda / 10);
        improved = true;
        break;
      }
      lambda *= 10;
    }
    if (!improved || done || f < 1e-14) break;
  }
  return { cam: c, cost: f, rms: Math.sqrt(f / Math.max(1, r.length / 2)) };
}

function pinObs(img) {
  return (img.pins || []).map(p => {
    const X = P3.model.vpos(p.v);
    return X ? { X, u: p.x * img.w, v: p.y * img.h, vid: p.v } : null;
  }).filter(Boolean);
}

/** RMS reprojection error of a photo's pins, in image pixels (null if no pins). */
solve.imageRms = img => {
  const obs = pinObs(img);
  if (!obs.length) return null;
  return Math.sqrt(cost(residuals(camOfImg(img), obs)) / obs.length);
};
/** Per-pin error in pixels. */
solve.pinError = (img, pin) => {
  const X = P3.model.vpos(pin.v);
  if (!X) return null;
  const p = projectPx(camOfImg(img), X);
  return p ? Math.hypot(p[0] - pin.x * img.w, p[1] - pin.y * img.h) : Infinity;
};
solve.errorClass = px => (px == null ? '' : px < 2.5 ? 'ok' : px < 8 ? 'warn' : 'bad');

const DIRS = (() => {
  const out = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) out.push(new T.Vector3(x, y, z).normalize());
  return out;
})();

/**
 * Solve a photo camera's pose (and optionally FOV) from its pins.
 * Tries the current pose plus 26 views around the pinned points and keeps the best fit.
 */
solve.camera = (img, { solveFov = false } = {}) => {
  const obs = pinObs(img);
  const need = solveFov ? 6 : 4;
  if (obs.length < need) return { error: `Need at least ${need} pinned points in this photo (it has ${obs.length}).` };
  const C = new T.Vector3();
  obs.forEach(o => C.add(o.X));
  C.divideScalar(obs.length);
  const R = Math.max(0.05, ...obs.map(o => o.X.distanceTo(C)));
  const scale = R;
  const cur = camOfImg(img);
  const D0 = Math.max(cur.pos.distanceTo(C), (R / Math.tan((img.fov * D2R) / 2)) * 1.2);
  const starts = [cur];
  for (const d of DIRS) {
    const pos = C.clone().addScaledVector(d, D0);
    starts.push(makeCam(pos, P3.cam.lookQuat(pos, C), img.fov, img.w, img.h));
  }
  let res = starts.map(s => lm(s, obs, { iters: 25, scale })).sort((a, b) => a.cost - b.cost).slice(0, 4);
  res = res.map(r => lm(r.cam, obs, { iters: 120, scale }));
  if (solveFov) res = res.map(r => lm(r.cam, obs, { solveFov: true, iters: 200, scale }));
  res.sort((a, b) => a.cost - b.cost);
  const best = res[0];
  if (!best || !Number.isFinite(best.cost) || best.rms > 5000) return { error: 'Could not find a camera position that fits these pins.' };
  P3.cam.setPose(img, best.cam.pos, best.cam.q);
  if (solveFov) img.fov = U.round(best.cam.fov, 3);
  return { rms: best.rms, n: obs.length, fov: img.fov };
};

/** Rays for a vertex from every photo that has it pinned. */
solve.vertexRays = vid => (idx.pins.get(vid) || []).map(({ img, pin }) => P3.cam.ray(img, pin.x, pin.y));

/** Move a vertex to the best intersection of its pin rays (needs pins in 2+ photos). */
solve.triangulateVertex = vid => {
  const rays = solve.vertexRays(vid);
  if (rays.length < 2) return { error: 'Pin this point in at least 2 photos first.' };
  const r = P3.model.solveRays(rays);
  if (!r) return { error: 'The rays are parallel — use photos taken from more different angles.' };
  const v = idx.v.get(vid);
  v.p = r.point.toArray().map(n => U.round(n, 5));
  return { error: null, spread: r.error, n: rays.length, behind: r.behind };
};

/**
 * Alternate between solving every pinned camera and re-triangulating every pinned point.
 * Points pinned in fewer than 2 photos, and cameras with fewer than 4 pins, stay where they are and anchor the solution.
 */
solve.refineAll = ({ rounds = 6, solveFov = false } = {}) => {
  const s = P3.state;
  let cams = 0, pts = 0;
  for (let r = 0; r < rounds; r++) {
    cams = 0; pts = 0;
    for (const img of s.images) {
      const obs = pinObs(img);
      if (obs.length < (solveFov ? 6 : 4)) continue;
      const C = obs.reduce((a, o) => a.add(o.X), new T.Vector3()).divideScalar(obs.length);
      const scale = Math.max(0.05, ...obs.map(o => o.X.distanceTo(C)));
      const res = lm(camOfImg(img), obs, { iters: 60, scale, solveFov });
      P3.cam.setPose(img, res.cam.pos, res.cam.q);
      if (solveFov) img.fov = U.round(res.cam.fov, 3);
      cams++;
    }
    P3.reindex();
    for (const [vid, list] of idx.pins) {
      if (list.length < 2) continue;
      const res = P3.model.solveRays(list.map(({ img, pin }) => P3.cam.ray(img, pin.x, pin.y)));
      if (res && !res.behind) { idx.v.get(vid).p = res.point.toArray().map(n => U.round(n, 5)); pts++; }
    }
    P3.reindex();
  }
  const errs = s.images.map(solve.imageRms).filter(x => x != null);
  return { cams, pts, rms: errs.length ? Math.sqrt(errs.reduce((a, x) => a + x * x, 0) / errs.length) : null };
};

/* =====================================================================
   Joint bundle adjustment: refine cameras AND points together.
   obs: [{ci, v, u, vpx}] — camera index, vertex id, observed pixel.
   ===================================================================== */
function bundle(cams0, pts0, obs, { solveFov = false, iters = 80, scale = 1, onProgress } = {}) {
  const k = solveFov ? 7 : 6;
  const nC = cams0.length;
  const vids = [...pts0.keys()];
  const vIndex = new Map(vids.map((v, i) => [v, i]));
  const P = nC * k + vids.length * 3;
  let cams = cams0.slice();
  let pts = new Map([...pts0].map(([v, p]) => [v, p.clone()]));
  obs = obs.map(o => ({ ...o }));
  // a line's two ends in one photo may be matched either way round: re-decide every iteration
  const pairMap = new Map();
  obs.forEach((o, i) => {
    const fo = o.pv != null && idx.featOf.get(o.pv);
    if (!fo || fo.f.kind !== 'line') return;
    const k = o.ci + ':' + fo.f.id;
    if (!pairMap.has(k)) pairMap.set(k, []);
    pairMap.get(k).push(i);
  });
  const pairs = [...pairMap.values()].filter(p => p.length === 2);
  const rematch = () => {
    let changed = false;
    for (const [i1, i2] of pairs) {
      const o1 = obs[i1], o2 = obs[i2], c = cams[o1.ci];
      const X1 = pts.get(o1.v), X2 = pts.get(o2.v);
      if (!X1 || !X2) continue;
      const q1 = projectPx(c, X1), q2 = projectPx(c, X2);
      if (!q1 || !q2) continue;
      const e = (q, o) => (q[0] - o.u) ** 2 + (q[1] - o.vpx) ** 2;
      if (e(q2, o1) + e(q1, o2) < e(q1, o1) + e(q2, o2) - 1e-9) { const t = o1.v; o1.v = o2.v; o2.v = t; changed = true; }
    }
    return changed;
  };
  const resid = (cs, ps) => {
    const r = new Array(obs.length * 2);
    obs.forEach((o, i) => {
      const p = projectPx(cs[o.ci], ps.get(o.v));
      if (!p) { r[2 * i] = 1e4; r[2 * i + 1] = 1e4; } else { r[2 * i] = p[0] - o.u; r[2 * i + 1] = p[1] - o.vpx; }
    });
    return r;
  };
  rematch();
  let r = resid(cams, pts), f = cost(r), lambda = 1e-3;
  const eps = 1e-6;
  for (let it = 0; it < iters; it++) {
    if (pairs.length && rematch()) { r = resid(cams, pts); f = cost(r); }
    const A = Array.from({ length: P }, () => new Float64Array(P));
    const g = new Float64Array(P);
    obs.forEach((o, i) => {
      const X = pts.get(o.v), c = cams[o.ci];
      const base = projectPx(c, X);
      if (!base) return;
      const cols = [], du = [], dv = [];
      for (let j = 0; j < k; j++) {
        const d = new Array(k).fill(0); d[j] = eps;
        const p = projectPx(applyDelta(c, d, k, scale), X);
        if (!p) continue;
        cols.push(o.ci * k + j); du.push((p[0] - base[0]) / eps); dv.push((p[1] - base[1]) / eps);
      }
      const vi = vIndex.get(o.v);
      for (let a = 0; a < 3; a++) {
        const X2 = X.clone(); X2.setComponent(a, X2.getComponent(a) + eps * scale);
        const p = projectPx(c, X2);
        if (!p) continue;
        cols.push(nC * k + vi * 3 + a); du.push((p[0] - base[0]) / eps); dv.push((p[1] - base[1]) / eps);
      }
      const ru = r[2 * i], rv = r[2 * i + 1];
      for (let x = 0; x < cols.length; x++) {
        g[cols[x]] += du[x] * ru + dv[x] * rv;
        for (let y = 0; y < cols.length; y++) A[cols[x]][cols[y]] += du[x] * du[y] + dv[x] * dv[y];
      }
    });
    let improved = false, done = false;
    for (let tries = 0; tries < 10; tries++) {
      const Ad = Array.from({ length: P }, (_, i) => { const row = Array.from(A[i]); row[i] = row[i] * (1 + lambda) + 1e-9; return row; });
      const d = solveLinear(Ad, Array.from(g, x => -x));
      if (!d || d.some(x => !Number.isFinite(x))) { lambda *= 10; continue; }
      const cn = cams.map((c, ci) => applyDelta(c, d.slice(ci * k, ci * k + k), k, scale));
      const pn = new Map(vids.map((v, vi) => [v, pts.get(v).clone().add(new T.Vector3(d[nC * k + vi * 3], d[nC * k + vi * 3 + 1], d[nC * k + vi * 3 + 2]).multiplyScalar(scale))]));
      const rn = resid(cn, pn), fn = cost(rn);
      if (fn < f) {
        if ((f - fn) / Math.max(f, 1e-12) < 1e-10) done = true;
        cams = cn; pts = pn; r = rn; f = fn;
        lambda = Math.max(1e-12, lambda / 10);
        improved = true;
        break;
      }
      lambda *= 10;
    }
    if (onProgress) onProgress(it / iters);
    if (!improved || done || f < 1e-12) break;
  }
  return { cams, pts, obs, cost: f, rms: Math.sqrt(f / Math.max(1, obs.length)) };
}
solve._bundle = bundle;

/** Frame in which the reference direction runs tail → nose along +X, with +Y up and +Z to the object's right. */
function referenceFrame(pts, camsUp) {
  const s = P3.state;
  const ref = s.features.find(f => f.kind === 'axis' && f.ref) || s.features.find(f => f.kind === 'axis');
  if (!ref || !pts.has(ref.a) || !pts.has(ref.b)) return null;
  const T0 = pts.get(ref.a), N0 = pts.get(ref.b);
  const len = T0.distanceTo(N0);
  if (len < 1e-9) return null;
  const X = N0.clone().sub(T0).normalize();
  let Y = null;
  // Prefer a line feature (e.g. a wingspan, drawn left → right) to fix the roll about the axis.
  const lat = s.features.find(f => f.kind === 'line' && pts.has(f.a) && pts.has(f.b));
  if (lat) {
    const Z = pts.get(lat.b).clone().sub(pts.get(lat.a));
    Z.addScaledVector(X, -Z.dot(X));
    if (Z.lengthSq() > 1e-10 * len * len) Y = Z.normalize().clone().cross(X);
  }
  const up = camsUp.reduce((a, u) => a.add(u), new T.Vector3());
  up.addScaledVector(X, -up.dot(X));
  if (!Y) Y = up.lengthSq() > 1e-12 ? up.normalize() : new T.Vector3(0, 1, 0).addScaledVector(X, -X.y).normalize();
  else if (up.lengthSq() > 1e-12 && Y.dot(up) < 0) Y.negate(); // keep the object upright relative to the photos
  const Z = X.clone().cross(Y).normalize();
  const k = ref.length > 0 ? ref.length / len : 1 / len;
  // world → object: p' = k · Rᵀ (p − T0)
  const R = new T.Matrix4().makeBasis(X, Y, Z);
  return new T.Matrix4().makeScale(k, k, k).multiply(R.clone().transpose()).multiply(new T.Matrix4().makeTranslation(-T0.x, -T0.y, -T0.z));
}

/** Rotate / scale / move the whole scene so the reference direction lies along +X (nose forward) on the ground grid. */
solve.alignToReference = () => {
  const s = P3.state;
  const pts = new Map(s.vertices.filter(v => !idx.unsolved.has(v.id)).map(v => [v.id, new T.Vector3().fromArray(v.p)]));
  const m = referenceFrame(pts, s.images.map(img => new T.Vector3(0, 1, 0).applyQuaternion(P3.cam.quat(img))));
  if (!m) return { error: 'Add a Direction feature (tail → nose) and solve it first.' };
  P3.model.transformScene(m);
  return { error: null };
};

/** Triangulate every feature point from its marks, keeping cameras fixed. */
solve.triangulateFeatures = () => {
  let n = 0;
  for (const f of P3.state.features) {
    const ends = f.kind === 'point' ? [f.a] : [f.a, f.b];
    const res = ends.map(v => solve.triangulateVertex(v));
    if (res.every(r => !r.error && !r.behind)) { f.solved = true; n++; }
  }
  P3.reindex();
  return n;
};

/* ---------- small dense linear algebra for the factorisation start ---------- */
function jacobiEigen(Ain) {
  const n = Ain.length;
  const A = Ain.map(r => r.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < n; k++) { const a = A[k][p], b = A[k][q]; A[k][p] = cs * a - sn * b; A[k][q] = sn * a + cs * b; }
      for (let k = 0; k < n; k++) { const a = A[p][k], b = A[q][k]; A[p][k] = cs * a - sn * b; A[q][k] = sn * a + cs * b; }
      for (let k = 0; k < n; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = cs * a - sn * b; V[k][q] = sn * a + cs * b; }
    }
  }
  const order = A.map((r, i) => i).sort((a, b) => A[b][b] - A[a][a]);
  return { values: order.map(i => A[i][i]), vectors: order.map(i => V.map(r => r[i])) }; // vectors[k] = k-th eigenvector
}

/**
 * Affine (Tomasi–Kanade) factorisation with a scaled-orthographic metric upgrade.
 * Gives rough cameras + shape straight from the marks, without any guessed shape.
 * Returns up to two candidates (the shape and its mirror image) as {cams: Map(img → cam), pts: Map(v → Vector3)}.
 */
function factorInit(imgs, obsOf) {
  // pick a complete block: points seen in many photos, photos that see all of those points
  const vis = new Map();
  imgs.forEach(img => obsOf(img).forEach(o => vis.set(o.v, (vis.get(o.v) || 0) + 1)));
  let P = [...vis.keys()].filter(v => vis.get(v) >= 2).sort((a, b) => vis.get(b) - vis.get(a));
  let F = [];
  while (P.length >= 4) {
    F = imgs.filter(img => { const s = new Set(obsOf(img).map(o => o.v)); return P.every(v => s.has(v)); });
    if (F.length >= 3) break;
    P = P.slice(0, -1);
  }
  if (F.length < 3 || P.length < 4) return [];
  // normalised image coords (focal = 1, y up), centred per photo
  const rows = [], cents = [];
  for (const img of F) {
    const f = P3.cam.focalPx(img);
    const m = new Map(obsOf(img).map(o => [o.v, [(o.u - img.w / 2) / f, (img.h / 2 - o.vpx) / f]]));
    const xs = P.map(v => m.get(v)[0]), ys = P.map(v => m.get(v)[1]);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    rows.push(xs.map(x => x - cx), ys.map(y => y - cy));
    cents.push([cx, cy]);
  }
  const nP = P.length;
  const WtW = Array.from({ length: nP }, (_, i) => Array.from({ length: nP }, (_, j) => rows.reduce((a, r) => a + r[i] * r[j], 0)));
  const { vectors } = jacobiEigen(WtW);
  const V3 = vectors.slice(0, 3); // 3 × nP
  const Mh = rows.map(r => V3.map(v => v.reduce((a, x, k) => a + x * r[k], 0))); // 2F × 3
  // metric upgrade: find L = Q Qᵀ with iᵀLi = jᵀLj, iᵀLj = 0, i₀ᵀLi₀ = 1
  const g = (a, b) => [a[0] * b[0], a[0] * b[1] + a[1] * b[0], a[0] * b[2] + a[2] * b[0], a[1] * b[1], a[1] * b[2] + a[2] * b[1], a[2] * b[2]];
  const eqs = [], rhs = [];
  for (let k = 0; k < F.length; k++) {
    const i = Mh[2 * k], j = Mh[2 * k + 1];
    const gi = g(i, i), gj = g(j, j);
    eqs.push(gi.map((x, t) => x - gj[t])); rhs.push(0);
    eqs.push(g(i, j)); rhs.push(0);
  }
  eqs.push(g(Mh[0], Mh[0])); rhs.push(1);
  eqs.push(g(Mh[1], Mh[1])); rhs.push(1);
  const N = Array.from({ length: 6 }, (_, a) => Array.from({ length: 6 }, (_, b) => eqs.reduce((s, e) => s + e[a] * e[b], 0) + (a === b ? 1e-12 : 0)));
  const l = solveLinear(N, Array.from({ length: 6 }, (_, a) => eqs.reduce((s, e, r) => s + e[a] * rhs[r], 0)));
  if (!l) return [];
  const L = [[l[0], l[1], l[2]], [l[1], l[3], l[4]], [l[2], l[4], l[5]]];
  const eg = jacobiEigen(L);
  const d = eg.values.map(x => Math.sqrt(Math.max(x, 1e-9)));
  const Q = [0, 1, 2].map(r => [0, 1, 2].map(c => eg.vectors[c][r] * d[c])); // Q = E·diag(√λ)
  const out = [];
  for (const mirror of [1, -1]) {
    const Qm = Q.map(r => [r[0], r[1], r[2] * mirror]);
    const Qinv = new T.Matrix3().set(...Qm.flat()).invert();
    if (!Number.isFinite(Qinv.elements[0])) continue;
    const pts = new Map();
    P.forEach((v, k) => pts.set(v, new T.Vector3(V3[0][k], V3[1][k], V3[2][k]).applyMatrix3(Qinv)));
    const cams = new Map();
    F.forEach((img, k) => {
      const ri = new T.Vector3(...[0, 1, 2].map(c => Mh[2 * k].reduce((s, x, t) => s + x * Qm[t][c], 0)));
      const rj = new T.Vector3(...[0, 1, 2].map(c => Mh[2 * k + 1].reduce((s, x, t) => s + x * Qm[t][c], 0)));
      const sc = (ri.length() + rj.length()) / 2;
      const r1 = ri.clone().normalize();
      const r2 = rj.clone().addScaledVector(r1, -rj.dot(r1)).normalize();
      const r3 = r1.clone().cross(r2);
      const Z = 1 / Math.max(sc, 1e-9);
      const [cx, cy] = cents[k];
      const pos = r3.clone().multiplyScalar(Z).addScaledVector(r1, -cx * Z).addScaledVector(r2, -cy * Z);
      const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(r1, r2, r3));
      cams.set(img, makeCam(pos, q, img.fov, img.w, img.h));
    });
    out.push({ cams, pts });
  }
  return out;
}

function rayFor(c, img, o) {
  const th = Math.tan((c.fov * D2R) / 2), a = c.w / c.h;
  const d = new T.Vector3((2 * (o.u / img.w) - 1) * th * a, (1 - 2 * (o.vpx / img.h)) * th, -1).applyQuaternion(c.q).normalize();
  return { o: c.pos.clone(), d };
}

/** Fill in cameras / points missing from a candidate, then bundle-adjust it. */
function completeAndAdjust(cand, imgs, obsOf, vids, iters, onProgress) {
  const { cams, pts } = cand;
  for (let round = 0; round < 3; round++) {
    for (const v of vids) {
      const rays = imgs.filter(img => cams.has(img)).flatMap(img => obsOf(img).filter(o => o.v === v).map(o => rayFor(cams.get(img), img, o)));
      if (rays.length >= 2 && (!pts.has(v) || round > 0)) { const r = P3.model.solveRays(rays); if (r && !r.behind) pts.set(v, r.point); }
    }
    if (pts.size < 3) break;
    const C = [...pts.values()].reduce((a, p) => a.add(p), new T.Vector3()).divideScalar(pts.size);
    const scale = Math.max(1e-3, ...[...pts.values()].map(p => p.distanceTo(C)));
    for (const img of imgs) {
      const ob = obsOf(img).filter(o => pts.has(o.v)).map(o => ({ X: pts.get(o.v), u: o.u, v: o.vpx }));
      if (ob.length < 4) continue;
      if (cams.has(img)) { cams.set(img, lm(cams.get(img), ob, { iters: 30, scale }).cam); continue; }
      const D0 = (scale / Math.tan((img.fov * D2R) / 2)) * 1.6;
      const starts = DIRS.map(d => { const pos = C.clone().addScaledVector(d, D0); return makeCam(pos, P3.cam.lookQuat(pos, C), img.fov, img.w, img.h); });
      const best = starts.map(st => lm(st, ob, { iters: 25, scale })).sort((a, b) => a.cost - b.cost)[0];
      cams.set(img, lm(best.cam, ob, { iters: 80, scale }).cam);
    }
  }
  const used = imgs.filter(img => cams.has(img));
  const obs = [];
  used.forEach((img, ci) => obsOf(img).forEach(o => { if (pts.has(o.v)) obs.push({ ci, v: o.v, pv: o.pv, u: o.u, vpx: o.vpx }); }));
  if (used.length < 2 || pts.size < 3) return null;
  const C = [...pts.values()].reduce((a, p) => a.add(p), new T.Vector3()).divideScalar(pts.size);
  const scale = Math.max(1e-3, ...[...pts.values()].map(p => p.distanceTo(C)));
  const res = bundle(used.map(img => cams.get(img)), pts, obs, { iters, scale, onProgress });
  return { ...res, used, scale };
}

/* ---------- lines can be drawn either way round ----------
   A line's two ends are matched across photos by continuity through the photo order (photos taken
   walking around the object turn gradually); any photo the solved shape says is flipped is then fixed. */
const pinMapOf = img => new Map((img.pins || []).map(p => [p.v, p]));
function initialLineSwaps(feats, images) {
  const swap = new Set();
  for (const f of feats.filter(x => x.kind === 'line')) {
    let prev = null;
    for (const img of images) {
      const m = pinMapOf(img), pa = m.get(f.a), pb = m.get(f.b);
      if (!pa || !pb) continue;
      let dx = (pb.x - pa.x) * img.w, dy = (pb.y - pa.y) * img.h;
      const L = Math.hypot(dx, dy) || 1;
      dx /= L; dy /= L;
      if (prev && dx * prev[0] + dy * prev[1] < 0) { swap.add(img.id + ':' + f.id); dx = -dx; dy = -dy; }
      prev = [dx, dy];
    }
  }
  return swap;
}

/**
 * End-matching that doesn't depend on drawing direction: rough cameras from line midpoints + points
 * (an affine factorisation, which is the same whichever end was drawn first), then for every photo pick
 * the matching of the line's two ends that triangulates consistently with a reference photo.
 */
function geometricLineSwaps(feats, images) {
  const lines = feats.filter(f => f.kind === 'line');
  if (!lines.length) return [];
  const mid = new Map(lines.map(f => [f.id, 'm' + f.id]));
  const obsMid = img => {
    const m = pinMapOf(img), out = [];
    for (const f of feats) {
      if (f.kind === 'point') { const p = m.get(f.a); if (p) out.push({ v: f.a, u: p.x * img.w, vpx: p.y * img.h }); continue; }
      const pa = m.get(f.a), pb = m.get(f.b);
      if (!pa || !pb) continue;
      if (f.kind === 'line') out.push({ v: mid.get(f.id), u: (pa.x + pb.x) / 2 * img.w, vpx: (pa.y + pb.y) / 2 * img.h });
      else { out.push({ v: f.a, u: pa.x * img.w, vpx: pa.y * img.h }); out.push({ v: f.b, u: pb.x * img.w, vpx: pb.y * img.h }); }
    }
    return out;
  };
  const imgs = images.filter(img => obsMid(img).length >= 4);
  if (imgs.length < 3) return [];
  const results = [];
  for (const cand0 of factorInit(imgs, obsMid)) {
    // sharpen the rough affine cameras with a perspective adjustment on the end-independent data
    const usedM = imgs.filter(img => cand0.cams.has(img));
    const obsM = [];
    usedM.forEach((img, ci) => obsMid(img).forEach(o => { if (cand0.pts.has(o.v)) obsM.push({ ci, v: o.v, u: o.u, vpx: o.vpx }); }));
    const Cm = [...cand0.pts.values()].reduce((a, p) => a.add(p.clone()), new T.Vector3()).divideScalar(cand0.pts.size);
    const scM = Math.max(1e-3, ...[...cand0.pts.values()].map(p => p.distanceTo(Cm)));
    const bm = bundle(usedM.map(img => cand0.cams.get(img)), cand0.pts, obsM, { iters: 60, scale: scM });
    const cand = { cams: new Map(usedM.map((img, ci) => [img, bm.cams[ci]])), pts: bm.pts };
    const swap = new Set();
    for (const f of lines) {
      const withCam = imgs.filter(img => cand.cams.has(img) && pinMapOf(img).has(f.a) && pinMapOf(img).has(f.b));
      if (withCam.length < 2) continue;
      const obs = withCam.map(img => {
        const c = cand.cams.get(img), m = pinMapOf(img), pa = m.get(f.a), pb = m.get(f.b);
        const ra = rayFor(c, img, { u: pa.x * img.w, vpx: pa.y * img.h });
        const rb = rayFor(c, img, { u: pb.x * img.w, vpx: pb.y * img.h });
        const rm = rayFor(c, img, { u: (pa.x + pb.x) / 2 * img.w, vpx: (pa.y + pb.y) / 2 * img.h });
        return { img, ra, rb, rm, n: ra.d.clone().cross(rb.d).normalize() };
      });
      // 3D line: direction ⟂ every photo's line-plane normal; a point from the midpoint rays
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      obs.forEach(o => { const n = [o.n.x, o.n.y, o.n.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i][j] += n[i] * n[j]; });
      const ev = jacobiEigen(A);
      const d = new T.Vector3(...ev.vectors[2]).normalize();
      const sol = P3.model.solveRays(obs.map(o => o.rm));
      if (!sol || !(d.lengthSq() > 0.5)) continue;
      const p0 = sol.point;
      const along = r => { // parameter on the 3D line of the point closest to ray r
        const w0 = r.o.clone().sub(p0), b = r.d.dot(d), den = 1 - b * b;
        return den < 1e-9 ? 0 : (w0.dot(d) - b * r.d.dot(w0)) / den;
      };
      for (const o of obs) if (along(o.ra) > along(o.rb)) swap.add(o.img.id + ':' + f.id);
    }
    // alternate: triangulate line ends with these labels → re-fit cameras → re-decide each photo's ends
    for (let round = 0; round < 4; round++) {
      const P = new Map();
      for (const f of feats) {
        for (const [end, v] of (f.kind === 'point' ? [['a', f.a]] : [['a', f.a], ['b', f.b]])) {
          const rays = [];
          for (const img of usedM) {
            const m = pinMapOf(img);
            let p = m.get(v);
            if (f.kind === 'line' && swap.has(img.id + ':' + f.id)) p = m.get(end === 'a' ? f.b : f.a);
            if (p) rays.push(rayFor(cand.cams.get(img), img, { u: p.x * img.w, vpx: p.y * img.h }));
          }
          if (rays.length >= 2) { const sres = P3.model.solveRays(rays); if (sres) P.set(v, sres.point); }
        }
      }
      if (P.size < 4) break;
      const Cp = [...P.values()].reduce((a, p) => a.add(p.clone()), new T.Vector3()).divideScalar(P.size);
      const scP = Math.max(1e-3, ...[...P.values()].map(p => p.distanceTo(Cp)));
      let changed = false;
      for (const img of usedM) {
        const m = pinMapOf(img);
        const ob = [];
        for (const f of feats) {
          const sw = f.kind === 'line' && swap.has(img.id + ':' + f.id);
          for (const [v, w] of (f.kind === 'point' ? [[f.a, f.a]] : [[f.a, sw ? f.b : f.a], [f.b, sw ? f.a : f.b]])) {
            const p = m.get(w);
            if (p && P.has(v)) ob.push({ X: P.get(v), u: p.x * img.w, v: p.y * img.h });
          }
        }
        if (ob.length >= 4) cand.cams.set(img, lm(cand.cams.get(img), ob, { iters: 40, scale: scP }).cam);
        const c = cand.cams.get(img);
        for (const f of lines) {
          const pa = m.get(f.a), pb = m.get(f.b), A = P.get(f.a), B = P.get(f.b);
          if (!pa || !pb || !A || !B) continue;
          const qa = projectPx(c, A), qb = projectPx(c, B);
          if (!qa || !qb) continue;
          const e = (q, p) => Math.hypot(q[0] - p.x * img.w, q[1] - p.y * img.h);
          const key = img.id + ':' + f.id, want = e(qa, pb) + e(qb, pa) < e(qa, pa) + e(qb, pb);
          if (want !== swap.has(key)) { if (want) swap.add(key); else swap.delete(key); changed = true; }
        }
      }
      if (!changed) break;
    }
    results.push(swap);
  }
  return results;
}
solve._internals = { geometricLineSwaps: (...a) => geometricLineSwaps(...a), initialLineSwaps: (...a) => initialLineSwaps(...a), factorInit: (...a) => factorInit(...a), solveOnce: (...a) => solveOnce(...a) };

function solveOnce(feats, images, swap, { quick = false, onProgress, drop = null } = {}) {
  const fv = new Set();
  feats.forEach(f => { fv.add(f.a); if (f.kind !== 'point') fv.add(f.b); });
  const obsCache = new Map();
  const obsOf = img => {
    if (!obsCache.has(img)) {
      obsCache.set(img, (img.pins || []).filter(p => fv.has(p.v) && !(drop && idx.featOf.get(p.v) && drop.has(img.id + ':' + idx.featOf.get(p.v).f.id))).map(p => {
        let v = p.v;
        const fo = idx.featOf.get(v);
        if (fo && fo.f.kind === 'line' && swap.has(img.id + ':' + fo.f.id)) v = fo.end === 'a' ? fo.f.b : fo.f.a;
        return { v, pv: p.v, u: p.x * img.w, vpx: p.y * img.h };
      }));
    }
    return obsCache.get(img);
  };
  const imgs = images.filter(img => obsOf(img).length >= 4);
  const skipped = images.filter(img => { const n = obsOf(img).length; return n > 0 && n < 4; }).map(i => i.name);
  if (imgs.length < 2) return { error: `Mark at least 2 photos with 2 lines (or 4+ points) each — now ${imgs.length} photo(s) are ready.` };
  const seen = new Map();
  imgs.forEach(img => obsOf(img).forEach(o => seen.set(o.v, (seen.get(o.v) || 0) + 1)));
  const vids = [...fv].filter(v => (seen.get(v) || 0) >= 2);
  if (vids.length < 3) return { error: 'Mark the same lines / points in at least 2 photos.' };

  const cands = factorInit(imgs, obsOf);
  const tpl = new Map(), counts = {};
  for (const f of feats) {
    const i = (counts[f.kind] = (counts[f.kind] || 0) + 1) - 1;
    const t = P3.model.featureTemplate(f.kind, i);
    (f.kind === 'point' ? [f.a] : [f.a, f.b]).forEach((v, j) => { if (vids.includes(v)) tpl.set(v, t[j]); });
  }
  cands.push({ cams: new Map(), pts: tpl });
  let best = null;
  const tryCand = (cand, k, n) => {
    const r = completeAndAdjust(cand, imgs, obsOf, vids, 60, p => onProgress && onProgress(0.8 * (k + p) / n));
    if (r && (!best || r.cost < best.cost)) best = r;
  };
  cands.forEach((cand, k) => tryCand(cand, k, cands.length));
  const firstLine = feats.find(f => f.kind === 'line' && vids.includes(f.a) && vids.includes(f.b));
  if (!quick && (!best || best.rms > 1.5) && firstLine && vids.length <= 6) {
    const variants = [];
    for (const x of [0, 0.5, 1]) for (const w of [0.2, 0.45, 0.8]) variants.push({ x, w });
    variants.forEach((v, k) => {
      const pts = new Map([...tpl].map(([id, p]) => [id, p.clone()]));
      pts.set(firstLine.a, new T.Vector3(v.x, 0, -v.w));
      pts.set(firstLine.b, new T.Vector3(v.x, 0, v.w));
      tryCand({ cams: new Map(), pts }, k, variants.length);
    });
  }
  if (!best) return { error: 'Could not find a consistent placement — check the marks in the photos with the highest error.' };
  const res = bundle(best.cams, best.pts, best.obs, { iters: 150, scale: best.scale });
  return { res, used: best.used, obs: res.obs, scale: best.scale, skipped, starts: cands.length };
}

/** Frame without a direction marker: photos' average "up" → +Y, first line → X, sitting on the grid, sized to the photo ring. */
function autoFrame(pts, cams) {
  const P = [...pts.values()];
  if (!P.length) return null;
  const C = P.reduce((a, p) => a.add(p), new T.Vector3()).divideScalar(P.length);
  const Y = cams.reduce((a, c) => a.add(new T.Vector3(0, 1, 0).applyQuaternion(c.q)), new T.Vector3());
  if (Y.lengthSq() < 1e-12) Y.set(0, 1, 0);
  Y.normalize();
  const feats = P3.state.features;
  const lf = feats.find(f => f.kind !== 'point' && pts.has(f.a) && pts.has(f.b));
  const X = lf ? pts.get(lf.b).clone().sub(pts.get(lf.a)) : new T.Vector3(1, 0, 0);
  X.addScaledVector(Y, -X.dot(Y));
  if (X.lengthSq() < 1e-12) X.set(1, 0, 0).addScaledVector(Y, -Y.x);
  X.normalize();
  const Z = X.clone().cross(Y).normalize();
  const lenF = feats.find(f => f.length > 0 && f.kind !== 'point' && pts.has(f.a) && pts.has(f.b));
  let k;
  if (lenF) k = lenF.length / Math.max(1e-9, pts.get(lenF.a).distanceTo(pts.get(lenF.b)));
  else k = (+P3.settings.ringRadius || 6) / Math.max(1e-9, cams.reduce((a, c) => a + c.pos.distanceTo(C), 0) / cams.length);
  let m = new T.Matrix4().makeScale(k, k, k).multiply(new T.Matrix4().makeBasis(X, Y, Z).transpose()).multiply(new T.Matrix4().makeTranslation(-C.x, -C.y, -C.z));
  const minY = Math.min(...P.map(p => p.clone().applyMatrix4(m).y));
  m = new T.Matrix4().makeTranslation(0, -minY, 0).multiply(m);
  return m;
}

/**
 * Place every photo (and build the marked shape) from the lines / points marked in the photos.
 * Affine-factorisation + template starts, joint bundle adjustment, automatic line-orientation fixing,
 * then the result is put in a tidy frame (direction marker → +X, otherwise upright on the grid).
 */
solve.fromFeatures = ({ solveFov = false, onProgress, quick = false } = {}) => {
  const s = P3.state;
  const feats = s.features;
  if (!feats.length) return { error: 'Add markers first (lines and points to draw in each photo).' };
  P3.reindex();
  // try several end-matchings (geometric ones from both mirror solutions, plus photo-order continuity); keep the best fit
  const seenSets = new Set();
  const swapSets = [...geometricLineSwaps(feats, s.images), new Set(), initialLineSwaps(feats, s.images)].filter(sw => { const k = [...sw].sort().join(','); if (seenSets.has(k)) return false; seenSets.add(k); return true; });
  // Relabel loop: flip any photo's line that fits the current solution better the other way round,
  // re-run the bundle adjustment from the current result, repeat until nothing changes.
  const buildObs = (o, sw) => {
    const obs = [];
    o.used.forEach((img, ci) => (img.pins || []).forEach(p => {
      const fo = idx.featOf.get(p.v);
      if (!fo) return;
      let v = p.v;
      if (fo.f.kind === 'line' && sw.has(img.id + ':' + fo.f.id)) v = fo.end === 'a' ? fo.f.b : fo.f.a;
      if (o.res.pts.has(v)) obs.push({ ci, v, pv: p.v, u: p.x * img.w, vpx: p.y * img.h });
    }));
    return obs;
  };
  const relabel = (o, sw) => {
    let n = 0;
    for (let pass = 0; pass < 10; pass++) {
      const cands = [];
      o.used.forEach((img, ci) => {
        const c = o.res.cams[ci], m = pinMapOf(img);
        for (const f of feats) {
          if (f.kind !== 'line') continue;
          const A = o.res.pts.get(f.a), B = o.res.pts.get(f.b), pa = m.get(f.a), pb = m.get(f.b);
          if (!A || !B || !pa || !pb) continue;
          const key = img.id + ':' + f.id, isSw = sw.has(key);
          const p1 = isSw ? pb : pa, p2 = isSw ? pa : pb;
          const qa = projectPx(c, A), qb = projectPx(c, B);
          if (!qa || !qb) continue;
          const e = (q, p) => Math.hypot(q[0] - p.x * img.w, q[1] - p.y * img.h);
          const keep = e(qa, p1) + e(qb, p2), flip = e(qa, p2) + e(qb, p1);
          if (flip < keep - 0.5) cands.push({ key, gain: keep - flip, ratio: flip / keep });
        }
      });
      if (!cands.length) break;
      let pick = cands.filter(c => c.ratio < 0.7);
      if (!pick.length) pick = [cands.sort((a, b) => b.gain - a.gain)[0]];
      pick.forEach(c => (sw.has(c.key) ? sw.delete(c.key) : sw.add(c.key)));
      const obs = buildObs(o, sw);
      const r2 = bundle(o.res.cams, o.res.pts, obs, { iters: 100, scale: o.scale });
      if (r2.cost < o.res.cost) { o = { ...o, res: r2, obs: r2.obs }; n += pick.length; }
      else { pick.forEach(c => (sw.has(c.key) ? sw.delete(c.key) : sw.add(c.key))); break; }
    }
    return { o, n };
  };
  // Lines seen nearly end-on (short on screen) have an unreliable end order: leave them out of a first
  // solve, then let that solution decide their ends, then solve with everything.
  const drop = new Set();
  for (const f of feats.filter(x => x.kind === 'line')) {
    const lens = s.images.map(img => { const m = pinMapOf(img), a = m.get(f.a), b = m.get(f.b); return a && b ? Math.hypot((a.x - b.x) * img.w, (a.y - b.y) * img.h) : 0; });
    const mx = Math.max(...lens);
    s.images.forEach((img, i) => { if (lens[i] > 0 && lens[i] < 0.45 * mx) drop.add(img.id + ':' + f.id); });
  }
  const decideEnds = (o, sw) => {
    o.used.forEach((img, ci) => {
      const c = o.res.cams[ci], m = pinMapOf(img);
      for (const f of feats) {
        if (f.kind !== 'line') continue;
        const A = o.res.pts.get(f.a), B = o.res.pts.get(f.b), pa = m.get(f.a), pb = m.get(f.b);
        if (!A || !B || !pa || !pb) continue;
        const qa = projectPx(c, A), qb = projectPx(c, B);
        if (!qa || !qb) continue;
        const e = (q, p) => Math.hypot(q[0] - p.x * img.w, q[1] - p.y * img.h);
        const key = img.id + ':' + f.id;
        if (e(qa, pb) + e(qb, pa) < e(qa, pa) + e(qb, pb)) sw.add(key); else sw.delete(key);
      }
    });
  };
  let out = null, swap = null, flipped = 0;
  swapSets.forEach((sw0, k) => {
    const sw = new Set(sw0);
    const prog = p => onProgress && onProgress(0.7 * (k + p) / swapSets.length);
    let r = null;
    if (drop.size) {
      const r0 = solveOnce(feats, s.images, sw, { quick: true, onProgress: prog, drop });
      if (!r0.error) { decideEnds(r0, sw); r = solveOnce(feats, s.images, sw, { quick: true, onProgress: prog }); }
    }
    if (!r || r.error) r = solveOnce(feats, s.images, sw, { quick: true, onProgress: prog });
    if (r.error) { if (!out) out = r; return; }
    const rl = relabel(r, sw);
    r = rl.o;
    if (!out || out.error || r.res.cost < out.res.cost) { out = r; swap = sw; flipped = rl.n; }
  });
  if (out.error) return out;
  if (!quick && out.res.rms > 1.5) {
    const full = solveOnce(feats, s.images, swap, { onProgress: p => onProgress && onProgress(0.7 + 0.3 * p) });
    if (!full.error) { const rl = relabel(full, swap); if (rl.o.res.cost < out.res.cost) { out = rl.o; flipped += rl.n; } }
  }
  let res = out.res;
  if (solveFov) res = bundle(res.cams, res.pts, out.obs, { iters: 150, scale: out.scale, solveFov: true });
  const used = out.used;

  const ups = res.cams.map(c => new T.Vector3(0, 1, 0).applyQuaternion(c.q));
  const m = referenceFrame(res.pts, ups) || autoFrame(res.pts, res.cams);
  const rq = new T.Quaternion(), tp = new T.Vector3(), ts = new T.Vector3();
  if (m) m.decompose(tp, rq, ts);
  used.forEach((img, ci) => {
    const c = res.cams[ci];
    P3.cam.setPose(img, m ? c.pos.clone().applyMatrix4(m) : c.pos, m ? rq.clone().multiply(c.q) : c.q);
    if (solveFov) img.fov = U.round(c.fov, 3);
    img.placed = true;
  });
  for (const [v, p] of res.pts) idx.v.get(v).p = (m ? p.clone().applyMatrix4(m) : p).toArray().map(n => U.round(n, 6));
  for (const f of feats) if ((f.kind === 'point' ? [f.a] : [f.a, f.b]).every(v => res.pts.has(v))) f.solved = true;
  // store marks the canonical way round, so each line's first end means the same physical end in every photo
  swap = new Set();
  (res.obs || out.obs).forEach(o => { const fo = o.pv != null && idx.featOf.get(o.pv); if (fo && fo.f.kind === 'line' && fo.end === 'a' && o.v !== o.pv) swap.add(out.used[o.ci].id + ':' + fo.f.id); });
  for (const key of swap) {
    const [iid, fid] = key.split(':').map(Number);
    const img = idx.c.get(iid), f = idx.feat.get(fid);
    if (!img || !f) continue;
    for (const p of img.pins) { if (p.v === f.a) p.v = f.b; else if (p.v === f.b) p.v = f.a; }
  }
  P3.reindex();
  const perImg = used.map(img => ({ id: img.id, name: img.name, rms: solve.imageRms(img) }));
  const P = [...res.pts.values()];
  const cen = P.reduce((a, p) => a.add(p.clone()), new T.Vector3()).divideScalar(P.length);
  const cov = [0, 1, 2].map(i => [0, 1, 2].map(j => P.reduce((a, p) => a + (p.getComponent(i) - cen.getComponent(i)) * (p.getComponent(j) - cen.getComponent(j)), 0)));
  const ev = jacobiEigen(cov).values;
  const flat = ev[0] > 0 && ev[2] / ev[0] < 0.002;
  return { error: null, rms: res.rms, cams: used.length, points: res.pts.size, skipped: out.skipped, perImg, aligned: !!m, starts: out.starts, flat, flipped, unused: s.images.length - used.length };
};
})();
