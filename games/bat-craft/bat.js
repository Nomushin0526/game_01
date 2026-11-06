// バット職人 ― 角材・旋盤・工房の3D（Three.js）
// 長さの単位は cm。バットは y 軸に沿って立てて回す（y=0 がグリップエンド、y=LEN がバットの先）
(function () {
  'use strict';
  const T = window.THREE;

  const LEN = 84; // バットの長さ(cm)
  const SIDE = 7; // 角材の一辺(cm)
  const ROWS = 140; // 長さ方向の分割
  const COLS = 56; // 周方向の分割
  const HALF = SIDE / 2;

  // 理想のバットの半径(cm)（グリップエンドのふくらみ → 細いグリップ → テーパー → 太い打球部 → 先は丸く）
  function targetR(y) {
    if (y < 1.2) return 2.6 + 0.2 * Math.sin((y / 1.2) * Math.PI);
    if (y < 3.2) return lerp(2.6, 1.25, smooth((y - 1.2) / 2));
    if (y < 30) return lerp(1.25, 1.35, (y - 3.2) / 26.8);
    if (y < 62) return lerp(1.35, 3.25, smooth((y - 30) / 32));
    if (y < 81.5) return 3.25 + 0.05 * Math.sin(((y - 62) / 19.5) * Math.PI);
    const t = (y - 81.5) / (LEN - 81.5);
    return 3.25 * Math.sqrt(Math.max(0, 1 - t * t * 0.55));
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- 木目のテクスチャ（アオダモ風） ----------
  function woodTexture(maxAniso) {
    const w = 1024;
    const h = 1024;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const base = g.createLinearGradient(0, 0, w, 0);
    base.addColorStop(0, '#d9b98c');
    base.addColorStop(0.5, '#e4c79c');
    base.addColorStop(1, '#d4b384');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    // 年輪の筋（長さ方向＝テクスチャの縦）。ゆるく波打たせる
    for (let i = 0; i < 260; i++) {
      const x0 = Math.random() * w;
      const dark = Math.random() < 0.35;
      g.strokeStyle = dark ? `rgba(120,78,40,${0.18 + Math.random() * 0.25})` : `rgba(150,105,60,${0.06 + Math.random() * 0.12})`;
      g.lineWidth = dark ? 1 + Math.random() * 2.5 : 0.6 + Math.random();
      g.beginPath();
      const amp = 3 + Math.random() * 10;
      const fr = 0.004 + Math.random() * 0.006;
      const ph = Math.random() * 6;
      for (let y = 0; y <= h; y += 8) {
        const x = x0 + Math.sin(y * fr + ph) * amp + Math.sin(y * fr * 3.1) * amp * 0.25;
        y ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    // 細かい導管（点）
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(90,60,30,${Math.random() * 0.12})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 5);
    }
    // ところどころ色むら
    for (let i = 0; i < 18; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const rr = 40 + Math.random() * 120;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, `rgba(${Math.random() < 0.5 ? '160,110,60' : '240,215,170'},0.12)`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = maxAniso;
    return t;
  }
  // 木口（年輪）
  function endGrainTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#d8b585';
    g.fillRect(0, 0, 256, 256);
    const cx = -60 + Math.random() * 40;
    const cy = 300 + Math.random() * 40;
    for (let r = 10; r < 520; r += 6 + Math.random() * 5) {
      g.strokeStyle = `rgba(120,80,40,${0.2 + Math.random() * 0.3})`;
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    return t;
  }

  // ---------- 状態 ----------
  // r[i]: 削った半径（角材のままなら大きい）, rough[i]: 表面の荒さ(0〜1), gloss[i]: ツヤ(0〜1)
  const st = {
    r: new Float32Array(ROWS + 1),
    rough: new Float32Array(ROWS + 1),
    gloss: new Float32Array(ROWS + 1),
    dirty: true,
  };
  function reset() {
    for (let i = 0; i <= ROWS; i++) {
      st.r[i] = HALF * Math.SQRT2 + 0.01; // 角まで残っている
      st.rough[i] = 0.55; // 製材したての角材
      st.gloss[i] = 0;
    }
    st.dirty = true;
  }
  const yOf = (i) => (i / ROWS) * LEN;
  // 角材と円の重なり（角が丸く削られていく）
  function radiusAt(i, ang) {
    const sq = HALF / Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)));
    return Math.min(sq, st.r[i]);
  }

  // ---------- シーン ----------
  let renderer;
  let scene;
  let camera;
  let zoomCam;
  let batMesh;
  let geo;
  let mat;
  let capTop;
  let capBot;
  let spin = 0;
  let chips = [];
  let chipGeo;
  let chipMat;
  const group = new T.Group(); // 回転するもの

  function init(canvas) {
    renderer = new T.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setScissorTest(false);
    scene = new T.Scene();
    scene.background = new T.Color('#1d1814');
    scene.fog = new T.Fog('#1d1814', 120, 320);
    camera = new T.PerspectiveCamera(30, 0.5, 1, 1000);
    zoomCam = new T.PerspectiveCamera(16, 1, 1, 1000);

    // 映り込み用の環境（工房の窓と照明）
    const pm = new T.PMREMGenerator(renderer);
    const envScene = new T.Scene();
    const envBox = new T.Mesh(new T.BoxGeometry(100, 100, 100), new T.MeshBasicMaterial({ color: '#3a2e24', side: T.BackSide }));
    envScene.add(envBox);
    const panel = (color, x, y, z, w, h) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color, side: T.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      envScene.add(m);
    };
    panel('#fff3dc', -40, 25, 20, 30, 40); // 窓
    panel('#ffe2b0', 30, 45, -10, 50, 10); // 天井の照明
    panel('#9fb6c9', 0, 10, 48, 60, 20);
    scene.environment = pm.fromScene(envScene, 0.04).texture;

    // 照明
    const hemi = new T.HemisphereLight('#ffe9cf', '#2a2018', 0.35);
    scene.add(hemi);
    const key = new T.SpotLight('#ffe7c4', 2.2, 400, 0.5, 0.6, 1);
    key.position.set(-60, 120, 90);
    key.target.position.set(0, 42, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    scene.add(key.target);
    const rim = new T.DirectionalLight('#bcd4ff', 0.5);
    rim.position.set(80, 40, -60);
    scene.add(rim);

    // 作業台と床
    const benchTex = (() => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 512;
      const g = c.getContext('2d');
      g.fillStyle = '#6b4a2f';
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 12; i++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,25,15' : '140,100,65'},0.18)`;
        g.fillRect(0, i * 43, 512, 41);
        g.fillStyle = 'rgba(20,12,8,0.6)';
        g.fillRect(0, i * 43 + 41, 512, 2);
      }
      for (let i = 0; i < 400; i++) {
        g.strokeStyle = `rgba(40,25,15,${Math.random() * 0.25})`;
        g.beginPath();
        const y = Math.random() * 512;
        g.moveTo(0, y);
        g.bezierCurveTo(170, y + Math.random() * 6 - 3, 340, y + Math.random() * 6 - 3, 512, y);
        g.stroke();
      }
      const t = new T.CanvasTexture(c);
      t.encoding = T.sRGBEncoding;
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.repeat.set(2, 2);
      return t;
    })();
    const bench = new T.Mesh(new T.BoxGeometry(70, 4, 40), new T.MeshStandardMaterial({ map: benchTex, roughness: 0.75 }));
    bench.position.set(0, -12, -6);
    bench.receiveShadow = true;
    scene.add(bench);
    const wall = new T.Mesh(new T.PlaneGeometry(400, 300), new T.MeshStandardMaterial({ color: '#2b231c', roughness: 0.95 }));
    wall.position.set(0, 60, -40);
    wall.receiveShadow = true;
    scene.add(wall);
    // 壁の道具（シルエット）
    const toolM = new T.MeshStandardMaterial({ color: '#4a3b30', roughness: 0.8 });
    for (let i = 0; i < 6; i++) {
      const tl = new T.Mesh(new T.BoxGeometry(1.2, 12 + Math.random() * 10, 0.6), toolM);
      tl.position.set(-30 + i * 12, 70 + Math.random() * 6, -39);
      tl.rotation.z = (Math.random() - 0.5) * 0.3;
      scene.add(tl);
    }

    // 旋盤（下の主軸台・上の芯押し台）
    const metal = new T.MeshStandardMaterial({ color: '#5b6670', metalness: 0.75, roughness: 0.35 });
    const metal2 = new T.MeshStandardMaterial({ color: '#2f6b54', metalness: 0.3, roughness: 0.5 });
    const head = new T.Mesh(new T.BoxGeometry(16, 10, 14), metal2);
    head.position.set(0, -6, 0);
    head.castShadow = true;
    scene.add(head);
    const chuck = new T.Mesh(new T.CylinderGeometry(5, 5, 3, 24), metal);
    chuck.position.set(0, -0.5, 0);
    scene.add(chuck);
    const tail = new T.Mesh(new T.BoxGeometry(12, 8, 12), metal2);
    tail.position.set(0, LEN + 8, 0);
    tail.castShadow = true;
    scene.add(tail);
    const center = new T.Mesh(new T.ConeGeometry(1.2, 3, 16), metal);
    center.position.set(0, LEN + 2.5, 0);
    center.rotation.x = Math.PI;
    scene.add(center);
    const bed = new T.Mesh(new T.BoxGeometry(4, LEN + 20, 4), metal);
    bed.position.set(-10, LEN / 2, -4);
    bed.castShadow = true;
    scene.add(bed);

    // 角材（バット）
    const tex = woodTexture(renderer.capabilities.getMaxAnisotropy());
    mat = new T.MeshPhysicalMaterial({
      map: tex,
      vertexColors: true,
      roughness: 0.85,
      clearcoat: 0,
      clearcoatRoughness: 0.15,
      envMapIntensity: 0.6,
    });
    geo = new T.BufferGeometry();
    const n = (ROWS + 1) * (COLS + 1);
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('normal', new T.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3), 3));
    const uv = new Float32Array(n * 2);
    for (let i = 0; i <= ROWS; i++)
      for (let j = 0; j <= COLS; j++) {
        const k = i * (COLS + 1) + j;
        uv[k * 2] = (j / COLS) * 1.0;
        uv[k * 2 + 1] = (i / ROWS) * 3.0;
      }
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    const idx = [];
    for (let i = 0; i < ROWS; i++)
      for (let j = 0; j < COLS; j++) {
        const a = i * (COLS + 1) + j;
        const b = a + COLS + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    geo.setIndex(idx);
    batMesh = new T.Mesh(geo, mat);
    batMesh.castShadow = true;
    group.add(batMesh);
    const endM = new T.MeshStandardMaterial({ map: endGrainTexture(), roughness: 0.8 });
    capTop = new T.Mesh(new T.CircleGeometry(1, COLS), endM);
    capTop.rotation.x = -Math.PI / 2;
    capTop.position.y = LEN;
    capBot = new T.Mesh(new T.CircleGeometry(1, COLS), endM);
    capBot.rotation.x = Math.PI / 2;
    group.add(capTop, capBot);
    scene.add(group);

    // 削りくず
    chipGeo = new T.TorusGeometry(0.5, 0.12, 4, 10, Math.PI * 1.4);
    chipMat = new T.MeshStandardMaterial({ color: '#e3c393', roughness: 0.9 });
    reset();
  }

  function rebuild() {
    const pos = geo.attributes.position.array;
    const col = geo.attributes.color.array;
    for (let i = 0; i <= ROWS; i++) {
      const y = yOf(i);
      const rough = st.rough[i];
      const gl = st.gloss[i];
      // 荒いところは白っぽくけば立ち、ツヤが出ると色が深くなる
      // ニスを塗ると濡れたように色が深く、赤みが出る
      const cr = 1 + rough * 0.12 - gl * 0.12;
      const cg = 1 + rough * 0.1 - gl * 0.26;
      const cb = 1 + rough * 0.14 - gl * 0.42;
      for (let j = 0; j <= COLS; j++) {
        const a = (j / COLS) * Math.PI * 2;
        const rr = radiusAt(i, a);
        const k = (i * (COLS + 1) + j) * 3;
        pos[k] = Math.cos(a) * rr;
        pos[k + 1] = y;
        pos[k + 2] = Math.sin(a) * rr;
        col[k] = cr;
        col[k + 1] = cg;
        col[k + 2] = cb;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const rt = Math.min(HALF * 1.2, st.r[ROWS]);
    capTop.scale.setScalar(Math.max(0.01, Math.min(st.r[ROWS], HALF)));
    capBot.scale.setScalar(Math.max(0.01, Math.min(st.r[0], HALF)));
    void rt;
    // 全体のツヤ（平均）を材質に反映
    let g = 0;
    let rgh = 0;
    for (let i = 0; i <= ROWS; i++) {
      g += st.gloss[i];
      rgh += st.rough[i];
    }
    g /= ROWS + 1;
    rgh /= ROWS + 1;
    mat.roughness = clamp(0.35 + rgh * 0.55 - g * 0.25, 0.12, 0.95);
    mat.clearcoat = g;
    mat.envMapIntensity = 0.5 + g * 0.9;
    st.dirty = false;
  }

  // 削りくずを飛ばす（y: 高さ, r: 半径, side: 1=右）
  function chip(y, r, side) {
    const m = new T.Mesh(chipGeo, chipMat);
    m.position.set(r * side, y, 1);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    m.scale.setScalar(0.5 + Math.random() * 0.6);
    scene.add(m);
    chips.push({ m, vx: side * (8 + Math.random() * 18), vy: 6 + Math.random() * 14, vz: 6 + Math.random() * 12, life: 1.1 });
  }
  function dust(y, r, side) {
    // やすりの粉（小さな粒）
    const m = new T.Mesh(new T.SphereGeometry(0.12, 4, 3), chipMat);
    m.position.set(r * side, y, 1);
    scene.add(m);
    chips.push({ m, vx: side * (2 + Math.random() * 6), vy: Math.random() * 4, vz: 2 + Math.random() * 4, life: 0.8 });
  }

  function layout(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // バット全体が縦に収まる距離
    const vfov = (camera.fov * Math.PI) / 180;
    const need = LEN + 26;
    const dist = need / 2 / Math.tan(vfov / 2);
    camera.position.set(0, LEN / 2 + 4, dist);
    camera.lookAt(0, LEN / 2 + 1, 0);
    camera.updateProjectionMatrix();
    return { dist };
  }
  // 画面座標 ↔ バットの座標（カメラはバットを正面から見ている）
  function project(x, y) {
    const v = new T.Vector3(x, y, 0).project(camera);
    return v;
  }

  // zoom: { y } 指の位置を拡大して見せる（null なら出さない）
  function render(dt, spinning, w, h, zoom, inset) {
    if (st.dirty) rebuild();
    if (spinning) spin += dt * 18;
    group.rotation.y = spin;
    for (let i = chips.length - 1; i >= 0; i--) {
      const c = chips[i];
      c.vy -= 60 * dt;
      c.m.position.x += c.vx * dt;
      c.m.position.y += c.vy * dt;
      c.m.position.z += c.vz * dt;
      c.m.rotation.x += dt * 9;
      c.m.rotation.y += dt * 7;
      if (c.m.position.y < -9.5) {
        c.m.position.y = -9.5;
        c.vx *= 0.3;
        c.vz *= 0.3;
        c.vy = 0;
      }
      c.life -= dt;
      if (c.life <= 0) {
        scene.remove(c.m);
        chips.splice(i, 1);
      }
    }
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);
    if (zoom && inset) {
      // 拡大鏡: 指のあたりを右上に大きく映す
      const { x, y, s } = inset;
      zoomCam.aspect = 1;
      zoomCam.position.set(5, zoom.y, 34);
      zoomCam.lookAt(1, zoom.y, 0);
      zoomCam.updateProjectionMatrix();
      renderer.setScissorTest(true);
      renderer.setViewport(x, h - y - s, s, s);
      renderer.setScissor(x, h - y - s, s, s);
      renderer.render(scene, zoomCam);
      renderer.setScissorTest(false);
    }
  }

  window.BatWorld = {
    LEN,
    SIDE,
    HALF,
    ROWS,
    st,
    targetR,
    reset,
    yOf,
    init,
    layout,
    render,
    project,
    chip,
    dust,
    get camera() {
      return camera;
    },
    showcase(on) {
      // 結果発表: 旋盤から外して照らす
      group.position.z = on ? 6 : 0;
    },
  };
})();
