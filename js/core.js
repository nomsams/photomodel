/* PhotoModel 3D — core: events, settings, project state, selection, undo/redo, model operations. */
(() => {
'use strict';
const T = window.THREE;
const P3 = (window.P3 = {});
P3.VERSION = '2.1.0';

/* ------------------------------------------------------------------ events */
const listeners = {};
P3.on = (ev, fn) => { (listeners[ev] ||= []).push(fn); };
P3.emit = (ev, ...args) => {
  for (const fn of listeners[ev] || []) {
    try { fn(...args); } catch (err) { console.error('[P3 ' + ev + ']', err); }
  }
};

/* ------------------------------------------------------------------ utils */
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const U = (P3.util = {
  D2R, R2D,
  clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
  round: (v, d = 4) => { const m = 10 ** d; return Math.round(v * m) / m; },
  fmt: (n, d = 3) => (Math.abs(n) < 10 ** -(d + 1) ? 0 : n).toFixed(d),
  debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  },
  readFile(file, as = 'dataURL') {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      if (as === 'text') r.readAsText(file);
      else if (as === 'buffer') r.readAsArrayBuffer(file);
      else r.readAsDataURL(file);
    });
  },
  loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('Could not decode image'));
      im.src = src;
    });
  },
  safeName: s => (String(s || 'project').replace(/[^\w\-. ]+/g, '-').replace(/\s*-+\s*/g, '-').replace(/^-+|-+$/g, '').trim() || 'project'),
  ext: name => (String(name).match(/\.([^.]+)$/) || [, ''])[1].toLowerCase(),
  // Yield so the UI can paint. Hidden / background pages may pause animation frames, so a timer also resolves it.
  nextFrame: () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 50); }),
  /** Format a length with the project unit. */
  len: (v, d = 3) => U.fmt(v, d) + (P3.settings.units && P3.settings.units !== 'units' ? ' ' + P3.settings.units : ''),
});

/* ------------------------------------------------------------------ settings */
const DEFAULTS = (P3.DEFAULT_SETTINGS = {
  theme: 'dark',
  accent: 'orange',
  units: 'm',
  vertexSize: 9,
  lineWidth: 2.5,
  faceOpacity: 0.7,
  xrayVertices: true,
  vertexColor: '#f2f4f8',
  lineColor: '#4fc3f7',
  faceColor: '#8fa6c6',
  showAxes: true,
  overlayOpacity: 0.55,
  overlayMode: 'over',
  showFrustums: true,
  frustumSize: 0.6,
  frustumImageOpacity: 0.85,
  showPins: true,
  showLoupe: true,
  loupeZoom: 4,
  showGrid: true,
  gridSize: 1,
  gridDivisions: 20,
  snapToGrid: false,
  snapStep: 0.25,
  snapRadius: 12,
  snapEdges: true,
  workPlane: 'XZ',
  workPlaneOffset: 0,
  customPlane: null, // {o:[x,y,z], n:[x,y,z], u:[x,y,z]} when workPlane === 'custom'
  stickToFace: true,
  autoSolve: true,
  photoMoveSpeed: 0.5,
  defaultFov: 50,
  useExifFov: true,
  maxImageSize: 2048,
  ringRadius: 6,
  ringHeight: 1.5,
  autosave: true,
  undoLimit: 200,
  cloudPointSize: 2,
});
P3.ACCENTS = { orange: '#ff8a1f', blue: '#3b8cff', violet: '#8b6cff', green: '#19c37d', pink: '#f0569b' };
P3.settings = Object.assign({}, DEFAULTS);
try { Object.assign(P3.settings, JSON.parse(localStorage.getItem('p3.settings') || '{}')); } catch { /* ignore */ }
const persistSettings = () => { try { localStorage.setItem('p3.settings', JSON.stringify(P3.settings)); } catch { /* ignore */ } };
P3.setSetting = (key, value) => {
  if (P3.settings[key] === value) return;
  P3.settings[key] = value;
  persistSettings();
  P3.emit('settings', key);
};
P3.resetSettings = () => {
  Object.assign(P3.settings, DEFAULTS);
  persistSettings();
  P3.emit('settings', '*');
};

/* ------------------------------------------------------------------ state
   Everything inside P3.state is plain JSON and is what undo/redo snapshots.
   Image pixels live in P3.images (id -> {src, el, thumb, texEl}) and are never part of history.
   img.pins = [{v: vertexId, x, y}] — where vertex v appears in this photo (x, y normalised 0..1, y down). */
P3.blankState = () => ({ nextId: 1, images: [], vertices: [], edges: [], faces: [], objects: [], features: [], cloudMatrix: null });
/** Point-cloud placement in the scene (similarity transform, undoable because it lives in state). */
P3.cloudMatrix = () => (P3.state.cloudMatrix ? new T.Matrix4().fromArray(P3.state.cloudMatrix) : new T.Matrix4());
P3.state = P3.blankState();
P3.images = new Map();
P3.cloud = null; // {name, positions:Float32Array, colors:Float32Array|null, visible}
P3.project = { name: 'Untitled project' };
P3.newId = () => P3.state.nextId++;

P3.registerImage = async (id, src, into = P3.images) => {
  const el = await U.loadImage(src);
  const w = el.naturalWidth, h = el.naturalHeight;
  const mk = max => {
    const s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
    return c;
  };
  const rec = { src, el, thumb: mk(220).toDataURL('image/jpeg', 0.82), texEl: mk(1024) };
  into.set(id, rec);
  return rec;
};

/** Make older / imported states complete. */
P3.normalizeState = st => {
  const s = Object.assign(P3.blankState(), st);
  s.images.forEach(i => { i.pins ||= []; if (i.visible === undefined) i.visible = true; i.rot ||= [0, 0, 0]; i.pos ||= [0, 0, 0]; });
  s.objects.forEach(o => { o.faces ||= []; o.edges ||= []; if (o.visible === undefined) o.visible = true; });
  s.features ||= [];
  if (!s.cloudMatrix && s.cloudScale > 0 && s.cloudScale !== 1) s.cloudMatrix = new T.Matrix4().makeScale(s.cloudScale, s.cloudScale, s.cloudScale).toArray();
  delete s.cloudScale;
  if (!s.cloudMatrix) s.cloudMatrix = null;
  const maxId = Math.max(0, ...s.vertices.map(v => v.id), ...s.edges.map(e => e.id), ...s.faces.map(f => f.id), ...s.images.map(i => i.id), ...s.objects.map(o => o.id));
  s.nextId = Math.max(s.nextId || 1, maxId + 1);
  return s;
};

/* ------------------------------------------------------------------ index */
const idx = (P3.idx = {
  v: new Map(), e: new Map(), f: new Map(), c: new Map(), o: new Map(),
  edgeKey: new Map(), faceObj: new Map(), edgeObj: new Map(), pins: new Map(), feat: new Map(), featOf: new Map(), unsolved: new Set(),
  hidden: { v: new Set(), e: new Set(), f: new Set() },
});
const ekey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
P3.edgeKey = ekey;

P3.reindex = () => {
  const s = P3.state;
  for (const k of ['v', 'e', 'f', 'c', 'o', 'edgeKey', 'faceObj', 'edgeObj', 'pins', 'feat', 'featOf', 'unsolved']) idx[k].clear();
  s.vertices.forEach(v => idx.v.set(v.id, v));
  s.edges.forEach(e => { idx.e.set(e.id, e); idx.edgeKey.set(ekey(e.a, e.b), e); });
  s.faces.forEach(f => idx.f.set(f.id, f));
  s.images.forEach(i => {
    idx.c.set(i.id, i);
    i.pins = (i.pins || []).filter(p => idx.v.has(p.v));
    i.pins.forEach(p => { if (!idx.pins.has(p.v)) idx.pins.set(p.v, []); idx.pins.get(p.v).push({ img: i, pin: p }); });
  });
  s.objects.forEach(o => {
    idx.o.set(o.id, o);
    o.faces = o.faces.filter(id => idx.f.has(id));
    o.edges = o.edges.filter(id => idx.e.has(id));
    o.faces.forEach(id => idx.faceObj.set(id, o));
    o.edges.forEach(id => idx.edgeObj.set(id, o));
  });
  for (const f of s.faces) {
    const o = idx.faceObj.get(f.id);
    if (!o) continue;
    for (let i = 0; i < f.v.length; i++) {
      const e = idx.edgeKey.get(ekey(f.v[i], f.v[(i + 1) % f.v.length]));
      if (e && !idx.edgeObj.has(e.id)) idx.edgeObj.set(e.id, o);
    }
  }
  const H = { v: new Set(), e: new Set(), f: new Set() };
  const use = new Map();
  const mark = (vid, vis) => use.set(vid, (use.get(vid) || false) || vis);
  for (const e of s.edges) {
    const o = idx.edgeObj.get(e.id);
    const vis = !(o && o.visible === false);
    if (!vis) H.e.add(e.id);
    mark(e.a, vis); mark(e.b, vis);
  }
  for (const f of s.faces) {
    const o = idx.faceObj.get(f.id);
    const vis = !(o && o.visible === false);
    if (!vis) H.f.add(f.id);
    f.v.forEach(v => mark(v, vis));
  }
  for (const [vid, vis] of use) if (!vis) H.v.add(vid);
  // Features: drop ones whose points were deleted; points of unsolved features are hidden until solved.
  s.features = (s.features || []).filter(f => idx.v.has(f.a) && (f.kind === 'point' || idx.v.has(f.b)));
  for (const f of s.features) {
    idx.feat.set(f.id, f);
    idx.featOf.set(f.a, { f, end: 'a' });
    if (f.kind !== 'point') idx.featOf.set(f.b, { f, end: 'b' });
    if (!f.solved) { idx.unsolved.add(f.a); if (f.kind !== 'point') idx.unsolved.add(f.b); }
  }
  for (const v of idx.unsolved) H.v.add(v);
  for (const e of s.edges) if (idx.unsolved.has(e.a) || idx.unsolved.has(e.b)) H.e.add(e.id);
  for (const f of s.faces) if (f.v.some(v => idx.unsolved.has(v))) H.f.add(f.id);
  idx.hidden = H;
};

/** Live update (no history entry): used while dragging gizmos, sliders, pins… */
P3.touch = (info = {}) => {
  P3.reindex();
  P3.emit('change', Object.assign({ live: true }, info));
};

/* ------------------------------------------------------------------ selection */
const sel = (P3.sel = {
  list: [],
  key: (t, id) => t + ':' + id,
  has(t, id) { return this.list.includes(t + ':' + id); },
  ids(t) { return this.list.filter(k => k[0] === t).map(k => +k.slice(2)); },
  set(keys, silent) { this.list = [...new Set(keys)]; if (!silent) P3.emit('selection'); },
  add(keys) { this.set(this.list.concat(keys)); },
  remove(keys) { const r = new Set(keys); this.set(this.list.filter(k => !r.has(k))); },
  toggle(key) {
    const i = this.list.indexOf(key);
    if (i >= 0) this.list.splice(i, 1); else this.list.push(key);
    P3.emit('selection');
  },
  clear(silent) { if (!this.list.length) return; this.list = []; if (!silent) P3.emit('selection'); },
  prune() {
    const n = this.list.length;
    this.list = this.list.filter(k => idx[k[0]] && idx[k[0]].has(+k.slice(2)));
    return n !== this.list.length;
  },
  get empty() { return this.list.length === 0; },
});

/* ------------------------------------------------------------------ history (undo / redo) */
const H = (P3.history = {
  undoStack: [],
  redoStack: [],
  current: null,
  savedSnap: null,
  snap: () => JSON.stringify(P3.state),
  reset(saved = true) {
    this.undoStack = [];
    this.redoStack = [];
    this.current = this.snap();
    this.savedSnap = saved ? this.current : null;
    P3.emit('history');
  },
  markSaved() { this.savedSnap = this.current; P3.emit('history'); },
  get dirty() { return this.current !== this.savedSnap; },
  commit(label = 'Edit') {
    P3.reindex();
    const s = this.snap();
    if (s !== this.current) {
      this.undoStack.push({ s: this.current, label });
      const lim = Math.max(10, P3.settings.undoLimit | 0);
      while (this.undoStack.length > lim) this.undoStack.shift();
      this.redoStack = [];
      this.current = s;
    }
    if (sel.prune()) P3.emit('selection');
    P3.emit('change', { live: false, label });
    P3.emit('history');
  },
  /** Fold the current state into the latest undo step (e.g. auto-solve right after a mark). */
  amend() {
    P3.reindex();
    this.current = this.snap();
    if (sel.prune()) P3.emit('selection');
    P3.emit('change', { live: false, label: 'amend' });
    P3.emit('history');
  },
  undo() {
    const it = this.undoStack.pop();
    if (!it) return null;
    this.redoStack.push({ s: this.current, label: it.label });
    this.current = it.s;
    this.restore(it.s);
    return it.label;
  },
  redo() {
    const it = this.redoStack.pop();
    if (!it) return null;
    this.undoStack.push({ s: this.current, label: it.label });
    this.current = it.s;
    this.restore(it.s);
    return it.label;
  },
  restore(s) {
    P3.state = JSON.parse(s);
    P3.reindex();
    sel.prune();
    P3.emit('change', { live: false, restore: true });
    P3.emit('selection');
    P3.emit('cloud');
    P3.emit('history');
  },
  get canUndo() { return this.undoStack.length > 0; },
  get canRedo() { return this.redoStack.length > 0; },
});

/* ------------------------------------------------------------------ camera (photo) pose helpers
   img.pos = [x,y,z]; img.rot = [pitch, yaw, roll] degrees, Euler 'YXZ'. Looks down -Z, +Y up. img.fov = vertical FOV. */
const cam = (P3.cam = {
  quat: img => new T.Quaternion().setFromEuler(new T.Euler(img.rot[0] * D2R, img.rot[1] * D2R, img.rot[2] * D2R, 'YXZ')),
  setPose(img, pos, quat) {
    img.pos = [U.round(pos.x, 5), U.round(pos.y, 5), U.round(pos.z, 5)];
    const e = new T.Euler().setFromQuaternion(quat, 'YXZ');
    img.rot = [e.x, e.y, e.z].map(v => U.round(v * R2D, 4));
  },
  setFromObject(img, obj) { this.setPose(img, obj.position, obj.quaternion); },
  lookQuat(eye, target) {
    const m = new T.Matrix4().lookAt(eye, target, new T.Vector3(0, 1, 0));
    return new T.Quaternion().setFromRotationMatrix(m);
  },
  lookAt(img, target) {
    const eye = new T.Vector3().fromArray(img.pos);
    if (eye.distanceTo(target) < 1e-6) return;
    const roll = img.rot[2];
    this.setPose(img, eye, this.lookQuat(eye, target));
    img.rot[2] = roll;
  },
  forward: img => new T.Vector3(0, 0, -1).applyQuaternion(cam.quat(img)),
  position: img => new T.Vector3().fromArray(img.pos),
  focalPx: img => (img.h / 2) / Math.tan((img.fov * D2R) / 2),
  /** Project world point to normalised image coords {x,y} (0..1, y down), or null if behind. */
  project(img, X, q = cam.quat(img)) {
    const c = X.clone().sub(cam.position(img)).applyQuaternion(q.clone().invert());
    if (c.z > -1e-9) return null;
    const th = Math.tan((img.fov * D2R) / 2), a = img.w / img.h;
    return { x: ((c.x / -c.z) / (th * a) + 1) / 2, y: (1 - (c.y / -c.z) / th) / 2 };
  },
  /** World-space ray through normalised image coords. */
  ray(img, x, y) {
    const th = Math.tan((img.fov * D2R) / 2), a = img.w / img.h;
    const d = new T.Vector3((2 * x - 1) * th * a, (1 - 2 * y) * th, -1).applyQuaternion(cam.quat(img)).normalize();
    return { o: cam.position(img), d };
  },
  /** 35 mm-equivalent focal length → vertical FOV for an image of w×h (diagonal-based). */
  fovFrom35mm(f35, w, h) {
    const fovD = 2 * Math.atan(43.2666 / (2 * f35));
    return 2 * Math.atan(Math.tan(fovD / 2) * h / Math.hypot(w, h)) * R2D;
  },
});

/* ------------------------------------------------------------------ geometry helpers */
P3.geom = {
  normal(pts) {
    const n = new T.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      n.x += (a.y - b.y) * (a.z + b.z);
      n.y += (a.z - b.z) * (a.x + b.x);
      n.z += (a.x - b.x) * (a.y + b.y);
    }
    return n.lengthSq() > 1e-20 ? n.normalize() : n;
  },
  triangulate(pts) {
    const n = pts.length;
    if (n < 3) return [];
    if (n === 3) return [[0, 1, 2]];
    const fan = () => { const r = []; for (let i = 1; i < n - 1; i++) r.push([0, i, i + 1]); return r; };
    const nrm = this.normal(pts);
    if (nrm.lengthSq() < 0.5) return fan();
    const u = Math.abs(nrm.x) < 0.9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0);
    u.cross(nrm).normalize();
    const v = nrm.clone().cross(u);
    const contour = pts.map(p => new T.Vector2(p.dot(u), p.dot(v)));
    try {
      const tris = T.ShapeUtils.triangulateShape(contour, []);
      return tris.length ? tris : fan();
    } catch { return fan(); }
  },
  polygonArea(pts) {
    let a = 0;
    const ab = new T.Vector3(), ac = new T.Vector3();
    for (const [i, j, k] of this.triangulate(pts)) a += ab.subVectors(pts[j], pts[i]).cross(ac.subVectors(pts[k], pts[i])).length() / 2;
    return a;
  },
};

/* ------------------------------------------------------------------ model operations
   These mutate P3.state; the caller then calls P3.history.commit(label). */
const S = () => P3.state;
const M = (P3.model = {
  vpos(id) { const v = idx.v.get(id); return v ? new T.Vector3().fromArray(v.p) : null; },

  addVertex(p) {
    const v = { id: P3.newId(), p: [U.round(p.x, 5), U.round(p.y, 5), U.round(p.z, 5)] };
    S().vertices.push(v);
    idx.v.set(v.id, v);
    return v.id;
  },
  findEdge(a, b) { return idx.edgeKey.get(ekey(a, b)) || null; },
  addEdge(a, b) {
    if (a === b || !idx.v.has(a) || !idx.v.has(b)) return null;
    const ex = M.findEdge(a, b);
    if (ex) return ex.id;
    const e = { id: P3.newId(), a, b };
    S().edges.push(e);
    idx.e.set(e.id, e);
    idx.edgeKey.set(ekey(a, b), e);
    return e.id;
  },
  addFace(vids) {
    const v = [];
    for (const id of vids) if (v[v.length - 1] !== id && !v.includes(id)) v.push(id);
    if (v.length < 3) return null;
    for (let i = 0; i < v.length; i++) M.addEdge(v[i], v[(i + 1) % v.length]);
    const f = { id: P3.newId(), v };
    S().faces.push(f);
    idx.f.set(f.id, f);
    return f.id;
  },
  connectChain(vids) {
    let n = 0;
    for (let i = 0; i < vids.length - 1; i++) if (M.addEdge(vids[i], vids[i + 1]) != null) n++;
    return n;
  },
  setPin(img, vid, x, y) {
    img.pins ||= [];
    const p = img.pins.find(q => q.v === vid);
    const nx = U.round(U.clamp(x, 0, 1), 6), ny = U.round(U.clamp(y, 0, 1), 6);
    if (p) { p.x = nx; p.y = ny; } else img.pins.push({ v: vid, x: nx, y: ny });
  },
  removePin(img, vid) { img.pins = (img.pins || []).filter(p => p.v !== vid); },

  selectedVertexIds() {
    const out = new Set(sel.ids('v'));
    sel.ids('e').forEach(id => { const e = idx.e.get(id); if (e) { out.add(e.a); out.add(e.b); } });
    sel.ids('f').forEach(id => { const f = idx.f.get(id); if (f) f.v.forEach(v => out.add(v)); });
    return [...out].filter(id => idx.v.has(id));
  },
  centroid(vids) {
    const c = new T.Vector3();
    if (!vids.length) return c;
    vids.forEach(id => c.add(M.vpos(id)));
    return c.divideScalar(vids.length);
  },

  deleteSelection() {
    const s = S();
    const dv = new Set(sel.ids('v')), de = new Set(sel.ids('e')), df = new Set(sel.ids('f')), dc = new Set(sel.ids('c'));
    for (const e of s.edges) if (dv.has(e.a) || dv.has(e.b)) de.add(e.id);
    const deKeys = new Set([...de].map(id => idx.e.get(id)).filter(Boolean).map(e => ekey(e.a, e.b)));
    for (const f of s.faces) {
      if (f.v.some(v => dv.has(v))) { df.add(f.id); continue; }
      for (let i = 0; i < f.v.length; i++) if (deKeys.has(ekey(f.v[i], f.v[(i + 1) % f.v.length]))) { df.add(f.id); break; }
    }
    s.vertices = s.vertices.filter(v => !dv.has(v.id));
    s.edges = s.edges.filter(e => !de.has(e.id));
    s.faces = s.faces.filter(f => !df.has(f.id));
    s.images = s.images.filter(i => !dc.has(i.id));
    s.images.forEach(i => { i.pins = (i.pins || []).filter(p => !dv.has(p.v)); });
    M.cleanObjects();
    sel.clear(true);
    return dv.size + de.size + df.size + dc.size;
  },
  cleanObjects() {
    const s = S();
    const fs = new Set(s.faces.map(f => f.id)), es = new Set(s.edges.map(e => e.id));
    s.objects.forEach(o => { o.faces = o.faces.filter(id => fs.has(id)); o.edges = o.edges.filter(id => es.has(id)); });
    s.objects = s.objects.filter(o => o.faces.length || o.edges.length);
  },

  mergeVertices(ids) {
    ids = ids.filter(id => idx.v.has(id));
    if (ids.length < 2) return null;
    const s = S();
    const keep = ids[0];
    idx.v.get(keep).p = M.centroid(ids).toArray().map(n => U.round(n, 5));
    const rm = new Set(ids.slice(1));
    const map = id => (rm.has(id) ? keep : id);
    const seen = new Set();
    s.edges = s.edges.filter(e => {
      e.a = map(e.a); e.b = map(e.b);
      if (e.a === e.b) return false;
      const k = ekey(e.a, e.b);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    s.faces = s.faces.filter(f => {
      const v = [];
      for (const id of f.v.map(map)) if (v[v.length - 1] !== id) v.push(id);
      while (v.length > 1 && v[0] === v[v.length - 1]) v.pop();
      f.v = v;
      return new Set(v).size >= 3 && new Set(v).size === v.length;
    });
    // pins: remap; keep one pin per vertex per photo
    s.images.forEach(img => {
      const out = new Map();
      for (const p of img.pins || []) { const v = map(p.v); if (!out.has(v) || p.v === keep) out.set(v, { v, x: p.x, y: p.y }); }
      img.pins = [...out.values()];
    });
    s.vertices = s.vertices.filter(v => !rm.has(v.id));
    M.cleanObjects();
    return keep;
  },

  /** Insert a vertex on an edge (at `pos`, default the middle), updating faces that use it. */
  splitEdge(eid, pos) {
    const e = idx.e.get(eid);
    if (!e) return null;
    const A = M.vpos(e.a), B = M.vpos(e.b);
    let p = pos ? pos.clone() : A.clone().add(B).multiplyScalar(0.5);
    const ab = B.clone().sub(A), t = U.clamp(p.clone().sub(A).dot(ab) / Math.max(ab.lengthSq(), 1e-12), 0, 1);
    if (t < 1e-6) return e.a;
    if (t > 1 - 1e-6) return e.b;
    p = A.clone().addScaledVector(ab, t);
    const m = M.addVertex(p);
    const { a, b } = e;
    e.b = m;
    idx.edgeKey.delete(ekey(a, b));
    idx.edgeKey.set(ekey(a, m), e);
    const e2 = M.addEdge(m, b);
    for (const f of S().faces) {
      for (let i = 0; i < f.v.length; i++) {
        const q0 = f.v[i], q1 = f.v[(i + 1) % f.v.length];
        if ((q0 === a && q1 === b) || (q0 === b && q1 === a)) { f.v.splice(i + 1, 0, m); break; }
      }
    }
    for (const o of S().objects) if (o.edges.includes(eid) && e2 != null) o.edges.push(e2);
    return m;
  },

  flipFaces(ids) { ids.forEach(id => { const f = idx.f.get(id); if (f) f.v.reverse(); }); },

  /** Copy the selected geometry through `fn(Vector3) -> Vector3`. weld = reuse vertices that don't move. */
  copySelection(fn, { weld = false, flip = false } = {}) {
    const s = S();
    const vids = M.selectedVertexIds();
    if (!vids.length) return [];
    const vset = new Set(vids);
    const faces = s.faces.filter(f => sel.has('f', f.id) || f.v.every(v => vset.has(v)));
    const edges = s.edges.filter(e => vset.has(e.a) && vset.has(e.b));
    const map = new Map(), out = [];
    for (const id of vids) {
      const p0 = M.vpos(id), p = fn(p0.clone());
      if (weld && p.distanceTo(p0) < 1e-6) map.set(id, id);
      else { const n = M.addVertex(p); map.set(id, n); out.push('v:' + n); }
    }
    for (const e of edges) { const n = M.addEdge(map.get(e.a), map.get(e.b)); if (n != null && n !== e.id) out.push('e:' + n); }
    for (const f of faces) {
      const v = f.v.map(id => map.get(id));
      const n = M.addFace(flip ? v.reverse() : v);
      if (n) {
        out.push('f:' + n);
        const o = idx.faceObj.get(f.id);
        if (o) o.faces.push(n);
      }
    }
    return out;
  },
  duplicate(offset) { return M.copySelection(p => p.add(offset)); },
  mirror(axis) { return M.copySelection(p => { p[axis] = -p[axis]; return p; }, { weld: true, flip: true }); },

  /** Extrude faces along their normals; keeps the original face as a cap. Returns new top face ids. */
  extrude(faceIds, dist) {
    const tops = [];
    for (const fid of faceIds) {
      const f = idx.f.get(fid);
      if (!f) continue;
      const pts = f.v.map(id => M.vpos(id));
      const n = P3.geom.normal(pts);
      if (n.lengthSq() < 0.5) continue;
      const o = idx.faceObj.get(fid);
      const ring = f.v.map((id, i) => M.addVertex(pts[i].clone().addScaledVector(n, dist)));
      const top = M.addFace(ring);
      const made = [top];
      for (let i = 0; i < f.v.length; i++) {
        const j = (i + 1) % f.v.length;
        made.push(M.addFace([f.v[i], f.v[j], ring[j], ring[i]]));
      }
      if (o) made.filter(Boolean).forEach(id => o.faces.push(id));
      f.v.reverse(); // bottom cap faces outward
      tops.push(top);
    }
    return tops.filter(Boolean);
  },

  /** Apply a similarity transform (rotation + uniform scale + translation) to points, cameras and the cloud. */
  transformScene(m) {
    const s = S();
    const pos = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
    m.decompose(pos, q, sc);
    s.vertices.forEach(v => { v.p = new T.Vector3().fromArray(v.p).applyMatrix4(m).toArray().map(n => U.round(n, 6)); });
    s.images.forEach(img => {
      const p = cam.position(img).applyMatrix4(m);
      cam.setPose(img, p, q.clone().multiply(cam.quat(img)));
    });
    s.cloudMatrix = m.clone().multiply(P3.cloudMatrix()).toArray();
  },

  /* ---------------- features (named points / lines / directions marked in photos) ---------------- */
  FEATURE_COLORS: ['#ff5d8f', '#4fc3f7', '#ffd166', '#7bd88f', '#c792ea', '#ff9f1c', '#57d9c5', '#f78c6c'],
  /** Template position used before a feature is solved: X = forward (tail → nose), Y = up, Z = right. */
  featureTemplate(kind, i) {
    if (kind === 'axis') return [new T.Vector3(0, 0, 0), new T.Vector3(1, 0, 0)];
    if (kind === 'line') { const x = [0.15, 0.6, 0.35, 0.85, 0.5][i % 5], w = 0.5 - 0.06 * (i % 3); return [new T.Vector3(x, 0.02 * i, -w), new T.Vector3(x, 0.02 * i, w)]; }
    return [new T.Vector3(0.3 + 0.13 * (i % 5), 0.15 + 0.05 * (i % 3), 0.07 * ((i % 3) - 1))];
  },
  addFeature(kind, name, opts = {}) {
    const s = S();
    const same = s.features.filter(f => f.kind === kind).length;
    const tpl = M.featureTemplate(kind, same);
    const a = M.addVertex(tpl[0]);
    const b = kind === 'point' ? null : M.addVertex(tpl[1]);
    if (b != null) M.addEdge(a, b);
    const f = {
      id: P3.newId(), name: name || ({ point: 'Point', line: 'Line', axis: 'Direction' }[kind] + ' ' + (same + 1)),
      kind, a, b, solved: false,
      color: opts.color || M.FEATURE_COLORS[s.features.length % M.FEATURE_COLORS.length],
      ref: kind === 'axis' && !s.features.some(x => x.kind === 'axis' && x.ref),
      length: opts.length || null,
    };
    s.features.push(f);
    return f;
  },
  removeFeature(id) {
    const s = S();
    const f = s.features.find(x => x.id === id);
    if (!f) return;
    const vs = new Set([f.a, f.b].filter(v => v != null));
    s.features = s.features.filter(x => x.id !== id);
    s.vertices = s.vertices.filter(v => !vs.has(v.id));
    s.edges = s.edges.filter(e => !vs.has(e.a) && !vs.has(e.b));
    s.faces = s.faces.filter(fc => !fc.v.some(v => vs.has(v)));
    s.images.forEach(img => { img.pins = (img.pins || []).filter(p => !vs.has(p.v)); });
    if (f.ref) { const ax = s.features.find(x => x.kind === 'axis'); if (ax) ax.ref = true; }
    M.cleanObjects();
  },
  /** How many photos a feature is fully marked in. */
  featureMarks(f) {
    const ends = f.kind === 'point' ? [f.a] : [f.a, f.b];
    return P3.state.images.filter(img => ends.every(v => (img.pins || []).some(p => p.v === v))).length;
  },

  /** Uniformly scale the whole scene (geometry, cameras, point cloud) about the origin. */
  scaleScene(k) {
    const s = S();
    s.vertices.forEach(v => { v.p = v.p.map(n => U.round(n * k, 6)); });
    s.images.forEach(i => { i.pos = i.pos.map(n => U.round(n * k, 6)); });
    s.cloudMatrix = new T.Matrix4().makeScale(k, k, k).multiply(P3.cloudMatrix()).toArray();
  },

  groupSelection(name) {
    const s = S();
    const vs = new Set(sel.ids('v'));
    const fs = new Set(sel.ids('f')), es = new Set(sel.ids('e'));
    if (vs.size) {
      s.faces.forEach(f => { if (f.v.every(v => vs.has(v))) fs.add(f.id); });
      s.edges.forEach(e => { if (vs.has(e.a) && vs.has(e.b)) es.add(e.id); });
    }
    if (!fs.size && !es.size) return null;
    s.objects.forEach(o => { o.faces = o.faces.filter(id => !fs.has(id)); o.edges = o.edges.filter(id => !es.has(id)); });
    const palette = ['#ff9f1c', '#4fc3f7', '#7bd88f', '#e06cff', '#ffd166', '#ef6f6c', '#57d9c5', '#a98bff'];
    const o = {
      id: P3.newId(),
      name: name || 'Object ' + (s.objects.length + 1),
      color: palette[s.objects.length % palette.length],
      faces: [...fs], edges: [...es], visible: true,
    };
    s.objects.push(o);
    M.cleanObjects();
    return o.id;
  },

  arrangeRing(imgs, { radius = 6, height = 1.5, targetY = 0, startAngle = 0, clockwise = false } = {}) {
    const n = imgs.length;
    const target = new T.Vector3(0, targetY, 0);
    imgs.forEach((img, i) => {
      const a = startAngle * D2R + (clockwise ? -1 : 1) * (2 * Math.PI * i) / n;
      const eye = new T.Vector3(radius * Math.sin(a), height, radius * Math.cos(a));
      cam.setPose(img, eye, cam.lookQuat(eye, target));
    });
  },

  /** Least-squares point closest to rays [{o, d}]. */
  solveRays(rays) {
    if (rays.length < 2) return null;
    const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const b = [0, 0, 0];
    for (const r of rays) {
      const d = r.d.clone().normalize();
      const m = [1 - d.x * d.x, -d.x * d.y, -d.x * d.z, -d.y * d.x, 1 - d.y * d.y, -d.y * d.z, -d.z * d.x, -d.z * d.y, 1 - d.z * d.z];
      for (let i = 0; i < 9; i++) A[i] += m[i];
      b[0] += m[0] * r.o.x + m[1] * r.o.y + m[2] * r.o.z;
      b[1] += m[3] * r.o.x + m[4] * r.o.y + m[5] * r.o.z;
      b[2] += m[6] * r.o.x + m[7] * r.o.y + m[8] * r.o.z;
    }
    const mat = new T.Matrix3().set(...A);
    if (Math.abs(mat.determinant()) < 1e-9) return null;
    const p = new T.Vector3(...b).applyMatrix3(mat.invert());
    let err = 0, behind = false;
    for (const r of rays) {
      const d = r.d.clone().normalize();
      const v = p.clone().sub(r.o);
      if (v.dot(d) <= 0) behind = true;
      err += v.sub(d.multiplyScalar(v.dot(d))).length();
    }
    return { point: p, error: err / rays.length, behind };
  },
});

P3.reindex();
})();
