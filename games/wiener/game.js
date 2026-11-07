// ウインナー焼き ― 画面と操作
(function () {
  'use strict';
  const PH = window.WienerPhysics;
  const SC = window.WienerScene;
  const { audio, haptics, storage } = window.GameShared;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ランク（「なし」はランクを表示しない）
  const RANKS = [
    { id: 'なし', min: 0, name: 'ただのウインナー', comments: ['まだ冷たい…', '温めただけ', '焼く前に食べたのかな？'], grad: ['#8d8d8d', '#5a5a5a'] },
    { id: 'N', min: 20, name: '焼いただけ', comments: ['とりあえず火は通った', 'お弁当のすみっこ', '可もなく不可もなく'], grad: ['#b08a6a', '#6e5640'] },
    { id: 'R', min: 40, name: '普通のウインナー', comments: ['朝ごはんにちょうどいい', 'ふつうにおいしい', 'ご飯がすすむ'], grad: ['#4f9be0', '#235a9c'] },
    { id: 'SR', min: 60, name: 'こんがりウインナー', comments: ['焼き色がきれい！', 'いいにおいがしてきた', 'お店で出せるレベル'], grad: ['#b77ce6', '#6b3aa8'] },
    { id: 'SSR', min: 76, name: 'パリッとジューシー', comments: ['かじった瞬間、パリッ！', '肉汁があふれ出す', 'ビールが欲しくなる'], grad: ['#ffd76a', '#c98a12'] },
    { id: 'UR', min: 90, name: '究極のパリッ', comments: ['破裂寸前の極み！', '皮がパンパン、音まで聞こえる', 'ウインナー職人の称号を授けよう'], grad: ['#ff6b8b', '#ffd36b', '#5ee0a0', '#5ab0ff', '#b98cff'] },
  ];
  const BURST = { name: '破裂…', comments: ['パァン！ 皮が耐えられなかった…', '火が強すぎたかも', 'もう少し手前で止めていれば…'], grad: ['#7a1f1f', '#2b0b0b'] };

  let S = null; // 焼いている状態
  let W = 1;
  let H = 1;
  let rollAnim = 0;
  let rollTarget = 0;
  let paused = false;
  let over = false;
  let sfxT = 0;
  let popT = 0;
  const fx = $('fx');
  const g = fx.getContext('2d');
  const bubbles = [];

  function resize() {
    const app = $('app');
    W = app.clientWidth;
    H = app.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fx.width = W * dpr;
    fx.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    SC.layout(W, H * 0.72);
  }

  function newGame() {
    S = PH.create();
    rollAnim = 0;
    rollTarget = 0;
    over = false;
    knobAngle = 0;
    setKnob(0, true);
    beaker.ml = beaker.cap;
    beaker.pouring = false;
    beaker.tilt = 0;
    SC.reset();
    sync();
  }
  function setHeat(v) {
    if (!S || over) return;
    S.heat = clamp(v, 0, 1);
  }

  // ---------- ガスコンロのつまみ ----------
  // 上（0度）が「消」。時計回りに回すほど火が強くなる（最大 270度）
  const IGNITE = 28;
  const MAXA = 270;
  let knobAngle = 0;
  function setKnob(a, silent) {
    const prev = knobAngle;
    knobAngle = clamp(a, 0, MAXA);
    $('knob-dial').style.transform = `rotate(${knobAngle}deg)`;
    const on = knobAngle >= IGNITE;
    if (!silent && on && prev < IGNITE) {
      // カチカチ…ボッ
      [0, 0.09].forEach((d) => audio.tone(3200, 0.02, { type: 'square', vol: 0.12, delay: d }));
      audio.noise(0.25, { vol: 0.25, cutoff: 600, delay: 0.2 });
      haptics.vibrate([8, 60, 8]);
    } else if (!silent && !on && prev >= IGNITE) audio.noise(0.12, { vol: 0.12, cutoff: 900 });
    const h = on ? 0.08 + ((knobAngle - IGNITE) / (MAXA - IGNITE)) * 0.92 : 0;
    setHeat(h);
    $('heat-label').textContent = !on ? '消' : h < 0.4 ? '弱火' : h < 0.7 ? '中火' : '強火';
    $('heat-label').className = !on ? 'off' : h < 0.4 ? 'low' : h < 0.7 ? 'mid' : 'high';
  }
  (function knobInput() {
    const el = $('knob');
    let start = null;
    const angAt = (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      return (Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180) / Math.PI; // 上が0、時計回り
    };
    el.addEventListener('pointerdown', (e) => {
      if (!S || over) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      start = { a: angAt(e), k: knobAngle };
      audio.unlock();
    });
    el.addEventListener('pointermove', (e) => {
      if (!start) return;
      let d = angAt(e) - start.a;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      start.a += d;
      start.k = clamp(start.k + d, 0, MAXA);
      setKnob(start.k);
    });
    const end = () => (start = null);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  })();

  // ---------- 水のビーカー（目盛り付き） ----------
  const beaker = { cap: 100, ml: 100, pouring: false, tilt: 0, refillT: 0, x: 0, y: 0, w: 0, h: 0 };
  const POUR = 22; // ml/秒
  // ml を、ふだん使う量の目安に
  function measure(ml) {
    if (ml < 1) return '';
    if (ml < 4) return 'ほんの少し';
    if (ml < 12) return `小さじ${Math.max(1, Math.round(ml / 5))}杯くらい`;
    if (ml < 90) {
      const t = Math.round((ml / 15) * 2) / 2;
      return `大さじ${t % 1 ? Math.floor(t) + '杯半' : t + '杯'}くらい`;
    }
    return `コップ${Math.round((ml / 200) * 4) / 4}杯くらい`;
  }
  function pourStep(dt) {
    const b = beaker;
    const target = b.pouring && b.ml > 0 ? 1 : 0;
    b.tilt += (target - b.tilt) * Math.min(1, dt * 8);
    if (b.pouring && b.tilt > 0.6 && b.ml > 0 && !over) {
      const ml = Math.min(b.ml, POUR * dt);
      b.ml -= ml;
      PH.addWater(S, ml);
      if (Math.random() < dt * 6) audio.noise(0.12, { vol: S.panT > 100 ? 0.3 : 0.08, cutoff: S.panT > 100 ? 3500 : 1200 });
      if (S.panT > 98 && Math.random() < dt * 2) say('ジュワーッ', '#bfe3ff');
    }
    // 空になったら、手を離すと水をくみ直す
    if (!b.pouring && b.ml < b.cap) {
      b.refillT += dt;
      if (b.ml <= 0.5 && b.refillT > 0.8) b.ml = b.cap;
    } else b.refillT = 0;
  }
  function drawBeaker() {
    const b = beaker;
    const w = Math.min(W * 0.2, 86);
    const h = w * 1.25;
    b.w = w;
    b.h = h;
    b.x = W - w - 16;
    b.y = H * 0.16;
    const ang = -b.tilt * 1.05; // 左へ傾けて注ぐ
    g.save();
    // 注いでいる水の流れ
    if (b.tilt > 0.6 && b.ml > 0 && b.pouring) {
      const sx = b.x + 4;
      const sy = b.y + h * 0.15;
      g.strokeStyle = 'rgba(170,215,240,0.75)';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(sx, sy);
      g.quadraticCurveTo(sx - 30, sy + 10, W * 0.52, H * 0.42);
      g.stroke();
    }
    g.translate(b.x, b.y + h);
    g.rotate(ang);
    // 水（傾けても水面は水平）
    const lv = b.ml / b.cap;
    if (lv > 0) {
      g.save();
      g.beginPath();
      g.rect(3, -h + 6, w - 6, h - 9);
      g.clip();
      g.rotate(-ang);
      const surf = -h * lv * 0.88 - 3;
      const wg = g.createLinearGradient(0, surf, 0, 0);
      wg.addColorStop(0, 'rgba(150,205,235,0.75)');
      wg.addColorStop(1, 'rgba(90,160,210,0.85)');
      g.fillStyle = wg;
      g.fillRect(-w * 2, surf, w * 5, h * 3);
      g.restore();
    }
    // ガラス
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(-4, -h);
    g.lineTo(2, -h + 6);
    g.lineTo(2, -2);
    g.quadraticCurveTo(2, 0, 6, 0);
    g.lineTo(w - 6, 0);
    g.quadraticCurveTo(w - 2, 0, w - 2, -2);
    g.lineTo(w - 2, -h);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(2, -h, w - 4, h);
    // 目盛り（10mlごと。20ごとに数字）
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 1.2;
    g.font = '800 9px sans-serif';
    g.textAlign = 'right';
    for (let m = 10; m <= b.cap; m += 10) {
      const y = -(m / b.cap) * h * 0.88 - 3;
      const big = m % 20 === 0;
      g.beginPath();
      g.moveTo(w - 4, y);
      g.lineTo(w - (big ? 18 : 11), y);
      g.stroke();
      if (big) g.fillText(m, w - 20, y + 3);
    }
    g.textAlign = 'center';
    g.font = '900 10px sans-serif';
    g.fillText('ml', w / 2 - 6, -6);
    g.restore();
    // 下に、入れた量の目安
    const poured = S.poured || 0;
    g.textAlign = 'right';
    g.font = '900 12px "M PLUS Rounded 1c", sans-serif';
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 3;
    const lines = [b.pouring ? 'そそぎ中…' : 'おして注ぐ', `入れた量 ${Math.round(poured)}ml`, measure(poured)];
    lines.forEach((t, i) => {
      if (!t) return;
      g.strokeText(t, W - 14, b.y + h + 18 + i * 16);
      g.fillText(t, W - 14, b.y + h + 18 + i * 16);
    });
  }
  const inBeaker = (x, y) => x > beaker.x - 10 && x < beaker.x + beaker.w + 10 && y > beaker.y - 10 && y < beaker.y + beaker.h + 10;
  function roll() {
    if (!S || over) return;
    rollTarget += Math.PI / 2;
    audio.noise(0.08, { vol: 0.15, cutoff: 1500 });
    haptics.vibrate(10);
  }

  function serve() {
    if (!S || over) return;
    over = true;
    const sc = PH.score(S);
    showResult(sc);
  }

  // ---------- ループ ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    if (S && !paused) {
      // 転がすアニメーション
      if (rollAnim < rollTarget) rollAnim = Math.min(rollTarget, rollAnim + dt * 7);
      S.roll = rollAnim;
      if (!over && $('screen-title').classList.contains('hidden')) {
        pourStep(dt);
        PH.step(S, dt, SC.downBin(S.roll));
        if (S.burst) boom();
        sounds(dt);
      }
      SC.updateSausage({ brown: S.brown, roll: S.roll, tension: clamp(S.tension, 0, 1.05), gloss: S.gloss, heatC: S.coreT, burst: S.burst });
      SC.render(dt, S);
      drawHud(dt);
    }
    requestAnimationFrame(loop);
  }

  // ---------- 音と文字 ----------
  function say(text, color) {
    bubbles.push({ text, color: color || '#fff', x: W * (0.3 + Math.random() * 0.4), y: H * (0.25 + Math.random() * 0.15), life: 1 });
  }
  function sounds(dt) {
    sfxT -= dt;
    popT -= dt;
    const wet = S.water > 0.5;
    if (sfxT <= 0) {
      sfxT = 0.09;
      if (wet && S.panT > 92) audio.noise(0.1, { vol: 0.06 + S.heat * 0.06, cutoff: 700 });
      else if (!wet && S.panT > 110) audio.noise(0.1, { vol: Math.min(0.28, (S.panT - 110) / 400), cutoff: 4200 + Math.random() * 1500 });
    }
    // ジュー / パチパチ の文字
    if (!wet && S.panT > 140 && Math.random() < dt * 1.2) say(Math.random() < 0.5 ? 'ジュー' : 'パチパチ', '#ffe0a0');
    if (wet && S.panT > 95 && Math.random() < dt * 0.8) say('グツグツ', '#bfe3ff');
    // 破裂が近いと「ピチッ」と鳴る（だんだん増える）
    if (S.tension > 0.72 && popT <= 0) {
      popT = 0.25 + (1 - S.tension) * 4 * Math.random();
      audio.tone(2400 + Math.random() * 1200, 0.03, { type: 'square', vol: 0.08 });
      if (S.tension > 0.85) {
        say('ピチッ', '#ff9a9a');
        haptics.vibrate(12);
      }
    }
  }
  function boom() {
    if (over) return;
    over = true;
    SC.burst();
    audio.noise(0.5, { vol: 0.8, cutoff: 1600 });
    audio.tone(160, 0.4, { type: 'square', vol: 0.2, to: 50 });
    haptics.vibrate([80, 40, 160]);
    bubbles.push({ text: 'パァン！！', color: '#ff5050', x: W / 2, y: H * 0.3, life: 1.8, big: true });
    setTimeout(() => showResult({ burst: true, total: 0 }), 1400);
  }

  function drawHud(dt) {
    g.clearRect(0, 0, W, H);
    // 浮かぶ文字
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.life -= dt;
      b.y -= dt * 20;
      if (b.life <= 0) {
        bubbles.splice(i, 1);
        continue;
      }
      g.globalAlpha = Math.min(1, b.life * 2);
      g.font = `900 ${b.big ? 52 : 22}px "M PLUS Rounded 1c", sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = b.big ? 8 : 5;
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.strokeText(b.text, b.x, b.y);
      g.fillStyle = b.color;
      g.fillText(b.text, b.x, b.y);
      g.globalAlpha = 1;
    }
    if (!over || S.burst) drawBeaker();
    sync();
  }
  // HTMLの表示を更新
  function sync() {
    if (!S) return;
    const c = S.coreT;
    $('core').textContent = c < 30 ? '冷たい' : c < 55 ? 'ぬるい' : c < PH.K.cooked ? 'あたたかい' : c < 95 ? 'アツアツ ✓' : 'グラグラ ✓';
    $('core').className = 'val' + (c >= PH.K.cooked ? ' ok' : '');
    $('water-n').textContent = S.water > 0.5 ? `フライパンの水 約${Math.round(S.water)}ml` : '';
    $('time').textContent = `${Math.floor(S.t / 60)}:${String(Math.floor(S.t % 60)).padStart(2, '0')}`;
  }

  // ---------- 結果 ----------
  function rankOf(total) {
    let r = RANKS[0];
    for (const x of RANKS) if (total >= x.min) r = x;
    return r;
  }
  function showResult(sc) {
    const card = $('rank-card');
    let rk;
    if (sc.burst) rk = BURST;
    else {
      rk = rankOf(sc.total);
      const best = storage.get('wiener.best', null);
      if (best === null || sc.total > best) storage.set('wiener.best', sc.total);
    }
    card.style.background = rk.grad.length > 2 ? `linear-gradient(120deg, ${rk.grad.concat(rk.grad[0]).join(', ')})` : `linear-gradient(140deg, ${rk.grad[0]}, ${rk.grad[1]})`;
    card.className = 'rank-card' + (rk.id === 'UR' ? ' ur' : '');
    const showId = !sc.burst && rk.id !== 'なし';
    $('rank-id').textContent = showId ? rk.id : '';
    $('rank-id').classList.toggle('hidden', !showId);
    $('rank-name').textContent = rk.name;
    $('rank-comment').textContent = '「' + rk.comments[Math.floor(Math.random() * rk.comments.length)] + '」';
    $('rank-score').innerHTML = sc.burst
      ? `<small>焼き時間 ${Math.round(S.t)}秒</small>`
      : `${sc.total}点<small>焼き色 ${Math.round(sc.brown * 100)}　ムラなし ${Math.round(sc.even * 100)}　ジューシー ${Math.round(sc.juicy * 100)}　パンパン ${Math.round(sc.tight * 100)}${sc.cooked ? '' : '<br>中まで火が通っていない'}${sc.burnt ? '<br>焦げている' : ''}</small>`;
    const best = storage.get('wiener.best', null);
    $('rank-best').textContent = best !== null ? `これまでの最高 ${best}点` : '';
    if (!sc.burst) {
      const i = RANKS.indexOf(rk);
      [523, 659, 784, 1047, 1319].slice(0, 2 + i).forEach((f, k) => audio.tone(f, 0.16, { type: 'triangle', vol: 0.14, delay: k * 0.09 }));
    }
    show('result');
  }

  // ---------- 入力 ----------
  $('btn-roll').addEventListener('click', roll);
  $('btn-serve').addEventListener('click', serve);
  // ビーカーをおしている間は注ぐ / ウインナーをタップで転がす
  $('gl').addEventListener('pointerdown', (e) => {
    if (!S || over) return;
    const r = $('gl').getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (inBeaker(px, py)) {
      $('gl').setPointerCapture(e.pointerId);
      beaker.pouring = true;
      audio.unlock();
      return;
    }
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    if (SC.hitSausage(nx, ny)) roll();
  });
  const stopPour = () => (beaker.pouring = false);
  $('gl').addEventListener('pointerup', stopPour);
  $('gl').addEventListener('pointercancel', stopPour);

  // ---------- 画面 ----------
  function show(name) {
    for (const s of ['title', 'howto', 'result']) $('screen-' + s).classList.toggle('hidden', s !== name);
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
  document.addEventListener('visibilitychange', () => (paused = document.hidden));
  function soundLabel() {
    $('btn-sound').textContent = audio.muted ? '🔇 サウンド OFF' : '🔊 サウンド ON';
  }
  $('btn-sound').addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    soundLabel();
  });

  SC.init($('gl'));
  window.addEventListener('resize', resize);
  resize();
  soundLabel();
  newGame();
  const best = storage.get('wiener.best', null);
  if (best !== null) $('title-best').textContent = `これまでの最高 ${best}点${rankOf(best).id === 'なし' ? '' : `（${rankOf(best).id}）`}`;
  requestAnimationFrame(loop);
  window.WienerDebug = { get S() { return S; }, serve, roll, setHeat, setKnob, beaker };
})();
