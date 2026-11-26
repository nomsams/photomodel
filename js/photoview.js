/* PhotoModel 3D — photo view extras: pin layer (where model points appear in the photo) and a magnifier loupe. */
(() => {
'use strict';
const T = window.THREE;
const P3 = window.P3;
const U = P3.util;
const vp = P3.vp;
const idx = P3.idx;

const pv = (P3.photoview = {});
const LOUPE_CSS = 150;
let svg, loupe, lctx, drag = null;

pv.init = () => {
  svg = document.getElementById('pinLayer');
  loupe = document.getElementById('loupe');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  loupe.width = loupe.height = Math.round(LOUPE_CSS * dpr);
  lctx = loupe.getContext('2d');
  vp.afterRender.push(renderPins);

  svg.addEventListener('pointerdown', onPinDown);
  svg.addEventListener('contextmenu', onPinContext);
  svg.addEventListener('dblclick', e => {
    const g = e.target.closest('[data-v]');
    if (g) P3.sel.set(['v:' + g.dataset.v]);
  });
  window.addEventListener('pointermove', onPinMove);
  window.addEventListener('pointerup', onPinUp);

  const el = vp.dom();
  el.addEventListener('pointermove', e => { if (!e.buttons) pv.updateLoupe(e); });
  el.addEventListener('pointerleave', () => pv.hideLoupe());
  P3.on('tool', () => { pv.hideLoupe(); vp.requestRender(); });
  P3.on('view', () => { pv.hideLoupe(); vp.requestRender(); });
};

/* ------------------------------------------------------------------ pins */
function activeImage() { return vp.activeCam ? idx.c.get(vp.activeCam) : null; }

function renderPins() {
  const img = activeImage();
  if (!img || !P3.settings.showPins) { svg.classList.add('hidden'); svg.innerHTML = ''; return; }
  svg.classList.remove('hidden');
  svg.classList.toggle('interactive', ['match', 'select', 'triangulate'].includes(P3.tools.current));
  const matchVid = P3.tools.matchVertex ? P3.tools.matchVertex() : null;
  let out = '';
  for (const pin of img.pins || []) {
    const X = P3.model.vpos(pin.v);
    if (!X) continue;
    const P = vp.imgToScreen(pin.x, pin.y);
    const Q = vp.toScreen(X);
    const err = P3.solve.pinError(img, pin);
    const cls = P3.solve.errorClass(err);
    if (Q) out += `<line class="res ${cls}" x1="${P.x.toFixed(1)}" y1="${P.y.toFixed(1)}" x2="${Q.x.toFixed(1)}" y2="${Q.y.toFixed(1)}"/>`;
    const isSel = P3.sel.has('v', pin.v);
    out += `<g class="pin${pin.v === matchVid ? ' active' : ''}${isSel ? ' sel' : ''}" data-v="${pin.v}" transform="translate(${P.x.toFixed(1)} ${P.y.toFixed(1)})">
      <circle class="pin-hit" r="11"><title>Point #${pin.v} — error ${err == null || !isFinite(err) ? '—' : err.toFixed(1) + ' px'}. Drag to move, right-click to remove.</title></circle>
      <circle class="pin-ring" r="6"/><path class="pin-cross" d="M-3 0H3M0 -3V3"/>
      <text x="9" y="-8">${pin.v}</text></g>`;
  }
  if (matchVid != null) {
    const X = P3.model.vpos(matchVid);
    const Q = X && vp.toScreen(X);
    if (Q) out += `<circle class="target" cx="${Q.x.toFixed(1)}" cy="${Q.y.toFixed(1)}" r="13"/>`;
  }
  svg.innerHTML = out;
}
pv.renderPins = renderPins;

function onPinDown(e) {
  const g = e.target.closest('[data-v]');
  const img = activeImage();
  if (!g || !img || e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  drag = { vid: +g.dataset.v, img, moved: false };
  pv.updateLoupe(e, true);
}
function onPinMove(e) {
  if (!drag) return;
  const l = vp.local(e);
  const n = vp.screenToImg(l.x, l.y);
  P3.model.setPin(drag.img, drag.vid, n.x, n.y);
  drag.moved = true;
  P3.touch({ source: 'pin' });
  pv.updateLoupe(e, true);
}
function onPinUp() {
  if (!drag) return;
  const d = drag;
  drag = null;
  pv.hideLoupe();
  if (d.moved) P3.history.commit('Move pin');
  else P3.sel.set(['v:' + d.vid]);
}
function onPinContext(e) {
  const g = e.target.closest('[data-v]');
  const img = activeImage();
  if (!g || !img) return;
  e.preventDefault();
  e.stopPropagation();
  P3.model.removePin(img, +g.dataset.v);
  P3.history.commit('Remove pin');
  P3.ui.toast(`Removed pin for point #${g.dataset.v}`, '', { label: 'Undo', fn: () => P3.actions.undo() });
}
pv.dragging = () => !!drag;

/* ------------------------------------------------------------------ loupe */
pv.hideLoupe = () => loupe && loupe.classList.add('hidden');

pv.updateLoupe = (e, force = false) => {
  const img = activeImage();
  const rec = img && P3.images.get(img.id);
  const tool = P3.tools.current;
  const want = force || ['triangulate', 'match', 'point', 'line', 'face'].includes(tool);
  if (!rec || !want || !P3.settings.showLoupe || vp.alignMode || vp.overlayHidden || !vp.inView(e)) { pv.hideLoupe(); return; }
  const l = vp.local(e);
  const n = vp.screenToImg(l.x, l.y);
  const el = rec.el, W = el.naturalWidth, H = el.naturalHeight;
  const r = vp.viewRect;
  const screenPerPx = (r.w * vp.pz.z) / W;
  const mag = +P3.settings.loupeZoom || 4;
  const src = LOUPE_CSS / (screenPerPx * mag);
  const S = loupe.width;
  lctx.save();
  lctx.clearRect(0, 0, S, S);
  lctx.beginPath();
  lctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  lctx.clip();
  lctx.fillStyle = '#000';
  lctx.fillRect(0, 0, S, S);
  lctx.imageSmoothingEnabled = mag * screenPerPx < 3;
  lctx.drawImage(el, n.x * W - src / 2, n.y * H - src / 2, src, src, 0, 0, S, S);
  // pins inside the loupe
  const k = S / src;
  for (const pin of img.pins || []) {
    const px = (pin.x * W - (n.x * W - src / 2)) * k, py = (pin.y * H - (n.y * H - src / 2)) * k;
    if (px < -10 || py < -10 || px > S + 10 || py > S + 10) continue;
    lctx.strokeStyle = '#fff';
    lctx.lineWidth = 1.5 * (S / LOUPE_CSS);
    lctx.beginPath(); lctx.arc(px, py, 5 * (S / LOUPE_CSS), 0, Math.PI * 2); lctx.stroke();
  }
  // crosshair
  const c = S / 2, g = 6 * (S / LOUPE_CSS), len = 22 * (S / LOUPE_CSS);
  lctx.lineWidth = 3 * (S / LOUPE_CSS);
  lctx.strokeStyle = 'rgba(0,0,0,.6)';
  const cross = () => { lctx.beginPath(); lctx.moveTo(c - len, c); lctx.lineTo(c - g, c); lctx.moveTo(c + g, c); lctx.lineTo(c + len, c); lctx.moveTo(c, c - len); lctx.lineTo(c, c - g); lctx.moveTo(c, c + g); lctx.lineTo(c, c + len); lctx.stroke(); };
  cross();
  lctx.lineWidth = 1.4 * (S / LOUPE_CSS);
  lctx.strokeStyle = P3.ACCENTS[P3.settings.accent] || '#ff8a1f';
  cross();
  lctx.restore();

  const ww = vp.wrap().clientWidth;
  let x = l.x + 26, y = l.y - 26 - LOUPE_CSS;
  if (x + LOUPE_CSS > ww - 4) x = l.x - 26 - LOUPE_CSS;
  if (y < 4) y = l.y + 26;
  loupe.style.left = x + 'px';
  loupe.style.top = y + 'px';
  loupe.classList.remove('hidden');
};
})();
