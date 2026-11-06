// 成り上がれ！歩兵 ― 相手（コンピューター）の思考
(function () {
  'use strict';
  const Fu = window.Fu;
  const Eco = window.FuEco;
  const { N, PARTS, UPGRADES, MAX_FUSE } = Fu;

  // ---------- 盤面の評価 ----------
  function pieceValue(p, y) {
    if (p.t === 'K') return 0;
    const adv = p.owner === 0 ? 6 - y : y - 2; // 前に出ているほど少し高く
    return 100 + Fu.power(p) * 10 + p.ups.armor * 35 + (p.promo ? 40 : 0) + Math.max(0, adv) * 3;
  }
  function attackSet(st, owner) {
    const set = new Set();
    for (const m of Fu.genMoves(Object.assign({}, st, { turn: owner }), owner, false)) set.add(m.ty * N + m.tx);
    return set;
  }
  function kingDanger(st, owner, enemyAtk) {
    const k = Fu.findKing(st, owner);
    if (!k) return 5000;
    let d = enemyAtk.has(k[1] * N + k[0]) ? 80 : 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = k[0] + dx;
        const y = k[1] + dy;
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        if (enemyAtk.has(y * N + x)) d += 10;
      }
    return d;
  }
  function evaluate(st, me) {
    let s = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const p = st.board[y][x];
        if (p) s += (p.owner === me ? 1 : -1) * pieceValue(p, y);
      }
    s += (st.hands[me] - st.hands[1 - me]) * 70;
    const atkMe = attackSet(st, me);
    const atkOp = attackSet(st, 1 - me);
    s -= kingDanger(st, me, atkOp);
    s += kingDanger(st, 1 - me, atkMe);
    return s;
  }

  // 探索用の候補手。持ち歩を打つ手は数が多いので、敵の駒や自玉の近くに絞る
  function candidates(st) {
    const me = st.turn;
    const moves = Fu.genMoves(st, me, false);
    if (st.hands[me] > 0) {
      const spots = new Set();
      const mk = Fu.findKing(st, me);
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const p = st.board[y][x];
          const near = (p && p.owner !== me) || (mk && Math.abs(mk[0] - x) <= 1 && Math.abs(mk[1] - y) <= 2 && !p);
          if (!near) continue;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= N || ny >= N || st.board[ny][nx]) continue;
              if ((me === 0 && ny === 0) || (me === 1 && ny === 8)) continue;
              spots.add(ny * N + nx);
            }
        }
      [...spots].slice(0, 14).forEach((i) => moves.push({ drop: true, tx: i % N, ty: Math.floor(i / N) }));
    }
    // 取る手を先に読む（枝刈りが効きやすい）
    moves.sort((a, b) => (b.cap ? 1 : 0) - (a.cap ? 1 : 0));
    return moves;
  }
  function negamax(st, depth, alpha, beta) {
    if (depth === 0) return evaluate(st, st.turn);
    let best = -Infinity;
    for (const m of candidates(st)) {
      const { st: ns, ev } = Fu.applyMove(st, m);
      const v = ev.king ? 100000 : -negamax(ns, depth - 1, -beta, -alpha);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best === -Infinity ? -50000 : best;
  }
  // royalLeft: 王の逆襲の残り回数。使うのは「詰みそうなとき」か「王手を逃れられるとき」か「強い歩を消せるとき」
  function chooseMove(st, royalLeft) {
    const legal = Fu.legalMoves(st, st.turn);
    const royal = royalLeft > 0 ? Fu.royalTargets(st, st.turn) : [];
    if (royal.length) {
      const inChk = Fu.inCheck(st, st.turn);
      let pick = null;
      let pv = -Infinity;
      for (const m of royal) {
        const p = st.board[m.ty][m.tx];
        const v = Fu.power(p) + p.ups.armor * 3 + p.fused.length * 4;
        if (v > pv) {
          pv = v;
          pick = m;
        }
      }
      if (!legal.length || (inChk && pv >= 3) || pv >= 12) return pick;
    }
    if (!legal.length) return null;
    // 持ち歩を打つ手は絞り込んだ候補だけにする
    const cand = candidates(st);
    const key = (m) => (m.drop ? `d${m.tx},${m.ty}` : `${m.fx},${m.fy}-${m.tx},${m.ty}`);
    const ok = new Set(legal.map(key));
    let list = cand.filter((m) => ok.has(key(m)));
    if (!list.length) list = legal;
    let best = null;
    let bestV = -Infinity;
    for (const m of list) {
      const { st: ns, ev } = Fu.applyMove(st, m);
      const v = (ev.king ? 100000 : -negamax(ns, 1, -Infinity, Infinity)) + Math.random() * 6;
      if (v > bestV) {
        bestV = v;
        best = m;
      }
    }
    return best;
  }

  // ---------- お金の使い方・相場 ----------
  function myPawns(st, owner) {
    const out = [];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const p = st.board[y][x];
        if (p && p.owner === owner && p.t === 'P') out.push({ p, x, y });
      }
    return out;
  }
  // 強くする歩を1枚決める（いちばん強い歩をさらに育てる。たまに前線の歩）
  function targetPawn(st, owner, rng) {
    const ps = myPawns(st, owner);
    if (!ps.length) return null;
    const score = (e) => Fu.power(e.p) * 2 + (owner === 1 ? e.y : 8 - e.y) - Math.abs(e.x - 4) * 0.3;
    ps.sort((a, b) => score(b) - score(a));
    return rng() < 0.75 ? ps[0] : ps[Math.floor(rng() * Math.min(3, ps.length))];
  }

  // 戻り値: 実行したことの説明（ログ用）
  function economy(game, rng) {
    const me = 1;
    const pl = game.players[me];
    const op = game.players[0];
    const m = game.market;
    const log = [];
    // 相場: 平均より安ければ買い、高ければ売る。プレイヤーが金銀を抱えていたら売り浴びせて値を崩す
    for (const k of ['G', 'S']) {
      const h = m[k].hist;
      const ma = h.slice(-10).reduce((a, b) => a + b, 0) / 10;
      const p = m[k].price;
      const name = Eco.COMMODITIES[k].name;
      if (op.parts[k] >= 2 && pl.parts[k] >= 2 && rng() < 0.4) {
        let n = 0;
        while (pl.parts[k] > 1 && pl.trades > 0 && n < 2 && Eco.trade(m, k, 'sell', pl, me).ok) n++;
        if (n) log.push(`${name}を${n}枚 売り浴びせた！（${name}相場が下落）`);
      } else if (p > ma * 1.12 && pl.parts[k] > 1 && pl.trades > 0) {
        if (Eco.trade(m, k, 'sell', pl, me).ok) log.push(`${name}を高値で売った`);
      } else if (p < ma * 0.9 && pl.money > p + 40 && pl.trades > 0) {
        if (Eco.trade(m, k, 'buy', pl, me).ok) log.push(`${name}を安値で買った`);
      }
    }
    // 借金: 利息が重いので、お金に余裕ができたら返す。強い駒が買えそうなら借りる（たまに）
    if (pl.debt > 0 && pl.money > 40) {
      const r = Eco.repay(pl, pl.money - 30);
      if (r) log.push(`借金を¥${r} 返した`);
    }
    if (pl.debt === 0 && pl.money < 60 && rng() < 0.12 && Eco.borrow(pl)) log.push(`闇金から¥${Eco.LOAN} 借りた！`);
    // ショップ: 余裕があれば、いちばん役に立ちそうな物を買う（最大2回）
    const want = { R: 9, B: 8, armor: 6, leg: 5, N: 5, L: 4, side: 4, back: 2, pawn: game.st.hands[me] === 0 ? 5 : 1 };
    for (let n = 0; n < 2; n++) {
      // 同じ強化をすでに持っているなら買わない（使い道がなくなるため）
      const opts = pl.lineup.map((it, i) => ({ it, i })).filter((o) => o.it.price <= pl.money - 25 && !(pl.items[o.it.key] > 0));
      if (!opts.length || rng() < 0.25) break;
      opts.sort((a, b) => want[b.it.key] / b.it.price - want[a.it.key] / a.it.price);
      const got = Eco.buy(pl, opts[0].i, rng, () => game.st.hands[me]++, m.infl);
      if (got) log.push(`ショップで「${Eco.itemLabel(got.key).title}」を買った`);
    }
    // 強化と合成: 持っている物を歩に使う
    const t = targetPawn(game.st, me, rng);
    if (t) {
      for (const k of Fu.UPGRADE_KEYS) {
        while (pl.items[k] > 0) {
          const target = t.p.ups[k] < UPGRADES[k].max ? t : myPawns(game.st, me).find((e) => e.p.ups[k] < UPGRADES[k].max);
          if (!target) break;
          applyItem(game, me, target.x, target.y, k);
          log.push(`歩に「${UPGRADES[k].name}」を付けた`);
        }
      }
      const order = ['R', 'B', 'N', 'L', 'G', 'S'];
      for (const k of order) {
        if (pl.parts[k] <= 0 || pl.money < Eco.fuseCost(m)) continue;
        if ((k === 'G' || k === 'S') && m[k].price > Eco.COMMODITIES[k].base * m.infl * 1.05) continue; // 高いときは合成せず売り時を待つ
        const cur = game.st.board[t.y][t.x];
        if (!cur || cur.fused.length >= MAX_FUSE || cur.fused.includes(k)) continue;
        fuse(game, me, t.x, t.y, k);
        const np = game.st.board[t.y][t.x];
        log.push(`歩に${PARTS[k].name}を合成して「${Fu.fullName(np)}」を生み出した！`);
        if (game.onFuse) game.onFuse(me, np);
        break;
      }
    }
    return log;
  }

  // 強化アイテムを盤上の歩に使う（手番は消費しない）
  function applyItem(game, owner, x, y, key) {
    const pl = game.players[owner];
    const p = game.st.board[y][x];
    if (!p || p.owner !== owner || p.t !== 'P' || pl.items[key] <= 0 || p.ups[key] >= UPGRADES[key].max) return false;
    const np = Fu.clonePiece(p);
    np.ups[key]++;
    game.st.board[y][x] = np;
    pl.items[key]--;
    return true;
  }
  // 駒を歩に合成する（手番は消費しない。手数料がかかる）
  function fuse(game, owner, x, y, key) {
    const pl = game.players[owner];
    const p = game.st.board[y][x];
    const cost = Eco.fuseCost(game.market);
    if (!p || p.owner !== owner || p.t !== 'P' || pl.parts[key] <= 0 || pl.money < cost) return false;
    if (p.fused.length >= MAX_FUSE || p.fused.includes(key)) return false;
    const np = Fu.clonePiece(p);
    np.fused.push(key);
    game.st.board[y][x] = np;
    pl.parts[key]--;
    pl.money -= cost;
    return true;
  }

  window.FuAI = { chooseMove, economy, applyItem, fuse, evaluate };
})();
