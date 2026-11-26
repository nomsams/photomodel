/* PhotoModel 3D — 3D viewport: rendering, picking, photo-camera view (with zoom) and overlay, gizmo, orientation widget. */
(() => {
'use strict';
const T = window.THREE;
const P3 = window.P3;
const U = P3.util;
const D2R = U.D2R;
const S = () => P3.state;
const idx = P3.idx;

const vp = (P3.vp = {
  viewRect: { x: 0, y: 0, w: 1, h: 1 },
  hover: null,
  activeCam: null,
  alignMode: false,
  overlayHidden: false,
  gizmoMode: 'translate',
  pz: { z: 1, ox: 0, oy: 0 }, // photo zoom: factor + normalised top-left of the visible window
  afterRender: [],
});

const COL = {
  sel: new T.Color('#ff8a1f'),
  hover: new T.Color('#ffe066'),
  pend: new T.Color('#22d3ee'),
  frustum: new T.Color('#9aa7b8'),
};
const THEME = {
  dark: { bg: '#14171d', grid1: '#3a4150', grid2: '#22272f', frustum: '#9aa7b8' },
  light: { bg: '#e3e8ef', grid1: '#9aa3b2', grid2: '#c9cfd8', frustum: '#5c6778' },
};

let renderer, scene, camera, controls, tc, wrap, container, overlayWrap, overlayEl, axisSvg;
let modelGroup, camGroup, cloudGroup, grid, axes;
let facesObj = null, edgesObj = null, vertsObj = null, cloudObj = null;
let faceTriMap = [];
let camPickMeshes = [];
let needsRender = true;
let savedFree = null;
let gizmoStart = null;
let lastAxisKey = '';
const texCache = new Map();
const pivot = new T.Object3D();
const raycaster = new T.Raycaster();
const tmpV = new T.Vector3();
let circleTex = null;

/* ================================================================== init */
vp.init = () => {
  wrap = document.getElementById('viewWrap');
  container = document.getElementById('viewport');
  overlayWrap = document.getElementById('overlayWrap');
  overlayEl = document.getElementById('overlay');
  axisSvg = document.getElementById('axisGizmo');

  renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  scene = new T.Scene();
  camera = new T.PerspectiveCamera(50, 1, 0.01, 10000);
  camera.position.set(7, 6, 9);
  scene.add(camera);
  scene.add(new T.HemisphereLight(0xffffff, 0x445566, 1.5));
  const dir = new T.DirectionalLight(0xffffff, 1.5);
  dir.position.set(1.5, 2, 1);
  camera.add(dir, dir.target);
  dir.target.position.set(0, 0, -5);

  controls = new T.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.5, 0);
  controls.mouseButtons = { LEFT: T.MOUSE.ROTATE, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.PAN };
  controls.zoomToCursor = true;
  controls.update();
  controls.addEventListener('change', onControlsChange);
  controls.addEventListener('end', onControlsEnd);

  modelGroup = new T.Group();
  camGroup = new T.Group();
  cloudGroup = new T.Group();
  vp.helperGroup = new T.Group();
  scene.add(cloudGroup, modelGroup, camGroup, vp.helperGroup);

  tc = new T.TransformControls(camera, renderer.domElement);
  tc.setSize(0.9);
  scene.add(tc.getHelper());
  scene.add(pivot);
  tc.addEventListener('change', vp.requestRender);
  tc.addEventListener('dragging-changed', e => { controls.enabled = !e.value && orbitAllowed(); });
  tc.addEventListener('mouseDown', onGizmoDown);
  tc.addEventListener('objectChange', onGizmoChange);
  tc.addEventListener('mouseUp', onGizmoUp);

  circleTex = makeCircleTexture();
  bindPhotoZoom();
  axisSvg.addEventListener('click', e => {
    const v = e.target.closest('[data-view]');
    if (v) vp.setView(v.dataset.view);
  });

  new ResizeObserver(() => vp.layout()).observe(wrap);
  window.addEventListener('resize', () => vp.layout());

  P3.on('change', info => {
    if (vp.activeCam && !idx.c.has(vp.activeCam)) vp.exitCamera();
    else if (vp.activeCam && !(info && info.source === 'align')) vp.refreshCamera();
    vp.rebuild();
    if (!(info && info.live)) vp.updateGizmo();
  });
  P3.on('selection', () => { vp.rebuild(); vp.updateGizmo(); });
  P3.on('settings', () => { applyTheme(); buildGrid(); vp.rebuild(); vp.rebuildCloud(); vp.layout(); applyControlSpeeds(); });
  P3.on('cloud', () => vp.rebuildCloud());

  applyTheme();
  buildGrid();
  vp.layout();
  vp.rebuild();
  loop();
};

vp.dom = () => renderer.domElement;
vp.camera = () => camera;
vp.controls = () => controls;
vp.wrap = () => wrap;
vp.requestRender = () => { needsRender = true; };

function loop() {
  requestAnimationFrame(loop);
  if (!needsRender) return;
  needsRender = false;
  render();
}
function orbitAllowed() { return !vp.activeCam || vp.alignMode; }

/* Movement speed: in Align mode orbit / pan / zoom are scaled by the "photo view movement speed"
   setting; holding Alt makes every photo-view movement 4× finer. */
let fineMode = false;
vp.photoSpeed = () => U.clamp(+P3.settings.photoMoveSpeed || 0.5, 0.05, 2) * (fineMode ? 0.25 : 1);
function applyControlSpeeds() {
  if (!controls) return;
  const align = !!(vp.activeCam && vp.alignMode);
  const k = align ? vp.photoSpeed() : 1;
  controls.rotateSpeed = align ? 0.5 * k : 1;
  controls.panSpeed = align ? 0.6 * k : 1;
  controls.zoomSpeed = align ? 0.5 * k : 1;
  controls.zoomToCursor = !align;
}
vp.applyControlSpeeds = applyControlSpeeds;
function setFine(on) { if (fineMode !== on) { fineMode = on; applyControlSpeeds(); P3.emit('finemode', on); } }
window.addEventListener('keydown', e => { if (e.key === 'Alt') { if (vp.activeCam) e.preventDefault(); setFine(true); } });
window.addEventListener('keyup', e => { if (e.key === 'Alt') { e.preventDefault(); setFine(false); } });
window.addEventListener('blur', () => setFine(false));
vp.fineMode = () => fineMode;

function applyTheme() {
  const st = P3.settings;
  const th = THEME[st.theme] || THEME.dark;
  document.documentElement.dataset.theme = st.theme;
  document.documentElement.dataset.accent = P3.ACCENTS[st.accent] ? st.accent : 'orange';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = st.theme === 'light' ? '#ffffff' : '#0e1014';
  vp.bgColor = new T.Color(th.bg);
  COL.frustum.set(th.frustum);
  COL.sel.set(P3.ACCENTS[st.accent] || P3.ACCENTS.orange);
  vp.requestRender();
}

function makeCircleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 6;
  g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.stroke();
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}
function disposeTree(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
}
function clearGroup(g) { for (const c of [...g.children]) { g.remove(c); disposeTree(c); } }

/* ================================================================== grid / work plane */
function buildGrid() {
  const st = P3.settings;
  const th = THEME[st.theme] || THEME.dark;
  if (grid) { scene.remove(grid); disposeTree(grid); }
  if (axes) { scene.remove(axes); disposeTree(axes); }
  const div = Math.max(2, Math.min(400, st.gridDivisions | 0));
  const size = Math.max(0.001, +st.gridSize || 1) * div;
  grid = new T.GridHelper(size, div, th.grid1, th.grid2);
  grid.material.transparent = true;
  grid.material.opacity = 0.8;
  grid.material.depthWrite = false;
  const fr = vp.planeFrame();
  grid.matrixAutoUpdate = false;
  grid.matrix.makeBasis(fr.u, fr.n, fr.v).setPosition(fr.o);
  if (st.workPlane === 'custom') grid.material.opacity = 0.95;
  grid.visible = st.showGrid;
  grid.renderOrder = -1;
  scene.add(grid);
  axes = new T.AxesHelper(Math.max(0.5, (+st.gridSize || 1) * 2));
  axes.material.depthTest = false;
  axes.renderOrder = 1;
  axes.visible = st.showAxes;
  scene.add(axes);
  vp.requestRender();
}

/** Work plane as a frame: origin o, normal n and in-plane axes u, v (u × n = v). */
vp.planeFrame = () => {
  const st = P3.settings;
  let o = new T.Vector3(), n, u;
  const cp = st.customPlane;
  if (st.workPlane === 'custom' && cp && cp.n) {
    o.fromArray(cp.o);
    n = new T.Vector3().fromArray(cp.n).normalize();
    u = new T.Vector3().fromArray(cp.u || [1, 0, 0]);
    u.addScaledVector(n, -u.dot(n));
    if (u.lengthSq() < 1e-8) u = Math.abs(n.x) < 0.9 ? new T.Vector3(1, 0, 0).cross(n) : new T.Vector3(0, 1, 0).cross(n);
    u.normalize();
  } else if (st.workPlane === 'XY') { n = new T.Vector3(0, 0, 1); u = new T.Vector3(1, 0, 0); }
  else if (st.workPlane === 'YZ') { n = new T.Vector3(1, 0, 0); u = new T.Vector3(0, 1, 0); }
  else { n = new T.Vector3(0, 1, 0); u = new T.Vector3(1, 0, 0); }
  o.addScaledVector(n, +st.workPlaneOffset || 0);
  const v = u.clone().cross(n);
  return { o, n, u, v, plane: new T.Plane().setFromNormalAndCoplanarPoint(n, o) };
};
vp.workPlane = () => vp.planeFrame().plane;
vp.planeAxis = () => ({ XY: 'z', YZ: 'x', XZ: 'y' }[P3.settings.workPlane] || null);

/* ================================================================== layout & render */
vp.layout = () => {
  if (!renderer) return;
  const W = Math.max(1, wrap.clientWidth), H = Math.max(1, wrap.clientHeight);
  const cur = renderer.getSize(new T.Vector2());
  if (cur.x !== W || cur.y !== H) renderer.setSize(W, H);
  const r = { x: 0, y: 0, w: W, h: H };
  const img = vp.activeCam && idx.c.get(vp.activeCam);
  if (img) {
    const a = img.w / img.h;
    const pad = 0;
    if ((W - pad) / (H - pad) > a) { r.h = H - pad; r.w = r.h * a; } else { r.w = W - pad; r.h = r.w / a; }
    r.x = (W - r.w) / 2;
    r.y = (H - r.h) / 2;
    camera.aspect = a;
  } else {
    camera.aspect = W / H;
  }
  vp.viewRect = r;
  applyViewOffset();
  if (edgesObj) edgesObj.material.resolution.set(r.w, r.h);
  positionOverlay();
  vp.requestRender();
};

function applyViewOffset() {
  const r = vp.viewRect, pz = vp.pz;
  if (vp.activeCam && pz.z > 1.0001) camera.setViewOffset(r.w, r.h, pz.ox * r.w, pz.oy * r.h, r.w / pz.z, r.h / pz.z);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

function render() {
  const r = vp.viewRect;
  const H = wrap.clientHeight;
  const under = vp.activeCam && P3.settings.overlayMode === 'under' && !vp.overlayHidden;
  scene.background = under ? null : vp.bgColor;
  if (vp.activeCam) {
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    const y = H - r.y - r.h;
    renderer.setViewport(r.x, y, r.w, r.h);
    renderer.setScissor(r.x, y, r.w, r.h);
    renderer.setScissorTest(true);
  } else {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, wrap.clientWidth, H);
  }
  renderer.render(scene, camera);
  updateAxisGizmo();
  for (const fn of vp.afterRender) { try { fn(); } catch (err) { console.error(err); } }
}

function positionOverlay() {
  const img = vp.activeCam && idx.c.get(vp.activeCam);
  const rec = img && P3.images.get(img.id);
  if (!rec || vp.overlayHidden) { overlayWrap.classList.add('hidden'); return; }
  const r = vp.viewRect, pz = vp.pz;
  Object.assign(overlayWrap.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  Object.assign(overlayEl.style, {
    width: r.w * pz.z + 'px', height: r.h * pz.z + 'px',
    left: -pz.ox * r.w * pz.z + 'px', top: -pz.oy * r.h * pz.z + 'px',
  });
  overlayEl.style.opacity = P3.settings.overlayOpacity;
  if (overlayEl.getAttribute('src') !== rec.src) overlayEl.src = rec.src;
  overlayWrap.classList.toggle('under', P3.settings.overlayMode === 'under');
  overlayWrap.classList.remove('hidden');
}
vp.positionOverlay = positionOverlay;

/* ================================================================== photo zoom & pan */
vp.imgToScreen = (nx, ny) => {
  const r = vp.viewRect, pz = vp.pz;
  return { x: r.x + (nx - pz.ox) * r.w * pz.z, y: r.y + (ny - pz.oy) * r.h * pz.z };
};
vp.screenToImg = (lx, ly) => {
  const r = vp.viewRect, pz = vp.pz;
  return { x: (lx - r.x) / (r.w * pz.z) + pz.ox, y: (ly - r.y) / (r.h * pz.z) + pz.oy };
};
function clampZoom() {
  const pz = vp.pz;
  pz.z = U.clamp(pz.z, 1, 40);
  const m = 1 - 1 / pz.z;
  pz.ox = U.clamp(pz.ox, 0, m);
  pz.oy = U.clamp(pz.oy, 0, m);
}
function applyPhotoZoom() {
  clampZoom();
  applyViewOffset();
  positionOverlay();
  vp.requestRender();
  P3.emit('photozoom');
}
vp.zoomPhotoAt = (lx, ly, factor) => {
  if (!vp.activeCam) return;
  const before = vp.screenToImg(lx, ly);
  const r = vp.viewRect;
  vp.pz.z = U.clamp(vp.pz.z * factor, 1, 40);
  vp.pz.ox = before.x - (lx - r.x) / (r.w * vp.pz.z);
  vp.pz.oy = before.y - (ly - r.y) / (r.h * vp.pz.z);
  applyPhotoZoom();
};
vp.resetPhotoZoom = () => { vp.pz = { z: 1, ox: 0, oy: 0 }; applyPhotoZoom(); };
vp.photoZoomable = () => !!vp.activeCam && !vp.alignMode;

function bindPhotoZoom() {
  const el = renderer.domElement;
  wrap.addEventListener('wheel', e => {
    if (!vp.photoZoomable()) return;
    e.preventDefault();
    const l = vp.local(e);
    const k = (e.deltaMode === 1 ? 0.05 : 0.0016) * vp.photoSpeed() * (e.altKey && !fineMode ? 0.25 : 1);
    vp.zoomPhotoAt(l.x, l.y, Math.exp(-U.clamp(e.deltaY, -240, 240) * k));
  }, { passive: false });
  let pan = null;
  el.addEventListener('pointerdown', e => {
    if (!vp.photoZoomable() || (e.button !== 1 && e.button !== 2)) return;
    pan = { x: e.clientX, y: e.clientY, ox: vp.pz.ox, oy: vp.pz.oy, lx: e.clientX, ly: e.clientY };
    if (e.button === 1) e.preventDefault();
  });
  window.addEventListener('pointermove', e => {
    if (!pan) return;
    // Incremental, speed-scaled pan so changing Alt mid-drag doesn't jump.
    const r = vp.viewRect, k = vp.photoSpeed();
    vp.pz.ox -= ((e.clientX - pan.lx) * k) / (r.w * vp.pz.z);
    vp.pz.oy -= ((e.clientY - pan.ly) * k) / (r.h * vp.pz.z);
    pan.lx = e.clientX; pan.ly = e.clientY;
    applyPhotoZoom();
  });
  window.addEventListener('pointerup', () => { pan = null; });
}

/* ================================================================== orientation widget */
const AXES = [
  ['X', 1, 0, 0, '#f2545b', 'right'], ['Y', 0, 1, 0, '#5fcf78', 'top'], ['Z', 0, 0, 1, '#4c9dff', 'front'],
  ['', -1, 0, 0, '#f2545b', 'left'], ['', 0, -1, 0, '#5fcf78', 'bottom'], ['', 0, 0, -1, '#4c9dff', 'back'],
];
function updateAxisGizmo() {
  const q = camera.quaternion;
  const key = q.toArray().map(n => n.toFixed(3)).join();
  if (key === lastAxisKey) return;
  lastAxisKey = key;
  const qi = q.clone().invert();
  const items = AXES.map(([label, x, y, z, color, view]) => {
    const v = new T.Vector3(x, y, z).applyQuaternion(qi);
    return { label, color, view, x: v.x * 30, y: -v.y * 30, z: v.z };
  }).sort((a, b) => a.z - b.z);
  let s = '<circle class="bg" r="44"/>';
  for (const it of items) {
    if (it.label) s += `<line x1="0" y1="0" x2="${it.x.toFixed(1)}" y2="${it.y.toFixed(1)}" stroke="${it.color}" stroke-width="2" stroke-linecap="round" opacity="${(0.55 + 0.45 * (it.z + 1) / 2).toFixed(2)}"/>`;
  }
  for (const it of items) {
    const op = (0.5 + 0.5 * (it.z + 1) / 2).toFixed(2);
    if (it.label) s += `<g><circle class="ax" data-view="${it.view}" cx="${it.x.toFixed(1)}" cy="${it.y.toFixed(1)}" r="8" fill="${it.color}" opacity="${op}"><title>${it.view} view</title></circle><text x="${it.x.toFixed(1)}" y="${it.y.toFixed(1)}">${it.label}</text></g>`;
    else s += `<circle class="ax" data-view="${it.view}" cx="${it.x.toFixed(1)}" cy="${it.y.toFixed(1)}" r="5.5" fill="none" stroke="${it.color}" stroke-width="1.8" opacity="${op}"><title>${it.view} view</title></circle>`;
  }
  axisSvg.innerHTML = s;
}

/* ================================================================== model rebuild */
function colorFor(type, id, base) {
  const key = type + ':' + id;
  if (P3.sel.list.includes(key)) return COL.sel;
  if (vp.hover === key) return COL.hover;
  return base;
}

vp.rebuild = () => {
  if (!renderer) return;
  const st = P3.settings, s = S();
  const hid = idx.hidden;
  clearGroup(modelGroup);
  facesObj = edgesObj = vertsObj = null;

  /* ---- faces ---- */
  const baseFace = new T.Color(st.faceColor);
  const fpos = [], fcol = [];
  faceTriMap = [];
  for (const f of s.faces) {
    if (hid.f.has(f.id)) continue;
    const pts = f.v.map(id => P3.model.vpos(id));
    if (pts.some(p => !p)) continue;
    const o = idx.faceObj.get(f.id);
    const c = colorFor('f', f.id, o ? new T.Color(o.color) : baseFace);
    for (const tri of P3.geom.triangulate(pts)) {
      for (const k of tri) { fpos.push(pts[k].x, pts[k].y, pts[k].z); fcol.push(c.r, c.g, c.b); }
      faceTriMap.push(f.id);
    }
  }
  if (fpos.length) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(fpos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(fcol, 3));
    g.computeVertexNormals();
    const op = U.clamp(+st.faceOpacity, 0.05, 1);
    facesObj = new T.Mesh(g, new T.MeshStandardMaterial({
      vertexColors: true, side: T.DoubleSide, roughness: 0.85, metalness: 0,
      transparent: op < 0.999, opacity: op, depthWrite: op >= 0.999,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    modelGroup.add(facesObj);
  }

  /* ---- edges ---- */
  const baseLine = new T.Color(st.lineColor);
  const epos = [], ecol = [];
  for (const e of s.edges) {
    if (hid.e.has(e.id)) continue;
    const a = idx.v.get(e.a), b = idx.v.get(e.b);
    if (!a || !b) continue;
    const o = idx.edgeObj.get(e.id);
    const c = colorFor('e', e.id, o ? new T.Color(o.color) : baseLine);
    epos.push(...a.p, ...b.p);
    ecol.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  if (epos.length) {
    const g = new T.LineSegmentsGeometry();
    g.setPositions(epos);
    g.setColors(ecol);
    const m = new T.LineMaterial({ linewidth: +st.lineWidth || 2, vertexColors: true, worldUnits: false });
    m.resolution.set(vp.viewRect.w, vp.viewRect.h);
    edgesObj = new T.LineSegments2(g, m);
    edgesObj.renderOrder = 2;
    modelGroup.add(edgesObj);
  }

  /* ---- vertices ---- */
  const baseV = new T.Color(st.vertexColor);
  const pend = P3.tools ? P3.tools.pendingVertexIds() : new Set();
  const vpos = [], vcol = [];
  for (const v of s.vertices) {
    if (hid.v.has(v.id)) continue;
    let c = colorFor('v', v.id, baseV);
    if (c === baseV && pend.has(v.id)) c = COL.pend;
    vpos.push(...v.p);
    vcol.push(c.r, c.g, c.b);
  }
  if (vpos.length) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(vpos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(vcol, 3));
    vertsObj = new T.Points(g, new T.PointsMaterial({
      size: (+st.vertexSize || 8) * renderer.getPixelRatio(), sizeAttenuation: false, vertexColors: true,
      map: circleTex, alphaTest: 0.5, depthTest: !st.xrayVertices, depthWrite: false, transparent: true,
    }));
    vertsObj.renderOrder = 10;
    modelGroup.add(vertsObj);
  }

  rebuildCameras();
  if (grid) grid.visible = st.showGrid;
  if (axes) axes.visible = st.showAxes;
  if (cloudObj) cloudObj.scale.setScalar(S().cloudScale || 1);
  vp.requestRender();
};

function getTexture(id) {
  if (texCache.has(id)) return texCache.get(id);
  const rec = P3.images.get(id);
  if (!rec) return null;
  const t = new T.CanvasTexture(rec.texEl);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(id, t);
  return t;
}
vp.clearTextures = () => { texCache.forEach(t => t.dispose()); texCache.clear(); };

function rebuildCameras() {
  clearGroup(camGroup);
  camPickMeshes = [];
  const st = P3.settings;
  if (!st.showFrustums) return;
  for (const img of S().images) {
    if (img.visible === false || img.id === vp.activeCam) continue;
    const g = new T.Group();
    g.position.fromArray(img.pos);
    g.quaternion.copy(P3.cam.quat(img));
    const d = Math.max(0.01, +st.frustumSize || 0.5);
    const hh = d * Math.tan((img.fov * D2R) / 2);
    const hw = (hh * img.w) / img.h;
    const isSel = P3.sel.has('c', img.id), isHov = vp.hover === 'c:' + img.id;
    const color = isSel ? COL.sel : isHov ? COL.hover : COL.frustum;
    const cs = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const pts = [];
    cs.forEach(([x, y], i) => {
      const [nx, ny] = cs[(i + 1) % 4];
      pts.push(0, 0, 0, x, y, -d, x, y, -d, nx, ny, -d);
    });
    const ty = hh * 1.08, th = hh * 1.35, tw = hw * 0.35;
    pts.push(-tw, ty, -d, 0, th, -d, 0, th, -d, tw, ty, -d, tw, ty, -d, -tw, ty, -d);
    const lg = new T.BufferGeometry();
    lg.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    g.add(new T.LineSegments(lg, new T.LineBasicMaterial({ color, transparent: true, opacity: isSel || isHov ? 1 : 0.75 })));
    const tex = getTexture(img.id);
    const pm = new T.Mesh(
      new T.PlaneGeometry(hw * 2, hh * 2),
      new T.MeshBasicMaterial({
        map: tex, color: tex ? 0xffffff : 0x334455, transparent: true,
        opacity: U.clamp(+st.frustumImageOpacity, 0, 1), side: T.DoubleSide, depthWrite: false,
      })
    );
    pm.position.z = -d;
    pm.userData.imgId = img.id;
    g.add(pm);
    camPickMeshes.push(pm);
    camGroup.add(g);
  }
}

vp.rebuildCloud = () => {
  if (!renderer) return;
  clearGroup(cloudGroup);
  cloudObj = null;
  const c = P3.cloud;
  if (!c || c.visible === false || !c.positions.length) { vp.requestRender(); return; }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(c.positions, 3));
  if (c.colors) g.setAttribute('color', new T.BufferAttribute(c.colors, 3));
  cloudObj = new T.Points(g, new T.PointsMaterial({
    size: (+P3.settings.cloudPointSize || 2) * renderer.getPixelRatio(), sizeAttenuation: false,
    vertexColors: !!c.colors, color: c.colors ? 0xffffff : 0x9fb4c8,
  }));
  cloudObj.scale.setScalar(S().cloudScale || 1);
  cloudGroup.add(cloudObj);
  vp.requestRender();
};

/* ================================================================== picking */
vp.local = e => {
  const b = wrap.getBoundingClientRect();
  return { x: e.clientX - b.left, y: e.clientY - b.top };
};
vp.ndc = e => {
  const l = vp.local(e), r = vp.viewRect;
  return new T.Vector2(((l.x - r.x) / r.w) * 2 - 1, -((l.y - r.y) / r.h) * 2 + 1);
};
vp.inView = e => { const n = vp.ndc(e); return Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1; };
vp.ray = e => { raycaster.setFromCamera(vp.ndc(e), camera); return raycaster.ray.clone(); };

function toScreen(p) {
  tmpV.copy(p).project(camera);
  if (tmpV.z < -1 || tmpV.z > 1) return null;
  const r = vp.viewRect;
  return { x: r.x + ((tmpV.x + 1) / 2) * r.w, y: r.y + ((1 - tmpV.y) / 2) * r.h, z: tmpV.z };
}
vp.toScreen = p => { camera.updateMatrixWorld(); return toScreen(p); };

function segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
  t = U.clamp(t, 0, 1);
  return { d: Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)), t };
}

/** Pick under the mouse. Returns {type:'v'|'e'|'f'|'c', id, pos?, point?} or null. */
vp.pick = (e, opts = {}) => {
  const types = opts.types || ['v', 'e', 'c', 'f'];
  if (!vp.inView(e)) return null;
  camera.updateMatrixWorld();
  scene.updateMatrixWorld();
  const L = vp.local(e);
  const R = +P3.settings.snapRadius || 12;
  const s = S();
  const hid = idx.hidden;
  const skip = opts.exclude || null;

  if (types.includes('v')) {
    let best = null, bd = R;
    for (const v of s.vertices) {
      if (hid.v.has(v.id) || (skip && skip.has(v.id))) continue;
      const sp = toScreen(tmpV.fromArray(v.p));
      if (!sp) continue;
      const d = Math.hypot(sp.x - L.x, sp.y - L.y);
      if (d < bd) { bd = d; best = v; }
    }
    if (best) return { type: 'v', id: best.id, pos: new T.Vector3().fromArray(best.p) };
  }
  if (types.includes('e')) {
    let best = null, bd = R * 0.75, bt = 0;
    for (const ed of s.edges) {
      if (hid.e.has(ed.id)) continue;
      const a = idx.v.get(ed.a), b = idx.v.get(ed.b);
      if (!a || !b) continue;
      const sa = toScreen(new T.Vector3().fromArray(a.p)), sb = toScreen(new T.Vector3().fromArray(b.p));
      if (!sa || !sb) continue;
      const { d, t } = segDist(L.x, L.y, sa, sb);
      if (d < bd) { bd = d; best = ed; bt = t; }
    }
    if (best) {
      const pa = P3.model.vpos(best.a), pb = P3.model.vpos(best.b);
      return { type: 'e', id: best.id, pos: pa.lerp(pb, bt) };
    }
  }
  raycaster.setFromCamera(vp.ndc(e), camera);
  let camHit = null, faceHit = null;
  if (types.includes('c') && camPickMeshes.length) {
    const h = raycaster.intersectObjects(camPickMeshes, false)[0];
    if (h) camHit = { type: 'c', id: h.object.userData.imgId, dist: h.distance, point: h.point };
    if (!camHit) {
      let bd = R;
      for (const m of camPickMeshes) {
        const sp = toScreen(m.parent.getWorldPosition(new T.Vector3()));
        const d = sp ? Math.hypot(sp.x - L.x, sp.y - L.y) : Infinity;
        if (d < bd) { bd = d; camHit = { type: 'c', id: m.userData.imgId, dist: 0, point: m.parent.position.clone() }; }
      }
    }
  }
  if (types.includes('f') && facesObj) {
    const h = raycaster.intersectObject(facesObj, false)[0];
    if (h) faceHit = { type: 'f', id: faceTriMap[h.faceIndex], dist: h.distance, point: h.point, pos: h.point };
  }
  if (camHit && faceHit) return camHit.dist <= faceHit.dist ? camHit : faceHit;
  return camHit || faceHit;
};

/** Everything whose screen position lies inside a rectangle (box select). */
vp.pickRect = (x0, y0, x1, y1) => {
  camera.updateMatrixWorld();
  scene.updateMatrixWorld();
  const inside = p => { const s = p && toScreen(p); return !!s && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1; };
  const hid = idx.hidden, s = S(), keys = [];
  const vin = new Set();
  for (const v of s.vertices) if (!hid.v.has(v.id) && inside(tmpV.fromArray(v.p))) { vin.add(v.id); keys.push('v:' + v.id); }
  for (const e of s.edges) if (!hid.e.has(e.id) && vin.has(e.a) && vin.has(e.b)) keys.push('e:' + e.id);
  for (const f of s.faces) if (!hid.f.has(f.id) && f.v.every(v => vin.has(v))) keys.push('f:' + f.id);
  for (const m of camPickMeshes) if (inside(m.parent.getWorldPosition(new T.Vector3()))) keys.push('c:' + m.userData.imgId);
  return keys;
};

vp.pickCloud = e => {
  const c = P3.cloud;
  if (!c || c.visible === false || !c.positions.length || !vp.inView(e)) return null;
  camera.updateMatrixWorld();
  const k = S().cloudScale || 1;
  const m = new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(new T.Matrix4().makeScale(k, k, k)).elements;
  const L = vp.local(e), r = vp.viewRect;
  const R = (+P3.settings.snapRadius || 12) * 0.7;
  const P = c.positions;
  let best = -1, bd = R, bw = Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) continue;
    const sx = r.x + (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) / 2) * r.w;
    const sy = r.y + ((1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) / 2) * r.h;
    const d = Math.hypot(sx - L.x, sy - L.y);
    if (d < bd - 1.5 || (d < R && Math.abs(d - bd) <= 1.5 && w < bw)) { bd = Math.min(bd, d); best = i; bw = w; }
  }
  return best >= 0 ? new T.Vector3(P[best] * k, P[best + 1] * k, P[best + 2] * k) : null;
};

/** Intersection of the mouse ray with a plane frame (default: the work plane), optionally grid-snapped in that plane. */
vp.planePoint = (e, snap = true, frame = null) => {
  const fr = frame || vp.planeFrame();
  raycaster.setFromCamera(vp.ndc(e), camera);
  const p = new T.Vector3();
  if (!raycaster.ray.intersectPlane(fr.plane, p)) return null;
  if (p.distanceTo(camera.position) > camera.far * 0.9) return null;
  if (snap && P3.settings.snapToGrid) {
    const step = Math.max(1e-6, +P3.settings.snapStep || 0.25);
    const d = p.clone().sub(fr.o);
    const a = Math.round(d.dot(fr.u) / step) * step, b = Math.round(d.dot(fr.v) / step) * step;
    p.copy(fr.o).addScaledVector(fr.u, a).addScaledVector(fr.v, b);
  }
  return p;
};

/** Plane frame through a face (origin = face centroid, u along its first edge). */
vp.faceFrame = fid => {
  const f = idx.f.get(fid);
  if (!f) return null;
  const pts = f.v.map(id => P3.model.vpos(id));
  const n = P3.geom.normal(pts);
  if (n.lengthSq() < 0.5) return null;
  const o = pts.reduce((a, p) => a.add(p), new T.Vector3()).divideScalar(pts.length);
  const u = pts[1].clone().sub(pts[0]);
  u.addScaledVector(n, -u.dot(n)).normalize();
  const v = u.clone().cross(n);
  return { o, n, u, v, plane: new T.Plane().setFromNormalAndCoplanarPoint(n, o), faceId: fid };
};

/* ================================================================== photo camera view */
function sceneCenter() {
  const s = S();
  if (s.vertices.length) return P3.model.centroid(s.vertices.map(v => v.id));
  if (P3.cloud && P3.cloud.positions.length) {
    const b = new T.Box3().setFromBufferAttribute(new T.BufferAttribute(P3.cloud.positions, 3));
    return b.getCenter(new T.Vector3()).multiplyScalar(s.cloudScale || 1);
  }
  return new T.Vector3(0, 0, 0);
}
vp.sceneCenter = sceneCenter;

function applyImageToCamera(img) {
  camera.position.fromArray(img.pos);
  camera.quaternion.copy(P3.cam.quat(img));
  camera.fov = img.fov;
  camera.updateMatrixWorld();
  const fwd = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const c = sceneCenter();
  let dist = c.clone().sub(camera.position).dot(fwd);
  if (!(dist > 0.2)) dist = Math.max(1, camera.position.distanceTo(c));
  controls.target.copy(camera.position).addScaledVector(fwd, dist);
}

vp.enterCamera = id => {
  const img = idx.c.get(id);
  if (!img) return;
  if (!vp.activeCam) savedFree = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
  const switching = vp.activeCam !== id;
  vp.activeCam = id;
  if (switching) vp.pz = { z: 1, ox: 0, oy: 0 };
  applyImageToCamera(img);
  controls.enabled = orbitAllowed();
  applyControlSpeeds();
  vp.layout();
  vp.rebuild();
  vp.updateGizmo();
  P3.emit('view');
  P3.emit('photozoom');
};

vp.exitCamera = () => {
  if (!vp.activeCam) return;
  vp.activeCam = null;
  vp.pz = { z: 1, ox: 0, oy: 0 };
  if (savedFree) {
    camera.position.copy(savedFree.pos);
    controls.target.copy(savedFree.target);
    camera.fov = savedFree.fov;
  }
  camera.up.set(0, 1, 0);
  controls.enabled = true;
  applyControlSpeeds();
  controls.update();
  vp.layout();
  vp.rebuild();
  vp.updateGizmo();
  P3.emit('view');
};

vp.refreshCamera = () => {
  const img = idx.c.get(vp.activeCam);
  if (!img) return;
  const q = P3.cam.quat(img);
  const same = camera.position.distanceTo(tmpV.fromArray(img.pos)) < 1e-4 && camera.quaternion.angleTo(q) < 1e-5 && Math.abs(camera.fov - img.fov) < 1e-6;
  if (!same) applyImageToCamera(img);
  vp.layout();
};

vp.setAlign = on => {
  vp.alignMode = !!on;
  if (vp.alignMode) vp.pz = { z: 1, ox: 0, oy: 0 };
  controls.enabled = orbitAllowed();
  applyControlSpeeds();
  if (vp.activeCam) { applyImageToCamera(idx.c.get(vp.activeCam)); vp.layout(); }
  P3.emit('view');
  P3.emit('photozoom');
};
/**
 * Nudge the active photo camera in small steps (pad buttons / arrow keys).
 * kind: 'orbit' (dx,dy = around the model), 'pan' (sideways / up), 'dolly' (closer / farther), 'roll'.
 * Step sizes scale with the movement-speed setting; Alt makes them 4× finer.
 */
const commitNudge = U.debounce(() => P3.history.commit('Adjust photo camera'), 600);
vp.nudgeCamera = (kind, dx = 0, dy = 0) => {
  const img = vp.activeCam && idx.c.get(vp.activeCam);
  if (!img) return;
  const k = vp.photoSpeed() * 2; // default speed 0.5 → 1× base step
  const target = controls.target;
  const dist = Math.max(0.05, camera.position.distanceTo(target));
  const fwd = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new T.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  if (kind === 'orbit') {
    const a = 0.5 * D2R * k;
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), dx * a)
      .multiply(new T.Quaternion().setFromAxisAngle(right, -dy * a));
    const off = camera.position.clone().sub(target).applyQuaternion(q);
    camera.position.copy(target).add(off);
    camera.quaternion.premultiply(q);
  } else if (kind === 'pan') {
    const d = right.multiplyScalar(dx * dist * 0.005 * k).add(up.multiplyScalar(dy * dist * 0.005 * k));
    camera.position.add(d);
    target.add(d);
  } else if (kind === 'dolly') {
    const step = Math.min(dist * 0.01 * k * dx, dist - 0.05);
    camera.position.addScaledVector(fwd, step);
  } else if (kind === 'roll') {
    camera.quaternion.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), -dx * 0.25 * D2R * k));
  }
  camera.updateMatrixWorld();
  P3.cam.setFromObject(img, camera);
  P3.touch({ source: 'align' });
  vp.requestRender();
  commitNudge();
};

/** Put a photo camera where the 3D view currently is (same position, direction and FOV ratio kept). */
vp.cameraFromView = id => {
  const img = idx.c.get(id);
  if (!img || vp.activeCam) return false;
  camera.updateMatrixWorld();
  P3.cam.setFromObject(img, camera);
  return true;
};

vp.toggleOverlay = () => { vp.overlayHidden = !vp.overlayHidden; positionOverlay(); vp.requestRender(); P3.emit('view'); };

function onControlsChange() {
  if (vp.activeCam && vp.alignMode) {
    const img = idx.c.get(vp.activeCam);
    if (img) {
      const e = new T.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      e.z = img.rot[2] * D2R;
      camera.quaternion.setFromEuler(e);
      P3.cam.setFromObject(img, camera);
      P3.touch({ source: 'align' });
    }
  }
  vp.requestRender();
}
function onControlsEnd() {
  if (vp.activeCam && vp.alignMode) P3.history.commit('Align photo camera');
}

/* ================================================================== free view helpers */
vp.setView = name => {
  if (vp.activeCam) vp.exitCamera();
  const dirs = { top: [0, 1, 0.0001], front: [0, 0, 1], right: [1, 0, 0], iso: [1, 0.8, 1], back: [0, 0, -1], left: [-1, 0, 0], bottom: [0, -1, 0.0001] };
  const t = controls.target;
  const d = camera.position.distanceTo(t) || 10;
  camera.position.copy(t).addScaledVector(new T.Vector3(...(dirs[name] || dirs.iso)).normalize(), d);
  controls.update();
  vp.requestRender();
};

vp.frame = (selectionOnly = false) => {
  if (vp.activeCam) vp.exitCamera();
  const box = new T.Box3();
  const vids = selectionOnly ? P3.model.selectedVertexIds() : S().vertices.map(v => v.id);
  vids.forEach(id => box.expandByPoint(P3.model.vpos(id)));
  if (selectionOnly) P3.sel.ids('c').forEach(id => box.expandByPoint(P3.cam.position(idx.c.get(id))));
  if (!selectionOnly) {
    S().images.forEach(i => box.expandByPoint(P3.cam.position(i)));
    if (P3.cloud && P3.cloud.visible !== false && P3.cloud.positions.length) {
      const b = new T.Box3().setFromBufferAttribute(new T.BufferAttribute(P3.cloud.positions, 3));
      const k = S().cloudScale || 1;
      b.min.multiplyScalar(k); b.max.multiplyScalar(k);
      box.union(b);
    }
  }
  if (box.isEmpty()) box.set(new T.Vector3(-2, 0, -2), new T.Vector3(2, 2, 2));
  const c = box.getCenter(new T.Vector3());
  const rad = Math.max(0.5, box.getSize(new T.Vector3()).length() / 2);
  const dist = (rad / Math.sin((camera.fov * D2R) / 2)) * 1.05;
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (!isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(1, 0.8, 1).normalize();
  controls.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, dist);
  camera.near = Math.max(0.001, dist / 5000);
  camera.far = Math.max(1000, dist * 50);
  camera.updateProjectionMatrix();
  controls.update();
  vp.requestRender();
};

vp.nearestImage = () => {
  const imgs = S().images.filter(i => i.visible !== false);
  if (!imgs.length) return null;
  const fwd = camera.getWorldDirection(new T.Vector3());
  const pos = camera.position;
  let best = null, bs = -Infinity;
  for (const img of imgs) {
    const f = P3.cam.forward(img);
    const toCam = P3.cam.position(img).sub(pos);
    const score = f.dot(fwd) * 2 - toCam.length() / (pos.length() + 1);
    if (score > bs) { bs = score; best = img; }
  }
  return best && best.id;
};

vp.getViewState = () => ({
  pos: (vp.activeCam && savedFree ? savedFree.pos : camera.position).toArray(),
  target: (vp.activeCam && savedFree ? savedFree.target : controls.target).toArray(),
});
vp.setViewState = v => {
  if (!v) return;
  if (vp.activeCam) vp.exitCamera();
  camera.position.fromArray(v.pos);
  controls.target.fromArray(v.target);
  controls.update();
  vp.requestRender();
};

vp.screenshot = () => new Promise(res => { render(); renderer.domElement.toBlob(res, 'image/png'); });

/* ================================================================== gizmo */
vp.gizmoActive = () => !!(tc && (tc.dragging || tc.axis));
vp.setGizmoMode = mode => { vp.gizmoMode = mode; vp.updateGizmo(); P3.emit('gizmo'); };

vp.updateGizmo = () => {
  if (!tc || tc.dragging) return;
  const toolOk = !P3.tools || P3.tools.current === 'select';
  const vids = P3.model.selectedVertexIds();
  const cams = P3.sel.ids('c');
  pivot.userData = {};
  if (toolOk && cams.length === 1 && !vids.length && cams[0] !== vp.activeCam) {
    const img = idx.c.get(cams[0]);
    pivot.position.fromArray(img.pos);
    pivot.quaternion.copy(P3.cam.quat(img));
    pivot.scale.set(1, 1, 1);
    pivot.userData = { kind: 'cam', id: img.id };
    tc.setSize(1.25);
    tc.setMode(vp.gizmoMode === 'scale' ? 'translate' : vp.gizmoMode);
    tc.setSpace(vp.gizmoMode === 'rotate' ? 'local' : 'world');
    tc.attach(pivot);
  } else if (toolOk && vids.length && !(vp.activeCam && !vp.alignMode && vp.pz.z > 1)) {
    pivot.position.copy(P3.model.centroid(vids));
    pivot.quaternion.identity();
    pivot.scale.set(1, 1, 1);
    pivot.userData = { kind: 'verts', ids: vids };
    tc.setSize(0.9);
    tc.setMode(vids.length === 1 && vp.gizmoMode !== 'translate' ? 'translate' : vp.gizmoMode);
    tc.setSpace('world');
    tc.attach(pivot);
  } else {
    tc.detach();
  }
  vp.requestRender();
};

function onGizmoDown() {
  const ud = pivot.userData;
  if (!ud.kind) return;
  pivot.updateMatrix();
  gizmoStart = { inv: pivot.matrix.clone().invert(), pos: ud.kind === 'verts' ? ud.ids.map(id => P3.model.vpos(id)) : null };
}
function onGizmoChange() {
  if (!gizmoStart) return;
  const ud = pivot.userData;
  if (ud.kind === 'verts') {
    pivot.updateMatrix();
    const m = pivot.matrix.clone().multiply(gizmoStart.inv);
    ud.ids.forEach((id, i) => {
      const v = idx.v.get(id);
      if (v && gizmoStart.pos[i]) v.p = gizmoStart.pos[i].clone().applyMatrix4(m).toArray();
    });
  } else if (ud.kind === 'cam') {
    const img = idx.c.get(ud.id);
    if (img) P3.cam.setFromObject(img, pivot);
  }
  P3.touch({ source: 'gizmo' });
}
function onGizmoUp() {
  if (!gizmoStart) return;
  gizmoStart = null;
  const ud = pivot.userData;
  if (ud.kind === 'verts') {
    ud.ids.forEach(id => { const v = idx.v.get(id); if (v) v.p = v.p.map(n => U.round(n, 5)); });
    P3.history.commit(tc.mode === 'translate' ? 'Move' : tc.mode === 'rotate' ? 'Rotate' : 'Scale');
  } else {
    P3.history.commit('Move photo camera');
  }
}
})();
