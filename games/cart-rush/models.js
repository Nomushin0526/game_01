// カートラッシュ！ 3Dモデルとテクスチャ（Three.js）
// 座標: x = 右, y = 上, -z = 進行方向（ゲーム内の z をそのまま -z に置く）
(function () {
  'use strict';
  const T = window.THREE;

  // ---------- 共通の形と色 ----------
  const GEO = {
    box: new T.BoxGeometry(1, 1, 1),
    sphere: new T.SphereGeometry(1, 16, 12),
    sphereLow: new T.SphereGeometry(1, 10, 8),
    cyl: new T.CylinderGeometry(1, 1, 1, 14),
    cylLow: new T.CylinderGeometry(1, 1, 1, 8),
    cone: new T.ConeGeometry(1, 1, 16),
    plane: new T.PlaneGeometry(1, 1),
    circle: new T.CircleGeometry(1, 24),
    torus: new T.TorusGeometry(1, 0.12, 8, 20),
    ico: new T.IcosahedronGeometry(1, 1),
  };

  const matCache = new Map();
  function M(color, opts) {
    const key = color + (opts ? JSON.stringify(opts) : '');
    let m = matCache.get(key);
    if (!m) {
      m = new T.MeshLambertMaterial(Object.assign({ color }, opts || {}));
      matCache.set(key, m);
    }
    return m;
  }
  // ライトの影響を受けない（光っている部分用）
  function MB(color, opts) {
    const key = 'b' + color + (opts ? JSON.stringify(opts) : '');
    let m = matCache.get(key);
    if (!m) {
      m = new T.MeshBasicMaterial(Object.assign({ color }, opts || {}));
      matCache.set(key, m);
    }
    return m;
  }

  function mesh(geo, mat, parent, x, y, z, sx, sy, sz) {
    const m = new T.Mesh(geo, typeof mat === 'string' ? M(mat) : mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    if (parent) parent.add(m);
    return m;
  }
  const box = (p, w, h, d, x, y, z, c) => mesh(GEO.box, c, p, x, y, z, w, h, d);
  const ball = (p, r, x, y, z, c, sx = 1, sy = 1, sz = 1) => mesh(GEO.sphere, c, p, x, y, z, r * sx, r * sy, r * sz);
  const cyl = (p, r, h, x, y, z, c) => mesh(GEO.cyl, c, p, x, y, z, r, h, r);
  const UP = new T.Vector3(0, 1, 0);
  // 2点の間をつなぐ円柱（腕や脚）
  function limb(p, a, b, r, c) {
    const d = new T.Vector3().subVectors(b, a);
    const len = d.length();
    const m = mesh(GEO.cyl, c, p, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, r, len, r);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    return m;
  }

  // ---------- テクスチャ ----------
  const texCache = new Map();
  let maxAniso = 4;
  function setAnisotropy(v) {
    maxAniso = Math.min(8, v || 4);
  }
  function canvasTex(key, w, h, draw, repeat) {
    if (key && texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.anisotropy = maxAniso;
    if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
    if (key) texCache.set(key, t);
    return t;
  }
  // 同じ絵を、長さに合わせて繰り返したテクスチャ
  function repeated(base, key, rx, ry) {
    const k = key + '|' + rx.toFixed(2) + '|' + ry.toFixed(2);
    if (texCache.has(k)) return texCache.get(k);
    const t = base.clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(rx, ry);
    texCache.set(k, t);
    return t;
  }
  const FONT = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","Hiragino Sans",sans-serif';
  function textTex(text, bg, fg, w = 512, h = 128, opts = {}) {
    return canvasTex(`txt|${text}|${bg}|${fg}|${w}|${h}|${opts.border || ''}`, w, h, (g) => {
      if (bg) {
        g.fillStyle = bg;
        roundRect(g, 0, 0, w, h, opts.radius == null ? h * 0.18 : opts.radius);
        g.fill();
      }
      if (opts.border) {
        g.strokeStyle = opts.border;
        g.lineWidth = h * 0.06;
        roundRect(g, h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16, h * 0.12);
        g.stroke();
      }
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let size = h * (opts.size || 0.58);
      g.font = `900 ${size}px ${FONT}`;
      while (g.measureText(text).width > w * 0.9 && size > 8) {
        size -= 2;
        g.font = `900 ${size}px ${FONT}`;
      }
      g.fillText(text, w / 2, h / 2 + h * 0.03);
    });
  }
  function roundRect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const t = amt < 0 ? 0 : 255;
    const k = Math.abs(amt);
    return '#' + c.map((v) => Math.round(v + (t - v) * k).toString(16).padStart(2, '0')).join('');
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 丸い影
  const shadowTex = canvasTex('shadow', 128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0.42)');
    gr.addColorStop(0.6, 'rgba(0,0,0,0.22)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  const shadowMat = new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  function blob(parent, rx, rz, x = 0, z = 0) {
    const m = mesh(GEO.plane, shadowMat, parent, x, 0.03, z, rx * 2, rz * 2, 1);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    return m;
  }

  // 床・道路
  const floorTex = canvasTex('floor', 256, 256, (g, w, h) => {
    g.fillStyle = '#ece6da';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e0d9cb';
    g.fillRect(0, 0, w / 2, h / 2);
    g.fillRect(w / 2, h / 2, w / 2, h / 2);
    g.fillStyle = 'rgba(150,140,120,0.35)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h / 2, w, 2);
    g.fillRect(0, 0, 2, h);
    g.fillRect(w / 2, 0, 2, h);
  });
  function roadTex(kind) {
    return canvasTex('road-' + kind, 256, 512, (g, w, h) => {
      g.fillStyle = kind === 'highway' ? '#4d5259' : '#595f67';
      g.fillRect(0, 0, w, h);
      const r = rng(kind === 'highway' ? 7 : 3);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
        g.fillRect(r() * w, r() * h, 2, 2);
      }
      const line = (x, col, dash) => {
        g.fillStyle = col;
        if (dash) g.fillRect(x - 4, 0, 8, h / 2);
        else g.fillRect(x - 4, 0, 8, h);
      };
      if (kind === 'avenue') {
        line(w * 0.03, '#f2f2f2');
        line(w * 0.97, '#f2f2f2');
        line(w / 3, '#ffffff', true);
        line((w * 2) / 3, '#ffffff', true);
      } else if (kind === 'highway') {
        line(w * 0.03, '#f7d354');
        line(w * 0.97, '#f2f2f2');
        line(w / 3, '#ffffff', true);
        line((w * 2) / 3, '#ffffff', true);
      } else {
        line(w * 0.04, '#f2f2f2');
        line(w * 0.96, '#f2f2f2');
        line(w / 2, '#ffffff', true);
      }
    });
  }
  function stripeTex(key, a, b) {
    return canvasTex(key, 8, 64, (g, w, h) => {
      g.fillStyle = a;
      g.fillRect(0, 0, w, h);
      g.fillStyle = b;
      g.fillRect(0, 0, w, h / 2);
    });
  }

  // ---------- 商品棚の絵（正面から見た図。幅4m × 高さ4.2m） ----------
  const SHELF_SETS = {
    produce: { back: '#eef3e6', items: [['crate', '#e74c3c'], ['crate', '#ff9f1a'], ['crate', '#7bc043'], ['crate', '#f5d142'], ['crate', '#8e5bb5'], ['leek', '#4caf50']] },
    fresh: { back: '#e3eef5', items: [['pack', '#e2646b'], ['pack', '#f19a9a'], ['pack', '#f3c4a8'], ['pack', '#9fb7c9'], ['pack', '#f08a5d'], ['eggs', '#fff3dc']] },
    daily: { back: '#eef0f4', items: [['bottle', '#4a90d9'], ['bottle', '#f28dbb'], ['bottle', '#7bc66b'], ['bottle', '#ffffff'], ['tissue', '#5fa4e6'], ['roll', '#f28dbb']] },
    snack: { back: '#f6efe3', items: [['bag', '#e84a4a'], ['bag', '#f5c542'], ['bag', '#4a90d9'], ['bag', '#7bc66b'], ['box', '#b07ad6'], ['box', '#ff9f43'], ['can', '#e84a4a'], ['jar', '#ff6fa8']] },
  };
  const PX = 128; // 1m あたりのピクセル
  function drawItemFront(g, type, col, x0, x1, yb, r) {
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    const Y = (m) => yb - m * PX; // 段の底から m メートル上
    const rect = (a, b, y0, y1, c) => {
      g.fillStyle = c;
      g.fillRect(a, Y(y1), b - a, Y(y0) - Y(y1));
    };
    const dot = (x, ym, rad, c) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(x, Y(ym), rad, 0, Math.PI * 2);
      g.fill();
    };
    switch (type) {
      case 'crate': {
        rect(x0 + 2, x1 - 2, 0, 0.2, '#b07a45');
        rect(x0 + 2, x1 - 2, 0.08, 0.1, '#8a5a30');
        const big = col === '#7bc043';
        const n = big ? 2 : 3;
        for (let k = 0; k < n; k++) dot(x0 + (w * (k + 0.5)) / n, big ? 0.32 : 0.27, (big ? 0.15 : 0.1) * PX, col);
        if (!big) for (let k = 0; k < 2; k++) dot(x0 + (w * (k + 1)) / 3, 0.42, 0.1 * PX, shade(col, -0.1));
        for (let k = 0; k < n; k++) dot(x0 + (w * (k + 0.5)) / n - 4, big ? 0.36 : 0.3, 4, 'rgba(255,255,255,0.5)');
        break;
      }
      case 'leek':
        for (let k = 0; k < 3; k++) {
          const a = x0 + 4 + (k * w) / 3;
          const b = a + w / 3 - 8;
          rect(a, b, 0, 0.24, '#f4f7ee');
          rect(a + 1, b - 1, 0.24, 0.58, col);
        }
        rect(x0, x1, 0.16, 0.21, '#e84a4a');
        break;
      case 'pack':
        for (let k = 0; k < 2; k++) {
          const yb2 = k * 0.2;
          rect(x0 + 2, x1 - 2, yb2, yb2 + 0.17, '#f7f7f7');
          rect(x0 + 7, x1 - 7, yb2 + 0.03, yb2 + 0.13, shade(col, k * 0.1));
          rect(x0 + 10, x0 + 26, yb2 + 0.04, yb2 + 0.07, '#ffffff');
          rect(x1 - 26, x1 - 8, yb2 + 0.09, yb2 + 0.15, '#ffd23f');
        }
        break;
      case 'eggs':
        for (let k = 0; k < 2; k++) {
          const yb2 = k * 0.2;
          rect(x0 + 2, x1 - 2, yb2, yb2 + 0.16, '#dfe6ea');
          for (let e = 0; e < 4; e++) {
            g.fillStyle = col;
            g.beginPath();
            g.ellipse(x0 + (w * (e + 0.5)) / 4, Y(yb2 + 0.08), 6, 8, 0, 0, Math.PI * 2);
            g.fill();
          }
        }
        break;
      case 'bottle':
        for (let k = 0; k < 2; k++) {
          const a = x0 + (k * w) / 2 + 3;
          const b = a + w / 2 - 6;
          const bw = b - a;
          rect(a, b, 0, 0.36, col);
          rect(a + bw * 0.2, b - bw * 0.2, 0.36, 0.45, col);
          rect(a + bw * 0.3, b - bw * 0.3, 0.45, 0.53, col === '#ffffff' ? '#4a90d9' : '#ffffff');
          rect(a, b, 0.1, 0.24, col === '#ffffff' ? '#7bc66b' : '#ffffff');
          rect(a + bw * 0.2, b - bw * 0.2, 0.14, 0.2, shade(col, -0.35));
          rect(a + 2, a + 5, 0.04, 0.34, 'rgba(255,255,255,0.35)');
        }
        break;
      case 'tissue':
        for (let k = 0; k < 2; k++) {
          const yb2 = k * 0.24;
          rect(x0 + 2, x1 - 2, yb2, yb2 + 0.22, '#ffffff');
          rect(x0 + 2, x1 - 2, yb2 + 0.03, yb2 + 0.1, col);
          rect(x0 + 18, x1 - 18, yb2 + 0.15, yb2 + 0.19, '#d6e4f0');
        }
        break;
      case 'roll':
        rect(x0 + 2, x1 - 2, 0, 0.52, '#fbfbfb');
        rect(x0 + 2, x1 - 2, 0.3, 0.4, col);
        for (let k = 1; k < 3; k++) rect(x0 + (w * k) / 3 - 1, x0 + (w * k) / 3 + 1, 0, 0.52, '#e0e0e0');
        break;
      case 'bag': {
        const top = 0.46 + r() * 0.06;
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(x0 + 3, Y(0));
        g.lineTo(x0 + 7, Y(top));
        g.lineTo(x1 - 7, Y(top));
        g.lineTo(x1 - 3, Y(0));
        g.closePath();
        g.fill();
        rect(x0 + 7, x1 - 7, top - 0.05, top + 0.02, shade(col, 0.35));
        dot(cx, 0.22, 0.09 * PX, '#ffffff');
        dot(cx, 0.22, 0.05 * PX, shade(col, -0.2));
        rect(x0 + 10, x1 - 10, 0.05, 0.1, shade(col, -0.25));
        break;
      }
      case 'box': {
        const h = 0.4 + r() * 0.12;
        rect(x0 + 2, x1 - 2, 0, h, col);
        rect(x0 + 6, x1 - 6, h * 0.45, h * 0.75, '#ffffff');
        rect(x0 + 10, x0 + 28, h * 0.52, h * 0.68, shade(col, -0.3));
        rect(x0 + 6, x1 - 6, h * 0.1, h * 0.18, shade(col, 0.3));
        break;
      }
      case 'can':
        for (let k = 0; k < 3; k++) {
          const a = x0 + (k * w) / 3 + 2;
          const b = a + w / 3 - 4;
          for (let s = 0; s < 2; s++) {
            const yb2 = s * 0.25;
            rect(a, b, yb2, yb2 + 0.23, k % 2 ? shade(col, 0.15) : col);
            rect(a, b, yb2 + 0.19, yb2 + 0.23, '#c9cfd4');
            rect(a, b, yb2 + 0.07, yb2 + 0.12, '#ffffff');
          }
        }
        break;
      case 'jar':
        rect(x0 + 5, x1 - 5, 0, 0.42, '#e2f0f6');
        rect(x0 + 7, x1 - 7, 0.42, 0.5, col);
        for (let k = 0; k < 6; k++) dot(x0 + 14 + (k % 3) * ((w - 28) / 2), 0.1 + Math.floor(k / 3) * 0.16, 6, ['#ff6b6b', '#ffd166', '#2ec4b6', '#b07ad6', '#ff9f43', '#5fa4e6'][k]);
        break;
      default:
        rect(x0, x1, 0, 0.5, col);
    }
  }
  function shelfTex(shelf, tint, variant) {
    const set = SHELF_SETS[shelf] || SHELF_SETS.snack;
    return canvasTex(`shelf|${shelf}|${variant}`, 512, 544, (g, W, H) => {
      const r = rng(variant * 977 + shelf.length * 31);
      const Y = (m) => H - m * PX;
      g.fillStyle = set.back;
      g.fillRect(0, 0, W, H);
      g.fillStyle = tint;
      g.fillRect(0, 0, W, 0.18 * PX);
      g.fillStyle = '#5f6970';
      g.fillRect(0, Y(0.2), W, 0.2 * PX);
      for (let row = 0; row < 5; row++) {
        const yb = 0.2 + row * 0.76;
        const base = Y(yb);
        for (let k = 0; k < 8; k++) {
          const pick = set.items[Math.floor(r() * set.items.length)];
          // 2つずつ同じ商品（フェイス）
          for (let d = 0; d < 2 && k < 8; d++, k++) drawItemFront(g, pick[0], pick[1], k * 64 + 2, k * 64 + 62, base, r);
          k--;
        }
        g.fillStyle = '#7d868e';
        g.fillRect(0, Y(yb), W, 0.09 * PX);
        g.fillStyle = '#fbf6e6';
        g.fillRect(0, Y(yb) + 2, W, 0.055 * PX);
        for (let k = 0; k < 8; k++) {
          g.fillStyle = k % 3 === 0 ? '#ff6b6b' : '#ffd23f';
          g.fillRect(k * 64 + 20, Y(yb) + 3, 22, 0.045 * PX);
        }
      }
      // ほんのり上からの光
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, 'rgba(255,255,255,0.12)');
      gr.addColorStop(1, 'rgba(0,0,0,0.08)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    });
  }

  // ジャンプ台の矢印
  const rampTex = canvasTex('ramp', 128, 256, (g, w, h) => {
    g.fillStyle = '#ff8a00';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2b2d42';
    g.fillRect(0, 0, 10, h);
    g.fillRect(w - 10, 0, 10, h);
    g.fillStyle = '#fff3b0';
    for (let k = 0; k < 3; k++) {
      const y = 30 + k * 80;
      g.beginPath();
      g.moveTo(16, y + 40);
      g.lineTo(w / 2, y);
      g.lineTo(w - 16, y + 40);
      g.lineTo(w - 16, y + 62);
      g.lineTo(w / 2, y + 22);
      g.lineTo(16, y + 62);
      g.closePath();
      g.fill();
    }
  });
  // 通行止め・バーの模様（赤白のしま＋黒いふち。昼の明るい道路でも目立つように）
  const stripeBarrierTex = canvasTex('barrier2', 256, 64, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8262d';
    for (let x = -h; x < w + h; x += 48) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 24, h);
      g.lineTo(x + 24 + h, 0);
      g.lineTo(x + h, 0);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = '#1d1f2e';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
  });
  const glowTex = canvasTex('glow', 64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });

  // ---------- 独自形状 ----------
  // 三角柱（屋根）: 幅1・高さ0.5・奥行き1、底辺が y=0
  function prismGeo() {
    const p = [
      [-0.5, 0], [0.5, 0], [0, 0.5],
    ];
    const v = [];
    const f = 0.5;
    const tri = (a, b, c) => v.push(...a, ...b, ...c);
    const P = (i, z) => [p[i][0], p[i][1], z];
    tri(P(0, f), P(1, f), P(2, f));
    tri(P(1, -f), P(0, -f), P(2, -f));
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      tri(P(a, f), P(a, -f), P(b, -f));
      tri(P(a, f), P(b, -f), P(b, f));
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }
  GEO.prism = prismGeo();

  // ジャンプ台: 手前 (z=0) で高さ0、奥 (z=-len) で高さ h。幅は x=-w..w
  function rampGeo(w, len, h) {
    const pos = [];
    const uv = [];
    const quad = (a, b, c, d, ua) => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      uv.push(...(ua || [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]));
    };
    const tri = (a, b, c) => {
      pos.push(...a, ...b, ...c);
      uv.push(0, 0, 0, 0, 0, 0);
    };
    // 斜面（矢印テクスチャ）
    quad([-w, 0, 0], [w, 0, 0], [w, h, -len], [-w, h, -len]);
    // 側面
    tri([-w, 0, 0], [-w, h, -len], [-w, 0, -len]);
    tri([w, 0, 0], [w, 0, -len], [w, h, -len]);
    // 奥の壁
    quad([w, 0, -len], [-w, 0, -len], [-w, h, -len], [w, h, -len]);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }

  // カートの金網
  const wireTex = canvasTex('wire', 128, 128, (g, w, h) => {
    g.fillStyle = 'rgba(200,212,224,0.28)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(110,125,140,0.95)';
    g.lineWidth = 3;
    g.beginPath();
    for (let k = 0; k <= 8; k++) {
      g.moveTo((k * w) / 8, 0);
      g.lineTo((k * w) / 8, h);
    }
    for (let k = 0; k <= 5; k++) {
      g.moveTo(0, (k * h) / 5);
      g.lineTo(w, (k * h) / 5);
    }
    g.stroke();
  });
  const wireMat = new T.MeshLambertMaterial({ map: wireTex, transparent: true, side: T.DoubleSide, depthWrite: false });

  // ---------- 主人公（主婦＋カート） ----------
  const SKIN = '#f3c9a5';
  function buildCart(parent, withGoods) {
    const g = new T.Group();
    parent.add(g);
    const frame = '#7d8b98';
    // カゴ（金網の絵を貼った半透明の箱）＋ フチ
    box(g, 0.84, 0.56, 0.95, 0, 0.72, -0.98, wireMat).renderOrder = 2;
    box(g, 0.86, 0.04, 0.04, 0, 1.0, -0.5, frame);
    box(g, 0.86, 0.04, 0.04, 0, 1.0, -1.46, frame);
    box(g, 0.04, 0.04, 0.98, -0.43, 1.0, -0.98, frame);
    box(g, 0.04, 0.04, 0.98, 0.43, 1.0, -0.98, frame);
    // 下の台と脚・車輪
    box(g, 0.7, 0.03, 0.8, 0, 0.2, -0.98, frame);
    for (const [x, z] of [[-0.36, -0.58], [0.36, -0.58], [-0.36, -1.38], [0.36, -1.38]]) {
      limb(g, new T.Vector3(x, 0.44, z), new T.Vector3(x * 0.9, 0.1, z), 0.018, frame);
      const w = cyl(g, 0.07, 0.05, x * 0.9, 0.07, z, '#2e3338');
      w.rotation.z = Math.PI / 2;
    }
    // 取っ手（赤）
    const hd = cyl(g, 0.032, 1.0, 0, 1.06, -0.44, '#e94f4f');
    hd.rotation.z = Math.PI / 2;
    limb(g, new T.Vector3(-0.42, 1.0, -0.5), new T.Vector3(-0.44, 1.06, -0.44), 0.02, frame);
    limb(g, new T.Vector3(0.42, 1.0, -0.5), new T.Vector3(0.44, 1.06, -0.44), 0.02, frame);
    if (withGoods) {
      const goods = new T.Group();
      g.add(goods);
      g.userData.goods = goods;
      const gg = goods;
      const bread = ball(gg, 0.11, -0.2, 1.02, -1.0, '#e0a85a', 1, 1, 2.6);
      bread.rotation.x = 0.5;
      cyl(gg, 0.035, 0.6, 0.05, 1.08, -1.2, '#4caf50').rotation.x = -0.35;
      cyl(gg, 0.036, 0.25, 0.05, 0.82, -1.08, '#f4f7ee').rotation.x = -0.35;
      box(gg, 0.16, 0.26, 0.16, 0.22, 0.95, -0.8, '#ffffff');
      box(gg, 0.165, 0.07, 0.165, 0.22, 0.95, -0.8, '#4a90d9');
      ball(gg, 0.1, -0.1, 1.02, -0.68, '#e74c3c');
      ball(gg, 0.1, 0.12, 1.0, -1.32, '#ff9f43');
      box(gg, 0.3, 0.12, 0.22, -0.16, 0.92, -1.3, '#f2c94c');
    }
    return g;
  }

  function buildPlayer() {
    const root = new T.Group(); // 位置と左右の傾き
    const shadow = blob(null, 0.7, 1.2);
    const flip = new T.Group(); // 回転技の軸（カートと主婦の中心）
    flip.position.set(0, 0.85, -0.6);
    root.add(flip);
    const rig = new T.Group();
    rig.position.set(0, -0.85, 0.6);
    flip.add(rig);

    const cart = buildCart(rig, true);

    // 主婦（うしろ姿。顔は進行方向 = -z）
    const body = new T.Group();
    rig.add(body);
    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new T.Group();
      hip.position.set(s * 0.09, 0.5, 0.05);
      body.add(hip);
      cyl(hip, 0.06, 0.38, 0, -0.2, 0, SKIN);
      cyl(hip, 0.062, 0.08, 0, -0.34, 0, '#ffffff');
      box(hip, 0.12, 0.08, 0.2, 0, -0.43, -0.03, '#e05252');
      legs.push(hip);
    }
    // スカート
    mesh(new T.CylinderGeometry(0.15, 0.24, 0.32, 16), M('#3d4f7a'), body, 0, 0.6, 0.05, 1, 1, 1);
    // 上半身（前かがみ）
    const torso = new T.Group();
    torso.position.set(0, 0.74, 0.05);
    torso.rotation.x = -0.35;
    body.add(torso);
    mesh(new T.CapsuleGeometry(0.16, 0.2, 4, 12), M('#ff8fa3'), torso, 0, 0.2, 0, 1, 1, 0.8);
    // エプロンの胸当て（前）と背中のひも・リボン
    box(torso, 0.22, 0.26, 0.02, 0, 0.18, -0.13, '#ffffff');
    for (const s of [-1, 1]) {
      const st = box(torso, 0.035, 0.36, 0.015, s * 0.0, 0.2, 0.135, '#ffffff');
      st.rotation.z = s * 0.55;
    }
    box(torso, 0.36, 0.035, 0.015, 0, 0.02, 0.13, '#ffffff');
    ball(torso, 0.06, -0.07, 0.03, 0.14, '#ffffff', 1, 0.7, 0.5);
    ball(torso, 0.06, 0.07, 0.03, 0.14, '#ffffff', 1, 0.7, 0.5);
    // 腕（肩から取っ手へ）
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = new T.Vector3(s * 0.19, 1.0, -0.02);
      const hand = new T.Vector3(s * 0.3, 1.06, -0.44);
      arms.push(limb(body, sh, hand, 0.045, SKIN));
      ball(body, 0.075, sh.x, sh.y, sh.z, '#ff8fa3');
      ball(body, 0.05, hand.x, hand.y, hand.z, SKIN);
    }
    // 頭（髪・おだんご）
    const head = new T.Group();
    head.position.set(0, 1.25, 0.0);
    body.add(head);
    ball(head, 0.21, 0, 0, -0.01, SKIN);
    ball(head, 0.225, 0, 0.03, 0.03, '#5a3b2a', 1, 1, 0.95);
    ball(head, 0.035, -0.21, -0.02, -0.02, SKIN);
    ball(head, 0.035, 0.21, -0.02, -0.02, SKIN);
    ball(head, 0.11, 0, 0.22, 0.12, '#5a3b2a');
    const tie = mesh(GEO.torus, M('#ffd166'), head, 0, 0.16, 0.09, 0.08, 0.08, 0.08);
    tie.rotation.x = 1.2;
    // 前髪と顔（回転技で前を向いたとき用）
    ball(head, 0.022, -0.07, 0.0, -0.205, '#2b2d42');
    ball(head, 0.022, 0.07, 0.0, -0.205, '#2b2d42');

    root.add(shadow);
    return { root, flip, rig, body, legs, shadow, head, goods: cart.userData.goods };
  }

  // ---------- 人（買い物客・店員） ----------
  function buildPerson(o) {
    const g = new T.Group();
    blob(g, 0.35, 0.3);
    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new T.Group();
      hip.position.set(s * 0.1, 0.5, 0);
      g.add(hip);
      cyl(hip, 0.065, 0.46, 0, -0.23, 0, o.pants || '#3c4a63');
      box(hip, 0.13, 0.07, 0.2, 0, -0.46, 0.03, '#3a3a3a');
      legs.push(hip);
    }
    mesh(new T.CapsuleGeometry(0.21, 0.3, 4, 12), M(o.shirt || '#5fa4e6'), g, 0, 0.85, 0, 1, 1, 0.75);
    for (const s of [-1, 1]) {
      const a = cyl(g, 0.055, 0.46, s * 0.27, 0.82, 0, shade(o.shirt || '#5fa4e6', -0.12));
      a.rotation.z = s * 0.12;
    }
    if (o.basket) {
      box(g, 0.3, 0.2, 0.22, 0.34, 0.6, 0.05, '#e94848');
      box(g, 0.1, 0.07, 0.1, 0.3, 0.73, 0.05, '#ffd3a1');
    }
    ball(g, 0.23, 0, 1.33, 0, '#f6cfae');
    const hair = ball(g, 0.245, 0, 1.39, -0.03, o.hair || '#3b2a20', 1, 0.85, 1);
    hair.scale.z = 0.24;
    ball(g, 0.028, -0.08, 1.33, 0.21, '#2b2d42');
    ball(g, 0.028, 0.08, 1.33, 0.21, '#2b2d42');
    ball(g, 0.035, 0, 1.24, 0.21, '#d9786b', 1, 0.5, 0.5);
    g.userData.legs = legs;
    return g;
  }

  function buildCat() {
    const g = new T.Group();
    blob(g, 0.3, 0.2);
    const body = ball(g, 0.16, 0, 0.26, 0, '#f39c4a', 1.8, 0.9, 0.9);
    body.userData.k = 1;
    ball(g, 0.13, 0.3, 0.38, 0, '#f39c4a');
    for (const s of [-1, 1]) {
      const ear = mesh(GEO.cone, M('#f39c4a'), g, 0.3, 0.52, s * 0.07, 0.05, 0.1, 0.05);
      ear.rotation.x = s * 0.2;
      ball(g, 0.02, 0.42, 0.4, s * 0.05, '#2b2d42');
    }
    for (const [x, z] of [[-0.15, -0.06], [-0.15, 0.06], [0.15, -0.06], [0.15, 0.06]]) cyl(g, 0.03, 0.18, x, 0.09, z, '#e88a35');
    const tail = limb(g, new T.Vector3(-0.28, 0.3, 0), new T.Vector3(-0.42, 0.6, 0), 0.03, '#f39c4a');
    tail.userData.tail = true;
    return g;
  }

  function buildBike(o) {
    const g = new T.Group();
    blob(g, 0.3, 0.9);
    for (const z of [-0.55, 0.55]) {
      const w = mesh(GEO.torus, M('#222222'), g, 0, 0.33, z, 0.3, 0.3, 0.3);
      w.rotation.y = Math.PI / 2;
    }
    limb(g, new T.Vector3(0, 0.35, 0.55), new T.Vector3(0, 0.75, 0.1), 0.025, '#d33');
    limb(g, new T.Vector3(0, 0.75, 0.1), new T.Vector3(0, 0.35, -0.55), 0.025, '#d33');
    box(g, 0.08, 0.05, 0.08, 0, 0.36, 0.86, '#ff3b3b');
    const rider = new T.Group();
    g.add(rider);
    mesh(new T.CapsuleGeometry(0.18, 0.28, 4, 10), M(o.shirt), rider, 0, 1.15, 0.05, 1, 1, 0.8).rotation.x = -0.3;
    ball(rider, 0.19, 0, 1.6, -0.05, o.hair);
    for (const s of [-1, 1]) limb(rider, new T.Vector3(s * 0.1, 0.9, 0.1), new T.Vector3(s * 0.12, 0.45, -0.05), 0.055, '#3c4a63');
    return g;
  }

  // ---------- 車 ----------
  function buildCar(o) {
    const g = new T.Group();
    const len = o.len;
    const w = o.w * 2;
    blob(g, o.w * 1.15, len * 0.6);
    const col = o.color;
    box(g, w, 0.56, len, 0, 0.5, 0, col);
    box(g, w - 0.18, 0.5, len * 0.5, 0, 1.02, 0.05, col);
    // 窓
    box(g, w - 0.14, 0.38, len * 0.46, 0, 1.03, 0.05, '#2d3e55');
    box(g, w - 0.3, 0.36, 0.02, 0, 1.03, len * 0.28 + 0.06, '#33465f');
    // テールランプ・ナンバー・バンパー（後ろ = +z）
    for (const s of [-1, 1]) box(g, w * 0.2, 0.14, 0.04, s * w * 0.36, 0.62, len / 2 + 0.01, MB('#ff3b3b'));
    box(g, w * 0.26, 0.13, 0.03, 0, 0.47, len / 2 + 0.01, '#ffffff');
    box(g, w + 0.04, 0.12, 0.12, 0, 0.27, len / 2 - 0.02, shade(col, -0.4));
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const wh = cyl(g, 0.3, 0.22, x * (w / 2 - 0.08), 0.3, z * len * 0.32, '#1d1d1d');
      wh.rotation.z = Math.PI / 2;
    }
    addBlinkers(g, w, 0.62, len / 2 + 0.03, 1.75);
    return g;
  }
  function buildTruck(o) {
    const g = new T.Group();
    const len = o.len;
    const w = o.w * 2;
    blob(g, o.w * 1.15, len * 0.6);
    // 荷台（後ろ）と運転席（前）
    box(g, w, 2.4, len - 1.7, 0, 1.7, 0.85, '#f4f4f4');
    box(g, w + 0.01, 0.28, len - 1.7, 0, 1.2, 0.85, o.color);
    const sign = new T.Mesh(GEO.plane, new T.MeshBasicMaterial({ map: textTex('おかいもの便', null, '#2b2d42', 512, 128) }));
    sign.position.set(0, 2.3, len / 2 + 0.01);
    sign.scale.set(w * 0.9, w * 0.22, 1);
    g.add(sign);
    box(g, 0.02, 2.3, 0.02, 0, 1.7, len / 2 + 0.01, '#c3c8cd');
    box(g, w * 0.92, 1.8, 1.5, 0, 1.3, -len / 2 + 0.75, o.color);
    box(g, w * 0.86, 0.6, 0.05, 0, 1.75, -len / 2 + 0.02 + 1.47, '#2d3e55');
    for (const s of [-1, 1]) box(g, w * 0.14, 0.18, 0.04, s * w * 0.38, 0.75, len / 2 + 0.01, MB('#ff3b3b'));
    for (const z of [-len * 0.35, len * 0.1, len * 0.35]) {
      for (const s of [-1, 1]) {
        const wh = cyl(g, 0.42, 0.3, s * (w / 2 - 0.1), 0.42, z, '#1d1d1d');
        wh.rotation.z = Math.PI / 2;
      }
    }
    addBlinkers(g, w, 0.75, len / 2 + 0.03, 3.3);
    return g;
  }
  // ウィンカー（後ろの角）と屋根の上の矢印
  // ウィンカー（後ろの角のランプ）
  //   近くではランプと光、遠くでは「画面上で一定の大きさ」の光の点で点滅が分かるようにする（矢印などは出さない）
  const flareMat = new T.SpriteMaterial({ map: glowTex, color: 0xffa000, transparent: true, depthWrite: false, sizeAttenuation: false });
  function addBlinkers(g, w, y, z) {
    const amber = MB('#ffb300');
    const L = box(g, w * 0.24, 0.22, 0.06, -w * 0.38, y, z, amber);
    const R = box(g, w * 0.24, 0.22, 0.06, w * 0.38, y, z, amber);
    const glowMat = new T.SpriteMaterial({ map: glowTex, color: 0xffa000, transparent: true, depthWrite: false, opacity: 0.9 });
    const gl = new T.Sprite(glowMat);
    gl.scale.set(1.6, 1.6, 1);
    g.add(gl);
    const flare = new T.Sprite(flareMat);
    flare.scale.set(0.07, 0.07, 1);
    g.add(flare);
    L.visible = R.visible = gl.visible = flare.visible = false;
    g.userData.blink = { L, R, gl, flare, y, z, w };
  }
  function setBlink(g, dir, on) {
    const b = g.userData.blink;
    if (!b) return;
    const show = !!dir && on;
    b.L.visible = show && dir < 0;
    b.R.visible = show && dir > 0;
    b.gl.visible = show;
    b.flare.visible = show;
    if (show) {
      b.gl.position.set(dir * b.w * 0.38, b.y, b.z + 0.1);
      b.flare.position.set(dir * b.w * 0.38, b.y, b.z + 0.15);
    }
  }

  // バス（後ろ = +z）
  function buildBus(o) {
    const g = new T.Group();
    const len = o.len;
    const w = o.w * 2;
    blob(g, o.w * 1.15, len * 0.55);
    box(g, w, 2.6, len, 0, 1.75, 0, o.color);
    box(g, w + 0.02, 0.5, len, 0, 0.7, 0, shade(o.color, -0.25));
    // 窓の帯
    box(g, w + 0.02, 0.9, len * 0.92, 0, 2.2, -0.1, '#2d3e55');
    box(g, w * 0.86, 0.9, 0.03, 0, 2.2, len / 2 + 0.01, '#2d3e55');
    const sign = new T.Mesh(GEO.plane, new T.MeshBasicMaterial({ map: textTex('下町循環', '#2b2d42', '#ffb300', 512, 128) }));
    sign.position.set(0, 2.85, len / 2 + 0.02);
    sign.scale.set(w * 0.6, 0.3, 1);
    g.add(sign);
    for (const s of [-1, 1]) box(g, w * 0.14, 0.3, 0.04, s * w * 0.38, 1.0, len / 2 + 0.01, MB('#ff3b3b'));
    for (const z of [-len * 0.32, len * 0.3]) {
      for (const s of [-1, 1]) {
        const wh = cyl(g, 0.48, 0.3, s * (w / 2 - 0.1), 0.48, z, '#1d1d1d');
        wh.rotation.z = Math.PI / 2;
      }
    }
    addBlinkers(g, w, 1.0, len / 2 + 0.03, 3.4);
    return g;
  }

  // ---------- 小物・障害物 ----------
  // 立て看板（A型）。はね飛ばせる
  const KANBAN_TEXTS = [['本日特売', '#e84a4a'], ['コロッケ', '#ff9f1a'], ['もんじゃ', '#2ec4b6'], ['日替わり', '#5fa4e6'], ['大安売り', '#e84a4a']];
  function buildKanban(o) {
    const g = new T.Group();
    blob(g, 0.35, 0.3);
    const [txt, col] = KANBAN_TEXTS[Math.floor((o.seed || 0) * KANBAN_TEXTS.length)];
    const face = new T.MeshLambertMaterial({ map: textTex(txt, '#fffaf0', col, 128, 256, { border: col, radius: 10, size: 0.22 }) });
    for (const s of [-1, 1]) {
      const p = new T.Mesh(GEO.box, [M('#6b4f3a'), M('#6b4f3a'), M('#6b4f3a'), M('#6b4f3a'), face, face]);
      p.scale.set(0.55, 1.1, 0.04);
      p.position.set(0, 0.55, s * 0.14);
      p.rotation.x = -s * 0.22;
      g.add(p);
    }
    return g;
  }
  // 工事や駐車場の横バー（ジャンプで越えるかスライディングでくぐる）
  function buildBar(o) {
    const g = new T.Group();
    const w = o.w * 2;
    for (const s of [-1, 1]) {
      box(g, 0.14, 1.35, 0.14, s * (o.w + 0.05), 0.68, 0, '#e8e8e8');
      box(g, 0.4, 0.08, 0.4, s * (o.w + 0.05), 0.04, 0, '#666666');
    }
    const stripe = new T.MeshBasicMaterial({ map: stripeBarrierTex });
    const bar = new T.Mesh(GEO.box, [M('#b81d23'), M('#b81d23'), M('#ffffff'), M('#b81d23'), stripe, stripe]);
    bar.scale.set(w + 0.1, 0.34, 0.1);
    bar.position.set(0, 1.18, 0);
    g.add(bar);
    addWarnLamps(g, [-(o.w + 0.05), o.w + 0.05], 1.55);
    return g;
  }
  // のれん・横断幕（スライディングでくぐる）
  const NOREN = [['ようこそ', '#2b4c7e'], ['商店街', '#a33b3b'], ['夏まつり', '#2f7d5b'], ['大売出し', '#a33b3b']];
  function buildNoren(o, market) {
    const g = new T.Group();
    const w = o.w * 2;
    const [txt, col] = market ? ['特売セール', '#e84a4a'] : NOREN[Math.floor((o.seed || 0) * NOREN.length)];
    const tex = textTex(txt, col, '#ffffff', 512, 160, { radius: 0, size: 0.55 });
    const cloth = new T.Mesh(GEO.plane, new T.MeshLambertMaterial({ map: tex, side: T.DoubleSide }));
    cloth.scale.set(w, 0.95, 1);
    cloth.position.set(0, 1.6, 0);
    g.add(cloth);
    // 吊るす棒とひも（天井・アーケードから下がる）
    const rod = cyl(g, 0.04, w + 0.3, 0, 2.12, 0, '#6b4f3a');
    rod.rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) cyl(g, 0.012, 2.5, s * (w / 2), 3.35, 0, '#888888');
    return g;
  }

  function buildCone() {
    const g = new T.Group();
    blob(g, 0.3, 0.3);
    box(g, 0.5, 0.06, 0.5, 0, 0.03, 0, '#e8590c');
    mesh(GEO.cone, M('#ff7a1a'), g, 0, 0.42, 0, 0.2, 0.72, 0.2);
    mesh(new T.CylinderGeometry(0.105, 0.135, 0.12, 16), M('#ffffff'), g, 0, 0.42, 0, 1, 1, 1);
    return g;
  }
  function buildBarrier() {
    const g = new T.Group();
    blob(g, 1.1, 0.3);
    for (const s of [-1, 1]) {
      box(g, 0.08, 0.9, 0.08, s * 0.85, 0.45, 0, '#666666');
      box(g, 0.08, 0.06, 0.6, s * 0.85, 0.03, 0, '#666666');
    }
    const stripe = new T.MeshBasicMaterial({ map: stripeBarrierTex });
    const panel = new T.Mesh(GEO.box, [M('#b81d23'), M('#b81d23'), M('#ffffff'), M('#b81d23'), stripe, stripe]);
    panel.scale.set(2.0, 0.55, 0.12);
    panel.position.set(0, 0.65, 0);
    g.add(panel);
    addWarnLamps(g, [-0.75, 0.75], 1.05);
    return g;
  }
  // 点滅する警告ランプ（遠くからでも見えるよう、画面上で一定の大きさの光も付ける）
  const warnFlareMat = new T.SpriteMaterial({ map: glowTex, color: 0xff3a1a, transparent: true, depthWrite: false, sizeAttenuation: false });
  function addWarnLamps(g, xs, y) {
    const lamps = [];
    for (const x of xs) {
      cyl(g, 0.02, y - 0.6, x, (y + 0.6) / 2, 0, '#555555');
      const lamp = ball(g, 0.11, x, y, 0, MB('#ff5a1f'));
      const flare = new T.Sprite(warnFlareMat);
      flare.scale.set(0.05, 0.05, 1);
      flare.position.set(x, y, 0.15);
      g.add(flare);
      lamps.push({ lamp, flare });
    }
    g.userData.warn = lamps;
  }
  function setWarn(g, on) {
    for (const l of g.userData.warn || []) {
      l.flare.visible = on;
      l.lamp.material = on ? MB('#ffb21f') : MB('#8a2a10');
    }
  }
  function buildDisplay() {
    const g = new T.Group();
    blob(g, 0.95, 0.6);
    const front = new T.MeshLambertMaterial({ map: textTex('特売', '#e84a4a', '#ffffff', 256, 128, { radius: 0, size: 0.7 }) });
    const wagon = new T.Mesh(GEO.box, [M('#c23a3a'), M('#c23a3a'), M('#f2d16b'), M('#c23a3a'), front, M('#c23a3a')]);
    wagon.scale.set(1.6, 0.78, 0.9);
    wagon.position.y = 0.39;
    g.add(wagon);
    const cols = ['#ff9f43', '#f5f1e6', '#5aa0e0', '#7bc66b'];
    for (let k = 0; k < 4; k++) box(g, 0.3, 0.2, 0.6, -0.6 + k * 0.4, 0.88, 0, cols[k]);
    box(g, 0.04, 0.8, 0.04, 0, 1.3, 0.35, '#555555');
    const pop = new T.Mesh(GEO.plane, new T.MeshBasicMaterial({ map: textTex('SALE', '#ffe14d', '#e84a4a', 256, 128), transparent: true }));
    pop.position.set(0, 1.75, 0.37);
    pop.scale.set(0.84, 0.42, 1);
    g.add(pop);
    return g;
  }
  function buildBoxes() {
    const g = new T.Group();
    blob(g, 0.7, 0.5);
    const label = new T.MeshLambertMaterial({ map: textTex('みかん', '#c9965c', '#7a4d1f', 256, 128, { radius: 0, size: 0.4 }) });
    const mk = (w, h, d, y, x) => {
      const m = new T.Mesh(GEO.box, [M('#a97a45'), M('#a97a45'), M('#ddb27a'), M('#a97a45'), label, M('#a97a45')]);
      m.scale.set(w, h, d);
      m.position.set(x, y, 0);
      g.add(m);
      box(g, w * 0.1, h + 0.005, d + 0.005, x, y, 0, '#e8cfa0');
    };
    mk(1.1, 0.6, 0.6, 0.3, 0);
    mk(0.7, 0.5, 0.5, 0.85, -0.05);
    return g;
  }
  function buildWetSign() {
    const g = new T.Group();
    blob(g, 0.35, 0.3);
    const puddle = mesh(GEO.circle, MB('#9fd0f2', { transparent: true, opacity: 0.5, depthWrite: false }), g, 0.3, 0.02, 0.1, 0.6, 0.35, 1);
    puddle.rotation.x = -Math.PI / 2;
    const signMat = new T.MeshLambertMaterial({ map: textTex('!', '#ffd31a', '#2b2d42', 128, 128, { radius: 10, size: 0.7 }) });
    for (const s of [-1, 1]) {
      const p = new T.Mesh(GEO.box, [M('#ffd31a'), M('#ffd31a'), M('#ffd31a'), M('#ffd31a'), signMat, signMat]);
      p.scale.set(0.42, 0.85, 0.03);
      p.position.set(0, 0.42, s * 0.12);
      p.rotation.x = -s * 0.28;
      g.add(p);
    }
    return g;
  }
  // 放置カート（障害物）: 遠くで小さく見えるので部品を少なめにした簡易版
  function buildStrayCart() {
    const g = new T.Group();
    blob(g, 0.55, 0.7);
    const frame = '#7d8b98';
    box(g, 0.84, 0.56, 0.95, 0, 0.72, 0, M('#c3ced8', { transparent: true, opacity: 0.55 }));
    box(g, 0.86, 0.05, 0.97, 0, 1.0, 0, frame);
    box(g, 0.7, 0.03, 0.8, 0, 0.2, 0, frame);
    for (const s of [-1, 1]) box(g, 0.03, 0.4, 0.8, s * 0.33, 0.24, 0, frame);
    const hd = cyl(g, 0.032, 1.0, 0, 1.06, 0.54, '#3b8ad9');
    hd.rotation.z = Math.PI / 2;
    for (const z of [-0.4, 0.4]) {
      const w = cyl(g, 0.07, 0.7, 0, 0.07, z, '#2e3338');
      w.rotation.z = Math.PI / 2;
    }
    return g;
  }

  const rampMat = new T.MeshLambertMaterial({ map: rampTex, emissive: '#5a2a00' });
  const rampUsedMat = new T.MeshLambertMaterial({ color: '#9a9a9a' });
  function buildRamp(r) {
    const g = new T.Group();
    const geo = rampGeo(r.w, r.len, r.h);
    const m = new T.Mesh(geo, rampMat);
    g.add(m);
    // 遠くからでも見えるよう、床に光るふち
    const halo = mesh(GEO.plane, MB('#ffd23f', { transparent: true, opacity: 0.55, depthWrite: false }), g, 0, 0.02, -r.len / 2, r.w * 2 + 0.6, r.len + 0.8, 1);
    halo.rotation.x = -Math.PI / 2;
    // 支柱
    for (const s of [-1, 1]) box(g, 0.08, r.h, 0.08, s * (r.w - 0.1), r.h / 2, -r.len + 0.05, '#7a3a10');
    g.userData.ramp = m;
    g.userData.halo = halo;
    return g;
  }
  function markRampUsed(g) {
    g.userData.ramp.material = rampUsedMat;
    g.userData.halo.visible = false;
  }

  // チェックポイント／ゴールのゲート
  function buildGate(roadW, label, goal) {
    const g = new T.Group();
    const RW = roadW + 0.3;
    for (const s of [-1, 1]) {
      cyl(g, 0.14, 3.4, s * RW, 1.7, 0, '#ffffff');
      cyl(g, 0.145, 0.4, s * RW, 1.4, 0, goal ? '#ef476f' : '#ff8c42');
    }
    const bannerMat = new T.MeshBasicMaterial({ map: textTex(label, goal ? '#ef476f' : '#ff8c42', '#ffffff', 1024, 160, { border: '#ffffff', radius: 30 }) });
    const banner = new T.Mesh(GEO.plane, bannerMat);
    banner.position.set(0, 3.0, 0);
    banner.scale.set(RW * 2 + 0.4, 0.8, 1);
    g.add(banner);
    const back = banner.clone();
    back.rotation.y = Math.PI;
    g.add(back);
    // 床のチェック柄
    const chk = canvasTex('chk-' + goal, 128, 32, (c, w, h) => {
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 4; j++) {
          c.fillStyle = (i + j) % 2 ? '#ffffff' : goal ? '#222222' : '#ff8c42';
          c.fillRect(i * 8, j * 8, 8, 8);
        }
    });
    const floor = mesh(GEO.plane, new T.MeshBasicMaterial({ map: chk }), g, 0, 0.025, -0.4, RW * 2, 0.8, 1);
    floor.rotation.x = -Math.PI / 2;
    g.userData.bannerMat = bannerMat;
    g.userData.label = label;
    g.userData.RW = RW;
    return g;
  }
  function setGatePassed(g) {
    g.userData.bannerMat.map = textTex(g.userData.label, '#3bb273', '#ffffff', 1024, 160, { border: '#ffffff', radius: 30 });
    g.userData.bannerMat.needsUpdate = true;
  }

  // ゴールの景色
  function buildRegisters() {
    const g = new T.Group();
    [-2.2, 0, 2.2].forEach((x, k) => {
      box(g, 0.5, 1.0, 2.6, x + 0.55, 0.5, -1.3, '#dfe5ea');
      box(g, 0.3, 0.35, 0.4, x + 0.55, 1.18, -0.5, '#3d4f6b');
      box(g, 0.22, 0.1, 0.02, x + 0.55, 1.25, -0.29, MB('#7ee0a8'));
      const p = buildPerson({ shirt: '#2ec4b6', hair: '#3b2a20', pants: '#2f3640' });
      p.position.set(x - 0.15, 0, -1.4);
      g.add(p);
      const sign = new T.Mesh(GEO.plane, new T.MeshBasicMaterial({ map: textTex(String(k + 1), '#2ec4b6', '#ffffff', 128, 128) }));
      sign.position.set(x, 3.0, 0);
      sign.scale.set(0.7, 0.7, 1);
      g.add(sign);
      cyl(g, 0.03, 1.2, x, 3.9, 0, '#8e979f');
    });
    return g;
  }
  function buildHouseBig(label, roofCol) {
    const g = new T.Group();
    box(g, 6.8, 3.4, 7, 0, 1.7, -3.5, '#fff4dc');
    mesh(GEO.prism, M(roofCol || '#d9534f'), g, 0, 3.4, -3.5, 7.6, 4.2, 7.4);
    box(g, 1.2, 2.2, 0.1, 0, 1.1, 0.02, '#8a5a3c');
    for (const s of [-1, 1]) box(g, 1.4, 1.0, 0.1, s * 2.2, 2.2, 0.02, '#9fd3f0');
    const sign = new T.Mesh(GEO.plane, new T.MeshBasicMaterial({ map: textTex(label, '#ffffff', '#d9534f', 512, 128) }));
    sign.position.set(0, 4.1, 0.2);
    sign.scale.set(2.4, 0.6, 1);
    g.add(sign);
    return g;
  }
  function buildStore() {
    const g = new T.Group();
    box(g, 9.2, 3.6, 8, 0, 1.8, -4, '#f7f3ea');
    const sign = new T.Mesh(GEO.plane, new T.MeshBasicMaterial({ map: textTex('SUPER となりまち', '#e84a4a', '#ffffff', 1024, 160, { radius: 0 }) }));
    sign.position.set(0, 3.2, 0.03);
    sign.scale.set(9.2, 0.86, 1);
    g.add(sign);
    for (let k = 0; k < 10; k++) box(g, 0.92, 0.3, 0.6, -4.14 + k * 0.92, 2.55, 0.3, k % 2 ? '#ffffff' : '#2ec4b6');
    box(g, 2.6, 2.1, 0.06, 0, 1.05, 0.03, '#bfe3f2');
    for (const s of [-1, 1]) box(g, 2.3, 1.3, 0.06, s * 3.2, 1.2, 0.03, '#bfe3f2');
    const sale = new T.Mesh(GEO.plane, new T.MeshBasicMaterial({ map: textTex('タイムセール', '#ffe14d', '#e84a4a', 512, 128) }));
    sale.position.set(-3.2, 1.3, 0.08);
    sale.scale.set(1.8, 0.45, 1);
    g.add(sale);
    return g;
  }

  window.CartModels = {
    GEO,
    M,
    MB,
    mesh,
    box,
    ball,
    cyl,
    limb,
    blob,
    canvasTex,
    repeated,
    textTex,
    shade,
    rng,
    setAnisotropy,
    floorTex,
    roadTex,
    stripeTex,
    shelfTex,
    glowTex,
    buildPlayer,
    buildPerson,
    buildCat,
    buildBike,
    buildCar,
    buildTruck,
    buildBus,
    buildKanban,
    buildBar,
    setWarn,
    buildNoren,
    setBlink,
    buildCone,
    buildBarrier,
    buildDisplay,
    buildBoxes,
    buildWetSign,
    buildStrayCart,
    buildRamp,
    markRampUsed,
    buildGate,
    setGatePassed,
    buildRegisters,
    buildHouseBig,
    buildStore,
  };
})();
