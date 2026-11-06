// 成り上がれ！歩兵 ― お金・ショップ・金銀相場
(function () {
  'use strict';
  const { PARTS, UPGRADES } = window.Fu;

  // ---------- ショップ ----------
  // 金・銀はショップでは売らない（相場で売買する）
  const SHOP_ITEMS = {
    L: { kind: 'part', price: 40 },
    N: { kind: 'part', price: 45 },
    B: { kind: 'part', price: 110 },
    R: { kind: 'part', price: 130 },
    leg: { kind: 'up', price: 25 },
    side: { kind: 'up', price: 20 },
    back: { kind: 'up', price: 15 },
    armor: { kind: 'up', price: 35 },
    pawn: { kind: 'pawn', price: 15 },
  };
  const SHOP_KEYS = Object.keys(SHOP_ITEMS);
  const LINEUP_SIZE = 3;
  const REROLL_COST = 5;
  const FUSE_COST = 10; // 合成の手数料
  const INCOME = 10; // 自分の手番が来るたびにもらえるお金
  const CAPTURE_REWARD = 10; // 歩を取ったときのお金
  const TRADES_PER_TURN = 3; // 1手番で相場を売買できる回数
  // 借金（ネタ）: ¥100ずつ借りられる。自分の手番ごとに利息10%。膨らむと差し押さえ
  const LOAN = 100;
  const MAX_DEBT = 600;
  const INTEREST = 0.1;
  const SEIZE_AT = 400;
  const BANKRUPT_AT = 800; // ここまで膨らむと自己破産（借金は消えるが、持ち物とお金を全部失う）
  const TAX_EVERY = 12; // 何手ごとに確定申告（所持金の10%）
  const TAX_RATE = 0.1;
  const INFLATION = 0.006; // 1手ごとの物価上昇（給料は上がらない）

  function itemLabel(key) {
    if (PARTS[key]) return { title: PARTS[key].name, short: PARTS[key].short, desc: '歩に合成すると、この駒の動きが加わる' };
    if (UPGRADES[key]) return { title: UPGRADES[key].name, short: { leg: '脚', side: '横', back: '後', armor: '鎧' }[key], desc: UPGRADES[key].desc };
    return { title: '歩を1枚', short: '歩', desc: '持ち歩が1枚増える（盤に打てる）' };
  }

  function newPlayer() {
    return {
      money: 120,
      parts: { L: 0, N: 0, S: 1, G: 1, B: 0, R: 0 }, // 最初から金と銀を1枚ずつ持っている
      items: { leg: 0, side: 0, back: 0, armor: 0 },
      lineup: [],
      trades: TRADES_PER_TURN,
      debt: 0,
      royal: 2, // 王の逆襲の残り回数
    };
  }
  // 品ぞろえを引き直す（買うたびにランダムで変わる）
  function rollLineup(pl, rng, infl) {
    const f = infl || 1;
    const pool = SHOP_KEYS.slice();
    pl.lineup = [];
    for (let i = 0; i < LINEUP_SIZE; i++) {
      const k = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      const base = SHOP_ITEMS[k].price;
      pl.lineup.push({ key: k, price: Math.round(base * f * (0.85 + rng() * 0.4)) });
    }
  }
  // 買う（成功したら品ぞろえが入れ替わる）。pawnHand: 持ち歩を増やす関数
  function buy(pl, idx, rng, addPawn, infl) {
    const it = pl.lineup[idx];
    if (!it || pl.money < it.price) return false;
    pl.money -= it.price;
    const kind = SHOP_ITEMS[it.key].kind;
    if (kind === 'part') pl.parts[it.key]++;
    else if (kind === 'up') pl.items[it.key]++;
    else addPawn();
    rollLineup(pl, rng, infl);
    return it;
  }
  function reroll(pl, rng, infl) {
    if (pl.money < REROLL_COST) return false;
    pl.money -= REROLL_COST;
    rollLineup(pl, rng, infl);
    return true;
  }

  // ---------- 金銀相場（敵味方で共通） ----------
  // 手番ごとに値動き（平均に戻ろうとする＋ランダム）。誰かが買うと上がり、売ると下がる。
  // 売買には手数料（スプレッド）がかかるので、同じ手番で買って売るだけでは儲からない。
  const COMMODITIES = {
    G: { name: '金', base: 80, vol: 0.05, impact: 0.07, color: '#e0a400' },
    S: { name: '銀', base: 45, vol: 0.07, impact: 0.08, color: '#8a96a3' },
  };
  const FEE = 0.08;
  const HIST = 48;
  // ニュース（カオス）: k = 'G' / 'S' / 'GS'（両方）, dir = +1 急騰 / -1 急落
  // cash: 全員のお金が増減（物価に合わせて増える）, infl: 物価が一気に動く
  const NEWS = [
    { k: 'G', dir: 1, text: '金の延べ棒をかじる健康法が大流行' },
    { k: 'G', dir: 1, text: '大富豪が金のトイレを100個注文' },
    { k: 'G', dir: 1, text: '金が「推し活」の定番に' },
    { k: 'G', dir: 1, text: '景気不安で金に人気が集中' },
    { k: 'G', dir: -1, text: '錬金術、ついに成功したと発表' },
    { k: 'G', dir: -1, text: '近所の川で金がザクザク見つかる' },
    { k: 'G', dir: -1, text: '有名な金の像、実はメッキだった' },
    { k: 'S', dir: 1, text: '吸血鬼が大量発生（銀の需要が爆増）' },
    { k: 'S', dir: 1, text: '「銀のスプーンをくわえて生まれたい」ブーム' },
    { k: 'S', dir: 1, text: '銀食器ブーム到来！' },
    { k: 'S', dir: -1, text: '銀山の中から さらに銀山が見つかる' },
    { k: 'S', dir: -1, text: '狼男、絶滅を宣言' },
    { k: 'S', dir: -1, text: '「銀色の折り紙で十分」と判明' },
    { k: 'GS', dir: 1, text: '空前の将棋ブームで金将・銀将が品薄' },
    { k: 'GS', dir: -1, text: 'インフルエンサー「金銀はただの石」' },
    { cash: 50, text: '謎の給付金！全員に{c}' },
    { cash: 30, text: '道で財布を拾って届けたらお礼をもらった（全員+{c}）' },
    { cash: -30, text: '王様の誕生日。お祝い金{c}を全員から徴収' },
    { infl: 0.08, text: '物価が急上昇！パンが1個¥500に（インフレ加速）' },
    { infl: -0.05, text: 'まさかのデフレ。物価が少し下がった' },
  ];
  const NEWS_CHANCE = 0.12;

  function newMarket() {
    const m = { news: null, infl: 1, ply: 0 };
    for (const k in COMMODITIES) {
      const c = COMMODITIES[k];
      m[k] = { price: c.base, hist: new Array(HIST).fill(c.base), marks: [] };
    }
    return m;
  }
  function gauss(rng) {
    return Math.sqrt(-2 * Math.log(rng() + 1e-9)) * Math.cos(2 * Math.PI * rng());
  }
  function tick(m, rng) {
    m.news = null;
    m.ply++;
    m.infl *= 1 + INFLATION;
    if (rng() < NEWS_CHANCE) {
      const n = NEWS[Math.floor(rng() * NEWS.length)];
      const ev = { text: n.text, k: n.k || null, dir: n.dir || 0, amt: 0, cash: 0, big: false };
      if (n.k) {
        ev.amt = 0.18 + rng() * 0.27; // 18〜45%
        for (const k of n.k.split('')) m[k].price *= 1 + n.dir * ev.amt;
        ev.big = ev.amt > 0.32;
      } else if (n.cash) {
        ev.cash = Math.round(n.cash * m.infl);
        ev.text = n.text.replace('{c}', '¥' + Math.abs(ev.cash));
      } else if (n.infl) {
        m.infl *= 1 + n.infl;
        ev.big = n.infl > 0;
      }
      m.news = ev;
    }
    for (const k in COMMODITIES) {
      const c = COMMODITIES[k];
      const s = m[k];
      const base = c.base * m.infl; // 金銀は物価に連動（インフレに強い）
      const drift = ((base - s.price) / base) * 0.06;
      s.price = clamp(s.price * Math.exp(drift + gauss(rng) * c.vol), base * 0.3, base * 3);
      s.hist.push(s.price);
      if (s.hist.length > HIST) s.hist.shift();
      s.marks = s.marks.map((mk) => Object.assign(mk, { i: mk.i - 1 })).filter((mk) => mk.i >= 0);
    }
    m.taxDue = m.ply % TAX_EVERY === 0;
  }
  const fuseCost = (m) => Math.round(FUSE_COST * m.infl);

  // ---------- 借金・差し押さえ・税金 ----------
  function borrow(pl) {
    if (pl.debt + LOAN > MAX_DEBT) return false;
    pl.debt += LOAN;
    pl.money += LOAN;
    return true;
  }
  function repay(pl, max) {
    const amt = Math.floor(Math.min(max === undefined ? LOAN : max, pl.debt, pl.money));
    if (amt <= 0) return 0;
    pl.debt -= amt;
    pl.money -= amt;
    return amt;
  }
  function addInterest(pl) {
    if (pl.debt <= 0) return 0;
    const add = Math.ceil(pl.debt * INTEREST);
    pl.debt += add;
    return add;
  }
  // 借金が膨らんだら、持ち物を一番高い物から1つ差し押さえる（借金はその分減る）
  function seize(pl, m) {
    if (pl.debt < SEIZE_AT) return null;
    if (pl.debt >= BANKRUPT_AT) {
      for (const k in pl.parts) pl.parts[k] = 0;
      for (const k in pl.items) pl.items[k] = 0;
      pl.money = 0;
      pl.debt = 0;
      return { kind: 'bankrupt', v: 0, name: '全財産' };
    }
    let best = null;
    for (const k in pl.parts) {
      if (pl.parts[k] <= 0) continue;
      const v = COMMODITIES[k] ? sellPrice(m, k) : Math.round(SHOP_ITEMS[k].price * m.infl * 0.6);
      if (!best || v > best.v) best = { kind: 'part', k, v };
    }
    for (const k in pl.items) {
      if (pl.items[k] <= 0) continue;
      const v = Math.round(SHOP_ITEMS[k].price * m.infl * 0.6);
      if (!best || v > best.v) best = { kind: 'item', k, v };
    }
    if (best) {
      if (best.kind === 'part') pl.parts[best.k]--;
      else pl.items[best.k]--;
      best.name = PARTS[best.k] ? PARTS[best.k].name : UPGRADES[best.k].name;
    } else {
      const v = Math.min(pl.money, pl.debt);
      if (v <= 0) return { kind: 'none', v: 0 };
      pl.money -= v;
      best = { kind: 'money', v, name: 'お金' };
    }
    pl.debt = Math.max(0, pl.debt - best.v);
    return best;
  }
  function tax(pl) {
    const t = Math.floor(Math.max(0, pl.money) * TAX_RATE);
    pl.money -= t;
    return t;
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const buyPrice = (m, k) => Math.round(m[k].price);
  const sellPrice = (m, k) => Math.floor(m[k].price * (1 - FEE));

  // 1枚買う / 売る。who: 0 = プレイヤー, 1 = 相手（チャートに印を付ける）
  function trade(m, k, side, pl, who) {
    const s = m[k];
    const c = COMMODITIES[k];
    const base = c.base * (m.infl || 1);
    if (pl.trades <= 0) return { ok: false, why: 'この手番の売買回数を使い切りました' };
    if (side === 'buy') {
      const cost = buyPrice(m, k);
      if (pl.money < cost) return { ok: false, why: 'お金が足りません' };
      pl.money -= cost;
      pl.parts[k]++;
      s.price = Math.min(base * 3, s.price * (1 + c.impact));
      pl.trades--;
      s.marks.push({ i: HIST - 1, side, who });
      s.hist[HIST - 1] = s.price;
      return { ok: true, amount: cost };
    }
    if (pl.parts[k] <= 0) return { ok: false, why: `${c.name}を持っていません` };
    const get = sellPrice(m, k);
    pl.money += get;
    pl.parts[k]--;
    s.price = Math.max(base * 0.3, s.price * (1 - c.impact));
    pl.trades--;
    s.marks.push({ i: HIST - 1, side, who });
    s.hist[HIST - 1] = s.price;
    return { ok: true, amount: get };
  }

  window.FuEco = {
    SHOP_ITEMS,
    REROLL_COST,
    FUSE_COST,
    LOAN,
    MAX_DEBT,
    INTEREST,
    SEIZE_AT,
    BANKRUPT_AT,
    TAX_EVERY,
    TAX_RATE,
    fuseCost,
    borrow,
    repay,
    addInterest,
    seize,
    tax,
    INCOME,
    CAPTURE_REWARD,
    TRADES_PER_TURN,
    COMMODITIES,
    FEE,
    itemLabel,
    newPlayer,
    rollLineup,
    buy,
    reroll,
    newMarket,
    tick,
    trade,
    buyPrice,
    sellPrice,
  };
})();
