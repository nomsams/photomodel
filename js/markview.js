/* PhotoModel 3D — the marking page.
   Go through the photos one by one and draw the same few colour-coded lines / points in each.
   The previous photo (with its marks) is shown alongside. Then "Place photos" positions every
   camera from the marks, and each photo can be fine-tuned. */
(() => {
'use strict';
const P3 = window.P3;
const U = P3.util;
const vp = P3.vp;
const idx = P3.idx;
const M = P3.model;
const S = () => P3.state;
const $ = sel => document.querySelector(sel);

const mv = (P3.markview = { status: null });
// (older in-viewport marking bar is gone; these keep other modules simple)
mv.active = () => false;
mv.photoOpaque = () => false;
mv.insets = () => null;
mv.update = () => {};

let screen, stage, cv, g, refCv;
let cur = null, refId = null, pulseNext = false;
let view = { z: 1, ox: null, oy: null };
let drag = null, pan = null, pending = null, mouse = null, hoverV = null;

const ends = f => (f.kind === 'point' ? [f.a] : [f.a, f.b]);
const pinMap = img => new Map((img.pins || []).map(p => [p.v, p]));
const markedIn = (f, img) => { const m = pinMap(img); return ends(f).every(v => m.has(v)); };
const anyMark = img => S().features.some(f => ends(f).some(v => (img.pins || []).some(p => p.v === v)));
const imgOf = id => idx.c.get(id);
const marksCount = img => (img.pins || []).filter(p => idx.featOf.has(p.v)).length;
const readyCount = () => S().images.filter(img => marksCount(img) >= 4).length;
const h = (...a) => P3.ui.h(...a);
const icon = n => P3.ui.icon(n);

mv.isOpen = () => !!screen && !screen.classList.contains('hidden');

/* ================================================================== open / close */
mv.init = () => {
  screen = $('#markScreen');
  stage = $('#msStage');
  cv = $('#msCanvas');
  g = cv.getContext('2d');
  refCv = $('#msRef');

  $('#msPrev').addEventListener('click', () => step(-1));
  $('#msNext').addEventListener('click', () => step(1));
  $('#msClose').addEventListener('click', () => mv.close());
  $('#msPlace').addEventListener('click', () => mv.place());
  $('#msAddLine').addEventListener('click', () => addMarker('line'));
  $('#msAddPoint').addEventListener('click', () => addMarker('point'));
  $('#msRefPrev').addEventListener('click', () => cycleRef(-1));
  $('#msRefNext').addEventListener('click', () => cycleRef(1));
  refCv.addEventListener('click', () => { if (refId) goTo(refId); });
  $('#msFit').addEventListener('click', () => { resetView(); draw(); });

  cv.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('dblclick', () => { resetView(); draw(); });
  cv.addEventListener('pointerleave', () => { mouse = null; hoverV = null; draw(); });
  document.addEventListener('keydown', onKey, true);
  new ResizeObserver(() => { if (mv.isOpen()) { draw(); renderRef(); } }).observe(stage);

  P3.on('change', info => { if (mv.isOpen() && !(info && info.live && !drag)) renderSoon(); });
  P3.on('history', () => { if (mv.isOpen()) renderSoon(); });
  P3.on('settings', () => { if (mv.isOpen()) renderSoon(); });
};

mv.open = id => {
  if (!S().images.length) { P3.ui.toast('Import photos first — then mark them here'); P3.actions.importImages(); return; }
  if (!S().features.length) {
    M.addFeature('line', 'Line 1');
    M.addFeature('line', 'Line 2');
    M.addFeature('line', 'Line 3');
    M.addFeature('point', 'Point 1');
    P3.history.commit('Add markers');
  }
  vp.exitCamera();
  if (P3.tools.current !== 'select') P3.tools.set('select');
  screen.classList.remove('hidden');
  const target = (id && imgOf(id)) ? id
    : (cur && imgOf(cur)) ? cur
    : (S().images.find(img => S().features.some(f => !markedIn(f, img))) || S().images[0]).id;
  goTo(target);
  P3.emit('steps');
};
mv.close = () => {
  if (!screen) return;
  screen.classList.add('hidden');
  drag = pan = pending = null;
  P3.emit('steps');
  vp.layout();
};

function goTo(id) {
  if (!imgOf(id)) return;
  const prev = cur;
  cur = id;
  pending = null;
  pulseNext = false;
  resetView();
  // reference: the photo you just came from if it has marks, else the nearest marked one before this
  if (prev && prev !== id && anyMark(imgOf(prev))) refId = prev;
  if (!refId || refId === id || !imgOf(refId) || !anyMark(imgOf(refId))) {
    const list = S().images, i = list.findIndex(x => x.id === id);
    const before = list.slice(0, i).reverse().find(anyMark), after = list.slice(i + 1).find(anyMark);
    refId = (before || after || {}).id || null;
  }
  const img = imgOf(id);
  const act = P3.tools.activeFeature();
  if (!act || markedIn(act, img)) {
    const f = S().features.find(x => !markedIn(x, img));
    if (f) P3.tools.setFeature(f.id);
    else if (!act && S().features[0]) P3.tools.setFeature(S().features[0].id);
  }
  render();
}
function step(d) {
  const list = S().images;
  const i = list.findIndex(x => x.id === cur);
  goTo(list[(i + d + list.length) % list.length].id);
}

/* ================================================================== rendering */
let raf = 0;
function renderSoon() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (mv.isOpen()) render(); }); setTimeout(() => { if (raf) { cancelAnimationFrame(raf); raf = 0; if (mv.isOpen()) render(); } }, 80); }
function render() {
  if (!imgOf(cur)) { const f = S().images[0]; if (!f) return mv.close(); cur = f.id; }
  renderHeader();
  renderMarkers();
  renderStrip();
  renderRef();
  draw();
}

function renderHeader() {
  const img = imgOf(cur);
  const list = S().images;
  $('#msName').textContent = img.name;
  $('#msIndex').textContent = `photo ${list.indexOf(img) + 1} of ${list.length}`;
  const feats = S().features;
  const done = feats.filter(f => markedIn(f, img)).length;
  const act = P3.tools.activeFeature();
  let hint;
  if (pending) hint = `Click where “${act.name}” ends`;
  else if (done === feats.length) hint = 'All markers done here — press → for the next photo';
  else if (act) hint = act.kind === 'point' ? `Click “${act.name}”` : `Drag along “${act.name}” (either end first)`;
  else hint = 'Pick a marker on the right';
  $('#msHint').textContent = hint;
  $('#msNext').classList.toggle('pulse', done === feats.length && feats.length > 0);
  const ready = readyCount();
  const place = $('#msPlace');
  place.classList.toggle('ready', ready >= 2);
  place.title = ready >= 2 ? `Position all photos from the marks (${ready} photos ready)` : 'Mark at least 2 lines (or 4 points) in at least 2 photos first';
  const err = img.placed ? P3.solve.imageRms(img) : null;
  const chip = $('#msErr');
  chip.className = 'chip ' + (err != null ? P3.solve.errorClass(err) : '');
  chip.textContent = err != null ? `fit ${err.toFixed(1)} px` : `${done}/${feats.length} marked`;
  chip.title = err != null ? 'How far the placed shape lands from your marks in this photo (dashed lines)' : 'Markers drawn in this photo';
}

function renderMarkers() {
  const box = $('#msMarkers');
  box.innerHTML = '';
  const img = imgOf(cur);
  const act = P3.tools.activeFeature();
  const n = S().images.length;
  S().features.forEach((f, i) => {
    const here = markedIn(f, img);
    const count = S().images.filter(x => markedIn(f, x)).length;
    const nameEl = h('span', { class: 'mk-name', title: 'Double-click to rename' }, f.name);
    const row = h('div', { class: 'mk' + (act && act.id === f.id ? ' active' : ''), style: `--c:${f.color}`, onclick: () => { P3.tools.setFeature(f.id); pending = null; render(); } },
      h('label', { class: 'mk-sw', title: 'Change colour', onclick: e => e.stopPropagation() },
        h('input', { type: 'color', value: f.color, oninput: e => { f.color = e.target.value; draw(); renderRef(); }, onchange: () => P3.history.commit('Marker colour') })),
      h('span', { class: 'mk-key' }, String(i + 1)),
      h('div', { class: 'mk-main' }, nameEl, h('span', { class: 'mk-meta' }, `${f.kind === 'point' ? 'point' : f.kind === 'axis' ? 'direction' : 'line'} · ${count}/${n} photos`)),
      h('span', { class: 'mk-state' + (here ? ' ok' : '') }, here ? '✓' : ''),
      here ? h('button', { class: 'icon-btn ghost', title: 'Clear this marker in this photo', onclick: e => { e.stopPropagation(); clearMark(f); } }, icon('close')) : null,
      h('button', { class: 'icon-btn ghost danger', title: 'Delete this marker from all photos', onclick: e => { e.stopPropagation(); deleteMarker(f); } }, icon('trash')));
    nameEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      const inp = h('input', { class: 'rename', value: f.name });
      nameEl.replaceWith(inp);
      inp.focus(); inp.select();
      let finished = false;
      const done = ok => { if (finished) return; finished = true; const v = inp.value.trim(); if (ok && v && v !== f.name) { f.name = v; P3.history.commit('Rename marker'); } else renderMarkers(); };
      inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
      inp.addEventListener('blur', () => done(true));
      inp.addEventListener('click', ev => ev.stopPropagation());
    });
    box.append(row);
  });
}

function renderStrip() {
  const box = $('#msStrip');
  const sl = box.scrollLeft;
  box.innerHTML = '';
  for (const img of S().images) {
    const rec = P3.images.get(img.id);
    const err = img.placed ? P3.solve.imageRms(img) : null;
    const it = h('button', { class: 'ms-item' + (img.id === cur ? ' current' : '') + (img.id === refId ? ' ref' : ''), title: img.name, onclick: () => goTo(img.id) },
      h('img', { src: rec ? rec.thumb : '', alt: '' }),
      h('span', { class: 'ms-dots' }, S().features.map(f => h('i', { style: markedIn(f, img) ? `background:${f.color};border-color:${f.color}` : `border-color:${f.color}` }))),
      err != null ? h('span', { class: 'ms-err ' + P3.solve.errorClass(err) }, err.toFixed(1)) : null);
    box.append(it);
  }
  box.scrollLeft = sl;
  const c = box.querySelector('.current');
  if (c) { const br = box.getBoundingClientRect(), cr = c.getBoundingClientRect(); if (cr.left < br.left || cr.right > br.right) box.scrollLeft += cr.left - br.left - br.width / 2 + cr.width / 2; }
}

/* ---------- reference (previous photo with its marks) ---------- */
function cycleRef(d) {
  const c = S().images.filter(img => img.id !== cur && anyMark(img));
  if (!c.length) return;
  let i = c.findIndex(x => x.id === refId);
  refId = c[(i + d + c.length) % c.length].id;
  renderRef();
  renderStrip();
}
function renderRef() {
  const box = $('#msRefBox');
  const img = refId && imgOf(refId), rec = img && P3.images.get(img.id);
  if (!img || !rec) { box.classList.add('empty'); $('#msRefName').textContent = 'none yet'; const c = refCv.getContext('2d'); refCv.width = refCv.height = 0; return; }
  box.classList.remove('empty');
  $('#msRefName').textContent = img.name;
  const maxH = Math.max(90, window.innerHeight * (window.innerWidth <= 900 ? 0.2 : 0.38));
  const W = Math.max(100, Math.min(box.clientWidth, maxH * img.w / img.h)), H = Math.round(W * img.h / img.w);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  refCv.style.width = W + 'px'; refCv.style.height = H + 'px';
  refCv.width = Math.round(W * dpr); refCv.height = Math.round(H * dpr);
  const c = refCv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.drawImage(rec.el, 0, 0, W, H);
  drawMarks(c, img, (x, y) => [x * W, y * H], { small: true });
}

/* ---------- main canvas ---------- */
function resetView() { view = { z: 1, ox: null, oy: null }; }
function geom() {
  const rec = P3.images.get(cur);
  const W = stage.clientWidth, H = stage.clientHeight;
  const iw = rec ? rec.el.naturalWidth : 1, ih = rec ? rec.el.naturalHeight : 1;
  const fit = Math.min((W - 24) / iw, (H - 24) / ih);
  const s = fit * view.z;
  if (view.ox == null) { view.ox = (W - iw * s) / 2; view.oy = (H - ih * s) / 2; }
  return { W, H, iw, ih, s, rec };
}
const toScr = (G, x, y) => [view.ox + x * G.iw * G.s, view.oy + y * G.ih * G.s];
const toImg = (G, px, py) => ({ x: (px - view.ox) / (G.iw * G.s), y: (py - view.oy) / (G.ih * G.s) });
const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

function drawMarks(c, img, P, { small = false, active = null, hover = null } = {}) {
  const act = active !== null ? active : P3.tools.activeFeature();
  const pins = pinMap(img);
  const lw = small ? 2 : 3;
  const label = (x, y, t, col) => {
    c.font = `600 ${small ? 10 : 12}px system-ui, sans-serif`;
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.85)'; c.strokeText(t, x, y);
    c.fillStyle = col; c.fillText(t, x, y);
  };
  // fitted (placed) shape, dashed — where the solved lines land in this photo
  if (img.placed && !small) {
    for (const f of S().features) {
      if (!f.solved) continue;
      const pr = ends(f).map(v => P3.cam.project(img, M.vpos(v)));
      if (pr.some(p => !p)) continue;
      c.setLineDash([6, 5]); c.lineWidth = 1.5; c.strokeStyle = f.color; c.globalAlpha = 0.9;
      if (f.kind === 'point') { const [x, y] = P(pr[0].x, pr[0].y); c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.stroke(); }
      else { c.beginPath(); c.moveTo(...P(pr[0].x, pr[0].y)); c.lineTo(...P(pr[1].x, pr[1].y)); c.stroke(); }
      c.setLineDash([]); c.globalAlpha = 1;
    }
  }
  for (const f of S().features) {
    const isAct = act && act.id === f.id;
    c.globalAlpha = act && !isAct ? 0.8 : 1;
    const pa = pins.get(f.a), pb = f.kind === 'point' ? null : pins.get(f.b);
    if (!pa) continue;
    const A = P(pa.x, pa.y);
    if (f.kind === 'point') {
      c.beginPath(); c.arc(A[0], A[1], isAct ? 7 : 5.5, 0, Math.PI * 2);
      c.fillStyle = f.color; c.fill(); c.lineWidth = 2; c.strokeStyle = '#000'; c.stroke();
      if (!small || isAct) label(A[0] + 9, A[1] - 8, f.name, f.color);
      continue;
    }
    if (!pb) continue;
    const B = P(pb.x, pb.y);
    c.lineCap = 'round';
    c.lineWidth = (isAct ? lw + 1.5 : lw) + 3; c.strokeStyle = 'rgba(0,0,0,.6)';
    c.beginPath(); c.moveTo(...A); c.lineTo(...B); c.stroke();
    c.lineWidth = isAct ? lw + 1.5 : lw; c.strokeStyle = f.color;
    c.beginPath(); c.moveTo(...A); c.lineTo(...B); c.stroke();
    if (f.kind === 'axis') {
      const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, s = small ? 8 : 12;
      c.beginPath(); c.moveTo(...B); c.lineTo(B[0] - ux * s - uy * s * 0.55, B[1] - uy * s + ux * s * 0.55); c.lineTo(B[0] - ux * s + uy * s * 0.55, B[1] - uy * s - ux * s * 0.55); c.closePath(); c.fillStyle = f.color; c.fill();
    }
    for (const [pt, v] of [[A, f.a], [B, f.b]]) {
      const hv = hover === v;
      c.beginPath(); c.arc(pt[0], pt[1], small ? 3 : hv ? 7 : 5, 0, Math.PI * 2);
      c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2; c.strokeStyle = f.color; c.stroke();
    }
    if (!small || isAct) label((A[0] + B[0]) / 2 + 8, (A[1] + B[1]) / 2 - 8, f.name, f.color);
  }
  c.globalAlpha = 1;
}

function draw() {
  if (!mv.isOpen()) return;
  const G = geom();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(G.W * dpr) || cv.height !== Math.round(G.H * dpr)) { cv.width = Math.round(G.W * dpr); cv.height = Math.round(G.H * dpr); cv.style.width = G.W + 'px'; cv.style.height = G.H + 'px'; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, G.W, G.H);
  if (!G.rec) return;
  g.imageSmoothingEnabled = G.s < 2.5;
  g.drawImage(G.rec.el, view.ox, view.oy, G.iw * G.s, G.ih * G.s);
  const img = imgOf(cur);
  drawMarks(g, img, (x, y) => toScr(G, x, y), { hover: hoverV });
  // line being drawn
  const act = P3.tools.activeFeature();
  const start = drag && drag.type === 'draw' ? drag.a : pending ? pending.a : null;
  const endP = drag && drag.type === 'draw' ? drag.b : pending && mouse ? toImg(G, ...mouse) : null;
  if (start && endP && act) {
    const A = toScr(G, start.x, start.y), B = toScr(G, endP.x, endP.y);
    g.setLineDash([7, 5]); g.lineWidth = 3; g.strokeStyle = act.color; g.lineCap = 'round';
    g.beginPath(); g.moveTo(...A); g.lineTo(...B); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.arc(A[0], A[1], 5, 0, Math.PI * 2); g.fillStyle = act.color; g.fill();
  }
  // magnifier while placing / dragging an end
  if (mouse && (drag || pending)) loupe(G, mouse);
}

function loupe(G, [mx, my]) {
  const R = 64, mag = 3;
  const x = mx + R + 24 > G.W ? mx - R - 24 : mx + R + 24, y = my - R - 24 < 0 ? my + R + 24 : my - R - 24;
  g.save();
  g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#000'; g.fillRect(x - R, y - R, 2 * R, 2 * R);
  const n = toImg(G, mx, my);
  const srcW = (2 * R) / (G.s * mag);
  g.imageSmoothingEnabled = false;
  g.drawImage(G.rec.el, n.x * G.iw - srcW / 2, n.y * G.ih - srcW / 2, srcW, srcW, x - R, y - R, 2 * R, 2 * R);
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x - 10, y); g.lineTo(x - 3, y); g.moveTo(x + 3, y); g.lineTo(x + 10, y); g.moveTo(x, y - 10); g.lineTo(x, y - 3); g.moveTo(x, y + 3); g.lineTo(x, y + 10); g.stroke();
  g.restore();
  const act = P3.tools.activeFeature();
  g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.lineWidth = 2.5; g.strokeStyle = act ? act.color : '#fff'; g.stroke();
}

/* ================================================================== editing */
function hitHandle(G, px, py) {
  const img = imgOf(cur);
  let best = null, bd = 11;
  for (const p of img.pins || []) {
    if (!idx.featOf.has(p.v)) continue;
    const [x, y] = toScr(G, p.x, p.y);
    const d = Math.hypot(x - px, y - py);
    if (d < bd) { bd = d; best = p.v; }
  }
  return best;
}
function commitMark(label, fid) {
  P3.history.commit(label);
  P3.emit('marked', fid);
}
function advance() {
  const img = imgOf(cur);
  const f = S().features.find(x => !markedIn(x, img));
  if (f) P3.tools.setFeature(f.id);
}
function clearMark(f) {
  const img = imgOf(cur);
  ends(f).forEach(v => M.removePin(img, v));
  commitMark('Clear ' + f.name, f.id);
  P3.tools.setFeature(f.id);
}
function deleteMarker(f) {
  M.removeFeature(f.id);
  P3.history.commit('Delete marker');
  P3.ui.toast(`Deleted marker “${f.name}”`, '', { label: 'Undo', fn: () => P3.actions.undo() });
}
function addMarker(kind) {
  const n = S().features.filter(f => f.kind === kind).length + 1;
  const f = M.addFeature(kind, (kind === 'point' ? 'Point ' : 'Line ') + n);
  P3.history.commit('Add marker');
  P3.tools.setFeature(f.id);
  render();
}

function onDown(e) {
  const G = geom();
  const [px, py] = local(e);
  if (e.button === 1 || e.button === 2) {
    pan = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false, button: e.button, px, py };
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
  const n = toImg(G, px, py);
  if (n.x < 0 || n.y < 0 || n.x > 1 || n.y > 1) return;
  const act = P3.tools.activeFeature();
  if (pending && act) {
    const img = imgOf(cur);
    M.setPin(img, act.a, pending.a.x, pending.a.y);
    M.setPin(img, act.b, n.x, n.y);
    pending = null;
    commitMark('Mark ' + act.name, act.id);
    advance();
    render();
    return;
  }
  // Grab an existing end only if it belongs to the selected marker, or the selected marker is already drawn here.
  // Otherwise draw — new lines often start on another line's end (shared corners).
  const hv = hitHandle(G, px, py);
  const actDone = act && markedIn(act, imgOf(cur));
  if (hv != null && (!act || actDone || ends(act).includes(hv))) { drag = { type: 'handle', v: hv, moved: false }; return; }
  if (!act) { P3.ui.toast('Pick a marker on the right first'); return; }
  if (act.kind === 'point') {
    M.setPin(imgOf(cur), act.a, n.x, n.y);
    commitMark('Mark ' + act.name, act.id);
    advance();
    render();
    return;
  }
  drag = { type: 'draw', a: n, b: n, sx: e.clientX, sy: e.clientY, moved: false };
  draw();
}
function onMove(e) {
  if (!mv.isOpen()) return;
  if (pan) {
    view.ox = pan.ox + (e.clientX - pan.x);
    view.oy = pan.oy + (e.clientY - pan.y);
    if (Math.hypot(e.clientX - pan.x, e.clientY - pan.y) > 4) pan.moved = true;
    draw();
    return;
  }
  const r = cv.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (!inside && !drag) return;
  const G = geom();
  mouse = local(e);
  const n = toImg(G, ...mouse);
  if (drag && drag.type === 'handle') {
    const img = imgOf(cur);
    const p = (img.pins || []).find(q => q.v === drag.v);
    if (p) { p.x = U.clamp(n.x, 0, 1); p.y = U.clamp(n.y, 0, 1); drag.moved = true; }
    draw();
    return;
  }
  if (drag && drag.type === 'draw') {
    drag.b = { x: U.clamp(n.x, 0, 1), y: U.clamp(n.y, 0, 1) };
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
    draw();
    return;
  }
  const hv = hitHandle(G, ...mouse);
  cv.style.cursor = hv != null ? 'grab' : 'crosshair';
  if (hv !== hoverV || pending) { hoverV = hv; draw(); }
}
function onUp(e) {
  if (pan) {
    const p = pan;
    pan = null;
    if (!p.moved && p.button === 2) {
      // right-click on a mark removes that marker from this photo
      const G = geom();
      const hv = hitHandle(G, p.px, p.py);
      if (hv != null) clearMark(idx.featOf.get(hv).f);
    }
    return;
  }
  if (!drag) return;
  const d = drag;
  drag = null;
  const act = P3.tools.activeFeature();
  if (d.type === 'handle') {
    if (d.moved) { const fo = idx.featOf.get(d.v); commitMark('Move mark', fo && fo.f.id); }
    else { const fo = idx.featOf.get(d.v); if (fo) P3.tools.setFeature(fo.f.id); }
    render();
    return;
  }
  if (d.type === 'draw' && act) {
    if (d.moved) {
      const img = imgOf(cur);
      M.setPin(img, act.a, d.a.x, d.a.y);
      M.setPin(img, act.b, d.b.x, d.b.y);
      commitMark('Mark ' + act.name, act.id);
      advance();
      render();
    } else {
      pending = { a: d.a };
      renderHeader();
      draw();
    }
  }
}
function onWheel(e) {
  e.preventDefault();
  const G = geom();
  const [px, py] = local(e);
  const before = toImg(G, px, py);
  const k = Math.exp(-U.clamp(e.deltaY, -240, 240) * 0.0015 * (e.altKey ? 0.25 : 1));
  view.z = U.clamp(view.z * k, 1, 30);
  const s = (Math.min((G.W - 24) / G.iw, (G.H - 24) / G.ih)) * view.z;
  view.ox = px - before.x * G.iw * s;
  view.oy = py - before.y * G.ih * s;
  if (view.z === 1) { view.ox = null; }
  draw();
}

function onKey(e) {
  if (!mv.isOpen()) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' && t.type !== 'color' && t.type !== 'range' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (document.querySelector('.modal-backdrop')) return;
  if (e.ctrlKey || e.metaKey) return; // undo / redo / save handled globally
  const k = e.key;
  let handled = true;
  if (k === 'ArrowRight' || k === 'PageDown' || k === 'Enter' || k === ']') step(1);
  else if (k === 'ArrowLeft' || k === 'PageUp' || k === '[') step(-1);
  else if (/^[1-9]$/.test(k)) { const f = S().features[+k - 1]; if (f) { P3.tools.setFeature(f.id); pending = null; render(); } }
  else if (k === 'Delete' || k === 'Backspace') { const f = P3.tools.activeFeature(); if (f && markedIn(f, imgOf(cur))) clearMark(f); }
  else if (k === 'Escape') { if (pending || drag) { pending = null; drag = null; render(); } else mv.close(); }
  else if (k === '0' || k === 'Home') { resetView(); draw(); }
  else if (k === 'l' || k === 'L') addMarker('line');
  else if (k === 'p' || k === 'P') addMarker('point');
  else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}

/* ================================================================== place / fine-tune */
mv.place = async () => {
  if (readyCount() < 2) {
    P3.ui.toast('Mark at least 2 lines (or 4 points) in at least 2 photos — more photos make it better', 'error');
    return;
  }
  P3.ui.progress('Placing photos from your marks…', 0.1);
  await U.nextFrame();
  let res;
  try { res = P3.solve.fromFeatures({ onProgress: p => P3.ui.progress('Placing photos from your marks…', 0.1 + 0.85 * p) }); }
  catch (err) { console.error(err); res = { error: 'Placement failed: ' + err.message }; }
  P3.ui.progress(null);
  if (res.error) { P3.ui.toast(res.error, 'error'); return; }
  P3.history.commit('Place photos');
  mv.status = res;
  const bad = res.perImg.filter(p => p.rms > 8).sort((a, b) => b.rms - a.rms);
  let msg = `Placed ${res.cams} photo${res.cams === 1 ? '' : 's'} · average fit ${res.rms.toFixed(1)} px`;
  if (res.unused) msg += ` · ${res.unused} not placed (need 2+ lines marked)`;
  if (bad.length) msg += ` · check “${bad[0].name}”`;
  if (res.flat && res.rms > 1.5) msg += ' · tip: mark a point that sticks out of the lines’ plane';
  mv.close();
  P3.vp.frame();
  P3.ui.toast(msg, res.rms < 8 ? 'ok' : 'error', { label: 'Fine-tune', fn: () => mv.fineTune(bad.length ? bad[0].id : null) });
  P3.emit('steps');
};

mv.fineTune = id => {
  mv.close();
  const imgs = S().images;
  const target = (id && idx.c.get(id)) || imgs.find(i => i.placed) || imgs[0];
  if (!target) return;
  vp.enterCamera(target.id);
  document.getElementById('camBanner').classList.remove('collapsed');
  P3.ui.toast('Fine-tune: move this photo with the pad or the arrow keys (hold Alt for tiny steps). [ ] = other photos.', 'ok');
  P3.emit('steps');
};
mv.startMarking = id => mv.open(id);
})();
