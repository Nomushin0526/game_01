// 言霊デュエル ― 画面と進行
(function () {
  'use strict';
  const K = window.Koto;
  const AI = window.KotoAI;
  const { CARDS, SLOTS } = K;
  const { audio, haptics, storage } = window.GameShared;
  const $ = (id) => document.getElementById(id);
  const rng = Math.random;
  const FAST = /fast/.test(location.hash); // 開発用: 演出を飛ばす
  const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? 0 : ms));
  const ICON = { attack: '⚔', heal: '♥', guard: '🛡', buff: '⬆', debuff: '⬇', break: '💥' };

  const sfx = {
    tap: () => audio.tone(700, 0.04, { type: 'square', vol: 0.06 }),
    card: () => audio.noise(0.07, { vol: 0.25, cutoff: 2400 }),
    stack: () => [660, 990].forEach((f, i) => audio.tone(f, 0.07, { type: 'triangle', vol: 0.1, delay: i * 0.05 })),
    speak: () => [523, 659, 784].forEach((f, i) => audio.tone(f, 0.1, { type: 'triangle', vol: 0.12, delay: i * 0.05 })),
    hit: () => {
      audio.noise(0.15, { vol: 0.4, cutoff: 900 });
      audio.tone(220, 0.18, { type: 'square', vol: 0.1, to: 90 });
    },
    heal: () => [784, 988, 1175, 1568].forEach((f, i) => audio.tone(f, 0.12, { type: 'sine', vol: 0.12, delay: i * 0.06 })),
    guard: () => audio.tone(300, 0.25, { type: 'triangle', vol: 0.14, to: 500 }),
    trap: () => [1200, 600, 1200, 600].forEach((f, i) => audio.tone(f, 0.08, { type: 'sawtooth', vol: 0.08, delay: i * 0.07 })),
    win: () => [523, 659, 784, 1047].forEach((f, i) => audio.tone(f, 0.18, { type: 'triangle', vol: 0.18, delay: i * 0.12 })),
    lose: () => [392, 330, 262].forEach((f, i) => audio.tone(f, 0.22, { type: 'triangle', vol: 0.16, delay: i * 0.18 })),
  };

  let G = null;
  let deckChoice = storage.get('koto.deck', 'food');
  let myDeck = storage.get('koto.mydeck', []);
  const deckList = (key) => (key === 'mine' ? myDeck.slice() : K.DECKS[key].cards.slice());
  const deckName = (key) => (key === 'mine' ? 'マイデッキ' : K.DECKS[key].name);

  // ---------- 対局の準備 ----------
  function newPlayer(deckKey) {
    return {
      deckKey,
      hp: K.MAX_HP,
      shield: 0,
      deck: K.shuffle(deckList(deckKey), rng),
      hand: [],
      field: new Array(SLOTS).fill(null),
      traps: new Array(SLOTS).fill(null),
      mana: 0, // マナゾーンの枚数
      manaUsed: 0, // このターンに使ったマナ
      charged: false, // このターンにマナをためたか
    };
  }
  function newGame() {
    if (deckChoice === 'mine' && K.checkDeck(myDeck).length) deckChoice = 'food';
    const keys = Object.keys(K.DECKS).filter((k) => k !== deckChoice);
    const opDeck = keys[Math.floor(rng() * keys.length)];
    G = { p: [newPlayer(deckChoice), newPlayer(opDeck)], turn: 0, turnNo: 0, over: false, busy: true, sel: null, selSlot: null, targeting: null, hsel: 0, detail: false, msg: '', log: [] };
    for (const p of G.p) for (let i = 0; i < K.START_HAND; i++) p.hand.push(p.deck.pop());
    const first = rng() < 0.5 ? 0 : 1;
    log(`相手は「${K.DECKS[opDeck].name}」。${first === 0 ? 'あなた' : '相手'}の先攻！`);
    render();
    setTimeout(() => startTurn(first), 400);
  }
  function log(msg) {
    G.log.unshift(msg);
    G.log.length = Math.min(G.log.length, 8);
  }
  const who = (pi) => (pi === 0 ? 'あなた' : '相手');
  const myTurn = () => G && !G.over && !G.busy && G.turn === 0;
  const canAttack = () => G.turnNo > 1; // 先攻の最初のターンは攻撃できない
  const free = (p) => p.mana - p.manaUsed;
  function pay(p, key) {
    const c = CARDS[key].cost;
    if (free(p) < c) return false;
    p.manaUsed += c;
    return true;
  }

  async function startTurn(pi) {
    if (G.over) return;
    G.turn = pi;
    G.turnNo++;
    const p = G.p[pi];
    p.shield = 0;
    p.manaUsed = 0;
    p.charged = false;
    for (const s of p.field) {
      if (!s) continue;
      s.used = false;
      if (s.sleep) {
        // 眠っている・しばられている文は、このターン発動できない
        s.used = true;
        s.sleep = 0;
        s.napping = true;
      } else s.napping = false;
    }
    G.sel = null;
    G.selSlot = null;
    G.targeting = null;
    if (G.turnNo > 1) {
      if (!p.deck.length) {
        // 言葉切れ: 山札がないと、引くたびにダメージが増えていく
        p.fatigue = (p.fatigue || 0) + 10;
        log(`${who(pi)}は言葉が出てこない…（山札切れで${p.fatigue}ダメージ）`);
        damage(pi, p.fatigue, true);
        render();
        if (checkEnd()) return;
      } else {
        const c = p.deck.pop();
        if (p.hand.length >= K.HAND_MAX) log(`${who(pi)}の手札がいっぱいで「${CARDS[c].word}」は捨て札に`);
        else p.hand.push(c);
      }
    }
    banner(pi === 0 ? 'あなたのターン' : '相手のターン', pi);
    if (pi === 0) {
      G.busy = false;
      render();
      return;
    }
    G.busy = true;
    render();
    await sleep(700);
    await AI.run(G, 1, api);
    if (G.over) return;
    await sleep(500);
    startTurn(0);
  }
  function endTurn() {
    if (!myTurn()) return;
    G.busy = true;
    sfx.tap();
    startTurn(1);
  }

  // ---------- 行動（あなたも相手も同じものを使う） ----------
  async function playNoun(pi, hi, slot) {
    const p = G.p[pi];
    const key = p.hand[hi];
    if (CARDS[key].type !== 'noun' || p.field[slot] || !pay(p, key)) return false;
    p.hand.splice(hi, 1);
    p.field[slot] = K.newSentence(key);
    log(`${who(pi)}が「${CARDS[key].word}」を場に出した`);
    sfx.card();
    flash(pi, slot);
    render();
    await sleep(pi === 1 ? 650 : 120);
    return true;
  }
  async function attachCard(pi, hi, slot) {
    const p = G.p[pi];
    const key = p.hand[hi];
    const s = p.field[slot];
    if (!K.canAttach(s, key) || !pay(p, key)) return false;
    p.hand.splice(hi, 1);
    p.field[slot] = K.attach(s, key);
    log(`${who(pi)}：「${K.text(p.field[slot])}」`);
    sfx.stack();
    flash(pi, slot);
    render();
    await sleep(pi === 1 ? 600 : 120);
    if (CARDS[key].type === 'verb') {
      const t = await trapCheck(1 - pi, { type: 'verb', pi, slot, key });
      if (t === 'ru') {
        const cur = p.field[slot];
        if (cur) p.field[slot] = Object.assign({}, cur, { verb: null, aux: null });
        log(`「る」で終わる「${CARDS[key].word}」は捨て札に！ ${who(pi)}に15ダメージ`);
        damage(pi, 15, true);
        render();
        await sleep(500);
      }
    }
    return true;
  }
  async function setTrap(pi, hi, ts) {
    const p = G.p[pi];
    const key = p.hand[hi];
    if (CARDS[key].type !== 'trap' || p.traps[ts] || !pay(p, key)) return false;
    p.hand.splice(hi, 1);
    p.traps[ts] = key;
    log(`${who(pi)}がカードを1枚伏せた`);
    sfx.card();
    render();
    await sleep(pi === 1 ? 450 : 100);
    return true;
  }

  // 手札を1枚マナにする（1ターン1回）
  async function charge(pi, hi) {
    const p = G.p[pi];
    if (p.charged || hi < 0 || hi >= p.hand.length) return false;
    const key = p.hand.splice(hi, 1)[0];
    p.mana++;
    p.charged = true;
    log(`${who(pi)}が「${pi === 0 ? CARDS[key].word : '？'}」をマナにした（マナ${p.mana}）`);
    sfx.card();
    render();
    await sleep(pi === 1 ? 450 : 80);
    return true;
  }

  // 文を発動する。target: 'direct' / 相手のスロット番号 / null（回復・守り）
  async function activate(pi, slot, target) {
    const p = G.p[pi];
    const op = G.p[1 - pi];
    let s = p.field[slot];
    if (!s || s.used) return false;
    let ev = K.evaluate(s, rng);
    if (ev.act === 'attack' && !canAttack()) return false;
    G.busy = true;
    G.targeting = null;
    G.selSlot = null;
    render();
    await speak(pi, K.text(s), ev);
    let reflect = false;
    let zero = false;
    if (!ev.immune) {
      const t = await trapCheck(1 - pi, { type: 'activate', pi, slot, s, ev, attack: ev.act === 'attack', target });
      if (t === 'hunt') {
        log(`「${K.text(s)}」は言葉狩りにあって消えた！`);
        p.field[slot] = null;
        shake();
        sfx.hit();
        return done(pi);
      }
      if (t === 'mishear') {
        const vs = Object.keys(CARDS).filter((k) => CARDS[k].type === 'verb' && k !== s.verb);
        const nv = vs[Math.floor(rng() * vs.length)];
        s = Object.assign({}, s, { verb: nv });
        p.field[slot] = s;
        ev = K.evaluate(s, rng);
        log(`聞き間違えられて「${K.text(s)}」になった！`);
        render();
        await speak(pi, K.text(s), ev);
        target = pickAuto(pi, slot, ev, target);
      }
      if (t === 'nitpick') reflect = true;
      if (t === 'silence') zero = true;
    }
    // 効果
    const name = `「${K.text(s)}」`;
    if (ev.act === 'heal') {
      const before = p.hp;
      p.hp = Math.min(K.MAX_HP, p.hp + ev.value);
      log(`${who(pi)}の${name}で ${p.hp - before} 回復`);
      popup(pi, `+${p.hp - before}`, 'heal');
      sfx.heal();
      if (ev.draw) {
        const pl = G.p[pi];
        for (let d = 0; d < ev.draw && pl.deck.length && pl.hand.length < K.HAND_MAX; d++) pl.hand.push(pl.deck.pop());
        log(`元気が出て ${who(pi)}は1枚引いた`);
      }
      if (ev.extra) {
        log(`辛さのおすそわけ！${who(1 - pi)}に${ev.extra}ダメージ`);
        damage(1 - pi, ev.extra);
      }
    } else if (ev.act === 'buff') {
      const t = typeof target === 'number' ? p.field[target] : null;
      if (!t || target === slot) log(`${who(pi)}の${name}…強くする相手がいなかった`);
      else {
        t.bonus = (t.bonus || 0) + ev.value;
        log(`${who(pi)}の${name}で「${K.text(t)}」がパワーアップ！（+${ev.value}）`);
        flash(pi, target);
        sfx.heal();
      }
    } else if (ev.act === 'debuff') {
      const t = typeof target === 'number' ? op.field[target] : null;
      if (!t) log(`${who(pi)}の${name}…相手の言葉がなかった`);
      else {
        t.bonus = (t.bonus || 0) - ev.value;
        const left = K.evaluate(t).base + t.bonus;
        if (left <= 0) {
          log(`${who(pi)}の${name}で「${K.text(t)}」は力を失って消えた！`);
          op.field[target] = null;
          flash(1 - pi, target, true);
          sfx.hit();
        } else {
          if (ev.sleep) t.sleep = 1;
          log(`${who(pi)}の${name}で「${K.text(t)}」が弱った（-${ev.value}）${ev.sleep ? '　次のターンは動けない💤' : ''}`);
          flash(1 - pi, target);
          sfx.guard();
        }
      }
    } else if (ev.act === 'break') {
      const set = op.traps.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
      if (set.length) {
        const i = set[Math.floor(rng() * set.length)];
        log(`${who(pi)}の${name}！ 伏せカード「${CARDS[op.traps[i]].word}」を破壊した`);
        op.traps[i] = null;
        shake();
      } else if (op.hand.length) {
        const i = Math.floor(rng() * op.hand.length);
        const k = op.hand.splice(i, 1)[0];
        log(`${who(pi)}の${name}！ ${who(1 - pi)}の手札「${CARDS[k].word}」を捨てさせた`);
      } else log(`${who(pi)}の${name}…何も起きなかった`);
      sfx.hit();
    } else if (ev.act === 'guard') {
      p.shield += ev.value;
      log(`${who(pi)}の${name}で 守り+${ev.value}（次の自分のターンまで）`);
      popup(pi, `🛡+${ev.value}`, 'guard');
      sfx.guard();
    } else {
      let val = ev.value;
      if (zero) {
        log('沈黙は金…ダメージは0になった');
        val = 0;
      } else if (reflect) {
        const back = Math.ceil(val / 2);
        val -= back;
        log(`揚げ足を取られて ${back} ダメージがはね返った！`);
        damage(pi, back);
      }
      if (val > 0) {
        if (target === 'direct' || target === null) {
          log(`${who(pi)}の${name}！ ${who(1 - pi)}に直接 ${val} ダメージ`);
          damage(1 - pi, val);
        } else {
          const t = op.field[target];
          if (!t) {
            log(`${who(pi)}の${name}！ ${who(1 - pi)}に直接 ${val} ダメージ`);
            damage(1 - pi, val);
          } else {
            const d = K.defense(t);
            if (val > d) {
              log(`${who(pi)}の${name}が「${K.text(t)}」を破壊！${val - d > 0 ? `　つらぬいて ${val - d} ダメージ` : ''}`);
              op.field[target] = null;
              flash(1 - pi, target, true);
              if (val - d > 0) damage(1 - pi, val - d);
              else sfx.hit();
            } else {
              const back = d - val;
              log(`${who(pi)}の${name}は「${K.text(t)}」（守備${d}）にはじかれた${back > 0 ? `　反動で${back}ダメージ` : ''}`);
              sfx.guard();
              if (back > 0) damage(pi, back, true);
            }
          }
        }
      }
    }
    if (ev.selfDmg) {
      const v = s.verb && CARDS[s.verb];
      log(v && v.miss && ev.notes.includes('意味がよくわからない文…') ? `${v.miss}${s.aux === 'a_chau' ? '　さらに うっかりで15ダメージ' : ''}` : `うっかり！ ${who(pi)}も${ev.selfDmg}ダメージ`);
      damage(pi, ev.selfDmg, true);
    }
    if (ev.heal) {
      p.hp = Math.min(K.MAX_HP, p.hp + ev.heal);
      log(`たまごで ${who(pi)}が${ev.heal}回復`);
    }
    if (p.field[slot]) {
      if (ev.consume) {
        p.field[slot] = null;
      } else p.field[slot].used = true;
    }
    return done(pi);
  }
  function done(pi) {
    render();
    if (checkEnd()) return true;
    if (pi === 0) G.busy = false;
    render();
    return sleep(pi === 1 ? 500 : 50).then(() => true);
  }
  // 聞き間違いで効果が変わったときの対象
  function pickAuto(pi, slot, ev, prev) {
    const op = G.p[1 - pi];
    const me = G.p[pi];
    if (ev.target === 'own') {
      const i = me.field.findIndex((x, j) => x && j !== slot);
      return i < 0 ? null : i;
    }
    if (ev.target !== 'op') return null;
    if (typeof prev === 'number' && op.field[prev]) return prev;
    if (ev.act === 'attack' && (ev.slip || !op.field.some(Boolean))) return 'direct';
    const i = op.field.findIndex(Boolean);
    return i < 0 ? null : i;
  }
  function damage(pi, amount, pierce) {
    const p = G.p[pi];
    let a = amount;
    if (!pierce && p.shield > 0) {
      const g = Math.min(p.shield, a);
      p.shield -= g;
      a -= g;
      if (g) popup(pi, `🛡-${g}`, 'guard');
    }
    if (a > 0) {
      p.hp -= a;
      popup(pi, `-${a}`, 'dmg');
      sfx.hit();
      haptics.vibrate(pi === 0 ? 60 : 25);
      if (a >= 40) shake();
    }
  }
  function checkEnd() {
    if (G.over) return true;
    const d0 = G.p[0].hp <= 0;
    const d1 = G.p[1].hp <= 0;
    if (!d0 && !d1) return false;
    finish(d1 && !d0 ? 0 : 1);
    return true;
  }
  function finish(winner) {
    G.over = true;
    G.busy = true;
    render();
    const win = winner === 0;
    const rec = storage.get('koto.record', { win: 0, lose: 0 });
    win ? rec.win++ : rec.lose++;
    storage.set('koto.record', rec);
    $('result-head').textContent = win ? '勝ち！' : '負け…';
    $('result-head').className = 'result-head' + (win ? ' win' : '');
    $('result-sub').textContent = win ? '言葉の力で押し切った！' : '相手の言霊にやられた…';
    $('result-rec').textContent = `通算 ${rec.win}勝 ${rec.lose}敗`;
    win ? sfx.win() : sfx.lose();
    setTimeout(() => show('result'), 900);
  }

  // ---------- トラップ ----------
  function trapMatches(id, ev) {
    if (ev.type === 'verb') return id === 'ru' && CARDS[ev.key].word.endsWith('る');
    if (id === 'hunt') return true;
    if (id === 'mishear') return !!ev.s.verb;
    if (id === 'nitpick' || id === 'silence') return ev.attack;
    return false;
  }
  // 伏せカードの持ち主 owner が反応するか決めて、使ったトラップの id を返す
  async function trapCheck(owner, ev) {
    const p = G.p[owner];
    const opts = p.traps.map((k, ts) => (k ? { ts, id: CARDS[k].id } : null)).filter((o) => o && trapMatches(o.id, ev));
    if (!opts.length) return null;
    const pick = owner === 0 ? await askTrap(ev, opts) : AI.chooseTrap(G, owner, ev, opts);
    if (pick < 0) return null;
    const o = opts[pick];
    p.traps[o.ts] = null;
    log(`${who(owner)}のトラップ発動！「${CARDS['t_' + o.id].word}」`);
    render();
    await trapCutin(owner, CARDS['t_' + o.id]);
    return o.id;
  }
  function askTrap(ev, opts) {
    return new Promise((resolve) => {
      const el = $('trap-ask');
      const what = ev.type === 'verb' ? `相手が動詞「${CARDS[ev.key].word}」を出した！` : `相手が「${K.text(ev.s)}」を発動！（${ICON[ev.ev.act]}${ev.ev.value}）`;
      el.innerHTML = `<div class="ta-card"><p>${what}<br>伏せカードを発動する？</p>
        ${opts.map((o, i) => `<button class="btn btn-primary" data-i="${i}">${CARDS['t_' + o.id].word}<small>${CARDS['t_' + o.id].desc}</small></button>`).join('')}
        <button class="btn btn-ghost" data-i="-1">発動しない</button></div>`;
      el.classList.remove('hidden');
      sfx.trap();
      el.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        el.classList.add('hidden');
        el.onclick = null;
        resolve(+b.dataset.i);
      };
    });
  }

  // ---------- 演出 ----------
  let cutDone = null;
  function cut(html, cls, ms) {
    const el = $('cutin');
    el.innerHTML = html;
    el.className = 'cutin ' + cls;
    void el.offsetWidth;
    el.classList.add('show');
    return new Promise((resolve) => {
      const t = setTimeout(fin, FAST ? 0 : ms);
      function fin() {
        clearTimeout(t);
        el.className = 'cutin hidden';
        cutDone = null;
        resolve();
      }
      cutDone = fin;
    });
  }
  $('cutin').addEventListener('click', () => cutDone && cutDone());
  function speak(pi, text, ev) {
    sfx.speak();
    const note = ev.notes.length ? `<div class="ci-notes">${ev.notes.join('　')}</div>` : '';
    return cut(
      `<div class="ci-band"><div class="ci-kicker">${pi === 0 ? 'あなたの言霊' : '相手の言霊'}</div><div class="ci-title">「${text}」</div>
       <div class="ci-val act-${ev.act}">${ICON[ev.act]} ${K.ACT[ev.act]}${ev.act === 'break' ? '' : ' ' + ev.value}</div>${note}</div>`,
      pi === 0 ? 'me' : 'op',
      pi === 0 ? 1100 : 1400
    );
  }
  function trapCutin(owner, c) {
    sfx.trap();
    shake();
    return cut(`<div class="ci-burst"></div><div class="ci-band"><div class="ci-kicker">${owner === 0 ? 'あなたの' : '相手の'}トラップ発動！</div><div class="ci-title trap">${c.word}</div><div class="ci-notes">${c.desc}</div></div>`, 'trap ' + (owner === 0 ? 'me' : 'op'), 1500);
  }
  function shake() {
    const a = $('app');
    a.classList.remove('shake');
    void a.offsetWidth;
    a.classList.add('shake');
  }
  function popup(pi, text, kind) {
    const host = $(pi === 0 ? 'me-bar' : 'op-bar');
    const d = document.createElement('div');
    d.className = 'pop ' + kind;
    d.textContent = text;
    host.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }
  const flashes = [];
  function flash(pi, slot, broken) {
    flashes.push({ pi, slot, cls: broken ? 'broke' : 'pulse' });
  }
  let banT = 0;
  function banner(text, pi) {
    const el = $('banner');
    el.textContent = text;
    el.className = 'banner show ' + (pi === 0 ? 'me' : 'op');
    clearTimeout(banT);
    banT = setTimeout(() => (el.className = 'banner'), 1100);
  }

  // ---------- 描画 ----------
  function sentenceHTML(s, opts) {
    const ev = K.evaluate(s);
    const pcs = K.pieces(s)
      .map((x) => `<span class="w-${x.t}">${x.w}</span>`)
      .join('');
    const prev = opts && opts.preview ? `<div class="prev">→ ${ICON[opts.preview.act]}${opts.preview.value}</div>` : '';
    return `<div class="sent act-${ev.act}${s.used ? ' used' : ''}">
      <div class="sw">${pcs}</div>
      <div class="stag">${K.ACT[ev.act]}・${ev.consume ? '1回きり' : '場に残る'}</div>
      <div class="sbot"><span class="sv">${ICON[ev.act]}${ev.act === 'break' ? '妨害' : ev.value}</span><span class="sd">守${K.defense(s)}</span></div>${prev}
      ${s.bonus ? `<div class="bonus ${s.bonus > 0 ? 'up' : 'down'}">${s.bonus > 0 ? '+' : ''}${s.bonus}</div>` : ''}
      ${s.sleep ? '<div class="zz">💤</div>' : ''}
      ${s.used ? `<div class="used-tag">${s.napping ? 'おやすみ中💤' : '発動ずみ'}</div>` : ''}</div>`;
  }
  // トランプ風のカードの表面
  function statText(key) {
    const c = CARDS[key];
    if (c.type === 'noun') {
      const ev = K.evaluate(K.newSentence(key));
      return `${ICON[ev.act]}${c.power}`;
    }
    if (c.type === 'verb') return `${ICON[c.act]}${K.ACT[c.act]}`;
    if (c.type === 'part') return c.any ? `×${c.any}` : '×1.5';
    if (c.type === 'aux') return `×${c.mult}`;
    return '伏せる';
  }
  function cardFace(key, cls) {
    const c = CARDS[key];
    const len = c.word.length;
    const sz = len >= 6 ? ' xlong' : len >= 4 ? ' long' : '';
    const sub = c.type === 'noun' ? c.kinds.map((k) => K.KIND[k]).join('・') : K.TYPE_NAME[c.type];
    return `<div class="cf t-${c.type}${sz} ${cls || ''}">
      <div class="cn tl"><b>${c.cost}</b><i>${K.SUIT[c.type]}</i></div>
      <div class="cn br"><b>${c.cost}</b><i>${K.SUIT[c.type]}</i></div>
      <div class="cw">${c.word}</div>
      <div class="cs">${statText(key)}</div>
      <div class="ct">${sub}</div></div>`;
  }
  function barHTML(pi) {
    const p = G.p[pi];
    const pct = Math.max(0, (p.hp / K.MAX_HP) * 100);
    return `<div class="hp"><div class="hp-fill${pct < 30 ? ' low' : ''}" style="width:${pct}%"></div><span>HP ${Math.max(0, p.hp)}</span></div>
      ${p.shield ? `<span class="chip">🛡${p.shield}</span>` : ''}
      <span class="chip mana${p.charged ? ' done' : ''}" title="マナ">💧${free(p)}/${p.mana}</span>
      <span class="chip">山${p.deck.length}</span>${pi === 1 ? `<span class="chip">手${p.hand.length}</span>` : ''}`;
  }

  // 手札で選んだカードを置ける場所
  function validTargets() {
    const out = { slots: new Map(), traps: new Set() };
    if (!G.sel) return out;
    const p = G.p[0];
    const key = p.hand[G.sel.hand];
    const c = CARDS[key];
    if (free(p) < c.cost) return out;
    if (c.type === 'noun') {
      p.field.forEach((s, i) => !s && out.slots.set(i, null));
    } else if (c.type === 'trap') p.traps.forEach((t, i) => !t && out.traps.add(i));
    else p.field.forEach((s, i) => s && K.canAttach(s, key) && out.slots.set(i, K.evaluate(K.attach(s, key))));
    return out;
  }

  function render() {
    if (!G) return;
    const me = G.p[0];
    const op = G.p[1];
    $('op-bar-in').innerHTML = barHTML(1);
    $('me-bar-in').innerHTML = barHTML(0);
    const vt = myTurn() ? validTargets() : { slots: new Map(), traps: new Set() };
    // 相手の伏せカード・言葉
    $('op-traps').innerHTML = op.traps.map((t) => `<div class="tslot${t ? ' set' : ''}">${t ? '<span>伏</span>' : ''}</div>`).join('');
    $('op-field').innerHTML = op.field
      .map((s, i) => {
        const tg = G.targeting !== null && G.tmode === 'op' && s ? ' target' : '';
        return `<div class="slot${s ? '' : ' empty'}${tg}" data-op="${i}">${s ? sentenceHTML(s) : ''}</div>`;
      })
      .join('');
    $('me-field').innerHTML = me.field
      .map((s, i) => {
        const can = vt.slots.has(i) || (G.targeting !== null && G.tmode === 'own' && s && i !== G.targeting);
        const cls = (s ? '' : ' empty') + (can ? ' target' : '') + (G.selSlot === i || G.targeting === i ? ' chosen' : '');
        const inner = s ? sentenceHTML(s, { preview: vt.slots.get(i) }) : can ? '<span class="put">ここに出す</span>' : '';
        return `<div class="slot${cls}" data-me="${i}">${inner}</div>`;
      })
      .join('');
    $('me-traps').innerHTML = me.traps
      .map((t, i) => `<div class="tslot mine${t ? ' set' : ''}${vt.traps.has(i) ? ' target' : ''}" data-trap="${i}">${t ? `<span>${CARDS[t].word}</span>` : vt.traps.has(i) ? '<span>伏せる</span>' : ''}</div>`)
      .join('');
    for (const f of flashes.splice(0)) {
      const el = $(f.pi === 0 ? 'me-field' : 'op-field').children[f.slot];
      if (el) el.classList.add(f.cls);
    }
    renderHand();
    $('log').innerHTML = G.log.slice(0, 2).map((l) => `<div>${l}</div>`).join('') || '<div>&nbsp;</div>';
    $('btn-end').disabled = !myTurn();
    renderInfo();
  }

  // ---------- 手札（手に持った扇形） ----------
  function renderHand() {
    const me = G.p[0];
    const n = me.hand.length;
    if (G.hsel >= n) G.hsel = Math.max(0, n - 1);
    const step = 13; // 1枚ごとの角度
    $('fan').innerHTML = me.hand
      .map((k, i) => {
        const d = i - G.hsel;
        const far = Math.abs(d);
        const ok = myTurn() && free(me) >= CARDS[k].cost;
        const st = `transform: rotate(${d * step}deg) translateY(${d === 0 ? -16 : far * 4}px); z-index:${50 - far}; opacity:${far > 4 ? 0 : 1}`;
        return `<div class="hc${d === 0 ? ' sel' : ''}${ok ? '' : ' cant'}" data-hand="${i}" style="${st}">${cardFace(k)}</div>`;
      })
      .join('');
    $('hand-count').textContent = n ? `${G.hsel + 1} / ${n}` : '手札なし';
    renderDetail();
  }
  function renderDetail() {
    const el = $('detail');
    const me = G.p[0];
    const key = me.hand[G.hsel];
    if (!G.detail || !key || G.over) return el.classList.add('hidden');
    const c = CARDS[key];
    const reason = whyCant(key);
    el.classList.remove('hidden');
    el.innerHTML = `<div class="dt-card" data-play>${cardFace(key, 'big')}</div>
      <div class="dt-text"><b class="t-${c.type}-c">【${K.TYPE_NAME[c.type]}】${c.word}</b>　コスト${c.cost}<br>${K.describe(key)}</div>
      <div class="dt-hint">${reason ? `<span class="warn">${reason}</span>` : 'もう一度タップで場に出す'}</div>
      <div class="dt-row"><button class="mini-btn" data-charge ${!myTurn() || me.charged ? 'disabled' : ''}>💧マナにする${me.charged ? '（済）' : ''}</button><button class="mini-btn" data-close-detail>とじる</button></div>`;
  }
  // このカードを今出せない理由（出せるなら ''）
  function whyCant(key) {
    const me = G.p[0];
    const c = CARDS[key];
    if (!myTurn()) return '自分のターンに出せます';
    if (free(me) < c.cost) return `マナが足りない（コスト${c.cost}・残り${free(me)}）。手札をマナにしよう`;
    if (c.type === 'noun' && !me.field.includes(null)) return '場がいっぱい（3つまで）';
    if (c.type === 'trap' && !me.traps.includes(null)) return '伏せる場所がいっぱい';
    if (c.type === 'part' && !me.field.some((x) => x && K.canAttach(x, key))) return '動詞を重ねる前の名詞にだけ付けられる';
    if (c.type === 'verb' && !me.field.some((x) => x && K.canAttach(x, key))) return '動詞のない名詞が場にない';
    if (c.type === 'aux' && !me.field.some((x) => x && K.canAttach(x, key))) return '動詞のある文にだけ付けられる';
    return '';
  }
  // 選んでいる手札を場に出す
  async function playSelected() {
    const me = G.p[0];
    const hi = G.hsel;
    const key = me.hand[hi];
    if (!key || !myTurn()) return;
    const reason = whyCant(key);
    if (reason) {
      G.detail = true;
      sfx.tap();
      return render();
    }
    const c = CARDS[key];
    G.detail = false;
    G.busy = true;
    if (c.type === 'noun') await playNoun(0, hi, me.field.indexOf(null));
    else if (c.type === 'trap') await setTrap(0, hi, me.traps.indexOf(null));
    else {
      const ok = me.field.map((x, i) => (x && K.canAttach(x, key) ? i : -1)).filter((i) => i >= 0);
      if (ok.length === 1) await attachCard(0, hi, ok[0]);
      else {
        // 重ねる先が2つ以上: 光っている文をタップで選ぶ
        G.sel = { hand: hi };
        G.busy = false;
        sfx.tap();
        return render();
      }
    }
    if (!checkEnd()) G.busy = false;
    render();
  }

  function renderInfo() {
    const el = $('info');
    const me = G.p[0];
    if (G.over) return (el.innerHTML = '');
    if (G.turn !== 0 || G.busy) return (el.innerHTML = '<p class="hint">相手のターン…</p>');
    if (G.targeting !== null) {
      const s = me.field[G.targeting];
      const ev = K.evaluate(s);
      const op = G.p[1];
      const direct = ev.act === 'attack' && (ev.slip || !op.field.some(Boolean));
      const how = {
        attack: '攻撃する相手の言葉をタップ',
        buff: '強くする自分の文をタップ',
        debuff: `弱らせる相手の文をタップ${ev.sleep ? '（次のターン眠らせる）' : ''}`,
      }[ev.act];
      el.innerHTML = `<div class="info-row"><p class="hint"><b>「${K.text(s)}」${ICON[ev.act]}${ev.value}</b> ${how}</p>
        ${direct ? '<button class="mini-btn primary" data-direct>直接攻撃</button>' : ''}<button class="mini-btn" data-cancel>やめる</button></div>`;
      return;
    }
    if (G.sel) {
      const key = me.hand[G.sel.hand];
      el.innerHTML = `<div class="info-row"><p class="hint"><b class="t-${CARDS[key].type}-c">${CARDS[key].word}</b> を重ねる文をタップ</p><button class="mini-btn" data-cancel>やめる</button></div>`;
      return;
    }
    if (G.selSlot !== null && me.field[G.selSlot]) {
      const s = me.field[G.selSlot];
      const ev = K.evaluate(s);
      const no = s.used
        ? s.napping
          ? '眠っていて動けない'
          : 'このターンは発動ずみ'
        : ev.act === 'attack' && !canAttack()
          ? '先攻1ターン目は攻撃できない'
          : ev.act === 'buff' && !me.field.some((x, j) => x && j !== G.selSlot)
            ? '強くする自分の文がない'
            : ev.act === 'debuff' && !G.p[1].field.some(Boolean)
              ? '相手の場に言葉がない'
              : '';
      el.innerHTML = `<div class="info-row"><p class="hint"><b>「${K.text(s)}」</b> ${ICON[ev.act]}${K.ACT[ev.act]}${ev.act === 'break' ? '' : ev.value}・${ev.consume ? '1回きり' : '場に残る'}<br><span class="sub">${no || ev.notes.join('・') || K.ACT_DESC[ev.act]}</span></p>
        <button class="mini-btn primary" data-activate ${no ? 'disabled' : ''}>発動！</button><button class="mini-btn" data-cancel>✕</button></div>`;
      return;
    }
    el.innerHTML = `<p class="hint">手札を左右にふって選ぶ → タップで詳しく → もう一度で出す<br><span class="sub">場の言葉はタップで発動。毎ターン1枚マナにできる💧</span></p>`;
  }

  // ---------- 手札の操作: 左右にふって選ぶ・タップで詳細・もう一度で出す ----------
  (function handGestures() {
    const el = $('hand');
    let sx = 0;
    let lx = 0;
    let moved = false;
    let down = false;
    const STEP = 30;
    el.addEventListener('pointerdown', (e) => {
      if (!G || G.over) return;
      down = true;
      moved = false;
      sx = lx = e.clientX;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - lx;
      if (Math.abs(e.clientX - sx) > 8) moved = true;
      if (Math.abs(dx) < STEP) return;
      const n = G.p[0].hand.length;
      const next = Math.max(0, Math.min(n - 1, G.hsel + (dx > 0 ? -1 : 1))); // 扇を指でなでて回す
      lx = e.clientX;
      if (next !== G.hsel) {
        G.hsel = next;
        G.detail = false;
        audio.tone(900, 0.025, { type: 'square', vol: 0.04 });
        renderHand();
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      down = false;
      if (moved) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const card = hit && hit.closest('[data-hand]');
      if (G.sel) G.sel = null;
      if (card && +card.dataset.hand !== G.hsel) {
        G.hsel = +card.dataset.hand;
        G.detail = false;
        sfx.tap();
        return render();
      }
      if (!G.detail) {
        G.detail = true;
        sfx.tap();
        return render();
      }
      playSelected();
    });
    el.addEventListener('pointercancel', () => (down = false));
  })();
  $('detail').addEventListener('click', async (e) => {
    if (e.target.closest('[data-close-detail]')) {
      G.detail = false;
      return render();
    }
    if (e.target.closest('[data-charge]')) {
      if (!myTurn()) return;
      G.detail = false;
      await charge(0, G.hsel);
      return render();
    }
    if (e.target.closest('[data-play]')) return playSelected();
    if (e.target === $('detail')) {
      G.detail = false;
      render();
    }
  });
  $('me-field').addEventListener('click', async (e) => {
    const d = e.target.closest('[data-me]');
    if (!d || !myTurn()) return;
    const i = +d.dataset.me;
    const p = G.p[0];
    if (G.sel) {
      const key = p.hand[G.sel.hand];
      const hi = G.sel.hand;
      if (p.field[i] && K.canAttach(p.field[i], key)) {
        G.sel = null;
        G.busy = true;
        await attachCard(0, hi, i);
        if (!checkEnd()) G.busy = false;
        return render();
      }
    }
    if (G.targeting !== null && G.tmode === 'own' && p.field[i] && i !== G.targeting) return activate(0, G.targeting, i);
    G.sel = null;
    G.targeting = null;
    G.detail = false;
    G.selSlot = p.field[i] && G.selSlot !== i ? i : null;
    if (G.selSlot !== null) sfx.tap();
    render();
  });
  $('op-field').addEventListener('click', (e) => {
    const d = e.target.closest('[data-op]');
    if (!d || !myTurn() || G.targeting === null || G.tmode !== 'op') return;
    const i = +d.dataset.op;
    if (!G.p[1].field[i]) return;
    activate(0, G.targeting, i);
  });
  $('info').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !myTurn()) return;
    if (b.dataset.cancel !== undefined) {
      G.targeting = null;
      G.selSlot = null;
      G.sel = null;
      return render();
    }
    if (b.dataset.direct !== undefined) return activate(0, G.targeting, 'direct');
    if (b.dataset.activate !== undefined) {
      const slot = G.selSlot;
      const s = G.p[0].field[slot];
      const ev = K.evaluate(s);
      if (!ev.target) return activate(0, slot, null);
      if (ev.act === 'attack' && !G.p[1].field.some(Boolean)) return activate(0, slot, 'direct');
      G.targeting = slot;
      G.tmode = ev.target;
      G.selSlot = null;
      sfx.tap();
      render();
    }
  });
  $('btn-end').addEventListener('click', endTurn);

  // ---------- 画面 ----------
  function show(name) {
    for (const s of ['title', 'howto', 'result', 'build']) $('screen-' + s).classList.toggle('hidden', s !== name);
  }
  function renderDecks() {
    const mineOk = !K.checkDeck(myDeck).length;
    const items = Object.keys(K.DECKS).map((k) => ({ k, icon: K.DECKS[k].icon, name: K.DECKS[k].name.replace('デッキ', ''), desc: K.DECKS[k].desc }));
    items.push({ k: 'mine', icon: '📝', name: 'マイデッキ', desc: mineOk ? '自分で組んだ30枚' : `未完成（${myDeck.length}/30）`, off: !mineOk });
    $('decks').innerHTML = items
      .map((d) => `<button class="deck${d.k === deckChoice ? ' on' : ''}${d.off ? ' off' : ''}" data-deck="${d.k}" type="button" ${d.off ? 'disabled' : ''}><span class="di">${d.icon}</span><b>${d.name}</b><small>${d.desc}</small></button>`)
      .join('');
  }
  $('decks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-deck]');
    if (!b || b.disabled) return;
    deckChoice = b.dataset.deck;
    storage.set('koto.deck', deckChoice);
    sfx.tap();
    renderDecks();
  });
  $('btn-start').addEventListener('click', () => {
    audio.unlock();
    show(null);
    newGame();
  });
  $('btn-again').addEventListener('click', () => {
    renderDecks();
    show('title');
  });
  $('btn-howto').addEventListener('click', () => show('howto'));
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => {
      renderDecks();
      show('title');
    })
  );
  function soundLabel() {
    $('btn-sound').textContent = audio.muted ? '🔇 サウンド OFF' : '🔊 サウンド ON';
  }
  $('btn-sound').addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    soundLabel();
  });

  // ---------- デッキ構築 ----------
  let building = [];
  let bFilter = 'all';
  const POOL = Object.keys(CARDS).sort((a, b) => {
    const order = { noun: 0, verb: 1, part: 2, aux: 3, trap: 4 };
    return order[CARDS[a].type] - order[CARDS[b].type] || CARDS[a].cost - CARDS[b].cost;
  });
  function openBuilder() {
    building = myDeck.slice();
    bFilter = 'all';
    show('build');
    renderBuilder();
  }
  function renderBuilder() {
    const cnt = {};
    for (const k of building) cnt[k] = (cnt[k] || 0) + 1;
    const types = {};
    const curve = [0, 0, 0, 0, 0];
    for (const k of building) {
      types[CARDS[k].type] = (types[CARDS[k].type] || 0) + 1;
      curve[Math.min(4, CARDS[k].cost)]++;
    }
    const max = Math.max(1, ...curve);
    const errs = K.checkDeck(building);
    $('b-count').textContent = `${building.length} / ${K.DECK_SIZE}`;
    $('b-count').className = 'b-count' + (building.length === K.DECK_SIZE ? ' ok' : '');
    $('b-summary').innerHTML =
      `<div class="curve">${curve.map((v, i) => `<div><i style="height:${(v / max) * 100}%"></i><span>${i}${i === 4 ? '+' : ''}</span></div>`).join('')}</div>` +
      `<div class="btypes">${['noun', 'verb', 'part', 'aux', 'trap'].map((t) => `<span class="t-${t}-c">${K.SUIT[t]}${K.TYPE_NAME[t]} ${types[t] || 0}</span>`).join('')}</div>`;
    $('b-filter').innerHTML = [['all', '全部'], ['noun', '名詞'], ['verb', '動詞'], ['part', '助詞'], ['aux', '助動詞'], ['trap', 'トラップ']]
      .map(([k, n]) => `<button class="chipbtn${bFilter === k ? ' on' : ''}" data-f="${k}" type="button">${n}</button>`)
      .join('');
    $('b-list').innerHTML = POOL.filter((k) => bFilter === 'all' || CARDS[k].type === bFilter)
      .map((k) => {
        const c = CARDS[k];
        const n = cnt[k] || 0;
        const lim = K.maxCopies(k);
        return `<div class="brow${n ? ' has' : ''}">${cardFace(k, 'mini')}
          <div class="bdesc"><b>${c.word}</b>${K.LIMITED[k] ? '<em>制限</em>' : ''}<small>${K.describe(k)}</small></div>
          <div class="bctl"><button data-minus="${k}" ${n ? '' : 'disabled'} type="button">−</button><span>${n}/${lim}</span><button data-plus="${k}" ${n >= lim || building.length >= K.DECK_SIZE ? 'disabled' : ''} type="button">＋</button></div></div>`;
      })
      .join('');
    $('b-save').disabled = !!errs.length;
    $('b-msg').textContent = errs.length ? errs[0] : 'このデッキで戦えます！';
    $('b-msg').className = 'b-msg' + (errs.length ? '' : ' ok');
  }
  $('screen-build').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.f) bFilter = b.dataset.f;
    else if (b.dataset.plus) building.push(b.dataset.plus);
    else if (b.dataset.minus) building.splice(building.lastIndexOf(b.dataset.minus), 1);
    else if (b.dataset.preset) building = K.DECKS[b.dataset.preset].cards.slice();
    else if (b.dataset.clear !== undefined) building = [];
    else if (b.id === 'b-save') {
      myDeck = building.slice();
      storage.set('koto.mydeck', myDeck);
      deckChoice = 'mine';
      storage.set('koto.deck', deckChoice);
      sfx.win();
      renderDecks();
      return show('title');
    } else if (b.id === 'b-back') {
      renderDecks();
      return show('title');
    } else return;
    sfx.tap();
    const y = $('b-list').scrollTop;
    renderBuilder();
    $('b-list').scrollTop = y;
  });
  $('btn-build').addEventListener('click', openBuilder);

  const api = { playNoun, attachCard, setTrap, activate, canAttack, charge };
  renderDecks();
  soundLabel();
  // タイトルの後ろに場を見せておく
  G = { p: [newPlayer('food'), newPlayer('animal')], turn: 0, turnNo: 0, over: true, busy: true, sel: null, selSlot: null, targeting: null, hsel: 0, detail: false, log: [] };
  for (let i = 0; i < 5; i++) G.p[0].hand.push(G.p[0].deck.pop());
  G.hsel = 2;
  render();
  window.KotoDebug = { get G() { return G; }, api };
})();
