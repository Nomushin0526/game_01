// バット職人 ― 角材を旋盤で削って、磨いて、ニスで仕上げる
(function () {
  'use strict';
  const B = window.BatWorld;
  const { audio, haptics, storage } = window.GameShared;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- 工程 ----------
  const STEPS = [
    { key: 'rough', name: '① 荒削り', tool: '丸ノミ', time: 22, hint: '指を上下に動かして角を落とし、形を出す。指をバットに近づけるほど深く削れる', width: 2.2, rate: 16, roughAfter: 1 },
    { key: 'fine', name: '② 仕上げ削り', tool: '平ノミ', time: 16, hint: 'でこぼこをならして、点線（理想の形）に合わせる', width: 1.2, rate: 5, roughAfter: 0.6 },
    { key: 'sand', name: '③ やすりがけ', tool: '紙やすり #240', time: 12, hint: 'バットの上を指でこする。よくこすった所ほどなめらかに' },
    { key: 'finish', name: '④ ニス塗り', tool: 'ニスと布', time: 10, hint: 'まんべんなく塗ってツヤを出す。やすりが足りないとツヤが出にくい' },
  ];
  const GAIN = 2.6; // 指の距離 → 削る深さ（指を刃より外に置けるように）

  // ---------- ランク ----------
  const RANKS = [
    { id: 'なし', min: 0, name: 'ただの角材', comments: ['これは…まだ木です。', 'ホームセンターで売ってるやつ', '削るところから始めよう'], grad: ['#8d8d8d', '#5a5a5a'] },
    { id: 'N', min: 20, name: 'バット？？', comments: ['棒…かな？ 素振りはできる', 'バットと言い張れば、バット', 'こん棒に近い何か'], grad: ['#a88a6a', '#6e5640'] },
    { id: 'R', min: 40, name: '普通のバット', comments: ['草野球なら十分！', 'ちゃんとバットの形をしている', '公園で大活躍しそう'], grad: ['#4f9be0', '#235a9c'] },
    { id: 'SR', min: 60, name: '磨かれたバット', comments: ['ツヤが出てきた。いい仕事', '手になじむ、いいバット', '高校球児も喜ぶ仕上がり'], grad: ['#b77ce6', '#6b3aa8'] },
    { id: 'SSR', min: 76, name: '職人のバット', comments: ['プロも振ってみたい一本', '木目が美しく浮かび上がっている', 'もう工房を開ける腕前'], grad: ['#ffd76a', '#c98a12'] },
    { id: 'UR', min: 90, name: '究極のバット', comments: ['伝説の打者が欲しがる一本！', '芯で打てば、どこまでも飛ぶ', '国宝級。家宝にしよう'], grad: ['#ff6b8b', '#ffd36b', '#5ee0a0', '#5ab0ff', '#b98cff'] },
  ];

  let W = 1;
  let H = 1;
  let G = null;
  const fx = $('fx');
  const g = fx.getContext('2d');

  function resize() {
    const app = $('app');
    W = app.clientWidth;
    H = app.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fx.width = W * dpr;
    fx.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    B.layout(W, H);
  }
  // バットの位置(cm) → 画面(px)
  function toScreen(x, y) {
    const v = B.project(x, y);
    return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
  }
  function fromScreenY(py) {
    // y は線形なので、上下2点から求める
    const a = toScreen(0, 0)[1];
    const b = toScreen(0, B.LEN)[1];
    return ((py - a) / (b - a)) * B.LEN;
  }
  const pxPerCm = () => toScreen(1, B.LEN / 2)[0] - toScreen(0, B.LEN / 2)[0];

  // ---------- 進行 ----------
  function newGame() {
    B.reset();
    G = { step: 0, t: STEPS[0].time, touch: null, lastTouch: null, removed: 0, over: false, sfxT: 0 };
    showStep();
  }
  function showStep() {
    const s = STEPS[G.step];
    $('step-name').textContent = s.name;
    $('step-tool').textContent = s.tool;
    $('hint').textContent = s.hint;
    $('btn-next').textContent = G.step < STEPS.length - 1 ? '次の工程へ' : '完成！';
    banner(s.name, s.tool);
  }
  function nextStep() {
    if (!G || G.over) return;
    if (G.step < STEPS.length - 1) {
      G.step++;
      G.t = STEPS[G.step].time;
      G.touch = null;
      sfx.next();
      showStep();
    } else finish();
  }

  // ---------- 道具の作用 ----------
  function work(dt) {
    const s = STEPS[G.step];
    const tc = G.touch;
    if (!tc) return;
    const y = fromScreenY(tc.y);
    if (y < -2 || y > B.LEN + 2) return;
    const ax = W / 2;
    const ppc = pxPerCm();
    const st = B.st;
    const iC = Math.round((clamp(y, 0, B.LEN) / B.LEN) * B.ROWS);
    // 指の動きの速さ（こする工程で使う）
    const mv = G.lastTouch ? Math.hypot(tc.x - G.lastTouch.x, tc.y - G.lastTouch.y) / Math.max(dt, 0.001) : 0;
    G.lastTouch = { x: tc.x, y: tc.y };
    if (s.key === 'rough' || s.key === 'fine') {
      const depth = Math.abs(tc.x - ax) / (ppc * GAIN);
      const side = tc.x >= ax ? 1 : -1;
      const half = Math.max(1, Math.round((s.width / 2 / B.LEN) * B.ROWS));
      let cut = 0;
      for (let i = iC - half; i <= iC + half; i++) {
        if (i < 0 || i > B.ROWS) continue;
        // 刃の形（真ん中ほど深く）
        const k = 1 - Math.abs(i - iC) / (half + 1);
        const d = Math.max(0.55, depth + (1 - k) * 0.25);
        if (st.r[i] > d) {
          const amt = Math.min(st.r[i] - d, s.rate * dt * (0.4 + k * 0.6));
          st.r[i] -= amt;
          cut += amt;
          st.rough[i] = Math.max(st.rough[i] * 0.2, s.roughAfter * (0.7 + Math.random() * 0.3));
          st.gloss[i] = 0;
        }
      }
      if (s.key === 'fine') {
        // 平ノミはでこぼこをならす
        for (let i = Math.max(1, iC - half); i <= Math.min(B.ROWS - 1, iC + half); i++) {
          const avg = (st.r[i - 1] + st.r[i] + st.r[i + 1]) / 3;
          if (st.r[i] > avg) st.r[i] = Math.max(avg, st.r[i] - 2 * dt);
        }
      }
      if (cut > 0) {
        st.dirty = true;
        G.removed += cut;
        G.cutting = Math.min(1, cut * 3);
        G.chipAcc = (G.chipAcc || 0) + cut * (s.key === 'rough' ? 4 : 2);
        while (G.chipAcc > 0.7) {
          G.chipAcc -= 0.7;
          B.chip(y, Math.max(depth, 1), side);
        }
      } else G.cutting = 0;
      return;
    }
    // こする工程: バットの上（太さの範囲）を指が動いたときだけ
    const r = st.r[iC] === undefined ? 0 : Math.min(st.r[iC], B.HALF * 1.2);
    if (Math.abs(tc.x - ax) > r * ppc + 26) {
      G.rubbing = 0;
      return;
    }
    const power = clamp(mv / 900, 0, 1.4);
    G.rubbing = power;
    if (power < 0.05) return;
    const half = Math.round((2.4 / B.LEN) * B.ROWS);
    for (let i = iC - half; i <= iC + half; i++) {
      if (i < 0 || i > B.ROWS) continue;
      const k = 1 - Math.abs(i - iC) / (half + 1);
      if (s.key === 'sand') {
        st.rough[i] = Math.max(0.04, st.rough[i] - power * dt * 1.6 * k);
        // 角が少し取れて、細かいでこぼこもならされる
        if (i > 0 && i < B.ROWS) {
          const avg = (st.r[i - 1] + st.r[i] + st.r[i + 1]) / 3;
          st.r[i] += (avg - st.r[i]) * Math.min(1, power * dt * 2) * k;
          if (st.r[i] > B.HALF) st.r[i] -= power * dt * 0.4 * k;
        }
        if (Math.random() < power * 0.4) B.dust(B.yOf(i), Math.min(st.r[i], B.HALF), Math.random() < 0.5 ? 1 : -1);
      } else {
        const cap = 1 - st.rough[i] * 0.85;
        st.gloss[i] = Math.min(cap, st.gloss[i] + power * dt * 1.5 * k);
      }
    }
    st.dirty = true;
  }

  // ---------- 採点 ----------
  function score() {
    const st = B.st;
    let err = 0;
    let rough = 0;
    let gloss = 0;
    const n = B.ROWS + 1;
    for (let i = 0; i < n; i++) {
      const y = B.yOf(i);
      const tr = B.targetR(y);
      const r = Math.min(st.r[i], B.HALF * Math.SQRT2);
      let e = r - tr;
      if (e < 0) e = -e * 1.6; // 削りすぎは重い
      if (st.r[i] > B.HALF) e += (Math.min(st.r[i], B.HALF * Math.SQRT2) - B.HALF) * 1.2; // 角が残っている
      err += e;
      rough += st.rough[i];
      gloss += st.gloss[i];
    }
    err /= n;
    rough /= n;
    gloss /= n;
    const shape = clamp(1 - err / 1.5, 0, 1);
    const smooth = clamp((1 - rough) / 0.94, 0, 1);
    const shine = clamp(gloss / 0.9, 0, 1);
    const total = Math.round(100 * (0.55 * shape + (0.25 * smooth + 0.2 * shine) * Math.min(1, shape * 1.35)));
    return { total, shape, smooth, shine };
  }
  function rankOf(total) {
    let r = RANKS[0];
    for (const x of RANKS) if (total >= x.min) r = x;
    return r;
  }
  function finish() {
    G.over = true;
    const sc = score();
    const rk = rankOf(sc.total);
    const best = storage.get('bat.best', null);
    if (!best || sc.total > best) storage.set('bat.best', sc.total);
    const card = $('rank-card');
    const grad = rk.grad.length > 2 ? `linear-gradient(120deg, ${rk.grad.join(', ')})` : `linear-gradient(140deg, ${rk.grad[0]}, ${rk.grad[1]})`;
    card.style.background = grad;
    card.className = 'rank-card' + (rk.id === 'UR' ? ' ur' : '') + (rk.id === 'SSR' ? ' ssr' : '');
    $('rank-id').textContent = rk.id;
    $('rank-name').textContent = rk.name;
    $('rank-comment').textContent = '「' + rk.comments[Math.floor(Math.random() * rk.comments.length)] + '」';
    $('rank-score').innerHTML = `${sc.total}点<small>形 ${Math.round(sc.shape * 100)}　なめらかさ ${Math.round(sc.smooth * 100)}　ツヤ ${Math.round(sc.shine * 100)}</small>`;
    $('rank-best').textContent = best ? `これまでの最高 ${Math.max(best, sc.total)}点` : '';
    const rankIdx = RANKS.indexOf(rk);
    rankIdx >= 4 ? sfx.great() : rankIdx >= 2 ? sfx.good() : sfx.meh();
    haptics.vibrate(rankIdx >= 4 ? [30, 40, 30, 40, 80] : 40);
    setTimeout(() => show('result'), 500);
  }

  // ---------- 表示（2D） ----------
  let banT = 0;
  function banner(a, b) {
    const el = $('banner');
    el.innerHTML = `<b>${a}</b><span>${b}</span>`;
    el.className = 'banner show';
    clearTimeout(banT);
    banT = setTimeout(() => (el.className = 'banner'), 1300);
  }
  function drawOverlay() {
    g.clearRect(0, 0, W, H);
    if (!G || G.over) return;
    const s = STEPS[G.step];
    const ax = W / 2;
    const ppc = pxPerCm();
    // 理想の形（点線）。削りすぎた所は赤
    if (s.key === 'rough' || s.key === 'fine') {
      g.lineWidth = 1.5;
      for (const side of [-1, 1]) {
        let prevBad = null;
        g.beginPath();
        for (let i = 0; i <= B.ROWS; i += 2) {
          const y = B.yOf(i);
          const [, py] = toScreen(0, y);
          const px = ax + side * B.targetR(y) * ppc;
          const bad = B.st.r[i] < B.targetR(y) - 0.2;
          if (bad !== prevBad) {
            if (prevBad !== null) g.stroke();
            g.beginPath();
            g.strokeStyle = bad ? 'rgba(255,80,80,0.95)' : 'rgba(120,255,190,0.75)';
            g.setLineDash(bad ? [] : [4, 4]);
            g.moveTo(px, py);
            prevBad = bad;
          } else g.lineTo(px, py);
        }
        g.stroke();
      }
      g.setLineDash([]);
    }
    // 道具
    const tc = G.touch;
    if (tc) {
      const y = fromScreenY(tc.y);
      const side = tc.x >= ax ? 1 : -1;
      if (s.key === 'rough' || s.key === 'fine') {
        const depth = Math.abs(tc.x - ax) / (ppc * GAIN);
        const tipX = ax + side * depth * ppc;
        drawChisel(tipX, tc.y, side, s.key === 'rough');
        // 指の位置の目印
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.beginPath();
        g.arc(tc.x, tc.y, 16, 0, 7);
        g.stroke();
        void y;
      } else {
        drawPad(tc.x, tc.y, s.key);
      }
    }
    // 残り時間
    const t = G.t / s.time;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(16, 74, W - 32, 6);
    g.fillStyle = t < 0.25 ? '#ff6b6b' : '#ffd166';
    g.fillRect(16, 74, (W - 32) * Math.max(0, t), 6);
  }
  function drawChisel(x, y, side, round) {
    g.save();
    g.translate(x, y);
    g.scale(side, 1);
    // 刃（鋼）
    const grd = g.createLinearGradient(0, -6, 0, 6);
    grd.addColorStop(0, '#e9eef2');
    grd.addColorStop(0.5, '#9aa4ad');
    grd.addColorStop(1, '#d5dbe0');
    g.fillStyle = grd;
    g.beginPath();
    if (round) {
      g.moveTo(0, 0);
      g.quadraticCurveTo(6, -7, 70, -6);
      g.lineTo(70, 6);
      g.quadraticCurveTo(6, 7, 0, 0);
    } else {
      g.moveTo(0, -5);
      g.lineTo(70, -5);
      g.lineTo(70, 5);
      g.lineTo(3, 5);
    }
    g.fill();
    // 柄（木）
    const hg = g.createLinearGradient(0, -8, 0, 8);
    hg.addColorStop(0, '#a5713f');
    hg.addColorStop(1, '#6b4321');
    g.fillStyle = hg;
    g.beginPath();
    g.roundRect ? g.roundRect(70, -8, 90, 16, 6) : g.rect(70, -8, 90, 16);
    g.fill();
    g.fillStyle = '#c9cfd4';
    g.fillRect(68, -9, 6, 18);
    g.restore();
  }
  function drawPad(x, y, key) {
    g.save();
    g.translate(x, y);
    g.rotate(-0.12);
    if (key === 'sand') {
      g.fillStyle = '#c9a56a';
      g.strokeStyle = '#8a6a3a';
      g.lineWidth = 2;
      g.beginPath();
      g.rect(-34, -22, 68, 44);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(80,50,20,0.35)';
      for (let i = 0; i < 70; i++) g.fillRect(-32 + Math.random() * 64, -20 + Math.random() * 40, 1.5, 1.5);
      g.fillStyle = '#5a4630';
      g.font = '800 11px sans-serif';
      g.textAlign = 'center';
      g.fillText('#240', 0, 4);
    } else {
      const gr = g.createRadialGradient(-8, -8, 4, 0, 0, 30);
      gr.addColorStop(0, '#fff7e6');
      gr.addColorStop(1, '#d9c6a2');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(0, 0, 30, 22, 0, 0, 7);
      g.fill();
      g.fillStyle = 'rgba(160,90,30,0.45)';
      g.beginPath();
      g.ellipse(-4, 4, 18, 12, 0, 0, 7);
      g.fill();
    }
    g.restore();
  }

  // ---------- 音 ----------
  const sfx = {
    next: () => [660, 880].forEach((f, i) => audio.tone(f, 0.08, { type: 'triangle', vol: 0.1, delay: i * 0.06 })),
    meh: () => [392, 330].forEach((f, i) => audio.tone(f, 0.2, { type: 'triangle', vol: 0.14, delay: i * 0.16 })),
    good: () => [523, 659, 784].forEach((f, i) => audio.tone(f, 0.16, { type: 'triangle', vol: 0.16, delay: i * 0.1 })),
    great: () => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => audio.tone(f, 0.2, { type: 'triangle', vol: 0.16, delay: i * 0.09 })),
  };
  function workSound(dt) {
    G.sfxT -= dt;
    if (G.sfxT > 0) return;
    G.sfxT = 0.07;
    const s = STEPS[G.step].key;
    if ((s === 'rough' || s === 'fine') && G.cutting > 0.02) {
      audio.noise(0.08, { vol: 0.12 + G.cutting * 0.25, cutoff: s === 'rough' ? 1400 : 2600 });
      if (Math.random() < 0.3) haptics.vibrate(8);
    } else if (s === 'sand' && G.rubbing > 0.1) audio.noise(0.07, { vol: 0.08 + G.rubbing * 0.1, cutoff: 5200 });
    else if (s === 'finish' && G.rubbing > 0.1) audio.noise(0.07, { vol: 0.05, cutoff: 900 });
  }

  // ---------- ループ ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    if (G && !G.over && !paused && $('screen-title').classList.contains('hidden')) {
      G.t -= dt;
      work(dt);
      workSound(dt);
      if (G.t <= 0) nextStep();
    }
    const tc = G && G.touch;
    const zoom = tc && !G.over ? { y: clamp(fromScreenY(tc.y), 0, B.LEN) } : null;
    const s = Math.round(Math.min(W, H) * 0.36);
    const spinning = !G || !G.over || true;
    B.render(dt, spinning, W, H, zoom, zoom ? { x: W - s - 10, y: 92, s } : null);
    drawOverlay();
    if (zoom) {
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 3;
      g.strokeRect(W - s - 10, 92, s, s);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(W - s - 10, 92 + s - 18, 62, 18);
      g.fillStyle = '#fff';
      g.font = '800 11px sans-serif';
      g.textAlign = 'left';
      g.fillText('🔍 拡大', W - s - 4, 92 + s - 5);
    }
    requestAnimationFrame(loop);
  }

  // ---------- 入力 ----------
  const app = $('app');
  function pt(e) {
    const r = app.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  fx.style.pointerEvents = 'none';
  $('gl').addEventListener('pointerdown', (e) => {
    if (!G || G.over) return;
    e.preventDefault();
    $('gl').setPointerCapture(e.pointerId);
    G.touch = pt(e);
    G.lastTouch = null;
    audio.unlock();
  });
  $('gl').addEventListener('pointermove', (e) => {
    if (!G || !G.touch) return;
    G.touch = pt(e);
  });
  const up = () => {
    if (G) {
      G.touch = null;
      G.cutting = 0;
      G.rubbing = 0;
    }
  };
  $('gl').addEventListener('pointerup', up);
  $('gl').addEventListener('pointercancel', up);
  $('btn-next').addEventListener('click', nextStep);

  // ---------- 画面 ----------
  let paused = false;
  document.addEventListener('visibilitychange', () => (paused = document.hidden));
  function show(name) {
    for (const s of ['title', 'howto', 'result']) $('screen-' + s).classList.toggle('hidden', s !== name);
    $('hud').classList.toggle('hidden', name !== null);
  }
  $('btn-start').addEventListener('click', () => {
    audio.unlock();
    newGame();
    show(null);
  });
  $('btn-again').addEventListener('click', () => {
    newGame();
    show(null);
  });
  $('btn-howto').addEventListener('click', () => show('howto'));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => show('title')));
  function soundLabel() {
    $('btn-sound').textContent = audio.muted ? '🔇 サウンド OFF' : '🔊 サウンド ON';
  }
  $('btn-sound').addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    soundLabel();
  });

  B.init($('gl'));
  window.addEventListener('resize', resize);
  resize();
  soundLabel();
  const best = storage.get('bat.best', null);
  if (best !== null) $('title-best').textContent = `これまでの最高 ${best}点（${rankOf(best).id}）`;
  requestAnimationFrame(loop);
  window.BatDebug = { get G() { return G; }, score, B, nextStep, toScreen, fromScreenY, pxPerCm };
})();
