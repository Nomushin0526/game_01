// カートラッシュ！ ゲーム進行（状態管理・当たり判定・UI）
(function () {
  'use strict';

  const { storage, audio, haptics, Input, isTouchDevice } = window.GameShared;
  const STAGES = window.CartStages;
  const THEMES = window.CartThemes;
  const JUMP = window.CartJump;
  const CONTROL = window.CartControl;
  const MOVE = window.CartMove;
  const SALE = window.CartSale;
  const Render = window.CartRender;
  const { DRAW, CAM_BACK, zoneAt } = Render;
  const MAX_HP = 3;
  const REC_KEY = 'cartRush.records';
  const SET_KEY = 'cartRush.settings';

  // 3D（WebGL）は #game、スピード線やパーティクルなど2Dの重ね描きは #fx に描く
  const canvas = document.getElementById('game');
  Render.init(canvas);
  const fx = document.getElementById('fx');
  const ctx = fx.getContext('2d');
  const input = new Input(fx);
  window.CartRushInput = input; // 開発用
  new ResizeObserver(() => resize()).observe(fx);
  const $ = (id) => document.getElementById(id);

  let records = storage.get(REC_KEY, {});
  // 設定: カメラ視点 / タイムセールの発動方法 / 昼夜
  const settings = Object.assign({ camera: 'normal', saleAuto: false, night: false }, storage.get(SET_KEY, {}));
  Render.setCameraMode(settings.camera);
  let W = 0;
  let H = 0;

  // ---------- 効果音 ----------
  const sfx = {
    hit() {
      audio.noise(0.25, { vol: 0.35, cutoff: 1400 });
      audio.tone(220, 0.25, { type: 'sawtooth', to: 70, vol: 0.18 });
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
    jump(level) {
      audio.tone(260 + level * 120, 0.45, { type: 'sawtooth', to: 1400 + level * 300, vol: 0.12 });
      audio.noise(0.3, { vol: 0.1, cutoff: 3000 });
    },
    land() {
      audio.noise(0.12, { vol: 0.2, cutoff: 600 });
    },
    hop() {
      audio.tone(520, 0.12, { type: 'square', to: 900, vol: 0.08 });
    },
    slide() {
      audio.noise(0.25, { vol: 0.12, cutoff: 900 });
    },
    clean() {
      [1047, 1319, 1568, 2093].forEach((f, i) => audio.tone(f, 0.09, { type: 'square', vol: 0.08, delay: i * 0.045 }));
    },
    smash() {
      audio.noise(0.15, { vol: 0.22, cutoff: 2600 });
      audio.tone(700, 0.1, { type: 'square', to: 300, vol: 0.08 });
    },
    full() {
      [880, 1175, 1568].forEach((f, i) => audio.tone(f, 0.1, { type: 'square', vol: 0.1, delay: i * 0.06 }));
    },
    sale() {
      [523, 784, 1047, 1568].forEach((f, i) => audio.tone(f, 0.18, { type: 'sawtooth', vol: 0.12, delay: i * 0.07 }));
      audio.noise(0.5, { vol: 0.15, cutoff: 4000 });
    },
    nearMiss(combo) {
      audio.tone(1200 + Math.min(combo, 8) * 120, 0.08, { type: 'square', vol: 0.09 });
    },
  };

  // ステージごとのBGM
  const SONGS = {
    market: { bpm: 150, root: 64, prog: [0, 5, 7, 5] },
    home: { bpm: 158, root: 62, prog: [0, -3, 5, 7] },
    rush: { bpm: 168, root: 57, prog: [0, -4, -2, -5], minor: true },
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
  // w: 横の半幅 / len: 奥行き / h: 高さ（ジャンプ中にこれより高く飛んでいれば飛び越えられる）
  const DIMS = {
    shopper: { w: 0.3, len: 0.5, h: 1.6 },
    cart: { w: 0.4, len: 0.9, h: 1.0 },
    display: { w: 0.8, len: 0.9, h: 1.0 },
    boxes: { w: 0.55, len: 0.6, h: 1.1 },
    wetsign: { w: 0.28, len: 0.4, h: 0.85 },
    car: { w: 0.85, len: 3.6, h: 1.35 },
    truck: { w: 1.1, len: 6.2, h: 2.9 },
    bike: { w: 0.3, len: 1.6, h: 1.7 },
    cone: { w: 0.22, len: 0.4, h: 0.75 },
    barrier: { w: 1.0, len: 0.3, h: 1.05 },
    cat: { w: 0.28, len: 0.5, h: 0.6 },
    bus: { w: 1.25, len: 10, h: 3.1 },
    kanban: { w: 0.35, len: 0.45, h: 1.1 }, // 立て看板（はね飛ばせる）
    bar: { w: 1.4, len: 0.3, h: 1.35, y0: 1.0 }, // 工事・駐車場のバー（ジャンプかスライディング）
    noren: { w: 1.4, len: 0.2, h: 2.4, y0: 1.0 }, // のれん・横断幕（スライディングでくぐる）
    banner: { w: 1.5, len: 0.2, h: 2.6, y0: 1.05 }, // 店内の吊り下げ特売幕（スライディングでくぐる）
  };
  // ぶつかってもダメージにならず、はね飛ばしてセールゲージがたまる軽い物
  const LIGHT = new Set(['cone', 'wetsign', 'kanban']);
  const VEHICLES = new Set(['car', 'truck', 'bus']);
  const SHIRTS = ['#5fa4e6', '#7bc66b', '#f3b740', '#b07ad6', '#ec6f6f', '#4fc1b5', '#f28dbb', '#8d6e63'];
  const HAIRS = ['#3b2a20', '#6b4a2f', '#2b2b2b', '#a8a8a8', '#c98d4b'];
  const PANTS = ['#3c4a63', '#5b4636', '#2f3640', '#6d6d7a'];
  const CAR_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#ecf0f1', '#2ecc71', '#9b59b6', '#34495e', '#e67e22'];
  const BUS_COLORS = ['#2f9e6e', '#e8eef2', '#3d6fa8'];

  const G = {
    state: 'menu',
    time: 0,
    stage: STAGES[0],
    player: { x: 0, z: 0, speed: 0, vx: 0, steer: 0, phase: 0 },
    obstacles: [],
    particles: [],
    floaters: [],
  };
  window.CartRushDebug = G; // 開発用

  function addOb(kind, x, z, extra) {
    const d = DIMS[kind];
    // ジャンプ台の上や着地点には置かない
    if (!extra || !extra.vz) {
      for (const r of G.ramps) if (z > r.z0 - 4 && z < r.z1 + 6 && Math.abs(r.x - x) < d.w + r.w + 0.3) return null;
    }
    const o = Object.assign({ kind, x, z, w: d.w, len: d.len, h: d.h, y0: d.y0 || 0, seed: G.rng(), hit: false, wob: 0, kx: 0 }, extra || {});
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

  // 加速ジャンプ台。確率で「空中で次の台に乗れる位置」に2つ目・3つ目を続けて置く
  function makeRamp(x, z) {
    const R0 = JUMP.ramp;
    // z は台の手前の端。z0〜z1 の間で高さ 0 → h まで上がる
    return { kind: 'ramp', x, z: z + R0.len / 2, z0: z, z1: z + R0.len, w: R0.w, len: R0.len, h: R0.h, used: false };
  }
  // 飛び出してから着地するまでの時間
  function airTime(vy) {
    return (vy + Math.sqrt(vy * vy + 2 * JUMP.gravity * JUMP.ramp.h)) / JUMP.gravity;
  }
  // 置き型のジャンプ台。chain: 続けて置く台の数（0〜2、省略時はランダム）
  // 戻り値: 最後の台から飛んで着地するあたりの z（置けなかったら null）
  function addRamp(x, z, th, chain) {
    if (z < 40 || z > G.stage.length - 40) return null;
    // 後ろから走ってくる車が止まりきれない距離（約90m）まで見て、車がいれば置かない
    if (laneBlocked(x, z - 90, z + JUMP.ramp.len + 15, null)) return null;
    G.ramps.push(makeRamp(x, z));
    let cx = x;
    let cz = z + JUMP.ramp.len;
    const n = chain === undefined ? (G.rng() < 0.55 ? 1 + (G.rng() < 0.3 ? 1 : 0) : 0) : chain;
    let lv = 0;
    for (; lv < n; lv++) {
      // 飛び出し地点から「その段階の速度 × 滞空時間」先が着地点。
      // 降りてきたところで坂の中ほどに乗れるよう、着地点の少し手前に台の始まりを置く
      const air = airTime(JUMP.launchVy + JUMP.chainVy * lv);
      const next = cz + th.maxSpeed * JUMP.levels[lv] * 0.97 * air - JUMP.ramp.len * 0.65;
      let nx = clamp(cx + (G.rng() < 0.5 ? -1 : 1) * (0.8 + G.rng() * 1.2), -th.limit + 0.5, th.limit - 0.5);
      const zt = THEMES[zoneAt(G.stage, next).type];
      if (zt.lanes) nx = laneOf(nx, zt.lanes); // 車線のある道では車線の真ん中に置く
      if (next > G.stage.length - 40 || laneBlocked(nx, next - 90, next + JUMP.ramp.len + 15, null)) break;
      cx = nx;
      cz = next;
      G.ramps.push(makeRamp(cx, cz));
      cz += JUMP.ramp.len;
    }
    const air = airTime(JUMP.launchVy + JUMP.chainVy * lv);
    return cz + th.maxSpeed * JUMP.levels[Math.min(lv, JUMP.levels.length - 1)] * air;
  }

  // 車・トラック。ステージ設定によっては、プレイヤーが近づいたところで隣の車線へ移る
  //   blinker: true なら移る前にウィンカーを出す（ステージ2）、false なら合図なしで急に動く（ステージ3）
  function updateLaneChange(o, P, dt) {
    const c = o.change;
    if (o.lcState === 'wait') {
      if (o.z - P.z < c.dist && laneBlocked(c.to, o.z - o.len - 12, o.z + o.len / 2 + 45, o)) {
        o.lcState = 'done'; // 移る先に車やジャンプ台があるならやめる
      } else if (o.z - P.z < c.dist) {
        o.lcState = c.signal > 0 ? 'signal' : 'move';
        o.lcTimer = c.signal;
        o.lcFrom = o.x;
        o.blinkDir = c.blinker ? Math.sign(c.to - o.x) : 0;
      }
    } else if (o.lcState === 'signal') {
      o.lcTimer -= dt;
      if (o.lcTimer <= 0) {
        o.lcState = 'move';
        o.lcTimer = 0;
      }
    } else if (o.lcState === 'move') {
      o.lcTimer += dt;
      const k = clamp(o.lcTimer / c.moveTime, 0, 1);
      const e = k * k * (3 - 2 * k); // なめらかに
      o.x = o.lcFrom + (c.to - o.lcFrom) * e;
      if (k >= 1) {
        o.lcState = 'done';
        o.blinkDir = 0;
        o.avoiding = false;
      }
    }
  }

  function addVehicle(kind, laneX, z, th, vz) {
    const rng = G.rng;
    const lc = G.stage.laneChange;
    let change = null;
    if (lc && th.lanes && rng() < lc.chance) {
      const idx = th.lanes.indexOf(laneX);
      const opts = [idx - 1, idx + 1].filter((i) => i >= 0 && i < th.lanes.length);
      const to = th.lanes[opts[Math.floor(rng() * opts.length)]];
      // プレイヤーとの距離がこの値まで縮まったら動き出す
      change = { to, dist: 75 + rng() * 90, blinker: lc.blinker, signal: lc.blinker ? 1.0 : 0, moveTime: lc.blinker ? 0.9 : 0.7 };
    }
    const jitter = change ? 0 : (rng() - 0.5) * 0.4;
    const color = kind === 'bus' ? BUS_COLORS[Math.floor(rng() * BUS_COLORS.length)] : CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];
    const o = addOb(kind, laneX + jitter, z, { color, vz, change, lcState: change ? 'wait' : null });
    // トラック・バスの後ろにジャンプ台（屋根まで駆け上がって大ジャンプ）
    if (o && (kind === 'truck' || kind === 'bus') && rng() < 0.45) {
      const TR = JUMP.truckRamp;
      G.ramps.push({ kind: 'ramp', attach: o, x: o.x, w: TR.w, len: TR.len, h: o.h, z0: 0, z1: 0, z: 0, used: false });
      syncAttachedRamp(G.ramps[G.ramps.length - 1]);
    }
    return o;
  }
  // ---------- 車どうし・ジャンプ台と重ならないように ----------
  // 前にジャンプ台や遅い車があったら、隣の車線へよける（ステージ2はウィンカーを出してから、3は急に）。
  // よけられないときは、前の物の後ろについて速度を合わせる。
  const laneOf = (x, lanes) => lanes.reduce((b, l) => (Math.abs(l - x) < Math.abs(b - x) ? l : b), lanes[0]);
  function rearOf(b) {
    // 後ろ側の端（車ならその後ろに付いたジャンプ台も含める）
    if (b.kind === 'ramp') return b.z0;
    const att = G.ramps.find((r) => r.attach === b);
    return att ? att.z0 : b.z - b.len / 2;
  }
  function laneBlocked(x, zFrom, zTo, self) {
    for (const b of G.obstacles) {
      if (b === self || b.flying || !VEHICLES.has(b.kind)) continue;
      if (Math.abs(b.x - x) < 1.6 && b.z + b.len / 2 > zFrom && rearOf(b) < zTo) return true;
    }
    for (const r of G.ramps) {
      if (r.attach) continue;
      if (Math.abs(r.x - x) < r.w + 1.0 && r.z1 > zFrom && r.z0 < zTo) return true;
    }
    return false;
  }
  function avoidTraffic(o, dt) {
    const front = o.z + o.len / 2;
    const changing = o.lcState === 'signal' || o.lcState === 'move';
    let blocker = null;
    let gap = Infinity;
    for (const b of G.obstacles) {
      if (b === o || b.flying || !VEHICLES.has(b.kind) || Math.abs(b.x - o.x) > 1.6) continue;
      if (b.z < o.z) continue;
      const g = rearOf(b) - front;
      // 前の車が同じか速くても、すぐ前にいる間は「前の物」として扱う（追いついて重ならないように）
      if (b.vz >= o.vz && g > 15) continue;
      if (g > -o.len && g < gap) {
        gap = g;
        blocker = b;
      }
    }
    for (const r of G.ramps) {
      if (r.attach || Math.abs(r.x - o.x) > r.w + 1.0) continue;
      const g = r.z0 - front;
      if (g > -r.len && g < gap) {
        gap = g;
        blocker = r;
      }
    }
    if (!blocker) {
      if (o.followVz !== undefined && o.vz < o.baseVz) o.vz = Math.min(o.baseVz, o.vz + 15 * dt);
      return;
    }
    if (changing) {
      // 車線変更中でも、前が近ければブレーキ
      if (gap < 15) {
        if (o.baseVz === undefined) o.baseVz = o.vz;
        o.followVz = true;
        o.vz = Math.max(blocker.vz || 0, o.vz - 120 * dt);
      }
      return;
    }
    const lookAhead = 6 + (o.vz - (blocker.vz || 0)) * 1.4;
    if (gap > lookAhead) return;
    const th = THEMES[zoneAt(G.stage, o.z).type];
    if (th.lanes && !o.avoiding) {
      const cur = th.lanes.indexOf(laneOf(o.x, th.lanes));
      const opts = [cur - 1, cur + 1].filter((i) => i >= 0 && i < th.lanes.length).sort(() => G.rng() - 0.5);
      for (const i of opts) {
        const to = th.lanes[i];
        if (!laneBlocked(to, o.z - o.len - 12, front + 20 + o.vz * 1.0, o)) {
          const blink = !G.stage.laneChange || G.stage.laneChange.blinker;
          o.change = { to, dist: Infinity, blinker: blink, signal: blink ? 0.6 : 0, moveTime: blink ? 0.8 : 0.6 };
          o.lcState = blink ? 'signal' : 'move';
          o.lcTimer = o.change.signal;
          o.lcFrom = o.x;
          o.blinkDir = blink ? Math.sign(to - o.x) : 0;
          o.avoiding = true;
          return;
        }
      }
    }
    // よけられない: 前の物の速さに合わせて後ろにつく（ジャンプ台なら手前で止まる）
    if (o.baseVz === undefined) o.baseVz = o.vz;
    o.followVz = true;
    const target = blocker.vz || 0;
    o.vz = Math.max(target, o.vz - 40 * dt);
    if (gap < 3) o.vz = Math.min(o.vz, target); // 少し手前で止まる（重ならない）
  }

  function syncAttachedRamp(r) {
    const a = r.attach;
    r.prevZ0 = r.z0;
    r.x = a.x;
    r.z1 = a.z - a.len / 2;
    r.z0 = r.z1 - r.len;
    r.z = (r.z0 + r.z1) / 2;
  }

  // ---------- 障害物の配置（場面の流れで組み立てる） ----------
  // 1種類ずつランダムに並べるのではなく、「ラッシュ」「ジャンプ台ゾーン」「ぶっ飛ばしゾーン」「関門」「休憩」を
  // 交互に出して、詰まる → 抜ける → 飛ぶ の緩急をつくる。距離は「最高速で何秒か」で決める。
  const PATTERNS = {
    wave: { w: 3, label: 'ラッシュ' },
    ramps: { w: 5, label: 'ジャンプ台ゾーン' },
    smash: { w: 2, label: 'ぶっ飛ばしゾーン' },
    gate: { w: 2, label: '関門' },
    rest: { w: 1.2, label: '休憩' },
  };
  function zoneLanes(zone, th) {
    if (th.lanes) return th.lanes;
    if (zone.type === 'market') return [-2.2, -1.1, 0, 1.1, 2.2];
    return [-2.0, -1.0, 0, 1.0, 2.0];
  }
  function nextPattern() {
    const rng = G.rng;
    const table = {};
    for (const k in PATTERNS) if (k !== G.lastPattern) table[k] = PATTERNS[k].w;
    const type = G.lastPattern ? pickWeighted(rng, table) : 'rest';
    G.lastPattern = type;
    const lv = G.stage.level;
    const rows = { wave: 5 + Math.floor(rng() * 3) + lv, ramps: 1, smash: 4 + Math.floor(rng() * 3), gate: 1 + (rng() < 0.4 ? 1 : 0), rest: 2 }[type];
    G.pat = { type, rows, free: null };
  }

  // 1つの障害物を置く（場所の種類ごとに中身を選ぶ）
  function placeBlocker(zone, th, x, z, diff) {
    const rng = G.rng;
    if (zone.type === 'market') {
      const kind = pickWeighted(rng, { shopper: 36, cart: 18, display: 16, boxes: 18 });
      if (kind === 'shopper') {
        const moving = rng() < 0.15 + diff * 0.25;
        return addOb('shopper', x, z, Object.assign(person(rng), { basket: rng() < 0.6, vx: moving ? (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.7) : 0, bounce: 2.5 }));
      }
      return addOb(kind, clamp(x, -2.0, 2.0), z);
    }
    if (zone.type === 'shotengai') {
      const kind = pickWeighted(rng, { shopper: 34, bike: 20, boxes: 16, cart: 10, cat: 6 });
      if (kind === 'shopper') {
        const moving = rng() < 0.2 + diff * 0.3;
        return addOb('shopper', x, z, Object.assign(person(rng), { basket: rng() < 0.5, vx: moving ? (rng() < 0.5 ? -1 : 1) * (0.7 + rng() * 0.8) : 0, bounce: 2.4 }));
      }
      if (kind === 'bike') return addOb('bike', x, z, Object.assign(person(rng), { vz: 6 + rng() * 5 }));
      if (kind === 'cat') {
        const from = rng() < 0.5 ? -1 : 1;
        return addOb('cat', from * (th.roadW + 0.5), z, { vx: -from * (2.4 + rng() * 0.8), trigger: 120, active: false });
      }
      return addOb(kind, clamp(x, -2.0, 2.0), z);
    }
    const fast = zone.type === 'expressway';
    const kind = pickWeighted(rng, fast ? { car: 55, truck: 28, bus: 9, barrier: 8 } : { car: 48, bus: 16, truck: 16, barrier: 20 });
    if (kind === 'car') return addVehicle('car', x, z, th, fast ? 60 + rng() * 20 : 45 + rng() * 20);
    if (kind === 'truck') return addVehicle('truck', x, z, th, fast ? 55 + rng() * 10 : 40 + rng() * 15);
    if (kind === 'bus') return addVehicle('bus', x, z, th, fast ? 50 + rng() * 10 : 35 + rng() * 10);
    return addOb('barrier', x, z);
  }
  // はね飛ばせる軽い物
  function placeLight(zone, x, z) {
    const kind = zone.type === 'market' ? 'wetsign' : zone.type === 'shotengai' ? 'kanban' : G.rng() < 0.7 ? 'cone' : 'kanban';
    return addOb(kind, x, z);
  }
  // 道幅いっぱいの関門（ジャンプかスライディングで越える）
  function placeGate(zone, th, z) {
    if (zone.type === 'market') {
      for (const x of [-1.55, 1.55]) addOb('banner', x, z);
    } else if (zone.type === 'shotengai') {
      for (const x of [-1.5, 1.5]) addOb('noren', x, z);
    } else {
      for (const x of th.lanes) addOb('bar', x, z);
    }
  }

  // パターンを1行ぶん進めて、次の行までの距離を返す
  function spawnRow(z) {
    const rng = G.rng;
    const zone = zoneAt(G.stage, z);
    const th = THEMES[zone.type];
    const diff = clamp(z / G.stage.length, 0, 1);
    const lv = G.stage.level;
    const sp = th.maxSpeed;
    const lanes = zoneLanes(zone, th);
    if (!G.pat || G.pat.rows <= 0) nextPattern();
    const pat = G.pat;
    pat.rows--;
    // 空ける車線: 前の行から1つずつずらす（スラローム）
    const moveFree = () => {
      if (pat.free === null || pat.free >= lanes.length) pat.free = Math.floor(rng() * lanes.length);
      else pat.free = clamp(pat.free + (rng() < 0.5 ? -1 : 1), 0, lanes.length - 1);
      return pat.free;
    };

    if (pat.type === 'wave') {
      const free = moveFree();
      // ふさぐ数: 5車線の場所は2〜3、3車線の道は1〜2（後半・高いステージほど多い）
      const many = lanes.length >= 5 ? 2 + (rng() < 0.25 + diff * 0.3 + lv * 0.1 ? 1 : 0) : 1 + (rng() < 0.35 + diff * 0.3 + lv * 0.08 ? 1 : 0);
      const others = shuffle(rng, lanes.map((_, i) => i).filter((i) => i !== free)).slice(0, many);
      for (const i of others) {
        if (rng() < 0.25) placeLight(zone, lanes[i], z);
        else placeBlocker(zone, th, lanes[i] + (th.lanes ? 0 : (rng() - 0.5) * 0.3), z + rng() * 1.5, diff);
      }
      // ラッシュの最後に、抜けた先の車線へジャンプ台
      if (pat.rows === 0 && rng() < 0.85) {
        const end = addRamp(lanes[free], z + sp * 0.35, th, rng() < 0.5 ? 1 : 0);
        if (end) return end - z + sp * 0.25;
      }
      return sp * (lerp(0.62, 0.46, diff) - lv * 0.02 + rng() * 0.08);
    }

    if (pat.type === 'ramps') {
      // ジャンプ台の連続（2〜3段）。飛んでいる下には軽い物や車を置いて、飛び越える気持ちよさを出す
      const free = moveFree();
      const chain = rng() < 0.35 + diff * 0.3 ? 2 : 1;
      const end = addRamp(lanes[free], z, th, chain);
      if (!end) return sp * 0.5;
      for (let zz = z + 25; zz < end - 10; zz += sp * 0.22) {
        const i = Math.floor(rng() * lanes.length);
        if (rng() < 0.5) placeLight(zone, lanes[i], zz);
        else if (th.lanes && rng() < 0.5) placeBlocker(zone, th, lanes[i], zz, diff);
      }
      return end - z + sp * 0.3;
    }

    if (pat.type === 'smash') {
      // はね飛ばし放題（ゲージがたまる）。たまに大物を混ぜる
      const free = moveFree();
      for (let i = 0; i < lanes.length; i++) {
        if (i === free && rng() < 0.5) continue;
        if (rng() < 0.75) placeLight(zone, lanes[i] + (rng() - 0.5) * 0.4, z + rng() * 3);
      }
      if (rng() < 0.25 + diff * 0.2) placeBlocker(zone, th, lanes[(free + 2) % lanes.length], z + 6, diff);
      // ぶっ飛ばしの締めにジャンプ台
      if (pat.rows === 0 && rng() < 0.6) {
        const end = addRamp(lanes[free], z + sp * 0.3, th, rng() < 0.4 ? 1 : 0);
        if (end) return end - z + sp * 0.2;
      }
      return sp * (0.32 + rng() * 0.06);
    }

    if (pat.type === 'gate') {
      placeGate(zone, th, z);
      // 関門の前後に1つずつ障害物
      const i = Math.floor(rng() * lanes.length);
      placeBlocker(zone, th, lanes[i], z + sp * 0.3, diff);
      return sp * 0.65;
    }

    // rest: ひと息（軽い物をぽつぽつ。最後はジャンプ台で次の場面へ）
    placeLight(zone, lanes[Math.floor(rng() * lanes.length)], z);
    if (pat.rows === 0) {
      const end = addRamp(lanes[Math.floor(rng() * lanes.length)], z + sp * 0.5, th, 0);
      if (end) return end - z;
    }
    return sp * (0.8 + rng() * 0.2);
  }

  function spawnAhead() {
    const st = G.stage;
    while (G.nextSpawn < G.player.z + DRAW && G.nextSpawn < st.length - 18) {
      const z = G.nextSpawn;
      const nearCp = st.checkpoints.some((c) => Math.abs(z - c) < 9);
      G.nextSpawn += nearCp ? 10 : Math.max(8, spawnRow(z));
    }
  }

  // ---------- 画面とHUD ----------
  const SCREENS = ['title', 'stage', 'howto', 'pause', 'result', 'settings', 'share'];
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
    bannerTimer = setTimeout(() => b.classList.remove('show'), cls === 'count' ? 800 : cls === 'cp' ? 1000 : 1500);
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
    $('timer-label').textContent = normal ? 'のこり時間' : 'タイム';
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
    if (G.mode === 'normal') {
      setText('timer', G.timeLeft.toFixed(1));
      $('timer').classList.toggle('warn', G.timeLeft <= 10 && G.state === 'run');
    } else {
      setText('timer', formatTime(G.elapsed + G.penalty));
    }
    $('app').classList.toggle('boosting', G.boost > 0);
    // セールゲージと発動ボタン
    $('gauge-fill').style.width = G.gauge + '%';
    $('gauge').classList.toggle('full', G.gauge >= 100 && G.sale <= 0);
    $('gauge').classList.toggle('active', G.sale > 0);
    $('btn-sale').classList.toggle('hidden', !(G.gauge >= 100 && G.sale <= 0 && G.state === 'run') || settings.saleAuto);
    $('app').classList.toggle('sale', G.sale > 0);
  }

  // ---------- 進行 ----------
  function resize() {
    W = fx.clientWidth;
    H = fx.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fx.width = Math.round(W * dpr);
    fx.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Render.setView(W, H);
  }
  window.addEventListener('resize', resize);

  function resetPlayer() {
    G.player = { x: 0, tx: 0, z: 0, prevZ: 0, y: 0, vy: 0, speed: 0, vx: 0, steer: 0, phase: 0, onRamp: null, onObj: null, trick: null, tumble: null, rampFromAir: false, slide: 0, jumpBuf: 0, slideBuf: 0 };
    G.camX = 0;
  }

  function goMenu() {
    audio.stopMusic();
    G.runId = (G.runId || 0) + 1;
    G.state = 'menu';
    G.stage = STAGES[0];
    G.obstacles = [];
    G.ramps = [];
    G.boost = 0;
    G.boostLevel = 0;
    G.gauge = 0;
    G.sale = 0;
    G.slow = 0;
    G.night = false;
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
      runId: (G.runId || 0) + 1,
      state: 'countdown',
      mode,
      stageIdx: idx,
      stage: st,
      obstacles: [],
      ramps: [],
      particles: [],
      floaters: [],
      nextSpawn: 60,
      boost: 0,
      pat: null,
      lastPattern: null,
      jumps: 0,
      maxChain: 0,
      boostLevel: 0,
      combo: 0,
      comboTimer: 0,
      nearMisses: 0,
      gauge: 0,
      gaugeFull: false,
      punch: 0,
      dip: 0,
      cleanLandings: 0,
      maxCombo: 0,
      lastCause: null,
      sale: 0,
      sales: 0,
      smashed: 0,
      slow: 0,
      night: !!settings.night,
      timeLeft: 0,
      elapsed: 0,
      penalty: 0,
      hp: MAX_HP,
      score: 0,
      hits: 0,
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
    G.sections = sectionTimes(st);
    G.timeLeft = G.sections[0];
    buildHud();
    showScreen(null);
    setHud(true);
    showZone(`STAGE ${st.no}  ${st.name}`);
    $('drag-hint').classList.remove('hidden');
    $('drag-hint-sub').classList.toggle('hidden', isTouchDevice());
  }

  // 各区間の持ち時間 = ミスなし・ジャンプ台なしで走ったときの区間タイム + slack（0.5秒単位に切り上げ）
  function sectionTimes(st) {
    const marks = st.checkpoints.concat([st.length]);
    const arrive = [];
    let v = 0;
    let z = 0;
    let t = 0;
    const dt = 1 / 120;
    while (arrive.length < marks.length) {
      const th = THEMES[zoneAt(st, z).type];
      if (v < th.maxSpeed) v = Math.min(th.maxSpeed, v + th.accel * dt);
      else v = Math.max(th.maxSpeed, v - 14 * dt);
      z += v * dt;
      t += dt;
      while (arrive.length < marks.length && z >= marks[arrive.length]) arrive.push(t);
    }
    return arrive.map((a, i) => Math.ceil((a - (i ? arrive[i - 1] : 0) + st.slack) * 2) / 2);
  }

  function timePop(text) {
    const el = $('time-pop');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  const CAUSE = {
    shopper: '買い物客', cart: '放置カート', display: '特売ワゴン', boxes: 'みかんの段ボール', car: '乗用車', truck: 'トラック',
    bus: '路線バス', bike: '自転車', barrier: '通行止め', bar: '工事のバー', noren: 'のれん', banner: '特売の幕', cat: '飛び出したネコ',
  };
  function onHit(o) {
    const P = G.player;
    G.lastCause = CAUSE[o.kind] || '障害物';
    o.hit = true;
    o.kx = (o.x >= P.x ? 1 : -1) * (o.vz ? 0 : 2.5);
    G.hits++;
    G.invuln = 1.6;
    G.shake = 0.35;
    P.speed *= 0.1;
    P.trick = null;
    P.onRamp = null;
    P.onObj = null;
    P.slide = 0;
    P.tumble = { t: 0, dur: 0.7 };
    G.slow = 0.45; // 一瞬スローになる
    G.boost = 0;
    G.boostLevel = 0;
    G.combo = 0;
    sfx.hit();
    haptics.vibrate(120);
    flash();
    burst(['#ffd166', '#ffffff', '#ff6b6b'], 14);
    if (G.mode === 'normal') {
      G.hp--;
      renderHearts();
      G.timeLeft = Math.max(0, G.timeLeft - G.stage.hitPenalty);
      timePop(`-${G.stage.hitPenalty}秒`);
      if (G.hp <= 0) gameOver('hp');
    } else {
      G.penalty += G.stage.taPenalty;
      timePop(`+${G.stage.taPenalty}秒`);
    }
  }

  const TRICKS = ['flip', 'roll', 'spin'];
  // 坂を登りきって飛び出す。空中から坂に降りて乗った場合は連続ジャンプとして一段上の加速
  function launch(r, th) {
    const P = G.player;
    const chained = !!P.rampFromAir;
    G.chain = chained ? (G.chain || 0) + 1 : 1;
    G.boostLevel = Math.min(JUMP.levels.length, chained ? G.boostLevel + 1 : Math.max(1, G.boostLevel));
    G.boost = JUMP.duration;
    G.jumps++;
    G.maxChain = Math.max(G.maxChain, G.chain);
    G.score += 50 * G.chain;
    P.onRamp = null;
    r.launched = true;
    P.y = r.h;
    P.vy = JUMP.launchVy + JUMP.chainVy * (G.chain - 1);
    P.speed = Math.max(P.speed, th.maxSpeed * JUMP.levels[G.boostLevel - 1] * 0.9);
    // 空中の回転技。連続ジャンプほど派手に（2連続でひねり、3連続で2回転）
    const type = G.chain === 1 ? TRICKS[Math.floor(Math.random() * TRICKS.length)] : G.chain === 2 ? 'cork' : 'flip';
    P.trick = { type, t: 0, dur: airTime(P.vy) * 0.92, turns: G.chain >= 3 ? 2 : 1, dir: Math.random() < 0.5 ? -1 : 1 };
    sfx.jump(G.chain);
    G.punch = Math.max(G.punch || 0, 1.2 + G.chain * 0.3);
    clearLanding(airTime(P.vy) + (r.h - JUMP.ramp.h) / 10);
    addGauge(r.attach ? SALE.gain.truckRamp : SALE.gain.ramp);
    haptics.vibrate(chained ? [20, 30, 40] : 35);
  }

  // ジャンプ台の上にいるか・乗ったか・飛び出したかを判定する
  function updateRamps(th, prevY) {
    const P = G.player;
    const zc = P.z + 0.6; // カートの中心
    if (P.onRamp) {
      const r = P.onRamp;
      if (Math.abs(P.x - r.x) > r.w || zc < r.z0) {
        P.onRamp = null; // 横から落ちた / 動く台に追い越された
        P.y = Math.max(0, P.y);
      } else if (zc >= r.z1) {
        launch(r, th);
      } else {
        P.y = (r.h * (zc - r.z0)) / r.len;
        P.vy = 0;
      }
      return;
    }
    for (const r of G.ramps) {
      if (r.used || Math.abs(P.x - r.x) > r.w - 0.05 || zc < r.z0 || zc >= r.z1) continue;
      const surf = (r.h * (zc - r.z0)) / r.len;
      // 坂の表面に触れたときだけ乗る（高く飛んでいる最中に真上を通過しても反応しない）
      //   高速だと1フレームで坂の途中まで進むので、「前のフレームで坂のふもとより手前にいた」なら地面から乗ったとみなす
      const prevZc = P.prevZ + 0.6;
      const footEntry = P.y <= 0.05 && prevZc <= (r.prevZ0 !== undefined ? r.prevZ0 : r.z0) + 1.5;
      if (P.y <= surf + 0.08 && (prevY >= surf - 0.5 || footEntry)) {
        P.rampFromAir = prevY > 0.05;
        P.onRamp = r;
        P.trick = null;
        r.used = true;
        P.y = surf;
        P.vy = 0;
        if (P.rampFromAir) {
          sfx.land();
          haptics.vibrate(15);
        }
        return;
      }
    }
  }

  // 着地。imp = 落ちてきた速さ（強く着地するほどカメラが沈み、体がつぶれる）
  function landed(imp) {
    const P = G.player;
    const chain = G.chain || 0;
    G.chain = 0;
    imp = imp || 0;
    if (imp > 2.5) {
      G.dip = Math.min(1.6, (G.dip || 0) + imp * 0.07);
      P.squash = Math.min(1, imp / 14);
      G.shake = Math.max(G.shake, Math.min(0.35, imp * 0.02));
    }
    sfx.land();
    haptics.vibrate(25);
    if (P.trick) {
      // 8割以上回っていれば「着地成功」: スピードとコンボで点数が伸びる
      const done = P.trick.t >= P.trick.dur * 0.8;
      if (done) {
        bumpCombo();
        const pts = Math.round(600 * ((P.speed * 3.6) / 100) * (1 + 0.25 * (Math.min(G.combo, 13) - 1)) * Math.max(1, chain) * (P.trick.turns || 1));
        G.score += pts;
        G.cleanLandings = (G.cleanLandings || 0) + 1;
        addGauge(SALE.gain.trick * Math.max(1, chain) * (P.trick.turns || 1));
        burst(['#ffffff', '#ffd166', '#2ec4b6'], 16);
        sfx.clean();
        G.punch = Math.max(G.punch || 0, 0.8);
      } else {
        // 回りきれずに着地: よろけて減速
        P.speed *= 0.6;
        P.stumble = 0.6;
        G.shake = Math.max(G.shake, 0.3);
        G.combo = 0;
      }
      P.trick = null;
    }
  }
  // 技・ギリギリ回避・はね飛ばしをつなぐコンボ（3.2秒以内に次をつなぐ）
  function bumpCombo() {
    G.combo = G.comboTimer > 0 ? G.combo + 1 : 1;
    G.comboTimer = 3.2;
    G.maxCombo = Math.max(G.maxCombo || 0, G.combo);
  }

  // 飛んだ先（着地点）をふさいでいる車や障害物を、隣の車線へどかす（理不尽なミスにしない）
  function clearLanding(air) {
    const P = G.player;
    const zL = P.z + 0.6 + P.speed * air;
    const za = zL - Math.max(24, P.speed * 0.45);
    const zb = zL + Math.max(10, P.speed * 0.5); // 着地してから0.5秒ぶんは空けておく（よける間がないため）
    const th = THEMES[zoneAt(G.stage, zL).type];
    const lanes = th.lanes || zoneLanes(zoneAt(G.stage, zL), th);
    for (const o of G.obstacles) {
      if (o.flying || o.hit || LIGHT.has(o.kind)) continue;
      const z = o.z + (o.vz || 0) * air;
      if (Math.abs(o.x - P.x) > o.w + 1.1 || z + o.len / 2 < za || z - o.len / 2 > zb) continue;
      if (G.ramps.some((r) => r.attach === o)) continue;
      const to = lanes.slice().sort((a, b) => Math.abs(b - P.x) - Math.abs(a - P.x)).find((lx) => Math.abs(lx - P.x) > o.w + 1.2 && !laneBlocked(lx, z - 20, z + 20, o));
      if (to === undefined) continue;
      if (VEHICLES.has(o.kind)) {
        o.change = { to, dist: Infinity, blinker: false, signal: 0, moveTime: Math.min(0.8, air * 0.6) };
        o.lcState = 'move';
        o.lcTimer = 0;
        o.lcFrom = o.x;
        o.avoiding = true;
      } else o.x = to;
    }
  }

  // ---------- セールゲージ / タイムセール ----------
  function addGauge(n) {
    if (G.sale > 0 || G.state !== 'run') return;
    G.gauge = Math.min(100, G.gauge + n);
    if (G.gauge >= 100 && !G.gaugeFull) {
      G.gaugeFull = true;
      sfx.full();
      haptics.vibrate([20, 40, 20]);
      if (settings.saleAuto) activateSale();
    }
  }
  function activateSale() {
    if (G.state !== 'run' || G.gauge < 100 || G.sale > 0) return;
    G.sale = SALE.duration;
    G.sales++;
    G.gaugeFull = false;
    G.player.speed = Math.max(G.player.speed, THEMES[zoneAt(G.stage, G.player.z).type].maxSpeed * 1.2);
    sfx.sale();
    G.punch = 2.2;
    haptics.vibrate([30, 30, 60]);
    burst(['#ffd166', '#ff8c1a', '#ffffff', '#ef476f'], 30);
  }

  // 物をはね飛ばす（軽い物、またはタイムセール中は何でも）
  function smash(o) {
    const P = G.player;
    o.hit = true;
    o.flying = true;
    o.vz = 0;
    o.change = null;
    o.blinkDir = 0;
    const side = o.x >= P.x ? 1 : -1;
    const heavy = VEHICLES.has(o.kind);
    o.fvx = side * (3 + Math.random() * 5);
    o.fvy = (heavy ? 7 : 9) + Math.random() * 6;
    o.fvz = P.speed * (heavy ? 0.5 : 0.75);
    o.fy = 0;
    o.flyT = 0;
    o.rx = 0;
    o.ry = 0;
    o.rz = 0;
    o.srx = (Math.random() - 0.5) * 14;
    o.sry = (Math.random() - 0.5) * 10;
    o.srz = side * (4 + Math.random() * 8);
    G.smashed++;
    bumpCombo();
    G.score += Math.round((heavy ? 150 : 40) * (1 + 0.1 * Math.min(G.combo, 10)));
    sfx.smash();
    haptics.vibrate(heavy ? 40 : 12);
    G.shake = Math.max(G.shake, heavy ? 0.25 : 0.1);
  }

  function grounded() {
    const P = G.player;
    return (P.y <= 0.001 && !P.onRamp) || !!P.onObj || !!P.onRamp;
  }
  function doJump() {
    const P = G.player;
    P.vy = MOVE.hopVy;
    P.y = Math.max(P.y, 0.001);
    P.onObj = null;
    P.onRamp = null;
    P.slide = 0;
    P.jumpBuf = 0;
    sfx.hop();
    addGauge(SALE.gain.hop);
  }
  function doSlide() {
    const P = G.player;
    P.slide = MOVE.slideTime;
    P.slideBuf = 0;
    sfx.slide();
  }
  // 車の屋根に乗っている間、まだ屋根の上にいるか
  function onRoof(o) {
    const P = G.player;
    const zc = P.z + 0.6;
    return !o.flying && zc <= o.z + o.len / 2 + 0.3 && zc >= o.z - o.len / 2 - 0.5 && Math.abs(o.x - P.x) < o.w + 0.3;
  }

  function nearMiss() {
    bumpCombo();
    G.nearMisses++;
    const pts = 50 * G.combo;
    G.score += pts;
    sfx.nearMiss(G.combo);
    addGauge(SALE.gain.nearMiss);
    haptics.vibrate(15);
  }

  function passCheckpoint() {
    const i = G.cpIndex++;
    sfx.checkpoint();
    haptics.vibrate([30, 40, 30]);
    G.score += 500;
    burst(['#ff8c42', '#ffd166', '#2ec4b6', '#ffffff'], 26);
    if (G.mode === 'normal') {
      const bonus = G.sections[i + 1];
      G.timeLeft += bonus;
      G.warnSec = 99;
      let sub = `+${bonus}秒`;
      if (G.hp < MAX_HP) {
        G.hp++;
        renderHearts();
        sub += ' ♥+1';
      }
      banner(G.stage.cpNames[i] || 'CHECKPOINT', 'cp', sub);
    } else {
      const lap = G.elapsed + G.penalty;
      G.laps.push(lap);
      banner(G.stage.cpNames[i] || 'CHECKPOINT', 'cp', formatTime(lap));
    }
  }

  function reachGoal() {
    G.state = 'goal';
    G.endTimer = 2.4;
    G.player.onRamp = null;
    G.boost = 0;
    audio.stopMusic();
    sfx.goal();
    Render.requestSnapshot();
    haptics.vibrate([40, 60, 40, 60, 80]);
    burst(['#ff8c42', '#ffd166', '#2ec4b6', '#ef476f', '#ffffff'], 50);
    banner('GOAL!', 'goal', G.stage.goalLabel + 'に到着！');
  }

  function gameOver(reason) {
    G.state = 'over';
    G.overReason = reason;
    G.endTimer = 1.8;
    G.player.onRamp = null;
    G.boost = 0;
    audio.stopMusic();
    sfx.over();
    Render.requestSnapshot();
    haptics.vibrate(300);
    banner(reason === 'time' ? 'TIME UP' : 'GAME OVER', 'over');
  }

  function update(dt) {
    G.time += dt;
    const P = G.player;
    if (G.state === 'paused' || G.state === 'done') return;

    if (G.state === 'menu') {
      P.speed = 20;
      P.x = Math.sin(G.time * 0.5) * 1.4;
      P.steer = Math.cos(G.time * 0.5) * 0.4;
      P.z += P.speed * dt;
      P.phase += P.speed * dt * 1.3;
      if (P.z > 3000) P.z = 0;
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
        // スタートダッシュ: GO の瞬間に一気に加速
        G.player.speed = THEMES[zoneAt(G.stage, 0).type].maxSpeed * 0.6;
        G.punch = 1.6;
        audio.playMusic(SONGS[G.stage.id] || SONGS.market);
        $('drag-hint').classList.add('hidden');
        banner('GO!', 'go');
        sfx.go();
      }
    }

    const zone = zoneAt(G.stage, P.z);
    const th = THEMES[zone.type];
    if (zone !== G.zone) {
      G.zone = zone;
    }

    const dragPx = input.consumeDragX();
    const swipes = input.consumeSwipes();
    if (G.state === 'run') {
      // 上スワイプ（↑ / スペース）でジャンプ、下スワイプ（↓）でスライディング。空中で下なら急降下
      if (swipes.includes('up') || input.wasPressed('ArrowUp', 'KeyW', 'Space')) P.jumpBuf = 0.15;
      if (swipes.includes('down') || input.wasPressed('ArrowDown', 'KeyS')) {
        if (grounded() && !P.onRamp) doSlide();
        else {
          P.vy = Math.min(P.vy, MOVE.dropVy);
          P.trick = null;
          P.slideBuf = 0.25;
        }
      }
      if (input.wasPressed('KeyE', 'Enter', 'ShiftLeft', 'ShiftRight')) activateSale();
      if (P.jumpBuf > 0) {
        if (grounded()) doJump();
        P.jumpBuf -= dt;
      }
      P.slide = Math.max(0, P.slide - dt);
      P.slideBuf = Math.max(0, P.slideBuf - dt);

      // 指でなぞった分だけ目標位置を動かす（画面上の指の動き ≒ カートの動き）
      P.tx += (dragPx * CONTROL.dragSensitivity) / Render.view.k;
      P.tx += input.axisX() * th.steer * dt; // PC確認用のキーボード
      P.tx = clamp(P.tx, -th.limit, th.limit);
      const prevX = P.x;
      const maxStep = CONTROL.maxSideSpeed * dt;
      P.x += clamp((P.tx - P.x) * Math.min(1, dt * 28), -maxStep, maxStep);
      P.vx = (P.x - prevX) / Math.max(dt, 1e-4);

      const mul = Math.max(G.boost > 0 ? JUMP.levels[G.boostLevel - 1] : 1, G.sale > 0 ? SALE.speedMul : 1);
      const top = th.maxSpeed * mul;
      const acc = (mul > 1 ? th.accel * 3 : th.accel) * (P.stumble > 0 ? 0.45 : 1);
      if (P.speed < top) P.speed = Math.min(top, P.speed + acc * dt);
      else P.speed = Math.max(top, P.speed - 14 * dt);
    } else if (G.state === 'goal' || G.state === 'over') {
      P.speed = Math.max(0, P.speed - 10 * dt);
      P.vx *= 0.9;
      P.x += P.vx * dt;
    }
    P.prevZ = P.z;
    // ジャンプ（空中）・車の屋根
    const prevY = P.y;
    if (P.onObj) {
      if (onRoof(P.onObj)) {
        P.y = P.onObj.h;
        P.vy = 0;
      } else P.onObj = null; // 屋根の前から落ちた
    } else if (!P.onRamp && (P.y > 0 || P.vy > 0)) {
      P.vy -= JUMP.gravity * dt;
      P.y += P.vy * dt;
      if (P.trick) P.trick.t += dt;
      if (P.y <= 0) {
        const imp = -P.vy;
        P.y = 0;
        P.vy = 0;
        landed(imp);
        if (P.slideBuf > 0) doSlide();
      }
    }
    if (P.tumble) {
      P.tumble.t += dt;
      if (P.tumble.t >= P.tumble.dur) P.tumble = null;
    }
    P.z += P.speed * dt;
    for (const r of G.ramps) if (r.attach) syncAttachedRamp(r);
    if (G.state === 'run') updateRamps(th, prevY);
    // 落ちてきて車の屋根に乗ったら、ポンと弾んで次へ（車から車へ渡っていける）
    if (G.state === 'run' && !P.onRamp && P.vy <= 0 && P.y > 0) {
      for (const o of G.obstacles) {
        if (!VEHICLES.has(o.kind) || o.flying) continue;
        if (prevY >= o.h - 0.4 && P.y <= o.h + 0.6 && onRoof(o)) {
          landed(-P.vy * 0.5);
          bumpCombo();
          P.y = o.h + 0.01;
          P.vy = MOVE.hopVy * 0.75;
          G.roofHops = (G.roofHops || 0) + 1;
          G.score += 80;
          addGauge(SALE.gain.smash * 0.5);
          sfx.hop();
          break;
        }
      }
    }
    audio.setHype(G.sale > 0);
    if (G.sale > 0) {
      G.sale = Math.max(0, G.sale - dt);
      G.gauge = (100 * G.sale) / SALE.duration;
    }
    if (P.y <= 0) P.phase += Math.min(P.speed, 20) * dt * 1.3;
    P.steer += (clamp(P.vx / 10, -1, 1) - P.steer) * Math.min(1, dt * 10);
    G.boost = Math.max(0, G.boost - dt);
    if (G.boost <= 0) G.boostLevel = 0;

    if (G.state === 'run' || G.state === 'countdown') spawnAhead();

    // 障害物の移動
    for (const o of G.obstacles) {
      if (VEHICLES.has(o.kind) && !o.hit && !o.flying && o.vz) avoidTraffic(o, dt);
      if (o.vz) o.z += o.vz * dt;
      if (o.change && !o.hit) updateLaneChange(o, P, dt);
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
      if (o.flying) {
        o.flyT += dt;
        o.x += o.fvx * dt;
        o.z += o.fvz * dt;
        o.fy += o.fvy * dt;
        o.fvy -= 26 * dt;
        o.rx += o.srx * dt;
        o.ry += o.sry * dt;
        o.rz += o.srz * dt;
      } else if (o.hit) {
        o.wob += dt;
        o.x += o.kx * dt;
        o.kx *= Math.pow(0.05, dt);
      }
    }
    G.obstacles = G.obstacles.filter((o) => o.z + o.len > P.z - CAM_BACK - 2 && Math.abs(o.x) < 30 && !(o.flying && (o.flyT > 2.5 || o.fy < -8)));
    if (P.onObj && !G.obstacles.includes(P.onObj)) P.onObj = null;
    G.ramps = G.ramps.filter((r) => (r.z1 > P.z - CAM_BACK - 2 || r === P.onRamp) && !(r.attach && (r.attach.flying || !G.obstacles.includes(r.attach))));
    if (P.onRamp && !G.ramps.includes(P.onRamp)) P.onRamp = null;

    if (G.state === 'run') {
      // 高速でもすり抜けないよう、前フレームから今フレームまでの区間で判定する
      const cz = P.z + 0.6;
      const pz = P.prevZ + 0.6;
      const ph = P.slide > 0 ? MOVE.slideH : MOVE.standH; // 自分の高さ（スライディング中は低い）
      for (const o of G.obstacles) {
        if (o.hit || o.flying || o === P.onObj) continue;
        if (P.onRamp && P.onRamp.attach === o) continue;
        const reach = o.len / 2 + 0.75;
        const inZ = o.z + reach >= pz && o.z - reach <= cz;
        const clearance = Math.abs(o.x - P.x) - (o.w + 0.38);
        // 上下の重なり: 飛び越えている／下をくぐっている なら当たらない
        const overlapY = P.y < o.h - 0.12 && P.y + ph > o.y0 + 0.05;
        if (inZ) {
          if (!overlapY) continue;
          if (clearance < 0) {
            if (G.sale > 0) {
              smash(o);
              continue;
            }
            if (LIGHT.has(o.kind)) {
              smash(o);
              P.speed *= 0.93;
              addGauge(SALE.gain.smash);
              continue;
            }
            if (G.invuln > 0) continue;
            onHit(o);
            break;
          }
          o.minClr = Math.min(o.minClr === undefined ? 99 : o.minClr, clearance);
        } else if (o.minClr !== undefined && !o.nmDone && o.z + reach < cz) {
          // すれすれで避けた
          o.nmDone = true;
          if (o.minClr >= 0 && o.minClr < 0.45 && G.invuln <= 0) nearMiss();
        }
      }
    }
    G.comboTimer = Math.max(0, G.comboTimer - dt);
    if (G.comboTimer <= 0) G.combo = 0;

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
    G.punch = Math.max(0, (G.punch || 0) - dt * 2.5);
    G.dip = Math.max(0, (G.dip || 0) - dt * 4);
    P.squash = Math.max(0, (P.squash || 0) - dt * 5);
    P.stumble = Math.max(0, (P.stumble || 0) - dt);
    G.shake = Math.max(0, G.shake - dt);
    G.camX = (G.camX || 0) + (P.x * 0.85 - (G.camX || 0)) * Math.min(1, dt * 8);
    // ジャンプ中はカメラも少し持ち上げて追いかける
    Render.setCamera(G.camX, P.z - CAM_BACK, P.y * 0.55);
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
    const rkey = st.id + (G.night ? '@night' : '');
    const rec = records[rkey] || (records[rkey] = {});
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
          ['走行・技・ギリギリ', Math.floor(G.score).toLocaleString()],
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
        sub = G.overReason === 'time' ? '時間切れ！特売が終わっちゃった…' : `${G.lastCause || '障害物'}に激突。買い物どころじゃない…`;
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
    rows = [
      ['ギリギリ回避', `${G.nearMisses}回`],
      ['ジャンプ台', `${G.jumps}回（最大${G.maxChain}連続）`],
      ['着地成功 / 最大コンボ', `${G.cleanLandings || 0}回 / ${G.maxCombo || 0}`],
      ['はね飛ばした数', `${G.smashed}個`],
      ['タイムセール', `${G.sales}回`],
    ].concat(rows);
    G.result = { clear, headline, sub, rows: rows.slice(), newRecord };
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

  // ---------- 結果画像のシェア ----------
  function loadImage(src) {
    return new Promise((res) => {
      if (!src) return res(null);
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
  }
  async function makeResultImage() {
    const r = G.result;
    const st = G.stage;
    const Wc = 1080;
    const Hc = 1440;
    const c = document.createElement('canvas');
    c.width = Wc;
    c.height = Hc;
    const g = c.getContext('2d');
    const font = (w, px) => `${w} ${px}px "M PLUS Rounded 1c","Hiragino Maru Gothic ProN",sans-serif`;
    g.fillStyle = '#fffaf0';
    g.fillRect(0, 0, Wc, Hc);
    // ゴールの瞬間の画面
    const shot = await loadImage(Render.getSnapshot());
    const ph = 760;
    if (shot) {
      const k = Math.max(Wc / shot.width, ph / shot.height);
      const sw = Wc / k;
      const sh = ph / k;
      g.drawImage(shot, (shot.width - sw) / 2, (shot.height - sh) / 2, sw, sh, 0, 0, Wc, ph);
    } else {
      g.fillStyle = '#2ec4b6';
      g.fillRect(0, 0, Wc, ph);
    }
    const grd = g.createLinearGradient(0, ph - 220, 0, ph);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = grd;
    g.fillRect(0, ph - 220, Wc, 220);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.font = font(900, 46);
    g.fillText('カートラッシュ！', 48, 90);
    g.font = font(900, 100);
    g.lineWidth = 12;
    g.strokeStyle = '#2b2d42';
    g.strokeText(r.headline, 48, ph - 60);
    g.fillStyle = r.clear ? '#ffd166' : '#ffffff';
    g.fillText(r.headline, 48, ph - 60);
    // ステージと数字
    g.fillStyle = '#2b2d42';
    g.font = font(900, 52);
    g.fillText(`STAGE ${st.no}  ${st.name}${G.night ? '（夜）' : ''}`, 48, ph + 90);
    g.font = font(800, 34);
    g.fillStyle = '#5c5f77';
    g.fillText(`${st.route || ''}  ${G.mode === 'normal' ? 'チェックポイントモード' : 'タイムアタック'}`, 48, ph + 145);
    let y = ph + 220;
    const rows = r.rows.filter((row) => row[2] === 'total').concat(r.rows.filter((row) => row[2] !== 'total').slice(0, 5));
    rows.forEach((row, i) => {
      g.font = font(i === 0 ? 900 : 700, i === 0 ? 50 : 36);
      g.fillStyle = i === 0 ? '#d94b4b' : '#2b2d42';
      g.textAlign = 'left';
      g.fillText(row[0], 48, y);
      g.textAlign = 'right';
      g.fillText(String(row[1]), Wc - 48, y);
      y += i === 0 ? 78 : 58;
    });
    if (r.newRecord) {
      g.save();
      g.translate(Wc - 210, 150);
      g.rotate(-0.12);
      g.fillStyle = '#ffd166';
      g.fillRect(-170, -48, 340, 96);
      g.strokeStyle = '#2b2d42';
      g.lineWidth = 8;
      g.strokeRect(-170, -48, 340, 96);
      g.fillStyle = '#2b2d42';
      g.textAlign = 'center';
      g.font = font(900, 46);
      g.fillText('NEW RECORD!', 0, 16);
      g.restore();
    }
    return c;
  }
  let shareBlob = null;
  async function openShare() {
    sfx.click();
    const c = await makeResultImage();
    const url = c.toDataURL('image/png');
    $('share-img').src = url;
    $('btn-share-dl').href = url;
    shareBlob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const canShareFile = !!(navigator.canShare && shareBlob && navigator.canShare({ files: [new File([shareBlob], 'cart-rush.png', { type: 'image/png' })] }));
    $('btn-share-send').classList.toggle('hidden', !canShareFile);
    showScreen('share');
  }
  async function sendShare() {
    if (!shareBlob) return;
    const file = new File([shareBlob], 'cart-rush.png', { type: 'image/png' });
    try {
      await navigator.share({ files: [file], text: `カートラッシュ！ STAGE ${G.stage.no} ${G.result.headline}` });
    } catch (e) {
      /* キャンセルなど */
    }
  }

  // ---------- メニュー ----------
  let selectedMode = 'normal';
  function renderStageList() {
    const list = $('stage-list');
    $('time-day').classList.toggle('on', !settings.night);
    $('time-night').classList.toggle('on', settings.night);
    $('stage-mode').textContent = selectedMode === 'normal' ? 'チェックポイントモード' : 'タイムアタック';
    list.innerHTML = '';
    STAGES.forEach((st, idx) => {
      const rec = records[st.id + (settings.night ? '@night' : '')] || {};
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
        <div class="stage-thumb${settings.night ? ' night' : ''}"><span>STAGE ${st.no}</span></div>
        <div class="stage-info">
          <h3>${st.name}${rec.cleared ? ' <em class="tag">クリア</em>' : ''}</h3>
          <p class="stars">難しさ ${'★'.repeat(st.level)}${'☆'.repeat(3 - st.level)}${st.route ? `<span class="route">${st.route}</span>` : ''}</p>
          <p class="desc">${st.desc}</p>
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
    audio.stopMusic();
    showScreen('pause');
  }
  function resume() {
    if (G.state !== 'paused') return;
    G.state = G.prevState;
    if (G.state === 'run') audio.playMusic(SONGS[G.stage.id] || SONGS.market);
    showScreen(null);
  }

  function saveSettings() {
    storage.set(SET_KEY, settings);
    Render.setCameraMode(settings.camera);
    document.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', String(settings[b.dataset.set]) === b.dataset.val));
  }
  let settingsBack = 'title';
  function openSettings(from) {
    settingsBack = from;
    saveSettings();
    showScreen('settings');
  }

  function updateSoundButton() {
    $('btn-sound').textContent = audio.muted ? '🔇 サウンド OFF' : '🔊 サウンド ON';
    $('btn-vibe').textContent = haptics.enabled ? '📳 振動 ON' : '📴 振動 OFF';
    $('btn-vibe').classList.toggle('hidden', !haptics.supported || !isTouchDevice());
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
  $('btn-vibe').addEventListener('click', () => {
    haptics.setEnabled(!haptics.enabled);
    haptics.vibrate(30);
    updateSoundButton();
  });
  $('btn-pause').addEventListener('click', pause);
  $('btn-share').addEventListener('click', openShare);
  $('btn-share-send').addEventListener('click', sendShare);
  $('btn-share-close').addEventListener('click', () => showScreen('result'));
  $('btn-sale').addEventListener('click', activateSale);
  document.querySelectorAll('[data-set]').forEach((b) =>
    b.addEventListener('click', () => {
      sfx.click();
      const v = b.dataset.val;
      settings[b.dataset.set] = v === 'true' ? true : v === 'false' ? false : v;
      saveSettings();
    })
  );
  $('btn-settings').addEventListener('click', () => {
    audio.unlock();
    sfx.click();
    openSettings('title');
  });
  $('btn-pause-settings').addEventListener('click', () => openSettings('pause'));
  $('btn-settings-back').addEventListener('click', () => {
    sfx.click();
    showScreen(settingsBack);
  });
  for (const [id, night] of [['time-day', false], ['time-night', true]]) {
    $(id).addEventListener('click', () => {
      sfx.click();
      settings.night = night;
      storage.set(SET_KEY, settings);
      renderStageList();
    });
  }
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

    // スマホを横向きにしたら一時停止（縦専用）
    if (isTouchDevice() && window.innerWidth > window.innerHeight) pause();
    if (input.wasPressed('Escape', 'KeyP')) {
      if (G.state === 'paused') resume();
      else pause();
    }
    // ぶつかった瞬間は一瞬スローモーション
    let gdt = dt;
    if (G.slow > 0 && G.state === 'run') {
      G.slow = Math.max(0, G.slow - dt);
      gdt = dt * 0.3;
    }
    update(gdt);

    Render.setShake(G.shake);
    Render.drawWorld(G, G.time);
    ctx.clearRect(0, 0, W, H);
    Render.drawOverlay(ctx, G, G.time);
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
