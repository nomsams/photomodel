/* PhotoModel 3D — UI: panels, properties, settings, dialogs, command palette, context menu, shortcuts. */
(() => {
'use strict';
const T = window.THREE;
const P3 = window.P3;
const U = P3.util;
const vp = P3.vp;
const M = P3.model;
const idx = P3.idx;
const S = () => P3.state;
const $ = sel => document.querySelector(sel);

const ui = (P3.ui = {});

/* ================================================================== DOM helpers */
function h(tag, attrs = {}, ...children) {
  const el = tag === 'svg' || tag === 'use' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string' && tag !== 'svg') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
const icon = name => { const s = h('svg', { class: 'ic' }); s.append(h('use', { href: '#i-' + name })); return s; };
ui.h = h;
ui.icon = icon;

ui.toast = (msg, kind = '', action) => {
  const el = h('div', { class: 'toast ' + kind }, h('span', {}, msg));
  if (action) el.append(h('button', { class: 'small', onclick: () => { action.fn(); el.remove(); } }, action.label));
  $('#toasts').append(el);
  const life = kind === 'error' ? 5200 : action ? 5000 : 2800;
  setTimeout(() => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; setTimeout(() => el.remove(), 320); }, life);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
};
ui.hint = () => {
  const el = $('#stHint');
  if (el && P3.tools) el.textContent = P3.tools.hint();
  const t = $('#stTool');
  if (t && P3.tools) t.textContent = P3.tools.label();
};
ui.coords = (p, kind) => {
  const el = $('#stCoords');
  if (el) el.textContent = p ? `x ${U.fmt(p.x)}  y ${U.fmt(p.y)}  z ${U.fmt(p.z)}${kind ? '   ' + kind : ''}` : '';
};
ui.saved = text => { const el = $('#stSaved'); if (el) el.textContent = text; };
ui.progress = (text, frac) => {
  const el = $('#progress');
  if (text == null) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  $('#progressText').textContent = text;
  $('#progressBar').style.width = Math.round(U.clamp(frac || 0, 0, 1) * 100) + '%';
};

/* ================================================================== tooltips (styled title attributes) */
function initTooltips() {
  const tip = $('#tooltip');
  let timer = null, cur = null;
  const show = el => {
    const text = el.dataset.tip;
    if (!text) return;
    const m = text.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    tip.innerHTML = '';
    const isKeys = s => s.length <= 24 && /^[A-Za-z0-9+.\[\]\/ ,?-]+$/.test(s) && s.split(/[\s+\/,]+/).every(w => w.length <= 2 || /^[A-Z]/.test(w));
    if (m && isKeys(m[2])) tip.append(h('span', {}, m[1]), ...m[2].split(/\s*\/\s*|,\s*/).map(k => h('kbd', {}, k)));
    else tip.append(h('span', {}, text));
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2, y = r.bottom + 8;
    if (y + tr.height > innerHeight - 6) y = r.top - tr.height - 8;
    if (el.closest('#toolbar')) { x = r.right + 10; y = r.top + r.height / 2 - tr.height / 2; }
    tip.style.left = U.clamp(x, 6, innerWidth - tr.width - 6) + 'px';
    tip.style.top = Math.max(6, y) + 'px';
  };
  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[title], [data-tip]');
    if (!el || el === cur || el.closest('svg#pinLayer') || el.closest('#axisGizmo')) return;
    if (el.hasAttribute('title')) { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); }
    cur = el;
    clearTimeout(timer);
    tip.classList.add('hidden');
    timer = setTimeout(() => { if (cur === el && document.body.contains(el)) show(el); }, 380);
  });
  document.addEventListener('mouseout', e => {
    if (cur && !cur.contains(e.relatedTarget)) { cur = null; clearTimeout(timer); tip.classList.add('hidden'); }
  });
  document.addEventListener('pointerdown', () => { clearTimeout(timer); tip.classList.add('hidden'); }, true);
}

/* ================================================================== modals */
function openModal({ title, body, buttons = [{ label: 'Close', value: null }], wide = false, cls = '' }) {
  return new Promise(resolve => {
    const close = v => { backdrop.remove(); resolve(v); };
    const footer = buttons.length ? h('footer', {}, buttons.map(b => h('button', { class: b.cls || '', onclick: () => close(typeof b.value === 'function' ? b.value() : b.value) }, b.label))) : null;
    const modal = h('div', { class: 'modal ' + cls, style: wide ? 'width:min(760px,100%)' : null },
      title ? h('header', {}, h('h2', {}, title), h('button', { class: 'icon-btn ghost', title: 'Close (Esc)', onclick: () => close(null) }, icon('close'))) : null,
      h('div', { class: 'body' }, body),
      footer);
    const backdrop = h('div', { class: 'modal-backdrop', onmousedown: e => { if (e.target === backdrop) close(null); } }, modal);
    backdrop._close = close;
    $('#modalRoot').append(backdrop);
    const first = modal.querySelector('.body input:not([type=checkbox]):not([type=range]), .body select');
    if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 30);
  });
}
const closeTopModal = () => { const m = [...document.querySelectorAll('.modal-backdrop')].pop(); if (m) m._close(null); };
const modalOpen = () => !!document.querySelector('.modal-backdrop');

ui.confirm = (title, html, okLabel = 'OK', danger = false) =>
  openModal({ title, body: h('div', { html: `<p style="margin:0">${html}</p>` }), buttons: [{ label: 'Cancel', value: false }, { label: okLabel, cls: danger ? 'primary danger' : 'primary', value: true }] }).then(v => !!v);

ui.form = (title, fields, okLabel = 'OK', note) => {
  const inputs = {};
  const body = h('div', {}, note ? h('p', { class: 'muted', style: 'margin:0 0 10px', html: note }) : null, fields.map(f => {
    let ctl;
    if (f.type === 'check') ctl = h('input', { type: 'checkbox', checked: !!f.value });
    else if (f.type === 'select') ctl = h('select', {}, f.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(f.value) }, l)));
    else ctl = h('input', { type: f.type || 'text', value: f.value, step: f.step || 'any' });
    inputs[f.key] = ctl;
    ctl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const b = [...document.querySelectorAll('.modal footer .primary')].pop(); if (b) b.click(); } });
    return h('div', { class: 's-row' }, h('label', {}, f.label), h('div', { class: 'ctl' }, ctl));
  }));
  const read = () => Object.fromEntries(fields.map(f => {
    const c = inputs[f.key];
    return [f.key, f.type === 'check' ? c.checked : f.type === 'number' ? +c.value : c.value];
  }));
  return openModal({ title, body, buttons: [{ label: 'Cancel', value: null }, { label: okLabel, cls: 'primary', value: read }] });
};

/* ================================================================== actions */
const A = (P3.actions = {});
/** Commit and report whether a new undo step was actually created. */
const commit = label => { const n = P3.history.undoStack.length, top = P3.history.undoStack[n - 1]; P3.history.commit(label); const m = P3.history.undoStack.length; return m !== n || P3.history.undoStack[m - 1] !== top; };
let lastCommitChanged = false;
const commitT = label => (lastCommitChanged = commit(label));
const undoToast = (msg, kind = '') => ui.toast(msg, kind, lastCommitChanged ? { label: 'Undo', fn: () => A.undo() } : null);

A.newProject = async () => {
  if ((S().vertices.length || S().images.length) && P3.history.dirty && !(await ui.confirm('Start a new project?', 'The current project has unsaved changes. Save it first if you want to keep it.', 'Discard & start new', true))) return;
  await P3.io.newProject();
  ui.toast('New project');
};
A.open = async () => {
  if ((S().vertices.length || S().images.length) && P3.history.dirty && !(await ui.confirm('Open a project?', 'Opening a project replaces the current one, which has unsaved changes.', 'Continue'))) return;
  $('#fileProject').click();
};
A.save = saveAs => P3.io.save(saveAs === true);
A.saveAs = () => P3.io.save(true);
A.importImages = () => $('#fileImages').click();
A.importCloud = () => $('#fileCloud').click();
A.importObj = () => $('#fileObj').click();
A.exportAs = fmt => P3.io.export(fmt);
A.demo = async () => {
  if ((S().vertices.length || S().images.length) && P3.history.dirty && !(await ui.confirm('Load the demo?', 'The demo replaces the current project, which has unsaved changes.', 'Load demo'))) return;
  await P3.demo.load();
};
A.menu = id => {
  const m = document.getElementById(id);
  const open = !m.classList.contains('open');
  closeMenus();
  if (open) m.classList.add('open');
};
const closeMenus = () => {
  document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
  $('#ctxMenu').classList.add('hidden');
};

A.undo = () => { const l = P3.history.undo(); if (l) ui.toast('Undid: ' + l); else ui.toast('Nothing to undo'); };
A.redo = () => { const l = P3.history.redo(); if (l) ui.toast('Redid: ' + l); else ui.toast('Nothing to redo'); };
A.help = () => showHelp();
A.settings = () => showSettings();
A.palette = () => showPalette();

const narrow = () => window.matchMedia('(max-width: 900px)').matches;
A.toggleLeft = () => {
  const ws = $('#workspace');
  if (narrow()) { ws.classList.toggle('open-left'); ws.classList.remove('open-right'); } else ws.classList.toggle('hide-left');
};
A.toggleRight = () => {
  const ws = $('#workspace');
  if (narrow()) { ws.classList.toggle('open-right'); ws.classList.remove('open-left'); } else ws.classList.toggle('hide-right');
};

A.deleteSelection = () => {
  if (P3.sel.empty) return;
  const n = M.deleteSelection();
  commitT('Delete');
  P3.emit('selection');
  undoToast(`Deleted ${n} item${n === 1 ? '' : 's'}`);
};
A.deletePhoto = id => {
  const img = idx.c.get(id);
  if (!img) return;
  S().images = S().images.filter(i => i.id !== id);
  commitT('Delete photo');
  undoToast(`Deleted photo “${img.name}”`);
};
A.selectAll = () => {
  const s = S();
  P3.sel.set([...s.vertices.map(v => 'v:' + v.id), ...s.edges.map(e => 'e:' + e.id), ...s.faces.map(f => 'f:' + f.id)]);
};
A.selectNone = () => P3.sel.clear();
A.invertSelection = () => {
  const s = S();
  const all = [...s.vertices.map(v => 'v:' + v.id), ...s.edges.map(e => 'e:' + e.id), ...s.faces.map(f => 'f:' + f.id)];
  P3.sel.set(all.filter(k => !P3.sel.list.includes(k)));
};
A.makeFace = () => {
  const ids = P3.sel.ids('v');
  if (ids.length < 3) return ui.toast('Select 3 or more points (in order) to make a face', 'error');
  const fid = M.addFace(ids);
  if (!fid) return ui.toast('Could not create face', 'error');
  commit('Make face');
  P3.sel.set(['f:' + fid]);
};
A.connect = () => {
  const ids = P3.sel.ids('v');
  if (ids.length < 2) return ui.toast('Select 2 or more points to connect', 'error');
  const n = M.connectChain(ids);
  commit('Connect points');
  ui.toast(`Added ${n} line(s)`);
};
A.merge = () => {
  const ids = P3.sel.ids('v');
  if (ids.length < 2) return ui.toast('Select 2 or more points to merge', 'error');
  const keep = M.mergeVertices(ids);
  commit('Merge points');
  P3.sel.set(['v:' + keep]);
};
A.splitEdge = () => {
  const ids = P3.sel.ids('e');
  if (!ids.length) return ui.toast('Select a line to split', 'error');
  const nv = ids.map(id => M.splitEdge(id)).filter(Boolean);
  commit('Split line');
  P3.sel.set(nv.map(id => 'v:' + id));
};
A.flipFaces = () => { if (!P3.sel.ids('f').length) return; M.flipFaces(P3.sel.ids('f')); commit('Flip face'); };
A.duplicate = () => {
  if (!M.selectedVertexIds().length) return ui.toast('Select geometry to duplicate', 'error');
  const step = Math.max(+P3.settings.gridSize || 1, 0.1);
  const keys = M.duplicate(new T.Vector3(step, 0, 0));
  commit('Duplicate');
  P3.sel.set(keys);
  if (P3.tools.current !== 'select') P3.tools.set('select');
  vp.setGizmoMode('translate');
  ui.toast('Duplicated — drag the gizmo to place the copy');
};
A.mirror = axis => {
  axis = axis || 'x';
  if (!M.selectedVertexIds().length) return ui.toast('Select geometry to mirror', 'error');
  const keys = M.mirror(axis);
  commit('Mirror ' + axis.toUpperCase());
  P3.sel.set(keys.length ? keys : P3.sel.list);
  ui.toast(`Mirrored across the ${axis.toUpperCase()} = 0 plane (points on the plane are shared)`);
};
A.extrude = async () => {
  const fs = P3.sel.ids('f');
  if (!fs.length) return ui.toast('Select one or more faces to extrude', 'error');
  const v = await ui.form('Extrude faces', [{ key: 'd', label: `Distance (${P3.settings.units})`, type: 'number', value: +P3.settings.gridSize || 1, step: 0.05 }], 'Extrude',
    'Pushes the selected faces out along their normals and builds the sides. Use a negative distance to go inwards.');
  if (!v || !v.d) return;
  const tops = M.extrude(fs, v.d);
  commit('Extrude');
  P3.sel.set(tops.map(id => 'f:' + id));
};
A.setLength = async () => {
  const es = P3.sel.ids('e');
  if (es.length !== 1) return ui.toast('Select exactly one line of known length', 'error');
  const e = idx.e.get(es[0]);
  const cur = M.vpos(e.a).distanceTo(M.vpos(e.b));
  if (cur < 1e-9) return;
  const v = await ui.form('Set real-world scale', [
    { key: 'len', label: 'Real length of this line', type: 'number', value: U.round(cur, 4), step: 0.001 },
    { key: 'units', label: 'Units', type: 'select', value: P3.settings.units, options: UNITS },
  ], 'Scale model', 'The whole scene (points, cameras and point cloud) is scaled around the origin so this line gets the length you enter. Exports then use real units.');
  if (!v || !(v.len > 0)) return;
  P3.setSetting('units', v.units);
  M.scaleScene(v.len / cur);
  commit('Set scale');
  P3.emit('cloud');
  ui.toast(`Scaled scene ×${U.round(v.len / cur, 4)} — line is now ${U.len(v.len)}`, 'ok');
  vp.frame();
};
A.groupSelection = () => {
  if (P3.sel.empty) return ui.toast('Select faces, lines or points first, then group them into an object', 'error');
  const name = 'Object ' + (S().objects.length + 1);
  const id = M.groupSelection(name);
  if (!id) return ui.toast('Selection has no faces or lines to group', 'error');
  commit('Group into object');
  ui.toast(`Created “${name}” — double-click its name to rename`, 'ok');
};
A.frame = () => { if (vp.activeCam) return vp.resetPhotoZoom(); vp.frame(!P3.sel.empty); };
A.view = name => vp.setView(name);
A.nearest = () => {
  const id = vp.nearestImage();
  if (!id) return ui.toast('No photos yet', 'error');
  vp.enterCamera(id);
};
const stepImage = dir => {
  const imgs = S().images.filter(i => i.visible !== false);
  if (!imgs.length) return ui.toast('No photos yet', 'error');
  let i = imgs.findIndex(x => x.id === vp.activeCam);
  if (i < 0) i = dir > 0 ? -1 : 0;
  vp.enterCamera(imgs[(i + dir + imgs.length) % imgs.length].id);
};
A.prevImage = () => stepImage(-1);
A.nextImage = () => stepImage(1);
A.lookThrough = id => { id = +id || P3.sel.ids('c')[0]; if (id) vp.enterCamera(id); };
A.exitCamera = () => vp.exitCamera();
A.resetPhotoZoom = () => vp.resetPhotoZoom();
A.toggleAlign = () => {
  if (!vp.activeCam) return ui.toast('Look through a photo first');
  vp.setAlign(!vp.alignMode);
  ui.toast(vp.alignMode ? 'Align ON — orbit / pan / zoom now moves this photo’s camera' : 'Align OFF — view locked to the photo');
};
A.toggleOverlay = () => { if (vp.activeCam) vp.toggleOverlay(); };
A.toggleSnap = () => P3.setSetting('snapToGrid', !P3.settings.snapToGrid);
A.toggleGrid = () => P3.setSetting('showGrid', !P3.settings.showGrid);
A.toggleTheme = () => P3.setSetting('theme', P3.settings.theme === 'dark' ? 'light' : 'dark');
A.planeToSelection = () => {
  const vids = M.selectedVertexIds();
  if (!vids.length) return ui.toast('Select a point first', 'error');
  P3.setSetting('workPlaneOffset', U.round(M.centroid(vids)[vp.planeAxis()], 4));
  ui.toast('Work plane moved through the selection');
};
A.arrange = async () => {
  const selCams = P3.sel.ids('c');
  const st = P3.settings;
  const v = await ui.form('Arrange photo cameras in a ring', [
    { key: 'scope', label: 'Apply to', type: 'select', value: selCams.length > 1 ? 'sel' : 'all', options: [['all', 'All photos'], ['sel', `Selected photos (${selCams.length})`]] },
    { key: 'radius', label: 'Radius', type: 'number', value: st.ringRadius, step: 0.1 },
    { key: 'height', label: 'Camera height (Y)', type: 'number', value: st.ringHeight, step: 0.1 },
    { key: 'targetY', label: 'Look-at height (Y)', type: 'number', value: 0, step: 0.1 },
    { key: 'startAngle', label: 'Start angle (°)', type: 'number', value: 0, step: 5 },
    { key: 'clockwise', label: 'Clockwise order', type: 'check', value: false },
  ], 'Arrange', 'A quick starting layout — photos in list order, evenly around the origin. Refine each with Align or with pins + Solve.');
  if (!v) return;
  const imgs = v.scope === 'sel' ? selCams.map(id => idx.c.get(id)).filter(Boolean) : S().images;
  if (!imgs.length) return ui.toast('No photos to arrange', 'error');
  M.arrangeRing(imgs, v);
  P3.setSetting('ringRadius', v.radius);
  P3.setSetting('ringHeight', v.height);
  commit('Arrange photos');
  if (!vp.activeCam) vp.frame();
};
A.lookAtCenter = id => {
  id = +id || P3.sel.ids('c')[0];
  const img = idx.c.get(id);
  if (!img) return;
  P3.cam.lookAt(img, vp.sceneCenter());
  commit('Aim photo camera');
};
A.solveCamera = async (arg) => {
  const id = (+arg) || vp.activeCam || P3.sel.ids('c')[0];
  const img = idx.c.get(id);
  if (!img) return ui.toast('Select or look through a photo first', 'error');
  const n = (img.pins || []).length;
  if (n < 4) return ui.toast(`Solve needs 4+ pinned points in this photo (it has ${n}). Use the Pin tool (K).`, 'error');
  let solveFov = arg === 'fov';
  if (arg !== 'fov' && arg !== 'pose' && n >= 6 && img.fovSource !== 'exif') solveFov = true;
  ui.progress('Solving camera…', 0.5);
  await U.nextFrame();
  const before = P3.solve.imageRms(img);
  const res = P3.solve.camera(img, { solveFov });
  ui.progress(null);
  if (res.error) return ui.toast(res.error, 'error');
  commitT(solveFov ? 'Solve camera + FOV' : 'Solve camera');
  if (vp.activeCam === img.id) vp.refreshCamera();
  undoToast(`Solved “${img.name}” from ${res.n} pins — error ${before != null ? before.toFixed(1) + ' → ' : ''}${res.rms.toFixed(2)} px${solveFov ? ` · FOV ${U.round(res.fov, 2)}°` : ''}`, res.rms < 8 ? 'ok' : 'error');
};
A.retriangulate = () => {
  const ids = P3.sel.ids('v');
  if (!ids.length) return ui.toast('Select pinned points first', 'error');
  let ok = 0, last = null;
  for (const id of ids) { const r = P3.solve.triangulateVertex(id); if (!r.error) ok++; else last = r.error; }
  if (!ok) return ui.toast(last || 'Nothing to triangulate', 'error');
  if (!commitT('Re-triangulate')) return ui.toast('Already at the best position for its pins', 'ok');
  undoToast(`Re-triangulated ${ok} point(s) from their pins`, 'ok');
};
A.refineAll = async () => {
  if (!idx.pins.size) return ui.toast('No pins yet — pin points in photos with the Pin tool (K)', 'error');
  ui.progress('Refining cameras and points…', 0.5);
  await U.nextFrame();
  const r = P3.solve.refineAll();
  ui.progress(null);
  commitT('Refine all');
  undoToast(`Refined ${r.cams} camera(s) and ${r.pts} point(s)${r.rms != null ? ` — mean error ${r.rms.toFixed(2)} px` : ''}`, 'ok');
};
A.clearPins = id => {
  const img = idx.c.get(+id || vp.activeCam || P3.sel.ids('c')[0]);
  if (!img || !img.pins.length) return;
  img.pins = [];
  commitT('Clear pins');
  undoToast(`Cleared pins of “${img.name}”`);
};
A.pinTool = () => { P3.tools.set('match'); if (!vp.activeCam) ui.toast('Now look through a photo (double-click a camera) and click points'); };
A.deleteObject = id => {
  const o = idx.o.get(id);
  if (!o) return;
  const fs = new Set(o.faces), es = new Set(o.edges);
  for (const fid of o.faces) {
    const f = idx.f.get(fid);
    for (let i = 0; i < f.v.length; i++) { const e = M.findEdge(f.v[i], f.v[(i + 1) % f.v.length]); if (e) es.add(e.id); }
  }
  const vs = new Set();
  fs.forEach(fid => idx.f.get(fid).v.forEach(v => vs.add(v)));
  es.forEach(eid => { const e = idx.e.get(eid); vs.add(e.a); vs.add(e.b); });
  for (const f of S().faces) if (!fs.has(f.id)) f.v.forEach(v => vs.delete(v));
  for (const e of S().edges) if (!es.has(e.id)) { vs.delete(e.a); vs.delete(e.b); }
  P3.sel.set([...[...fs].map(i => 'f:' + i), ...[...es].map(i => 'e:' + i), ...[...vs].map(i => 'v:' + i)], true);
  M.deleteSelection();
  commitT('Delete object');
  P3.emit('selection');
  undoToast(`Deleted object “${o.name}”`);
};
A.ungroupObject = id => { S().objects = S().objects.filter(o => o.id !== id); commit('Ungroup object'); };
A.selectObject = (id, add) => {
  const o = idx.o.get(id);
  if (!o) return;
  const keys = [...o.faces.map(i => 'f:' + i), ...o.edges.map(i => 'e:' + i)];
  if (add) P3.sel.add(keys); else P3.sel.set(keys);
};
A.clearCloud = () => { P3.cloud = null; S().cloudScale = 1; P3.emit('cloud'); P3.io.markCloudDirty(); updateCounts(); };
A.toggleCloud = () => { if (!P3.cloud) return; P3.cloud.visible = P3.cloud.visible === false; P3.emit('cloud'); P3.io.markCloudDirty(); };
A.cloudToPoints = async () => {
  const c = P3.cloud;
  if (!c) return;
  const n = c.positions.length / 3, k = S().cloudScale || 1;
  const step = Math.max(1, Math.ceil(n / 5000));
  if (!(await ui.confirm('Convert point cloud to points?', `This adds ${Math.ceil(n / step).toLocaleString()} editable points${step > 1 ? ` (every ${step}th point)` : ''} to the model.`, 'Convert'))) return;
  for (let i = 0; i < n; i += step) M.addVertex(new T.Vector3(c.positions[i * 3] * k, c.positions[i * 3 + 1] * k, c.positions[i * 3 + 2] * k));
  commit('Cloud to points');
};
A.tool = name => P3.tools.set(name);
A.gizmo = m => vp.setGizmoMode(m);

/* ================================================================== command registry (palette + context menu) */
const has = {
  v: () => P3.sel.ids('v').length, e: () => P3.sel.ids('e').length, f: () => P3.sel.ids('f').length, c: () => P3.sel.ids('c').length,
  geo: () => M.selectedVertexIds().length, cam: () => !!vp.activeCam, imgs: () => S().images.length,
};
const CMDS = [
  { g: 'File', l: 'New project', i: 'new', run: A.newProject },
  { g: 'File', l: 'Open project…', i: 'open', k: 'Ctrl O', run: A.open },
  { g: 'File', l: 'Save project', i: 'save', k: 'Ctrl S', run: () => A.save() },
  { g: 'File', l: 'Save project as…', i: 'save', k: 'Ctrl Shift S', run: A.saveAs },
  { g: 'File', l: 'Import photos…', i: 'image', k: 'I', run: A.importImages },
  { g: 'File', l: 'Import point cloud…', i: 'cloud', run: A.importCloud },
  { g: 'File', l: 'Import OBJ model…', i: 'cube', run: A.importObj },
  { g: 'File', l: 'Load demo project', i: 'sparkle', run: A.demo },
  ...['obj', 'glb', 'stl', 'ply', 'cameras', 'png'].map(f => ({ g: 'Export', l: 'Export ' + { obj: 'OBJ', glb: 'GLB (glTF)', stl: 'STL', ply: 'points as PLY', cameras: 'camera poses (JSON)', png: 'screenshot (PNG)' }[f], i: 'export', run: () => A.exportAs(f) })),
  { g: 'Edit', l: 'Undo', i: 'undo', k: 'Ctrl Z', run: A.undo },
  { g: 'Edit', l: 'Redo', i: 'redo', k: 'Ctrl Y', run: A.redo },
  { g: 'Edit', l: 'Select all', k: 'Ctrl A', run: A.selectAll },
  { g: 'Edit', l: 'Select none', run: A.selectNone },
  { g: 'Edit', l: 'Invert selection', run: A.invertSelection },
  { g: 'Edit', l: 'Delete selection', i: 'trash', k: 'Del', run: A.deleteSelection, when: () => !P3.sel.empty, ctx: true, danger: true },
  { g: 'Tools', l: 'Select tool', i: 'select', k: 'V', run: () => A.tool('select') },
  { g: 'Tools', l: 'Point tool', i: 'point', k: 'P', run: () => A.tool('point') },
  { g: 'Tools', l: 'Line tool', i: 'line', k: 'L', run: () => A.tool('line') },
  { g: 'Tools', l: 'Face tool', i: 'face', k: 'F', run: () => A.tool('face') },
  { g: 'Tools', l: 'Triangulate tool', i: 'tri', k: 'T', run: () => A.tool('triangulate') },
  { g: 'Tools', l: 'Pin tool (match points to photos)', i: 'pin', k: 'K', run: A.pinTool },
  { g: 'Model', l: 'Make face from selected points', i: 'face', k: 'Enter', run: A.makeFace, when: () => has.v() >= 3, ctx: true },
  { g: 'Model', l: 'Connect selected points', i: 'line', k: 'C', run: A.connect, when: () => has.v() >= 2, ctx: true },
  { g: 'Model', l: 'Merge selected points', k: 'M', run: A.merge, when: () => has.v() >= 2, ctx: true },
  { g: 'Model', l: 'Split line at middle', run: A.splitEdge, when: () => has.e(), ctx: true },
  { g: 'Model', l: 'Set real length (scale scene)…', i: 'scale', run: A.setLength, when: () => has.e() === 1, ctx: true },
  { g: 'Model', l: 'Extrude faces…', i: 'cube', k: 'X', run: A.extrude, when: () => has.f(), ctx: true },
  { g: 'Model', l: 'Flip faces', run: A.flipFaces, when: () => has.f(), ctx: true },
  { g: 'Model', l: 'Duplicate', i: 'copy', k: 'Ctrl D', run: A.duplicate, when: () => has.geo(), ctx: true },
  ...['x', 'y', 'z'].map(a => ({ g: 'Model', l: `Mirror across ${a.toUpperCase()} = 0`, run: () => A.mirror(a), when: () => has.geo(), ctx: a === 'x' })),
  { g: 'Model', l: 'Group into object', i: 'layers', k: 'Ctrl G', run: A.groupSelection, when: () => has.geo(), ctx: true },
  { g: 'Model', l: 'Move work plane through selection', i: 'grid', run: A.planeToSelection, when: () => has.geo(), ctx: true },
  { g: 'Photos', l: 'Re-triangulate selected points from pins', i: 'tri', run: A.retriangulate, when: () => P3.sel.ids('v').some(id => (idx.pins.get(id) || []).length >= 2), ctx: true },
  { g: 'Photos', l: 'Look through selected photo', i: 'camera', run: () => A.lookThrough(), when: () => has.c() === 1, ctx: true },
  { g: 'Photos', l: 'Solve camera from pins', i: 'solve', run: () => A.solveCamera(), when: () => (has.c() === 1 || has.cam()), ctx: true },
  { g: 'Photos', l: 'Solve camera + field of view', i: 'solve', run: () => A.solveCamera('fov'), when: () => (has.c() === 1 || has.cam()) },
  { g: 'Photos', l: 'Aim camera at model', i: 'target', run: () => A.lookAtCenter(), when: () => has.c() === 1, ctx: true },
  { g: 'Photos', l: 'Refine all cameras & points from pins', i: 'solve', run: A.refineAll, when: () => idx.pins.size > 0 },
  { g: 'Photos', l: 'Arrange photos in a ring…', run: A.arrange, when: has.imgs },
  { g: 'Photos', l: 'Next photo', i: 'right', k: ']', run: A.nextImage, when: has.imgs },
  { g: 'Photos', l: 'Previous photo', i: 'left', k: '[', run: A.prevImage, when: has.imgs },
  { g: 'Photos', l: 'Nearest photo to current view', i: 'camera', k: 'N', run: A.nearest, when: has.imgs },
  { g: 'Photos', l: 'Toggle Align mode', i: 'align', k: 'A', run: A.toggleAlign, when: has.cam },
  { g: 'Photos', l: 'Show / hide photo overlay', i: 'image', k: 'O', run: A.toggleOverlay, when: has.cam },
  { g: 'Photos', l: 'Exit photo view', i: 'close', k: 'Esc', run: A.exitCamera, when: has.cam },
  { g: 'View', l: 'Frame all / selection', i: 'frame', k: 'Home', run: A.frame, ctx: true },
  { g: 'View', l: 'Top view', k: '1', run: () => A.view('top') },
  { g: 'View', l: 'Front view', k: '2', run: () => A.view('front') },
  { g: 'View', l: 'Right view', k: '3', run: () => A.view('right') },
  { g: 'View', l: '3D view', k: '4', run: () => A.view('iso') },
  { g: 'View', l: 'Toggle grid', i: 'grid', k: 'G', run: A.toggleGrid },
  { g: 'View', l: 'Toggle grid snapping', i: 'magnet', k: 'S', run: A.toggleSnap },
  { g: 'View', l: 'Toggle light / dark theme', run: A.toggleTheme },
  { g: 'View', l: 'Show / hide photos panel', i: 'menu', run: A.toggleLeft },
  { g: 'View', l: 'Show / hide properties panel', i: 'panel', run: A.toggleRight },
  { g: 'Help', l: 'Settings', i: 'settings', run: A.settings },
  { g: 'Help', l: 'Help & keyboard shortcuts', i: 'keyboard', k: '?', run: A.help },
];

function cmdButton(c, onDone) {
  return h('button', { class: c.danger ? 'danger' : '', onclick: () => { onDone && onDone(); c.run(); } }, c.i ? icon(c.i) : h('span', { style: 'width:18px' }), c.l, c.k ? h('kbd', {}, c.k) : null);
}

/* ---------- context menu ---------- */
ui.contextMenu = (x, y) => {
  const m = $('#ctxMenu');
  m.innerHTML = '';
  const items = P3.sel.empty
    ? CMDS.filter(c => ['Import photos…', 'Frame all / selection', 'Select all', 'Toggle grid', 'Nearest photo to current view'].includes(c.l) && (!c.when || c.when()))
    : CMDS.filter(c => c.ctx && (!c.when || c.when())).sort((a, b) => (a.danger ? 1 : 0) - (b.danger ? 1 : 0));
  if (!P3.sel.empty) {
    const n = P3.sel.list.length;
    m.append(h('div', { class: 'menu-label' }, `${n} item${n === 1 ? '' : 's'} selected`));
  }
  let lastG = null;
  for (const c of items) {
    if (c.danger) m.append(h('div', { class: 'menu-sep' }));
    else if (lastG && c.g !== lastG) m.append(h('div', { class: 'menu-sep' }));
    lastG = c.g;
    m.append(cmdButton(c, closeMenus));
  }
  m.classList.remove('hidden');
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
};

/* ---------- command palette ---------- */
function showPalette() {
  if (modalOpen()) return;
  const input = h('input', { type: 'text', placeholder: 'Type a command or a photo name…', spellcheck: 'false' });
  const list = h('div', { class: 'p-list' });
  let items = [], active = 0;
  const photoCmds = () => S().images.map(img => ({ g: 'Photo', l: 'Look through: ' + img.name, i: 'camera', run: () => vp.enterCamera(img.id) }));
  const render = () => {
    const q = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    items = [...CMDS, ...photoCmds()].filter(c => (!c.when || c.when()) && q.every(w => (c.g + ' ' + c.l).toLowerCase().includes(w)));
    active = U.clamp(active, 0, Math.max(0, items.length - 1));
    list.innerHTML = '';
    if (!items.length) { list.append(h('div', { class: 'p-empty' }, 'No matching commands')); return; }
    items.slice(0, 60).forEach((c, i) => {
      const b = h('button', { class: 'p-item' + (i === active ? ' kb' : ''), onclick: () => run(i), onmousemove: () => { if (active !== i) { active = i; mark(); } } },
        h('span', { class: 'grp' }, c.g), c.i ? icon(c.i) : h('span', { style: 'width:18px' }), c.l, c.k ? h('kbd', {}, c.k) : null);
      list.append(b);
    });
  };
  const mark = () => [...list.children].forEach((b, i) => b.classList.toggle('kb', i === active));
  const run = i => { const c = items[i]; if (!c) return; closeTopModal(); setTimeout(() => c.run(), 0); };
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); mark(); list.children[active]?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); mark(); list.children[active]?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    else if (e.key === 'Enter') { run(active); e.preventDefault(); }
  });
  render();
  const body = h('div', {}, h('div', { class: 'p-input' }, icon('search'), input, h('kbd', {}, 'Esc')), list);
  openModal({ body, buttons: [], cls: 'palette' });
  setTimeout(() => input.focus(), 20);
}

/* ================================================================== image list */
function pinBadge(img) {
  const n = (img.pins || []).length;
  if (!n) return null;
  const rms = P3.solve.imageRms(img);
  const cls = P3.solve.errorClass(rms);
  return h('span', { class: 'badge ' + cls, title: `${n} pin${n === 1 ? '' : 's'} · reprojection error ${rms == null ? '—' : rms.toFixed(1) + ' px'}` }, `${n}·${rms == null ? '—' : rms < 10 ? rms.toFixed(1) : Math.round(rms)}`);
}
function renderImageList() {
  const list = $('#imageList');
  const imgs = S().images;
  $('#imgCount').textContent = imgs.length;
  list.innerHTML = '';
  if (!imgs.length) {
    list.append(h('div', { class: 'list-empty' }, 'No photos yet.', h('br'), 'Click “Add”, drop photos onto the window, or ', h('a', { href: '#', onclick: e => { e.preventDefault(); A.demo(); } }, 'load the demo'), '.'));
    return;
  }
  for (const img of imgs) {
    const rec = P3.images.get(img.id);
    const viewing = vp.activeCam === img.id;
    const cls = ['img-item', P3.sel.has('c', img.id) && 'selected', viewing && 'viewing', img.visible === false && 'dim'].filter(Boolean).join(' ');
    const meta = `${img.w}×${img.h} · ${U.round(img.fov, 1)}°${img.fovSource === 'exif' ? ' EXIF' : ''}`;
    const item = h('div', { class: cls },
      h('div', { class: 'thumb' }, h('img', { src: rec ? rec.thumb : '', alt: '', loading: 'lazy' }), pinBadge(img)),
      h('div', { class: 'item-main' }, h('div', { class: 'item-name', title: img.name }, img.name), h('div', { class: 'item-meta' }, meta)),
      h('div', { class: 'item-actions' },
        h('button', { class: viewing ? 'on' : '', title: viewing ? 'Back to free view (Esc)' : 'Look through this photo', onclick: e => { e.stopPropagation(); viewing ? vp.exitCamera() : vp.enterCamera(img.id); } }, icon('camera')),
        h('button', { title: img.visible === false ? 'Show camera' : 'Hide camera', onclick: e => { e.stopPropagation(); img.visible = img.visible === false; commit(img.visible ? 'Show photo' : 'Hide photo'); } }, icon(img.visible === false ? 'eye-off' : 'eye')),
        h('button', { class: 'danger', title: 'Delete photo', onclick: e => { e.stopPropagation(); A.deletePhoto(img.id); } }, icon('trash'))));
    item.addEventListener('click', e => { if (e.shiftKey || e.ctrlKey || e.metaKey) P3.sel.toggle('c:' + img.id); else P3.sel.set(['c:' + img.id]); });
    item.addEventListener('dblclick', () => vp.enterCamera(img.id));
    item.addEventListener('contextmenu', e => { e.preventDefault(); if (!P3.sel.has('c', img.id)) P3.sel.set(['c:' + img.id]); ui.contextMenu(e.clientX, e.clientY); });
    list.append(item);
  }
  const v = list.querySelector('.viewing');
  if (v) v.scrollIntoView({ block: 'nearest' });
}

/* ================================================================== object list */
function renderObjectList() {
  const list = $('#objectList');
  const objs = S().objects;
  $('#objCount').textContent = objs.length;
  list.innerHTML = '';
  if (!objs.length) {
    list.append(h('div', { class: 'list-empty' }, 'Select faces / lines and click “Group selection” to combine them into a named object.'));
    return;
  }
  for (const o of objs) {
    const n = o.faces.length + o.edges.length;
    const selected = n > 0 && o.faces.every(id => P3.sel.has('f', id)) && o.edges.every(id => P3.sel.has('e', id));
    const nameEl = h('div', { class: 'item-name', title: 'Double-click to rename' }, o.name);
    const item = h('div', { class: 'obj-item' + (selected ? ' selected' : ''), style: o.visible === false ? 'opacity:.5' : null },
      h('input', { type: 'color', value: o.color, title: 'Object colour', onclick: e => e.stopPropagation(), oninput: e => { o.color = e.target.value; P3.touch(); }, onchange: () => commit('Object colour') }),
      h('div', { class: 'item-main' }, nameEl, h('div', { class: 'item-meta' }, `${o.faces.length} faces · ${o.edges.length} lines`)),
      h('div', { class: 'item-actions' },
        h('button', { title: o.visible === false ? 'Show' : 'Hide', onclick: e => { e.stopPropagation(); o.visible = o.visible === false; commit(o.visible ? 'Show object' : 'Hide object'); } }, icon(o.visible === false ? 'eye-off' : 'eye')),
        h('button', { title: 'Ungroup (keep geometry)', onclick: e => { e.stopPropagation(); A.ungroupObject(o.id); } }, icon('layers')),
        h('button', { title: 'Delete object and its geometry', class: 'danger', onclick: e => { e.stopPropagation(); A.deleteObject(o.id); } }, icon('trash'))));
    item.addEventListener('click', e => A.selectObject(o.id, e.shiftKey || e.ctrlKey));
    nameEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      const inp = h('input', { class: 'rename', value: o.name });
      nameEl.replaceWith(inp);
      inp.focus(); inp.select();
      let finished = false;
      const done = ok => {
        if (finished) return;
        finished = true;
        const v = inp.value.trim();
        if (ok && v && v !== o.name) { o.name = v; commit('Rename object'); } else renderObjectList();
      };
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); ev.stopPropagation(); });
      inp.addEventListener('blur', () => done(true));
      inp.addEventListener('click', ev => ev.stopPropagation());
    });
    list.append(item);
  }
}

/* ================================================================== point cloud panel */
function renderCloud() {
  const el = $('#cloudInfo');
  el.innerHTML = '';
  const c = P3.cloud;
  if (!c) {
    el.append(h('div', { class: 'list-empty' }, 'Optional reference: load a point cloud (.ply .xyz .txt .csv .pts) from photogrammetry software and snap to it.'),
      h('div', { class: 'p-buttons' }, h('button', { class: 'small', onclick: A.importCloud }, icon('cloud'), 'Load point cloud…')));
    return;
  }
  const n = c.positions.length / 3;
  el.append(
    h('div', { class: 'p-info' }, h('b', {}, c.name), h('br'), `${n.toLocaleString()} points${c.colors ? ' · coloured' : ''}${(S().cloudScale || 1) !== 1 ? ` · scaled ×${U.round(S().cloudScale, 4)}` : ''}`),
    h('div', { class: 's-row', style: 'grid-template-columns:1fr 130px;border:0' }, h('label', { class: 'muted' }, 'Point size'),
      h('div', { class: 'ctl' }, h('input', { type: 'range', min: 1, max: 10, step: 0.5, value: P3.settings.cloudPointSize, oninput: e => P3.setSetting('cloudPointSize', +e.target.value) }))),
    h('div', { class: 'p-buttons' },
      h('button', { class: 'small', onclick: A.toggleCloud }, icon(c.visible === false ? 'eye' : 'eye-off'), c.visible === false ? 'Show' : 'Hide'),
      h('button', { class: 'small', onclick: A.cloudToPoints, title: 'Turn cloud points into editable model points' }, 'To points'),
      h('button', { class: 'small danger', onclick: A.clearCloud }, icon('trash'), 'Remove')));
}

/* ================================================================== properties panel */
let propsSig = '';
let propsFields = [];
const fmtNum = (n, d = 4) => String(U.round(+n, d));
const btn = (label, action, opts = {}) => ({ label, action, ...opts });

function buildFields() {
  const sel = P3.sel;
  const v = sel.ids('v'), e = sel.ids('e'), f = sel.ids('f'), c = sel.ids('c');
  const F = [];
  const gizmo = () => [
    { type: 'sub', text: 'Transform' },
    { type: 'buttons', items: ['translate', 'rotate', 'scale'].map(m => btn({ translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[m], () => vp.setGizmoMode(m), { cls: 'small' + (vp.gizmoMode === m ? ' active' : ''), icon: { translate: 'move', rotate: 'rotate', scale: 'scale' }[m], title: { translate: 'Move gizmo (W)', rotate: 'Rotate gizmo (E)', scale: 'Scale gizmo (R)' }[m] })) },
  ];

  if (sel.empty) {
    const s = S();
    const pins = s.images.reduce((a, i) => a + (i.pins || []).length, 0);
    F.push({ type: 'heading', text: 'Scene' });
    F.push({ type: 'stats', get: () => [[S().images.length, 'photos'], [S().vertices.length, 'points'], [S().edges.length, 'lines'], [S().faces.length, 'faces'], [S().objects.length, 'objects'], [S().images.reduce((a, i) => a + (i.pins || []).length, 0), 'pins']] });
    if (vp.activeCam) {
      F.push({ type: 'html', html: `<div class="callout"><b>Photo view.</b> Wheel zooms the photo, right-drag pans. <b>Align</b> (A) moves this camera by orbiting. With 4+ pins, <b>Solve</b> places it exactly.</div>` });
    }
    F.push({ type: 'sub', text: 'Workflow' });
    F.push({ type: 'html', html: `<ul class="p-tips">
      <li><b>Import photos</b> of one object (or try the <a href="#" data-action="demo">demo</a>).</li>
      <li><b>Position cameras</b>: Arrange, the gizmo, <b>Align</b> mode, or pin 4+ known points and <b>Solve</b>.</li>
      <li><b>Model</b>: <kbd>P</kbd> point, <kbd>L</kbd> line, <kbd>F</kbd> face, <kbd>T</kbd> triangulate from 2+ photos, <kbd>X</kbd> extrude.</li>
      <li><b>Check</b>: double-click a camera, <kbd>N</kbd> nearest photo, <kbd>[</kbd> <kbd>]</kbd> step through.</li>
      <li><b>Scale</b>: select a line of known length → “Set real length”. Then <b>Export</b>.</li></ul>` });
    if (pins) F.push({ type: 'buttons', items: [btn('Refine all from pins', A.refineAll, { cls: 'small', icon: 'solve', title: 'Re-solve every pinned camera and re-triangulate every pinned point' })] });
    F.push({ type: 'html', html: `<p class="p-info" style="margin-top:14px">Press <kbd>Ctrl K</kbd> for every command, or right-click in the 3D view.</p>` });
    return F;
  }

  // ---- single photo camera
  if (c.length === 1 && sel.list.length === 1) {
    const img = idx.c.get(c[0]);
    const rec = P3.images.get(img.id);
    const n = (img.pins || []).length;
    F.push({ type: 'heading', text: 'Photo camera', chip: () => { const r = P3.solve.imageRms(img); return r == null ? null : [`${r.toFixed(1)} px`, P3.solve.errorClass(r)]; } });
    if (rec) F.push({ type: 'thumb', src: rec.thumb, onclick: () => vp.enterCamera(img.id) });
    F.push({ type: 'text', label: 'Name', get: () => img.name, set: val => { img.name = val || img.name; }, label2: 'Rename photo' });
    F.push({ type: 'vec', label: 'Position', axes: ['X', 'Y', 'Z'], get: () => img.pos, set: (i, val) => { img.pos[i] = val; }, step: 0.05, label2: 'Move photo camera' });
    F.push({ type: 'vec', label: 'Rotation°', axes: ['P', 'Yw', 'R'], titles: ['Pitch', 'Yaw', 'Roll'], get: () => img.rot, set: (i, val) => { img.rot[i] = val; }, step: 1, label2: 'Rotate photo camera' });
    F.push({ type: 'num', label: 'FOV (vert.)°', get: () => img.fov, set: val => { img.fov = U.clamp(val, 1, 170); img.fovSource = 'manual'; }, step: 0.5, label2: 'Change FOV' });
    F.push({ type: 'info', html: () => `${img.w}×${img.h}px · focal ≈ ${U.round(P3.cam.focalPx(img), 1)}px${img.f35 ? ` · ${img.f35} mm eq.` : ''}${img.fovSource === 'exif' ? ' · <b>FOV from EXIF</b>' : ''}${img.camera ? '<br>' + U.esc(img.camera) : ''}` });
    F.push({ type: 'check', label: 'Visible', get: () => img.visible !== false, set: val => { img.visible = val; }, label2: 'Toggle photo' });
    F.push({ type: 'buttons', items: [
      btn(vp.activeCam === img.id ? 'Exit photo view' : 'Look through', () => (vp.activeCam === img.id ? vp.exitCamera() : vp.enterCamera(img.id)), { cls: 'primary small', icon: 'camera' }),
      btn('Aim at model', () => A.lookAtCenter(img.id), { cls: 'small', icon: 'target', title: 'Point this camera at the centre of the model' }),
    ] });
    F.push({ type: 'sub', text: `Pins (${n})` });
    F.push({ type: 'info', html: () => {
      const k = (img.pins || []).length;
      if (!k) return 'Pin model points in this photo with the <b>Pin tool</b> (<kbd>K</kbd>). With 4+ pins the camera can be solved automatically.';
      const r = P3.solve.imageRms(img);
      return `${k} pinned point${k === 1 ? '' : 's'} · reprojection error <b>${r == null ? '—' : r.toFixed(2) + ' px'}</b>${k < 4 ? ` · ${4 - k} more needed to solve` : ''}`;
    } });
    F.push({ type: 'buttons', items: [
      btn('Solve pose', () => A.solveCamera('pose'), { cls: 'small', icon: 'solve', disabled: n < 4, title: 'Find position & rotation from pins (4+)' }),
      btn('Solve + FOV', () => A.solveCamera('fov'), { cls: 'small', disabled: n < 6, title: 'Also find the field of view (6+ pins)' }),
      btn('Pin tool', A.pinTool, { cls: 'small', icon: 'pin' }),
      btn('Clear pins', () => A.clearPins(img.id), { cls: 'small danger', disabled: !n }),
    ] });
    F.push({ type: 'sub', text: 'Transform' });
    F.push({ type: 'buttons', items: [
      btn('Move', () => vp.setGizmoMode('translate'), { cls: 'small' + (vp.gizmoMode !== 'rotate' ? ' active' : ''), icon: 'move', title: 'Move gizmo (W)' }),
      btn('Rotate', () => vp.setGizmoMode('rotate'), { cls: 'small' + (vp.gizmoMode === 'rotate' ? ' active' : ''), icon: 'rotate', title: 'Rotate gizmo (E)' }),
    ] });
    F.push({ type: 'buttons', items: [btn('Delete photo', () => A.deletePhoto(img.id), { cls: 'small danger', icon: 'trash' })] });
    return F;
  }

  // ---- only points
  if (v.length && !e.length && !f.length && !c.length) {
    if (v.length === 1) {
      const vert = idx.v.get(v[0]);
      F.push({ type: 'heading', text: `Point #${vert.id}` });
      F.push({ type: 'vec', label: 'Position', axes: ['X', 'Y', 'Z'], get: () => vert.p, set: (i, val) => { vert.p[i] = val; }, step: 0.05, label2: 'Move point' });
      F.push({ type: 'info', html: () => {
        const n = S().edges.filter(x => x.a === vert.id || x.b === vert.id).length;
        const pins = idx.pins.get(vert.id) || [];
        return `${n} connected line(s) · pinned in <b>${pins.length}</b> photo(s)${pins.length ? ': ' + pins.map(p => U.esc(p.img.name)).join(', ') : ''}`;
      } });
      F.push({ type: 'buttons', items: [
        btn('Re-triangulate', A.retriangulate, { cls: 'small', icon: 'tri', disabled: (idx.pins.get(vert.id) || []).length < 2, title: 'Move this point to where its pins’ rays meet (needs pins in 2+ photos)' }),
        btn('Pin in photos', A.pinTool, { cls: 'small', icon: 'pin' }),
      ] });
    } else {
      F.push({ type: 'heading', text: `${v.length} points` });
      F.push({ type: 'vec', label: 'Centroid', axes: ['X', 'Y', 'Z'], get: () => M.centroid(P3.sel.ids('v')).toArray(), set: (i, val) => {
        const ids = P3.sel.ids('v');
        const d = val - M.centroid(ids).getComponent(i);
        ids.forEach(id => { idx.v.get(id).p[i] += d; });
      }, step: 0.05, label2: 'Move points' });
      F.push({ type: 'info', html: () => 'Selection order is used by “Make face” and “Connect”.' });
      F.push({ type: 'buttons', items: [
        btn('Make face', A.makeFace, { cls: 'small', icon: 'face', disabled: v.length < 3, title: 'Make face (Enter)' }),
        btn('Connect', A.connect, { cls: 'small', icon: 'line', title: 'Connect in order (C)' }),
        btn('Merge', A.merge, { cls: 'small', title: 'Merge into one point (M)' }),
        btn('Re-triangulate', A.retriangulate, { cls: 'small', icon: 'tri', disabled: !v.some(id => (idx.pins.get(id) || []).length >= 2) }),
      ] });
    }
    F.push({ type: 'buttons', items: [
      btn('Duplicate', A.duplicate, { cls: 'small', icon: 'copy', title: 'Duplicate (Ctrl+D)' }),
      btn('Mirror X', () => A.mirror('x'), { cls: 'small' }),
      btn('Plane here', A.planeToSelection, { cls: 'small', icon: 'grid', title: 'Move the work plane through the selection' }),
      btn('Delete', A.deleteSelection, { cls: 'small danger', icon: 'trash' }),
    ] });
    F.push(...gizmo());
    return F;
  }

  // ---- only lines
  if (e.length && !v.length && !f.length && !c.length) {
    F.push({ type: 'heading', text: e.length === 1 ? `Line #${e[0]}` : `${e.length} lines` });
    F.push({ type: 'info', html: () => {
      const len = P3.sel.ids('e').map(id => idx.e.get(id)).filter(Boolean).reduce((s, x) => s + M.vpos(x.a).distanceTo(M.vpos(x.b)), 0);
      return `${e.length === 1 ? 'Length' : 'Total length'}: <b>${U.len(len, 4)}</b>`;
    } });
    F.push({ type: 'buttons', items: [
      btn('Set real length…', A.setLength, { cls: 'small', icon: 'scale', disabled: e.length !== 1, title: 'Scale the whole scene so this line has a known real-world length' }),
      btn('Split', A.splitEdge, { cls: 'small' }),
      btn('Duplicate', A.duplicate, { cls: 'small', icon: 'copy' }),
      btn('Group', A.groupSelection, { cls: 'small', icon: 'layers' }),
      btn('Delete', A.deleteSelection, { cls: 'small danger', icon: 'trash' }),
    ] });
    F.push(...gizmo());
    return F;
  }

  // ---- only faces
  if (f.length && !v.length && !e.length && !c.length) {
    F.push({ type: 'heading', text: f.length === 1 ? `Face #${f[0]}` : `${f.length} faces` });
    F.push({ type: 'info', html: () => {
      const area = P3.sel.ids('f').map(id => idx.f.get(id)).filter(Boolean).reduce((s, x) => s + P3.geom.polygonArea(x.v.map(id => M.vpos(id))), 0);
      const corners = f.length === 1 && idx.f.get(f[0]) ? ` · ${idx.f.get(f[0]).v.length} corners` : '';
      const o = f.length === 1 && idx.faceObj.get(f[0]);
      const u = P3.settings.units !== 'units' ? ' ' + P3.settings.units + '²' : '';
      return `Area: <b>${U.fmt(area, 4)}${u}</b>${corners}${o ? ` · in <b>${U.esc(o.name)}</b>` : ''}`;
    } });
    F.push({ type: 'buttons', items: [
      btn('Extrude…', A.extrude, { cls: 'small', icon: 'cube', title: 'Extrude (X)' }),
      btn('Flip', A.flipFaces, { cls: 'small' }),
      btn('Duplicate', A.duplicate, { cls: 'small', icon: 'copy' }),
      btn('Mirror X', () => A.mirror('x'), { cls: 'small' }),
      btn('Group into object', A.groupSelection, { cls: 'small', icon: 'layers' }),
      btn('Delete', A.deleteSelection, { cls: 'small danger', icon: 'trash' }),
    ] });
    F.push(...gizmo());
    return F;
  }

  // ---- mixed
  F.push({ type: 'heading', text: 'Selection' });
  F.push({ type: 'stats', get: () => [[v.length, 'points'], [e.length, 'lines'], [f.length, 'faces'], [c.length, 'photos']].filter(x => x[0]) });
  F.push({ type: 'buttons', items: [
    btn('Group into object', A.groupSelection, { cls: 'small', icon: 'layers', disabled: !(e.length || f.length || v.length) }),
    btn('Duplicate', A.duplicate, { cls: 'small', icon: 'copy', disabled: !M.selectedVertexIds().length }),
    btn('Frame', A.frame, { cls: 'small', icon: 'frame' }),
    btn('Delete', A.deleteSelection, { cls: 'small danger', icon: 'trash' }),
  ] });
  if (c.length > 1) F.push({ type: 'buttons', items: [btn('Arrange selected photos…', A.arrange, { cls: 'small' })] });
  if (M.selectedVertexIds().length) F.push(...gizmo());
  return F;
}

function renderField(f) {
  const done = () => P3.history.commit(f.label2 || 'Edit');
  switch (f.type) {
    case 'heading': {
      const chip = h('span', { class: 'chip hidden' });
      f._update = () => { const c = f.chip && f.chip(); chip.classList.toggle('hidden', !c); if (c) { chip.textContent = c[0]; chip.className = 'chip ' + c[1]; } };
      f._update();
      return h('div', { class: 'p-heading' }, h('span', {}, f.text), chip);
    }
    case 'sub': return h('div', { class: 'p-sub' }, f.text);
    case 'html': return h('div', { html: f.html });
    case 'thumb': return h('img', { class: 'p-thumb', src: f.src, alt: '', style: 'cursor:pointer', title: 'Look through this photo', onclick: f.onclick });
    case 'info': {
      const el = h('div', { class: 'p-info' });
      f._update = () => { el.innerHTML = f.html(); };
      f._update();
      return el;
    }
    case 'stats': {
      const el = h('div', { class: 'p-stats' });
      f._update = () => { el.innerHTML = f.get().map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join(''); };
      f._update();
      return el;
    }
    case 'buttons':
      return h('div', { class: 'p-buttons' }, f.items.map(b => h('button', { class: b.cls || '', title: b.title || null, disabled: !!b.disabled, onclick: b.action }, b.icon ? icon(b.icon) : null, b.label)));
    case 'vec': {
      const inputs = f.axes.map((ax, i) => h('input', {
        type: 'number', step: f.step || 0.01, title: f.titles ? f.titles[i] : ax,
        onchange: e => { const val = parseFloat(e.target.value); if (Number.isFinite(val)) { f.set(i, val); done(); } },
      }));
      f._update = () => { const vals = f.get(); inputs.forEach((inp, i) => { if (document.activeElement !== inp) inp.value = fmtNum(vals[i]); }); };
      f._update();
      return h('div', { class: 'p-row' }, h('label', {}, f.label), h('div', { class: 'p-vec' }, inputs.map((inp, i) => h('div', { class: 'ax', 'data-ax': f.axes[i] }, inp))));
    }
    case 'num': {
      const inp = h('input', { type: 'number', step: f.step || 0.01, onchange: e => { const val = parseFloat(e.target.value); if (Number.isFinite(val)) { f.set(val); done(); } } });
      f._update = () => { if (document.activeElement !== inp) inp.value = fmtNum(f.get()); };
      f._update();
      return h('div', { class: 'p-row' }, h('label', {}, f.label), inp);
    }
    case 'text': {
      const inp = h('input', { type: 'text', onchange: e => { f.set(e.target.value.trim()); done(); } });
      f._update = () => { if (document.activeElement !== inp) inp.value = f.get(); };
      f._update();
      return h('div', { class: 'p-row' }, h('label', {}, f.label), inp);
    }
    case 'check': {
      const inp = h('input', { type: 'checkbox', onchange: e => { f.set(e.target.checked); done(); } });
      f._update = () => { inp.checked = !!f.get(); };
      f._update();
      return h('div', { class: 'p-row' }, h('label', {}, f.label), h('div', {}, inp));
    }
  }
  return h('div');
}

function propsSignature() {
  const c = P3.sel.ids('c');
  const extra = c.length === 1 ? (idx.c.get(c[0])?.pins?.length ?? 0) : P3.sel.ids('v').map(id => (idx.pins.get(id) || []).length).join('.');
  return [P3.sel.list.join(','), vp.activeCam || '', vp.gizmoMode, extra, S().images.length + ':' + idx.pins.size].join('|');
}
function renderProps(force = false) {
  const sig = propsSignature();
  if (!force && sig === propsSig) { propsFields.forEach(f => f._update && f._update()); return; }
  propsSig = sig;
  const root = $('#props');
  const scroll = root.parentElement.scrollTop;
  root.innerHTML = '';
  propsFields = buildFields();
  propsFields.forEach(f => root.append(renderField(f)));
  root.parentElement.scrollTop = scroll;
}

/* ================================================================== camera banner, HUD, toolbar, status */
function updateBanner() {
  const id = vp.activeCam;
  $('#camBanner').classList.toggle('hidden', !id);
  if (!id) return;
  const img = idx.c.get(id);
  if (!img) return;
  const list = S().images;
  $('#cbName').textContent = img.name;
  $('#cbName').title = img.name;
  $('#cbIndex').textContent = `photo ${list.indexOf(img) + 1} of ${list.length}`;
  const op = $('#cbOpacity'), fov = $('#cbFov'), roll = $('#cbRoll');
  if (document.activeElement !== op) op.value = P3.settings.overlayOpacity;
  if (document.activeElement !== fov) fov.value = img.fov;
  if (document.activeElement !== roll) roll.value = img.rot[2];
  $('#cbFovVal').textContent = U.round(img.fov, 1) + '°';
  $('#cbAlign').classList.toggle('on', vp.alignMode);
  $('#cbOverlay').classList.toggle('on', !vp.overlayHidden);
  const n = (img.pins || []).length;
  const rms = P3.solve.imageRms(img);
  const chip = $('#cbPins');
  chip.className = 'chip ' + (n ? P3.solve.errorClass(rms) : '');
  chip.textContent = n ? `${n} pins · ${rms == null ? '—' : rms.toFixed(1) + ' px'}` : 'no pins';
  $('#cbSolve').disabled = n < 4;
  updateZoomBadge();
}
function updateZoomBadge() {
  const b = $('#cbZoom');
  if (b) { b.textContent = Math.round(vp.pz.z * 100) + '%'; b.disabled = vp.alignMode; }
}
function updateHud() {
  $('#hudPlane').value = P3.settings.workPlane;
  if (document.activeElement !== $('#hudOffset')) $('#hudOffset').value = P3.settings.workPlaneOffset;
  $('#hudSnap').classList.toggle('on', !!P3.settings.snapToGrid);
}
function updateToolbar() {
  document.querySelectorAll('#toolbar [data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === P3.tools.current));
  $('#gizmoModes').classList.toggle('hidden', P3.tools.current !== 'select');
  document.querySelectorAll('#gizmoModes [data-gizmo]').forEach(b => b.classList.toggle('active', b.dataset.gizmo === vp.gizmoMode));
}
function updateHistoryButtons() {
  $('#btnUndo').disabled = !P3.history.canUndo;
  $('#btnRedo').disabled = !P3.history.canRedo;
  const u = P3.history.undoStack[P3.history.undoStack.length - 1], r = P3.history.redoStack[P3.history.redoStack.length - 1];
  const setTip = (el, t) => { if (el.dataset.tip !== undefined) el.dataset.tip = t; else el.title = t; };
  setTip($('#btnUndo'), 'Undo' + (u ? ': ' + u.label : '') + ' (Ctrl+Z)');
  setTip($('#btnRedo'), 'Redo' + (r ? ': ' + r.label : '') + ' (Ctrl+Y)');
  const dirty = P3.history.dirty && (S().images.length || S().vertices.length);
  $('#dirtyDot').classList.toggle('hidden', !dirty);
  document.title = (dirty ? '• ' : '') + P3.project.name + ' — PhotoModel 3D';
}
function updateCounts() {
  const s = S();
  $('#stCounts').textContent = `${s.images.length} photos · ${s.vertices.length} pts · ${s.edges.length} lines · ${s.faces.length} faces`;
  $('#emptyState').classList.toggle('hidden', !!(s.images.length || s.vertices.length || P3.cloud));
}
function renderAll() {
  renderImageList();
  renderObjectList();
  renderCloud();
  renderProps(true);
  updateBanner();
  updateHud();
  updateToolbar();
  updateHistoryButtons();
  updateCounts();
  ui.hint();
  $('#projectName').value = P3.project.name;
}

/* ================================================================== settings */
const UNITS = [['m', 'metres (m)'], ['cm', 'centimetres (cm)'], ['mm', 'millimetres (mm)'], ['in', 'inches (in)'], ['ft', 'feet (ft)'], ['units', 'no unit']];
const SETTINGS_SCHEMA = [
  { group: 'Appearance' },
  { key: 'theme', label: 'Theme', type: 'select', options: [['dark', 'Dark'], ['light', 'Light']] },
  { key: 'accent', label: 'Accent colour', type: 'accent' },
  { key: 'vertexSize', label: 'Point size (px)', type: 'range', min: 3, max: 24, step: 1 },
  { key: 'lineWidth', label: 'Line width (px)', type: 'range', min: 1, max: 10, step: 0.5 },
  { key: 'faceOpacity', label: 'Face opacity', type: 'range', min: 0.05, max: 1, step: 0.05 },
  { key: 'xrayVertices', label: 'Show points through faces', type: 'check' },
  { key: 'vertexColor', label: 'Point colour', type: 'color' },
  { key: 'lineColor', label: 'Line colour', type: 'color' },
  { key: 'faceColor', label: 'Face colour (ungrouped)', type: 'color' },
  { key: 'showAxes', label: 'Show axes', type: 'check' },
  { group: 'Photo view' },
  { key: 'overlayOpacity', label: 'Photo overlay opacity', type: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'overlayMode', label: 'Photo position', type: 'select', options: [['over', 'On top of model'], ['under', 'Behind model']] },
  { key: 'showPins', label: 'Show pins & error lines', type: 'check' },
  { key: 'showLoupe', label: 'Magnifier loupe when clicking in photos', type: 'check' },
  { key: 'loupeZoom', label: 'Loupe magnification', type: 'range', min: 2, max: 10, step: 1 },
  { key: 'showFrustums', label: 'Show cameras in 3D', type: 'check' },
  { key: 'frustumSize', label: 'Camera size', type: 'range', min: 0.05, max: 5, step: 0.05 },
  { key: 'frustumImageOpacity', label: 'Photo opacity on cameras', type: 'range', min: 0, max: 1, step: 0.05 },
  { group: 'Grid & snapping' },
  { key: 'units', label: 'Units', type: 'select', options: UNITS },
  { key: 'showGrid', label: 'Show grid', type: 'check' },
  { key: 'gridSize', label: 'Grid cell size', type: 'number', step: 0.1, min: 0.001 },
  { key: 'gridDivisions', label: 'Grid cells', type: 'number', step: 2, min: 2 },
  { key: 'snapToGrid', label: 'Snap to grid', type: 'check' },
  { key: 'snapStep', label: 'Snap step', type: 'number', step: 0.05, min: 0.0001 },
  { key: 'snapEdges', label: 'Snap to lines & midpoints', type: 'check' },
  { key: 'snapRadius', label: 'Snap / pick radius (px)', type: 'range', min: 4, max: 30, step: 1 },
  { group: 'Photos' },
  { key: 'useExifFov', label: 'Use EXIF focal length for FOV', type: 'check' },
  { key: 'defaultFov', label: 'Default FOV (°) without EXIF', type: 'number', step: 1, min: 1 },
  { key: 'maxImageSize', label: 'Downscale photos on import', type: 'select', options: [[1024, '1024 px'], [2048, '2048 px'], [4096, '4096 px'], [0, 'Keep original']] },
  { key: 'ringRadius', label: 'Default ring radius', type: 'number', step: 0.5 },
  { key: 'ringHeight', label: 'Default ring height', type: 'number', step: 0.5 },
  { group: 'Project' },
  { key: 'autosave', label: 'Autosave in this browser', type: 'check' },
  { key: 'undoLimit', label: 'Undo steps kept', type: 'number', step: 10, min: 10 },
];

function showSettings() {
  const body = h('div');
  for (const s of SETTINGS_SCHEMA) {
    if (s.group) { body.append(h('div', { class: 's-group' }, s.group)); continue; }
    const val = P3.settings[s.key];
    let ctl;
    if (s.type === 'select') {
      ctl = h('select', { onchange: e => P3.setSetting(s.key, typeof s.options[0][0] === 'number' ? +e.target.value : e.target.value) },
        s.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
    } else if (s.type === 'check') {
      ctl = h('input', { type: 'checkbox', checked: !!val, onchange: e => P3.setSetting(s.key, e.target.checked) });
    } else if (s.type === 'range') {
      const out = h('span', { class: 'val' }, String(val));
      ctl = [h('input', { type: 'range', min: s.min, max: s.max, step: s.step, value: val, oninput: e => { out.textContent = e.target.value; P3.setSetting(s.key, +e.target.value); } }), out];
    } else if (s.type === 'color') {
      ctl = h('input', { type: 'color', value: val, oninput: e => P3.setSetting(s.key, e.target.value) });
    } else if (s.type === 'accent') {
      const wrap = h('div', { class: 'swatches' });
      const draw = () => {
        wrap.innerHTML = '';
        Object.entries(P3.ACCENTS).forEach(([k, c]) => wrap.append(h('button', { class: 'swatch' + (P3.settings.accent === k ? ' on' : ''), style: `background:${c}`, title: k, onclick: () => { P3.setSetting('accent', k); draw(); } })));
      };
      draw();
      ctl = wrap;
    } else {
      ctl = h('input', { type: 'number', step: s.step, min: s.min, value: val, onchange: e => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) P3.setSetting(s.key, s.min != null ? Math.max(s.min, n) : n); } });
    }
    body.append(h('div', { class: 's-row' }, h('label', {}, s.label), h('div', { class: 'ctl' }, ctl)));
  }
  openModal({
    title: 'Settings', body,
    buttons: [{ label: 'Reset to defaults', cls: 'danger', value: 'reset' }, { label: 'Done', cls: 'primary', value: null }],
  }).then(v => { if (v === 'reset') { P3.resetSettings(); showSettings(); ui.toast('Settings reset'); } });
}

/* ================================================================== help */
const SHORTCUTS = [
  ['V  P  L  F', 'Select · Point · Line · Face tools'],
  ['T  K', 'Triangulate from photos · Pin points in photos'],
  ['W  E  R', 'Gizmo: move · rotate · scale'],
  ['Ctrl K  or  /', 'Command palette — every action'],
  ['Right-click', 'Context menu for the selection'],
  ['Shift+drag', 'Box select (plain drag in photo view); Alt+Shift+drag removes'],
  ['Double-click camera', 'Look through that photo'],
  ['[  ]  ·  N', 'Previous / next photo · nearest photo'],
  ['Wheel · right-drag', 'In photo view: zoom / pan the photo (Home resets)'],
  ['A  ·  O', 'Align mode · show/hide photo overlay'],
  ['Enter', 'Finish face · create triangulated point · face from selected points'],
  ['Esc', 'Cancel tool → leave photo view → clear selection'],
  ['Del / Backspace', 'Delete selection'],
  ['M · C · X', 'Merge points · connect points · extrude faces'],
  ['Ctrl D · Ctrl G', 'Duplicate · group into object'],
  ['Ctrl Z / Ctrl Y', 'Undo / redo'],
  ['Ctrl S · Ctrl Shift S · Ctrl O', 'Save · save as · open'],
  ['Home or .', 'Frame all / selection'],
  ['1 2 3 4', 'Top · front · right · 3D view'],
  ['S · G · I', 'Grid snapping · grid · import photos'],
  ['Shift / Alt while drawing', 'Lock to axis / ignore grid snap'],
];
function showHelp() {
  const body = h('div', {},
    h('h3', {}, 'How it works'),
    h('ol', { html: `
      <li><b>Import photos</b> of one object from different sides. Each photo becomes a camera in the scene (FOV is read from EXIF when available).</li>
      <li><b>Position the cameras.</b> Start with <b>Arrange</b>, then refine: drag the gizmo, look through a photo and use <b>Align</b>, or — most precise — pin 4+ known model points in the photo with the <b>Pin tool</b> (<kbd>K</kbd>) and press <b>Solve</b>.</li>
      <li><b>Model.</b> Points, lines and faces snap to points, line midpoints, lines, faces, point clouds and the work plane. <b>Triangulate</b> (<kbd>T</kbd>): click the same feature in two or more photos to get an exact 3D point — the clicks are stored as pins.</li>
      <li><b>Refine.</b> “Refine all from pins” alternately re-solves every pinned camera and re-triangulates every pinned point.</li>
      <li><b>Combine</b> faces and lines into named objects; extrude, mirror and duplicate to build faster.</li>
      <li><b>Scale</b> the scene from one line of known length, then <b>export</b> OBJ, GLB, STL, PLY or camera poses.</li>` }),
    h('p', { class: 'small', html: 'Not sure where to start? <a href="#" data-action="demo">Load the demo</a> — photo 4 is deliberately misplaced; open it and press <b>Solve</b>.' }),
    h('p', { class: 'small', html: 'Automatic dense reconstruction is not done in the browser. If you have a point cloud from photogrammetry software (Meshroom, COLMAP, RealityScan…), load it via <b>Import → Point cloud</b> and snap to it.' }),
    h('h3', {}, 'Shortcuts'),
    h('div', { class: 'help-grid' }, SHORTCUTS.flatMap(([k, d]) => [h('div', {}, ...k.split(/\s{2,}|\s·\s/).flatMap((x, i) => [i ? ' ' : '', h('kbd', {}, x.trim())])), h('div', { class: 'muted' }, d)])));
  openModal({ title: 'Help & shortcuts', body, wide: true });
}

ui.demoTour = () => {
  openModal({
    title: 'Demo: little house',
    body: h('div', { html: `<p style="margin-top:0">Eight rendered “photos” of a house, with the walls already modelled. Things to try:</p>
      <ol>
        <li>Double-click any camera (or press <kbd>N</kbd>) to see its photo over the model; step with <kbd>[</kbd> <kbd>]</kbd>.</li>
        <li>Photo <b>house_04 (misplaced)</b> is out of position but has pins. Open it and press <b>Solve</b> in the bar at the bottom.</li>
        <li>Choose <b>Triangulate</b> (<kbd>T</kbd>), click the roof ridge end in one photo, switch photo with <kbd>]</kbd>, click it again, press <kbd>Enter</kbd>.</li>
        <li>Do the other ridge end, then use the <b>Face</b> tool (<kbd>F</kbd>) to add the roof slopes.</li>
        <li>Select the bottom front line → <b>Set real length</b> → 7.2 m, then <b>Export</b>.</li>
      </ol>` }),
    buttons: [{ label: 'Open the misplaced photo', cls: '', value: 'bad' }, { label: 'Got it', cls: 'primary', value: null }],
  }).then(v => { if (v === 'bad') { const img = S().images[3]; if (img) vp.enterCamera(img.id); } });
};

/* ================================================================== keyboard */
function onKey(e) {
  if (modalOpen()) { if (e.key === 'Escape') { e.preventDefault(); closeTopModal(); } return; }
  const t = e.target;
  const typing = (t.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'button'].includes(t.type)) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  const kl = k.length === 1 ? k.toLowerCase() : k;
  if (mod && kl === 's') { e.preventDefault(); A.save(e.shiftKey); return; }
  if (mod && kl === 'o') { e.preventDefault(); A.open(); return; }
  if (mod && kl === 'k') { e.preventDefault(); A.palette(); return; }
  if (typing) { if (k === 'Escape' || (k === 'Enter' && t.tagName !== 'SELECT')) t.blur(); return; }
  if (k === 'Escape' && !$('#ctxMenu').classList.contains('hidden')) { closeMenus(); return; }
  if (mod) {
    if (kl === 'z') { e.preventDefault(); e.shiftKey ? A.redo() : A.undo(); }
    else if (kl === 'y') { e.preventDefault(); A.redo(); }
    else if (kl === 'a') { e.preventDefault(); A.selectAll(); }
    else if (kl === 'g') { e.preventDefault(); A.groupSelection(); }
    else if (kl === 'd') { e.preventDefault(); A.duplicate(); }
    return;
  }
  if (e.altKey) return;
  const tools = P3.tools;
  switch (kl) {
    case 'v': tools.set('select'); break;
    case 'p': tools.set('point'); break;
    case 'l': tools.set('line'); break;
    case 'f': tools.set('face'); break;
    case 't': tools.set('triangulate'); break;
    case 'k': A.pinTool(); break;
    case 'w': vp.setGizmoMode('translate'); break;
    case 'e': vp.setGizmoMode('rotate'); break;
    case 'r': vp.setGizmoMode('scale'); break;
    case 'i': A.importImages(); break;
    case 'x': A.extrude(); break;
    case 'Delete': A.deleteSelection(); break;
    case 'Backspace': if (!tools.backspace()) A.deleteSelection(); break;
    case 'Escape':
      if (tools.cancel()) break;
      if (vp.activeCam) { vp.exitCamera(); break; }
      if (tools.current !== 'select') { tools.set('select'); break; }
      P3.sel.clear();
      break;
    case 'Enter': if (!tools.enter() && P3.sel.ids('v').length >= 3) A.makeFace(); break;
    case 'm': A.merge(); break;
    case 'c': A.connect(); break;
    case '[': A.prevImage(); break;
    case ']': A.nextImage(); break;
    case 'n': A.nearest(); break;
    case 'o': A.toggleOverlay(); break;
    case 'a': A.toggleAlign(); break;
    case 'Home': case '.': A.frame(); break;
    case '+': case '=': if (vp.photoZoomable()) { const r = vp.viewRect; vp.zoomPhotoAt(r.x + r.w / 2, r.y + r.h / 2, 1.25); } break;
    case '-': if (vp.photoZoomable()) { const r = vp.viewRect; vp.zoomPhotoAt(r.x + r.w / 2, r.y + r.h / 2, 0.8); } break;
    case '1': A.view('top'); break;
    case '2': A.view('front'); break;
    case '3': A.view('right'); break;
    case '4': A.view('iso'); break;
    case 's': A.toggleSnap(); break;
    case 'g': A.toggleGrid(); break;
    case '/': A.palette(); break;
    case '?': case 'h': A.help(); break;
    default: return;
  }
  e.preventDefault();
}

/* ================================================================== bindings */
function bind() {
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) { if (!e.target.closest('.dropdown') && !e.target.closest('#ctxMenu')) closeMenus(); return; }
    e.preventDefault();
    const name = b.dataset.action;
    if (name !== 'menu') closeMenus();
    if (A[name]) A[name](b.dataset.arg);
    if (b.tagName === 'BUTTON') b.blur();
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctxMenu')) $('#ctxMenu').classList.add('hidden'); }, true);
  document.querySelectorAll('#toolbar [data-tool]').forEach(b => b.addEventListener('click', () => { P3.tools.set(b.dataset.tool); b.blur(); }));
  document.querySelectorAll('#gizmoModes [data-gizmo]').forEach(b => b.addEventListener('click', () => { vp.setGizmoMode(b.dataset.gizmo); b.blur(); }));

  // collapsible panel sections
  const collapsed = new Set(JSON.parse(localStorage.getItem('p3.collapsed') || '[]'));
  document.querySelectorAll('.panel-section[data-section]').forEach(sec => {
    if (collapsed.has(sec.dataset.section)) sec.classList.add('collapsed');
    sec.querySelector('.collapser').addEventListener('click', () => {
      sec.classList.toggle('collapsed');
      if (sec.classList.contains('collapsed')) collapsed.add(sec.dataset.section); else collapsed.delete(sec.dataset.section);
      localStorage.setItem('p3.collapsed', JSON.stringify([...collapsed]));
    });
  });

  const fileInput = (id, fn) => $(id).addEventListener('change', async e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) await fn(files); });
  fileInput('#fileImages', files => P3.io.importImages(files));
  fileInput('#fileProject', files => P3.io.openFile(files[0]));
  fileInput('#fileCloud', files => P3.io.importCloud(files[0]));
  fileInput('#fileObj', files => P3.io.importOBJ(files[0]));

  $('#projectName').addEventListener('change', e => { P3.project.name = e.target.value.trim() || 'Untitled project'; e.target.value = P3.project.name; P3.io.scheduleAutosave(); updateHistoryButtons(); });

  $('#hudPlane').addEventListener('change', e => P3.setSetting('workPlane', e.target.value));
  $('#hudOffset').addEventListener('change', e => { const n = parseFloat(e.target.value); P3.setSetting('workPlaneOffset', Number.isFinite(n) ? n : 0); });

  $('#cbOpacity').addEventListener('input', e => { P3.settings.overlayOpacity = +e.target.value; vp.positionOverlay(); });
  $('#cbOpacity').addEventListener('change', e => P3.setSetting('overlayOpacity', +e.target.value));
  $('#cbFov').addEventListener('input', e => {
    const img = idx.c.get(vp.activeCam);
    if (!img) return;
    img.fov = +e.target.value;
    img.fovSource = 'manual';
    $('#cbFovVal').textContent = U.round(img.fov, 1) + '°';
    P3.touch();
  });
  $('#cbFov').addEventListener('change', () => P3.history.commit('Change FOV'));
  $('#cbRoll').addEventListener('input', e => {
    const img = idx.c.get(vp.activeCam);
    if (!img) return;
    img.rot[2] = +e.target.value;
    P3.touch();
  });
  $('#cbRoll').addEventListener('change', () => P3.history.commit('Change roll'));

  document.addEventListener('keydown', onKey);

  let dragDepth = 0;
  const dz = $('#dropZone');
  window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; dz.classList.remove('hidden'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dz.classList.add('hidden'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    dz.classList.add('hidden');
    if (e.dataTransfer && e.dataTransfer.files.length) P3.io.routeFiles(e.dataTransfer.files);
  });
  window.addEventListener('paste', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith('image/'));
    if (files.length) P3.io.importImages(files);
  });

  $('#viewWrap').addEventListener('pointerdown', () => { if (narrow()) $('#workspace').classList.remove('open-left', 'open-right'); });
  window.addEventListener('beforeunload', e => {
    if (P3.history.dirty && !P3.settings.autosave && (S().images.length || S().vertices.length)) { e.preventDefault(); e.returnValue = ''; }
  });

  P3.on('change', info => {
    if (!info || !info.live) { renderImageList(); renderObjectList(); }
    renderProps();
    updateBanner();
    updateCounts();
  });
  P3.on('selection', () => { renderProps(); renderImageList(); renderObjectList(); });
  P3.on('view', () => { renderImageList(); renderProps(); updateBanner(); ui.hint(); });
  P3.on('photozoom', () => { updateZoomBadge(); vp.updateGizmo(); });
  P3.on('history', updateHistoryButtons);
  P3.on('tool', () => { updateToolbar(); renderProps(true); ui.hint(); });
  P3.on('gizmo', () => { updateToolbar(); renderProps(); });
  P3.on('settings', key => { updateHud(); updateBanner(); renderCloud(); if (key === 'units' || key === '*') renderProps(true); });
  P3.on('cloud', () => { renderCloud(); updateCounts(); });
  P3.on('project', () => { $('#projectName').value = P3.project.name; renderAll(); });
}

/* ================================================================== init */
ui.init = async () => {
  try {
    vp.init();
  } catch (err) {
    console.error(err);
    throw new Error('WebGL is not available in this browser (' + err.message + ')');
  }
  P3.photoview.init();
  P3.tools.init();
  bind();
  initTooltips();
  P3.history.reset();
  const restored = await P3.io.restoreAutosave();
  if (!restored) vp.frame();
  P3.tools.set('select');
  renderAll();
  if (restored) ui.toast('Restored your last session', 'ok');
};
})();
