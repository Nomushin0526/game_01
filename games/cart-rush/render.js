// カートラッシュ！ 描画エンジン
// 疑似3D: ワールド座標 (x: 左右, y: 高さ, z: 奥行き) をカメラから透視投影して Canvas 2D に描く。
(function () {
  'use strict';

  const SEG = 2; // 床を区切る長さ
  const DRAW = 95; // 描画距離
  const CAM_BACK = 7; // プレイヤーの何m後ろにカメラを置くか（遠くを大きめに見せる）
  const CEIL = 9.5; // スーパーの天井の高さ
  const THEMES = window.CartThemes;

  const R = { W: 0, H: 0, f: 1, k: 1, hz: 0, camY: 3.2, camX: 0, camZ: 0, fog: '#efe9dc' };
  let ctx = null;

  // ---------- 小物ユーティリティ ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function hash(a, b, c) {
    let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const colorCache = new Map();
  function rgb(hex) {
    let v = colorCache.get(hex);
    if (!v) {
      const n = parseInt(hex.slice(1), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      colorCache.set(hex, v);
    }
    return v;
  }
  function toHex(r, g, b) {
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  // amt: -1(黒) 〜 1(白)
  function shade(hex, amt) {
    const A = rgb(hex);
    const t = amt < 0 ? 0 : 255;
    const k = Math.abs(amt);
    return toHex(
      Math.round(A[0] + (t - A[0]) * k),
      Math.round(A[1] + (t - A[1]) * k),
      Math.round(A[2] + (t - A[2]) * k)
    );
  }
  function mix(a, b, k) {
    if (k <= 0) return a;
    const A = rgb(a);
    const B = rgb(b);
    return toHex(
      Math.round(A[0] + (B[0] - A[0]) * k),
      Math.round(A[1] + (B[1] - A[1]) * k),
      Math.round(A[2] + (B[2] - A[2]) * k)
    );
  }

  function zoneAt(stage, z) {
    const zs = stage.zones;
    for (let i = 0; i < zs.length; i++) if (z < zs[i].to) return zs[i];
    return zs[zs.length - 1];
  }

  // ---------- 投影と基本図形 ----------
  function project(x, y, z) {
    const dz = z - R.camZ;
    if (dz < 0.12) return null;
    const s = R.f / dz;
    return { x: R.W / 2 + (x - R.camX) * s, y: R.hz + (R.camY - y) * s, s };
  }

  function poly(pts, fill) {
    for (let i = 0; i < pts.length; i++) if (!pts[i]) return;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill();
  }
  // 水平面（床・天井）
  function flat(x0, x1, y, z0, z1, fill) {
    poly([project(x0, y, z0), project(x1, y, z0), project(x1, y, z1), project(x0, y, z1)], fill);
  }
  // 進行方向と平行な縦の壁
  function wall(x, y0, y1, z0, z1, fill) {
    poly([project(x, y0, z0), project(x, y1, z0), project(x, y1, z1), project(x, y0, z1)], fill);
  }
  // 箱。手前の面のスクリーン矩形を返す（細部を描き込むため）
  function box(x0, x1, y0, y1, z0, z1, front, top, side) {
    z0 = Math.max(z0, R.camZ + 0.3);
    if (z1 <= z0) return null;
    const a = project(x0, y1, z0);
    const b = project(x1, y1, z0);
    const c = project(x1, y0, z0);
    const d = project(x0, y0, z0);
    const e = project(x0, y1, z1);
    const f = project(x1, y1, z1);
    const g = project(x1, y0, z1);
    const h = project(x0, y0, z1);
    if (!a) return null;
    if (R.camX < x0) poly([a, e, h, d], side);
    else if (R.camX > x1) poly([b, f, g, c], side);
    if (R.camY > y1) poly([a, b, f, e], top);
    ctx.fillStyle = front;
    ctx.fillRect(d.x, a.y, c.x - d.x, d.y - a.y);
    return { l: d.x, r: c.x, t: a.y, b: d.y, w: c.x - d.x, h: d.y - a.y, s: a.s };
  }
  function rr(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function rrFill(x, y, w, h, r, fill) {
    rr(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function circle(x, y, r, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
    ctx.fill();
  }
  function ellipse(x, y, rx, ry, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function shadow(x, y, rx) {
    ellipse(x, y, rx, rx * 0.28, 'rgba(0,0,0,0.18)');
  }
  function text(str, x, y, size, fill, weight, maxWidth) {
    if (size < 5) return;
    ctx.font = `${weight || 900} ${size}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif`;
    ctx.fillStyle = fill;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (maxWidth) ctx.fillText(str, x, y, maxWidth);
    else ctx.fillText(str, x, y);
  }

  // ---------- 設定 ----------
  function setContext(c) {
    ctx = c;
  }
  // 縦長のスマホ画面を前提にカメラを決める
  //   k: プレイヤー位置での「1m = 何px」。スーパーの通路が画面幅に収まるようにする
  //   プレイヤーを画面の下 76% あたり、地平線を上 40% あたりに置く
  function setView(W, H) {
    R.W = W;
    R.H = H;
    R.k = (0.42 * W) / THEMES.market.roadW;
    R.f = R.k * CAM_BACK;
    const playerY = 0.76 * H;
    R.camY = clamp((playerY - 0.4 * H) / R.k, 3.2, 8.5);
    R.hz = playerY - R.camY * R.k;
  }
  function setCamera(x, z) {
    R.camX = x;
    R.camZ = z;
  }

  // ---------- 背景 ----------
  const CLOUDS = [
    [0.12, 0.3, 1.0],
    [0.38, 0.16, 0.7],
    [0.63, 0.36, 1.2],
    [0.86, 0.2, 0.8],
  ];
  function drawBackground(zone, t) {
    const W = R.W;
    const H = R.H;
    const hz = R.hz;
    if (zone.type === 'market') {
      R.fog = '#efe9dc';
      ctx.fillStyle = R.fog;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    R.fog = '#e2f3fb';
    const g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, '#7cc8f2');
    g.addColorStop(1, R.fog);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, hz + 1);
    // 雲
    for (const [cx, cy, sc] of CLOUDS) {
      const x = ((cx * W + t * 6 * sc - R.camX * 4) % (W + 200) + W + 200) % (W + 200) - 100;
      const y = cy * hz;
      const s = (40 + 30 * sc) * (W / 1200 + 0.4);
      ellipse(x, y, s, s * 0.35, 'rgba(255,255,255,0.9)');
      ellipse(x - s * 0.5, y + s * 0.08, s * 0.6, s * 0.28, 'rgba(255,255,255,0.9)');
      ellipse(x + s * 0.55, y + s * 0.1, s * 0.55, s * 0.25, 'rgba(255,255,255,0.9)');
    }
    // 遠景の山
    const off = -R.camX * 3;
    const mh = zone.type === 'highway' ? 0.16 : 0.09;
    ctx.fillStyle = zone.type === 'highway' ? '#a9c9de' : '#b9dcc0';
    ctx.beginPath();
    ctx.moveTo(0, hz);
    for (let x = 0; x <= W + 20; x += 20) {
      const k = (x + off) * 0.004;
      const y = hz - (Math.sin(k) * 0.5 + Math.sin(k * 2.7 + 1) * 0.3 + 0.9) * H * mh * 0.6;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, hz);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = zone.type === 'highway' ? '#94c49a' : '#9fd08b';
    ctx.beginPath();
    ctx.moveTo(0, hz + 1);
    for (let x = 0; x <= W + 20; x += 20) {
      const k = (x + off * 1.6) * 0.007;
      const y = hz - (Math.sin(k + 2) * 0.4 + 0.6) * H * 0.035;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, hz + 1);
    ctx.closePath();
    ctx.fill();
    // 地面
    ctx.fillStyle = mix('#84c55f', R.fog, 0.6);
    ctx.fillRect(0, hz, W, H - hz);
  }

  // ---------- 床・壁（区間ごと） ----------
  // 商品棚: コーナーごとの商品ラインナップ（[種類, 色] の組）
  const SHELF_SETS = {
    produce: {
      back: '#eef3e6',
      items: [
        ['crate', '#e74c3c'], // りんご
        ['crate', '#ff9f1a'], // みかん
        ['crate', '#7bc043'], // キャベツ
        ['crate', '#f5d142'], // レモン
        ['crate', '#8e5bb5'], // なす
        ['leek', '#4caf50'],
      ],
    },
    fresh: {
      back: '#e3eef5',
      items: [
        ['pack', '#e2646b'], // 牛肉
        ['pack', '#f19a9a'], // 豚肉
        ['pack', '#f3c4a8'], // 鶏肉
        ['pack', '#9fb7c9'], // 魚
        ['pack', '#f08a5d'], // 鮭
        ['eggs', '#fff3dc'],
      ],
    },
    daily: {
      back: '#eef0f4',
      items: [
        ['bottle', '#4a90d9'],
        ['bottle', '#f28dbb'],
        ['bottle', '#7bc66b'],
        ['bottle', '#ffffff'],
        ['tissue', '#5fa4e6'],
        ['roll', '#f28dbb'],
      ],
    },
    snack: {
      back: '#f6efe3',
      items: [
        ['bag', '#e84a4a'],
        ['bag', '#f5c542'],
        ['bag', '#4a90d9'],
        ['bag', '#7bc66b'],
        ['box', '#b07ad6'],
        ['box', '#ff9f43'],
        ['can', '#e84a4a'],
        ['jar', '#ff6fa8'],
      ],
    },
  };
  const FAR_PALETTE = ['#f4f1ea', '#e85d5d', '#5aa0e0', '#f5c542', '#7bc66b', '#b07ad6', '#ff9f5a', '#ffffff'];
  const SHELF_H = 4.2; // 棚の高さ
  const ROWS = 5; // 段数
  const ROW_STEP = 0.76;

  // 棚の1マスに商品を1つ描く。x は棚の面、side は -1(左) / 1(右)、y0 は段の底
  function drawProduct(type, col, x, side, y0, za, zb, seed, F) {
    const L = zb - za;
    const zc = (za + zb) / 2;
    const fx = x - side * 0.12; // 棚から少し手前（通路側）
    switch (type) {
      case 'crate': {
        wall(x, y0, y0 + 0.2, za, zb, F('#b07a45'));
        wall(x, y0 + 0.08, y0 + 0.1, za, zb, F('#8a5a30'));
        const big = col === '#7bc043';
        const n = big ? 2 : 3;
        for (let k = 0; k < n; k++) {
          const p = project(fx, y0 + (big ? 0.32 : 0.27), za + (L * (k + 0.5)) / n);
          if (p) {
            circle(p.x, p.y, (big ? 0.15 : 0.1) * p.s, F(col));
            circle(p.x - 0.03 * p.s, p.y - 0.03 * p.s, 0.03 * p.s, 'rgba(255,255,255,0.45)');
          }
        }
        if (!big) {
          for (let k = 0; k < 2; k++) {
            const p = project(fx, y0 + 0.42, za + (L * (k + 1)) / 3);
            if (p) circle(p.x, p.y, 0.1 * p.s, F(shade(col, -0.08)));
          }
        }
        break;
      }
      case 'leek':
        for (let k = 0; k < 3; k++) {
          const a = za + 0.04 + k * (L / 3);
          const b = a + L / 3 - 0.06;
          wall(x, y0, y0 + 0.24, a, b, F('#f4f7ee'));
          wall(x, y0 + 0.24, y0 + 0.58, a + 0.01, b - 0.01, F(col));
        }
        wall(x, y0 + 0.16, y0 + 0.21, za, zb, F('#e84a4a'));
        break;
      case 'pack':
        for (let k = 0; k < 2; k++) {
          const yb = y0 + k * 0.2;
          wall(x, yb, yb + 0.17, za + 0.01, zb - 0.01, F('#f7f7f7'));
          wall(x, yb + 0.03, yb + 0.13, za + 0.05, zb - 0.05, F(shade(col, k * 0.1)));
          wall(x, yb + 0.04, yb + 0.07, za + 0.08, za + 0.2, F('#ffffff'));
          wall(x, yb + 0.09, yb + 0.15, zb - 0.2, zb - 0.06, F('#ffd23f'));
        }
        break;
      case 'eggs':
        for (let k = 0; k < 2; k++) {
          const yb = y0 + k * 0.2;
          wall(x, yb, yb + 0.16, za + 0.01, zb - 0.01, F('#dfe6ea'));
          for (let e = 0; e < 3; e++) {
            const p = project(fx * 0.98 + x * 0.02, yb + 0.08, za + (L * (e + 0.5)) / 3);
            if (p) ellipse(p.x, p.y, 0.05 * p.s, 0.065 * p.s, F(col));
          }
        }
        break;
      case 'bottle':
        for (let k = 0; k < 2; k++) {
          const a = za + k * (L / 2) + 0.02;
          const b = a + L / 2 - 0.04;
          const w = b - a;
          wall(x, y0, y0 + 0.36, a, b, F(col));
          wall(x, y0 + 0.36, y0 + 0.45, a + w * 0.2, b - w * 0.2, F(col));
          wall(x, y0 + 0.45, y0 + 0.53, a + w * 0.3, b - w * 0.3, F(col === '#ffffff' ? '#4a90d9' : '#ffffff'));
          wall(x, y0 + 0.1, y0 + 0.24, a, b, F(col === '#ffffff' ? '#7bc66b' : '#ffffff'));
          wall(x, y0 + 0.14, y0 + 0.2, a + w * 0.2, b - w * 0.2, F(shade(col, -0.35)));
        }
        break;
      case 'tissue':
        for (let k = 0; k < 2; k++) {
          const yb = y0 + k * 0.24;
          wall(x, yb, yb + 0.22, za + 0.01, zb - 0.01, F('#ffffff'));
          wall(x, yb + 0.03, yb + 0.1, za + 0.01, zb - 0.01, F(col));
          wall(x, yb + 0.15, yb + 0.19, za + 0.15, zb - 0.15, F('#d6e4f0'));
        }
        break;
      case 'roll':
        wall(x, y0, y0 + 0.52, za + 0.01, zb - 0.01, F('#fbfbfb'));
        wall(x, y0 + 0.3, y0 + 0.4, za + 0.01, zb - 0.01, F(col));
        for (let k = 1; k < 3; k++) wall(x, y0, y0 + 0.52, za + (L * k) / 3 - 0.01, za + (L * k) / 3 + 0.01, F('#e3e3e3'));
        break;
      case 'bag': {
        const top = y0 + 0.46 + seed * 0.06;
        poly(
          [project(x, y0, za + 0.02), project(x, top, za + 0.06), project(x, top, zb - 0.06), project(x, y0, zb - 0.02)],
          F(col)
        );
        wall(x, top - 0.05, top + 0.02, za + 0.06, zb - 0.06, F(shade(col, 0.35)));
        const p = project(fx * 0.3 + x * 0.7, y0 + 0.22, zc);
        if (p) {
          circle(p.x, p.y, 0.09 * p.s, F('#ffffff'));
          circle(p.x, p.y, 0.05 * p.s, F(shade(col, -0.2)));
        }
        wall(x, y0 + 0.05, y0 + 0.1, za + 0.08, zb - 0.08, F(shade(col, -0.25)));
        break;
      }
      case 'box': {
        const h = 0.4 + seed * 0.12;
        wall(x, y0, y0 + h, za + 0.01, zb - 0.01, F(col));
        wall(x, y0 + h * 0.45, y0 + h * 0.75, za + 0.05, zb - 0.05, F('#ffffff'));
        wall(x, y0 + h * 0.52, y0 + h * 0.68, za + 0.09, za + 0.22, F(shade(col, -0.3)));
        wall(x, y0 + h * 0.1, y0 + h * 0.18, za + 0.05, zb - 0.05, F(shade(col, 0.3)));
        break;
      }
      case 'can':
        for (let k = 0; k < 3; k++) {
          const a = za + k * (L / 3) + 0.015;
          const b = a + L / 3 - 0.03;
          for (let s = 0; s < 2; s++) {
            const yb = y0 + s * 0.25;
            wall(x, yb, yb + 0.23, a, b, F(k % 2 ? shade(col, 0.15) : col));
            wall(x, yb + 0.19, yb + 0.23, a, b, F('#c9cfd4'));
            wall(x, yb + 0.07, yb + 0.12, a, b, F('#ffffff'));
          }
        }
        break;
      case 'jar':
        wall(x, y0, y0 + 0.42, za + 0.04, zb - 0.04, F('#e2f0f6'));
        wall(x, y0 + 0.42, y0 + 0.5, za + 0.06, zb - 0.06, F(col));
        for (let k = 0; k < 4; k++) {
          const p = project(fx * 0.4 + x * 0.6, y0 + 0.08 + (k % 2) * 0.16 + 0.04, za + L * (0.25 + (k >> 1) * 0.45));
          if (p) circle(p.x, p.y, 0.05 * p.s, F(FAR_PALETTE[(k * 3 + 1) % FAR_PALETTE.length]));
        }
        break;
      default:
        wall(x, y0, y0 + 0.5, za, zb, F(col));
    }
  }

  function drawShelfSide(zone, i, side, z0, z1, F, near) {
    const RW = THEMES.market.roadW;
    const x = side * RW;
    const set = SHELF_SETS[zone.shelf] || SHELF_SETS.snack;
    // 棚の天板と、その向こうに並ぶ別の通路の棚（上から見える）
    flat(x, x + side * 1.4, SHELF_H, z0, z1, F('#8e979f'));
    flat(x + side * 1.4, x + side * 2.2, SHELF_H - 0.6, z0, z1, F('#d8d1c2'));
    flat(x + side * 2.2, x + side * 3.6, SHELF_H, z0, z1, F(i % 2 ? '#a7afb6' : '#9ea6ad'));
    flat(x + side * 3.6, x + side * 16, SHELF_H - 0.6, z0, z1, F('#cfc7b7'));
    // 天板の上のストック段ボール
    if (near && hash(i, side, 77) < 0.35) {
      const bx = x + side * 0.3;
      box(Math.min(bx, bx + side * 0.9), Math.max(bx, bx + side * 0.9), SHELF_H, SHELF_H + 0.45, i * SEG + 0.2, i * SEG + 1.2, '#c9965c', '#ddb27a', '#a97a45');
    }
    // 背板と足元
    wall(x, 0, SHELF_H, z0, z1, F(set.back));
    wall(x, 0, 0.2, z0, z1, F('#5f6970'));
    // 一番上にコーナーカラーの帯
    wall(x, SHELF_H - 0.18, SHELF_H, z0, z1, F(zone.tint));

    const zs = i * SEG;
    for (let r = 0; r < ROWS; r++) {
      const yb = 0.2 + r * ROW_STEP;
      if (!near) {
        for (let b = 0; b < 2; b++) {
          const za = Math.max(z0, zs + b);
          const zb = zs + b + 0.94;
          if (zb <= za) continue;
          const h = hash(i, side * 7 + r, b);
          const col = h < 0.4 ? zone.tint : FAR_PALETTE[Math.floor(hash(i, r, b + side * 3) * FAR_PALETTE.length)];
          wall(x, yb, yb + 0.5, za, zb, F(col));
        }
      } else {
        for (let k = 0; k < 4; k++) {
          let za = zs + k * 0.5 + 0.02;
          const zb = za + 0.46;
          if (zb <= R.camZ + 0.35) continue;
          za = Math.max(za, R.camZ + 0.35);
          // 同じ商品を2つずつ並べる（フェイス）
          const pick = set.items[Math.floor(hash(i * 2 + (k >> 1), side * 11 + r, 5) * set.items.length)];
          drawProduct(pick[0], pick[1], x, side, yb, za, zb, hash(i, k, r), F);
        }
      }
      // 棚板と値札
      wall(x, yb - 0.09, yb, z0, z1, F('#7d868e'));
      wall(x, yb - 0.075, yb - 0.02, z0, z1, F('#fbf6e6'));
      if (near) {
        for (let k = 0; k < 2; k++) {
          const zc = zs + k + 0.5;
          if (zc - 0.1 > R.camZ + 0.35) wall(x, yb - 0.07, yb - 0.025, zc - 0.1, zc + 0.1, F(k % 2 ? '#ffd23f' : '#ff6b6b'));
        }
      }
    }
  }

  function drawSegment(zone, i, z0, z1) {
    const dz = (z0 + z1) / 2 - R.camZ;
    const k = clamp((dz - DRAW * 0.4) / (DRAW * 0.6), 0, 1);
    const F = (c) => mix(c, R.fog, k);
    const th = THEMES[zone.type];
    const RW = th.roadW;

    if (zone.type === 'market') {
      flat(-RW - 16, RW + 16, CEIL, z0, z1, F(i % 2 ? '#d9dcdf' : '#d1d5d9'));
      if (i % 4 === 0) flat(-0.8, 0.8, CEIL, z0 + 0.4, z1 - 0.4, F('#fffbe8'));
      flat(-RW, RW, 0, z0, z1, F(i % 2 ? '#ede8dd' : '#e1dbce'));
      if (i % 2 === 0) flat(-0.05, 0.05, 0, z0, z1, F('#d3ccbd'));
      const near = dz < 36;
      // 視点に近い側の棚を後から描く（カメラが右寄りなら左の棚が手前に見える）
      const order = R.camX > 0 ? [1, -1] : [-1, 1];
      for (const side of order) drawShelfSide(zone, i, side, z0, z1, F, near);
      return;
    }

    // 屋外
    flat(-140, 140, 0, z0, z1, F(i % 2 ? '#8fd16a' : '#84c55f'));
    if (zone.type === 'street') {
      flat(-RW - 1.6, RW + 1.6, 0, z0, z1, F(i % 2 ? '#dcd8cf' : '#d4d0c6'));
      flat(-RW - 0.18, RW + 0.18, 0, z0, z1, F('#b8b3a8'));
      flat(-RW, RW, 0, z0, z1, F(i % 2 ? '#5f656d' : '#5a6068'));
      flat(-RW + 0.22, -RW + 0.34, 0, z0, z1, F('#f2f2f2'));
      flat(RW - 0.34, RW - 0.22, 0, z0, z1, F('#f2f2f2'));
      if (i % 2 === 0) flat(-0.07, 0.07, 0, z0, z1, F('#ffffff'));
    } else {
      flat(-RW - 1.3, RW + 1.3, 0, z0, z1, F('#6f747b'));
      flat(-RW, RW, 0, z0, z1, F(i % 2 ? '#51565d' : '#4d5259'));
      flat(-RW + 0.15, -RW + 0.3, 0, z0, z1, F('#f7d354'));
      flat(RW - 0.3, RW - 0.15, 0, z0, z1, F('#f2f2f2'));
      if (i % 2 === 0) {
        flat(-RW / 3 - 0.07, -RW / 3 + 0.07, 0, z0, z1, F('#ffffff'));
        flat(RW / 3 - 0.07, RW / 3 + 0.07, 0, z0, z1, F('#ffffff'));
      }
      for (const side of [-1, 1]) {
        const x = side * (RW + 1.1);
        if (i % 2 === 0) wall(x, 0, 0.5, z0, Math.min(z1, z0 + 0.15), F('#8d949b'));
        wall(x, 0.45, 0.8, z0, z1, F('#d7dde3'));
        wall(x, 0.58, 0.66, z0, z1, F('#aab2ba'));
      }
    }
  }

  // ---------- 景色（区間ごとに決定的に配置） ----------
  function scenery(stage, i, list) {
    const z = i * SEG;
    const zone = zoneAt(stage, z + 1);
    const RW = THEMES[zone.type].roadW;
    if (zone.type === 'market') {
      if (i % 22 === 8) list.push({ kind: 'csign', x: 0, z: z, label: zone.name, tint: zone.tint });
      return;
    }
    if (zone.type === 'street') {
      if (i % 3 === 0) {
        for (const side of [-1, 1]) {
          const r = hash(i, side + 5, 1);
          const kind = r < 0.6 ? 'house' : 'tree';
          list.push({ kind, x: side * (RW + (kind === 'house' ? 4.6 : 3.0) + r * 1.5), z: z + r, seed: r, side });
        }
      }
      if (i % 5 === 2) list.push({ kind: 'pole', x: (hash(i, 9, 2) < 0.5 ? -1 : 1) * (RW + 1.0), z });
    } else {
      if (i % 7 === 0) for (const side of [-1, 1]) list.push({ kind: 'lamp', x: side * (RW + 1.7), z, side });
      if (i % 3 === 1) {
        for (const side of [-1, 1]) {
          if (hash(i, side + 3, 4) < 0.6) list.push({ kind: 'tree', x: side * (RW + 4 + hash(i, side + 7, 5) * 7), z, seed: hash(i, 1, side) });
        }
      }
      if (i % 60 === 30) {
        const km = Math.max(1, Math.round((stage.length - z) / 100));
        list.push({ kind: 'hwsign', x: RW + 2.8, z, label: `わが家まで ${km}km` });
      }
    }
  }

  // ---------- スプライト ----------
  function drawPlayer(G, t) {
    const P = G.player;
    if (G.invuln > 0 && Math.floor(G.invuln * 14) % 2 === 0) return;
    const px = P.x;
    const pz = P.z;
    const cz0 = pz + 0.5;
    const cz1 = pz + 1.45;
    const w = 0.42;
    const yb = 0.42;
    const yt = 0.98;

    // 影
    const sh = project(px, 0, pz + 0.6);
    if (sh) shadow(sh.x, sh.y, 0.75 * sh.s);

    // カート: 車輪と脚
    ctx.strokeStyle = '#7b8894';
    ctx.lineCap = 'round';
    for (const [wx, wz] of [
      [-0.36, cz1 - 0.08],
      [0.36, cz1 - 0.08],
      [-0.36, cz0 + 0.08],
      [0.36, cz0 + 0.08],
    ]) {
      const top = project(px + wx, yb, wz);
      const bot = project(px + wx, 0.08, wz);
      if (!top || !bot) continue;
      ctx.lineWidth = Math.max(1, 0.05 * bot.s);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bot.x, bot.y);
      ctx.stroke();
      ellipse(bot.x, bot.y, 0.07 * bot.s, 0.09 * bot.s, '#2e3338');
    }
    // 奥の面
    const fa = project(px - w, yt, cz1);
    const fb = project(px + w, yb, cz1);
    if (fa && fb) {
      ctx.fillStyle = 'rgba(150,165,180,0.85)';
      ctx.fillRect(fa.x, fa.y, fb.x - fa.x, fb.y - fa.y);
    }
    // 中の食材（カゴから少しはみ出す）
    const goods = [
      { dx: -0.2, dz: 0.75, h: 0.32, c: '#f5d08a', type: 'bread' },
      { dx: 0.18, dz: 0.7, h: 0.22, c: '#ffffff', type: 'milk' },
      { dx: 0.02, dz: 0.45, h: 0.42, c: '#59b35a', type: 'leek' },
      { dx: -0.12, dz: 0.3, h: 0.12, c: '#e74c3c', type: 'ball' },
      { dx: 0.24, dz: 0.32, h: 0.12, c: '#ff9f43', type: 'ball' },
    ];
    for (const gd of goods) {
      const b = project(px + gd.dx, yt - 0.15, cz0 + gd.dz);
      const tp = project(px + gd.dx, yt + gd.h, cz0 + gd.dz);
      if (!b || !tp) continue;
      const s = b.s;
      if (gd.type === 'ball') circle(tp.x, tp.y + 0.06 * s, 0.11 * s, gd.c);
      else if (gd.type === 'leek') {
        ctx.fillStyle = '#f4f7ee';
        ctx.fillRect(b.x - 0.04 * s, (b.y + tp.y) / 2, 0.08 * s, b.y - (b.y + tp.y) / 2);
        ctx.fillStyle = gd.c;
        ctx.fillRect(b.x - 0.05 * s, tp.y, 0.1 * s, (b.y - tp.y) / 2);
      } else if (gd.type === 'milk') {
        ctx.fillStyle = gd.c;
        ctx.fillRect(tp.x - 0.09 * s, tp.y, 0.18 * s, b.y - tp.y);
        ctx.fillStyle = '#4a90d9';
        ctx.fillRect(tp.x - 0.09 * s, tp.y + (b.y - tp.y) * 0.35, 0.18 * s, (b.y - tp.y) * 0.25);
      } else {
        rrFill(tp.x - 0.14 * s, tp.y, 0.28 * s, b.y - tp.y, 0.08 * s, gd.c);
      }
    }
    // 側面・手前の面（金網）
    wall(px - w, yb, yt, cz0, cz1, 'rgba(170,184,198,0.75)');
    wall(px + w, yb, yt, cz0, cz1, 'rgba(170,184,198,0.75)');
    const na = project(px - w, yt, cz0);
    const nb = project(px + w, yb, cz0);
    if (na && nb) {
      const nw = nb.x - na.x;
      const nh = nb.y - na.y;
      ctx.fillStyle = 'rgba(205,215,225,0.45)';
      ctx.fillRect(na.x, na.y, nw, nh);
      ctx.strokeStyle = '#8796a5';
      ctx.lineWidth = Math.max(1, nw * 0.012);
      ctx.beginPath();
      for (let k = 1; k < 7; k++) {
        ctx.moveTo(na.x + (nw * k) / 7, na.y);
        ctx.lineTo(na.x + (nw * k) / 7, nb.y);
      }
      for (let k = 1; k < 4; k++) {
        ctx.moveTo(na.x, na.y + (nh * k) / 4);
        ctx.lineTo(nb.x, na.y + (nh * k) / 4);
      }
      ctx.stroke();
      ctx.lineWidth = Math.max(1.5, nw * 0.03);
      ctx.strokeStyle = '#6f7d8b';
      ctx.strokeRect(na.x, na.y, nw, nh);
    }
    // 取っ手
    const ha = project(px - w - 0.06, 1.07, cz0 - 0.05);
    const hb = project(px + w + 0.06, 1.0, cz0 - 0.05);
    if (ha && hb) rrFill(ha.x, ha.y, hb.x - ha.x, hb.y - ha.y, (hb.y - ha.y) / 2, '#e94f4f');

    // ---- 主婦（うしろ姿） ----
    const p = project(px, 0, pz);
    if (!p) return;
    const s = p.s;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(P.steer * 0.1);
    const run = Math.sin(P.phase);
    const liftL = Math.max(0, run) * 0.12 * s;
    const liftR = Math.max(0, -run) * 0.12 * s;
    const bounce = Math.abs(run) * 0.03 * s;
    // 脚
    ctx.fillStyle = '#f1c7a3';
    ctx.fillRect(-0.15 * s, -0.46 * s - liftL, 0.11 * s, 0.4 * s);
    ctx.fillRect(0.04 * s, -0.46 * s - liftR, 0.11 * s, 0.4 * s);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-0.15 * s, -0.12 * s - liftL, 0.11 * s, 0.07 * s);
    ctx.fillRect(0.04 * s, -0.12 * s - liftR, 0.11 * s, 0.07 * s);
    rrFill(-0.17 * s, -0.06 * s - liftL, 0.15 * s, 0.07 * s, 0.03 * s, '#e05252');
    rrFill(0.02 * s, -0.06 * s - liftR, 0.15 * s, 0.07 * s, 0.03 * s, '#e05252');
    ctx.translate(0, -bounce);
    // スカート
    ctx.fillStyle = '#3d4f7a';
    ctx.beginPath();
    ctx.moveTo(-0.15 * s, -0.7 * s);
    ctx.lineTo(0.15 * s, -0.7 * s);
    ctx.lineTo(0.22 * s, -0.4 * s);
    ctx.lineTo(-0.22 * s, -0.4 * s);
    ctx.closePath();
    ctx.fill();
    // 上着
    rrFill(-0.17 * s, -1.04 * s, 0.34 * s, 0.38 * s, 0.07 * s, '#ff8fa3');
    // エプロンのひも（背中でクロス）とリボン
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 0.035 * s);
    ctx.beginPath();
    ctx.moveTo(-0.12 * s, -1.02 * s);
    ctx.lineTo(0.1 * s, -0.72 * s);
    ctx.moveTo(0.12 * s, -1.02 * s);
    ctx.lineTo(-0.1 * s, -0.72 * s);
    ctx.moveTo(-0.17 * s, -0.71 * s);
    ctx.lineTo(0.17 * s, -0.71 * s);
    ctx.stroke();
    const wob = Math.sin(t * 14) * 0.02 * s;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -0.71 * s);
    ctx.lineTo(-0.13 * s, -0.78 * s + wob);
    ctx.lineTo(-0.13 * s, -0.63 * s + wob);
    ctx.closePath();
    ctx.moveTo(0, -0.71 * s);
    ctx.lineTo(0.13 * s, -0.78 * s - wob);
    ctx.lineTo(0.13 * s, -0.63 * s - wob);
    ctx.closePath();
    ctx.fill();
    circle(0, -0.71 * s, 0.035 * s, '#f0e6d8');
    ctx.restore();

    // 腕（肩から取っ手へ）
    if (ha && hb) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(P.steer * 0.1);
      ctx.translate(-p.x, -p.y - bounce);
      ctx.strokeStyle = '#f1c7a3';
      ctx.lineWidth = Math.max(2, 0.085 * s);
      ctx.lineCap = 'round';
      const shY = p.y - 0.97 * s;
      const handY = (ha.y + hb.y) / 2;
      ctx.beginPath();
      ctx.moveTo(p.x - 0.15 * s, shY);
      ctx.lineTo(ha.x + (hb.x - ha.x) * 0.18, handY);
      ctx.moveTo(p.x + 0.15 * s, shY);
      ctx.lineTo(ha.x + (hb.x - ha.x) * 0.82, handY);
      ctx.stroke();
      // 半袖
      circle(p.x - 0.15 * s, shY + 0.02 * s, 0.07 * s, '#ff8fa3');
      circle(p.x + 0.15 * s, shY + 0.02 * s, 0.07 * s, '#ff8fa3');
      ctx.restore();
    }

    // 頭（髪・おだんご）
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(P.steer * 0.1);
    ctx.translate(0, -bounce);
    ctx.fillStyle = '#f1c7a3';
    ctx.fillRect(-0.05 * s, -1.1 * s, 0.1 * s, 0.1 * s);
    circle(-0.235 * s, -1.2 * s, 0.05 * s, '#f1c7a3');
    circle(0.235 * s, -1.2 * s, 0.05 * s, '#f1c7a3');
    circle(0, -1.24 * s, 0.24 * s, '#5a3b2a');
    circle(-0.06 * s, -1.32 * s, 0.1 * s, 'rgba(255,255,255,0.08)');
    ellipse(0, -1.43 * s, 0.07 * s, 0.035 * s, '#ffd166');
    circle(0, -1.52 * s, 0.11 * s, '#5a3b2a');
    ctx.restore();
  }

  function drawShopper(o, t) {
    const p = project(o.x, 0, o.z);
    if (!p) return;
    const s = p.s;
    const step = Math.sin(t * 7 + o.seed * 20);
    shadow(p.x, p.y, 0.34 * s);
    ctx.fillStyle = o.pants;
    ctx.fillRect(p.x - 0.15 * s, p.y - (0.52 + step * 0.04) * s, 0.12 * s, 0.5 * s);
    ctx.fillRect(p.x + 0.03 * s, p.y - (0.52 - step * 0.04) * s, 0.12 * s, 0.5 * s);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(p.x - 0.17 * s, p.y - 0.06 * s, 0.15 * s, 0.06 * s);
    ctx.fillRect(p.x + 0.02 * s, p.y - 0.06 * s, 0.15 * s, 0.06 * s);
    rrFill(p.x - 0.29 * s, p.y - 1.08 * s, 0.1 * s, 0.48 * s, 0.05 * s, shade(o.shirt, -0.15));
    rrFill(p.x + 0.19 * s, p.y - 1.08 * s, 0.1 * s, 0.48 * s, 0.05 * s, shade(o.shirt, -0.15));
    rrFill(p.x - 0.22 * s, p.y - 1.12 * s, 0.44 * s, 0.64 * s, 0.12 * s, o.shirt);
    if (o.basket) {
      rrFill(p.x + 0.18 * s, p.y - 0.7 * s, 0.3 * s, 0.22 * s, 0.03 * s, '#e94848');
      ctx.fillStyle = '#ffd3a1';
      ctx.fillRect(p.x + 0.22 * s, p.y - 0.76 * s, 0.1 * s, 0.07 * s);
    }
    circle(p.x, p.y - 1.36 * s, 0.25 * s, '#f6cfae');
    ctx.fillStyle = o.hair;
    ctx.beginPath();
    ctx.arc(p.x, p.y - 1.4 * s, 0.27 * s, Math.PI * 1.02, Math.PI * 1.98);
    ctx.closePath();
    ctx.fill();
    if (s > 14) {
      circle(p.x - 0.09 * s, p.y - 1.33 * s, 0.03 * s, '#2b2d42');
      circle(p.x + 0.09 * s, p.y - 1.33 * s, 0.03 * s, '#2b2d42');
      ellipse(p.x, p.y - 1.23 * s, 0.05 * s, 0.025 * s, '#d9786b');
    }
  }

  function drawStrayCart(o) {
    const z0 = o.z - 0.45;
    const z1 = o.z + 0.45;
    for (const wx of [-0.34, 0.34]) {
      const b = project(o.x + wx, 0.06, Math.max(z0 + 0.05, R.camZ + 0.3));
      if (b) ellipse(b.x, b.y, 0.06 * b.s, 0.08 * b.s, '#2e3338');
    }
    const p = project(o.x, 0, Math.max(o.z, R.camZ + 0.3));
    if (p) shadow(p.x, p.y, 0.5 * p.s);
    const f = box(o.x - 0.4, o.x + 0.4, 0.4, 0.95, z0, z1, 'rgba(200,210,222,0.75)', 'rgba(160,175,190,0.55)', 'rgba(170,184,198,0.75)');
    if (!f) return;
    ctx.strokeStyle = '#8796a5';
    ctx.lineWidth = Math.max(1, f.w * 0.015);
    ctx.beginPath();
    for (let k = 1; k < 6; k++) {
      ctx.moveTo(f.l + (f.w * k) / 6, f.t);
      ctx.lineTo(f.l + (f.w * k) / 6, f.b);
    }
    ctx.moveTo(f.l, f.t + f.h / 2);
    ctx.lineTo(f.r, f.t + f.h / 2);
    ctx.stroke();
    ctx.strokeStyle = '#6f7d8b';
    ctx.strokeRect(f.l, f.t, f.w, f.h);
    ctx.fillStyle = '#3b8ad9';
    ctx.fillRect(f.l - f.w * 0.05, f.t - f.h * 0.14, f.w * 1.1, f.h * 0.1);
  }

  function drawDisplay(o) {
    const z0 = o.z - o.len / 2;
    const z1 = o.z + o.len / 2;
    const p = project(o.x, 0, Math.max(z0, R.camZ + 0.3));
    if (!p) return;
    shadow(p.x, p.y, 0.95 * p.s);
    const f = box(o.x - 0.8, o.x + 0.8, 0, 0.78, z0, z1, '#e84a4a', '#f2d16b', '#c23a3a');
    if (!f) return;
    // 上に積まれた商品
    for (let k = 0; k < 4; k++) {
      const bx = o.x - 0.6 + k * 0.4;
      box(bx - 0.15, bx + 0.15, 0.78, 0.98, z0 + 0.15, z1 - 0.15, ['#ff9f43', '#f5f1e6', '#5aa0e0', '#7bc66b'][k], '#ffffff', '#cccccc');
    }
    text('特売', (f.l + f.r) / 2, f.t + f.h * 0.5, f.h * 0.55, '#ffffff');
    // POP
    const pa = project(o.x, 1.75, z0 + 0.1);
    const pb = project(o.x, 0.98, z0 + 0.1);
    if (pa && pb) {
      ctx.fillStyle = '#555';
      ctx.fillRect(pa.x - 0.02 * pa.s, pa.y, 0.04 * pa.s, pb.y - pa.y);
      rrFill(pa.x - 0.42 * pa.s, pa.y - 0.12 * pa.s, 0.84 * pa.s, 0.4 * pa.s, 0.06 * pa.s, '#ffe14d');
      text('SALE', pa.x, pa.y + 0.08 * pa.s, 0.24 * pa.s, '#e84a4a');
    }
  }

  function drawBoxes(o) {
    const z0 = o.z - o.len / 2;
    const z1 = o.z + o.len / 2;
    const p = project(o.x, 0, Math.max(z0, R.camZ + 0.3));
    if (!p) return;
    shadow(p.x, p.y, 0.65 * p.s);
    const a = box(o.x - 0.55, o.x + 0.55, 0, 0.6, z0, z1, '#c9965c', '#ddb27a', '#a97a45');
    const b = box(o.x - 0.4, o.x + 0.3, 0.6, 1.1, z0 + 0.05, z1 - 0.05, '#d3a066', '#e3bb86', '#b0814c');
    ctx.fillStyle = 'rgba(255,240,200,0.6)';
    for (const f of [a, b]) if (f) ctx.fillRect(f.l + f.w * 0.45, f.t, f.w * 0.1, f.h);
    if (a) text('みかん', (a.l + a.r) / 2, a.t + a.h * 0.6, a.h * 0.28, '#7a4d1f', 800);
  }

  function drawWetSign(o) {
    const p = project(o.x, 0, o.z);
    if (!p) return;
    const s = p.s;
    shadow(p.x, p.y, 0.35 * s);
    ellipse(p.x + 0.3 * s, p.y - 0.01 * s, 0.45 * s, 0.1 * s, 'rgba(120,190,240,0.45)');
    ctx.fillStyle = '#ffd31a';
    ctx.beginPath();
    ctx.moveTo(p.x - 0.3 * s, p.y);
    ctx.lineTo(p.x - 0.12 * s, p.y - 0.85 * s);
    ctx.lineTo(p.x + 0.12 * s, p.y - 0.85 * s);
    ctx.lineTo(p.x + 0.3 * s, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#c9a200';
    ctx.lineWidth = Math.max(1, 0.03 * s);
    ctx.stroke();
    text('!', p.x, p.y - 0.42 * s, 0.42 * s, '#2b2d42');
  }

  function drawCar(o) {
    const z0 = o.z - o.len / 2;
    const z1 = o.z + o.len / 2;
    const x0 = o.x - o.w;
    const x1 = o.x + o.w;
    const p = project(o.x, 0, Math.max(z0, R.camZ + 0.3));
    if (!p) return;
    shadow(p.x, p.y, o.w * 1.25 * p.s);
    const body = box(x0, x1, 0.22, 0.78, z0, z1, o.color, shade(o.color, 0.12), shade(o.color, -0.22));
    if (!body) return;
    const cab = box(x0 + 0.1, x1 - 0.1, 0.78, 1.32, z0 + 0.75, z1 - 0.95, '#2d3e55', shade(o.color, 0.05), '#3a4c66');
    if (cab) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(cab.l + cab.w * 0.12, cab.t + cab.h * 0.15, cab.w * 0.25, cab.h * 0.6);
    }
    const { l, t, w, h, b } = body;
    ctx.fillStyle = '#ff3b3b';
    ctx.fillRect(l + w * 0.05, t + h * 0.15, w * 0.2, h * 0.24);
    ctx.fillRect(l + w * 0.75, t + h * 0.15, w * 0.2, h * 0.24);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(l + w * 0.38, t + h * 0.42, w * 0.24, h * 0.24);
    ctx.fillStyle = shade(o.color, -0.4);
    ctx.fillRect(l - w * 0.02, b - h * 0.2, w * 1.04, h * 0.2);
    ctx.fillStyle = '#1d1d1d';
    const wh = 0.22 * body.s;
    ctx.fillRect(l + w * 0.06, b, w * 0.18, wh);
    ctx.fillRect(l + w * 0.76, b, w * 0.18, wh);
  }

  function drawTruck(o) {
    const z0 = o.z - o.len / 2;
    const z1 = o.z + o.len / 2;
    const p = project(o.x, 0, Math.max(z0, R.camZ + 0.3));
    if (!p) return;
    shadow(p.x, p.y, o.w * 1.25 * p.s);
    box(o.x - 1.0, o.x + 1.0, 0.4, 2.2, z1 - 1.6, z1, o.color, shade(o.color, 0.15), shade(o.color, -0.2));
    const f = box(o.x - o.w, o.x + o.w, 0.5, 2.9, z0, z1 - 1.7, '#f4f4f4', '#ffffff', '#d4d8dc');
    if (!f) return;
    ctx.fillStyle = o.color;
    ctx.fillRect(f.l, f.t + f.h * 0.62, f.w, f.h * 0.12);
    ctx.strokeStyle = '#c3c8cd';
    ctx.lineWidth = Math.max(1, f.w * 0.01);
    ctx.beginPath();
    ctx.moveTo(f.l + f.w / 2, f.t);
    ctx.lineTo(f.l + f.w / 2, f.b);
    ctx.stroke();
    text('おかいもの便', f.l + f.w / 2, f.t + f.h * 0.35, f.h * 0.13, '#2b2d42');
    ctx.fillStyle = '#ff3b3b';
    ctx.fillRect(f.l + f.w * 0.04, f.b - f.h * 0.12, f.w * 0.12, f.h * 0.08);
    ctx.fillRect(f.r - f.w * 0.16, f.b - f.h * 0.12, f.w * 0.12, f.h * 0.08);
    ctx.fillStyle = '#1d1d1d';
    const wh = 0.5 * f.s;
    ctx.fillRect(f.l + f.w * 0.05, f.b, f.w * 0.2, wh);
    ctx.fillRect(f.r - f.w * 0.25, f.b, f.w * 0.2, wh);
  }

  function drawBike(o, t) {
    const p = project(o.x, 0, o.z);
    if (!p) return;
    const s = p.s;
    const pedal = Math.sin(t * 9 + o.seed * 10);
    shadow(p.x, p.y, 0.3 * s);
    ctx.fillStyle = '#222';
    rrFill(p.x - 0.04 * s, p.y - 0.64 * s, 0.08 * s, 0.64 * s, 0.04 * s, '#222');
    ctx.fillStyle = '#d33';
    ctx.fillRect(p.x - 0.05 * s, p.y - 0.75 * s, 0.1 * s, 0.06 * s);
    ctx.fillStyle = '#3c4a63';
    ctx.fillRect(p.x - 0.16 * s, p.y - (0.75 + pedal * 0.08) * s, 0.1 * s, 0.35 * s);
    ctx.fillRect(p.x + 0.06 * s, p.y - (0.75 - pedal * 0.08) * s, 0.1 * s, 0.35 * s);
    rrFill(p.x - 0.2 * s, p.y - 1.35 * s, 0.4 * s, 0.6 * s, 0.1 * s, o.shirt);
    circle(p.x, p.y - 1.55 * s, 0.2 * s, o.hair);
  }

  function drawCone(o) {
    const p = project(o.x, 0, o.z);
    if (!p) return;
    const s = p.s;
    shadow(p.x, p.y, 0.3 * s);
    ctx.fillStyle = '#e8590c';
    ctx.fillRect(p.x - 0.26 * s, p.y - 0.06 * s, 0.52 * s, 0.06 * s);
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.moveTo(p.x - 0.2 * s, p.y - 0.06 * s);
    ctx.lineTo(p.x - 0.05 * s, p.y - 0.75 * s);
    ctx.lineTo(p.x + 0.05 * s, p.y - 0.75 * s);
    ctx.lineTo(p.x + 0.2 * s, p.y - 0.06 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(p.x - 0.13 * s, p.y - 0.42 * s, 0.26 * s, 0.1 * s);
  }

  function drawBarrier(o) {
    const p = project(o.x, 0, o.z);
    if (!p) return;
    shadow(p.x, p.y, 1.05 * p.s);
    for (const lx of [-0.85, 0.85]) {
      const a = project(o.x + lx, 0.9, o.z);
      if (a) {
        ctx.fillStyle = '#666';
        ctx.fillRect(a.x - 0.04 * a.s, a.y, 0.08 * a.s, 0.9 * a.s);
      }
    }
    const f = box(o.x - 1.0, o.x + 1.0, 0.35, 0.85, o.z - 0.08, o.z + 0.08, '#ffd31a', '#e0b800', '#c9a200');
    if (!f) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.l, f.t, f.w, f.h);
    ctx.clip();
    ctx.fillStyle = '#2b2d42';
    const step = f.h * 0.9;
    for (let x = f.l - f.h; x < f.r + f.h; x += step * 2) {
      ctx.beginPath();
      ctx.moveTo(x, f.b);
      ctx.lineTo(x + step, f.b);
      ctx.lineTo(x + step + f.h, f.t);
      ctx.lineTo(x + f.h, f.t);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    const lamp = project(o.x, 1.05, o.z);
    if (lamp) circle(lamp.x, lamp.y, 0.1 * lamp.s, '#ff8c1a');
  }

  function drawCat(o, t) {
    const p = project(o.x, 0, o.z);
    if (!p) return;
    const s = p.s;
    const dir = o.vx < 0 ? -1 : 1;
    const step = Math.sin(t * 16) * 0.03 * s;
    shadow(p.x, p.y, 0.3 * s);
    ctx.fillStyle = '#e88a35';
    ctx.fillRect(p.x - 0.2 * s, p.y - 0.16 * s + step, 0.06 * s, 0.16 * s - step);
    ctx.fillRect(p.x + 0.14 * s, p.y - 0.16 * s - step, 0.06 * s, 0.16 * s + step);
    ellipse(p.x, p.y - 0.24 * s, 0.28 * s, 0.13 * s, '#f39c4a');
    const hx = p.x + dir * 0.28 * s;
    const hy = p.y - 0.36 * s;
    circle(hx, hy, 0.13 * s, '#f39c4a');
    ctx.fillStyle = '#f39c4a';
    ctx.beginPath();
    ctx.moveTo(hx - 0.12 * s, hy - 0.05 * s);
    ctx.lineTo(hx - 0.08 * s, hy - 0.2 * s);
    ctx.lineTo(hx - 0.01 * s, hy - 0.1 * s);
    ctx.moveTo(hx + 0.12 * s, hy - 0.05 * s);
    ctx.lineTo(hx + 0.08 * s, hy - 0.2 * s);
    ctx.lineTo(hx + 0.01 * s, hy - 0.1 * s);
    ctx.fill();
    circle(hx + dir * 0.05 * s, hy - 0.01 * s, 0.022 * s, '#2b2d42');
    ctx.strokeStyle = '#f39c4a';
    ctx.lineWidth = Math.max(1, 0.05 * s);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x - dir * 0.26 * s, p.y - 0.28 * s);
    ctx.quadraticCurveTo(p.x - dir * 0.45 * s, p.y - 0.4 * s, p.x - dir * 0.38 * s, p.y - 0.6 * s);
    ctx.stroke();
  }

  function drawItem(it, t) {
    const y = 0.6 + Math.sin(t * 4 + it.z) * 0.08;
    const p = project(it.x, y, it.z);
    const g = project(it.x, 0, it.z);
    if (!p || !g) return;
    const s = p.s;
    shadow(g.x, g.y, 0.2 * s);
    circle(p.x, p.y, 0.32 * s, 'rgba(255,244,170,0.45)');
    switch (it.icon) {
      case 'apple':
        circle(p.x, p.y, 0.18 * s, '#e74c3c');
        circle(p.x - 0.06 * s, p.y - 0.06 * s, 0.05 * s, 'rgba(255,255,255,0.5)');
        ellipse(p.x + 0.07 * s, p.y - 0.2 * s, 0.07 * s, 0.035 * s, '#4caf50');
        break;
      case 'milk':
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(p.x - 0.12 * s, p.y - 0.16 * s, 0.24 * s, 0.34 * s);
        ctx.fillStyle = '#4a90d9';
        ctx.fillRect(p.x - 0.12 * s, p.y - 0.02 * s, 0.24 * s, 0.1 * s);
        ctx.fillStyle = '#e8edf2';
        ctx.beginPath();
        ctx.moveTo(p.x - 0.12 * s, p.y - 0.16 * s);
        ctx.lineTo(p.x, p.y - 0.27 * s);
        ctx.lineTo(p.x + 0.12 * s, p.y - 0.16 * s);
        ctx.fill();
        break;
      case 'bread':
        rrFill(p.x - 0.22 * s, p.y - 0.11 * s, 0.44 * s, 0.22 * s, 0.1 * s, '#e0a85a');
        ctx.strokeStyle = '#f5d39a';
        ctx.lineWidth = Math.max(1, 0.025 * s);
        ctx.beginPath();
        for (const dx of [-0.1, 0, 0.1]) {
          ctx.moveTo(p.x + (dx - 0.04) * s, p.y - 0.06 * s);
          ctx.lineTo(p.x + (dx + 0.04) * s, p.y + 0.04 * s);
        }
        ctx.stroke();
        break;
      case 'carrot':
        ctx.fillStyle = '#ff8c1a';
        ctx.beginPath();
        ctx.moveTo(p.x - 0.09 * s, p.y - 0.12 * s);
        ctx.lineTo(p.x + 0.09 * s, p.y - 0.12 * s);
        ctx.lineTo(p.x, p.y + 0.2 * s);
        ctx.fill();
        ellipse(p.x, p.y - 0.18 * s, 0.08 * s, 0.06 * s, '#4caf50');
        break;
      case 'egg':
        ellipse(p.x, p.y, 0.13 * s, 0.17 * s, '#fff6e5');
        ellipse(p.x - 0.04 * s, p.y - 0.05 * s, 0.03 * s, 0.05 * s, '#ffffff');
        break;
      default:
        circle(p.x, p.y, 0.19 * s, '#f5b301');
        circle(p.x, p.y, 0.14 * s, '#ffd447');
        text('P', p.x, p.y + 0.01 * s, 0.2 * s, '#b07800');
    }
  }

  // 加速パネル（床に貼られた矢印）
  function drawPad(it, t) {
    const x0 = it.x - it.w;
    const x1 = it.x + it.w;
    const z0 = Math.max(it.z - it.len / 2, R.camZ + 0.35);
    const z1 = it.z + it.len / 2;
    if (z1 <= z0) return;
    const glow = 0.5 + Math.sin(t * 10) * 0.5;
    flat(x0 - 0.08, x1 + 0.08, 0.01, z0, z1, it.used ? '#b9a27a' : mix('#ff7a00', '#ffd23f', glow * 0.5));
    flat(x0 + 0.05, x1 - 0.05, 0.012, z0 + 0.05, z1 - 0.05, it.used ? '#8f8f8f' : '#2b2d42');
    const n = 3;
    const step = it.len / n;
    for (let k = 0; k < n; k++) {
      const zc = it.z - it.len / 2 + ((k + (t * 2.2) % 1) % n) * step;
      const za = zc;
      if (za < z0 || za + 0.7 > z1) continue;
      const y = 0.015;
      poly(
        [
          project(x0 + 0.1, y, za),
          project(it.x, y, za + 0.5),
          project(x1 - 0.1, y, za),
          project(x1 - 0.1, y, za + 0.22),
          project(it.x, y, za + 0.72),
          project(x0 + 0.1, y, za + 0.22),
        ],
        it.used ? '#cfcfcf' : '#ffd23f'
      );
    }
  }

  function drawHouse(it) {
    const x = it.x;
    const z0 = it.z;
    const z1 = it.z + 3.2;
    const colors = ['#fff1d6', '#d9ecf7', '#fde0e3', '#e6f2d6', '#f2e6d9'];
    const roofs = ['#d9534f', '#3d6fa8', '#6b4f3a', '#3c8d5a', '#8a5a9e'];
    const k = Math.floor(it.seed * colors.length);
    const p = project(x, 0, Math.max(z0, R.camZ + 0.3));
    if (!p) return;
    const f = box(x - 1.7, x + 1.7, 0, 2.3, z0, z1, colors[k], roofs[k], shade(colors[k], -0.12));
    if (!f) return;
    ctx.fillStyle = roofs[k];
    ctx.beginPath();
    ctx.moveTo(f.l - f.w * 0.08, f.t);
    ctx.lineTo(f.r + f.w * 0.08, f.t);
    ctx.lineTo((f.l + f.r) / 2, f.t - f.h * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9fd3f0';
    ctx.fillRect(f.l + f.w * 0.12, f.t + f.h * 0.2, f.w * 0.25, f.h * 0.25);
    ctx.fillStyle = '#8a5a3c';
    ctx.fillRect(f.l + f.w * 0.6, f.t + f.h * 0.45, f.w * 0.22, f.h * 0.55);
  }

  function drawTree(it) {
    const p = project(it.x, 0, it.z);
    if (!p) return;
    const s = p.s * (0.85 + it.seed * 0.4);
    shadow(p.x, p.y, 0.9 * s);
    ctx.fillStyle = '#8a5a3c';
    ctx.fillRect(p.x - 0.12 * s, p.y - 1.2 * s, 0.24 * s, 1.2 * s);
    circle(p.x, p.y - 1.9 * s, 0.85 * s, '#4f9e4a');
    circle(p.x - 0.45 * s, p.y - 1.55 * s, 0.6 * s, '#5bb055');
    circle(p.x + 0.45 * s, p.y - 1.6 * s, 0.6 * s, '#5bb055');
    circle(p.x - 0.2 * s, p.y - 2.2 * s, 0.35 * s, '#72c46b');
  }

  function drawPole(it) {
    const p = project(it.x, 0, it.z);
    if (!p) return;
    const s = p.s;
    ctx.fillStyle = '#9a9a92';
    ctx.fillRect(p.x - 0.1 * s, p.y - 6 * s, 0.2 * s, 6 * s);
    ctx.fillRect(p.x - 0.7 * s, p.y - 5.4 * s, 1.4 * s, 0.1 * s);
  }

  function drawLamp(it) {
    const p = project(it.x, 0, it.z);
    if (!p) return;
    const s = p.s;
    ctx.fillStyle = '#9aa1a8';
    ctx.fillRect(p.x - 0.07 * s, p.y - 5.5 * s, 0.14 * s, 5.5 * s);
    const dir = -it.side;
    ctx.fillRect(Math.min(p.x, p.x + dir * 1.2 * s), p.y - 5.5 * s, 1.2 * s, 0.1 * s);
    ellipse(p.x + dir * 1.2 * s, p.y - 5.42 * s, 0.25 * s, 0.08 * s, '#fff6c2');
  }

  function drawHwSign(it) {
    const a = project(it.x - 1.8, 5.2, it.z);
    const b = project(it.x + 1.8, 3.8, it.z);
    const g = project(it.x, 0, it.z);
    if (!a || !b || !g) return;
    const s = g.s;
    ctx.fillStyle = '#8d949b';
    ctx.fillRect(a.x + (b.x - a.x) * 0.2 - 0.06 * s, b.y, 0.12 * s, g.y - b.y);
    ctx.fillRect(a.x + (b.x - a.x) * 0.8 - 0.06 * s, b.y, 0.12 * s, g.y - b.y);
    rrFill(a.x, a.y, b.x - a.x, b.y - a.y, 0.1 * s, '#1f7a4d');
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 0.05 * s);
    rr(a.x + 0.08 * s, a.y + 0.08 * s, b.x - a.x - 0.16 * s, b.y - a.y - 0.16 * s, 0.08 * s);
    ctx.stroke();
    text(it.label, (a.x + b.x) / 2, (a.y + b.y) / 2, (b.y - a.y) * 0.34, '#ffffff', 900, (b.x - a.x) * 0.86);
  }

  function drawCornerSign(it) {
    const a = project(-1.6, 5.4, it.z);
    const b = project(1.6, 4.7, it.z);
    const c = project(0, CEIL, it.z);
    if (!a || !b || !c) return;
    ctx.strokeStyle = '#8e979f';
    ctx.lineWidth = Math.max(1, 0.03 * a.s);
    ctx.beginPath();
    ctx.moveTo(a.x + (b.x - a.x) * 0.15, a.y);
    ctx.lineTo(a.x + (b.x - a.x) * 0.15, c.y);
    ctx.moveTo(a.x + (b.x - a.x) * 0.85, a.y);
    ctx.lineTo(a.x + (b.x - a.x) * 0.85, c.y);
    ctx.stroke();
    rrFill(a.x, a.y, b.x - a.x, b.y - a.y, 0.1 * a.s, it.tint);
    text(it.label, (a.x + b.x) / 2, (a.y + b.y) / 2 + 1, (b.y - a.y) * 0.45, '#ffffff', 900, (b.x - a.x) * 0.9);
  }

  function drawGate(it) {
    const RW = it.RW + 0.2;
    const goal = it.kind === 'goal';
    const n = 14;
    for (let k = 0; k < n; k++) {
      const x0 = -RW + (k * 2 * RW) / n;
      const x1 = x0 + (2 * RW) / n;
      for (let r = 0; r < 2; r++) {
        const on = (k + r) % 2 === 0;
        flat(x0, x1, 0, it.z + r * 0.4, it.z + (r + 1) * 0.4, on ? (goal ? '#222222' : '#ff8c42') : '#ffffff');
      }
    }
    const a = project(-RW, 3.1, it.z);
    const b = project(RW, 2.35, it.z);
    const g = project(-RW, 0, it.z);
    if (!a || !b || !g) return;
    const s = g.s;
    const postW = 0.24 * s;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(a.x - postW / 2, a.y, postW, g.y - a.y);
    ctx.fillRect(b.x - postW / 2, a.y, postW, g.y - a.y);
    ctx.fillStyle = goal ? '#ef476f' : it.passed ? '#3bb273' : '#ff8c42';
    ctx.fillRect(a.x - postW / 2, a.y + (g.y - a.y) * 0.35, postW, (g.y - a.y) * 0.12);
    ctx.fillRect(b.x - postW / 2, a.y + (g.y - a.y) * 0.35, postW, (g.y - a.y) * 0.12);
    const bg = goal ? '#ef476f' : it.passed ? '#3bb273' : '#ff8c42';
    rrFill(a.x - postW, a.y, b.x - a.x + postW * 2, b.y - a.y, 0.12 * s, bg);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 0.06 * s);
    rr(a.x - postW + 0.08 * s, a.y + 0.08 * s, b.x - a.x + postW * 2 - 0.16 * s, b.y - a.y - 0.16 * s, 0.08 * s);
    ctx.stroke();
    text(it.label, (a.x + b.x) / 2, (a.y + b.y) / 2 + 1, (b.y - a.y) * 0.5, '#ffffff', 900, (b.x - a.x) * 0.95);
  }

  function drawRegisters(it, t) {
    for (const [k, x] of [-2.2, 0, 2.2].entries()) {
      const z0 = it.z;
      const z1 = it.z + 2.6;
      box(x + 0.35, x + 0.75, 0, 1.0, z0, z1, '#dfe5ea', '#f5f7f9', '#c5ced6');
      const m = box(x + 0.4, x + 0.7, 1.0, 1.35, z0 + 0.3, z0 + 0.7, '#3d4f6b', '#55698a', '#2e3c52');
      if (m) {
        ctx.fillStyle = '#7ee0a8';
        ctx.fillRect(m.l + m.w * 0.15, m.t + m.h * 0.2, m.w * 0.7, m.h * 0.3);
      }
      drawShopper({ x: x - 0.1, z: z0 + 1.2, seed: k, shirt: '#2ec4b6', hair: '#3b2a20', pants: '#2f3640', basket: false }, t);
      const a = project(x - 0.35, 3.4, z0);
      const b = project(x + 0.35, 2.8, z0);
      if (a && b) {
        rrFill(a.x, a.y, b.x - a.x, b.y - a.y, 4, '#2ec4b6');
        text(String(k + 1), (a.x + b.x) / 2, (a.y + b.y) / 2 + 1, (b.y - a.y) * 0.7, '#ffffff');
      }
    }
  }

  function drawHome(it) {
    const z0 = it.z;
    const z1 = it.z + 7;
    const f = box(-3.4, 3.4, 0, 3.4, z0, z1, '#fff4dc', '#d9534f', '#efdcbc');
    if (!f) return;
    ctx.fillStyle = '#d9534f';
    ctx.beginPath();
    ctx.moveTo(f.l - f.w * 0.06, f.t);
    ctx.lineTo(f.r + f.w * 0.06, f.t);
    ctx.lineTo((f.l + f.r) / 2, f.t - f.h * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9fd3f0';
    ctx.fillRect(f.l + f.w * 0.1, f.t + f.h * 0.2, f.w * 0.22, f.h * 0.25);
    ctx.fillRect(f.r - f.w * 0.32, f.t + f.h * 0.2, f.w * 0.22, f.h * 0.25);
    ctx.fillStyle = '#8a5a3c';
    ctx.fillRect(f.l + f.w * 0.42, f.t + f.h * 0.45, f.w * 0.16, f.h * 0.55);
    circle(f.l + f.w * 0.55, f.t + f.h * 0.74, f.w * 0.008 + 1, '#ffd166');
    rrFill(f.l + f.w * 0.36, f.t - f.h * 0.3, f.w * 0.28, f.h * 0.2, 6, '#ffffff');
    text('わが家', (f.l + f.r) / 2, f.t - f.h * 0.2, f.h * 0.12, '#d9534f');
  }

  function drawSprite(it, G, t) {
    switch (it.kind) {
      case 'player':
        return drawPlayer(G, t);
      case 'shopper':
        return drawShopper(it, t);
      case 'cart':
        return drawStrayCart(it);
      case 'display':
        return drawDisplay(it);
      case 'boxes':
        return drawBoxes(it);
      case 'wetsign':
        return drawWetSign(it);
      case 'car':
        return drawCar(it);
      case 'truck':
        return drawTruck(it);
      case 'bike':
        return drawBike(it, t);
      case 'cone':
        return drawCone(it);
      case 'barrier':
        return drawBarrier(it);
      case 'cat':
        return drawCat(it, t);
      case 'item':
        return drawItem(it, t);
      case 'pad':
        return drawPad(it, t);
      case 'house':
        return drawHouse(it);
      case 'tree':
        return drawTree(it);
      case 'pole':
        return drawPole(it);
      case 'lamp':
        return drawLamp(it);
      case 'hwsign':
        return drawHwSign(it);
      case 'csign':
        return drawCornerSign(it);
      case 'gate':
      case 'goal':
        return drawGate(it);
      case 'registers':
        return drawRegisters(it, t);
      case 'home':
        return drawHome(it);
    }
  }

  // ---------- 1フレーム分の描画 ----------
  function drawWorld(G, t) {
    const stage = G.stage;
    const P = G.player;
    drawBackground(zoneAt(stage, P.z), t);

    const startSeg = Math.floor((R.camZ + 0.3) / SEG);
    const endSeg = Math.floor((R.camZ + DRAW) / SEG);
    for (let i = endSeg; i >= startSeg; i--) {
      const z0 = Math.max(i * SEG, R.camZ + 0.3);
      const z1 = i * SEG + SEG;
      if (z1 <= z0) continue;
      drawSegment(zoneAt(stage, i * SEG + SEG / 2), i, z0, z1 + 0.06); // 少し重ねて継ぎ目を消す
    }

    const list = [];
    for (let i = startSeg; i <= endSeg; i++) scenery(stage, i, list);
    const roadW = (z) => THEMES[zoneAt(stage, z).type].roadW;
    stage.checkpoints.forEach((cz, k) => {
      list.push({ kind: 'gate', z: cz, RW: Math.max(roadW(cz - 0.5), roadW(cz + 0.5)), passed: k < G.cpIndex, label: 'CHECKPOINT' });
    });
    list.push({ kind: 'goal', z: stage.length, RW: roadW(stage.length), label: `GOAL ${stage.goalLabel}` });
    if (stage.id === 'market') list.push({ kind: 'registers', z: stage.length + 16 });
    else list.push({ kind: 'home', z: stage.length + 26 });

    for (const o of G.obstacles) list.push(o);
    for (const it of G.items) if (!it.taken) list.push(it);
    for (const pd of G.pads || []) list.push(pd);
    if (G.showPlayer !== false) list.push({ kind: 'player', z: P.z + 0.5 });
    const key = (o) => (o.kind === 'pad' ? o.z + o.len / 2 : o.z);
    list.sort((a, b) => key(b) - key(a));

    for (const it of list) {
      const dz = it.z - R.camZ;
      if (dz > DRAW + 4) continue;
      if (dz < 0.4 && it.kind !== 'player') continue;
      ctx.globalAlpha = clamp((DRAW + 4 - dz) / 20, 0, 1);
      if (it.hit && it.wob < 1.2) {
        const g = project(it.x, 0, it.z);
        if (g) {
          const ang = Math.sin(it.wob * 22) * 0.25 * Math.exp(-it.wob * 3);
          ctx.save();
          ctx.translate(g.x, g.y);
          ctx.rotate(ang);
          ctx.translate(-g.x, -g.y);
          drawSprite(it, G, t);
          ctx.restore();
          continue;
        }
      }
      drawSprite(it, G, t);
    }
    ctx.globalAlpha = 1;

    // スピード線（最高速付近・加速中）
    const th = THEMES[zoneAt(stage, P.z).type];
    const sp = P.speed / th.maxSpeed;
    if (sp > 0.85 || G.boost > 0) {
      const boosting = G.boost > 0;
      const n = boosting ? 26 : 12;
      ctx.strokeStyle = boosting ? 'rgba(255,230,150,0.75)' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = boosting ? 3 : 2;
      ctx.beginPath();
      const cx = R.W / 2;
      const cy = R.hz + (R.H - R.hz) * 0.15;
      const fr = Math.floor(t * 20);
      for (let k = 0; k < n; k++) {
        const a = hash(k, fr, 3) * Math.PI * 2;
        const r0 = R.H * (0.32 + hash(k, fr, 4) * 0.25);
        const len = boosting ? 110 : 60;
        ctx.moveTo(cx + Math.cos(a) * r0 * 0.6, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * (r0 + len) * 0.6, cy + Math.sin(a) * (r0 + len));
      }
      ctx.stroke();
    }
  }

  // プレイヤーの画面位置（エフェクト用）
  function playerScreen(P) {
    return project(P.x, 1.0, P.z);
  }

  window.CartRender = {
    SEG,
    DRAW,
    CAM_BACK,
    setContext,
    setView,
    setCamera,
    drawWorld,
    playerScreen,
    zoneAt,
    view: R,
  };
})();
