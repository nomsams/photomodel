/* PhotoModel 3D — demo project: renders "photos" of a small house so every feature can be tried without your own photos. */
(() => {
'use strict';
const T = window.THREE;
const P3 = window.P3;
const U = P3.util;

const demo = (P3.demo = {});
const W = 960, H = 720, FOV = 50;

function checker() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = (x + y) % 2 ? '#7d8a6a' : '#8e9a79';
    g.fillRect(x * 32, y * 32, 32, 32);
  }
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(6, 6);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}
function sky() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#6fa3d8'); gr.addColorStop(0.6, '#c6dcef'); gr.addColorStop(1, '#e9eef2');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

/** House: body 2.4 (x) × 1.6 (y) × 1.8 (z), gable roof ridge along X at y = 2.5. */
function buildScene() {
  const scene = new T.Scene();
  scene.background = sky();
  scene.add(new T.HemisphereLight(0xdfefff, 0x6a6050, 1.6));
  const sun = new T.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 7, 5);
  scene.add(sun);
  const ground = new T.Mesh(new T.PlaneGeometry(16, 16), new T.MeshLambertMaterial({ map: checker() }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const wall = new T.MeshLambertMaterial({ color: '#ead9b8' });
  const body = new T.Mesh(new T.BoxGeometry(2.4, 1.6, 1.8), wall);
  body.position.y = 0.8;
  scene.add(body);
  // roof (two slopes) + gables
  const roofG = new T.BufferGeometry();
  const r = [
    -1.2, 1.6, 0.9, 1.2, 1.6, 0.9, 1.2, 2.5, 0, -1.2, 1.6, 0.9, 1.2, 2.5, 0, -1.2, 2.5, 0,
    1.2, 1.6, -0.9, -1.2, 1.6, -0.9, -1.2, 2.5, 0, 1.2, 1.6, -0.9, -1.2, 2.5, 0, 1.2, 2.5, 0,
  ];
  roofG.setAttribute('position', new T.Float32BufferAttribute(r, 3));
  roofG.computeVertexNormals();
  scene.add(new T.Mesh(roofG, new T.MeshLambertMaterial({ color: '#b0473a', side: T.DoubleSide })));
  const gab = new T.BufferGeometry();
  gab.setAttribute('position', new T.Float32BufferAttribute([1.2, 1.6, 0.9, 1.2, 1.6, -0.9, 1.2, 2.5, 0, -1.2, 1.6, -0.9, -1.2, 1.6, 0.9, -1.2, 2.5, 0], 3));
  gab.computeVertexNormals();
  scene.add(new T.Mesh(gab, new T.MeshLambertMaterial({ color: '#e2cfa9', side: T.DoubleSide })));
  // door & windows
  const add = (w, h, x, y, z, ry, color) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshLambertMaterial({ color }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
  };
  add(0.5, 1.0, 0, 0.5, 0.902, 0, '#6b3f25');
  add(0.45, 0.4, -0.75, 1.0, 0.902, 0, '#3f6f99');
  add(0.45, 0.4, 0.75, 1.0, 0.902, 0, '#3f6f99');
  add(0.6, 0.45, 0, 1.0, -0.902, Math.PI, '#3f6f99');
  add(0.5, 0.45, 1.202, 1.0, 0, Math.PI / 2, '#3f6f99');
  add(0.5, 0.45, -1.202, 1.0, 0, -Math.PI / 2, '#3f6f99');
  // chimney
  const ch = new T.Mesh(new T.BoxGeometry(0.3, 0.7, 0.3), new T.MeshLambertMaterial({ color: '#8c5b4a' }));
  ch.position.set(0.6, 2.35, -0.3);
  scene.add(ch);
  // crisp outlines
  const lineM = new T.LineBasicMaterial({ color: '#2a2622' });
  const outline = (geo, pos) => { const l = new T.LineSegments(new T.EdgesGeometry(geo), lineM); if (pos) l.position.copy(pos); scene.add(l); };
  outline(body.geometry, body.position);
  outline(roofG);
  outline(ch.geometry, ch.position);
  return scene;
}

function poses() {
  const out = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.35;
    const h = i % 2 ? 2.6 : 1.5;
    const rad = i % 2 ? 6.4 : 5.6;
    const eye = new T.Vector3(rad * Math.sin(a), h, rad * Math.cos(a));
    const target = new T.Vector3(0.15 * Math.sin(i * 1.7), 1.05, 0.15 * Math.cos(i * 2.3));
    out.push({ eye, q: P3.cam.lookQuat(eye, target) });
  }
  return out;
}

demo.load = async () => {
  P3.ui.progress('Rendering demo photos…', 0);
  await U.nextFrame();
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  try {
    const scene = buildScene();
    const cam = new T.PerspectiveCamera(FOV, W / H, 0.05, 200);
    const shots = poses();
    const srcs = [];
    for (let i = 0; i < shots.length; i++) {
      cam.position.copy(shots[i].eye);
      cam.quaternion.copy(shots[i].q);
      cam.updateMatrixWorld();
      renderer.render(scene, cam);
      srcs.push(renderer.domElement.toDataURL('image/jpeg', 0.88));
      P3.ui.progress(`Rendering demo photos… ${i + 1}/${shots.length}`, (i + 1) / shots.length);
      await U.nextFrame();
    }

    // Build the project state
    const st = P3.blankState();
    const images = {};
    srcs.forEach((src, i) => {
      const id = st.nextId++;
      images[id] = src;
      const img = { id, name: `house_${String(i + 1).padStart(2, '0')}`, w: W, h: H, fov: FOV, fovSource: 'exif', pos: [0, 0, 0], rot: [0, 0, 0], visible: true, pins: [] };
      P3.cam.setPose(img, shots[i].eye, shots[i].q);
      st.images.push(img);
    });
    // Start of the model: the walls (8 corners, 4 wall faces)
    const corners = [[-1.2, 0, 0.9], [1.2, 0, 0.9], [1.2, 1.6, 0.9], [-1.2, 1.6, 0.9], [-1.2, 0, -0.9], [1.2, 0, -0.9], [1.2, 1.6, -0.9], [-1.2, 1.6, -0.9]];
    const vid = corners.map(p => { const id = st.nextId++; st.vertices.push({ id, p }); return id; });
    const faceIdx = [[0, 1, 2, 3], [1, 5, 6, 2], [5, 4, 7, 6], [4, 0, 3, 7]];
    const ekeys = new Map();
    const edge = (a, b) => { const k = P3.edgeKey(a, b); if (!ekeys.has(k)) { const id = st.nextId++; ekeys.set(k, id); st.edges.push({ id, a, b }); } return ekeys.get(k); };
    const faceIds = faceIdx.map(f => {
      const v = f.map(i => vid[i]);
      v.forEach((a, i) => edge(a, v[(i + 1) % v.length]));
      const id = st.nextId++;
      st.faces.push({ id, v });
      return id;
    });
    st.objects.push({ id: st.nextId++, name: 'Walls', color: '#e8c58a', faces: faceIds, edges: [], visible: true });

    // Photo 4: pinned from the true pose, then knocked out of place → "Solve" restores it.
    const bad = st.images[3];
    corners.forEach((p, i) => {
      const n = P3.cam.project(bad, new T.Vector3(...p));
      if (n && n.x > 0.02 && n.x < 0.98 && n.y > 0.02 && n.y < 0.98) bad.pins.push({ v: vid[i], x: U.round(n.x, 6), y: U.round(n.y, 6) });
    });
    bad.pos = bad.pos.map((v, i) => U.round(v + [0.9, -0.5, 0.7][i], 4));
    bad.rot = [bad.rot[0] + 4, bad.rot[1] + 9, bad.rot[2] - 3].map(v => U.round(v, 3));
    bad.name += ' (misplaced)';

    await P3.io.loadProject({ state: st, images, name: 'Demo — little house' }, { markSaved: false });
    P3.io.fileHandle = null;
    P3.vp.setView('iso');
    P3.vp.frame();
    P3.ui.progress(null);
    P3.ui.demoTour();
  } finally {
    P3.ui.progress(null);
    renderer.dispose();
    renderer.forceContextLoss();
  }
};
})();
