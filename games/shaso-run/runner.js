// 車窓ラン ― 黒い人型（デザインした形で、手足が入れ替わる走りのアニメーション）
(function () {
  'use strict';

  function bez(p, t) {
    const u = 1 - t;
    return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]);
  }
  // 中心線に沿って、根元が太く先がとがる「払い」を作る
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

  // ---------- 走りのキーポーズ（デザイン座標。左へ走る） ----------
  // 脚: 前へ伸ばす(∩) → 真下で支える → 後ろへ蹴る(∪) → かかとを上げて前へ戻す
  const LEG = [
    [[490, 505], [370, 515], [240, 620], [165, 835]], // 前へ伸ばす（∩）
    [[482, 515], [425, 610], [470, 715], [415, 835]], // 着地して体を支える（ひざが少し曲がる）
    [[475, 520], [560, 700], [765, 765], [915, 690]], // 後ろへ蹴る（∪）
    [[480, 515], [350, 560], [420, 660], [575, 640]], // ももを高く上げて前へ戻す（かかとはお尻の下）
  ];
  // 腕: 前へ振り上げる → ひじを曲げて戻す → 後ろへ → ひじを曲げて前へ
  const ARM = [
    [[388, 330], [290, 365], [195, 335], [105, 215]],
    [[392, 332], [330, 400], [300, 470], [350, 525]],
    [[400, 325], [520, 300], [640, 320], [770, 245]],
    [[400, 330], [480, 400], [545, 455], [610, 420]],
  ];
  const TORSO = [[392, 318], [425, 385], [460, 455], [485, 522]];
  const HEAD = [300, 215];

  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpPts = (a, b, t) => a.map((p, i) => [lerp(p[0], b[i][0], t), lerp(p[1], b[i][1], t)]);
  // 4つのキーを、なめらかにつないで回す（t: 0〜1）
  function cyc(keys, t) {
    const x = (((t % 1) + 1) % 1) * keys.length;
    const i = Math.floor(x);
    const u = x - i;
    const s = u * u * (3 - 2 * u);
    return lerpPts(keys[i], keys[(i + 1) % keys.length], s);
  }

  function limbs(path, pts, w0, ease) {
    strokePath(path, pts, w0, 0, ease, 30);
  }

  // 足元の基準点（デザイン座標）
  const FOOT = [470, 835];
  const DESIGN_H = 700;

  // state: 'run' | 'air' | 'hit'
  // phase: 走りの周期（1で1歩×2）
  function draw(g, x, y, height, state, phase, tilt, alpha) {
    let legNear;
    let legFar;
    let armNear;
    let armFar;
    let bob = 0;
    if (state === 'air') {
      // ジャンプ中はデザインどおりの大きく開いた形
      legNear = LEG[0];
      legFar = LEG[2];
      armNear = ARM[2];
      armFar = ARM[0];
    } else {
      legNear = cyc(LEG, phase);
      legFar = cyc(LEG, phase + 0.5);
      // 腕は脚と逆（右脚が前なら右腕は後ろ）
      armNear = cyc(ARM, phase + 0.5);
      armFar = cyc(ARM, phase);
      // 1歩ごとに体が上下する
      bob = -Math.abs(Math.sin(phase * Math.PI * 2)) * 34 + 17;
    }
    // 腰の位置も体と一緒に上下させる
    const hip = (pts) => pts.map((q, i) => (i === 0 ? [q[0], q[1] + bob] : i === 1 ? [q[0], q[1] + bob * 0.5] : q));
    legNear = hip(legNear);
    legFar = hip(legFar);
    const s = height / DESIGN_H;
    g.save();
    g.globalAlpha = alpha === undefined ? 1 : alpha;
    g.translate(x, y);
    if (tilt) g.rotate(tilt);
    g.scale(s, s);
    g.translate(-FOOT[0], -FOOT[1]);
    // 奥側の手足（少し明るく）
    g.fillStyle = '#3b3d44';
    let p = new Path2D();
    limbs(p, legFar, 104, 0.72);
    g.fill(p);
    p = new Path2D();
    limbs(p, armFar.map(([a, b]) => [a, b + bob]), 84, 0.7);
    g.fill(p);
    // 胴・頭・手前の手足
    g.fillStyle = '#0b0b0d';
    const body = TORSO.map(([a, b]) => [a, b + bob]);
    p = new Path2D();
    strokePath(p, body, 100, 100, 1, 20);
    g.fill(p);
    for (const c of [body[0], body[3]]) {
      p = new Path2D();
      p.arc(c[0], c[1], 50, 0, Math.PI * 2);
      g.fill(p);
    }
    p = new Path2D();
    p.arc(HEAD[0], HEAD[1] + bob, 54, 0, Math.PI * 2);
    g.fill(p);
    p = new Path2D();
    limbs(p, legNear, 118, 0.7);
    g.fill(p);
    p = new Path2D();
    limbs(p, armNear.map(([a, b]) => [a, b + bob]), 92, 0.7);
    g.fill(p);
    g.restore();
  }

  window.ShasoRunner = { draw, DESIGN_H };
})();
