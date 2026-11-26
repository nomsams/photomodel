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
})();
