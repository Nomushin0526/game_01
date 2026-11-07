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
    $('heat').value = 0;
    setHeat(0);
    SC.reset();
    sync();
  }
  function setHeat(v) {
    if (!S || over) return;
    S.heat = clamp(v, 0, 1);
    $('heat-label').textContent = S.heat < 0.05 ? '消火' : S.heat < 0.4 ? '弱火' : S.heat < 0.7 ? '中火' : '強火';
  }
  function roll() {
    if (!S || over) return;
    rollTarget += Math.PI / 2;
    audio.noise(0.08, { vol: 0.15, cutoff: 1500 });
    haptics.vibrate(10);
  }
  function addWater() {
    if (!S || over) return;
    if (PH.addWater(S)) {
      say('ジュワーッ', '#bfe3ff');
      audio.noise(0.6, { vol: 0.35, cutoff: 3000 });
      haptics.vibrate(30);
    }
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
        PH.step(S, dt, SC.downBin(S.roll));
        if (S.burst) boom();
        sounds(dt);
      }
      SC.updateSausage({ brown: S.brown, roll: S.roll, swell: clamp(S.tension, 0, 1.2), tension: clamp(S.tension, 0, 1), gloss: S.gloss, burst: S.burst });
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
    sync();
  }
  // HTMLの表示を更新
  function sync() {
    if (!S) return;
    const t = clamp(S.tension, 0, 1);
    $('tension-fill').style.width = `${t * 100}%`;
    $('tension-fill').className = 'fill' + (t > 0.85 ? ' hot' : t > 0.7 ? ' warm' : '');
    const c = S.coreT;
    $('core').textContent = c < 30 ? '冷たい' : c < 55 ? 'ぬるい' : c < PH.K.cooked ? 'あたたかい' : c < 95 ? 'アツアツ ✓' : 'グラグラ ✓';
    $('core').className = 'val' + (c >= PH.K.cooked ? ' ok' : '');
    $('water-n').textContent = S.water > 0.5 ? `💧${Math.round(S.water)}ml` : '';
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
  $('heat').addEventListener('input', (e) => setHeat(+e.target.value));
  $('btn-roll').addEventListener('click', roll);
  $('btn-water').addEventListener('click', addWater);
  $('btn-serve').addEventListener('click', serve);
  $('gl').addEventListener('pointerdown', (e) => {
    if (!S || over) return;
    const r = $('gl').getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    if (SC.hitSausage(nx, ny)) roll();
  });

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
  window.WienerDebug = { get S() { return S; }, serve, addWater, roll, setHeat };
})();
