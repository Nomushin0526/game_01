// 車窓ラン ― ゲーム進行（車の窓の外を、黒い人型が走る）
(function () {
  'use strict';
  const W3 = window.ShasoWorld;
  const RN = window.ShasoRunner;
  const { audio, haptics, storage } = window.GameShared;
  const $ = (id) => document.getElementById(id);

  // ---------- ステージ（実在の道をベースに） ----------
  // 国道15号（第一京浜）: 日本橋 → 銀座 → 新橋 → 浜松町（東京タワー）→ 品川
  const STAGES = [
    {
      id: 1,
      name: '東京・都心',
      road: '国道15号 第一京浜',
      seed: 1501,
      length: 1400,
      speed: 7.5, // m/s（ゲーム用に実際よりゆっくり）
      sky: ['#3f78bf', '#bcd2e6', '#7c8187'],
      fog: '#c3d1dc',
      landmarks: [{ x: -1000, kind: 'tokyoTower' }],
      signals: [220, 520, 780, 1080, 1290],
      places: [
        [0, '日本橋'],
        [330, '銀座'],
        [700, '新橋'],
        [1000, '浜松町'],
        [1400, '品川'],
      ],
    },
  ];

  // ---------- 調整用の数値（画面の高さ H を1とした単位） ----------
  const P = {
    runH: 0.165, // 人型の高さ
    run: 0.95, // 走る速さ（毎秒）
    g: 3.1, // 重力
    jump1: 1.32, // 1段目のジャンプ
    jump2: 1.12, // 2段目
    coyote: 0.09,
    stun: 0.6, // ぶつかったときのよろけ時間
    inv: 1.2, // ぶつかった直後の無敵時間
    winL: 0.035, // 窓の左端（画面幅に対する割合）
    winR: 0.965,
    winT: 0.05,
    winB: 0.86,
  };

  let W = 1;
  let H = 1;
  let f = 1;
  let CY = 0.5; // 地平線の高さ（画面上）
  const SHIFT = 0.12; // 地平線を下げて空を広く
  let S = null; // 進行中の状態
  let raf = 0;
  let last = 0;
  const fx = $('fx');
  const g = fx.getContext('2d');

  function resize() {
    const app = $('app');
    const oW = W;
    const oH = H;
    W = app.clientWidth;
    H = app.clientHeight;
    // 画面の大きさが変わったら、人型の位置も同じ割合で動かす
    if (S) {
      S.rx *= W / oW;
      S.ry *= H / oH;
      S.vy *= H / oH;
      S.vx *= H / oH;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fx.width = W * dpr;
    fx.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fullH = W3.resize(W, H, SHIFT);
    f = fullH / 2 / Math.tan(((W3.FOV / 2) * Math.PI) / 180);
    CY = fullH / 2;
  }

  // 世界の点 → 画面の点
  const sx = (x, z) => W / 2 + (x - S.camX) * (f / z);
  const sy = (y, z) => CY - (y - W3.CAM_Y - S.bump) * (f / z);

  // ---------- 開始 ----------
  let demoMode = false;
  function restartDemo() {
    demoMode = true;
    start(0);
    S.demo = true;
  }
  function start(stageIdx) {
    const st = STAGES[stageIdx];
    W3.build(st);
    const rng = W3.rngOf(st.seed * 7 + 3);
    S = {
      st,
      rng,
      camX: 0,
      speed: 0,
      bump: 0,
      t: 0,
      // 信号: 止まる位置（進んだ距離）と、赤かどうか
      signals: st.signals.map((d) => ({ d, red: rng() < 0.7, wait: 3 + rng() * 2.5, done: false })),
      stopT: 0,
      stopping: null,
      carT: 2,
      // 人型
      rx: W * 0.42,
      ry: 0,
      vy: 0,
      vx: 0,
      on: null,
      air: 0,
      jumps: 0,
      stun: 0,
      inv: 0,
      phase: 0,
      hits: 0,
      over: false,
      clear: false,
      msg: '',
      msgT: 0,
    };
    S.ry = sy(0, W3.Z.line);
    S.on = null;
    say(`${st.places[0][1]} → ${st.places[st.places.length - 1][1]}`, 2.5);
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    if (stageIdx >= 0 && !demoMode) audio.playMusic({ bpm: 132, root: 57, prog: [0, 5, -3, 7] });
  }
  function say(text, t) {
    S.msg = text;
    S.msgT = t || 2;
  }

  // ---------- 車の速さ（信号で止まる） ----------
  function driveCar(dt) {
    const d = -S.camX;
    const v = S.st.speed;
    let target = v;
    for (const s of S.signals) {
      if (s.done || !s.red) continue;
      const left = s.d - d;
      if (left < -1) {
        s.done = true;
        continue;
      }
      if (left < 34) {
        // ブレーキ: 残りの距離で止まれる速さ
        target = Math.min(target, Math.sqrt(Math.max(0, 2 * 1.4 * Math.max(0, left - 0.5))));
        if (left < 0.8 && S.speed < 0.3) {
          if (!S.stopping) {
            S.stopping = s;
            S.stopT = s.wait;
            say('赤信号！ いまのうちに前へ', 1.6);
          }
          target = 0;
        }
      }
      break;
    }
    if (S.stopping) {
      S.stopT -= dt;
      target = 0;
      if (S.stopT <= 0) {
        S.stopping.done = true;
        S.stopping = null;
        say('青信号', 1);
      }
    }
    const acc = target > S.speed ? 2.2 : 3.2;
    S.speed += Math.max(-acc * dt, Math.min(acc * dt, target - S.speed));
    S.camX -= S.speed * dt;
    // 車の揺れ（速いほど細かく揺れる）
    S.t += dt;
    S.bump = S.speed > 0.2 ? Math.sin(S.t * 17) * 0.004 + Math.sin(S.t * 5.3) * 0.006 * (S.speed / v) : 0;
  }
  function trafficCars(dt) {
    S.carT -= dt;
    if (S.carT <= 0 && S.speed > 3 && W3.cars.length < 2) {
      S.carT = 5 + S.rng() * 6;
      // 前（左の画面外）から少し遅い車 / 後ろから少し速い車
      const ahead = S.rng() < 0.6;
      const o = W3.spawnCar(S.camX + (ahead ? -40 : 28), 0, S.rng);
      o.rel = ahead ? -(0.8 + S.rng() * 1.2) : 0.8 + S.rng() * 1.0;
    }
    for (const o of W3.cars) o.speed = Math.max(0, S.speed + (S.speed > 0.5 ? o.rel || 0 : 0));
    W3.updateCars(dt, S.camX);
  }

  // ---------- 人型の動き ----------
  function platVel(p) {
    if (p.car) {
      const o = W3.cars.find((c) => c.p === p);
      return (((o ? S.speed - o.speed : 0) * f) / p.z);
    }
    return (S.speed * f) / p.z;
  }

  function stepRunner(dt) {
    const plats = W3.platformsList();
    const runV = P.run * H * (S.stun > 0 ? 0.25 : 1);
    S.stun = Math.max(0, S.stun - dt);
    S.inv = Math.max(0, S.inv - dt);
    const halfW = P.runH * H * 0.16;
    const prevY = S.ry;
    if (S.on) {
      const sp = screenPlat2(S.on);
      S.vx = platVel(S.on) - runV;
      S.rx += S.vx * dt;
      S.ry = sp.top;
      S.phase += dt * 2.6;
      // 足場の端を越えたら落ちる
      if (S.rx < sp.x0 - halfW * 0.3 || S.rx > sp.x1 + halfW * 0.3 || !plats.includes(S.on)) {
        S.on = null;
        S.air = 0;
        S.jumps = Math.max(S.jumps, 0);
        S.vy = 0;
      }
    } else {
      S.air += dt;
      S.vy += P.g * H * dt;
      S.ry += S.vy * dt;
      S.rx += S.vx * dt;
      // 着地（上から乗ったときだけ）
      if (S.vy >= 0) {
        let best = null;
        for (const p of plats) {
          const sp = screenPlat2(p);
          if (S.rx < sp.x0 || S.rx > sp.x1) continue;
          if (prevY <= sp.top + 2 && S.ry >= sp.top) {
            if (!best || sp.top < best.top) best = { p, top: sp.top };
          }
        }
        // 白線より下へ落ちることはない（いちばん下の足場）
        const baseP = plats.find((p) => p.base);
        if (!best && baseP && S.ry >= screenPlat2(baseP).top) best = { p: baseP, top: screenPlat2(baseP).top };
        if (best) {
          S.on = best.p;
          S.ry = best.top;
          S.vy = 0;
          S.jumps = 0;
          land(best.p);
        }
      }
    }
    // 横からぶつかる（自販機・標識・車）
    if (S.inv <= 0) {
      for (const p of plats) {
        if (p.kind !== 'solid' || p === S.on) continue;
        const sp = screenPlat2(p);
        const top = S.ry - P.runH * H * 0.9;
        if (S.rx + halfW < sp.x0 || S.rx - halfW > sp.x1) continue;
        if (S.ry <= sp.top + 3 || top >= sp.bot) continue;
        hit(p, sp);
        break;
      }
    }
    // 窓の左端より前へは行けない
    const minX = W * (P.winL + 0.06);
    if (S.rx < minX) S.rx = minX;
    // 窓の右端から外へ出たら、置いていかれた
    if (S.rx > W * P.winR + halfW) gameOver();
  }
  // 足場の画面上の位置（簡易版）
  function screenPlat2(p) {
    const k = f / p.z;
    return {
      x0: W / 2 + (p.x0 - S.camX) * k,
      x1: W / 2 + (p.x1 - S.camX) * k,
      top: CY - (p.y - W3.CAM_Y - S.bump) * k,
      bot: p.bodyY0 !== undefined ? CY - (p.bodyY0 - W3.CAM_Y - S.bump) * k : H,
    };
  }
  function jump() {
    if (!S || S.over || S.clear) return;
    if (S.on || S.air < P.coyote) {
      const v0 = S.on ? platVel(S.on) - P.run * H : S.vx;
      S.on = null;
      S.vy = -P.jump1 * H;
      S.vx = v0;
      S.jumps = 1;
      S.air = P.coyote;
      sfx.jump();
    } else if (S.jumps < 2) {
      S.vy = -P.jump2 * H;
      S.jumps = 2;
      sfx.jump2();
    }
  }
  function land(p) {
    if (!p.base) sfx.land();
    if (p.name && !p.base && p.name !== S.lastLand) {
      S.lastLand = p.name;
    }
  }
  function hit(p, sp) {
    S.hits++;
    S.stun = P.stun;
    S.inv = P.inv;
    S.on = null;
    S.rx = sp.x1 + P.runH * H * 0.18;
    S.vy = -0.5 * H;
    S.vx = (S.speed * f) / p.z;
    say(`${p.name}にぶつかった！`, 1.2);
    sfx.hit();
    haptics.vibrate(60);
  }
  function gameOver() {
    if (S.over) return;
    if (S.demo) return restartDemo();
    S.over = true;
    sfx.lose();
    haptics.vibrate([60, 40, 120]);
    setTimeout(() => showResult(false), 900);
  }
  function stageClear() {
    if (S.demo) return restartDemo();
    S.clear = true;
    sfx.win();
    const best = storage.get('shaso.best1', null);
    if (!best || S.t < best) storage.set('shaso.best1', S.t);
    setTimeout(() => showResult(true), 1200);
  }

  // ---------- 描画（窓・人型・表示） ----------
  function drawOverlay() {
    g.clearRect(0, 0, W, H);
    const wl = W * P.winL;
    const wr = W * P.winR;
    const wt = H * P.winT;
    const wb = H * P.winB;
    // ガラスの映り込み
    const ref = g.createLinearGradient(wl, wt, wr, wb);
    ref.addColorStop(0, 'rgba(255,255,255,0.10)');
    ref.addColorStop(0.35, 'rgba(255,255,255,0.0)');
    ref.addColorStop(0.6, 'rgba(255,255,255,0.05)');
    ref.addColorStop(1, 'rgba(255,255,255,0.0)');
    g.fillStyle = ref;
    g.fillRect(wl, wt, wr - wl, wb - wt);
    // 車のガラスのうっすらした色と、ふちの暗さ
    g.fillStyle = 'rgba(40,70,60,0.07)';
    g.fillRect(wl, wt, wr - wl, wb - wt);
    const vg = g.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.45, W * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = vg;
    g.fillRect(wl, wt, wr - wl, wb - wt);
    // ガラスのほこり・指のあと
    if (!dust) dust = makeDust();
    g.drawImage(dust, wl, wt, wr - wl, wb - wt);
    // 人型
    const blink = S.inv > 0 && Math.floor(S.inv * 12) % 2 === 0;
    if (!blink || S.over) {
      const st = S.over ? 'air' : S.on ? 'run' : 'air';
      const tilt = S.stun > 0 ? -0.5 * (S.stun / P.stun) : S.on ? 0 : Math.max(-0.15, Math.min(0.15, S.vy / H / 8));
      RN.draw(g, S.rx, S.ry, P.runH * H, st, S.phase, tilt);
    }
    // 置いていかれそう: 右端が赤く
    const danger = Math.max(0, (S.rx - W * 0.7) / (W * 0.27));
    if (danger > 0) {
      const dg = g.createLinearGradient(wr - W * 0.25, 0, wr, 0);
      dg.addColorStop(0, 'rgba(220,30,30,0)');
      dg.addColorStop(1, `rgba(220,30,30,${0.45 * danger})`);
      g.fillStyle = dg;
      g.fillRect(wr - W * 0.25, wt, W * 0.25, wb - wt);
    }
    // 窓枠（車の内装）
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    roundRect(g, wl, wt, wr - wl, wb - wt, H * 0.05);
    const trim = g.createLinearGradient(0, 0, 0, H);
    trim.addColorStop(0, '#2a2c30');
    trim.addColorStop(0.5, '#1c1d20');
    trim.addColorStop(1, '#121315');
    g.fillStyle = trim;
    g.fill('evenodd');
    g.restore();
    // ゴムのふち
    g.strokeStyle = '#050505';
    g.lineWidth = H * 0.012;
    g.beginPath();
    roundRect(g, wl, wt, wr - wl, wb - wt, H * 0.05);
    g.stroke();
    // ドアの内張り（下）
    const door = g.createLinearGradient(0, wb, 0, H);
    door.addColorStop(0, '#3a3c41');
    door.addColorStop(0.15, '#26282c');
    door.addColorStop(1, '#17181a');
    g.fillStyle = door;
    g.fillRect(0, wb + H * 0.006, W, H - wb);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, wb + H * 0.012, W, 2);

    drawHud();
  }
  let dust = null;
  function makeDust() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const d = c.getContext('2d');
    for (let i = 0; i < 220; i++) {
      d.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`;
      d.beginPath();
      d.arc(Math.random() * 512, Math.random() * 256, Math.random() * 1.4, 0, 7);
      d.fill();
    }
    // 指のあと・拭きむら
    for (let i = 0; i < 4; i++) {
      const x = Math.random() * 512;
      const y = 60 + Math.random() * 160;
      const gr = d.createRadialGradient(x, y, 0, x, y, 30 + Math.random() * 40);
      gr.addColorStop(0, 'rgba(255,255,255,0.05)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      d.fillStyle = gr;
      d.fillRect(x - 70, y - 70, 140, 140);
    }
    return c;
  }
  function roundRect(c, x, y, w, h, r) {
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function placeNow() {
    const d = -S.camX;
    let cur = S.st.places[0][1];
    for (const [pd, n] of S.st.places) if (d >= pd) cur = n;
    return cur;
  }
  function drawHud() {
    const st = S.st;
    const d = Math.min(st.length, -S.camX);
    // 下のドア部分に、道のりのバー
    const y = H * 0.93;
    const x0 = W * 0.08;
    const x1 = W * 0.92;
    g.font = `800 ${Math.round(H * 0.035)}px "M PLUS Rounded 1c", sans-serif`;
    g.textBaseline = 'middle';
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    // 地名（右がスタート、左がゴール。走る向きに合わせる）
    for (const [pd, n] of st.places) {
      const px = x1 - (x1 - x0) * (pd / st.length);
      g.fillStyle = d >= pd ? '#ffd166' : 'rgba(255,255,255,0.5)';
      g.beginPath();
      g.arc(px, y, 4, 0, 7);
      g.fill();
      g.textAlign = 'center';
      g.fillText(n, px, y - H * 0.035);
    }
    const cx = x1 - (x1 - x0) * (d / st.length);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(cx, y, 7, 0, 7);
    g.fill();
    // 左上: 道路名・ぶつかった回数
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = `800 ${Math.round(H * 0.032)}px "M PLUS Rounded 1c", sans-serif`;
    g.fillText(`${st.road}　いま：${placeNow()}`, W * 0.06, H * 0.025);
    g.textAlign = 'right';
    g.fillText(`${Math.round(S.speed * 3.6 * 2)}km/h　ぶつかった ${S.hits}`, W * 0.94, H * 0.025);
    // 信号
    if (S.stopping) {
      g.fillStyle = '#ff4d4d';
      g.beginPath();
      g.arc(W * 0.5 - H * 0.05, H * 0.025, H * 0.014, 0, 7);
      g.fill();
    }
    // メッセージ（窓の曇りに指で書いたような文字）
    if (S.msgT > 0) {
      const a = Math.min(1, S.msgT * 2);
      g.textAlign = 'center';
      g.font = `900 ${Math.round(H * 0.075)}px "Yuji Syuku", "M PLUS Rounded 1c", serif`;
      g.fillStyle = `rgba(255,255,255,${0.85 * a})`;
      g.strokeStyle = `rgba(0,0,0,${0.35 * a})`;
      g.lineWidth = 4;
      g.strokeText(S.msg, W / 2, H * 0.17);
      g.fillText(S.msg, W / 2, H * 0.17);
    }
  }

  // ---------- ループ ----------
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!S.over && !S.clear && !paused) {
      driveCar(dt);
      trafficCars(dt);
      stepRunner(dt);
      S.msgT = Math.max(0, S.msgT - dt);
      if (-S.camX >= S.st.length) stageClear();
    } else if (S.over) {
      // 置いていかれる: 人型が右へ流れて消える
      S.rx += (S.speed * f) / W3.Z.line * dt;
      driveCar(dt);
    }
    W3.render(S.camX, S.bump);
    drawOverlay();
    raf = requestAnimationFrame(loop);
  }

  // ---------- 音 ----------
  const sfx = {
    jump: () => audio.tone(520, 0.08, { type: 'triangle', vol: 0.12, to: 880 }),
    jump2: () => audio.tone(700, 0.08, { type: 'triangle', vol: 0.12, to: 1200 }),
    land: () => audio.noise(0.05, { vol: 0.12, cutoff: 900 }),
    hit: () => {
      audio.noise(0.18, { vol: 0.4, cutoff: 700 });
      audio.tone(180, 0.2, { type: 'square', vol: 0.1, to: 80 });
    },
    win: () => [523, 659, 784, 1047].forEach((fq, i) => audio.tone(fq, 0.18, { type: 'triangle', vol: 0.16, delay: i * 0.12 })),
    lose: () => [392, 330, 262].forEach((fq, i) => audio.tone(fq, 0.22, { type: 'triangle', vol: 0.14, delay: i * 0.18 })),
  };

  // ---------- 画面 ----------
  let paused = false;
  function show(name) {
    for (const s of ['title', 'howto', 'result']) $('screen-' + s).classList.toggle('hidden', s !== name);
  }
  function showResult(win) {
    audio.stopMusic && audio.stopMusic();
    $('result-head').textContent = win ? `${S.st.places[S.st.places.length - 1][1]}に到着！` : '置いていかれた…';
    $('result-head').className = 'result-head' + (win ? ' win' : '');
    const d = Math.min(S.st.length, -S.camX);
    const best = storage.get('shaso.best1', null);
    $('result-sub').innerHTML = win
      ? `タイム ${S.t.toFixed(1)}秒　ぶつかった ${S.hits}回${best ? `<br>ベスト ${best.toFixed(1)}秒` : ''}`
      : `${placeNow()}あたりで脱落（${Math.round((d / S.st.length) * 100)}%）　ぶつかった ${S.hits}回`;
    show('result');
  }
  $('btn-start').addEventListener('click', () => {
    audio.unlock();
    show(null);
    demoMode = false;
    start(0);
  });
  $('btn-again').addEventListener('click', () => {
    show(null);
    demoMode = false;
    start(0);
  });
  $('btn-howto').addEventListener('click', () => show('howto'));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => show('title')));
  // タップでジャンプ（画面のどこでも）
  $('app').addEventListener('pointerdown', (e) => {
    if (e.target.closest('.screen')) return;
    e.preventDefault();
    jump();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      jump();
    }
  });
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    last = performance.now();
  });
  function soundLabel() {
    $('btn-sound').textContent = audio.muted ? '🔇 サウンド OFF' : '🔊 サウンド ON';
  }
  $('btn-sound').addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    soundLabel();
  });

  W3.init($('gl'));
  window.addEventListener('resize', () => {
    resize();
  });
  resize();
  soundLabel();
  // タイトルの後ろで景色を流しておく（人型は自動でジャンプ）
  restartDemo();
  setInterval(() => {
    if (S && S.demo && (S.rx > W * 0.55 || Math.random() < 0.3)) jump();
  }, 650);
  window.ShasoDebug = { get S() { return S; }, P, jump };
})();
