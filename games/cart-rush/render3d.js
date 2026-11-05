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
  const CAM = { back: 4.6, h: 4.3, ahead: 20, lookY: -3.6, hfov: 62 };

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
    const tanH = Math.tan((CAM.hfov * Math.PI) / 360);
    baseFov = clamp((Math.atan(tanH / camera.aspect) * 360) / Math.PI, 50, 100);
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
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
    day: { top: '#6fbff0', fog: '#dff1fb', mount: '#a9c9de', hill: '#9fd08b', grass: ['#8fd16a', '#84c55f'], hemi: '#ffffff', sun: null },
    evening: { top: '#4a3a78', fog: '#ffc18a', mount: '#8a6a9a', hill: '#9a7280', grass: ['#8f8a5a', '#857f52'], hemi: '#ffd8b8', sun: '#ffdf8a' },
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
  function buildBackdrop(sky) {
    const g = new T.Group();
    const range = (color, y0, amp, seed, dist, width) => {
      const sh = new T.Shape();
      sh.moveTo(-width / 2, -5);
      for (let i = 0; i <= 60; i++) {
        const x = -width / 2 + (width * i) / 60;
        const k = i * 0.37 + seed;
        sh.lineTo(x, y0 + (Math.sin(k) * 0.5 + Math.sin(k * 2.3 + 1) * 0.3 + 0.8) * amp);
      }
      sh.lineTo(width / 2, -5);
      const m = new T.Mesh(new T.ShapeGeometry(sh), new T.MeshBasicMaterial({ color: color, fog: false }));
      m.position.z = -dist;
      g.add(m);
    };
    range(sky.mount, 0, 70, 1.3, 620, 2600);
    range(sky.hill, -2, 26, 4.1, 560, 2400);
    if (sky.sun) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: Mo.glowTex, color: sky.sun, fog: false, transparent: true, depthWrite: false }));
      s.scale.set(180, 180, 1);
      s.position.set(0, 40, -640);
      g.add(s);
    }
    for (let i = 0; i < 7; i++) {
      const c = new T.Sprite(new T.SpriteMaterial({ map: Mo.glowTex, color: sky.sun ? '#ffd0c0' : '#ffffff', fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
      c.scale.set(140 + i * 20, 40 + (i % 3) * 10, 1);
      c.position.set(-500 + i * 170, 90 + (i % 2) * 40, -600);
      g.add(c);
    }
    return g;
  }

  function applySky(stage, zone) {
    const key = zone.type === 'market' ? 'market' : stage.sky || 'day';
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
      return;
    }
    const sky = SKIES[key];
    scene.background = skyTex(sky);
    scene.fog = new T.Fog(sky.fog, 90, DRAW);
    hemi.color.set(sky.hemi);
    hemi.intensity = 0.66;
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
      add(geo, color, x, y, z, sx, sy, sz, ry, basic) {
        const key = basic ? 'b' : 'l';
        let byGeo = groups.get(key);
        if (!byGeo) groups.set(key, (byGeo = new Map()));
        let arr = byGeo.get(geo);
        if (!arr) byGeo.set(geo, (arr = []));
        arr.push([color, x, y, z, sx, sy, sz, ry || 0]);
      },
      build(parent) {
        for (const [key, byGeo] of groups) for (const [geo, arr] of byGeo) {
          const im = new T.InstancedMesh(geo, key === 'b' ? instBasic : instMat, arr.length);
          arr.forEach((a, i) => {
            dummy.position.set(a[1], a[2], a[3]);
            dummy.scale.set(a[4], a[5], a[6]);
            dummy.rotation.set(0, a[7], 0);
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

    const sky = SKIES[stage.sky || 'day'];
    plane(g, -150, 150, -0.02, za, zb, texMat(Mo.repeated(Mo.stripeTex('grass|' + sky.grass[0], sky.grass[0], sky.grass[1]), 'grass|' + sky.grass[0], 1, L / 8)));
    if (zone.type === 'street') {
      for (const s of [-1, 1]) {
        box(g, 1.6, 0.12, L, s * (RW + 0.8 + 0.18), 0.06, zc, '#d8d4cb');
        box(g, 0.18, 0.16, L, s * (RW + 0.09), 0.08, zc, '#b8b3a8');
      }
      plane(g, -RW, RW, 0, za, zb, texMat(Mo.repeated(Mo.roadTex('street'), 'road-street', 1, L / 8)));
      for (let z = Math.ceil(za / 9) * 9; z < zb; z += 9) {
        for (const s of [-1, 1]) {
          const r = hash(z, s + 5, 1);
          if (r < 0.6) {
            const k = Math.floor(r * 8.3) % HOUSE_COLORS.length;
            const x = s * (RW + 5.6 + r * 2);
            inst.add(GEO.box, HOUSE_COLORS[k], x, 1.2, -z, 3.6, 2.4, 3.4);
            inst.add(GEO.prism, ROOF_COLORS[k], x, 2.4, -z, 4.0, 2.6, 3.8);
            inst.add(GEO.box, '#8a5a3c', x - s * 0.0 + 0.8, 0.8, -z + 1.71, 0.8, 1.6, 0.05);
            inst.add(GEO.box, '#9fd3f0', x - 0.9, 1.5, -z + 1.71, 1.0, 0.8, 0.05);
          } else {
            const x = s * (RW + 3.2 + r * 2);
            tree(inst, x, -z, 0.9 + r * 0.4);
          }
        }
      }
      for (let z = Math.ceil(za / 25) * 25; z < zb; z += 25) {
        const s = hash(z, 9, 2) < 0.5 ? -1 : 1;
        inst.add(GEO.cylLow, '#9a9a92', s * (RW + 1.0), 3, -z, 0.1, 6, 0.1);
        inst.add(GEO.box, '#9a9a92', s * (RW + 1.0), 5.5, -z, 1.4, 0.1, 0.1);
      }
      return;
    }

    // 高速道路
    plane(g, -RW - 1.4, RW + 1.4, -0.01, za, zb, M('#6f747b'));
    plane(g, -RW, RW, 0, za, zb, texMat(Mo.repeated(Mo.roadTex('highway'), 'road-highway', 1, L / 8)));
    const evening = stage.sky === 'evening';
    for (const s of [-1, 1]) {
      const x = s * (RW + 1.1);
      box(g, 0.12, 0.32, L, x, 0.64, zc, '#d7dde3');
      for (let z = Math.ceil(za / 4) * 4; z < zb; z += 4) inst.add(GEO.cylLow, '#8d949b', x, 0.3, -z, 0.06, 0.6, 0.06);
      for (let z = Math.ceil(za / 30) * 30; z < zb; z += 30) {
        const lx = s * (RW + 1.8);
        inst.add(GEO.cylLow, '#9aa1a8', lx, 2.9, -z, 0.08, 5.8, 0.08);
        inst.add(GEO.box, '#9aa1a8', lx - s * 0.7, 5.8, -z, 1.4, 0.08, 0.08);
        inst.add(GEO.box, evening ? '#ffe6a0' : '#fff6c2', lx - s * 1.35, 5.72, -z, 0.5, 0.12, 0.3, 0, true);
      }
      for (let z = Math.ceil(za / 12) * 12; z < zb; z += 12) {
        const r = hash(z, s + 3, 4);
        if (r < 0.55) tree(inst, s * (RW + 5 + r * 14), -z, 0.9 + r * 0.5);
      }
    }
    for (let z = Math.ceil((za - 200) / 400) * 400 + 200; z < zb; z += 400) {
      if (z < za) continue;
      const km = Math.max(1, Math.round((stage.length - z) / 250));
      const label = `${stage.goalLabel}まで ${km}km`;
      const x = RW + 3.2;
      for (const d of [-1.3, 1.3]) inst.add(GEO.cylLow, '#8d949b', x + d, 2.4, -z, 0.1, 4.8, 0.1);
      const sign = new T.Mesh(GEO.plane, new T.MeshBasicMaterial({ map: Mo.textTex(label, '#1f7a4d', '#ffffff', 512, 192, { border: '#ffffff' }) }));
      sign.position.set(x, 5.2, -z);
      sign.scale.set(3.8, 1.42, 1);
      g.add(sign);
    }
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
    st.checkpoints.forEach((cz) => {
      const g = Mo.buildGate(Math.max(rw(cz - 0.5), rw(cz + 0.5)), 'CHECKPOINT', false);
      g.position.z = -cz;
      gates.push(g);
      stageObjs.push(g);
    });
    const goal = Mo.buildGate(rw(st.length), `GOAL ${st.goalLabel}`, true);
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
      scenery = Mo.buildHouseBig('わが家');
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
      case 'bike':
        return Mo.buildBike(o);
      case 'cone':
        return Mo.buildCone();
      case 'barrier':
        return Mo.buildBarrier();
      case 'cat':
        return Mo.buildCat();
      case 'item':
        return Mo.buildItem(o.icon);
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
    m.position.set(o.x, 0, -o.z);
    if (o.kind === 'item') {
      m.visible = !o.taken;
      const sp = m.userData.spin;
      sp.rotation.y = t * 3 + o.z;
      sp.position.y = 0.75 + Math.sin(t * 4 + o.z) * 0.1;
      return;
    }
    if (o.kind === 'shopper' && m.userData.legs) {
      const sw = Math.sin(t * 8 + o.seed * 20) * (o.vx ? 0.6 : 0.15);
      m.userData.legs[0].rotation.x = sw;
      m.userData.legs[1].rotation.x = -sw;
    }
    if (o.kind === 'cat') m.rotation.y = o.vx < 0 ? Math.PI : 0;
    if (o.kind === 'car' || o.kind === 'truck') Mo.setBlink(m, o.blinkDir, Math.floor(t * 5) % 2 === 0);
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
    const grounded = P.y <= 0.001 || P.onRamp;
    const run = Math.sin(P.phase);
    p.legs[0].rotation.x = grounded ? run * 0.8 : 0.7;
    p.legs[1].rotation.x = grounded ? -run * 0.8 : -0.2;
    p.body.position.y = grounded ? Math.abs(run) * 0.03 : 0;
    // 空中の回転技
    const tr = P.trick;
    p.flip.rotation.set(0, 0, 0);
    if (tr) {
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
    p.shadow.position.y = (P.onRamp ? 0 : -P.y) + 0.03;
    const sc = 1 / (1 + (P.onRamp ? 0 : P.y) * 0.25);
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
      rebuildStage(G);
    }
    applySky(st, zoneAt(st, P.z));
    updateChunks(st, P);
    gates.forEach((g, k) => {
      if (k < G.cpIndex && !g.userData.passed) {
        g.userData.passed = true;
        Mo.setGatePassed(g);
      }
    });
    syncList(G.obstacles, t);
    syncList(G.items, t);
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
    camera.position.set(R.camX + sx, CAM.h + R.lift + sy, -(P.z - CAM.back));
    camera.lookAt(R.camX * 0.9, CAM.lookY + R.lift * 0.85, -(P.z + CAM.ahead));
    if (backdrop) backdrop.position.set(camera.position.x * 0.6, 0, camera.position.z);

    renderer.render(scene, camera);
  }

  // スピード線（2Dの重ね描き）
  function drawOverlay(ctx, G, t) {
    const P = G.player;
    const th = THEMES[zoneAt(G.stage, P.z).type];
    const sp = P.speed / th.maxSpeed;
    if (!(sp > 0.8 || G.boost > 0) || G.state === 'menu') return;
    const vp = toScreen(R.camX, 0.5, P.z + 300);
    const boosting = G.boost > 0;
    const lv = G.boostLevel || 0;
    const n = boosting ? 22 + lv * 10 : 14;
    ctx.strokeStyle = boosting ? 'rgba(255,230,150,0.7)' : 'rgba(255,255,255,0.45)';
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
