// 車窓ラン ― 黒い人型（デザインした形を、走りに合わせて動かす）
(function () {
  'use strict';

  // 3次ベジェの中心線に沿って、根元が太く先がとがる「払い」を作る
  function bez(p, t) {
    const u = 1 - t;
    return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]);
  }
  function strokePath(path, p, w0, w1, ease, N) {
    const L = [];
    const R = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = bez(p, Math.max(0, t - 0.01));
      const b = bez(p, Math.min(1, t + 0.01));
      let nx = -(b[1] - a[1]);
      let ny = b[0] - a[0];
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      const c = bez(p, t);
      const w = (w1 + (w0 - w1) * Math.pow(1 - t, ease)) / 2;
      L.push([c[0] + nx * w, c[1] + ny * w]);
      R.push([c[0] - nx * w, c[1] - ny * w]);
    }
    const pts = L.concat(R.reverse());
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
    path.closePath();
  }

  // ポーズ（デザインした座標系。左へ走る）
  // A: 大きく踏み出した形（デザインそのもの） / B: 脚が入れ替わる途中
  const A = {
    torso: [[392, 318], [425, 385], [460, 455], [485, 522]],
    armF: [[388, 330], [290, 365], [195, 335], [105, 215]],
    armB: [[400, 325], [520, 300], [640, 320], [770, 245]],
    legF: [[490, 505], [370, 515], [240, 620], [165, 835]],
    legB: [[470, 525], [560, 700], [765, 765], [915, 690]],
    head: [300, 215],
  };
  const B = {
    torso: [[392, 318], [425, 385], [460, 455], [485, 522]],
    armF: [[388, 330], [320, 390], [260, 420], [215, 345]],
    armB: [[400, 325], [500, 335], [590, 380], [665, 330]],
    legF: [[490, 505], [440, 600], [400, 700], [360, 835]],
    legB: [[470, 525], [540, 640], [640, 720], [745, 610]],
    head: [300, 222],
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  function mix(a, b, t) {
    const o = {};
    for (const k in a) {
      if (k === 'head') o.head = [lerp(a.head[0], b.head[0], t), lerp(a.head[1], b.head[1], t)];
      else o[k] = a[k].map((p, i) => [lerp(p[0], b[k][i][0], t), lerp(p[1], b[k][i][1], t)]);
    }
    return o;
  }
  // 部位ごとに別々に塗る（重なりで穴があかないように）
  function shape(pose) {
    const out = [];
    const add = (fn) => {
      const p = new Path2D();
      fn(p);
      out.push(p);
    };
    add((p) => strokePath(p, pose.torso, 100, 100, 1, 24));
    add((p) => p.arc(pose.torso[0][0], pose.torso[0][1], 50, 0, Math.PI * 2));
    add((p) => p.arc(pose.torso[3][0], pose.torso[3][1], 50, 0, Math.PI * 2));
    add((p) => strokePath(p, pose.armF, 92, 0, 0.7, 30));
    add((p) => strokePath(p, pose.armB, 92, 0, 0.7, 30));
    add((p) => strokePath(p, pose.legF, 124, 0, 0.7, 36));
    add((p) => strokePath(p, pose.legB, 98, 0, 0.75, 36));
    add((p) => p.arc(pose.head[0], pose.head[1], 54, 0, Math.PI * 2));
    return out;
  }

  // 足元の基準点（デザイン座標）
  const FOOT = [470, 835];
  const DESIGN_H = 700; // 頭のてっぺん〜足先

  // state: 'run' | 'air' | 'hit'
  function draw(g, x, y, height, state, phase, tilt, color) {
    let pose;
    if (state === 'air') pose = A;
    else {
      const t = (1 - Math.cos(phase * Math.PI * 2)) / 2;
      pose = mix(A, B, t);
    }
    const s = height / DESIGN_H;
    g.save();
    g.translate(x, y);
    if (tilt) g.rotate(tilt);
    g.scale(s, s);
    g.translate(-FOOT[0], -FOOT[1]);
    g.fillStyle = color || '#0d0d0f';
    for (const p of shape(pose)) g.fill(p);
    g.restore();
  }

  window.ShasoRunner = { draw, DESIGN_H };
})();
