/* PhotoModel 3D — files: photos (with EXIF FOV), projects, autosave, point clouds, OBJ import, exports. */
(() => {
'use strict';
const T = window.THREE;
const P3 = window.P3;
const U = P3.util;
const S = () => P3.state;
const idx = P3.idx;

const io = (P3.io = { fileHandle: null, loading: false });
const FORMAT = 'PhotoModel3D';
const IMG_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const isImage = f => (f.type && f.type.startsWith('image/')) || IMG_RE.test(f.name);

/* ================================================================== EXIF (focal length) */
function readExif(buf) {
  try {
    const dv = new DataView(buf);
    if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 4 < dv.byteLength) {
      const marker = dv.getUint16(off);
      if ((marker & 0xFF00) !== 0xFF00) return null;
      const len = dv.getUint16(off + 2);
      if (marker === 0xFFE1 && dv.getUint32(off + 4) === 0x45786966) {
        const tiff = off + 10;
        const le = dv.getUint16(tiff) === 0x4949;
        const u16 = o => dv.getUint16(o, le), u32 = o => dv.getUint32(o, le);
        const ifd = at => {
          const n = u16(tiff + at), tags = {};
          for (let i = 0; i < n; i++) { const e = tiff + at + 2 + i * 12; tags[u16(e)] = e + 8; }
          return tags;
        };
        const ifd0 = ifd(u32(tiff + 4));
        const out = {};
        if (ifd0[0x8769]) {
          const ex = ifd(u32(ifd0[0x8769]));
          if (ex[0xA405]) out.f35 = u16(ex[0xA405]);
          if (ex[0x920A]) { const o = tiff + u32(ex[0x920A]); const d = u32(o + 4); if (d) out.f = u32(o) / d; }
        }
        if (ifd0[0x0110]) {
          const n = u32(ifd0[0x0110] - 4), o = n > 4 ? tiff + u32(ifd0[0x0110]) : ifd0[0x0110];
          let s = ''; for (let i = 0; i < Math.min(n, 64); i++) { const c = dv.getUint8(o + i); if (!c) break; s += String.fromCharCode(c); }
          out.model = s.trim();
        }
        return out;
      }
      if (marker === 0xFFDA) return null;
      off += 2 + len;
    }
  } catch { /* malformed EXIF */ }
  return null;
}

/* ================================================================== photos */
async function prepareImage(file) {
  const buf = await U.readFile(file, 'buffer');
  const exif = readExif(buf);
  const src0 = await U.readFile(file);
  const im = await U.loadImage(src0);
  let w = im.naturalWidth, h = im.naturalHeight;
  const max = +P3.settings.maxImageSize || 0;
  let src = src0;
  if (max && Math.max(w, h) > max) {
    const s = max / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(im, 0, 0, w, h);
    src = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
  }
  return { src, w, h, exif };
}

io.importImages = async files => {
  const list = [...files].filter(isImage);
  if (!list.length) return;
  const added = [];
  let exifCount = 0;
  P3.ui.progress(`Importing ${list.length} photo(s)…`, 0);
  try {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      P3.ui.progress(`Importing ${f.name} (${i + 1}/${list.length})`, i / list.length);
      await U.nextFrame();
      try {
        const { src, w, h, exif } = await prepareImage(f);
        const id = P3.newId();
        await P3.registerImage(id, src);
        let fov = +P3.settings.defaultFov || 50, fovSource = 'default';
        if (P3.settings.useExifFov && exif && exif.f35 > 0) { fov = U.round(P3.cam.fovFrom35mm(exif.f35, w, h), 2); fovSource = 'exif'; exifCount++; }
        const img = { id, name: f.name.replace(/\.[^.]+$/, ''), w, h, fov, fovSource, pos: [0, 0, 0], rot: [0, 0, 0], visible: true, pins: [] };
        if (exif && exif.f35) img.f35 = exif.f35;
        if (exif && exif.model) img.camera = exif.model;
        S().images.push(img);
        added.push(img);
      } catch (err) {
        console.error(err);
        P3.ui.toast(`Could not import ${f.name} (${/heic|heif/i.test(f.name) ? 'HEIC is not supported by browsers — convert to JPEG' : err.message})`, 'error');
      }
    }
  } finally {
    P3.ui.progress(null);
  }
  if (!added.length) return;
  const existing = S().images.length - added.length;
  P3.model.arrangeRing(added, { radius: +P3.settings.ringRadius || 6, height: +P3.settings.ringHeight || 0, startAngle: existing * 17 });
  P3.history.commit(`Import ${added.length} photo(s)`);
  P3.ui.toast(`Imported ${added.length} photo(s)${exifCount ? ` · FOV from EXIF for ${exifCount}` : ''}. Next: mark a few lines in each photo and the cameras place themselves.`, 'ok', { label: 'Start marking', fn: () => P3.actions.startMarking() });
  if (!existing) P3.vp.frame();
};

/* ================================================================== project save / open */
function cloudForFile() {
  const c = P3.cloud;
  return c ? {
    name: c.name, visible: c.visible !== false, kind: c.kind || 'points',
    positions: Array.from(c.positions, n => Math.round(n * 1e5) / 1e5),
    colors: c.colors ? Array.from(c.colors, n => Math.round(n * 1000) / 1000) : null,
  } : null;
}

io.buildProject = () => {
  const images = {};
  for (const img of S().images) { const rec = P3.images.get(img.id); if (rec) images[img.id] = rec.src; }
  return {
    format: FORMAT, version: 2, app: P3.VERSION,
    name: P3.project.name, savedAt: new Date().toISOString(),
    settings: { units: P3.settings.units },
    state: P3.state, images, cloud: cloudForFile(), view: P3.vp.getViewState(),
  };
};

io.save = async (saveAs = false) => {
  const fname = U.safeName(P3.project.name) + '.p3d.json';
  P3.ui.progress('Saving project…', 0.5);
  await U.nextFrame();
  let data;
  try { data = JSON.stringify(io.buildProject()); } finally { P3.ui.progress(null); }
  const done = where => {
    P3.history.markSaved();
    P3.ui.toast('Project saved' + (where ? ' to ' + where : ''), 'ok');
    P3.ui.saved('Saved ' + new Date().toLocaleTimeString());
  };
  if (window.showSaveFilePicker) {
    try {
      if (!io.fileHandle || saveAs) {
        io.fileHandle = await window.showSaveFilePicker({
          suggestedName: fname,
          types: [{ description: 'PhotoModel 3D project', accept: { 'application/json': ['.json'] } }],
        });
      }
      const w = await io.fileHandle.createWritable();
      await w.write(data);
      await w.close();
      return done(io.fileHandle.name);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn('File System Access save failed, falling back to download', err);
      io.fileHandle = null;
    }
  }
  U.download(new Blob([data], { type: 'application/json' }), fname);
  done(fname);
};

io.loadProject = async (obj, { markSaved = true } = {}) => {
  if (!obj || typeof obj !== 'object' || !obj.state) throw new Error('Not a PhotoModel 3D project file');
  P3.vp.exitCamera();
  P3.tools.cancel();
  const entries = Object.entries(obj.images || {});
  const fresh = new Map();
  let done = 0;
  await Promise.all(entries.map(async ([id, src]) => {
    try { await P3.registerImage(+id, src, fresh); } catch (err) { console.error('image', id, err); }
    done++;
    if (entries.length > 3) P3.ui.progress(`Loading photos ${done}/${entries.length}`, done / entries.length);
  }));
  P3.ui.progress(null);
  P3.images = fresh;
  P3.vp.clearTextures();
  const st = P3.normalizeState(obj.state);
  st.images = st.images.filter(i => P3.images.has(i.id));
  let repaired = 0;
  for (const img of st.images) {
    const el = P3.images.get(img.id).el, w = el.naturalWidth, h = el.naturalHeight;
    if (w && h && Math.abs(w / h - img.w / img.h) > 0.01) { img.w = w; img.h = h; img.placed = false; repaired++; }
  }
  if (repaired) setTimeout(() => P3.ui.toast(`Repaired the size of ${repaired} photo(s) that didn't match their picture — place the photos again`, 'error'), 400);
  P3.state = st;
  P3.project.name = obj.name || 'Untitled project';
  if (obj.settings && obj.settings.units) P3.setSetting('units', obj.settings.units);
  P3.cloud = obj.cloud && obj.cloud.positions ? {
    name: obj.cloud.name || 'cloud',
    visible: obj.cloud.visible !== false,
    kind: obj.cloud.kind || 'points',
    positions: obj.cloud.positions instanceof Float32Array ? obj.cloud.positions : new Float32Array(obj.cloud.positions),
    colors: obj.cloud.colors ? (obj.cloud.colors instanceof Float32Array ? obj.cloud.colors : new Float32Array(obj.cloud.colors)) : null,
  } : null;
  cloudDirty = true;
  P3.reindex();
  P3.sel.clear(true);
  P3.history.reset(markSaved);
  P3.emit('change', { live: false, restore: true });
  P3.emit('selection');
  P3.emit('cloud');
  P3.emit('project');
  if (obj.view) P3.vp.setViewState(obj.view); else P3.vp.frame();
};

io.openFile = async file => {
  try {
    P3.ui.progress('Opening ' + file.name, 0.1);
    const obj = JSON.parse(await U.readFile(file, 'text'));
    await io.loadProject(obj);
    io.fileHandle = null;
    P3.ui.toast('Opened ' + file.name, 'ok');
  } catch (err) {
    console.error(err);
    P3.ui.toast('Could not open project: ' + err.message, 'error');
  } finally {
    P3.ui.progress(null);
  }
};

io.newProject = async () => {
  await io.loadProject({ state: P3.blankState(), images: {}, name: 'Untitled project' });
  io.fileHandle = null;
  P3.vp.setView('iso');
  P3.vp.frame();
  io.autosaveNow();
};

/* ================================================================== autosave (IndexedDB)
   Photos are stored once per id ("img:<id>"); each autosave only writes the small JSON state. */
const idb = {
  db: null,
  open() {
    if (idb.db) return Promise.resolve(idb.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('photomodel3d', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { idb.db = r.result; res(r.result); };
      r.onerror = () => rej(r.error);
    });
  },
  async run(mode, fn) {
    const db = await idb.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  },
  set: (k, v) => idb.run('readwrite', s => s.put(v, k)),
  get: k => idb.run('readonly', s => s.get(k)),
  del: k => idb.run('readwrite', s => s.delete(k)),
  keys: () => idb.run('readonly', s => s.getAllKeys()),
};
const persisted = new Map();
let cloudDirty = true;

io.autosaveNow = async () => {
  if (!P3.settings.autosave || io.loading || !window.indexedDB) return;
  try {
    for (const img of S().images) {
      if (persisted.get(img.id) === (P3.images.get(img.id) || {}).src) continue;
      const rec = P3.images.get(img.id);
      if (rec) { await idb.set('img:' + img.id, rec.src); persisted.set(img.id, rec.src); }
    }
    if (cloudDirty) {
      const c = P3.cloud;
      await idb.set('cloud', c ? { name: c.name, visible: c.visible, kind: c.kind, positions: c.positions, colors: c.colors } : null);
      cloudDirty = false;
    }
    await idb.set('meta', {
      format: FORMAT, version: 2, name: P3.project.name, savedAt: new Date().toISOString(),
      state: P3.state, imageIds: S().images.map(i => i.id), view: P3.vp.getViewState(),
      dirty: P3.history.dirty,
    });
    P3.ui.saved('Autosaved ' + new Date().toLocaleTimeString());
  } catch (err) {
    console.warn('Autosave failed', err);
    P3.ui.saved('Autosave failed' + (err && err.name === 'QuotaExceededError' ? ' (storage full)' : ''));
  }
};
io.scheduleAutosave = U.debounce(io.autosaveNow, 900);
io.markCloudDirty = () => { cloudDirty = true; io.scheduleAutosave(); };

io.restoreAutosave = async () => {
  if (!P3.settings.autosave || !window.indexedDB) return false;
  try {
    let obj = null;
    const meta = await idb.get('meta');
    if (meta && meta.state) {
      // also keep photos referenced by the undo-able past state if possible: only current ones are needed after reload
      const images = {};
      for (const id of meta.imageIds || []) { const src = await idb.get('img:' + id); if (src) images[id] = src; }
      obj = { ...meta, images, cloud: await idb.get('cloud') };
    } else {
      const legacy = await idb.get('autosave');
      if (legacy && legacy.state) obj = legacy;
    }
    if (!obj) return false;
    io.loading = true;
    await io.loadProject(obj, { markSaved: !obj.dirty });
    persisted.clear();
    Object.entries(obj.images || {}).forEach(([id, src]) => persisted.set(+id, src));
    cloudDirty = false;
    // drop photos that are no longer referenced
    const keep = new Set(Object.keys(obj.images || {}).map(id => 'img:' + id));
    for (const k of await idb.keys()) if (typeof k === 'string' && k.startsWith('img:') && !keep.has(k)) idb.del(k);
    if (!meta) idb.del('autosave');
    return S().images.length + S().vertices.length > 0 || !!P3.cloud;
  } catch (err) {
    console.warn('Could not restore autosave', err);
    return false;
  } finally {
    io.loading = false;
  }
};

/* ================================================================== point clouds */
function parseTextCloud(text) {
  const pos = [], col = [];
  let hasColor = true;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || !/^[-+.\d]/.test(t)) continue;
    const n = t.split(/[\s,;]+/).map(Number).filter(x => !Number.isNaN(x));
    if (n.length < 3) continue;
    pos.push(n[0], n[1], n[2]);
    if (n.length >= 6) {
      const c = n.slice(3, 6);
      const scale = c.some(x => x > 1) ? 1 / 255 : 1;
      col.push(c[0] * scale, c[1] * scale, c[2] * scale);
    } else hasColor = false;
  }
  return { positions: new Float32Array(pos), colors: hasColor && col.length === pos.length ? new Float32Array(col) : null };
}

/* ---------- Gaussian splats (3DGS .ply and antimatter15 .splat) shown as coloured points ---------- */
const MAX_SPLAT_POINTS = 1500000;
const SH_C0 = 0.28209479177387814;
const sigmoid = x => 1 / (1 + Math.exp(-x));

function plyHeader(buf) {
  const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, 65536));
  const text = new TextDecoder().decode(bytes);
  const end = text.indexOf('end_header');
  if (end < 0) return null;
  const headerLen = text.slice(0, end).length + 'end_header'.length + (text[end + 10] === '\r' ? 2 : 1);
  const lines = text.slice(0, end).split(/\r?\n/);
  const fmt = (lines.find(l => l.startsWith('format')) || '').split(/\s+/)[1];
  let count = 0, inVertex = false;
  const props = [];
  for (const l of lines) {
    const p = l.trim().split(/\s+/);
    if (p[0] === 'element') { inVertex = p[1] === 'vertex'; if (inVertex) count = +p[2]; }
    else if (p[0] === 'property' && inVertex && p[1] !== 'list') props.push({ type: p[1], name: p[2] });
  }
  return { fmt, count, props, headerLen };
}
const PLY_SIZE = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
function isSplatPly(h) { return h && h.props.some(p => p.name === 'f_dc_0') && h.props.some(p => p.name === 'opacity'); }

function parseSplatPly(buf, h) {
  if (h.fmt !== 'binary_little_endian') throw new Error('Only binary little-endian splat .ply files are supported');
  const dv = new DataView(buf);
  let stride = 0;
  const off = {};
  for (const p of h.props) { off[p.name] = { o: stride, t: p.type }; stride += PLY_SIZE[p.type] || 4; }
  const rd = (base, name) => {
    const q = off[name]; if (!q) return 0;
    const o = base + q.o;
    switch (q.t) { case 'double': case 'float64': return dv.getFloat64(o, true); case 'uchar': case 'uint8': return dv.getUint8(o); default: return dv.getFloat32(o, true); }
  };
  const step = Math.max(1, Math.ceil(h.count / MAX_SPLAT_POINTS));
  const pos = [], col = [];
  for (let i = 0; i < h.count; i += step) {
    const b = h.headerLen + i * stride;
    if (b + stride > buf.byteLength) break;
    if (sigmoid(rd(b, 'opacity')) < 0.12) continue;
    pos.push(rd(b, 'x'), rd(b, 'y'), rd(b, 'z'));
    col.push(...['f_dc_0', 'f_dc_1', 'f_dc_2'].map(n => U.clamp(0.5 + SH_C0 * rd(b, n), 0, 1)));
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col) };
}
function parseDotSplat(buf) {
  const n = Math.floor(buf.byteLength / 32);
  const dv = new DataView(buf);
  const step = Math.max(1, Math.ceil(n / MAX_SPLAT_POINTS));
  const pos = [], col = [];
  for (let i = 0; i < n; i += step) {
    const o = i * 32;
    if (dv.getUint8(o + 27) < 30) continue;
    pos.push(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true));
    col.push(dv.getUint8(o + 24) / 255, dv.getUint8(o + 25) / 255, dv.getUint8(o + 26) / 255);
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col) };
}

io.importCloud = async file => {
  try {
    P3.ui.progress('Reading ' + file.name, 0.3);
    await U.nextFrame();
    let positions, colors = null, kind = 'points';
    const ext = U.ext(file.name);
    if (ext === 'splat') {
      ({ positions, colors } = parseDotSplat(await U.readFile(file, 'buffer')));
      kind = 'splat';
    } else if (ext === 'ply') {
      const buf = await U.readFile(file, 'buffer');
      const h = plyHeader(buf);
      if (isSplatPly(h)) { ({ positions, colors } = parseSplatPly(buf, h)); kind = 'splat'; }
      else {
        const geo = new T.PLYLoader().parse(buf);
        positions = new Float32Array(geo.attributes.position.array);
        if (geo.attributes.color) colors = new Float32Array(geo.attributes.color.array);
      }
    } else if (ext === 'ksplat' || ext === 'spz' || ext === 'sog') {
      throw new Error(`.${ext} is a compressed splat format — export it as .ply or .splat from your splat tool`);
    } else {
      ({ positions, colors } = parseTextCloud(await U.readFile(file, 'text')));
    }
    if (!positions.length) throw new Error('No points found');
    P3.cloud = { name: file.name, positions, colors, visible: true, kind };
    S().cloudMatrix = null;
    P3.emit('cloud');
    P3.vp.frame();
    io.markCloudDirty();
    P3.ui.toast(`Loaded ${(positions.length / 3).toLocaleString()} ${kind === 'splat' ? 'splat centres (shown as coloured points)' : 'points'} from ${file.name}`, 'ok');
  } catch (err) {
    console.error(err);
    P3.ui.toast('Could not load point cloud: ' + err.message, 'error');
  } finally {
    P3.ui.progress(null);
  }
};

/* ================================================================== OBJ import */
io.importOBJ = async file => {
  try {
    const text = await U.readFile(file, 'text');
    const local = [];
    let nf = 0, ne = 0, curObj = null;
    const groups = new Map();
    const grp = name => { if (!groups.has(name)) groups.set(name, { f: [], e: [] }); return groups.get(name); };
    for (const raw of text.split(/\r?\n/)) {
      const parts = raw.trim().split(/\s+/);
      const ref = s => { const i = parseInt(s.split('/')[0], 10); return i < 0 ? local.length + i : i - 1; };
      if (parts[0] === 'v' && parts.length >= 4) local.push(P3.model.addVertex(new T.Vector3(+parts[1], +parts[2], +parts[3])));
      else if (parts[0] === 'o' || parts[0] === 'g') curObj = parts.slice(1).join(' ') || null;
      else if (parts[0] === 'f' && parts.length >= 4) {
        const fid = P3.model.addFace(parts.slice(1).map(ref).map(i => local[i]).filter(v => v != null));
        if (fid) { nf++; if (curObj) grp(curObj).f.push(fid); }
      } else if (parts[0] === 'l' && parts.length >= 3) {
        const ids = parts.slice(1).map(ref).map(i => local[i]).filter(v => v != null);
        for (let i = 0; i < ids.length - 1; i++) {
          const eid = P3.model.addEdge(ids[i], ids[i + 1]);
          if (eid) { ne++; if (curObj) grp(curObj).e.push(eid); }
        }
      }
    }
    if (!local.length) throw new Error('No vertices found');
    const palette = ['#ff9f1c', '#4fc3f7', '#7bd88f', '#e06cff', '#ffd166', '#ef6f6c'];
    for (const [name, g] of groups) {
      if (/^(default|ungrouped)$/i.test(name) || (!g.f.length && !g.e.length)) continue;
      S().objects.push({ id: P3.newId(), name, color: palette[S().objects.length % palette.length], faces: g.f, edges: g.e, visible: true });
    }
    P3.history.commit('Import OBJ');
    P3.vp.frame();
    P3.ui.toast(`Imported ${local.length} vertices, ${nf} faces, ${ne} lines`, 'ok');
  } catch (err) {
    console.error(err);
    P3.ui.toast('Could not import OBJ: ' + err.message, 'error');
  }
};

/* ================================================================== COLMAP text model (automatic camera placement)
   Run your photos through COLMAP (or anything that writes its text format), then import
   cameras.txt + images.txt (+ points3D.txt). Photos are matched by file name. */
const FY_MODELS = new Set(['PINHOLE', 'OPENCV', 'OPENCV_FISHEYE', 'FULL_OPENCV', 'FOV', 'THIN_PRISM_FISHEYE']);
const baseName = n => String(n).split(/[\\/]/).pop().replace(/\.[^.]+$/, '').toLowerCase();

io.importColmap = async files => {
  const list = [...files];
  const find = n => list.find(f => f.name.toLowerCase() === n);
  const camF = find('cameras.txt'), imgF = find('images.txt'), ptF = find('points3d.txt');
  try {
    if (!imgF) throw new Error('images.txt is required (select cameras.txt, images.txt and points3D.txt together)');
    if (!S().images.length) throw new Error('Import the same photos first — cameras are matched to photos by file name');
    P3.ui.progress('Reading COLMAP model…', 0.2);
    await U.nextFrame();
    const intr = new Map();
    if (camF) {
      for (const line of (await U.readFile(camF, 'text')).split(/\r?\n/)) {
        const p = line.trim().split(/\s+/);
        if (!p[0] || p[0].startsWith('#') || p.length < 5) continue;
        const fx = +p[4], fy = FY_MODELS.has(p[1]) ? +p[5] : fx;
        intr.set(p[0], { w: +p[2], h: +p[3], fy });
      }
    }
    const byName = new Map(S().images.map(img => [baseName(img.name), img]));
    const lines = (await U.readFile(imgF, 'text')).split(/\r?\n/).filter(l => !l.startsWith('#'));
    const matched = [], missing = [];
    const flip = new T.Quaternion(1, 0, 0, 0); // 180° about X: COLMAP (y down, z forward) → three.js (y up, z back)
    for (let i = 0; i < lines.length; i += 2) {
      const p = lines[i].trim().split(/\s+/);
      if (p.length < 10) { if (lines[i].trim()) i--; continue; }
      const [qw, qx, qy, qz, tx, ty, tz] = p.slice(1, 8).map(Number);
      const name = p.slice(9).join(' ');
      const img = byName.get(baseName(name));
      if (!img) { missing.push(name); continue; }
      const qwc = new T.Quaternion(qx, qy, qz, qw).normalize();
      const qcw = qwc.clone().invert();
      const C = new T.Vector3(tx, ty, tz).applyQuaternion(qcw).negate();
      P3.cam.setPose(img, C, qcw.multiply(flip));
      const k = intr.get(p[8]);
      if (k && k.fy > 0) { img.fov = U.round(2 * Math.atan(k.h / (2 * k.fy)) * U.R2D, 3); img.fovSource = 'colmap'; }
      matched.push(img);
    }
    if (!matched.length) throw new Error('No COLMAP image names matched your photos' + (missing.length ? ` (e.g. “${missing[0]}”)` : ''));
    if (ptF) {
      const pos = [], col = [];
      for (const line of (await U.readFile(ptF, 'text')).split(/\r?\n/)) {
        const p = line.trim().split(/\s+/);
        if (!p[0] || p[0].startsWith('#') || p.length < 7) continue;
        pos.push(+p[1], +p[2], +p[3]);
        col.push(+p[4] / 255, +p[5] / 255, +p[6] / 255);
      }
      if (pos.length) { P3.cloud = { name: 'COLMAP points3D', positions: new Float32Array(pos), colors: new Float32Array(col), visible: true, kind: 'points' }; S().cloudMatrix = null; cloudDirty = true; }
    }
    // Level the scene: average camera "up" → +Y, centre on the cameras' look-at area.
    const up = matched.reduce((a, img) => a.add(new T.Vector3(0, 1, 0).applyQuaternion(P3.cam.quat(img))), new T.Vector3()).normalize();
    const centre = P3.cloud && P3.cloud.name === 'COLMAP points3D'
      ? new T.Box3().setFromBufferAttribute(new T.BufferAttribute(P3.cloud.positions, 3)).getCenter(new T.Vector3())
      : matched.reduce((a, img) => a.add(P3.cam.position(img)), new T.Vector3()).divideScalar(matched.length);
    const rot = new T.Matrix4().makeRotationFromQuaternion(new T.Quaternion().setFromUnitVectors(up, new T.Vector3(0, 1, 0)));
    const m = rot.multiply(new T.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
    const keepCloud = S().cloudMatrix;
    P3.model.transformScene(m);
    if (!P3.cloud) S().cloudMatrix = keepCloud;
    // Marked features: rebuild them from the COLMAP cameras, then put the object along the reference direction.
    let aligned = false;
    if (S().features.length) {
      P3.reindex();
      P3.solve.triangulateFeatures();
      if (S().features.some(f => f.kind === 'axis' && f.solved)) aligned = !P3.solve.alignToReference().error;
    }
    P3.history.commit('Import COLMAP');
    if (aligned) P3.ui.toast('Features re-triangulated and the scene aligned to the reference direction', 'ok');
    P3.emit('cloud');
    io.markCloudDirty();
    P3.vp.frame();
    P3.ui.toast(`Placed ${matched.length} of ${S().images.length} photo cameras from COLMAP${missing.length ? ` · ${missing.length} name(s) not found` : ''}. Use “Align to reference direction” to put the object along +X.`, 'ok');
  } catch (err) {
    console.error(err);
    P3.ui.toast('COLMAP import failed: ' + err.message, 'error');
  } finally {
    P3.ui.progress(null);
  }
};

/* ================================================================== feature sets (reuse definitions across objects / "cousins") */
io.exportFeatureSet = () => {
  if (!S().features.length) return P3.ui.toast('No features to save yet', 'error');
  const data = {
    format: FORMAT + '-features', version: 1,
    features: S().features.map(f => ({ name: f.name, kind: f.kind, color: f.color, ref: !!f.ref, length: f.length || null })),
  };
  U.download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), U.safeName(P3.project.name) + '.features.json');
  P3.ui.toast('Feature set saved — load it into another project to mark the same features', 'ok');
};
io.importFeatureSet = async file => {
  try {
    const obj = JSON.parse(await U.readFile(file, 'text'));
    if (!obj || !Array.isArray(obj.features)) throw new Error('Not a feature set file');
    let n = 0;
    for (const f of obj.features) {
      if (!['point', 'line', 'axis'].includes(f.kind) || S().features.some(x => x.name === f.name)) continue;
      const nf = P3.model.addFeature(f.kind, f.name, { color: f.color, length: f.length });
      if (f.ref) { S().features.forEach(x => { x.ref = false; }); nf.ref = true; }
      n++;
    }
    P3.history.commit('Load feature set');
    P3.ui.toast(`Added ${n} feature(s) from ${file.name}`, 'ok');
  } catch (err) {
    P3.ui.toast('Could not load feature set: ' + err.message, 'error');
  }
};

/* ================================================================== exports */
const exportable = v => !idx.unsolved.has(v);
function faceBoundaryKeys() {
  const keys = new Set();
  for (const f of S().faces) for (let i = 0; i < f.v.length; i++) keys.add(P3.edgeKey(f.v[i], f.v[(i + 1) % f.v.length]));
  return keys;
}
const n6 = n => +(+n).toFixed(6);

function exportOBJ() {
  const s = S();
  const out = [`# ${FORMAT} ${P3.VERSION} export — ${P3.project.name}`, `# ${new Date().toISOString()}`, `# units: ${P3.settings.units}`, `# ${s.vertices.length} vertices, ${s.faces.length} faces, ${s.edges.length} edges`];
  const vi = new Map();
  s.vertices.filter(v => exportable(v.id)).forEach((v, i) => { vi.set(v.id, i + 1); out.push(`v ${n6(v.p[0])} ${n6(v.p[1])} ${n6(v.p[2])}`); });
  const boundary = faceBoundaryKeys();
  const usedF = new Set(), usedE = new Set();
  const writeGroup = (name, faces, edges) => {
    faces = faces.filter(f => f.v.every(v => vi.has(v)));
    edges = edges.filter(e => vi.has(e.a) && vi.has(e.b));
    const lines = edges.filter(e => !boundary.has(P3.edgeKey(e.a, e.b)));
    faces.forEach(f => usedF.add(f.id));
    edges.forEach(e => usedE.add(e.id));
    if (!faces.length && !lines.length) return;
    out.push('', `o ${name.replace(/\s+/g, '_')}`);
    faces.forEach(f => out.push('f ' + f.v.map(id => vi.get(id)).join(' ')));
    lines.forEach(e => out.push(`l ${vi.get(e.a)} ${vi.get(e.b)}`));
  };
  for (const o of s.objects) writeGroup(o.name, o.faces.map(id => idx.f.get(id)).filter(Boolean), o.edges.map(id => idx.e.get(id)).filter(Boolean));
  writeGroup('ungrouped', s.faces.filter(f => !usedF.has(f.id)), s.edges.filter(e => !usedE.has(e.id)));
  return out.join('\n') + '\n';
}

function exportSTL() {
  const name = U.safeName(P3.project.name).replace(/\s+/g, '_');
  const out = [`solid ${name}`];
  const ab = new T.Vector3(), ac = new T.Vector3();
  for (const f of S().faces) {
    if (!f.v.every(exportable)) continue;
    const pts = f.v.map(id => P3.model.vpos(id));
    if (pts.some(p => !p)) continue;
    for (const [i, j, k] of P3.geom.triangulate(pts)) {
      const n = ab.subVectors(pts[j], pts[i]).cross(ac.subVectors(pts[k], pts[i])).normalize();
      out.push(`  facet normal ${n6(n.x)} ${n6(n.y)} ${n6(n.z)}`, '    outer loop');
      for (const p of [pts[i], pts[j], pts[k]]) out.push(`      vertex ${n6(p.x)} ${n6(p.y)} ${n6(p.z)}`);
      out.push('    endloop', '  endfacet');
    }
  }
  out.push(`endsolid ${name}`);
  return out.join('\n') + '\n';
}

function exportPLY() {
  const vs = S().vertices.filter(v => exportable(v.id));
  const out = ['ply', 'format ascii 1.0', `comment ${FORMAT} points (${P3.settings.units})`, `element vertex ${vs.length}`, 'property float x', 'property float y', 'property float z', 'end_header'];
  vs.forEach(v => out.push(v.p.map(n6).join(' ')));
  return out.join('\n') + '\n';
}

function exportCameras() {
  return JSON.stringify({
    format: FORMAT + '-cameras',
    units: P3.settings.units,
    convention: 'Right-handed, Y up. Camera looks down its local -Z axis with +Y up (three.js / OpenGL). rotationDeg = Euler YXZ [pitch, yaw, roll]. Pins are normalised image coords (0..1, y down).',
    cameras: S().images.map(img => ({
      name: img.name, width: img.w, height: img.h,
      fovYDeg: img.fov, focalLengthPx: +P3.cam.focalPx(img).toFixed(3),
      position: img.pos,
      rotationDeg: { pitch: img.rot[0], yaw: img.rot[1], roll: img.rot[2] },
      quaternion: P3.cam.quat(img).toArray().map(n6),
      reprojectionErrorPx: (r => (r == null ? null : +r.toFixed(3)))(P3.solve.imageRms(img)),
      pins: (img.pins || []).map(p => ({ vertex: p.v, x: p.x, y: p.y })),
    })),
    points: S().vertices.map(v => ({ id: v.id, position: v.p })),
  }, null, 2);
}

async function exportGLB() {
  const s = S();
  const scene = new T.Scene();
  scene.name = P3.project.name;
  const boundary = faceBoundaryKeys();
  const buckets = new Map();
  const bucket = o => {
    const k = o ? o.id : 0;
    if (!buckets.has(k)) buckets.set(k, { name: o ? o.name : 'ungrouped', color: o ? o.color : P3.settings.faceColor, line: o ? o.color : P3.settings.lineColor, faces: [], edges: [] });
    return buckets.get(k);
  };
  s.faces.forEach(f => { if (f.v.every(exportable)) bucket(idx.faceObj.get(f.id)).faces.push(f); });
  s.edges.forEach(e => { if (!exportable(e.a) || !exportable(e.b)) return; if (!boundary.has(P3.edgeKey(e.a, e.b))) bucket(idx.edgeObj.get(e.id)).edges.push(e); });
  for (const b of buckets.values()) {
    const g = new T.Group();
    g.name = b.name;
    scene.add(g);
    if (b.faces.length) {
      const pos = [];
      for (const f of b.faces) {
        const pts = f.v.map(id => P3.model.vpos(id));
        if (pts.some(p => !p)) continue;
        for (const tri of P3.geom.triangulate(pts)) for (const i of tri) pos.push(pts[i].x, pts[i].y, pts[i].z);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ color: b.color, side: T.DoubleSide, roughness: 0.8 }));
      mesh.name = b.name + '_mesh';
      g.add(mesh);
    }
    if (b.edges.length) {
      const pos = [];
      b.edges.forEach(e => pos.push(...idx.v.get(e.a).p, ...idx.v.get(e.b).p));
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      const ls = new T.LineSegments(geo, new T.LineBasicMaterial({ color: b.line }));
      ls.name = b.name + '_lines';
      g.add(ls);
    }
  }
  if (s.images.length) {
    const cams = new T.Group();
    cams.name = 'photo_cameras';
    for (const img of s.images) {
      const c = new T.PerspectiveCamera(img.fov, img.w / img.h, 0.01, 1000);
      c.name = img.name;
      c.position.fromArray(img.pos);
      c.quaternion.copy(P3.cam.quat(img));
      cams.add(c);
    }
    scene.add(cams);
  }
  return new Promise((res, rej) => new T.GLTFExporter().parse(scene, res, rej, { binary: true }));
}

io.export = async fmt => {
  const base = U.safeName(P3.project.name);
  const s = S();
  try {
    if ((fmt === 'obj' || fmt === 'ply' || fmt === 'glb') && !s.vertices.length) return P3.ui.toast('Nothing to export yet — add some points first', 'error');
    if (fmt === 'stl' && !s.faces.length) return P3.ui.toast('STL needs faces — create some faces first', 'error');
    if (fmt === 'cameras' && !s.images.length) return P3.ui.toast('No photo cameras to export', 'error');
    if (fmt === 'obj') U.download(new Blob([exportOBJ()], { type: 'text/plain' }), base + '.obj');
    else if (fmt === 'stl') U.download(new Blob([exportSTL()], { type: 'model/stl' }), base + '.stl');
    else if (fmt === 'ply') U.download(new Blob([exportPLY()], { type: 'text/plain' }), base + '_points.ply');
    else if (fmt === 'cameras') U.download(new Blob([exportCameras()], { type: 'application/json' }), base + '_cameras.json');
    else if (fmt === 'glb') U.download(new Blob([await exportGLB()], { type: 'model/gltf-binary' }), base + '.glb');
    else if (fmt === 'png') U.download(await P3.vp.screenshot(), base + '.png');
    else return;
    P3.ui.toast('Exported ' + fmt.toUpperCase(), 'ok');
  } catch (err) {
    console.error(err);
    P3.ui.toast('Export failed: ' + err.message, 'error');
  }
};
io._exporters = { exportOBJ, exportSTL, exportPLY, exportCameras, exportGLB, readExif };

/* ================================================================== routing dropped / picked files */
io.routeFiles = async files => {
  const list = [...files];
  const images = list.filter(isImage);
  const colmap = list.filter(f => /^(cameras|images|points3d)\.txt$/i.test(f.name));
  const featureSets = list.filter(f => /\.features\.json$/i.test(f.name));
  const project = list.find(f => /\.json$/i.test(f.name) && !/\.features\.json$/i.test(f.name));
  const clouds = list.filter(f => /\.(ply|xyz|txt|csv|pts|splat|ksplat|spz)$/i.test(f.name) && !colmap.includes(f));
  const objs = list.filter(f => /\.obj$/i.test(f.name));
  if (project) {
    if ((S().vertices.length || S().images.length) && P3.history.dirty) {
      if (!(await P3.ui.confirm('Open project?', `Opening <b>${U.esc(project.name)}</b> replaces the current project, which has unsaved changes.`, 'Open'))) return;
    }
    await io.openFile(project);
  }
  if (images.length) await io.importImages(images);
  for (const c of clouds) await io.importCloud(c);
  for (const o of objs) await io.importOBJ(o);
  if (colmap.length) await io.importColmap(colmap);
  for (const fs of featureSets) await io.importFeatureSet(fs);
  if (!project && !images.length && !clouds.length && !objs.length && !colmap.length && !featureSets.length) P3.ui.toast('Unsupported file type', 'error');
};

P3.on('history', () => io.scheduleAutosave());
P3.on('project', () => io.scheduleAutosave());
})();
