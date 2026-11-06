// 成り上がれ！歩兵 ― ルール（盤・駒の動き・合法手・詰み判定）
// 座標: x = 0..8（左→右）, y = 0..8（上→下）。プレイヤー(owner 0)は下側で上へ進む、相手(owner 1)は上側で下へ進む。
(function () {
  'use strict';
  const N = 9;
  const INF = 99;

  // 方向（プレイヤーから見た向き）。相手側は上下左右を反転して使う
  const DIRS = { F: [0, -1], B: [0, 1], L: [-1, 0], R: [1, 0], FL: [-1, -1], FR: [1, -1], BL: [-1, 1], BR: [1, 1] };

  // 歩に合成できる「パーツ」になる駒。金・銀は相場でも売買できる
  const PARTS = {
    L: { name: '香車', short: '香', rays: [['F', INF]], value: 60 },
    N: { name: '桂馬', short: '桂', jumps: [[-1, -2], [1, -2]], value: 70 },
    S: { name: '銀将', short: '銀', rays: [['F', 1], ['FL', 1], ['FR', 1], ['BL', 1], ['BR', 1]], value: 90 },
    G: { name: '金将', short: '金', rays: [['F', 1], ['FL', 1], ['FR', 1], ['L', 1], ['R', 1], ['B', 1]], value: 110 },
    B: { name: '角行', short: '角', rays: [['FL', INF], ['FR', INF], ['BL', INF], ['BR', INF]], value: 160 },
    R: { name: '飛車', short: '飛', rays: [['F', INF], ['B', INF], ['L', INF], ['R', INF]], value: 180 },
  };
  const PART_KEYS = Object.keys(PARTS);

  // お金で買う強化（歩に付ける）
  const UPGRADES = {
    leg: { name: '脚力アップ', desc: '前に進める距離 +1（最大3マス）', max: 2 },
    side: { name: '横歩き', desc: '左右に1マス動ける', max: 1 },
    back: { name: '後ずさり', desc: '後ろに1マス動ける', max: 1 },
    armor: { name: '鉄の鎧', desc: '取られそうになっても1回だけ耐える', max: 2 },
  };
  const UPGRADE_KEYS = Object.keys(UPGRADES);
  const MAX_FUSE = 3; // 1枚の歩に合成できる駒の数

  let uid = 0;
  function newPawn(owner) {
    return { t: 'P', owner, ups: { leg: 0, side: 0, back: 0, armor: 0 }, fused: [], promo: false, id: ++uid };
  }
  function newKing(owner) {
    return { t: 'K', owner, id: ++uid };
  }
  function clonePiece(p) {
    return p.t === 'K' ? Object.assign({}, p) : Object.assign({}, p, { ups: Object.assign({}, p.ups), fused: p.fused.slice() });
  }

  // 駒の動き: { rays: {方向: 最大距離}, jumps: [[dx,dy]] }（プレイヤーから見た向き）
  function moveSet(p) {
    const rays = {};
    const jumps = [];
    const add = (d, m) => (rays[d] = Math.max(rays[d] || 0, m));
    if (p.t === 'K') {
      for (const d in DIRS) add(d, 1);
      return { rays, jumps };
    }
    add('F', 1 + p.ups.leg);
    if (p.ups.side) {
      add('L', 1);
      add('R', 1);
    }
    if (p.ups.back) add('B', 1);
    if (p.promo) for (const [d, m] of PARTS.G.rays) add(d, m); // と金: 金の動きが加わる
    for (const f of p.fused) {
      const part = PARTS[f];
      (part.rays || []).forEach(([d, m]) => add(d, m));
      (part.jumps || []).forEach((j) => jumps.push(j));
    }
    return { rays, jumps };
  }
  // 戦闘力（動ける広さの目安）。表示と評価に使う
  function power(p) {
    if (p.t === 'K') return 0;
    const ms = moveSet(p);
    let v = 0;
    for (const d in ms.rays) v += Math.min(ms.rays[d], 8) * (d === 'F' ? 1 : 1.2);
    v += ms.jumps.length * 2;
    return Math.round(v * 10) / 10;
  }
  // 歩の呼び名（合成した駒の頭文字＋歩）
  function pawnName(p) {
    if (p.t === 'K') return '王';
    const head = p.fused.map((f) => PARTS[f].short).join('');
    return (p.promo ? 'と' : '') + (head ? head + '歩' : p.promo ? '金' : '歩');
  }

  // ---------- 盤面 ----------
  function initialState() {
    const board = [];
    for (let y = 0; y < N; y++) board.push(new Array(N).fill(null));
    for (let x = 0; x < N; x++) {
      board[6][x] = newPawn(0);
      board[2][x] = newPawn(1);
    }
    board[8][4] = newKing(0);
    board[0][4] = newKing(1);
    return { board, hands: [0, 0], turn: 0, ply: 0, winner: null };
  }
  const inside = (x, y) => x >= 0 && x < N && y >= 0 && y < N;
  const sign = (owner) => (owner === 0 ? 1 : -1);
  const promoZone = (owner, y) => (owner === 0 ? y <= 2 : y >= 6);
  const lastRank = (owner, y) => (owner === 0 ? y === 0 : y === 8);

  // 疑似合法手（自玉の安全は見ない）
  function genMoves(st, owner, withDrops = true) {
    const out = [];
    const b = st.board;
    const s = sign(owner);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const p = b[y][x];
        if (!p || p.owner !== owner) continue;
        const ms = moveSet(p);
        for (const d in ms.rays) {
          const [dx, dy] = DIRS[d];
          const max = Math.min(ms.rays[d], 8);
          for (let k = 1; k <= max; k++) {
            const nx = x + dx * k * s;
            const ny = y + dy * k * s;
            if (!inside(nx, ny)) break;
            const t = b[ny][nx];
            if (!t) out.push({ fx: x, fy: y, tx: nx, ty: ny });
            else {
              if (t.owner !== owner) out.push({ fx: x, fy: y, tx: nx, ty: ny, cap: true });
              break;
            }
          }
        }
        for (const [jx, jy] of ms.jumps) {
          const nx = x + jx * s;
          const ny = y + jy * s;
          if (!inside(nx, ny)) continue;
          const t = b[ny][nx];
          if (!t || t.owner !== owner) out.push({ fx: x, fy: y, tx: nx, ty: ny, cap: !!t });
        }
      }
    if (withDrops && st.hands[owner] > 0) {
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) if (!b[y][x] && !lastRank(owner, y)) out.push({ drop: true, tx: x, ty: y });
    }
    return out;
  }

  function findKing(st, owner) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const p = st.board[y][x];
      if (p && p.t === 'K' && p.owner === owner) return [x, y];
    }
    return null;
  }
  // owner の王が相手の駒に狙われているか
  function inCheck(st, owner) {
    const k = findKing(st, owner);
    if (!k) return true;
    return genMoves(st, 1 - owner, false).some((m) => m.tx === k[0] && m.ty === k[1]);
  }

  // 手を指した後の局面を返す（元の局面は変えない）
  //   鎧: 鎧を着た歩を取ろうとすると、鎧が1枚減って取れない（攻めた駒は元の場所に残る）
  //   取った歩は持ち歩になる。合成されていた駒のうち1つを「戦利品」として奪える
  function applyMove(st, m, pickLoot) {
    const board = st.board.map((row) => row.slice());
    const hands = st.hands.slice();
    const owner = st.turn;
    const ev = { bounced: false, captured: null, loot: null, promoted: false, king: false };
    if (m.drop) {
      board[m.ty][m.tx] = newPawn(owner);
      hands[owner]--;
    } else {
      const mover = clonePiece(board[m.fy][m.fx]);
      const target = board[m.ty][m.tx];
      if (target && target.t === 'P' && target.ups.armor > 0) {
        const t2 = clonePiece(target);
        t2.ups.armor--;
        board[m.ty][m.tx] = t2;
        ev.bounced = true;
      } else {
        if (target) {
          ev.captured = target;
          if (target.t === 'K') ev.king = true;
          else {
            hands[owner]++;
            if (target.fused.length) ev.loot = pickLoot ? pickLoot(target.fused) : target.fused[0];
          }
        }
        board[m.fy][m.fx] = null;
        if (mover.t === 'P' && !mover.promo && (promoZone(owner, m.ty) || promoZone(owner, m.fy))) {
          mover.promo = true;
          ev.promoted = true;
        }
        board[m.ty][m.tx] = mover;
      }
    }
    const next = { board, hands, turn: 1 - owner, ply: st.ply + 1, winner: ev.king ? owner : null };
    return { st: next, ev };
  }

  function legalMoves(st, owner) {
    const o = owner === undefined ? st.turn : owner;
    const base = Object.assign({}, st, { turn: o });
    return genMoves(base, o).filter((m) => !inCheck(applyMove(base, m).st, o));
  }

  window.Fu = {
    N,
    DIRS,
    PARTS,
    PART_KEYS,
    UPGRADES,
    UPGRADE_KEYS,
    MAX_FUSE,
    newPawn,
    clonePiece,
    moveSet,
    power,
    pawnName,
    initialState,
    genMoves,
    legalMoves,
    applyMove,
    inCheck,
    findKing,
    sign,
  };
})();
