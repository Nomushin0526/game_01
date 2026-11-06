// 成り上がれ！歩兵 ― 画面と進行
(function () {
  'use strict';
  const Fu = window.Fu;
  const Eco = window.FuEco;
  const AI = window.FuAI;
  const { audio, haptics } = window.GameShared;
  const { N, PARTS, UPGRADES, MAX_FUSE } = Fu;
  const $ = (id) => document.getElementById(id);
  const rng = Math.random;
  const yen = (v) => '¥' + Math.round(v).toLocaleString();

  const sfx = {
    tap: () => audio.tone(700, 0.04, { type: 'square', vol: 0.06 }),
    move: () => audio.noise(0.06, { vol: 0.25, cutoff: 1200 }),
    capture: () => {
      audio.noise(0.12, { vol: 0.35, cutoff: 900 });
      audio.tone(300, 0.15, { type: 'square', vol: 0.08, to: 160 });
    },
    coin: () => [988, 1319].forEach((f, i) => audio.tone(f, 0.08, { type: 'square', vol: 0.07, delay: i * 0.05 })),
    fuse: () => [523, 784, 1047, 1568].forEach((f, i) => audio.tone(f, 0.12, { type: 'triangle', vol: 0.12, delay: i * 0.06 })),
    check: () => audio.tone(1200, 0.2, { type: 'sawtooth', vol: 0.08, to: 600 }),
    win: () => [523, 659, 784, 1047].forEach((f, i) => audio.tone(f, 0.18, { type: 'triangle', vol: 0.18, delay: i * 0.12 })),
    lose: () => [392, 330, 262].forEach((f, i) => audio.tone(f, 0.22, { type: 'triangle', vol: 0.16, delay: i * 0.18 })),
  };

  let G = null;
  let tab = 'shop';

  // ---------- 進行 ----------
  function newGame() {
    G = { st: Fu.initialState(), players: [Eco.newPlayer(), Eco.newPlayer()], market: Eco.newMarket(), sel: null, drop: false, last: null, log: [], over: false, busy: false };
    for (const pl of G.players) Eco.rollLineup(pl, rng);
    log('対局開始！あなたの手番です（先手）');
    render();
  }
  function log(msg) {
    G.log.unshift(msg);
    G.log.length = Math.min(G.log.length, 6);
  }
  function startTurn(owner) {
    const pl = G.players[owner];
    pl.money += Eco.INCOME;
    pl.trades = Eco.TRADES_PER_TURN;
  }
  const myTurn = () => G && !G.over && !G.busy && G.st.turn === 0;

  function doMove(m) {
    const mover = G.st.turn;
    const who = mover === 0 ? 'あなた' : '相手';
    const res = Fu.applyMove(G.st, m, (fused) => fused[Math.floor(rng() * fused.length)]);
    const ev = res.ev;
    const pl = G.players[mover];
    if (ev.bounced) log(`${who}の攻撃を鉄の鎧がはじいた！`);
    if (ev.captured && ev.captured.t === 'P') {
      pl.money += Eco.CAPTURE_REWARD;
      let msg = `${who}が「${Fu.pawnName(ev.captured)}」を取った（+${yen(Eco.CAPTURE_REWARD)}・持ち歩+1）`;
      if (ev.loot) {
        pl.parts[ev.loot]++;
        msg += `　合成されていた${PARTS[ev.loot].name}を奪った！`;
      }
      log(msg);
    }
    if (ev.promoted) log(`${who}の歩が「と」に成った！（金の動きが加わる）`);
    G.st = res.st;
    G.last = m;
    G.sel = null;
    G.drop = false;
    if (ev.captured || ev.bounced) {
      sfx.capture();
      haptics.vibrate(30);
    } else sfx.move();
    // 相場は手番ごとに動く
    Eco.tick(G.market, rng);
    if (G.market.news) log(`📰 ${G.market.news.text}（${Eco.COMMODITIES[G.market.news.k].name}${G.market.news.dir > 0 ? '急騰' : '急落'}）`);
    // 詰み判定
    const side = G.st.turn;
    if (!Fu.legalMoves(G.st, side).length) return finish(mover);
    if (Fu.inCheck(G.st, side)) {
      log(side === 0 ? '⚠ 王手をかけられた！' : '王手！');
      sfx.check();
    }
    if (side === 1) {
      G.busy = true;
      render();
      setTimeout(aiTurn, 550);
    } else {
      startTurn(0);
      render();
    }
  }

  function aiTurn() {
    startTurn(1);
    for (const msg of AI.economy(G, rng)) log('相手：' + msg);
    render();
    setTimeout(() => {
      const m = AI.chooseMove(G.st);
      G.busy = false;
      if (!m) return finish(0);
      doMove(m);
    }, 450);
  }

  function finish(winner) {
    G.over = true;
    G.busy = false;
    render();
    const win = winner === 0;
    $('result-head').textContent = win ? '勝ち！' : '負け…';
    $('result-head').className = 'result-head' + (win ? ' win' : '');
    $('result-sub').textContent = win ? '相手の王を詰ませた！歩、成り上がり！' : 'あなたの王が詰まされた…';
    win ? sfx.win() : sfx.lose();
    setTimeout(() => show('result'), 600);
  }

  // ---------- 盤の操作 ----------
  function onSquare(x, y) {
    if (!myTurn()) return;
    const p = G.st.board[y][x];
    if (G.drop) {
      const m = Fu.legalMoves(G.st, 0).find((mm) => mm.drop && mm.tx === x && mm.ty === y);
      if (m) return doMove(m);
      G.drop = false;
      return render();
    }
    if (G.sel) {
      const m = G.selMoves.find((mm) => mm.tx === x && mm.ty === y);
      if (m) return doMove(m);
    }
    if (p && p.owner === 0) {
      if (G.sel && G.sel.x === x && G.sel.y === y) G.sel = null;
      else {
        G.sel = { x, y };
        G.selMoves = Fu.legalMoves(G.st, 0).filter((mm) => !mm.drop && mm.fx === x && mm.fy === y);
        sfx.tap();
      }
    } else G.sel = null;
    render();
  }

  // ---------- 描画 ----------
  function buildBoard() {
    const b = $('board');
    b.innerHTML = '';
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const d = document.createElement('div');
        d.className = 'sq' + (y <= 2 ? ' zone-op' : '');
        d.dataset.x = x;
        d.dataset.y = y;
        b.appendChild(d);
      }
    b.addEventListener('click', (e) => {
      const sq = e.target.closest('.sq');
      if (sq) onSquare(+sq.dataset.x, +sq.dataset.y);
    });
  }
  function pieceHTML(p) {
    if (p.t === 'K') return `<div class="pc${p.owner ? ' op' : ''}"><span>${p.owner ? '玉' : '王'}</span></div>`;
    const sup = p.fused.length || p.ups.leg || p.ups.side || p.ups.back;
    const head = p.fused.map((f) => PARTS[f].short).join('');
    const badges = [];
    if (p.ups.leg) badges.push(`<i>脚${p.ups.leg}</i>`);
    if (p.ups.side) badges.push('<i>横</i>');
    if (p.ups.back) badges.push('<i>後</i>');
    if (p.ups.armor) badges.push(`<i class="ar">鎧${p.ups.armor}</i>`);
    const main = p.promo ? 'と' : '歩';
    return (
      `<div class="pc${p.owner ? ' op' : ''}${p.promo ? ' promo' : ''}${sup ? ' super' : ''}">` +
      (head ? `<span class="nm">${head}</span><span class="main">${main}</span>` : `<span>${main}</span>`) +
      `</div>` +
      (badges.length ? `<div class="badges${p.owner ? ' op' : ''}">${badges.join('')}</div>` : '')
    );
  }
  function statsHTML(owner) {
    const pl = G.players[owner];
    const parts = Fu.PART_KEYS.filter((k) => k !== 'G' && k !== 'S' && pl.parts[k] > 0)
      .map((k) => `${PARTS[k].short}${pl.parts[k]}`)
      .join(' ');
    return (
      `<span class="money">${yen(pl.money)}</span>` +
      `<span class="chip-mini">🥇金${pl.parts.G}</span><span class="chip-mini">🥈銀${pl.parts.S}</span>` +
      (owner === 1 ? `<span class="chip-mini">持ち歩${G.st.hands[1]}</span>` : '') +
      (parts ? `<span class="chip-mini">${parts}</span>` : '')
    );
  }
  function render() {
    if (!G) return;
    const st = G.st;
    const sqs = $('board').children;
    const checkK = !G.over && Fu.inCheck(st, st.turn) ? Fu.findKing(st, st.turn) : null;
    const can = new Map();
    if (G.sel) for (const m of G.selMoves) can.set(m.ty * N + m.tx, !!m.cap);
    if (G.drop) for (const m of Fu.legalMoves(st, 0)) if (m.drop) can.set(m.ty * N + m.tx, false);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const d = sqs[y * N + x];
        const p = st.board[y][x];
        d.innerHTML = p ? pieceHTML(p) : '';
        const i = y * N + x;
        d.classList.toggle('sel', !!(G.sel && G.sel.x === x && G.sel.y === y));
        d.classList.toggle('last', !!(G.last && G.last.tx === x && G.last.ty === y));
        d.classList.toggle('check', !!(checkK && checkK[0] === x && checkK[1] === y));
        d.classList.toggle('can', can.has(i));
        d.classList.toggle('capture', can.get(i) === true);
      }
    $('op-stats').innerHTML = statsHTML(1);
    $('me-stats').innerHTML = statsHTML(0);
    $('hand-n').textContent = st.hands[0];
    $('btn-hand').disabled = !myTurn() || st.hands[0] === 0;
    $('btn-hand').classList.toggle('on', G.drop);
    $('log').innerHTML = G.log.slice(0, 2).map((l) => `<div>${l}</div>`).join('') || '<div>&nbsp;</div>';
    renderTab();
  }

  function renderTab() {
    for (const t of ['shop', 'market', 'forge']) {
      $('tab-' + t).classList.toggle('hidden', t !== tab);
      document.querySelector(`.tab[data-tab="${t}"]`).classList.toggle('on', t === tab);
    }
    if (tab === 'shop') renderShop();
    else if (tab === 'market') renderMarket();
    else renderForge();
  }

  function renderShop() {
    const pl = G.players[0];
    const can = myTurn();
    const cards = pl.lineup
      .map((it, i) => {
        const lb = Eco.itemLabel(it.key);
        const isUp = Eco.SHOP_ITEMS[it.key].kind !== 'part';
        return `<div class="item"><div class="ic${isUp ? ' up' : ''}">${lb.short}</div><h4>${lb.title}</h4><p>${lb.desc}</p>
          <button class="mini-btn primary" data-buy="${i}" ${!can || pl.money < it.price ? 'disabled' : ''}>${yen(it.price)}</button></div>`;
      })
      .join('');
    $('tab-shop').innerHTML = `<p class="hint">買うたびに品ぞろえが入れ替わります。買った駒・強化は「強化・合成」タブで歩に使えます。</p>
      <div class="shop">${cards}</div>
      <div class="row-between"><span>所持金 ${yen(pl.money)}</span>
      <button class="mini-btn" data-reroll ${!can || pl.money < Eco.REROLL_COST ? 'disabled' : ''}>品ぞろえを変える ${yen(Eco.REROLL_COST)}</button></div>`;
  }

  function renderMarket() {
    const pl = G.players[0];
    const op = G.players[1];
    const m = G.market;
    const can = myTurn();
    let html = m.news ? `<div class="news">📰 ${m.news.text}</div>` : '';
    html += '<div class="mkt-wrap">';
    for (const k of ['G', 'S']) {
      const c = Eco.COMMODITIES[k];
      const h = m[k].hist;
      const prev = h[h.length - 2];
      const chg = ((m[k].price - prev) / prev) * 100;
      html += `<div class="mkt"><div class="mkt-head"><span class="nm">${k === 'G' ? '🥇' : '🥈'}${c.name}相場</span>
        <span class="px">${yen(m[k].price)}</span><span class="chg ${chg >= 0 ? 'up-c' : 'down-c'}">${chg >= 0 ? '▲' : '▼'}${Math.abs(chg).toFixed(1)}%</span></div>
        <canvas id="chart-${k}"></canvas>
        <div class="own">あなた ${pl.parts[k]}枚 ／ 相手 ${op.parts[k]}枚</div>
        <div class="mkt-row"><button class="mini-btn teal" data-trade="${k}:buy" ${!can || pl.trades <= 0 || pl.money < Eco.buyPrice(m, k) ? 'disabled' : ''}>買う<br>${yen(Eco.buyPrice(m, k))}</button>
        <button class="mini-btn primary" data-trade="${k}:sell" ${!can || pl.trades <= 0 || pl.parts[k] <= 0 ? 'disabled' : ''}>売る<br>${yen(Eco.sellPrice(m, k))}</button></div></div>`;
    }
    html += '</div>';
    html += `<p class="hint">この手番の売買：あと${pl.trades}回。買うと値上がり・売ると値下がりします（手数料${Math.round(Eco.FEE * 100)}%）。▲▼の印は売買のあと（青＝あなた、赤＝相手）。</p>`;
    $('tab-market').innerHTML = html;
    for (const k of ['G', 'S']) drawChart($('chart-' + k), m[k], Eco.COMMODITIES[k]);
  }

  function drawChart(cv, s, c) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const hist = s.hist;
    const lo = Math.min(...hist, c.base) * 0.95;
    const hi = Math.max(...hist, c.base) * 1.05;
    const X = (i) => (i / (hist.length - 1)) * (w - 4) + 2;
    const Y = (v) => h - 4 - ((v - lo) / (hi - lo)) * (h - 8);
    // 基準値（平均的な値段）
    g.strokeStyle = 'rgba(0,0,0,0.2)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(0, Y(c.base));
    g.lineTo(w, Y(c.base));
    g.stroke();
    g.setLineDash([]);
    // 面と線
    g.beginPath();
    hist.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.lineTo(X(hist.length - 1), h);
    g.lineTo(X(0), h);
    g.closePath();
    g.fillStyle = c.color + '33';
    g.fill();
    g.beginPath();
    hist.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.strokeStyle = c.color;
    g.lineWidth = 2;
    g.stroke();
    // 売買の印
    for (const mk of s.marks) {
      const x = X(mk.i);
      const y = Y(hist[mk.i]);
      g.fillStyle = mk.who === 0 ? '#1f7ac7' : '#d62f2f';
      g.beginPath();
      if (mk.side === 'buy') {
        g.moveTo(x, y + 4);
        g.lineTo(x - 4, y + 11);
        g.lineTo(x + 4, y + 11);
      } else {
        g.moveTo(x, y - 4);
        g.lineTo(x - 4, y - 11);
        g.lineTo(x + 4, y - 11);
      }
      g.fill();
    }
  }

  function moveGridHTML(p) {
    const ms = Fu.moveSet(p);
    const cells = new Array(49).fill('');
    const idx = (dx, dy) => (3 + dy) * 7 + (3 + dx); // 7×7 の真ん中が自分
    cells[idx(0, 0)] = 'me';
    for (const d in ms.rays) {
      const [dx, dy] = Fu.DIRS[d];
      const max = ms.rays[d];
      for (let k = 1; k <= 3 && k <= max; k++) cells[idx(dx * k, dy * k)] = max > 3 && k === 3 ? 'far' : 'go';
    }
    for (const [jx, jy] of ms.jumps) if (Math.abs(jx) <= 3 && Math.abs(jy) <= 3) cells[idx(jx, jy)] = 'jump';
    return `<div class="movegrid">${cells.map((c) => `<i class="${c}"></i>`).join('')}</div>`;
  }

  function renderForge() {
    const pl = G.players[0];
    const can = myTurn();
    const sel = G.sel && G.st.board[G.sel.y][G.sel.x];
    if (!sel || sel.t !== 'P') {
      const items = Fu.UPGRADE_KEYS.filter((k) => pl.items[k] > 0).map((k) => `${UPGRADES[k].name}×${pl.items[k]}`);
      const parts = Fu.PART_KEYS.filter((k) => pl.parts[k] > 0).map((k) => `${PARTS[k].name}×${pl.parts[k]}`);
      $('tab-forge').innerHTML = `<p class="hint">盤の<b>自分の歩</b>をタップして選ぶと、ここで強化・合成できます（手番は使いません）。</p>
        <div class="inv-title">持っている強化</div><p class="hint">${items.join('、') || 'なし（ショップで買えます）'}</p>
        <div class="inv-title">持っている駒（合成用）</div><p class="hint">${parts.join('、') || 'なし'}</p>`;
      return;
    }
    const ups = Fu.UPGRADE_KEYS.filter((k) => sel.ups[k]).map((k) => `${UPGRADES[k].name}${UPGRADES[k].max > 1 ? sel.ups[k] : ''}`);
    let html = `<div class="forge-head">${moveGridHTML(sel)}<div class="forge-info"><h3>${Fu.pawnName(sel)}</h3>
      <p>戦闘力 ${Fu.power(sel)}　合成 ${sel.fused.length}/${MAX_FUSE}${sel.promo ? '　と金' : ''}</p>
      <p>${ups.join('・') || '強化なし'}</p></div></div>`;
    const items = Fu.UPGRADE_KEYS.filter((k) => pl.items[k] > 0);
    html += `<div class="inv-title">強化を付ける</div><div class="inv">${
      items.map((k) => `<button class="mini-btn teal" data-apply="${k}" ${!can || sel.ups[k] >= UPGRADES[k].max ? 'disabled' : ''}>${UPGRADES[k].name}<b>×${pl.items[k]}</b></button>`).join('') ||
      '<span class="hint">強化アイテムなし（ショップで買えます）</span>'
    }</div>`;
    const parts = Fu.PART_KEYS.filter((k) => pl.parts[k] > 0);
    html += `<div class="inv-title">駒を合成する（手数料 ${yen(Eco.FUSE_COST)}）</div><div class="inv">${
      parts
        .map((k) => {
          const dis = !can || sel.fused.length >= MAX_FUSE || sel.fused.includes(k) || pl.money < Eco.FUSE_COST;
          const note = k === 'G' || k === 'S' ? `<small>（相場${yen(Eco.sellPrice(G.market, k))}）</small>` : '';
          return `<button class="mini-btn primary" data-fuse="${k}" ${dis ? 'disabled' : ''}>${PARTS[k].name}<b>×${pl.parts[k]}</b>${note}</button>`;
        })
        .join('') || '<span class="hint">合成できる駒なし（ショップで買う／相手の強い歩を取って奪う）</span>'
    }</div>`;
    $('tab-forge').innerHTML = html;
  }

  // ---------- ボタン ----------
  document.querySelector('.panel').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !myTurn()) return;
    const pl = G.players[0];
    if (b.dataset.buy !== undefined) {
      const it = Eco.buy(pl, +b.dataset.buy, rng, () => G.st.hands[0]++);
      if (it) {
        log(`「${Eco.itemLabel(it.key).title}」を買った（${yen(it.price)}）`);
        sfx.coin();
      }
    } else if (b.dataset.reroll !== undefined) {
      if (Eco.reroll(pl, rng)) sfx.tap();
    } else if (b.dataset.trade) {
      const [k, side] = b.dataset.trade.split(':');
      const r = Eco.trade(G.market, k, side, pl, 0);
      if (r.ok) {
        log(`${Eco.COMMODITIES[k].name}を1枚${side === 'buy' ? '買った' : '売った'}（${yen(r.amount)}）`);
        sfx.coin();
      } else log(r.why);
    } else if (b.dataset.apply) {
      if (AI.applyItem(G, 0, G.sel.x, G.sel.y, b.dataset.apply)) {
        log(`歩に「${UPGRADES[b.dataset.apply].name}」を付けた`);
        sfx.fuse();
        G.selMoves = Fu.legalMoves(G.st, 0).filter((mm) => !mm.drop && mm.fx === G.sel.x && mm.fy === G.sel.y);
      }
    } else if (b.dataset.fuse) {
      if (AI.fuse(G, 0, G.sel.x, G.sel.y, b.dataset.fuse)) {
        log(`${PARTS[b.dataset.fuse].name}を合成して「${Fu.pawnName(G.st.board[G.sel.y][G.sel.x])}」が生まれた！`);
        sfx.fuse();
        haptics.vibrate([20, 30, 20]);
        G.selMoves = Fu.legalMoves(G.st, 0).filter((mm) => !mm.drop && mm.fx === G.sel.x && mm.fy === G.sel.y);
      }
    }
    render();
  });
  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      tab = t.dataset.tab;
      sfx.tap();
      renderTab();
    })
  );
  $('btn-hand').addEventListener('click', () => {
    if (!myTurn() || G.st.hands[0] === 0) return;
    G.drop = !G.drop;
    G.sel = null;
    sfx.tap();
    render();
  });

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
  function soundLabel() {
    $('btn-sound').textContent = audio.muted ? '🔇 サウンド OFF' : '🔊 サウンド ON';
  }
  $('btn-sound').addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    soundLabel();
  });
  window.addEventListener('resize', () => tab === 'market' && G && renderMarket());

  buildBoard();
  soundLabel();
  newGame(); // タイトルの後ろに盤を出しておく
  window.FuDebug = () => G; // 開発用
})();
