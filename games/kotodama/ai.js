// 言霊デュエル ― 相手（コンピューター）の考え方
(function () {
  'use strict';
  const K = window.Koto;
  const { CARDS } = K;

  // 文の「うれしさ」。攻撃はそのまま、回復は減っているときだけ、守りは控えめ
  function score(G, me, s) {
    const p = G.p[me];
    const op = G.p[1 - me];
    const ev = K.evaluate(s);
    let w = 1;
    const others = p.field.filter((x) => x && x !== s && x.uid !== s.uid);
    if (ev.act === 'heal') w = K.MAX_HP - p.hp >= ev.value * 0.5 ? 0.9 : 0.35;
    else if (ev.act === 'guard') w = 0.6;
    else if (ev.act === 'buff') w = others.length ? 0.85 : 0.2;
    else if (ev.act === 'debuff') w = op.field.some(Boolean) ? (ev.sleep ? 1 : 0.85) : 0.25;
    else if (ev.act === 'break') return (op.traps.some(Boolean) ? 32 : 14) + ev.value * 0.1 - ev.selfDmg;
    let v = ev.value * w - ev.selfDmg * 1.2 + ev.extra + ev.draw * 12;
    const baseConsume = s.verb && CARDS[s.verb].consume;
    if (s.aux === 'a_makuru' && !baseConsume && ev.act !== 'heal') v -= ev.value * 0.45; // 場に残る文を使い切るのはもったいない
    if (s.aux === 'a_chau' && p.hp <= 40) v -= 100;
    if (s.aux === 'a_masu' && op.traps.some(Boolean)) v += ev.value * 0.25;
    return v;
  }

  // 手札から、この文にいちばん合う 助詞・動詞・助動詞 の組み合わせを探す
  function bestBuild(G, me, slot) {
    const p = G.p[me];
    const s = p.field[slot];
    const idx = (type) => [null].concat(p.hand.map((k, i) => (CARDS[k].type === type ? i : -1)).filter((i) => i >= 0));
    const parts = !s.part && !s.verb ? idx('part') : [null];
    const verbs = !s.verb ? idx('verb') : [null];
    const auxs = !s.aux ? idx('aux') : [null];
    let best = { v: score(G, me, s), plan: [] };
    for (const pi of parts)
      for (const vi of verbs)
        for (const ai of auxs) {
          let t = s;
          const plan = [];
          if (pi !== null) (t = K.attach(t, p.hand[pi])), plan.push(pi);
          if (vi !== null) (t = K.attach(t, p.hand[vi])), plan.push(vi);
          if (ai !== null) {
            if (!t.verb) continue;
            t = K.attach(t, p.hand[ai]);
            plan.push(ai);
          }
          if (pi !== null && vi === null && !t.verb) continue; // 助詞だけ置いても意味がない
          const v = score(G, me, t) - plan.length * 1.5; // カードを使うコスト
          if (v > best.v + 0.5) best = { v, plan };
        }
    return best;
  }

  // 召喚する名詞を選ぶ（手札の動詞と組んだときの強さで）
  function pickNoun(G, me) {
    const p = G.p[me];
    let best = null;
    p.hand.forEach((k, i) => {
      if (CARDS[k].type !== 'noun') return;
      const tmp = { p: G.p.slice() };
      tmp.p[me] = Object.assign({}, p, { field: p.field.slice() });
      const slot = p.field.indexOf(null);
      tmp.p[me].field[slot] = K.newSentence(k);
      tmp.p[me].hand = p.hand.filter((_, j) => j !== i);
      const b = bestBuild(tmp, me, slot);
      const v = b.v + K.defense(tmp.p[me].field[slot]) * 0.2;
      if (!best || v > best.v) best = { v, i };
    });
    return best;
  }

  // 攻撃の相手を選ぶ。'direct' か 相手の言葉のスロット番号。攻撃しないなら null
  function pickTarget(G, me, ev) {
    const op = G.p[1 - me];
    const live = op.field.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    if (!live.length || ev.slip) return 'direct';
    let best = null;
    for (const i of live) {
      const s = op.field[i];
      const d = K.defense(s);
      if (ev.value <= d) continue;
      const v = d + K.evaluate(s).value + (ev.value - d) * 0.5;
      if (!best || v > best.v) best = { v, i };
    }
    return best ? best.i : null;
  }

  async function run(G, me, api) {
    const p = G.p[me];
    const op = G.p[1 - me];
    // 1. トラップを伏せる
    for (let i = p.hand.length - 1; i >= 0; i--) {
      if (CARDS[p.hand[i]].type !== 'trap') continue;
      const ts = p.traps.indexOf(null);
      if (ts < 0) break;
      await api.setTrap(me, i, ts);
      if (G.over) return;
    }
    // 2. 名詞を出す（1ターン1回）
    if (!p.summoned && p.field.includes(null)) {
      const n = pickNoun(G, me);
      if (n) await api.playNoun(me, n.i, p.field.indexOf(null));
      if (G.over) return;
    }
    // 3. 言葉を重ねる（強い文から）
    for (let round = 0; round < 3; round++) {
      let did = false;
      for (let slot = 0; slot < K.SLOTS; slot++) {
        if (!p.field[slot]) continue;
        const b = bestBuild(G, me, slot);
        if (!b.plan.length) continue;
        const keys = b.plan.map((i) => p.hand[i]);
        for (const key of keys) {
          const hi = p.hand.indexOf(key);
          if (hi < 0 || !p.field[slot] || !K.canAttach(p.field[slot], key)) break;
          await api.attachCard(me, hi, slot);
          if (G.over) return;
        }
        did = true;
      }
      if (!did) break;
    }
    // 4. 発動する（妨害 → デバフ → バフ → 攻撃 → 回復・守り の順に考える）
    const PRI = { break: 0, debuff: 1, buff: 2, attack: 3, heal: 4, guard: 5 };
    for (let guard = 0; guard < 8; guard++) {
      const order = p.field
        .map((s, i) => (s && !s.used ? { i, ev: K.evaluate(s) } : null))
        .filter(Boolean)
        .sort((a, b) => PRI[a.ev.act] - PRI[b.ev.act] || b.ev.value - a.ev.value);
      let acted = false;
      for (const { i, ev } of order) {
        const t = decide(G, me, i, ev, api);
        if (t === undefined) continue;
        await api.activate(me, i, t);
        acted = true;
        break;
      }
      if (!acted || G.over) break;
    }
  }

  // 発動するなら対象（null も可）を返す。しないなら undefined
  function decide(G, me, i, ev, api) {
    const p = G.p[me];
    const op = G.p[1 - me];
    const s = p.field[i];
    if (ev.act === 'attack') {
      if (!api.canAttack()) return undefined;
      const t = pickTarget(G, me, ev);
      return t === null ? undefined : t;
    }
    if (ev.act === 'heal') {
      const need = K.MAX_HP - p.hp;
      const threatened = op.field.some((x) => x && K.evaluate(x).act === 'attack' && K.evaluate(x).value > K.defense(s));
      if (need < ev.value * 0.6 && p.hp > 60 && !(ev.draw && (threatened || need >= ev.value * 0.3))) return undefined;
      return null;
    }
    if (ev.act === 'guard') return op.field.some((x) => x && K.evaluate(x).act === 'attack') ? null : undefined;
    if (ev.act === 'break') return op.traps.some(Boolean) || (ev.consume ? false : op.hand.length) ? null : undefined;
    if (ev.act === 'buff') {
      // まだ発動していない攻撃の文を優先して強くする
      let best;
      let bv = -1;
      p.field.forEach((x, j) => {
        if (!x || j === i) return;
        const e = K.evaluate(x);
        const v = (e.act === 'attack' ? 2 : 1) * e.value + (x.used ? 0 : 20);
        if (v > bv) (bv = v), (best = j);
      });
      return best === undefined ? undefined : best;
    }
    if (ev.act === 'debuff') {
      // 消せる文、なければいちばん強い攻撃の文
      let best;
      let bv = -1;
      op.field.forEach((x, j) => {
        if (!x) return;
        const e = K.evaluate(x);
        const kill = e.value <= ev.value;
        const v = e.value * (e.act === 'attack' ? 1.5 : 1) + (kill ? 60 : 0) + (x.sleep ? -30 : 0);
        if (v > bv) (bv = v), (best = j);
      });
      return best === undefined ? undefined : best;
    }
    return undefined;
  }

  // 相手の行動に、伏せたトラップを使うか。opts: [{ ts, id }]。使うなら opts の番号、使わないなら -1
  function chooseTrap(G, me, ev, opts) {
    const has = (id) => opts.findIndex((o) => o.id === id);
    if (ev.type === 'verb') return has('ru');
    const e = ev.ev;
    const p = G.p[me];
    const lethal = ev.attack && e.value >= p.hp + p.shield;
    const keep = !e.consume; // 場に残る文は壊したい
    if (ev.attack) {
      if (has('hunt') >= 0 && (lethal || (keep && e.value >= 25) || e.value >= 45)) return has('hunt');
      if (has('silence') >= 0 && (lethal || e.value >= 30)) return has('silence');
      if (has('nitpick') >= 0 && e.value >= 20) return has('nitpick');
      if (has('mishear') >= 0 && e.value >= 30) return has('mishear');
      return -1;
    }
    if (has('hunt') >= 0 && e.value >= 35) return has('hunt');
    if (has('mishear') >= 0 && e.value >= 30) return has('mishear');
    return -1;
  }

  window.KotoAI = { run, chooseTrap, score };
})();
