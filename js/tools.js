/* PhotoModel 3D — interactive tools: select, point, line, face, triangulate, pin (match). */
(() => {
'use strict';
const T = window.THREE;
const P3 = window.P3;
const U = P3.util;
const vp = P3.vp;
const M = P3.model;
const idx = P3.idx;

const tools = (P3.tools = { current: 'select', defs: {} });
const st = { lineStart: null, facePts: [], rays: [], matchVid: null };
const RAY_COLORS = ['#ff6b6b', '#4fc3f7', '#7bd88f', '#ffd166', '#e06cff', '#57d9c5'];
const TOOL_NAMES = { select: 'Select', point: 'Point', line: 'Line', face: 'Face', triangulate: 'Triangulate', match: 'Pin' };

/* ------------------------------------------------------------------ helper visuals */
let snapObj = null, previewObj = null, raysObj = null, solvedObj = null;
function ensureHelpers() {
  if (snapObj) return;
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0], 3));
  snapObj = new T.Points(g, new T.PointsMaterial({ size: 15, sizeAttenuation: false, color: 0x22d3ee, depthTest: false, transparent: true, opacity: 0.9 }));
  snapObj.renderOrder = 20;
  snapObj.visible = false;
  previewObj = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0x22d3ee, depthTest: false, transparent: true, opacity: 0.85 }));
  previewObj.renderOrder = 19;
  previewObj.visible = false;
  raysObj = new T.Group();
  solvedObj = new T.Points(g.clone(), new T.PointsMaterial({ size: 17, sizeAttenuation: false, color: 0xffffff, depthTest: false }));
  solvedObj.renderOrder = 21;
  solvedObj.visible = false;
  vp.helperGroup.add(snapObj, previewObj, raysObj, solvedObj);
}

const SNAP = {
  vertex: [0xff9f1c, 'point'], midpoint: [0xffd166, 'midpoint'], edge: [0xe0e0e0, 'on line'],
  cloud: [0xe06cff, 'cloud point'], face: [0x7bd88f, 'on face'], plane: [0x22d3ee, 'work plane'],
};
function showSnap(r, extra) {
  ensureHelpers();
  if (!r) { snapObj.visible = false; P3.ui.coords(null); vp.requestRender(); return; }
  snapObj.position.copy(r.pos);
  snapObj.material.color.setHex((SNAP[r.kind] || SNAP.plane)[0]);
  snapObj.visible = true;
  P3.ui.coords(r.pos, (SNAP[r.kind] || SNAP.plane)[1] + (extra ? '  · ' + extra : ''));
  vp.requestRender();
}
function setPreview(points, closed = false) {
  ensureHelpers();
  if (!points || points.length < 2) { previewObj.visible = false; vp.requestRender(); return; }
  const arr = points.flatMap(p => [p.x, p.y, p.z]);
  if (closed) arr.push(points[0].x, points[0].y, points[0].z);
  previewObj.geometry.dispose();
  previewObj.geometry = new T.BufferGeometry();
  previewObj.geometry.setAttribute('position', new T.Float32BufferAttribute(arr, 3));
  previewObj.visible = true;
  vp.requestRender();
}
function clearHelpers() {
  ensureHelpers();
  snapObj.visible = false;
  previewObj.visible = false;
  vp.requestRender();
}

/* ------------------------------------------------------------------ point resolution with snapping */
function resolve(e) {
  if (!vp.inView(e)) return null;
  const v = vp.pick(e, { types: ['v'] });
  if (v) return { kind: 'vertex', id: v.id, pos: v.pos };
  if (P3.settings.snapEdges) {
    const ed = vp.pick(e, { types: ['e'] });
    if (ed) {
      const E = idx.e.get(ed.id);
      const A = M.vpos(E.a), B = M.vpos(E.b);
      const mid = A.clone().add(B).multiplyScalar(0.5);
      const sm = vp.toScreen(mid), L = vp.local(e);
      if (sm && Math.hypot(sm.x - L.x, sm.y - L.y) < (+P3.settings.snapRadius || 12)) return { kind: 'midpoint', pos: mid, edge: ed.id };
      const on = new T.Vector3();
      vp.ray(e).distanceSqToSegment(A, B, null, on);
      return { kind: 'edge', pos: on, edge: ed.id };
    }
  }
  const cp = vp.pickCloud(e);
  if (cp) return { kind: 'cloud', pos: cp };
  const f = vp.pick(e, { types: ['f'] });
  if (f && f.type === 'f') return { kind: 'face', pos: f.point.clone() };
  const p = vp.planePoint(e, !e.altKey);
  if (p) return { kind: 'plane', pos: p };
  return null;
}

function constrain(r, e, from) {
  if (!r || !e.shiftKey || !from || r.kind === 'vertex') return r;
  const d = r.pos.clone().sub(from);
  const ax = ['x', 'y', 'z'].reduce((a, k) => (Math.abs(d[k]) > Math.abs(d[a]) ? k : a), 'x');
  const p = from.clone();
  p[ax] += d[ax];
  return { kind: 'plane', pos: p };
}

/** Turn a resolved snap into a vertex id (creating it, and splitting the edge it sits on). */
function ensureVertex(r) {
  if (r.kind === 'vertex' && idx.v.has(r.id)) return r.id;
  let id;
  if ((r.kind === 'edge' || r.kind === 'midpoint') && idx.e.has(r.edge)) id = M.splitEdge(r.edge, r.pos);
  else id = M.addVertex(r.pos);
  r.kind = 'vertex';
  r.id = id;
  r.pos = M.vpos(id);
  return id;
}

function setHover(key) { if (vp.hover !== key) { vp.hover = key; vp.rebuild(); } }

/* ------------------------------------------------------------------ select tool (+ box select) */
tools.defs.select = {
  hint: () => vp.activeCam && !vp.alignMode
    ? 'Click to select · Drag = box select · Wheel = zoom photo, right-drag = pan · Double-click a camera to switch photo'
    : 'Click to select · Shift+drag = box select · Right-click = actions · Double-click a camera to look through its photo',
  hover(e) {
    const h = vp.pick(e);
    setHover(h ? h.type + ':' + h.id : null);
    P3.ui.coords(h && (h.pos || h.point) ? (h.pos || h.point) : null, h ? { v: 'point #' + h.id, e: 'line #' + h.id, f: 'face #' + h.id, c: 'photo' }[h.type] : null);
  },
  click(e) {
    const h = vp.pick(e);
    if (!h) { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) P3.sel.clear(); return; }
    const key = h.type + ':' + h.id;
    if (e.shiftKey || e.ctrlKey || e.metaKey) P3.sel.toggle(key);
    else P3.sel.set([key]);
  },
  rightClick(e) {
    const h = vp.pick(e);
    if (h && !P3.sel.has(h.type, h.id)) P3.sel.set([h.type + ':' + h.id]);
    P3.ui.contextMenu(e.clientX, e.clientY);
  },
  dblclick(e) {
    const h = vp.pick(e, { types: ['c'] });
    if (h && h.type === 'c') vp.enterCamera(h.id);
    else if (!h && vp.activeCam && vp.pz.z > 1) vp.resetPhotoZoom();
  },
};

/* ------------------------------------------------------------------ drawing tools */
tools.defs.point = {
  hint: () => 'Click to place a point — snaps to points, line midpoints, lines, point cloud, faces, then the work plane · Alt = no grid snap',
  hover(e) { showSnap(resolve(e)); },
  click(e) {
    const r = resolve(e);
    if (!r) return;
    if (r.kind === 'vertex') { P3.sel.set(['v:' + r.id]); return; }
    const id = ensureVertex(r);
    P3.history.commit(r.edge ? 'Add point on line' : 'Add point');
    P3.sel.set(['v:' + id]);
  },
};

tools.defs.line = {
  hint: () => st.lineStart
    ? 'Click the next point · Shift = lock to axis · Right-click, Enter or Esc to finish'
    : 'Click to start a line (snaps to points, midpoints, lines) · Lines chain until you finish',
  hover(e) {
    const r = constrain(resolve(e), e, st.lineStart && st.lineStart.pos);
    showSnap(r, st.lineStart && r ? 'length ' + U.len(r.pos.distanceTo(st.lineStart.pos)) : '');
    setPreview(st.lineStart && r ? [st.lineStart.pos, r.pos] : null);
  },
  click(e) {
    const r = constrain(resolve(e), e, st.lineStart && st.lineStart.pos);
    if (!r) return;
    if (!st.lineStart) { st.lineStart = r; P3.ui.hint(); vp.rebuild(); return; }
    if (r.kind === 'vertex' && st.lineStart.kind === 'vertex' && r.id === st.lineStart.id) return;
    if (r.pos.distanceTo(st.lineStart.pos) < 1e-9) return;
    const a = ensureVertex(st.lineStart), b = ensureVertex(r);
    M.addEdge(a, b);
    P3.history.commit('Add line');
    st.lineStart = { kind: 'vertex', id: b, pos: M.vpos(b) };
    setPreview(null);
  },
  rightClick() { this.cancel(); },
  enter() { this.cancel(); },
  cancel() {
    const had = !!st.lineStart;
    st.lineStart = null;
    setPreview(null);
    P3.ui.hint();
    vp.rebuild();
    return had;
  },
};

tools.defs.face = {
  hint: () => st.facePts.length
    ? `${st.facePts.length} corner(s) · click the first point or press Enter to close · Backspace = remove last · Esc = cancel`
    : 'Click 3+ corners in order to outline a face · Or select points and press Enter',
  hover(e) {
    const r = resolve(e);
    showSnap(r);
    const pts = st.facePts.map(p => p.pos);
    if (r) pts.push(r.pos);
    setPreview(pts.length >= 2 ? pts : null, pts.length >= 3);
  },
  click(e) {
    const r = resolve(e);
    if (!r) return;
    const first = st.facePts[0];
    if (st.facePts.length >= 3 && r.kind === 'vertex' && first.kind === 'vertex' && r.id === first.id) return finishFace();
    if (r.kind === 'vertex' && st.facePts.some(p => p.kind === 'vertex' && p.id === r.id)) return;
    st.facePts.push(r);
    P3.ui.hint();
    vp.rebuild();
  },
  rightClick() { if (st.facePts.length >= 3) finishFace(); else this.cancel(); },
  enter() {
    if (st.facePts.length >= 3) return finishFace();
    if (P3.sel.ids('v').length >= 3) return P3.actions.makeFace();
    P3.ui.toast('A face needs at least 3 corners');
  },
  backspace() {
    if (!st.facePts.length) return false;
    st.facePts.pop();
    P3.ui.hint();
    vp.rebuild();
    setPreview(st.facePts.length >= 2 ? st.facePts.map(p => p.pos) : null);
    return true;
  },
  cancel() {
    const had = st.facePts.length > 0;
    st.facePts = [];
    setPreview(null);
    P3.ui.hint();
    vp.rebuild();
    return had;
  },
};
function finishFace() {
  const ids = st.facePts.map(ensureVertex);
  const fid = M.addFace(ids);
  st.facePts = [];
  setPreview(null);
  if (fid) { P3.history.commit('Add face'); P3.sel.set(['f:' + fid]); }
  else P3.ui.toast('Could not create face (need 3 distinct corners)', 'error');
  P3.ui.hint();
}

/* ------------------------------------------------------------------ triangulate */
tools.defs.triangulate = {
  hint: () => {
    if (!vp.activeCam) return 'Triangulate: first look through a photo (double-click a camera or a photo in the list)';
    const n = new Set(st.rays.map(r => r.img)).size;
    if (n === 0) return 'Click a feature in this photo, then switch photo ([ / ]) and click the same feature · wheel = zoom photo';
    if (n === 1) return '1 ray — switch photo ([ / ]) and click the same feature (it lies on the coloured line)';
    const sol = M.solveRays(st.rays);
    return `${n} rays · spread ${sol ? U.len(sol.error, 4) : '—'} · Enter = create point · Esc = clear rays`;
  },
  hover() { if (vp.activeCam) P3.ui.coords(null); },
  click(e) {
    if (!vp.activeCam) { P3.ui.toast('Look through a photo first (double-click a camera)'); return; }
    if (!vp.inView(e)) return;
    const img = idx.c.get(vp.activeCam);
    const l = vp.local(e);
    const n = vp.screenToImg(l.x, l.y);
    const ray = P3.cam.ray(img, n.x, n.y);
    st.rays = st.rays.filter(r => r.img !== vp.activeCam);
    st.rays.push({ img: vp.activeCam, o: ray.o, d: ray.d, x: n.x, y: n.y });
    drawRays();
    P3.ui.hint();
  },
  enter() {
    const sol = M.solveRays(st.rays);
    if (!sol) { P3.ui.toast('Need rays from at least 2 different photos (that are not parallel)', 'error'); return; }
    if (sol.behind) P3.ui.toast('Warning: the point is behind one of the cameras — check the clicks', 'error');
    const id = M.addVertex(sol.point);
    for (const r of st.rays) { const img = idx.c.get(r.img); if (img) M.setPin(img, id, r.x, r.y); }
    P3.history.commit('Triangulate point');
    P3.sel.set(['v:' + id]);
    st.rays = [];
    drawRays();
    P3.ui.hint();
    P3.ui.toast(`Point #${id} created and pinned in ${new Set(P3.idx.pins.get(id)?.map(p => p.img.id)).size} photos`, 'ok');
  },
  cancel() {
    const had = st.rays.length > 0;
    st.rays = [];
    drawRays();
    P3.ui.hint();
    return had;
  },
};
function drawRays() {
  ensureHelpers();
  for (const c of [...raysObj.children]) { raysObj.remove(c); c.geometry.dispose(); c.material.dispose(); }
  st.rays.forEach((r, i) => {
    const far = r.o.clone().addScaledVector(r.d, 500);
    const l = new T.Line(new T.BufferGeometry().setFromPoints([r.o, far]), new T.LineBasicMaterial({ color: RAY_COLORS[i % RAY_COLORS.length], depthTest: false, transparent: true, opacity: 0.9 }));
    l.renderOrder = 18;
    raysObj.add(l);
  });
  const sol = M.solveRays(st.rays);
  solvedObj.visible = !!sol;
  if (sol) solvedObj.position.copy(sol.point);
  vp.requestRender();
}

/* ------------------------------------------------------------------ pin (match) tool */
tools.defs.match = {
  hint: () => {
    if (!vp.activeCam) return 'Pin tool: look through a photo first, then mark where model points appear in it';
    if (st.matchVid != null) return `Click where point #${st.matchVid} appears in this photo · Esc = cancel · wheel = zoom`;
    return 'Click a model point, then click where it appears in this photo · Drag pins to adjust · Right-click a pin to remove · 4+ pins → Solve';
  },
  hover(e) {
    if (!vp.activeCam) return;
    const h = vp.pick(e, { types: ['v'] });
    setHover(h ? 'v:' + h.id : null);
  },
  click(e) {
    if (!vp.activeCam) { P3.ui.toast('Look through a photo first (double-click a camera)'); return; }
    if (!vp.inView(e)) return;
    const h = vp.pick(e, { types: ['v'] });
    if (h && h.id !== st.matchVid) { st.matchVid = h.id; P3.sel.set(['v:' + h.id]); P3.ui.hint(); vp.requestRender(); return; }
    if (st.matchVid == null || !idx.v.has(st.matchVid)) { st.matchVid = null; return; }
    const img = idx.c.get(vp.activeCam);
    const l = vp.local(e);
    const n = vp.screenToImg(l.x, l.y);
    M.setPin(img, st.matchVid, n.x, n.y);
    const vid = st.matchVid;
    st.matchVid = null;
    P3.history.commit('Pin point');
    const pins = img.pins.length;
    P3.ui.toast(`Pinned point #${vid} — ${pins} pin${pins === 1 ? '' : 's'} in this photo${pins >= 4 ? ' · ready to Solve' : ''}`, 'ok');
    P3.ui.hint();
  },
  cancel() {
    const had = st.matchVid != null;
    st.matchVid = null;
    P3.ui.hint();
    vp.requestRender();
    return had;
  },
};
tools.matchVertex = () => (tools.current === 'match' ? st.matchVid : null);

/* ------------------------------------------------------------------ public API */
tools.tool = () => tools.defs[tools.current];
tools.label = () => TOOL_NAMES[tools.current] || tools.current;

tools.set = name => {
  if (!tools.defs[name]) return;
  const t = tools.tool();
  if (t.cancel) t.cancel();
  tools.current = name;
  clearHelpers();
  vp.hover = null;
  if (name === 'match') { const v = P3.sel.ids('v'); st.matchVid = v.length === 1 ? v[0] : null; }
  vp.rebuild();
  vp.updateGizmo();
  P3.emit('tool', name);
  P3.ui.hint();
};

tools.cancel = () => { const t = tools.tool(); return t.cancel ? !!t.cancel() : false; };
tools.enter = () => { const t = tools.tool(); if (t.enter) { t.enter(); return true; } return false; };
tools.backspace = () => { const t = tools.tool(); return t.backspace ? t.backspace() : false; };
tools.hint = () => { const t = tools.tool(); return typeof t.hint === 'function' ? t.hint() : t.hint || ''; };

tools.pendingVertexIds = () => {
  const s = new Set();
  if (tools.current === 'line' && st.lineStart && st.lineStart.kind === 'vertex') s.add(st.lineStart.id);
  if (tools.current === 'face') st.facePts.forEach(p => p.kind === 'vertex' && s.add(p.id));
  if (tools.current === 'match' && st.matchVid != null) s.add(st.matchVid);
  return s;
};

tools.init = () => {
  ensureHelpers();
  const el = vp.dom();
  const wrap = vp.wrap();
  const boxEl = document.getElementById('boxSel');
  let down = null, box = null;

  // Box select: Shift+drag (or plain drag in a locked photo view). Captured before OrbitControls sees it.
  document.getElementById('viewport').addEventListener('pointerdown', e => {
    if (tools.current !== 'select' || e.button !== 0 || vp.gizmoActive()) return;
    const photoLocked = vp.activeCam && !vp.alignMode;
    if (!e.shiftKey && !photoLocked) return;
    const l = vp.local(e);
    box = { x: l.x, y: l.y, x1: l.x, y1: l.y, add: e.shiftKey, sub: e.altKey, ev: e };
    e.stopPropagation();
    e.preventDefault();
  }, true);
  window.addEventListener('pointermove', e => {
    if (!box) return;
    const l = vp.local(e);
    box.x1 = l.x; box.y1 = l.y;
    const x = Math.min(box.x, box.x1), y = Math.min(box.y, box.y1);
    Object.assign(boxEl.style, { left: x + 'px', top: y + 'px', width: Math.abs(box.x1 - box.x) + 'px', height: Math.abs(box.y1 - box.y) + 'px' });
    if (Math.hypot(box.x1 - box.x, box.y1 - box.y) > 4) boxEl.classList.remove('hidden');
  });
  window.addEventListener('pointerup', e => {
    if (!box) return;
    const b = box;
    box = null;
    boxEl.classList.add('hidden');
    if (Math.hypot(b.x1 - b.x, b.y1 - b.y) <= 4) { tools.defs.select.click(e); return; }
    const keys = vp.pickRect(Math.min(b.x, b.x1), Math.min(b.y, b.y1), Math.max(b.x, b.x1), Math.max(b.y, b.y1));
    if (b.sub) P3.sel.remove(keys);
    else if (b.add) P3.sel.add(keys);
    else P3.sel.set(keys);
  });

  el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, gizmo: vp.gizmoActive() }; });
  el.addEventListener('pointermove', e => {
    if (e.buttons || box) return;
    const t = tools.tool();
    if (t.hover) t.hover(e);
  });
  el.addEventListener('pointerup', e => {
    if (!down) return;
    const d = down;
    down = null;
    if (d.gizmo) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    const t = tools.tool();
    if (e.button === 0 && t.click) t.click(e);
    else if (e.button === 2 && t.rightClick) t.rightClick(e);
  });
  el.addEventListener('dblclick', e => { const t = tools.tool(); if (t.dblclick) t.dblclick(e); });
  el.addEventListener('contextmenu', e => e.preventDefault());
  wrap.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerleave', () => {
    if (vp.hover) { vp.hover = null; vp.rebuild(); }
    if (snapObj) { snapObj.visible = false; vp.requestRender(); }
  });
  P3.on('view', () => P3.ui.hint());
  P3.on('change', info => {
    if (info && info.restore) {
      if (st.lineStart && st.lineStart.kind === 'vertex' && !idx.v.has(st.lineStart.id)) st.lineStart.kind = 'plane';
      st.facePts.forEach(p => { if (p.kind === 'vertex' && !idx.v.has(p.id)) p.kind = 'plane'; });
      if (st.matchVid != null && !idx.v.has(st.matchVid)) st.matchVid = null;
      st.rays = st.rays.filter(r => idx.c.has(r.img));
      drawRays();
    }
  });
};
})();
