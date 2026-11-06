// 車窓ラン ― 窓の外の景色（Three.js）と、走れる足場のデータ
// 座標: x = 道に沿った位置（車は -x 方向へ進む）、y = 高さ(m)、z = 奥行き（窓から見て奥が -z）
// カメラは車の座席の高さから真横（-z）を見ている。
(function () {
  'use strict';
  const T = window.THREE;

  const CAM_Y = 1.3; // 目の高さ(m)
  const FOV = 60; // 縦の視野角
  // 足場の奥行き（窓からの距離 m）
  const Z = {
    lane: 3.8, // となりの車線（並走する車）
    line: 6.2, // 路肩の白線
    rail: 7.0, // ガードレール
    sign: 7.6, // 標識
    pole: 8.2, // 電柱
    vend: 9.6, // 自販機
    fence: 10.4, // フェンス
    front: 24, // 手前の建物の正面（歩道と空地の奥）
    back: 40, // 奥のビル
  };

  // ---------- 乱数（ステージごとに同じ景色） ----------
  function rngOf(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- テクスチャ（写真を使わず描く） ----------
  let maxAniso = 1;
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    draw(g, w, h);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = maxAniso;
    if (repeat) {
      t.wrapS = t.wrapT = T.RepeatWrapping;
    }
    return t;
  }
  function noise(g, w, h, amt, alpha) {
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * amt;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
      if (alpha) d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  // 汚れ・雨だれ（下に行くほど少し暗く）
  function grime(g, w, h, k) {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, `rgba(20,15,10,${k})`);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < w / 6; i++) {
      g.fillStyle = `rgba(30,25,20,${Math.random() * 0.08})`;
      const x = Math.random() * w;
      g.fillRect(x, Math.random() * h * 0.3, 1 + Math.random() * 2, h * (0.2 + Math.random() * 0.6));
    }
  }

  const SHOP_WORDS = ['薬', 'ラーメン', 'そば', '珈琲', '不動産', '歯科', 'コンビニ', '居酒屋', '書店', '寿司', 'クリーニング', '銀行', 'カフェ', '靴', '眼鏡', '時計'];
  const WALLS = [
    ['#cfc6b8', '#b9ae9d'],
    ['#d9d6cf', '#c2bfb7'],
    ['#9c6f55', '#82583f'], // 茶色タイル
    ['#c9b48f', '#b19a72'],
    ['#8f9599', '#777d82'],
    ['#e6e1d6', '#d0cab9'],
    ['#6d6f73', '#585a5e'],
  ];
  // ビルの正面: 窓の格子・1階の店・看板
  function facadeTex(r, floors, cols, opts) {
    const W = 512;
    const H = Math.round((512 * floors) / Math.max(2, cols)) + 0;
    return canvasTex(W, Math.max(256, Math.min(1024, H)), (g, w, h) => {
      const [c1, c2] = WALLS[Math.floor(r() * WALLS.length)];
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, c1);
      gr.addColorStop(1, c2);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      // タイル目地
      if (r() < 0.5) {
        g.strokeStyle = 'rgba(0,0,0,0.06)';
        for (let y = 0; y < h; y += 6) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w, y);
          g.stroke();
        }
      }
      const fh = h / floors;
      const glassy = opts.glass;
      for (let f = 0; f < floors; f++) {
        const y0 = f * fh;
        const ground = f === floors - 1;
        if (ground && opts.shop) {
          // 1階の店: ガラス戸と看板
          g.fillStyle = '#2b3036';
          g.fillRect(w * 0.04, y0 + fh * 0.32, w * 0.92, fh * 0.68);
          const sg = g.createLinearGradient(0, y0 + fh * 0.32, 0, y0 + fh);
          sg.addColorStop(0, 'rgba(180,200,215,0.55)');
          sg.addColorStop(1, 'rgba(60,70,80,0.3)');
          g.fillStyle = sg;
          g.fillRect(w * 0.06, y0 + fh * 0.36, w * 0.88, fh * 0.6);
          // 店内の明かり
          g.fillStyle = 'rgba(255,236,190,0.25)';
          g.fillRect(w * 0.08, y0 + fh * 0.5, w * 0.84, fh * 0.4);
          // 看板
          const sc = ['#c0392b', '#1f5fa8', '#1e7d4f', '#f1c40f', '#ffffff', '#e67e22'][Math.floor(r() * 6)];
          g.fillStyle = sc;
          g.fillRect(w * 0.04, y0 + fh * 0.06, w * 0.92, fh * 0.24);
          g.fillStyle = sc === '#ffffff' || sc === '#f1c40f' ? '#1b1b1b' : '#ffffff';
          g.font = `900 ${Math.round(fh * 0.17)}px "Hiragino Sans","Noto Sans JP",sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(SHOP_WORDS[Math.floor(r() * SHOP_WORDS.length)], w / 2, y0 + fh * 0.18);
          continue;
        }
        // 窓
        const cw = w / cols;
        for (let c = 0; c < cols; c++) {
          const x0 = c * cw;
          const wx = x0 + cw * (glassy ? 0.04 : 0.16);
          const ww = cw * (glassy ? 0.92 : 0.68);
          const wy = y0 + fh * (glassy ? 0.06 : 0.22);
          const wh = fh * (glassy ? 0.88 : 0.56);
          // 空の映り込み
          const rg = g.createLinearGradient(0, wy, 0, wy + wh);
          const lit = r() < 0.08;
          rg.addColorStop(0, lit ? '#f4e2b0' : '#a9bfd0');
          rg.addColorStop(0.55, lit ? '#e9cf8f' : '#6e8597');
          rg.addColorStop(1, lit ? '#c8a463' : '#3c4b57');
          g.fillStyle = rg;
          g.fillRect(wx, wy, ww, wh);
          // カーテン・ブラインド
          if (!lit && r() < 0.35) {
            g.fillStyle = `rgba(235,230,215,${0.5 + r() * 0.4})`;
            g.fillRect(wx, wy, ww, wh * (0.2 + r() * 0.6));
          }
          // サッシ
          g.strokeStyle = glassy ? 'rgba(30,40,50,0.6)' : 'rgba(60,60,60,0.55)';
          g.lineWidth = 2;
          g.strokeRect(wx, wy, ww, wh);
          g.beginPath();
          g.moveTo(wx + ww / 2, wy);
          g.lineTo(wx + ww / 2, wy + wh);
          g.stroke();
          // 斜めの反射
          g.fillStyle = 'rgba(255,255,255,0.10)';
          g.beginPath();
          g.moveTo(wx + ww * 0.1, wy + wh);
          g.lineTo(wx + ww * 0.45, wy);
          g.lineTo(wx + ww * 0.6, wy);
          g.lineTo(wx + ww * 0.25, wy + wh);
          g.fill();
        }
        // 階ごとの帯
        g.fillStyle = 'rgba(0,0,0,0.08)';
        g.fillRect(0, y0 + fh - 3, w, 3);
      }
      // 屋上のパラペット
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(0, 0, w, 6);
      grime(g, w, h, 0.18);
      noise(g, w, h, 14);
    });
  }
  // 遠くの高層ビル（ガラスのカーテンウォール）
  function towerTex(r) {
    return canvasTex(256, 512, (g, w, h) => {
      const tone = ['#5f7b92', '#7f95a6', '#4d6274', '#8fa3ad', '#6a7f7a'][Math.floor(r() * 5)];
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#c9d8e4');
      gr.addColorStop(0.4, tone);
      gr.addColorStop(1, '#2f3c48');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(20,30,40,0.35)';
      for (let x = 0; x < w; x += 16) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      for (let y = 0; y < h; y += 12) {
        g.fillStyle = 'rgba(20,30,40,0.25)';
        g.fillRect(0, y, w, 2);
      }
      noise(g, w, h, 10);
    }, true);
  }
  const TEX = {};
  function makeTextures() {
    TEX.asphalt = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#4b4d50';
      g.fillRect(0, 0, w, h);
      noise(g, w, h, 40);
      for (let i = 0; i < 30; i++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
        g.beginPath();
        g.ellipse(Math.random() * w, Math.random() * h, 5 + Math.random() * 30, 3 + Math.random() * 10, 0, 0, 7);
        g.fill();
      }
    }, true);
    TEX.sidewalk = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#b4ada2';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(70,60,50,0.35)';
      g.lineWidth = 2;
      for (let x = 0; x <= w; x += 64) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      for (let y = 0; y <= h; y += 64) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      noise(g, w, h, 26);
    }, true);
    TEX.fence = canvasTex(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(70,90,80,0.95)';
      g.lineWidth = 2.2;
      for (let i = -w; i < w * 2; i += 16) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + h, h);
        g.stroke();
        g.beginPath();
        g.moveTo(i + h, 0);
        g.lineTo(i, h);
        g.stroke();
      }
    }, true);
    TEX.vend = canvasTex(128, 256, (g, w, h) => {
      g.fillStyle = '#e8eef2';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#d8e6ee';
      g.fillRect(8, 10, w - 16, h * 0.55);
      const cols = ['#e74c3c', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1', '#16a085'];
      for (let row = 0; row < 4; row++)
        for (let c = 0; c < 6; c++) {
          g.fillStyle = cols[(row * 6 + c * 3) % cols.length];
          g.fillRect(14 + c * 17, 20 + row * 34, 10, 22);
          g.fillStyle = 'rgba(255,255,255,0.5)';
          g.fillRect(14 + c * 17, 20 + row * 34, 3, 22);
        }
      g.fillStyle = '#23303a';
      g.fillRect(14, h * 0.72, w - 28, 18);
      g.fillStyle = '#1f6fb2';
      g.fillRect(0, h - 22, w, 22);
      noise(g, w, h, 10);
    });
    TEX.sign = canvasTex(256, 160, (g, w, h) => {
      g.fillStyle = '#1d5fa8';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#fff';
      g.lineWidth = 5;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = '#fff';
      g.font = '900 44px "Hiragino Sans","Noto Sans JP",sans-serif';
      g.textAlign = 'center';
      g.fillText('品川', w * 0.36, 70);
      g.font = '700 22px sans-serif';
      g.fillText('Shinagawa', w * 0.36, 102);
      g.beginPath();
      g.moveTo(w * 0.78, 40);
      g.lineTo(w * 0.9, 80);
      g.lineTo(w * 0.82, 80);
      g.lineTo(w * 0.82, 130);
      g.lineTo(w * 0.74, 130);
      g.lineTo(w * 0.74, 80);
      g.lineTo(w * 0.66, 80);
      g.closePath();
      g.fill();
      g.font = '900 26px sans-serif';
      g.fillText('1', w * 0.36, 140);
    });
    TEX.leaf = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#3f6b33';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) {
        g.fillStyle = `hsl(${95 + Math.random() * 30},${35 + Math.random() * 25}%,${22 + Math.random() * 25}%)`;
        g.beginPath();
        g.ellipse(Math.random() * w, Math.random() * h, 3 + Math.random() * 4, 2 + Math.random() * 3, Math.random() * 3, 0, 7);
        g.fill();
      }
    }, true);
    TEX.roof = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#8a8b88';
      g.fillRect(0, 0, w, h);
      noise(g, w, h, 30);
    }, true);
  }

  // ---------- シーン ----------
  let renderer, scene, camera, sun, hemi;
  let objects = []; // 動くもの（並走車）
  let platforms = [];
  let stageLen = 0;

  function init(canvas) {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    // 日差しの影（リアルさの決め手）
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    maxAniso = renderer.capabilities.getMaxAnisotropy();
    camera = new T.PerspectiveCamera(FOV, 16 / 9, 0.5, 2500);
    makeTextures();
  }
  // shiftK: 地平線を画面の中央より下へずらす割合（空を広く見せる）
  function resize(w, h, shiftK) {
    renderer.setSize(w, h, false);
    const fullH = h * (1 + 2 * shiftK);
    camera.aspect = w / fullH;
    camera.setViewOffset(w, fullH, 0, 0, w, h);
    camera.updateProjectionMatrix();
    return fullH;
  }

  const mat = (opt) => new T.MeshLambertMaterial(opt);
  function box(w, h, d, m, x, y, z, noShadow) {
    const o = new T.Mesh(new T.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    if (!noShadow) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
    scene.add(o);
    return o;
  }
  // 雲
  let cloudTex = null;
  function clouds(r) {
    if (!cloudTex)
      cloudTex = canvasTex(256, 128, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        for (let i = 0; i < 26; i++) {
          const x = 30 + Math.random() * (w - 60);
          const y = 50 + Math.random() * 40 - Math.abs(x - w / 2) * 0.15;
          const rr = 14 + Math.random() * 26;
          const gr = g.createRadialGradient(x, y, 0, x, y, rr);
          gr.addColorStop(0, 'rgba(255,255,255,0.75)');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr;
          g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
        }
      });
    for (let i = 0; i < 14; i++) {
      const m = new T.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.6 + r() * 0.35 });
      const c = new T.Mesh(new T.PlaneGeometry(500 + r() * 400, 160 + r() * 90), m);
      c.position.set(80 - i * 130 - r() * 80, 260 + r() * 260, -1400 - r() * 300);
      scene.add(c);
    }
  }

  // 空（グラデーション）
  function sky(top, mid, bottom) {
    const g = new T.SphereGeometry(2000, 32, 16);
    const m = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new T.Color(top) }, mid: { value: new T.Color(mid) }, bot: { value: new T.Color(bottom) } },
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vp; void main(){ float h = vp.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*2.2,0.0,1.0),0.7)) : mix(mid, bot, clamp(-h*6.0,0.0,1.0)); gl_FragColor = vec4(c,1.0); }',
    });
    const o = new T.Mesh(g, m);
    scene.add(o);
    return o;
  }

  // 並走する車
  function carMesh(r, kind) {
    const g = new T.Group();
    const colors = kind === 'taxi' ? ['#151515'] : ['#f2f2f2', '#1c1c1c', '#9da3a8', '#3a4a6b', '#7a1f24', '#d8d2c4'];
    const body = mat({ color: colors[Math.floor(r() * colors.length)] });
    const glass = mat({ color: '#26323c' });
    const tire = mat({ color: '#141414' });
    const L = kind === 'van' ? 4.8 : 4.4;
    const H = kind === 'van' ? 1.95 : 1.45;
    const lower = new T.Mesh(new T.BoxGeometry(L, H * 0.5, 1.75), body);
    lower.position.y = 0.32 + H * 0.25;
    g.add(lower);
    const cab = new T.Mesh(new T.BoxGeometry(kind === 'van' ? L * 0.92 : L * 0.55, H * 0.46, 1.6), body);
    cab.position.set(kind === 'van' ? 0.1 : 0.15, 0.32 + H * 0.73, 0);
    g.add(cab);
    const win = new T.Mesh(new T.BoxGeometry(kind === 'van' ? L * 0.8 : L * 0.48, H * 0.32, 1.62), glass);
    win.position.set(kind === 'van' ? 0.2 : 0.15, 0.32 + H * 0.74, 0);
    g.add(win);
    for (const dx of [-L * 0.32, L * 0.32]) {
      const w = new T.Mesh(new T.CylinderGeometry(0.33, 0.33, 0.25, 16), tire);
      w.rotation.x = Math.PI / 2;
      w.position.set(dx, 0.33, 0.8);
      g.add(w);
    }
    if (kind === 'taxi') {
      const lamp = new T.Mesh(new T.BoxGeometry(0.4, 0.14, 0.2), mat({ color: '#f4d03f', emissive: '#6b5a10' }));
      lamp.position.set(0.15, 0.32 + H * 0.96 + 0.07, 0);
      g.add(lamp);
    }
    g.traverse((m) => {
      if (m.isMesh) m.castShadow = true;
    });
    scene.add(g);
    return { g, L, H: H + 0.32 + (kind === 'taxi' ? 0.14 : 0) };
  }

  // ---------- ステージの景色を作る ----------
  // stage: { seed, length, sky:[top,mid,bot], fog, sunDir, landmarks: [{x, kind}] }
  function build(stage) {
    scene = new T.Scene();
    const r = rngOf(stage.seed);
    stageLen = stage.length;
    platforms = [];
    objects = [];
    scene.fog = new T.Fog(stage.fog, 60, 700);
    sky(stage.sky[0], stage.sky[1], stage.sky[2]);
    hemi = new T.HemisphereLight('#dfeaf5', '#6b5d4f', 0.85);
    scene.add(hemi);
    sun = new T.DirectionalLight('#fff0d4', 1.9);
    // 道路側・左上からの日差し（ビルの正面に当たり、ベランダや庇の影が斜めに落ちる）
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 1;
    sc.far = 200;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    scene.add(sun.target);
    hemi.intensity = 0.45;
    clouds(r);

    const X0 = 40; // スタートより少し後ろから作る
    const X1 = -stageLen - 80;
    const span = X0 - X1;
    const mid = (X0 + X1) / 2;
    // 道路・歩道
    const asph = TEX.asphalt.clone();
    asph.needsUpdate = true;
    asph.repeat.set(span / 6, 2);
    const road = new T.Mesh(new T.PlaneGeometry(span, 14), mat({ map: asph }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(mid, 0, -0.5);
    road.receiveShadow = true;
    scene.add(road);
    // 車線の白い破線（自分の車線とのあいだ）
    const dashM = mat({ color: '#e9e9e6' });
    for (let x = X0; x > X1; x -= 10) box(5, 0.02, 0.15, dashM, x, 0.01, -1.9, true);
    // ---------- 切れ目（交差点・川）: ここでは白線も歩道もなくなる ----------
    // stage.gaps: [{ d: 進んだ距離, w: 幅, kind: 'cross' | 'river', name }]
    const g_end = (g) => g.x1 + 1;
    const gaps = (stage.gaps || []).map((g) => ({ x0: -g.d - g.w, x1: -g.d, kind: g.kind, name: g.name }));
    const inGap = (xa, xb) => gaps.some((g) => xb > g.x0 - 0.5 && xa < g.x1 + 0.5);
    // [xa, xb] から切れ目を除いた区間
    function clip(xa, xb) {
      let segs = [[xa, xb]];
      for (const g of gaps) {
        const out = [];
        for (const [a2, b2] of segs) {
          if (b2 <= g.x0 || a2 >= g.x1) out.push([a2, b2]);
          else {
            if (a2 < g.x0) out.push([a2, g.x0]);
            if (b2 > g.x1) out.push([g.x1, b2]);
          }
        }
        segs = out;
      }
      return segs.filter(([a2, b2]) => b2 - a2 > 1);
    }
    const lineM = mat({ color: '#f3f3ef' });
    const curbM = mat({ color: '#a7a39b' });
    const sw = TEX.sidewalk.clone();
    sw.needsUpdate = true;
    for (const [a2, b2] of clip(X1, X0)) {
      const len = b2 - a2;
      const cx = (a2 + b2) / 2;
      // 路肩の白線（走れる）
      const line = new T.Mesh(new T.PlaneGeometry(len, 0.2), lineM);
      line.rotation.x = -Math.PI / 2;
      line.position.set(cx, 0.012, -Z.line);
      scene.add(line);
      platforms.push({ x0: a2, x1: b2, y: 0, z: Z.line, kind: 'walk', name: '白線', base: true });
      // 縁石と歩道・建物の前の空地
      box(len, 0.18, 0.3, curbM, cx, 0.09, -(Z.line + 0.6), true);
      const t1 = sw.clone();
      t1.needsUpdate = true;
      t1.repeat.set(len / 3, 2.5);
      const walk = new T.Mesh(new T.PlaneGeometry(len, 9), mat({ map: t1 }));
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(cx, 0.18, -(Z.line + 5.2));
      walk.receiveShadow = true;
      scene.add(walk);
      const t2 = sw.clone();
      t2.needsUpdate = true;
      t2.repeat.set(len / 3, 3);
      const plaza = new T.Mesh(new T.PlaneGeometry(len, 12), mat({ map: t2 }));
      plaza.rotation.x = -Math.PI / 2;
      plaza.position.set(cx, 0.17, -(Z.front - 4));
      plaza.receiveShadow = true;
      scene.add(plaza);
    }
    // 建物の向こうの地面
    const back = new T.Mesh(new T.PlaneGeometry(span, 600), mat({ color: '#77736c' }));
    back.rotation.x = -Math.PI / 2;
    back.position.set(mid, 0.02, -310);
    scene.add(back);
    // 交差点と川
    const stripeM = mat({ color: '#efefea' });
    const sigM = mat({ color: '#8f9399' });
    for (const g of gaps) {
      const w = g.x1 - g.x0;
      const cx = (g.x0 + g.x1) / 2;
      if (g.kind === 'river') {
        // 川: 水面と護岸。橋の欄干だけが走れる
        const water = new T.Mesh(new T.PlaneGeometry(w, 400), new T.MeshLambertMaterial({ color: '#1f3b46' }));
        water.rotation.x = -Math.PI / 2;
        water.position.set(cx, -2.5, -200);
        scene.add(water);
        box(0.6, 3, 400, mat({ color: '#8b877f' }), g.x0, -1, -200, true);
        box(0.6, 3, 400, mat({ color: '#8b877f' }), g.x1, -1, -200, true);
        // 橋の欄干（走れる）
        box(w, 0.12, 0.2, mat({ color: '#6f7a82' }), cx, 1.1, -Z.rail, true);
        for (let px = g.x0 + 0.3; px < g.x1; px += 1.2) box(0.06, 1.1, 0.06, mat({ color: '#6f7a82' }), px, 0.55, -Z.rail, true);
        platforms.push({ x0: g.x0, x1: g.x1, y: 1.15, z: Z.rail, kind: 'walk', name: '橋の欄干' });
        // 橋桁の下は暗い
        box(w, 0.5, 6, mat({ color: '#55595e' }), cx, -0.25, -(Z.line - 2), true);
        continue;
      }
      // 交差点: 横の道路と横断歩道、信号機
      const side = new T.Mesh(new T.PlaneGeometry(w, 400), mat({ map: (() => { const t = TEX.asphalt.clone(); t.needsUpdate = true; t.repeat.set(w / 6, 60); return t; })() }));
      side.rotation.x = -Math.PI / 2;
      side.position.set(cx, 0.015, -(Z.line + 200));
      side.receiveShadow = true;
      scene.add(side);
      for (let px = g.x0 + 0.6; px < g.x1 - 0.4; px += 0.9) box(0.45, 0.02, 3.2, stripeM, px, 0.03, -(Z.line + 2.2), true);
      for (const px of [g.x0 - 0.6, g.x1 + 0.6]) {
        box(0.2, 4.6, 0.2, sigM, px, 2.3, -(Z.line + 1.2));
        const head = box(1.2, 0.4, 0.35, mat({ color: '#30353a' }), px, 4.6, -(Z.line + 1.2));
        head.castShadow = true;
      }
    }

    // ガードレール（区間ごと・切れ目あり）
    const railM = mat({
      map: canvasTex(64, 64, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, '#f6f6f2');
        gr.addColorStop(0.3, '#c9cac6');
        gr.addColorStop(0.5, '#f2f2ee');
        gr.addColorStop(0.7, '#b9bab6');
        gr.addColorStop(1, '#e8e8e3');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
        noise(g, w, h, 12);
      }),
    });
    const postM = mat({ color: '#cfcfc9' });
    for (let x = X0; x > X1; ) {
      const len = 25 + r() * 45;
      if (r() < 0.7) {
        for (const [x0, x1] of clip(x - len, x)) {
          box(x1 - x0, 0.3, 0.06, railM, (x0 + x1) / 2, 0.66, -Z.rail, true);
          for (let px = x1 - 1; px > x0; px -= 4) box(0.12, 0.7, 0.12, postM, px, 0.35, -Z.rail - 0.08, true);
          platforms.push({ x0, x1, y: 0.82, z: Z.rail, kind: 'walk', name: 'ガードレール' });
        }
      }
      x -= len + 6 + r() * 14;
    }
    // フェンス（工事現場・公園などの区間）
    const fencePostM = mat({ color: '#476052' });
    for (let x = X0 - 30; x > X1; ) {
      const len = 20 + r() * 40;
      if (r() < 0.45) {
        for (const [x0, x1] of clip(x - len, x)) {
          const L = x1 - x0;
          const ft = TEX.fence.clone();
          ft.needsUpdate = true;
          ft.repeat.set(L / 1.2, 1);
          const fm = new T.Mesh(new T.PlaneGeometry(L, 1.3), new T.MeshLambertMaterial({ map: ft, transparent: true, alphaTest: 0.3, side: T.DoubleSide }));
          fm.position.set((x0 + x1) / 2, 0.83, -Z.fence);
          scene.add(fm);
          box(L, 0.05, 0.05, fencePostM, (x0 + x1) / 2, 1.48, -Z.fence, true);
          for (let px = x1; px > x0; px -= 2.4) box(0.06, 1.5, 0.06, fencePostM, px, 0.75, -Z.fence, true);
          platforms.push({ x0, x1, y: 1.5, z: Z.fence, kind: 'walk', name: 'フェンス' });
        }
      }
      x -= len + 10 + r() * 30;
    }
    // 電柱と電線（見た目だけ）
    const poleM = mat({ color: '#a19d95' });
    let prevTop = null;
    for (let x = X0; x > X1; x -= 30 + r() * 8) {
      if (inGap(x - 0.3, x + 0.3)) {
        prevTop = null;
        continue;
      }
      box(0.32, 10.5, 0.32, poleM, x, 5.25, -Z.pole);
      box(1.6, 0.12, 0.12, poleM, x, 9.4, -Z.pole);
      if (r() < 0.5) box(0.5, 0.8, 0.5, mat({ color: '#7d7a73' }), x + 0.4, 7.6, -Z.pole);
      if (prevTop !== null) {
        for (const dy of [9.3, 8.6]) {
          const pts = [];
          for (let i = 0; i <= 12; i++) {
            const t = i / 12;
            pts.push(new T.Vector3(prevTop + (x - prevTop) * t, dy - Math.sin(Math.PI * t) * 0.5, -Z.pole));
          }
          scene.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: '#2a2a2a' })));
        }
      }
      prevTop = x;
    }
    // 街路樹（見た目だけ）
    const treeTex = canvasTex(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) {
        const a3 = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * 110;
        const x = w / 2 + Math.cos(a3) * rr;
        const y = h * 0.47 + Math.sin(a3) * rr * 0.85;
        const shade = 0.55 + (1 - y / h) * 0.5 + (x < w / 2 ? 0.1 : -0.05);
        g.fillStyle = `hsl(${88 + Math.random() * 30},${30 + Math.random() * 20}%,${Math.min(60, (14 + Math.random() * 18) * shade + 6)}%)`;
        g.beginPath();
        g.ellipse(x, y, 3 + Math.random() * 4, 2 + Math.random() * 3, Math.random() * 3, 0, 7);
        g.fill();
      }
      g.fillStyle = '#4a3c2e';
      g.fillRect(w / 2 - 5, h * 0.75, 10, h * 0.25);
    });
    const treeM = new T.MeshLambertMaterial({ map: treeTex, transparent: true, alphaTest: 0.4, side: T.DoubleSide });
    for (let x = X0 - 8; x > X1; x -= 14 + r() * 10) {
      if (r() < 0.3 || inGap(x - 3, x + 3)) continue;
      const s2 = 5.5 + r() * 2;
      const t = new T.Mesh(new T.PlaneGeometry(s2, s2), treeM);
      t.position.set(x, s2 / 2, -(Z.front - 6));
      t.castShadow = true;
      scene.add(t);
    }
    // 標識（上の板に乗れる・横からぶつかる）
    for (let x = X0 - 130; x > X1; x -= 80 + r() * 70) {
      if (inGap(x - 2.4, x + 0.6)) continue;
      box(0.14, 3.6, 0.14, mat({ color: '#9aa0a6' }), x, 1.8, -Z.sign);
      const plate = new T.Mesh(new T.PlaneGeometry(2.6, 1.6), mat({ map: TEX.sign }));
      plate.position.set(x - 0.9, 3.9, -Z.sign + 0.05);
      scene.add(plate);
      platforms.push({ x0: x - 2.2, x1: x + 0.4, y: 4.7, z: Z.sign, kind: 'solid', name: '標識', bodyY0: 3.1 });
    }
    // 自販機（上に乗れる・横からぶつかる）
    const vendM = [mat({ map: TEX.vend }), mat({ color: '#d8dde0' })];
    for (let x = X0 - 90; x > X1; x -= 30 + r() * 45) {
      const n = r() < 0.4 ? 2 : 1;
      if (inGap(x - n * 1.1, x + 0.6)) continue;
      for (let i = 0; i < n; i++) {
        const vx = x - i * 1.05;
        const v = new T.Mesh(new T.BoxGeometry(1.0, 1.85, 0.8), [vendM[1], vendM[1], vendM[1], vendM[1], vendM[0], vendM[1]]);
        v.position.set(vx, 0.18 + 0.92, -Z.vend);
        v.castShadow = true;
        scene.add(v);
      }
      platforms.push({ x0: x - n * 1.05 + 0.5, x1: x + 0.5, y: 2.05, z: Z.vend, kind: 'solid', name: '自販機', bodyY0: 0.18 });
    }
    // 白線の上のカラーコーン（すぐ近くを速く流れてくる。跳び越える）
    const coneM = mat({ color: '#f26a1b' });
    const bandM = mat({ color: '#f4f4f0' });
    for (let x = X0 - 160; x > X1; x -= 70 + r() * 90) {
      const n = 1 + Math.floor(r() * 3);
      if (inGap(x - n * 1.6, x + 0.5)) continue;
      for (let i = 0; i < n; i++) {
        const cx = x - i * 1.6;
        const c = new T.Mesh(new T.ConeGeometry(0.22, 0.7, 14), coneM);
        c.position.set(cx, 0.4, -(Z.line + 0.15));
        c.castShadow = true;
        scene.add(c);
        const bnd = new T.Mesh(new T.CylinderGeometry(0.11, 0.14, 0.1, 14), bandM);
        bnd.position.set(cx, 0.48, -(Z.line + 0.15));
        scene.add(bnd);
        box(0.42, 0.05, 0.42, coneM, cx, 0.03, -(Z.line + 0.15), true);
      }
      platforms.push({ x0: x - (n - 1) * 1.6 - 0.25, x1: x + 0.25, y: 0.75, z: Z.line, kind: 'solid', name: 'カラーコーン', bodyY0: 0 });
    }

    // 手前の建物（屋上は走れる）。ベランダ・庇・室外機などの凹凸で影ができる
    let bx = X0;
    while (bx > X1) {
      let w = 8 + r() * 14;
      // 交差点・川には建てない
      const gHit = gaps.find((g) => bx > g.x0 - 1 && bx - w < g.x1 + 1);
      if (gHit) {
        if (bx > g_end(gHit)) w = Math.max(0, bx - (gHit.x1 + 1));
        if (w < 4) {
          bx = gHit.x0 - 1;
          continue;
        }
      }
      const floors = r() < 0.7 ? 2 : 3;
      const fh = 3.0;
      const h = floors * fh + 0.5;
      const depth = 12 + r() * 8;
      const cols = Math.max(2, Math.round(w / 2.8));
      const fm = mat({ map: facadeTex(r, floors, cols, { shop: true, glass: false }) });
      const side = mat({ color: '#9b958b' });
      const top = mat({ map: TEX.roof });
      const b = new T.Mesh(new T.BoxGeometry(w, h, depth), [side, side, top, side, fm, side]);
      b.position.set(bx - w / 2, h / 2, -(Z.front + depth / 2));
      b.castShadow = true;
      b.receiveShadow = true;
      scene.add(b);
      const zf = -Z.front;
      const trimC = ['#d9d4c8', '#bfb8aa', '#e6e3dc', '#8a857c'][Math.floor(r() * 4)];
      const trim = mat({ color: trimC });
      const style = r();
      for (let fl = 1; fl < floors; fl++) {
        const y = fl * fh;
        if (style < 0.45) {
          // ベランダ（床と手すり）
          box(w - 0.4, 0.14, 1.1, trim, bx - w / 2, y + 0.05, zf + 0.55);
          box(w - 0.4, 0.9, 0.06, mat({ color: '#cfd6da', transparent: true, opacity: 0.55 }), bx - w / 2, y + 0.55, zf + 1.08);
          box(w - 0.4, 0.06, 0.08, trim, bx - w / 2, y + 1.02, zf + 1.08);
        } else {
          // 階ごとの帯（水平の出っ張り）
          box(w, 0.22, 0.35, trim, bx - w / 2, y + 0.02, zf + 0.17);
        }
      }
      // 縦の柱型
      if (style > 0.6) for (let i = 0; i <= cols; i++) box(0.3, h - 0.5, 0.3, trim, bx - (w * i) / cols, h / 2, zf + 0.15);
      // 1階の庇
      box(w - 0.2, 0.12, 1.4, mat({ color: ['#3c4a55', '#7a2b22', '#2d4d3a', '#555'][Math.floor(r() * 4)] }), bx - w / 2, 2.55, zf + 0.7);
      // 屋上: パラペット・室外機・給水タンク
      box(w, 0.6, 0.18, trim, bx - w / 2, h + 0.3, zf + 0.09);
      if (r() < 0.7) box(1.4, 0.9, 0.8, mat({ color: '#d5d8da' }), bx - w * (0.2 + r() * 0.6), h + 0.45, zf - 2.5);
      if (r() < 0.35) {
        const t = new T.Mesh(new T.CylinderGeometry(0.9, 0.9, 1.6, 14), mat({ color: '#c9ccc9' }));
        t.position.set(bx - w * (0.3 + r() * 0.4), h + 1.8, zf - 4);
        t.castShadow = true;
        scene.add(t);
        box(1.6, 1, 1.6, mat({ color: '#8d9093' }), t.position.x, h + 0.5, zf - 4);
      }
      // 壁の室外機
      for (let i = 0; i < floors - 1; i++) if (r() < 0.4) box(0.8, 0.6, 0.35, mat({ color: '#e1e3e2' }), bx - w * (0.15 + r() * 0.7), (i + 1) * fh + 0.45, zf + 0.2);
      platforms.push({ x0: bx - w, x1: bx, y: h, z: Z.front, kind: 'walk', name: '屋上' });
      bx -= w + (r() < 0.35 ? 2 + r() * 4 : 0.2);
    }
    // 奥の中層・高層ビル（見た目だけ）
    for (let x = X0; x > X1; ) {
      const w = 12 + r() * 20;
      const tall = r() < 0.4;
      const h = tall ? 60 + r() * 90 : 12 + r() * 16;
      const d = tall ? 160 + r() * 200 : Z.back + r() * 50;
      const m = tall
        ? mat({ map: (() => { const t = towerTex(r); t.repeat.set(Math.round(w / 8), Math.round(h / 16)); return t; })() })
        : mat({ map: facadeTex(r, Math.round(h / 3.2), Math.max(3, Math.round(w / 3)), { shop: false, glass: r() < 0.3 }) });
      const side = mat({ color: tall ? '#5d6b77' : '#8d877f' });
      const b = new T.Mesh(new T.BoxGeometry(w, h, 14), [side, side, side, side, m, side]);
      b.position.set(x - w / 2, h / 2, -d);
      b.receiveShadow = true;
      scene.add(b);
      x -= w + (tall ? 10 + r() * 30 : r() * 10);
    }
    // 名所（遠景）
    for (const lm of stage.landmarks || []) if (lm.kind === 'tokyoTower') tokyoTower(lm.x, -520);

    platforms.sort((a, b) => a.z - b.z);
    return platforms;
  }

  // 東京タワー（赤白のトラス）
  function tokyoTower(x, z) {
    const lattice = canvasTex(128, 512, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let y = 0; y < h; y += 64) {
        g.fillStyle = Math.floor(y / 64) % 2 ? '#f4f1ea' : '#e2471f';
        g.fillRect(0, y, w, 64);
      }
      g.globalCompositeOperation = 'destination-out';
      for (let y = 0; y < h; y += 16)
        for (let x2 = 0; x2 < w; x2 += 16) {
          g.beginPath();
          g.moveTo(x2 + 3, y + 8);
          g.lineTo(x2 + 8, y + 3);
          g.lineTo(x2 + 13, y + 8);
          g.lineTo(x2 + 8, y + 13);
          g.fill();
        }
    });
    const m = new T.MeshLambertMaterial({ map: lattice, transparent: true, alphaTest: 0.2, side: T.DoubleSide });
    const lower = new T.Mesh(new T.CylinderGeometry(12, 48, 150, 4, 1, true), m);
    lower.position.set(x, 75, z);
    lower.rotation.y = Math.PI / 4;
    scene.add(lower);
    const upper = new T.Mesh(new T.CylinderGeometry(3, 12, 150, 4, 1, true), m);
    upper.position.set(x, 225, z);
    upper.rotation.y = Math.PI / 4;
    scene.add(upper);
    for (const [y, s] of [[150, 22], [250, 12]]) {
      const deck = new T.Mesh(new T.CylinderGeometry(s, s, 10, 8), mat({ color: '#d9d6cf' }));
      deck.position.set(x, y, z);
      scene.add(deck);
    }
    const ant = new T.Mesh(new T.CylinderGeometry(0.8, 2, 40, 6), mat({ color: '#e2471f' }));
    ant.position.set(x, 320, z);
    scene.add(ant);
  }

  // 並走する車を出す（となりの車線）
  function spawnCar(x, speed, r) {
    const kinds = ['sedan', 'sedan', 'taxi', 'van'];
    const kind = kinds[Math.floor(r() * kinds.length)];
    const c = carMesh(r, kind);
    c.g.position.set(x, 0, -Z.lane);
    const p = { x0: x - c.L / 2, x1: x + c.L / 2, y: c.H, z: Z.lane, kind: 'solid', name: kind === 'taxi' ? 'タクシー' : '車', bodyY0: 0.2, car: c };
    const o = { c, p, x, speed };
    objects.push(o);
    platforms.push(p);
    return o;
  }
  function updateCars(dt, camX) {
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      o.x -= o.speed * dt;
      o.c.g.position.x = o.x;
      o.p.x0 = o.x - o.c.L / 2;
      o.p.x1 = o.x + o.c.L / 2;
      // 窓から大きく外れたら消す
      if (o.x > camX + 60 || o.x < camX - 90) {
        scene.remove(o.c.g);
        objects.splice(i, 1);
        platforms.splice(platforms.indexOf(o.p), 1);
      }
    }
  }

  function render(camX, bump) {
    camera.position.set(camX, CAM_Y + bump, 0);
    camera.lookAt(camX, CAM_Y + bump, -10);
    // 影の範囲を窓の前に合わせて動かす
    sun.position.set(camX - 55, 85, 30);
    sun.target.position.set(camX - 10, 0, -20);
    renderer.render(scene, camera);
  }

  window.ShasoWorld = { init, resize, build, render, spawnCar, updateCars, Z, CAM_Y, FOV, rngOf, get cars() { return objects; }, platformsList: () => platforms, debug: () => ({ renderer, scene, sun, camera }) };
})();
