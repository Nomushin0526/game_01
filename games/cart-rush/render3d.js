// カートラッシュ！ 3D描画（Three.js / WebGL）
// ゲーム側（game.js）の座標 (x, y, z) を、Three.js では (x, y, -z) に置く（-z が進行方向）。
(function () {
  'use strict';
  const T = window.THREE;
  const Mo = window.CartModels;
  const THEMES = window.CartThemes;
  const { GEO, M, MB, mesh, box, cyl } = Mo;

  const DRAW = 320; // 前方の描画・出現距離
  const CAM_BACK = 7; // ゲーム側が「カメラの後ろに消えた」判定に使う距離
  const CHUNK = 40; // 景色を作る単位（m）
  // カメラ: プレイヤーの後ろ上から、少し先を見下ろす
  // カメラ視点: 標準 / 見下ろし / 一人称
  const CAMS = {
    normal: { back: 4.6, h: 4.3, ahead: 20, lookY: -3.6, hfov: 62 },
    high: { back: 6.8, h: 6.8, ahead: 12, lookY: -6.5, hfov: 66 }, // 商店街のアーケードやスーパーの天井より下
    fp: { hfov: 78 },
  };
  let CAM = CAMS.normal;

  const R = { W: 1, H: 1, k: 50, camX: 0, lift: 0, shake: 0 };
  let renderer = null;
  let scene = null;
  let camera = null;
  let hemi = null;
  let sun = null;
  let baseFov = 70;
  let player = null;
  let backdrop = null;
  let skyKey = '';
  let G_night = false;
  let camMode = 'normal';
  const chunks = new Map();
  const live = new Map();
  let stageObjs = [];
  let gates = [];
  let builtFor = null;
  let frameId = 0;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function hash(a, b, c) {
    let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function zoneAt(stage, z) {
    const zs = stage.zones;
    for (let i = 0; i < zs.length; i++) if (z < zs[i].to) return zs[i];
    return zs[zs.length - 1];
  }

  // ---------- 初期化 ----------
  function init(canvas) {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // スマホの高解像度画面でも重くなりすぎないよう、解像度の倍率は 1.5 までに抑える
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    Mo.setAnisotropy(renderer.capabilities.getMaxAnisotropy());
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(70, 1, 0.1, 800);
    hemi = new T.HemisphereLight('#ffffff', '#6a6458', 0.62);
    scene.add(hemi);
    sun = new T.DirectionalLight('#ffffff', 0.5);
    sun.position.set(-0.5, 1, 0.7);
    scene.add(sun);
    const p = Mo.buildPlayer();
    player = p;
    scene.add(p.root);
  }

  function setView(W, H) {
    R.W = W;
    R.H = H;
    // 指の操作量の換算用（画面幅を基準にした「1m = 何px」）。カメラ位置を変えても操作感が変わらないようにする
    R.k = (0.42 * W) / THEMES.market.roadW;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    // 縦長画面でも左右が狭くなりすぎないよう、横の画角を基準に縦の画角を決める
    updateFov();
  }
  function updateFov() {
    const tanH = Math.tan((CAM.hfov * Math.PI) / 360);
    baseFov = clamp((Math.atan(tanH / camera.aspect) * 360) / Math.PI, 50, 100);
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }

  function setCameraMode(mode) {
    camMode = CAMS[mode] ? mode : 'normal';
    CAM = CAMS[camMode];
    if (camera) updateFov();
  }

  function setCamera(x, z, lift) {
    R.camX = x;
    R.lift = lift || 0;
  }
  function setShake(v) {
    R.shake = v;
  }

  // ---------- 空と遠景 ----------
  const SKIES = {
    day: { top: '#6fbff0', fog: '#dff1fb', city: '#b9cddc', city2: '#a5bccd', tower: '#e8eef2', grass: ['#8fd16a', '#84c55f'], hemi: '#ffffff', hemiI: 0.66, sunI: 0.5, sun: null, water: '#4a90c2' },
    evening: { top: '#4a3a78', fog: '#ffc18a', city: '#9c7c96', city2: '#86687f', tower: '#f2d6c8', grass: ['#8f8a5a', '#857f52'], hemi: '#ffd8b8', hemiI: 0.62, sunI: 0.45, sun: '#ffdf8a', water: '#c97b6a' },
    night: { top: '#050a22', fog: '#1b2346', city: '#1a2142', city2: '#141a36', tower: '#9fb4ff', grass: ['#22301f', '#1d2a1b'], hemi: '#8090ff', hemiI: 0.36, sunI: 0.12, sun: null, water: '#16264a', lights: true },
  };
  function skyTex(sky) {
    return Mo.canvasTex('sky|' + sky.top, 4, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, sky.top);
      gr.addColorStop(0.55, sky.fog);
      gr.addColorStop(1, sky.fog);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
  }
  // 遠くの東京の街並み（ビル群とタワー）。カメラと一緒に動く
  function buildBackdrop(sky) {
    const g = new T.Group();
    const r = Mo.rng(42);
    const bmat = [new T.MeshBasicMaterial({ color: sky.city, fog: false }), new T.MeshBasicMaterial({ color: sky.city2, fog: false })];
    for (let i = 0; i < 70; i++) {
      const x = -900 + i * 26 + r() * 10;
      const h = 15 + Math.pow(r(), 2) * 110;
      const w = 14 + r() * 24;
      const m = new T.Mesh(GEO.box, bmat[i % 2]);
      m.scale.set(w, h, 20);
      m.position.set(x, h / 2 - 8, -600 - r() * 60);
      g.add(m);
    }
    // 下町から見える高い電波塔（実在の塔を思わせるシルエット）
    const tm = new T.MeshBasicMaterial({ color: sky.tower, fog: false });
    const tower = new T.Group();
    tower.add(mesh(new T.CylinderGeometry(1.2, 9, 280, 6), tm, null, 0, 140, 0, 1, 1, 1));
    tower.add(mesh(new T.CylinderGeometry(9, 9, 10, 16), tm, null, 0, 190, 0, 1, 1, 1));
    tower.add(mesh(new T.CylinderGeometry(6, 6, 7, 16), tm, null, 0, 240, 0, 1, 1, 1));
    tower.add(mesh(new T.CylinderGeometry(0.6, 1.2, 60, 6), tm, null, 0, 310, 0, 1, 1, 1));
    tower.position.set(-260, -8, -660);
    g.add(tower);
    if (sky.lights) {
      // 夜景の窓あかり
      const pts = [];
      for (let i = 0; i < 900; i++) pts.push(-900 + r() * 1800, -6 + Math.pow(r(), 1.6) * 100, -585 - r() * 30);
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      g.add(new T.Points(geo, new T.PointsMaterial({ color: '#ffd98a', size: 2, sizeAttenuation: false, fog: false })));
      const stars = [];
      for (let i = 0; i < 300; i++) stars.push(-1200 + r() * 2400, 150 + r() * 400, -700);
      const sg = new T.BufferGeometry();
      sg.setAttribute('position', new T.Float32BufferAttribute(stars, 3));
      g.add(new T.Points(sg, new T.PointsMaterial({ color: '#ffffff', size: 1.5, sizeAttenuation: false, fog: false })));
      for (const y of [192, 242]) g.add(mesh(new T.CylinderGeometry(9.3, 9.3, 1.5, 16), new T.MeshBasicMaterial({ color: '#7fd0ff', fog: false }), null, -260, y - 8, -660, 1, 1, 1));
    }
    if (sky.sun) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: Mo.glowTex, color: sky.sun, fog: false, transparent: true, depthWrite: false }));
      s.scale.set(180, 180, 1);
      s.position.set(80, 30, -640);
      g.add(s);
    }
    if (!sky.lights) {
      for (let i = 0; i < 7; i++) {
        const c = new T.Sprite(new T.SpriteMaterial({ map: Mo.glowTex, color: sky.sun ? '#ffd0c0' : '#ffffff', fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
        c.scale.set(140 + i * 20, 40 + (i % 3) * 10, 1);
        c.position.set(-500 + i * 170, 130 + (i % 2) * 40, -620);
        g.add(c);
      }
    }
    return g;
  }

  function skyFor(stage, night) {
    return night ? 'night' : stage.sky || 'day';
  }
  function applySky(stage, zone, night) {
    const key = zone.type === 'market' ? 'market' : skyFor(stage, night);
    if (key === skyKey) return;
    skyKey = key;
    if (backdrop) {
      scene.remove(backdrop);
      backdrop = null;
    }
    if (key === 'market') {
      scene.background = new T.Color('#efe9dc');
      scene.fog = new T.Fog('#efe9dc', 70, DRAW);
      hemi.color.set('#ffffff');
      hemi.intensity = 0.62;
      sun.intensity = 0.5;
      return;
    }
    const sky = SKIES[key];
    scene.background = skyTex(sky);
    scene.fog = new T.Fog(sky.fog, 90, DRAW);
    hemi.color.set(sky.hemi);
    hemi.intensity = sky.hemiI;
    sun.intensity = sky.sunI;
    backdrop = buildBackdrop(sky);
    scene.add(backdrop);
  }

  // ---------- 景色のかたまり（CHUNK m ごと） ----------
  const instMat = new T.MeshLambertMaterial({ color: '#ffffff' });
  const instBasic = new T.MeshBasicMaterial({ color: '#ffffff' });
  const dummy = new T.Object3D();
  const tmpColor = new T.Color();
  // 同じ形をまとめて1回で描く（スマホでも軽くするため）
  function Instancer() {
    const groups = new Map();
    return {
      // basic: true ならライトの影響を受けない（光っている物）
      add(geo, color, x, y, z, sx, sy, sz, ry, basic, rx) {
        const key = basic ? 'b' : 'l';
        let byGeo = groups.get(key);
        if (!byGeo) groups.set(key, (byGeo = new Map()));
        let arr = byGeo.get(geo);
        if (!arr) byGeo.set(geo, (arr = []));
        arr.push([color, x, y, z, sx, sy, sz, ry || 0, rx || 0]);
      },
      build(parent) {
        for (const [key, byGeo] of groups) for (const [geo, arr] of byGeo) {
          const im = new T.InstancedMesh(geo, key === 'b' ? instBasic : instMat, arr.length);
          arr.forEach((a, i) => {
            dummy.position.set(a[1], a[2], a[3]);
            dummy.scale.set(a[4], a[5], a[6]);
            dummy.rotation.set(a[8], a[7], 0);
            dummy.updateMatrix();
            im.setMatrixAt(i, dummy.matrix);
            im.setColorAt(i, tmpColor.set(a[0]));
          });
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          parent.add(im);
        }
      },
    };
  }

  function plane(parent, x0, x1, y, za, zb, mat) {
    const m = mesh(GEO.plane, mat, parent, (x0 + x1) / 2, y, -(za + zb) / 2, x1 - x0, zb - za, 1);
    m.rotation.x = -Math.PI / 2;
    return m;
  }
  const texMatCache = new Map();
  function texMat(tex, extra) {
    let m = texMatCache.get(tex.uuid);
    if (!m) {
      m = new T.MeshLambertMaterial(Object.assign({ map: tex }, extra || {}));
      texMatCache.set(tex.uuid, m);
    }
    return m;
  }

  const HOUSE_COLORS = ['#fff1d6', '#d9ecf7', '#fde0e3', '#e6f2d6', '#f2e6d9'];
  const ROOF_COLORS = ['#d9534f', '#3d6fa8', '#6b4f3a', '#3c8d5a', '#8a5a9e'];

  function buildRange(g, inst, stage, zone, za, zb) {
    const L = zb - za;
    const th = THEMES[zone.type];
    const RW = th.roadW;
    const zc = -(za + zb) / 2;

    if (zone.type === 'market') {
      const SH = 4.2;
      const CEIL = 7.4;
      plane(g, -RW, RW, 0, za, zb, texMat(Mo.repeated(Mo.floorTex, 'floor', RW, L / 2)));
      const ceil = plane(g, -16, 16, CEIL, za, zb, MB('#dfe2e5'));
      ceil.rotation.x = Math.PI / 2;
      for (let z = Math.ceil(za / 10) * 10; z < zb; z += 10) inst.add(GEO.box, '#fffbe8', 0, CEIL - 0.03, -(z + 1.6), 1.8, 0.04, 3.2, 0, true);
      for (const side of [-1, 1]) {
        const variant = Math.floor(hash(Math.floor(za / CHUNK), side + 3, 1) * 3);
        const tex = Mo.repeated(Mo.shelfTex(zone.shelf, zone.tint, variant), `shelf|${zone.shelf}|${variant}`, L / 4, 1);
        const grey = M('#9aa3ab');
        const mats = [grey, grey, M('#8e979f'), grey, grey, grey];
        mats[side < 0 ? 0 : 1] = texMat(tex);
        mesh(GEO.box, mats, g, side * (RW + 0.7), SH / 2, zc, 1.4, SH, L);
        // 天板の上のストック段ボール
        for (let z = Math.ceil(za / 8) * 8; z < zb; z += 8) {
          if (hash(z, side, 77) < 0.4) inst.add(GEO.box, '#c9965c', side * (RW + 0.6), SH + 0.25, -(z + 2), 1.0, 0.5, 1.2);
        }
      }
      // コーナー看板
      for (let z = Math.ceil((za - 30) / 140) * 140 + 30; z < zb; z += 140) {
        if (z < za) continue;
        const sign = new T.Mesh(GEO.plane, new T.MeshBasicMaterial({ map: Mo.textTex(zone.name, zone.tint, '#ffffff', 512, 128) }));
        sign.position.set(0, 5.6, -z);
        sign.scale.set(3.6, 0.9, 1);
        g.add(sign);
        for (const s of [-1, 1]) cyl(g, 0.02, CEIL - 6.05, s * 1.4, (CEIL + 6.05) / 2, -z, '#8e979f');
      }
      return;
    }

    const sky = SKIES[skyFor(stage, G_night)];
    const night = !!sky.lights;
    if (zone.type === 'shotengai') return buildShotengai(g, inst, zone, za, zb, RW, night);
    if (zone.type === 'avenue') return buildAvenue(g, inst, stage, zone, za, zb, RW, sky);
    if (zone.type === 'bridge') return buildBridge(g, inst, za, zb, RW, sky);
    return buildExpressway(g, inst, stage, zone, za, zb, RW, sky);
  }

  // ---------- 東京の景色 ----------
  // 店先（商店街）。4軒ぶん（24m）の絵を1枚にして繰り返す
  const SHOPS = [
    ['八百屋', '#3c8d5a', '#7bc043'],
    ['魚屋', '#2b6fa8', '#9fd3f0'],
    ['精肉店', '#a33b3b', '#f19a9a'],
    ['惣菜', '#d97b2b', '#ffd166'],
    ['豆腐', '#4a5a6a', '#f4f1ea'],
    ['薬局', '#2e8bc0', '#ffffff'],
    ['本屋', '#6b4f3a', '#f2e6d9'],
    ['喫茶', '#5a3b2a', '#f5d08a'],
    ['和菓子', '#8a5a9e', '#fde0e3'],
    ['花屋', '#d9537f', '#fbd3e0'],
    ['電器店', '#3d6fa8', '#d9ecf7'],
    ['たい焼き', '#c0392b', '#ffe8a3'],
  ];
  function shopStripTex(variant, night) {
    return Mo.canvasTex(`shops|${variant}|${night}`, 1024, 160, (g, W, H) => {
      const r = Mo.rng(variant * 131 + 7);
      for (let k = 0; k < 4; k++) {
        const x0 = (k * W) / 4;
        const w = W / 4;
        const [name, col, goods] = SHOPS[Math.floor(r() * SHOPS.length)];
        g.fillStyle = '#d9d2c4';
        g.fillRect(x0, 0, w, H);
        // 中（夜は明るく）
        g.fillStyle = night ? '#ffe9b0' : '#4a4038';
        g.fillRect(x0 + 8, 50, w - 16, H - 50);
        // 商品の台
        g.fillStyle = '#8a6a4a';
        g.fillRect(x0 + 14, H - 40, w - 28, 40);
        for (let i = 0; i < 9; i++) {
          g.fillStyle = i % 3 === 0 ? goods : Mo.shade(goods, -0.15 * (i % 2));
          g.beginPath();
          g.arc(x0 + 26 + i * ((w - 52) / 8), H - 44, 9, 0, Math.PI * 2);
          g.fill();
        }
        // 日よけ（ストライプ）
        for (let i = 0; i < 8; i++) {
          g.fillStyle = i % 2 ? '#ffffff' : col;
          g.fillRect(x0 + (i * w) / 8, 30, w / 8 + 1, 22);
        }
        // 看板
        g.fillStyle = col;
        g.fillRect(x0, 0, w, 30);
        g.fillStyle = '#ffffff';
        g.font = '900 24px "M PLUS Rounded 1c","Hiragino Sans",sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(name, x0 + w / 2, 16);
        g.fillStyle = '#6b6258';
        g.fillRect(x0 + w - 4, 0, 4, H);
      }
    });
  }
  function windowsTex(kind, night) {
    return Mo.canvasTex(`win|${kind}|${night}`, 128, 128, (g, W, H) => {
      const r = Mo.rng(kind.length * 17 + (night ? 3 : 0));
      const base = { office: '#c7d0d8', apart: '#efe6d8', brick: '#b98a6a', upper: '#e8dccb' }[kind];
      g.fillStyle = night ? Mo.shade(base, -0.75) : base;
      g.fillRect(0, 0, W, H);
      const cols = kind === 'office' ? 4 : 3;
      const rows = 3;
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const lit = night && r() < 0.55;
          g.fillStyle = lit ? (r() < 0.5 ? '#ffd98a' : '#fff2c8') : night ? '#1c2440' : kind === 'office' ? '#7fa6c4' : '#8fb3c9';
          const cw = W / cols;
          const ch = H / rows;
          g.fillRect(i * cw + cw * 0.15, j * ch + ch * 0.2, cw * 0.7, ch * 0.55);
          if (kind === 'apart' && !night) {
            g.fillStyle = '#d6cbb8';
            g.fillRect(i * cw, j * ch + ch * 0.82, cw, ch * 0.12);
          }
        }
    });
  }
  function facadeMat(kind, night, rx, ry) {
    const base = windowsTex(kind, night);
    return texMat(Mo.repeated(base, `win|${kind}|${night}`, Math.max(1, Math.round(rx)), Math.max(1, Math.round(ry))));
  }
  function pavingTex() {
    return Mo.canvasTex('paving', 128, 128, (g, W, H) => {
      g.fillStyle = '#cfc6b6';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#c2b8a6';
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if ((i + j) % 2) g.fillRect(i * 32, j * 32, 32, 32);
      g.fillStyle = 'rgba(120,110,95,0.4)';
      for (let k = 0; k <= 4; k++) {
        g.fillRect(0, k * 32, W, 1);
        g.fillRect(k * 32, 0, 1, H);
      }
    });
  }

  // 商店街のアーケード
  function buildShotengai(g, inst, zone, za, zb, RW, night) {
    const L = zb - za;
    const zc = -(za + zb) / 2;
    const ROOF = 7.2;
    plane(g, -RW - 1.5, RW + 1.5, 0, za, zb, texMat(Mo.repeated(pavingTex(), 'paving', RW + 0.75, L / 2)));
    for (const side of [-1, 1]) {
      const variant = Math.floor(hash(Math.floor(za / CHUNK), side + 7, 2) * 4);
      const shop = texMat(Mo.repeated(shopStripTex(variant, night), `shops|${variant}|${night}`, L / 24, 1));
      const wall = M('#b8ad9c');
      const mats = [wall, wall, wall, wall, wall, wall];
      mats[side < 0 ? 0 : 1] = shop;
      mesh(GEO.box, mats, g, side * (RW + 1.5 + 2), 1.85, zc, 4, 3.7, L);
      // 2階（住まい）
      const up = facadeMat('upper', night, L / 6, 1);
      const umats = [wall, wall, M('#8a7a6a'), wall, wall, wall];
      umats[side < 0 ? 0 : 1] = up;
      mesh(GEO.box, umats, g, side * (RW + 1.5 + 2.4), 3.7 + 1.6, zc, 4, 3.2, L);
    }
    // アーケードの屋根と骨組み、ちょうちん
    const roof = plane(g, -RW - 1.6, RW + 1.6, ROOF, za, zb, MB(night ? '#3a3f55' : '#f3efe4', { transparent: true, opacity: night ? 0.95 : 0.75, side: T.DoubleSide }));
    roof.renderOrder = 3;
    for (let z = Math.ceil(za / 6) * 6; z < zb; z += 6) {
      inst.add(GEO.box, '#8e979f', 0, ROOF - 0.1, -z, (RW + 1.6) * 2, 0.18, 0.18);
      for (const s of [-1, 1]) inst.add(GEO.box, '#8e979f', s * (RW + 1.5), (ROOF + 3.7) / 2, -z, 0.16, ROOF - 3.7, 0.16);
      const s = (z / 6) % 2 ? 1 : -1;
      inst.add(GEO.sphereLow, night ? '#ff6a4a' : '#e8483a', s * (RW - 0.2), 5.2, -z, 0.32, 0.42, 0.32, 0, night);
      inst.add(GEO.cylLow, '#2b2d42', s * (RW - 0.2), 5.7, -z, 0.02, 1.0, 0.02);
    }
  }

  function buildBuildings(g, inst, za, zb, RW, sky, setback) {
    const night = !!sky.lights;
    for (const side of [-1, 1]) {
      let z = za;
      while (z < zb) {
        const r = hash(Math.floor(z), side + 11, 3);
        const len = Math.min(zb - z, 10 + Math.floor(r * 3) * 4);
        const hgt = 9 + Math.floor(hash(Math.floor(z), side, 5) * 8) * 4;
        const kind = ['office', 'apart', 'brick', 'office'][Math.floor(hash(Math.floor(z), side, 6) * 4)];
        const depth = 12;
        const mat = facadeMat(kind, night, len / 4, hgt / 4);
        mesh(GEO.box, mat, g, side * (RW + setback + depth / 2), hgt / 2, -(z + len / 2), depth, hgt, len - 0.6);
        z += len;
      }
    }
  }

  // 大通り（江戸通り・清澄通りなど）
  function buildAvenue(g, inst, stage, zone, za, zb, RW, sky) {
    const L = zb - za;
    const zc = -(za + zb) / 2;
    plane(g, -RW, RW, 0, za, zb, texMat(Mo.repeated(Mo.roadTex('avenue'), 'road-avenue', 1, L / 8)));
    for (const s of [-1, 1]) {
      box(g, 3.2, 0.15, L, s * (RW + 1.6), 0.075, zc, '#cfc8bb');
      box(g, 0.2, 0.18, L, s * (RW + 0.1), 0.09, zc, '#a9a294');
    }
    buildBuildings(g, inst, za, zb, RW, sky, 3.4);
    const night = !!sky.lights;
    for (let z = Math.ceil(za / 12) * 12; z < zb; z += 12) {
      for (const s of [-1, 1]) {
        // イチョウ並木
        const x = s * (RW + 2.0);
        inst.add(GEO.cylLow, '#6b4f3a', x, 0.9, -z, 0.14, 1.8, 0.14);
        inst.add(GEO.cone, night ? '#2f4a2a' : '#a6c94a', x, 3.1, -z, 1.1, 3.0, 1.1);
      }
    }
    for (let z = Math.ceil(za / 24) * 24 + 6; z < zb; z += 24) {
      for (const s of [-1, 1]) {
        const x = s * (RW + 0.6);
        inst.add(GEO.cylLow, '#7d8790', x, 3.2, -z, 0.08, 6.4, 0.08);
        inst.add(GEO.box, '#7d8790', x - s * 0.8, 6.4, -z, 1.6, 0.08, 0.08);
        inst.add(GEO.box, night ? '#ffe6a0' : '#fff6c2', x - s * 1.5, 6.3, -z, 0.5, 0.12, 0.3, 0, true);
      }
    }
    // 交差点（横断歩道と信号）
    for (let z = Math.ceil(za / 160) * 160 + 80; z < zb; z += 160) {
      const cw = plane(g, -RW, RW, 0.01, z, z + 4, texMat(crosswalkTex(), { transparent: true, depthWrite: false }));
      cw.renderOrder = 1;
      for (const s of [-1, 1]) {
        const x = s * (RW + 0.8);
        inst.add(GEO.cylLow, '#7d8790', x, 2.8, -(z - 2), 0.1, 5.6, 0.1);
        inst.add(GEO.box, '#7d8790', x - s * 2.2, 5.5, -(z - 2), 4.4, 0.1, 0.1);
        inst.add(GEO.box, '#3a3f45', x - s * 3.6, 5.5, -(z - 2), 1.2, 0.4, 0.3);
        inst.add(GEO.sphereLow, '#2ee07a', x - s * 4.0, 5.5, -(z - 2) + 0.16, 0.12, 0.12, 0.05, 0, true);
      }
    }
  }
  function crosswalkTex() {
    return Mo.canvasTex('crosswalk', 256, 32, (g, W, H) => {
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 10; i++) g.fillRect(i * 26 + 6, 0, 14, H);
    });
  }

  // 隅田川の橋（アーチ橋）
  function buildBridge(g, inst, za, zb, RW, sky) {
    const L = zb - za;
    const zc = -(za + zb) / 2;
    plane(g, -RW, RW, 0, za, zb, texMat(Mo.repeated(Mo.roadTex('avenue'), 'road-avenue', 1, L / 8)));
    plane(g, -400, 400, -9, za, zb, M(sky.water));
    const steel = sky.lights ? '#3f78c8' : '#5fa8d3';
    for (const s of [-1, 1]) {
      box(g, 1.4, 0.3, L, s * (RW + 0.7), 0.15, zc, '#bfc4c8');
      box(g, 0.1, 1.0, L, s * (RW + 1.35), 0.8, zc, steel);
      // アーチ（120m ごと）。区間の中の部分だけ作る
      const span = 120;
      for (let z = Math.ceil(za / 3) * 3; z < zb; z += 3) {
        const u = (((z - 3400) % span) + span) % span; // 0..span
        const k = u / span;
        const y = 1 + 15 * 4 * k * (1 - k);
        const y2 = 1 + 15 * 4 * ((u + 3) / span) * (1 - (u + 3) / span);
        const ang = Math.atan2(y2 - y, 3);
        inst.add(GEO.box, steel, s * (RW + 1.4), (y + y2) / 2, -(z + 1.5), 0.6, 0.6, 3.15, 0, false, -ang);
        if (Math.round(u) % 9 === 0) inst.add(GEO.box, steel, s * (RW + 1.4), y / 2, -z, 0.12, y, 0.12);
      }
    }
  }

  // 首都高（高架）。湾岸では下が海
  function buildExpressway(g, inst, stage, zone, za, zb, RW, sky) {
    const L = zb - za;
    const zc = -(za + zb) / 2;
    const night = !!sky.lights;
    plane(g, -RW - 1.2, RW + 1.2, -0.01, za, zb, M('#6f747b'));
    plane(g, -RW, RW, 0, za, zb, texMat(Mo.repeated(Mo.roadTex('highway'), 'road-highway', 1, L / 8)));
    // 下の景色（海 or 街）
    plane(g, -500, 500, -14, za, zb, M(zone.bay ? sky.water : night ? '#141826' : '#8a8f86'));
    for (const s of [-1, 1]) {
      box(g, 0.35, 1.1, L, s * (RW + 1.4), 0.55, zc, '#c9ccd0');
      box(g, 1.2, 1.2, L, s * (RW + 0.6), -0.6, zc, '#b0b4b8');
      // 防音壁（ところどころ）
      if (hash(Math.floor(za / 60), s, 9) < 0.55) {
        const wall = box(g, 0.08, 2.8, L, s * (RW + 1.45), 2.5, zc, MB(night ? '#2a3a55' : '#a8c4d4', { transparent: true, opacity: 0.4, depthWrite: false }));
        wall.renderOrder = 3;
      }
      for (let z = Math.ceil(za / 30) * 30; z < zb; z += 30) {
        const lx = s * (RW + 1.4);
        inst.add(GEO.cylLow, '#9aa1a8', lx, 3.6, -z, 0.08, 6, 0.08);
        inst.add(GEO.box, '#9aa1a8', lx - s * 0.7, 6.6, -z, 1.4, 0.08, 0.08);
        inst.add(GEO.box, night ? '#ffb347' : '#fff6c2', lx - s * 1.35, 6.5, -z, 0.5, 0.12, 0.3, 0, true);
      }
      // 橋脚
      for (let z = Math.ceil(za / 40) * 40; z < zb; z += 40) inst.add(GEO.box, '#a9adb1', 0, -7.5, -z, 2.4, 13, 2.4);
    }
    // 周りのビル群 / 湾岸のクレーン
    for (let z = Math.ceil(za / 20) * 20; z < zb; z += 20) {
      for (const s of [-1, 1]) {
        const r = hash(z, s, 21);
        if (zone.bay) {
          if (r < 0.12) crane(inst, s * (70 + r * 300), -z, night);
        } else if (r < 0.7) {
          const h = 6 + r * 40;
          const x = s * (RW + 14 + r * 40);
          inst.add(GEO.box, night ? '#1d2238' : ['#c9ced3', '#b9c2c9', '#d8d0c4'][Math.floor(r * 30) % 3], x, -14 + h / 2, -z, 12, h, 14);
          if (night) for (let k = 0; k < 4; k++) inst.add(GEO.box, '#ffd98a', x - s * 6.05, -12 + k * (h / 4), -z + (k % 2 ? 3 : -3), 0.05, 0.8, 2.5, 0, true);
        }
      }
    }
    // 案内標識（門型）
    for (let z = Math.ceil((za - 250) / 500) * 500 + 250; z < zb; z += 500) {
      if (z < za) continue;
      const next = nextCpName(stage, z);
      const km = Math.max(1, Math.round(next.dist / 250));
      for (const s of [-1, 1]) inst.add(GEO.box, '#8d949b', s * (RW + 1.2), 3.6, -z, 0.25, 7.2, 0.25);
      inst.add(GEO.box, '#8d949b', 0, 7.0, -z, (RW + 1.2) * 2, 0.3, 0.3);
      const sign = new T.Mesh(GEO.plane, new T.MeshBasicMaterial({ map: Mo.textTex(`${next.name}  ${km}km`, '#1f7a4d', '#ffffff', 768, 160, { border: '#ffffff' }) }));
      sign.position.set(RW * 0.4, 7.9, -z + 0.2);
      sign.scale.set(5.6, 1.2, 1);
      g.add(sign);
    }
  }
  function crane(inst, x, z, night) {
    const c = night ? '#7a2f2f' : '#d9534f';
    for (const dx of [-3, 3]) for (const dz of [-3, 3]) inst.add(GEO.box, c, x + dx, 6, z + dz, 0.6, 40, 0.6);
    inst.add(GEO.box, c, x, 26, z, 8, 1.2, 8);
    inst.add(GEO.box, c, x - Math.sign(x) * 18, 30, z, 50, 1.2, 1.2);
    inst.add(GEO.box, '#ffffff', x, 24, z, 4, 3, 4);
  }
  function nextCpName(stage, z) {
    for (let i = 0; i < stage.checkpoints.length; i++) if (stage.checkpoints[i] > z) return { name: stage.cpNames[i], dist: stage.checkpoints[i] - z };
    return { name: stage.goalLabel, dist: stage.length - z };
  }

  function tree(inst, x, z, s) {
    inst.add(GEO.cylLow, '#8a5a3c', x, 0.7 * s, z, 0.14 * s, 1.4 * s, 0.14 * s);
    inst.add(GEO.ico, '#4f9e4a', x, 2.0 * s, z, 0.95 * s, 0.85 * s, 0.95 * s);
    inst.add(GEO.ico, '#62b25b', x + 0.35 * s, 2.5 * s, z + 0.2, 0.6 * s, 0.55 * s, 0.6 * s);
  }

  function buildChunk(stage, c) {
    const g = new T.Group();
    const inst = Instancer();
    const za = c * CHUNK;
    const zb = za + CHUNK;
    let z = za;
    while (z < zb) {
      const zone = zoneAt(stage, z);
      const end = Math.min(zb, zone.to);
      buildRange(g, inst, stage, zone, z, end);
      z = end;
    }
    inst.build(g);
    return g;
  }
  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
  }
  function updateChunks(stage, P) {
    const first = Math.floor((P.z - CAM.back - 10) / CHUNK);
    const last = Math.floor((P.z + DRAW) / CHUNK);
    for (let c = Math.max(-1, first); c <= last; c++) {
      if (!chunks.has(c)) {
        const g = buildChunk(stage, c);
        chunks.set(c, g);
        scene.add(g);
      }
    }
    for (const [c, g] of chunks) {
      if (c < first - 1 || c > last + 1) {
        scene.remove(g);
        disposeGroup(g);
        chunks.delete(c);
      }
    }
  }

  // ---------- ステージ単位の物（ゲート・ゴール） ----------
  function rebuildStage(G) {
    for (const [, g] of chunks) {
      scene.remove(g);
      disposeGroup(g);
    }
    chunks.clear();
    for (const [, m] of live) scene.remove(m);
    live.clear();
    for (const o of stageObjs) scene.remove(o);
    stageObjs = [];
    gates = [];
    skyKey = '';
    const st = G.stage;
    const rw = (z) => THEMES[zoneAt(st, z).type].roadW;
    st.checkpoints.forEach((cz, k) => {
      const g = Mo.buildGate(Math.max(rw(cz - 0.5), rw(cz + 0.5)), `CHECKPOINT  ${st.cpNames[k]}`, false);
      g.position.z = -cz;
      gates.push(g);
      stageObjs.push(g);
    });
    const goal = Mo.buildGate(rw(st.length), `GOAL  ${st.goalLabel}`, true);
    goal.position.z = -st.length;
    stageObjs.push(goal);
    let scenery;
    if (st.goalScene === 'registers') {
      scenery = Mo.buildRegisters();
      scenery.position.z = -(st.length + 40);
    } else if (st.goalScene === 'store') {
      scenery = Mo.buildStore();
      scenery.position.z = -(st.length + 70);
    } else {
      scenery = Mo.buildHouseBig(st.goalLabel);
      scenery.position.z = -(st.length + 70);
    }
    stageObjs.push(scenery);
    for (const o of stageObjs) scene.add(o);
  }

  // ---------- 動く物（障害物・アイテム・ジャンプ台） ----------
  function build(o) {
    switch (o.kind) {
      case 'shopper':
        return Mo.buildPerson(o);
      case 'cart': {
        const g = Mo.buildStrayCart();
        g.rotation.y = (o.seed - 0.5) * 0.8;
        return g;
      }
      case 'display':
        return Mo.buildDisplay();
      case 'boxes':
        return Mo.buildBoxes();
      case 'wetsign':
        return Mo.buildWetSign();
      case 'car':
        return Mo.buildCar(o);
      case 'truck':
        return Mo.buildTruck(o);
      case 'bus':
        return Mo.buildBus(o);
      case 'kanban':
        return Mo.buildKanban(o);
      case 'bar':
        return Mo.buildBar(o);
      case 'noren':
        return Mo.buildNoren(o, false);
      case 'banner':
        return Mo.buildNoren(o, true);
      case 'bike':
        return Mo.buildBike(o);
      case 'cone':
        return Mo.buildCone();
      case 'barrier':
        return Mo.buildBarrier();
      case 'cat':
        return Mo.buildCat();
      case 'ramp':
        return Mo.buildRamp(o);
    }
    return new T.Group();
  }
  function syncList(list, t) {
    for (const o of list) {
      let m = live.get(o);
      if (!m) {
        m = build(o);
        live.set(o, m);
        scene.add(m);
      }
      m.userData.seen = frameId;
      animate(o, m, t);
    }
  }
  function animate(o, m, t) {
    if (o.kind === 'ramp') {
      m.position.set(o.x, 0, -o.z0);
      if (o.launched && !m.userData.used) {
        m.userData.used = true;
        Mo.markRampUsed(m);
      }
      return;
    }
    if (o.flying) {
      m.position.set(o.x, o.fy, -o.z);
      m.rotation.set(o.rx, o.ry, o.rz);
      if (o.kind === 'car' || o.kind === 'truck' || o.kind === 'bus') Mo.setBlink(m, 0, false);
      return;
    }
    m.position.set(o.x, 0, -o.z);
    if (o.kind === 'shopper' && m.userData.legs) {
      const sw = Math.sin(t * 8 + o.seed * 20) * (o.vx ? 0.6 : 0.15);
      m.userData.legs[0].rotation.x = sw;
      m.userData.legs[1].rotation.x = -sw;
    }
    if (o.kind === 'cat') m.rotation.y = o.vx < 0 ? Math.PI : 0;
    if (o.kind === 'car' || o.kind === 'truck' || o.kind === 'bus') Mo.setBlink(m, o.blinkDir, Math.floor(t * 5) % 2 === 0);
    if (o.hit) {
      const k = Math.exp(-o.wob * 3);
      m.rotation.z = Math.sin(o.wob * 22) * 0.3 * k;
    }
  }

  // ---------- プレイヤー ----------
  function updatePlayer(G, t) {
    const P = G.player;
    const p = player;
    p.root.position.set(P.x, P.y, -P.z);
    p.root.rotation.z = -P.steer * 0.12;
    p.root.rotation.y = -P.steer * 0.12;
    const grounded = P.y <= 0.001 || P.onRamp || P.onObj;
    const run = Math.sin(P.phase);
    if (P.slide > 0) {
      // スライディング: 体を低く、後ろに倒して脚を前へ
      p.legs[0].rotation.x = 1.15;
      p.legs[1].rotation.x = 1.0;
      p.body.position.y = -0.32;
      p.body.rotation.x = 0.45;
    } else {
      p.legs[0].rotation.x = grounded ? run * 0.8 : 0.7;
      p.legs[1].rotation.x = grounded ? -run * 0.8 : -0.2;
      p.body.position.y = grounded ? Math.abs(run) * 0.03 : 0;
      p.body.rotation.x = 0;
    }
    p.body.visible = camMode !== 'fp';
    p.goods.visible = camMode !== 'fp';
    // 空中の回転技
    const tr = P.trick;
    p.flip.rotation.set(0, 0, 0);
    if (P.tumble) {
      // ぶつかって転倒
      const e = clamp(P.tumble.t / P.tumble.dur, 0, 1);
      p.flip.rotation.x = -Math.PI * 2 * e;
      p.flip.rotation.z = Math.sin(e * Math.PI) * 0.8;
    } else if (tr) {
      const e = clamp(tr.t / tr.dur, 0, 1);
      const k = e * e * (3 - 2 * e);
      const a = Math.PI * 2 * tr.turns * k;
      if (tr.type === 'flip') p.flip.rotation.x = -a;
      else if (tr.type === 'roll') p.flip.rotation.z = a * tr.dir;
      else if (tr.type === 'spin') p.flip.rotation.y = a * tr.dir;
      else if (tr.type === 'cork') {
        p.flip.rotation.x = -a;
        p.flip.rotation.y = a * tr.dir;
      }
    }
    // 影は地面（坂の上ならその表面）に
    const onTop = P.onRamp || P.onObj;
    p.shadow.position.y = (onTop ? 0 : -P.y) + 0.03;
    const sc = 1 / (1 + (onTop ? 0 : P.y) * 0.25);
    p.shadow.scale.set(1.4 * sc, 2.4 * sc, 1);
    p.rig.visible = !(G.invuln > 0 && Math.floor(G.invuln * 14) % 2 === 0) && G.showPlayer !== false;
  }

  // ---------- 1フレーム ----------
  const v3 = new T.Vector3();
  function toScreen(x, y, z) {
    v3.set(x, y, -z).project(camera);
    return { x: ((v3.x + 1) / 2) * R.W, y: ((1 - v3.y) / 2) * R.H, z: v3.z };
  }

  function drawWorld(G, t) {
    frameId++;
    const P = G.player;
    const st = G.stage;
    if (builtFor !== G.runId) {
      builtFor = G.runId;
      G_night = !!G.night;
      rebuildStage(G);
    }
    applySky(st, zoneAt(st, P.z), G_night);
    updateChunks(st, P);
    gates.forEach((g, k) => {
      if (k < G.cpIndex && !g.userData.passed) {
        g.userData.passed = true;
        Mo.setGatePassed(g);
      }
    });
    syncList(G.obstacles, t);
    syncList(G.ramps || [], t);
    for (const [o, m] of live) {
      if (m.userData.seen !== frameId) {
        scene.remove(m);
        live.delete(o);
      }
    }
    updatePlayer(G, t);

    // カメラ（加速中は画角を広げてスピード感を出す）
    const boost = G.boost > 0 ? 6 + (G.boostLevel || 1) * 4 : 0;
    const fov = baseFov + boost;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * 0.15;
      camera.updateProjectionMatrix();
    }
    const sx = R.shake > 0 ? (Math.random() - 0.5) * R.shake * 1.2 : 0;
    const sy = R.shake > 0 ? (Math.random() - 0.5) * R.shake * 0.8 : 0;
    if (camMode === 'fp') {
      // 一人称: 主婦の目の高さ。回転技では画面を回さない（酔いにくくするため）
      const eye = P.slide > 0 ? 0.9 : 1.45;
      camera.position.set(P.x + sx * 0.5, P.y + eye + sy * 0.5, -(P.z + 0.25));
      camera.lookAt(P.x + P.steer * 0.8, P.y + eye - 0.35, -(P.z + 30));
    } else {
      camera.position.set(R.camX + sx, CAM.h + R.lift + sy, -(P.z - CAM.back));
      camera.lookAt(R.camX * 0.9, CAM.lookY + R.lift * 0.85, -(P.z + CAM.ahead));
    }
    if (backdrop) backdrop.position.set(camera.position.x * 0.6, 0, camera.position.z);

    renderer.render(scene, camera);
    if (R.wantShot) {
      R.wantShot = false;
      try {
        R.shot = renderer.domElement.toDataURL('image/jpeg', 0.85);
      } catch (e) {
        R.shot = null;
      }
    }
  }
  // 結果画像用に、次に描いた画面を写真として残す
  function requestSnapshot() {
    R.wantShot = true;
  }
  function getSnapshot() {
    return R.shot || null;
  }

  // スピード線（2Dの重ね描き）
  function drawOverlay(ctx, G, t) {
    const P = G.player;
    const th = THEMES[zoneAt(G.stage, P.z).type];
    const sp = P.speed / th.maxSpeed;
    if (!(sp > 0.8 || G.boost > 0 || G.sale > 0) || G.state === 'menu') return;
    const vp = toScreen(R.camX, 0.5, P.z + 300);
    const boosting = G.boost > 0 || G.sale > 0;
    const lv = G.boostLevel || 0;
    const n = boosting ? 22 + lv * 10 : 14;
    ctx.strokeStyle = G.sale > 0 ? `hsla(${(t * 400) % 360},100%,70%,0.8)` : boosting ? 'rgba(255,230,150,0.7)' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = boosting ? 3 : 2;
    ctx.beginPath();
    const fr = Math.floor(t * 24);
    for (let k = 0; k < n; k++) {
      const ang = hash(k, fr, 3) * Math.PI * 2;
      const r0 = R.H * (0.28 + hash(k, fr, 4) * 0.3);
      const len = boosting ? 90 + lv * 45 : 60;
      ctx.moveTo(vp.x + Math.cos(ang) * r0 * 0.7, vp.y + Math.sin(ang) * r0);
      ctx.lineTo(vp.x + Math.cos(ang) * (r0 + len) * 0.7, vp.y + Math.sin(ang) * (r0 + len));
    }
    ctx.stroke();
  }

  function playerScreen(P) {
    return toScreen(P.x, 1.0 + P.y, P.z);
  }

  window.CartRender = {
    DRAW,
    CAM_BACK,
    init,
    setView,
    setCameraMode,
    requestSnapshot,
    getSnapshot,
    setCamera,
    setShake,
    drawWorld,
    drawOverlay,
    playerScreen,
    zoneAt,
    view: R,
    // 開発用: 描画負荷の確認
    stats: () => Object.assign({}, renderer.info.render, { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
  };
})();
