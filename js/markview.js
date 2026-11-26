/* PhotoModel 3D — marking mode: colour-coded feature chips, a filmstrip with progress, a reference card that
   shows the previous photo's markings while you mark the current one, and auto-solve after each mark. */
(() => {
'use strict';
const P3 = window.P3;
const U = P3.util;
const vp = P3.vp;
const idx = P3.idx;
const S = () => P3.state;
const $ = sel => document.querySelector(sel);

const mv = (P3.markview = { showModel: false, refId: null, lastCam: null, status: null });

mv.active = () => !!vp.activeCam && P3.tools.current === 'mark';
/** Space taken by the marking UI, so the photo is laid out where nothing covers it. */
mv.insets = () => {
  if (!mv.active()) return null;
  const bar = $('#markBar'), card = $('#markRef'), tb = $('#toolbar');
  const out = { left: tb ? tb.offsetWidth + 18 : 0, right: 8, top: 8, bottom: bar && !bar.classList.contains('hidden') ? bar.offsetHeight + 20 : 8 };
  if (card && !card.classList.contains('hidden')) {
    if (card.classList.contains('collapsed')) out.top = card.offsetHeight + 16;
    else out.right = card.offsetWidth + 20;
  }
  return out;
};
mv.photoOpaque = () => mv.active() && !mv.showModel;

const ends = f => (f.kind === 'point' ? [f.a] : [f.a, f.b]);
const pinsOf = img => new Map((img.pins || []).map(p => [p.v, p]));
const marked = (f, img) => { const m = pinsOf(img); return ends(f).every(v => m.has(v)); };
const featureMarksIn = img => S().features.filter(f => marked(f, img)).length;
const hasMarks = id => { const img = idx.c.get(id); return !!img && S().features.some(f => ends(f).some(v => (img.pins || []).some(p => p.v === v))); };

/* ------------------------------------------------------------------ init */
mv.init = () => {
  $('#mrPrev').addEventListener('click', () => cycleRef(-1));
  $('#mrNext').addEventListener('click', () => cycleRef(1));
  $('#mrToggle').addEventListener('click', () => {
    const card = $('#markRef');
    card.classList.toggle('collapsed');
    localStorage.setItem('p3.refCollapsed', card.classList.contains('collapsed') ? '1' : '0');
    renderRef();
    vp.layout();
  });
  if (localStorage.getItem('p3.refCollapsed') === '1') $('#markRef').classList.add('collapsed');
  $('#mrCanvas').addEventListener('click', () => { if (mv.refId) vp.enterCamera(mv.refId); });
  $('#mbModel').addEventListener('click', () => { mv.showModel = !mv.showModel; update(); });
  $('#mbAdd').addEventListener('click', e => addMenu(e.currentTarget));

  P3.on('view', onView);
  P3.on('tool', update);
  P3.on('feature', update);
  P3.on('change', info => { if (!info || !info.live || info.source === 'pin') renderSoon(); });
  P3.on('settings', () => { if (mv.active()) renderRef(); });
  P3.on('marked', scheduleSolve);
  window.addEventListener('resize', () => { if (mv.active()) renderRef(); });
};

function onView() {
  const cur = vp.activeCam;
  if (mv.lastCam && mv.lastCam !== cur && hasMarks(mv.lastCam)) mv.refId = mv.lastCam;
  if (cur) mv.lastCam = cur;
  update();
}

let raf = 0;
function renderSoon() { if (!raf && mv.active()) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

function update() {
  const on = mv.active();
  vp.wrap().classList.toggle('marking', on);
  $('#markBar').classList.toggle('hidden', !on);
  if (on) render();
  else $('#markRef').classList.add('hidden');
  vp.layout();
}
mv.update = update;

function render() {
  renderChips();
  renderStrip();
  renderRef();
  renderStatus();
  vp.layout();
}

/* ------------------------------------------------------------------ feature chips */
function renderChips() {
  const box = $('#mbChips');
  box.innerHTML = '';
  const img = idx.c.get(vp.activeCam);
  const act = P3.tools.activeFeature();
  if (!S().features.length) {
    box.append(P3.ui.h('span', { class: 'muted small' }, 'No features yet — add a line, a direction or a point →'));
    return;
  }
  S().features.forEach((f, i) => {
    const done = img && marked(f, img);
    const kind = { axis: 'direction', line: 'line', point: 'point' }[f.kind];
    const how = { axis: 'tail → nose', line: 'left → right', point: 'click it' }[f.kind];
    const b = P3.ui.h('button', {
      class: 'fchip' + (act && act.id === f.id ? ' active' : '') + (done ? ' done' : ''),
      style: `--c:${f.color}`,
      title: `${f.name} — ${kind}, ${how} (${i + 1})`,
      onclick: () => P3.tools.setFeature(f.id),
    }, P3.ui.h('span', { class: 'fdot' }), P3.ui.h('span', { class: 'fname' }, f.name), P3.ui.h('span', { class: 'fstate' }, done ? '✓' : f.kind === 'point' ? '•' : f.kind === 'axis' ? '→' : '↔'));
    box.append(b);
  });
}

function addMenu(anchor) {
  const m = $('#ctxMenu');
  m.innerHTML = '';
  const item = (icon, label, fn) => P3.ui.h('button', { onclick: () => { m.classList.add('hidden'); fn(); } }, P3.ui.icon(icon), label);
  m.append(
    P3.ui.h('div', { class: 'menu-label' }, 'Add a feature to mark'),
    item('span', 'Line (left end → right end)', () => P3.actions.addFeature('line')),
    item('axis', 'Direction (tail → nose)', () => P3.actions.addFeature('axis')),
    item('dot', 'Point', () => P3.actions.addFeature('point')));
  m.classList.remove('hidden');
  const r = anchor.getBoundingClientRect(), mr = m.getBoundingClientRect();
  m.style.left = Math.min(r.left, innerWidth - mr.width - 8) + 'px';
  m.style.top = Math.max(8, r.top - mr.height - 6) + 'px';
}

/* ------------------------------------------------------------------ filmstrip */
function renderStrip() {
  const box = $('#mbStrip');
  const scroll = box.scrollLeft;
  box.innerHTML = '';
  const feats = S().features;
  for (const img of S().images) {
    const rec = P3.images.get(img.id);
    const n = featureMarksIn(img);
    const rms = n ? P3.solve.imageRms(img) : null;
    const it = P3.ui.h('button', {
      class: 'ms-item' + (img.id === vp.activeCam ? ' current' : '') + (img.id === mv.refId ? ' ref' : ''),
      title: `${img.name} — ${n}/${feats.length} features marked${rms != null && feats.some(f => f.solved) ? ` · error ${rms.toFixed(1)} px` : ''}`,
      onclick: () => vp.enterCamera(img.id),
    },
    P3.ui.h('img', { src: rec ? rec.thumb : '', alt: '' }),
    P3.ui.h('span', { class: 'ms-dots' }, feats.map(f => P3.ui.h('i', { style: marked(f, img) ? `background:${f.color};border-color:${f.color}` : `border-color:${f.color}` }))));
    box.append(it);
  }
  box.scrollLeft = scroll;
  const cur = box.querySelector('.current');
  if (cur) {
    const br = box.getBoundingClientRect(), cr = cur.getBoundingClientRect();
    if (cr.left < br.left || cr.right > br.right) box.scrollLeft += cr.left - br.left - br.width / 2 + cr.width / 2;
  }
}

/* ------------------------------------------------------------------ reference card */
function refCandidates() {
  return S().images.filter(img => img.id !== vp.activeCam && hasMarks(img.id));
}
function cycleRef(dir) {
  const c = refCandidates();
  if (!c.length) return;
  let i = c.findIndex(img => img.id === mv.refId);
  i = (i + dir + c.length) % c.length;
  mv.refId = c[i].id;
  renderRef();
  renderStrip();
}
function renderRef() {
  const card = $('#markRef');
  const cands = refCandidates();
  if (!mv.active() || !cands.length) { card.classList.add('hidden'); return; }
  if (!cands.some(img => img.id === mv.refId)) {
    // default: the closest marked photo before the current one in the list
    const list = S().images, cur = list.findIndex(i => i.id === vp.activeCam);
    const before = cands.filter(img => list.indexOf(img) < cur);
    mv.refId = (before[before.length - 1] || cands[0]).id;
  }
  card.classList.remove('hidden');
  const img = idx.c.get(mv.refId), rec = P3.images.get(mv.refId);
  $('#mrName').textContent = img.name;
  $('#mrCount').textContent = `${cands.indexOf(img) + 1}/${cands.length}`;
  if (card.classList.contains('collapsed') || !rec) return;
  const cv = $('#mrCanvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = card.clientWidth - 2, H = Math.round(W * img.h / img.w);
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.drawImage(rec.el, 0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,.18)';
  g.fillRect(0, 0, W, H);
  const act = P3.tools.activeFeature();
  const pins = pinsOf(img);
  const P = v => { const p = pins.get(v); return p ? [p.x * W, p.y * H] : null; };
  const label = (x, y, text, color) => {
    g.font = '600 11px system-ui, sans-serif';
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, x, y);
    g.fillStyle = color; g.fillText(text, x, y);
  };
  for (const f of S().features) {
    const isAct = act && act.id === f.id;
    g.globalAlpha = act && !isAct ? 0.55 : 1;
    const a = P(f.a), b = f.kind === 'point' ? null : P(f.b);
    if (f.kind === 'point') {
      if (!a) continue;
      g.beginPath(); g.arc(a[0], a[1], isAct ? 6 : 4.5, 0, Math.PI * 2);
      g.fillStyle = f.color; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
      label(a[0] + 8, a[1] - 6, f.name, f.color);
      continue;
    }
    if (!a || !b) continue;
    g.lineCap = 'round';
    g.lineWidth = (isAct ? 4 : 2.5) + 2.5; g.strokeStyle = 'rgba(0,0,0,.6)';
    g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
    g.lineWidth = isAct ? 4 : 2.5; g.strokeStyle = f.color;
    g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
    if (f.kind === 'axis') {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, s = isAct ? 12 : 9;
      g.beginPath(); g.moveTo(...b);
      g.lineTo(b[0] - ux * s - uy * s * 0.55, b[1] - uy * s + ux * s * 0.55);
      g.lineTo(b[0] - ux * s + uy * s * 0.55, b[1] - uy * s - ux * s * 0.55);
      g.closePath(); g.fillStyle = f.color; g.fill();
    }
    for (const [pt, t] of [[a, f.kind === 'axis' ? 'tail' : 'L'], [b, f.kind === 'axis' ? 'nose' : 'R']]) {
      g.beginPath(); g.arc(pt[0], pt[1], 3.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
      label(pt[0] + 6, pt[1] - 6, t, '#fff');
    }
    if (isAct) label((a[0] + b[0]) / 2 + 8, (a[1] + b[1]) / 2 + 14, f.name, f.color);
  }
  g.globalAlpha = 1;
  const note = $('#mrNote');
  if (act && !marked(act, img)) note.textContent = `“${act.name}” is not marked in this photo`;
  else if (act) note.textContent = `Match “${act.name}” the same way round — click to open this photo`;
  else note.textContent = 'Click to open this photo';
}

/* ------------------------------------------------------------------ auto-solve while marking */
function solvable() {
  const fv = new Set(S().features.flatMap(ends));
  const good = S().images.filter(img => (img.pins || []).filter(p => fv.has(p.v)).length >= 4).length;
  return { ok: good >= 2, good };
}
const runAutoSolve = () => {
  if (!P3.settings.autoSolve || !S().features.length) return;
  const sv = solvable();
  if (!sv.ok) { mv.status = { kind: 'need', good: sv.good }; renderStatus(); return; }
  let res;
  try { res = P3.solve.fromFeatures({ quick: true }); } catch (err) { console.error(err); res = { error: err.message }; }
  if (res.error) { mv.status = { kind: 'error', text: res.error }; renderStatus(); return; }
  P3.history.amend();
  mv.status = { kind: 'solved', rms: res.rms, cams: res.cams, flat: res.flat, unused: res.unused };
  renderStatus();
};
const scheduleSolve = U.debounce(runAutoSolve, 650);
mv.solveNow = runAutoSolve;

function renderStatus() {
  const el = $('#mbStatus');
  if (!el) return;
  const st = mv.status;
  const sv = solvable();
  el.className = 'chip';
  if (!S().features.length) { el.textContent = 'Add 2–3 lines + a point'; return; }
  if (!sv.ok) { el.textContent = `Mark 4+ points in ${2 - sv.good} more photo${2 - sv.good === 1 ? '' : 's'} to solve`; return; }
  if (st && st.kind === 'solved') {
    const cls = P3.solve.errorClass(st.rms);
    el.className = 'chip ' + cls;
    el.textContent = `Solved ${st.cams} cameras · ${st.rms.toFixed(1)} px`;
    el.title = st.flat && st.rms > 1.5
      ? 'All marked points lie in one plane — add a point that sticks out (e.g. the tail fin tip) for a reliable solve.'
      : `${st.unused ? st.unused + ' photo(s) not used yet (need 4+ marks each). ' : ''}Error = how far the solved marks are from your clicks.`;
    if (st.flat && st.rms > 1.5) el.textContent += ' · add a point off the plane';
    return;
  }
  if (st && st.kind === 'error') { el.className = 'chip bad'; el.textContent = 'Not solved yet'; el.title = st.text; return; }
  el.textContent = P3.settings.autoSolve ? 'Ready to solve' : 'Press Solve';
}

/* ------------------------------------------------------------------ presets / start */
const PRESETS = {
  aircraft: [['axis', 'Tail → nose'], ['line', 'Main wingspan'], ['line', 'Rear wingspan'], ['point', 'Fin tip']],
  vehicle: [['axis', 'Rear → front'], ['line', 'Front width'], ['line', 'Rear width'], ['point', 'Roof top']],
  generic: [['axis', 'Back → front'], ['line', 'Width (left → right)'], ['line', 'Second line'], ['point', 'Top point']],
};
mv.startMarking = async () => {
  if (!S().images.length) { P3.ui.toast('Import photos of the object first'); P3.actions.importImages(); return; }
  if (!S().features.length) {
    const v = await P3.ui.form('Start marking', [
      { key: 'preset', label: 'What are you modelling?', type: 'select', value: 'aircraft', options: [['aircraft', 'Aircraft / drone / bird'], ['vehicle', 'Car / boat / vehicle'], ['generic', 'Any other object'], ['none', 'Nothing yet — I’ll add my own']] },
    ], 'Start', 'You will mark the same few things in every photo: a <b>direction</b> (back → front), 2–3 <b>lines</b> (always left end → right end) and a <b>point</b> that sticks out. The cameras and the shape are then solved automatically — no dragging photos around.');
    if (!v) return;
    for (const [kind, name] of PRESETS[v.preset] || []) P3.model.addFeature(kind, name);
    if (S().features.length) P3.history.commit('Add features');
  }
  const first = S().images.find(img => S().features.some(f => !marked(f, img))) || S().images[0];
  vp.enterCamera(first.id);
  P3.tools.set('mark');
  const f = S().features.find(x => !marked(x, first)) || S().features[0];
  if (f) P3.tools.setFeature(f.id);
  update();
};
})();
