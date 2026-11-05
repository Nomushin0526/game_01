// カートラッシュ！ ゲーム進行（状態管理・当たり判定・UI）
(function () {
  'use strict';

  const { storage, audio, Input, isTouchDevice } = window.GameShared;
  const STAGES = window.CartStages;
  const THEMES = window.CartThemes;
  const Render = window.CartRender;
  const { DRAW, CAM_BACK, zoneAt } = Render;
  const MAX_HP = 3;
  const REC_KEY = 'cartRush.records';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  Render.setContext(ctx);
  const input = new Input(canvas);
  const $ = (id) => document.getElementById(id);

  let records = storage.get(REC_KEY, {});
  let W = 0;
  let H = 0;

  // ---------- 効果音 ----------
  const sfx = {
    hit() {
      audio.noise(0.25, { vol: 0.35, cutoff: 1400 });
      audio.tone(220, 0.25, { type: 'sawtooth', to: 70, vol: 0.18 });
    },
    item() {
      audio.tone(988, 0.07, { type: 'square', vol: 0.1 });
      audio.tone(1319, 0.12, { type: 'square', vol: 0.1, delay: 0.06 });
    },
    checkpoint() {
      [659, 880, 1047, 1319].forEach((f, i) => audio.tone(f, 0.14, { type: 'triangle', vol: 0.22, delay: i * 0.08 }));
    },
    count() {
      audio.tone(523, 0.12, { type: 'square', vol: 0.12 });
    },
    go() {
      audio.tone(1047, 0.35, { type: 'square', vol: 0.14 });
    },
    warn() {
      audio.tone(1568, 0.05, { type: 'square', vol: 0.08 });
    },
    goal() {
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
        audio.tone(f, i === 5 ? 0.5 : 0.13, { type: 'triangle', vol: 0.24, delay: i * 0.12 })
      );
    },
    over() {
      [392, 330, 262, 196].forEach((f, i) => audio.tone(f, 0.22, { type: 'triangle', vol: 0.22, delay: i * 0.18 }));
    },
    click() {
      audio.tone(660, 0.05, { type: 'square', vol: 0.08 });
    },
  };

  // ---------- 乱数 ----------
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  function pickWeighted(rng, table) {
    let total = 0;
    for (const k in table) total += table[k];
    let r = rng() * total;
    for (const k in table) {
      r -= table[k];
      if (r <= 0) return k;
    }
    return Object.keys(table)[0];
  }
  function shuffle(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  }

  // ---------- 障害物 ----------
  const DIMS = {
    shopper: { w: 0.3, len: 0.5 },
    cart: { w: 0.4, len: 0.9 },
    display: { w: 0.8, len: 0.9 },
    boxes: { w: 0.55, len: 0.6 },
    wetsign: { w: 0.28, len: 0.4 },
    car: { w: 0.85, len: 3.6 },
    truck: { w: 1.1, len: 6.2 },
    bike: { w: 0.3, len: 1.6 },
    cone: { w: 0.22, len: 0.4 },
    barrier: { w: 1.0, len: 0.3 },
    cat: { w: 0.28, len: 0.5 },
  };
  const SHIRTS = ['#5fa4e6', '#7bc66b', '#f3b740', '#b07ad6', '#ec6f6f', '#4fc1b5', '#f28dbb', '#8d6e63'];
  const HAIRS = ['#3b2a20', '#6b4a2f', '#2b2b2b', '#a8a8a8', '#c98d4b'];
  const PANTS = ['#3c4a63', '#5b4636', '#2f3640', '#6d6d7a'];
  const CAR_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#ecf0f1', '#2ecc71', '#9b59b6', '#34495e', '#e67e22'];
  const GROCERIES = ['apple', 'milk', 'bread', 'carrot', 'egg'];

  const G = {
    state: 'menu',
    time: 0,
    stage: STAGES[0],
    player: { x: 0, z: 0, speed: 0, vx: 0, steer: 0, phase: 0 },
    obstacles: [],
    items: [],
    particles: [],
    floaters: [],
  };
  window.CartRushDebug = G; // 開発用

  function addOb(kind, x, z, extra) {
    const d = DIMS[kind];
    const o = Object.assign({ kind, x, z, w: d.w, len: d.len, seed: G.rng(), hit: false, wob: 0, kx: 0 }, extra || {});
    G.obstacles.push(o);
    return o;
  }
  function person(rng) {
    return {
      shirt: SHIRTS[Math.floor(rng() * SHIRTS.length)],
      hair: HAIRS[Math.floor(rng() * HAIRS.length)],
      pants: PANTS[Math.floor(rng() * PANTS.length)],
    };
  }
  function addItems(x, z, count, icon) {
    for (let k = 0; k < count; k++) {
      G.items.push({ kind: 'item', x, z: z + k * 1.8, icon: icon || GROCERIES[Math.floor(G.rng() * GROCERIES.length)], taken: false });
    }
  }

  // 1列ぶんの障害物を置き、次の列までの間隔を返す
  function spawnRow(z) {
    const rng = G.rng;
    const zone = zoneAt(G.stage, z);
    const th = THEMES[zone.type];
    const diff = clamp(z / G.stage.length, 0, 1);

    if (zone.type === 'market') {
      const lanes = shuffle(rng, [-2.2, -1.1, 0, 1.1, 2.2]);
      const n = 1 + (rng() < 0.35 + diff * 0.4 ? 1 : 0) + (rng() < diff * 0.35 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const x = lanes[k] + (rng() - 0.5) * 0.3;
        const kind = pickWeighted(rng, { shopper: 36, cart: 18, display: 14, boxes: 16, wetsign: 16 });
        const oz = z + rng() * 2;
        if (kind === 'shopper') {
          const moving = rng() < 0.3 + diff * 0.3;
          addOb('shopper', x, oz, Object.assign(person(rng), { basket: rng() < 0.6, vx: moving ? (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.7) : 0, bounce: 2.5 }));
        } else if (kind === 'display' || kind === 'boxes') {
          addOb(kind, clamp(x, -2.2, 2.2), oz);
        } else addOb(kind, x, oz);
      }
      if (rng() < 0.55) addItems(lanes[n] || 0, z + 4, 1 + Math.floor(rng() * 3));
      return lerp(12, 8, diff) + rng() * 3;
    }

    if (zone.type === 'street') {
      const lanes = shuffle(rng, [-2.4, -0.8, 0.8, 2.4]);
      const n = 1 + (rng() < 0.3 + diff * 0.4 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const kind = pickWeighted(rng, { car: 34, bike: 12, cone: 18, barrier: 16, cat: 10, shopper: 10 });
        const x = lanes[k];
        if (kind === 'car') addOb('car', (x < 0 ? -1.75 : 1.75) + (rng() - 0.5) * 0.4, z, { color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)], vz: 4 + rng() * 4 });
        else if (kind === 'bike') addOb('bike', x < 0 ? -2.6 : 2.6, z, Object.assign(person(rng), { vz: 3 + rng() * 1.5 }));
        else if (kind === 'barrier') addOb('barrier', clamp(x, -2.4, 2.4), z);
        else if (kind === 'cat') {
          const from = rng() < 0.5 ? -1 : 1;
          addOb('cat', from * (th.roadW + 0.8), z, { vx: -from * (1.6 + rng() * 0.6), trigger: 24, active: false });
        } else if (kind === 'shopper') addOb('shopper', x, z, Object.assign(person(rng), { basket: false, vx: 0 }));
        else {
          addOb('cone', x - 0.35, z);
          addOb('cone', x + 0.35, z + 0.6);
        }
      }
      if (rng() < 0.5) addItems(lanes[n] || 0, z + 5, 1 + Math.floor(rng() * 3), 'coin');
      return lerp(14, 10, diff) + rng() * 4;
    }

    // highway
    const lanes = shuffle(rng, [-3.33, 0, 3.33]);
    const n = 1 + (rng() < 0.35 + diff * 0.35 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const x = lanes[k];
      const kind = pickWeighted(rng, { car: 50, truck: 25, cone: 25 });
      if (kind === 'car') addOb('car', x + (rng() - 0.5) * 0.5, z, { color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)], vz: 9 + rng() * 4 });
      else if (kind === 'truck') addOb('truck', x, z, { color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)], vz: 8 + rng() * 2 });
      else {
        const dir = rng() < 0.5 ? -1 : 1;
        for (let c = 0; c < 4; c++) addOb('cone', x - dir * 1.1 + dir * c * 0.7, z + c * 1.2);
      }
    }
    if (rng() < 0.5) addItems(lanes[n] || 0, z + 6, 2 + Math.floor(rng() * 3), 'coin');
    return lerp(20, 14, diff) + rng() * 5;
  }

  function spawnAhead() {
    const st = G.stage;
    while (G.nextSpawn < G.player.z + DRAW && G.nextSpawn < st.length - 18) {
      const z = G.nextSpawn;
      const nearCp = st.checkpoints.some((c) => Math.abs(z - c) < 9);
      G.nextSpawn += nearCp ? 4 : spawnRow(z);
    }
  }

  // ---------- 画面とHUD ----------
  const SCREENS = ['title', 'stage', 'howto', 'pause', 'result'];
  function showScreen(name) {
    for (const s of SCREENS) $('screen-' + s).classList.toggle('hidden', s !== name);
  }
  function setHud(visible) {
    $('hud').classList.toggle('hidden', !visible);
  }

  let bannerTimer = 0;
  function banner(main, cls, sub) {
    const b = $('banner');
    b.className = 'banner';
    void b.offsetWidth;
    b.innerHTML = `<div class="banner-main">${main}</div>${sub ? `<div class="banner-sub">${sub}</div>` : ''}`;
    b.classList.add('show');
    if (cls) b.classList.add(cls);
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('show'), cls === 'count' ? 800 : 1500);
  }
  function showZone(name) {
    const el = $('zone-label');
    el.textContent = name;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }
  function flash() {
    const el = $('flash');
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  function buildHud() {
    const st = G.stage;
    const normal = G.mode === 'normal';
    $('hearts').classList.toggle('hidden', !normal);
    $('hits').classList.toggle('hidden', normal);
    $('timer-label').textContent = normal ? 'のこり時間' : 'タイム';
    const ticks = $('progress-ticks');
    ticks.innerHTML = '';
    st.checkpoints.forEach((c) => {
      const t = document.createElement('i');
      t.style.left = (c / st.length) * 100 + '%';
      ticks.appendChild(t);
    });
    renderHearts();
    hudCache = {};
  }
  function renderHearts() {
    const el = $('hearts');
    el.innerHTML = '';
    for (let i = 0; i < MAX_HP; i++) {
      const s = document.createElement('span');
      s.className = 'heart' + (i < G.hp ? ' full' : '');
      s.textContent = '♥';
      el.appendChild(s);
    }
  }
  let hudCache = {};
  function setText(id, value) {
    if (hudCache[id] === value) return;
    hudCache[id] = value;
    $(id).textContent = value;
  }
  function updateHud() {
    const P = G.player;
    if (G.mode === 'normal') {
      setText('timer', G.timeLeft.toFixed(1));
      $('timer').classList.toggle('warn', G.timeLeft <= 10 && G.state === 'run');
    } else {
      setText('timer', formatTime(G.elapsed + G.penalty));
      setText('hits', `ミス ${G.hits}`);
    }
    setText('score', String(Math.floor(G.score)));
    const pct = clamp(P.z / G.stage.length, 0, 1) * 100;
    $('progress-fill').style.width = pct + '%';
    $('progress-cart').style.left = pct + '%';
  }

  // ---------- 進行 ----------
  function resize() {
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Render.setView(W, H);
  }
  window.addEventListener('resize', resize);

  function resetPlayer() {
    G.player = { x: 0, z: 0, speed: 0, vx: 0, steer: 0, phase: 0 };
    G.camX = 0;
  }

  function goMenu() {
    G.state = 'menu';
    G.stage = STAGES[0];
    G.obstacles = [];
    G.items = [];
    G.particles = [];
    G.floaters = [];
    G.cpIndex = 0;
    G.invuln = 0;
    G.showPlayer = true;
    resetPlayer();
    setHud(false);
    showScreen('title');
  }

  function startStage(idx, mode) {
    const st = STAGES[idx];
    Object.assign(G, {
      state: 'countdown',
      mode,
      stageIdx: idx,
      stage: st,
      obstacles: [],
      items: [],
      particles: [],
      floaters: [],
      nextSpawn: 40,
      timeLeft: st.startTime,
      elapsed: 0,
      penalty: 0,
      hp: MAX_HP,
      score: 0,
      hits: 0,
      itemsTaken: 0,
      cpIndex: 0,
      invuln: 0,
      shake: 0,
      countdown: 3,
      lastCount: 4,
      endTimer: 0,
      laps: [],
      warnSec: 99,
      zone: null,
      showPlayer: true,
      rng: mulberry32((Date.now() ^ (idx * 7919)) >>> 0),
    });
    resetPlayer();
    buildHud();
    showScreen(null);
    setHud(true);
    showZone(`STAGE ${st.no}  ${st.name}`);
    if (isTouchDevice()) {
      const hint = $('touch-hint');
      hint.classList.remove('hidden');
      setTimeout(() => hint.classList.add('hidden'), 3500);
    }
  }

  function onHit(o) {
    const P = G.player;
    o.hit = true;
    o.kx = (o.x >= P.x ? 1 : -1) * (o.vz ? 0 : 2.5);
    G.hits++;
    G.invuln = 1.6;
    G.shake = 0.35;
    P.speed *= 0.15;
    sfx.hit();
    flash();
    burst(['#ffd166', '#ffffff', '#ff6b6b'], 14);
    if (G.mode === 'normal') {
      G.hp--;
      renderHearts();
      floater('HP -1', '#ef476f');
      if (G.hp <= 0) gameOver('hp');
    } else {
      G.penalty += G.stage.taPenalty;
      floater(`+${G.stage.taPenalty}秒`, '#ef476f');
    }
  }

  function passCheckpoint() {
    const i = G.cpIndex++;
    sfx.checkpoint();
    G.score += 500;
    burst(['#ff8c42', '#ffd166', '#2ec4b6', '#ffffff'], 26);
    if (G.mode === 'normal') {
      const bonus = G.stage.cpBonus[i];
      G.timeLeft += bonus;
      G.warnSec = 99;
      let sub = `のこり時間 +${bonus}秒`;
      if (G.hp < MAX_HP) {
        G.hp++;
        renderHearts();
        sub += ' / HP回復！';
      }
      banner('CHECKPOINT!', 'cp', sub);
    } else {
      const lap = G.elapsed + G.penalty;
      G.laps.push(lap);
      banner('CHECKPOINT!', 'cp', formatTime(lap));
    }
  }

  function reachGoal() {
    G.state = 'goal';
    G.endTimer = 2.4;
    sfx.goal();
    burst(['#ff8c42', '#ffd166', '#2ec4b6', '#ef476f', '#ffffff'], 50);
    banner('GOAL!', 'goal', G.stage.goalLabel + 'に到着！');
  }

  function gameOver(reason) {
    G.state = 'over';
    G.overReason = reason;
    G.endTimer = 1.8;
    sfx.over();
    banner(reason === 'time' ? 'TIME UP' : 'GAME OVER', 'over');
  }

  function update(dt) {
    G.time += dt;
    const P = G.player;
    if (G.state === 'paused' || G.state === 'done') return;

    if (G.state === 'menu') {
      P.speed = 8;
      P.x = Math.sin(G.time * 0.5) * 1.4;
      P.steer = Math.cos(G.time * 0.5) * 0.4;
      P.z += P.speed * dt;
      P.phase += P.speed * dt * 1.3;
      if (P.z > 1100) P.z = 0;
      Render.setCamera(P.x * 0.6, P.z - CAM_BACK);
      return;
    }

    if (G.state === 'countdown') {
      G.countdown -= dt;
      const c = Math.ceil(G.countdown);
      if (c !== G.lastCount && c > 0) {
        G.lastCount = c;
        banner(String(c), 'count');
        sfx.count();
      }
      if (G.countdown <= 0) {
        G.state = 'run';
        banner('GO!', 'go');
        sfx.go();
      }
    }

    const zone = zoneAt(G.stage, P.z);
    const th = THEMES[zone.type];
    if (zone !== G.zone) {
      if (G.zone && G.state === 'run') showZone(zone.name);
      G.zone = zone;
    }

    if (G.state === 'run') {
      const ax = input.axisX();
      P.vx += (ax * th.steer - P.vx) * Math.min(1, dt * 9);
      P.x += P.vx * dt;
      if (P.x < -th.limit) {
        P.x = -th.limit;
        P.vx = Math.max(0, P.vx);
      }
      if (P.x > th.limit) {
        P.x = th.limit;
        P.vx = Math.min(0, P.vx);
      }
      if (input.down('ArrowDown', 'KeyS')) P.speed = Math.max(3, P.speed - 18 * dt);
      else if (P.speed < th.maxSpeed) P.speed = Math.min(th.maxSpeed, P.speed + th.accel * dt);
      else P.speed = Math.max(th.maxSpeed, P.speed - 8 * dt);
    } else if (G.state === 'goal' || G.state === 'over') {
      P.speed = Math.max(0, P.speed - 10 * dt);
      P.vx *= 0.9;
      P.x += P.vx * dt;
    }
    P.z += P.speed * dt;
    P.phase += P.speed * dt * 1.3;
    P.steer += (P.vx / th.steer - P.steer) * Math.min(1, dt * 10);

    if (G.state === 'run' || G.state === 'countdown') spawnAhead();

    // 障害物の移動
    for (const o of G.obstacles) {
      if (o.vz) o.z += o.vz * dt;
      if (o.trigger && !o.active && P.z > o.z - o.trigger) o.active = true;
      if (o.vx && (o.trigger ? o.active : true) && !o.hit) {
        o.x += o.vx * dt;
        if (o.bounce) {
          if (o.x < -o.bounce) {
            o.x = -o.bounce;
            o.vx = Math.abs(o.vx);
          } else if (o.x > o.bounce) {
            o.x = o.bounce;
            o.vx = -Math.abs(o.vx);
          }
        }
      }
      if (o.hit) {
        o.wob += dt;
        o.x += o.kx * dt;
        o.kx *= Math.pow(0.05, dt);
      }
    }
    G.obstacles = G.obstacles.filter((o) => o.z + o.len > P.z - CAM_BACK - 2 && Math.abs(o.x) < 12);
    G.items = G.items.filter((it) => !it.taken && it.z > P.z - CAM_BACK - 2);

    if (G.state === 'run') {
      const cz = P.z + 0.6;
      if (G.invuln <= 0) {
        for (const o of G.obstacles) {
          if (!o.hit && Math.abs(o.z - cz) < o.len / 2 + 0.75 && Math.abs(o.x - P.x) < o.w + 0.38) {
            onHit(o);
            break;
          }
        }
      }
      for (const it of G.items) {
        if (!it.taken && Math.abs(it.z - cz) < 1.0 && Math.abs(it.x - P.x) < 0.75) {
          it.taken = true;
          G.itemsTaken++;
          G.score += 100;
          sfx.item();
          floater('+100', '#3bb273');
        }
      }
    }

    if (G.state === 'run') {
      G.elapsed += dt;
      if (G.mode === 'normal') {
        G.timeLeft -= dt;
        if (G.timeLeft <= 10) {
          const s = Math.ceil(G.timeLeft);
          if (s < G.warnSec) {
            G.warnSec = s;
            sfx.warn();
          }
        }
        if (G.timeLeft <= 0) {
          G.timeLeft = 0;
          gameOver('time');
        }
      }
      G.score += P.speed * dt;
      if (G.state === 'run' && G.cpIndex < G.stage.checkpoints.length && P.z >= G.stage.checkpoints[G.cpIndex]) passCheckpoint();
      if (G.state === 'run' && P.z >= G.stage.length) reachGoal();
    }

    if (G.state === 'goal' || G.state === 'over') {
      G.endTimer -= dt;
      if (G.endTimer <= 0) showResult(G.state === 'goal');
    }

    G.invuln = Math.max(0, G.invuln - dt);
    G.shake = Math.max(0, G.shake - dt);
    G.camX = (G.camX || 0) + (P.x * 0.6 - (G.camX || 0)) * Math.min(1, dt * 6);
    Render.setCamera(G.camX, P.z - CAM_BACK);
    updateEffects(dt);
  }

  // ---------- エフェクト ----------
  function burst(colors, n) {
    const p = Render.playerScreen(G.player);
    if (!p) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 120 + Math.random() * 260;
      G.particles.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 160,
        life: 0.8 + Math.random() * 0.5,
        size: 4 + Math.random() * 6,
        color: colors[i % colors.length],
        rot: Math.random() * 6,
      });
    }
  }
  function floater(text, color) {
    const p = Render.playerScreen(G.player);
    if (!p) return;
    G.floaters.push({ x: p.x, y: p.y - 40, text, color, life: 1.0 });
  }
  function updateEffects(dt) {
    for (const p of G.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 600 * dt;
      p.life -= dt;
      p.rot += dt * 8;
    }
    G.particles = G.particles.filter((p) => p.life > 0);
    for (const f of G.floaters) {
      f.y -= 60 * dt;
      f.life -= dt;
    }
    G.floaters = G.floaters.filter((f) => f.life > 0);
  }
  function drawEffects() {
    for (const p of G.particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    for (const f of G.floaters) {
      ctx.globalAlpha = clamp(f.life * 2, 0, 1);
      ctx.font = '900 26px "M PLUS Rounded 1c", sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 結果 ----------
  function showResult(clear) {
    G.state = 'done';
    setHud(false);
    const st = G.stage;
    const rec = records[st.id] || (records[st.id] = {});
    let newRecord = false;
    let rows = [];
    let headline = '';
    let sub = '';

    if (G.mode === 'normal') {
      if (clear) {
        const timeBonus = Math.floor(G.timeLeft * 100);
        const hpBonus = G.hp * 1000;
        const total = Math.floor(G.score) + timeBonus + hpBonus;
        rows = [
          ['走行＋アイテム', Math.floor(G.score).toLocaleString()],
          [`残りタイム ${G.timeLeft.toFixed(1)}秒`, '+' + timeBonus.toLocaleString()],
          [`残りHP ${G.hp}`, '+' + hpBonus.toLocaleString()],
          ['合計スコア', total.toLocaleString(), 'total'],
        ];
        if (!rec.bestScore || total > rec.bestScore) {
          rec.bestScore = total;
          newRecord = true;
        }
        rec.cleared = true;
        headline = 'STAGE CLEAR!';
        sub = `${st.goalLabel}に到着！`;
      } else {
        const pct = Math.floor(clamp(G.player.z / st.length, 0, 1) * 100);
        rows = [
          ['進んだ距離', `${pct}%`],
          ['ぶつかった回数', `${G.hits}回`],
          ['スコア', Math.floor(G.score).toLocaleString(), 'total'],
        ];
        headline = G.overReason === 'time' ? 'TIME UP' : 'GAME OVER';
        sub = G.overReason === 'time' ? '時間切れ！特売が終わっちゃった…' : 'ぶつかりすぎて買い物どころじゃない…';
      }
      if (rec.bestScore) rows.push(['ベストスコア', rec.bestScore.toLocaleString()]);
    } else {
      const total = G.elapsed + G.penalty;
      rows = [
        ['走行タイム', formatTime(G.elapsed)],
        [`ペナルティ（${G.hits}回）`, `+${G.penalty}秒`],
      ];
      G.laps.forEach((l, i) => rows.push([`CP${i + 1} 通過`, formatTime(l)]));
      rows.push(['クリアタイム', formatTime(total), 'total']);
      if (!rec.bestTime || total < rec.bestTime) {
        rec.bestTime = total;
        newRecord = true;
      }
      rows.push(['ベストタイム', formatTime(rec.bestTime)]);
      rec.cleared = true;
      headline = 'FINISH!';
      sub = `${st.goalLabel}に到着！`;
    }
    storage.set(REC_KEY, records);

    $('result-head').textContent = headline;
    $('result-head').className = 'result-head ' + (clear ? 'clear' : 'fail');
    $('result-sub').textContent = sub;
    $('result-badge').classList.toggle('hidden', !newRecord);
    $('result-rows').innerHTML = rows
      .map((r) => `<div class="row ${r[2] || ''}"><span>${r[0]}</span><b>${r[1]}</b></div>`)
      .join('');
    const hasNext = clear && G.stageIdx < STAGES.length - 1;
    $('btn-next').classList.toggle('hidden', !hasNext);
    showScreen('result');
  }

  // ---------- メニュー ----------
  let selectedMode = 'normal';
  function renderStageList() {
    const list = $('stage-list');
    $('stage-mode').textContent = selectedMode === 'normal' ? 'チェックポイントモード' : 'タイムアタック';
    list.innerHTML = '';
    STAGES.forEach((st, idx) => {
      const rec = records[st.id] || {};
      const best =
        selectedMode === 'normal'
          ? rec.bestScore
            ? `ベスト ${rec.bestScore.toLocaleString()}点`
            : '記録なし'
          : rec.bestTime
          ? `ベスト ${formatTime(rec.bestTime)}`
          : '記録なし';
      const btn = document.createElement('button');
      btn.className = 'stage-card stage-' + st.id;
      btn.innerHTML = `
        <div class="stage-thumb"><span>STAGE ${st.no}</span></div>
        <div class="stage-info">
          <h3>${st.name}${rec.cleared ? ' <em class="tag">クリア</em>' : ''}</h3>
          <p>${st.desc}</p>
          <p class="best">${best}</p>
        </div>`;
      btn.addEventListener('click', () => {
        sfx.click();
        startStage(idx, selectedMode);
      });
      list.appendChild(btn);
    });
  }

  function pause() {
    if (!['run', 'countdown'].includes(G.state)) return;
    G.prevState = G.state;
    G.state = 'paused';
    showScreen('pause');
  }
  function resume() {
    if (G.state !== 'paused') return;
    G.state = G.prevState;
    showScreen(null);
  }

  function updateSoundButton() {
    $('btn-sound').textContent = audio.muted ? '🔇 サウンド OFF' : '🔊 サウンド ON';
  }

  document.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      audio.unlock();
      sfx.click();
      selectedMode = b.dataset.mode;
      renderStageList();
      showScreen('stage');
    })
  );
  document.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      audio.unlock();
      sfx.click();
      showScreen(b.dataset.go);
    })
  );
  $('btn-sound').addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    audio.unlock();
    sfx.click();
    updateSoundButton();
  });
  $('btn-pause').addEventListener('click', pause);
  $('btn-resume').addEventListener('click', resume);
  $('btn-restart').addEventListener('click', () => startStage(G.stageIdx, G.mode));
  $('btn-quit').addEventListener('click', goMenu);
  $('btn-retry').addEventListener('click', () => startStage(G.stageIdx, G.mode));
  $('btn-next').addEventListener('click', () => startStage(G.stageIdx + 1, G.mode));
  $('btn-stages').addEventListener('click', () => {
    goMenu();
    renderStageList();
    showScreen('stage');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  // ---------- メインループ ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (input.wasPressed('Escape', 'KeyP')) {
      if (G.state === 'paused') resume();
      else pause();
    }
    update(dt);

    ctx.save();
    if (G.shake > 0) ctx.translate((Math.random() - 0.5) * 16 * G.shake, (Math.random() - 0.5) * 16 * G.shake);
    Render.drawWorld(G, G.time);
    ctx.restore();
    drawEffects();
    if (G.state !== 'menu' && G.state !== 'done') updateHud();
    input.endFrame();
    requestAnimationFrame(frame);
  }

  resize();
  updateSoundButton();
  goMenu();
  requestAnimationFrame(frame);
})();
