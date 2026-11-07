// ウインナー焼き ― フライパン・コンロ・ウインナーの3D（Three.js）
// 単位は cm。フライパンの中心が原点、y が上
(function () {
  'use strict';
  const T = window.THREE;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  const LEN = 11.5; // ウインナーの長さ（細めで長い、粗挽きタイプ）
  const RAD = 0.98; // 太さ（半径）
  const BINS = 12; // 焼き色を記録する周方向の区切り

  let renderer;
  let scene;
  let camera;
  let sausage;
  let sGeo;
  let sMat;
  let water;
  let oil;
  let flames = [];
  let bubbles = [];
  let steam = [];
  let juice = [];
  let shake = 0;

  function canvasTex(w, h, draw, rep) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    if (rep) t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  }
  function noise(g, w, h, amt) {
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * amt;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }

  function init(canvas) {
    renderer = new T.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene();
    scene.background = new T.Color('#2a2622');
    camera = new T.PerspectiveCamera(38, 0.5, 1, 500);

    // 映り込み（キッチンの照明）
    const pm = new T.PMREMGenerator(renderer);
    const env = new T.Scene();
    env.add(new T.Mesh(new T.BoxGeometry(100, 100, 100), new T.MeshBasicMaterial({ color: '#4a4440', side: T.BackSide })));
    const lamp = new T.Mesh(new T.PlaneGeometry(40, 12), new T.MeshBasicMaterial({ color: '#fff4e0', side: T.DoubleSide }));
    lamp.position.set(0, 45, -10);
    lamp.lookAt(0, 0, 0);
    env.add(lamp);
    const win = new T.Mesh(new T.PlaneGeometry(30, 30), new T.MeshBasicMaterial({ color: '#cfe0f0', side: T.DoubleSide }));
    win.position.set(-45, 20, 10);
    win.lookAt(0, 0, 0);
    env.add(win);
    scene.environment = pm.fromScene(env, 0.04).texture;

    scene.add(new T.HemisphereLight('#fff1dc', '#3a302a', 0.45));
    const key = new T.SpotLight('#fff0d8', 1.25, 300, 0.6, 0.5, 1);
    key.position.set(-25, 70, 30);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.03;
    scene.add(key);

    // キッチンの天板（タイル）とコンロ
    const counter = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#d8d3cb';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#b9b2a7';
      g.lineWidth = 4;
      for (let i = 0; i <= w; i += 128) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, h);
        g.stroke();
        g.beginPath();
        g.moveTo(0, i);
        g.lineTo(w, i);
        g.stroke();
      }
      noise(g, w, h, 18);
    }, true);
    counter.repeat.set(3, 3);
    const top = new T.Mesh(new T.PlaneGeometry(160, 160), new T.MeshStandardMaterial({ map: counter, roughness: 0.6 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = -6;
    top.receiveShadow = true;
    scene.add(top);
    const stove = new T.Mesh(new T.BoxGeometry(46, 2, 46), new T.MeshStandardMaterial({ color: '#1b1b1d', metalness: 0.5, roughness: 0.4 }));
    stove.position.y = -5;
    stove.receiveShadow = true;
    scene.add(stove);
    // 五徳
    const grate = new T.MeshStandardMaterial({ color: '#2b2b2b', metalness: 0.6, roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const b = new T.Mesh(new T.BoxGeometry(14, 1.2, 1.4), grate);
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.position.set(Math.cos(a) * 9, -3.6, Math.sin(a) * 9);
      b.rotation.y = -a;
      scene.add(b);
    }
    // 炎（青い炎の輪）
    const flameM = new T.MeshBasicMaterial({ color: '#4aa8ff', transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 18; i++) {
      const f = new T.Mesh(new T.ConeGeometry(0.45, 2.2, 6), flameM);
      const a = (i / 18) * Math.PI * 2;
      f.position.set(Math.cos(a) * 5, -3.5, Math.sin(a) * 5);
      f.rotation.z = Math.cos(a) * -0.5;
      f.rotation.x = Math.sin(a) * 0.5;
      scene.add(f);
      flames.push(f);
    }
    const glow = new T.PointLight('#5aa8ff', 0, 30);
    glow.position.set(0, -2, 0);
    scene.add(glow);
    flames.glow = glow;

    // フライパン
    const panM = new T.MeshStandardMaterial({ color: '#141416', metalness: 0.15, roughness: 0.62, envMapIntensity: 0.12 });
    const pts = [];
    pts.push(new T.Vector2(0, -2.6));
    pts.push(new T.Vector2(11, -2.6));
    pts.push(new T.Vector2(12.6, -2.2));
    pts.push(new T.Vector2(14, 1.4));
    pts.push(new T.Vector2(14.5, 1.6));
    pts.push(new T.Vector2(14.3, 1.2));
    pts.push(new T.Vector2(12.9, -2.0));
    pts.push(new T.Vector2(11, -2.3));
    pts.push(new T.Vector2(0, -2.3));
    panM.side = T.DoubleSide;
    const pan = new T.Mesh(new T.LatheGeometry(pts, 64), panM);
    // フライパンの底（内側）
    const floor = new T.Mesh(new T.CircleGeometry(12.6, 64), new T.MeshStandardMaterial({ color: '#16171a', roughness: 0.55, metalness: 0.1, envMapIntensity: 0.15 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.29;
    floor.receiveShadow = true;
    scene.add(floor);
    pan.castShadow = true;
    pan.receiveShadow = true;
    scene.add(pan);
    const handle = new T.Mesh(new T.CylinderGeometry(0.9, 1.1, 18, 16), new T.MeshStandardMaterial({ color: '#3a2a20', roughness: 0.6 }));
    handle.rotation.z = Math.PI / 2;
    handle.rotation.y = -0.15;
    handle.position.set(23, 0.6, 2);
    handle.castShadow = true;
    scene.add(handle);
    // 油のツヤ
    oil = new T.Mesh(new T.CircleGeometry(11, 48), new T.MeshStandardMaterial({ color: '#2a1a08', transparent: true, opacity: 0.12, roughness: 0.2, envMapIntensity: 0.4, depthWrite: false }));
    oil.rotation.x = -Math.PI / 2;
    oil.position.y = -2.28;
    scene.add(oil);
    // 水
    water = new T.Mesh(new T.CircleGeometry(12.2, 48), new T.MeshPhysicalMaterial({ color: '#9fc3d6', transparent: true, opacity: 0.22, roughness: 0.02, clearcoat: 1, envMapIntensity: 0.5 }));
    water.rotation.x = -Math.PI / 2;
    water.visible = false;
    scene.add(water);

    // ウインナー
    makeSausage();
  }

  // ウインナーの形: 天然の羊腸に詰めた細長い粗挽き。ゆるく反っていて、両端は皮がねじれてすぼまる
  let cracks = [];
  let beads = [];
  function makeSausage() {
    const prof = [];
    const N = 64;
    const KNOT = 0.35; // 端のねじれ（小さなこぶ）の長さ
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = (t - 0.5) * LEN;
      const e = Math.min(t, 1 - t) * LEN; // 端からの距離
      let r;
      if (e < KNOT) r = 0.12 + 0.1 * Math.sin((e / KNOT) * Math.PI); // ねじれた先
      else {
        const k = (e - KNOT) / 1.1; // 端の丸み
        r = k < 1 ? 0.22 + (RAD - 0.22) * Math.sin((k * Math.PI) / 2) : RAD;
      }
      prof.push([x, r]);
    }
    const SEG = 48;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= SEG; j++) {
        const a = (j / SEG) * Math.PI * 2;
        pos.push(prof[i][0], Math.sin(a) * prof[i][1], Math.cos(a) * prof[i][1]);
        uv.push((i / N) * 2, j / SEG);
      }
    for (let i = 0; i < N; i++)
      for (let j = 0; j < SEG; j++) {
        const a = i * (SEG + 1) + j;
        const b = a + SEG + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    sGeo = new T.BufferGeometry();
    sGeo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    sGeo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    sGeo.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(pos.length), 3));
    sGeo.setIndex(idx);
    // 皮の表面の小さなでこぼこ（パンパンになると浮き出る）
    const bump = new Float32Array((N + 1) * (SEG + 1));
    for (let i = 0; i < bump.length; i++) bump[i] = Math.random();
    for (let pass = 0; pass < 3; pass++)
      for (let i = 1; i < N; i++)
        for (let j = 0; j <= SEG; j++) {
          const k = i * (SEG + 1) + j;
          bump[k] = (bump[k] * 2 + bump[k - SEG - 1] + bump[k + SEG + 1] + bump[i * (SEG + 1) + ((j + 1) % (SEG + 1))]) / 5;
        }
    sGeo.userData = { N, SEG, base: Float32Array.from(pos), prof, bump };
    // 粗挽き肉が透けて見える皮（ピンク〜サーモン色に、白い脂と赤身の粒）
    const skin = canvasTex(512, 128, (g, w, h) => {
      g.fillStyle = '#e7a593';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) {
        const fat = Math.random() < 0.45;
        g.fillStyle = fat ? `rgba(250,232,222,${0.35 + Math.random() * 0.35})` : `rgba(${170 + Math.random() * 30},${80 + Math.random() * 30},${70 + Math.random() * 20},${0.25 + Math.random() * 0.3})`;
        g.beginPath();
        g.ellipse(Math.random() * w, Math.random() * h, 1 + Math.random() * 3.5, 0.8 + Math.random() * 2, Math.random() * 3, 0, 7);
        g.fill();
      }
      // 皮のうすいしわ（長さ方向）
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.lineWidth = 1;
        g.beginPath();
        const y = Math.random() * h;
        g.moveTo(0, y);
        g.bezierCurveTo(w * 0.3, y + 3, w * 0.6, y - 3, w, y + 1);
        g.stroke();
      }
    }, true);
    sMat = new T.MeshPhysicalMaterial({ map: skin, vertexColors: true, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: new T.Color('#ffd9c8') });
    sausage = new T.Mesh(sGeo, sMat);
    sausage.castShadow = true;
    sausage.position.y = -2.3 + RAD;
    scene.add(sausage);
    makeCracks();
  }
  // パンパンになったときに走る細いひび（長さ方向の筋）
  function makeCracks() {
    const { N, SEG } = sGeo.userData;
    cracks = [];
    for (let c = 0; c < 6; c++) {
      const i0 = 10 + Math.floor(Math.random() * (N - 34));
      cracks.push({ i0, i1: i0 + 6 + Math.floor(Math.random() * 14), j: Math.floor(Math.random() * SEG), wob: Math.random() * 6, at: 0.8 + Math.random() * 0.15 });
    }
  }

  // 焼き色（皮の色に掛け合わせる）: 生 → きつね色 → こんがり → 焦げ
  const C0 = new T.Color('#ffffff');
  const C1 = new T.Color('#a85c2a');
  const C2 = new T.Color('#55240a');
  const C3 = new T.Color('#1e0e05');
  function brownColor(b, out) {
    if (b < 0.5) out.copy(C0).lerp(C1, b / 0.5);
    else if (b < 0.9) out.copy(C1).lerp(C2, Math.min(1, (b - 0.5) / 0.35));
    else out.copy(C2).lerp(C3, clamp((b - 0.9) / 0.4, 0, 1));
    return out;
  }

  // state: { brown[BINS], roll, swell(0〜), tension(0〜1), gloss, heatC(中の温度) }
  // ゲージの代わりに、見た目で「破裂しそう」を伝える:
  //   0.5〜 ふくらんで反りが強くなる / 0.6〜 表面がボコボコ浮き出てツヤが出る
  //   0.7〜 肉汁の玉がにじむ / 0.8〜 細いひびが走る / 0.85〜 小刻みに震える
  const tmpC = new T.Color();
  function updateSausage(s) {
    const { N, SEG, base, prof, bump } = sGeo.userData;
    const pos = sGeo.attributes.position.array;
    const col = sGeo.attributes.color.array;
    const t = clamp(s.tension, 0, 1.1);
    const sw = 1 + Math.max(0, t - 0.25) * 0.34; // 圧力で太る
    const bend = 0.22 + Math.max(0, t - 0.4) * 0.35; // 反りが強くなる
    const lump = Math.max(0, t - 0.6) * 0.7; // でこぼこ
    // 熱で赤みが増す
    const warm = clamp((s.heatC - 40) / 60, 0, 1);
    for (let i = 0; i <= N; i++) {
      const x = prof[i][0];
      const bendY = (1 - Math.pow((2 * x) / LEN, 2)) * bend;
      const inner = prof[i][1] > 0.5 ? 1 : prof[i][1] / 0.5; // 端のねじれは太らない
      for (let j = 0; j <= SEG; j++) {
        const vi = i * (SEG + 1) + j;
        const k = vi * 3;
        const a = (j / SEG) * Math.PI * 2;
        let r = 1 + (sw - 1) * inner + (bump[vi] - 0.5) * lump * inner;
        // ひび: その筋のあたりは少しへこんで、中の肉が明るく見える
        let crackK = 0;
        for (const c of cracks) {
          if (t < c.at || i < c.i0 || i > c.i1) continue;
          const jj = c.j + Math.round(Math.sin(i * 0.9 + c.wob) * 1.2);
          const d = Math.min(Math.abs(j - jj), SEG - Math.abs(j - jj));
          if (d <= 2) crackK = Math.max(crackK, (1 - d * 0.4) * clamp((t - c.at) / 0.1, 0, 1));
        }
        r -= crackK * 0.09;
        pos[k] = base[k] * (1 + Math.max(0, t - 0.25) * 0.03);
        pos[k + 1] = base[k + 1] * r + bendY;
        pos[k + 2] = base[k + 2] * r;
        // 焼き色（周方向の位置で補間）。両端のねじれは少し薄く
        const f = ((a / (Math.PI * 2)) * BINS) % BINS;
        const i0 = Math.floor(f);
        const i1 = (i0 + 1) % BINS;
        const u = f - i0;
        const end = Math.min(i, N - i) / 8;
        const b = lerp(s.brown[i0], s.brown[i1], u) * Math.min(1, 0.5 + end * 0.5);
        brownColor(b, tmpC);
        const rr = 1 + warm * 0.04;
        const gg = 1 - warm * 0.05;
        col[k] = lerp(tmpC.r * rr, 1.3, crackK * 0.85);
        col[k + 1] = lerp(tmpC.g * gg, 1.05, crackK * 0.85);
        col[k + 2] = lerp(tmpC.b * gg, 0.95, crackK * 0.85);
      }
    }
    sGeo.attributes.position.needsUpdate = true;
    sGeo.attributes.color.needsUpdate = true;
    sGeo.computeVertexNormals();
    sausage.rotation.x = s.roll;
    sausage.position.y = -2.3 + RAD * sw - 0.05;
    // パンパンになるほど皮がピンと張ってツヤツヤ
    sMat.clearcoat = clamp(0.25 + Math.max(0, t - 0.3) * 1.1 + s.gloss * 0.3, 0, 1);
    sMat.roughness = clamp(0.5 - Math.max(0, t - 0.3) * 0.5 - s.gloss * 0.15, 0.1, 0.8);
    updateBeads(t);
  }
  // 肉汁の玉（皮からにじみ出る）
  const beadM = new T.MeshPhysicalMaterial({ color: '#d9963a', roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.9 });
  function updateBeads(t) {
    const want = t < 0.7 ? 0 : Math.min(10, Math.floor((t - 0.7) * 45));
    while (beads.length < want) {
      const m = new T.Mesh(new T.SphereGeometry(0.16 + Math.random() * 0.12, 12, 8), beadM);
      const x = (Math.random() - 0.5) * LEN * 0.75;
      const a = (Math.random() - 0.5) * 1.6; // 上側（見える側）からの角度
      m.userData = { x, a, grow: 0 };
      sausage.add(m);
      beads.push(m);
    }
    while (beads.length > want) sausage.remove(beads.pop());
    const sw = 1 + Math.max(0, t - 0.25) * 0.34;
    for (const m of beads) {
      m.userData.grow = Math.min(1, m.userData.grow + 0.08);
      const r = RAD * sw + 0.03;
      // 回転していても、いつも上側（カメラから見える側）ににじむ
      const a = Math.PI / 2 - sausage.rotation.x + m.userData.a;
      m.position.set(m.userData.x, Math.sin(a) * r, Math.cos(a) * r);
      m.scale.setScalar(m.userData.grow);
    }
  }

  // 0〜1 の向き a（ウインナーの周方向）のうち、いま下（フライパン側）にある区切り
  function downBin(roll) {
    // 頂点は (y=sin a, z=cos a) に置いた。x軸回りに roll 回すと下(-y)を向くのは a = -π/2 - roll
    let a = -Math.PI / 2 - roll;
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.round((a / (Math.PI * 2)) * BINS) % BINS;
  }

  function particles(dt, st) {
    // 炎の大きさ
    const h = st.heat;
    for (const f of flames) {
      f.visible = h > 0.02;
      f.scale.set(0.6 + h * 0.6, 0.3 + h * 1.4 + Math.random() * 0.15 * h, 0.6 + h * 0.6);
    }
    flames.glow.intensity = h * 1.2;
    // 水
    const lvl = clamp(st.water / 60, 0, 1);
    water.visible = st.water > 0.5;
    water.position.y = -2.25 + lvl * 1.2;
    water.scale.setScalar(0.85 + lvl * 0.15);
    // 沸騰の泡
    if (st.water > 0.5 && st.panT > 92 && Math.random() < 0.6) {
      const m = new T.Mesh(new T.SphereGeometry(0.15 + Math.random() * 0.2, 6, 4), new T.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, roughness: 0 }));
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 11;
      m.position.set(Math.cos(a) * r, water.position.y, Math.sin(a) * r);
      scene.add(m);
      bubbles.push({ m, life: 0.4 + Math.random() * 0.3 });
    }
    // 湯気・煙
    const steamRate = (st.water > 0.5 && st.panT > 90 ? 0.5 : 0) + (st.panT > 150 ? (st.panT - 150) / 200 : 0);
    if (steam.length < 18 && Math.random() < steamRate * dt * 6) {
      const m = new T.Mesh(new T.PlaneGeometry(3, 3), new T.MeshBasicMaterial({ map: steamTex(), transparent: true, opacity: 0.22, depthWrite: false }));
      m.position.set((Math.random() - 0.5) * 14, -1, (Math.random() - 0.5) * 10);
      m.lookAt(camera.position);
      scene.add(m);
      steam.push({ m, life: 1.6, vy: 4 + Math.random() * 4 });
    }
    for (const arr of [bubbles, steam, juice])
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        p.life -= dt;
        if (arr === steam) {
          p.m.position.y += p.vy * dt;
          p.m.scale.multiplyScalar(1 + dt * 0.6);
          p.m.material.opacity = Math.max(0, p.life / 1.6) * 0.22;
        } else if (arr === juice) {
          p.vy -= 60 * dt;
          p.m.position.x += p.vx * dt;
          p.m.position.y += p.vy * dt;
          p.m.position.z += p.vz * dt;
          if (p.m.position.y < -2.2) {
            p.m.position.y = -2.2;
            p.vx = p.vz = p.vy = 0;
          }
        }
        if (p.life <= 0) {
          scene.remove(p.m);
          arr.splice(i, 1);
        }
      }
  }
  let _steamTex = null;
  function steamTex() {
    if (_steamTex) return _steamTex;
    _steamTex = canvasTex(64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.8)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    });
    return _steamTex;
  }
  // 破裂: 肉汁が飛び散る
  function burst() {
    shake = 1;
    const jm = new T.MeshStandardMaterial({ color: '#d8a24a', roughness: 0.2, transparent: true, opacity: 0.85 });
    const mm = new T.MeshStandardMaterial({ color: '#c98f74', roughness: 0.7 });
    for (let i = 0; i < 70; i++) {
      const m = new T.Mesh(new T.SphereGeometry(0.12 + Math.random() * 0.25, 6, 4), Math.random() < 0.7 ? jm : mm);
      m.position.set((Math.random() - 0.5) * 6, sausage.position.y + RAD, (Math.random() - 0.5) * 1.5);
      scene.add(m);
      juice.push({ m, vx: (Math.random() - 0.5) * 40, vy: 15 + Math.random() * 30, vz: (Math.random() - 0.5) * 30, life: 3 });
    }
    // 皮が裂けた跡（縦に長い裂け目）
    const crack = new T.Mesh(new T.BoxGeometry(LEN * 0.55, 0.25, 0.7), new T.MeshStandardMaterial({ color: '#d99a80', roughness: 0.9 }));
    crack.position.set(0, RAD * 1.1, 0);
    sausage.add(crack);
  }

  function layout(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // フライパン全体が横幅に収まるように
    const hf = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    // ウインナーが大きく見えるように寄る（フライパンのふちは少し切れる）
    const dist = 9.5 / Math.tan(hf / 2);
    camera.position.set(0, dist * 0.82, dist * 0.58);
    camera.lookAt(0, -1.5, 0.6);
    camera.updateProjectionMatrix();
  }
  function render(dt, st) {
    particles(dt, st);
    if (shake > 0) {
      shake = Math.max(0, shake - dt * 1.5);
      camera.position.x = (Math.random() - 0.5) * shake * 1.5;
    } else camera.position.x = 0;
    // ギリギリになると小刻みに震える
    sausage.position.x = st.tension > 0.85 && !st.burst ? (Math.random() - 0.5) * (st.tension - 0.85) * 1.2 : 0;
    renderer.render(scene, camera);
  }
  // 画面上の点がウインナーに当たっているか
  const ray = new T.Raycaster();
  function hitSausage(nx, ny) {
    ray.setFromCamera(new T.Vector2(nx, ny), camera);
    return ray.intersectObject(sausage).length > 0;
  }

  // 新しい1本に
  function reset() {
    while (sausage.children.length) sausage.remove(sausage.children[0]);
    beads = [];
    makeCracks();
    for (const p of juice) scene.remove(p.m);
    juice = [];
    shake = 0;
  }
  window.WienerScene = { init, layout, render, updateSausage, downBin, burst, hitSausage, reset, BINS, dbg: () => ({ scene, oil, water }) };
})();
