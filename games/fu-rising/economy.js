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
    };
  }
  // 品ぞろえを引き直す（買うたびにランダムで変わる）
  function rollLineup(pl, rng) {
    const pool = SHOP_KEYS.slice();
    pl.lineup = [];
    for (let i = 0; i < LINEUP_SIZE; i++) {
      const k = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      const base = SHOP_ITEMS[k].price;
      pl.lineup.push({ key: k, price: Math.round(base * (0.85 + rng() * 0.4)) });
    }
  }
  // 買う（成功したら品ぞろえが入れ替わる）。pawnHand: 持ち歩を増やす関数
  function buy(pl, idx, rng, addPawn) {
    const it = pl.lineup[idx];
    if (!it || pl.money < it.price) return false;
    pl.money -= it.price;
    const kind = SHOP_ITEMS[it.key].kind;
    if (kind === 'part') pl.parts[it.key]++;
    else if (kind === 'up') pl.items[it.key]++;
    else addPawn();
    rollLineup(pl, rng);
    return it;
  }
  function reroll(pl, rng) {
    if (pl.money < REROLL_COST) return false;
    pl.money -= REROLL_COST;
    rollLineup(pl, rng);
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
  const NEWS = [
    ['G', -1, '新しい金鉱が見つかった！'],
    ['G', 1, '金の買い占め騒動！'],
    ['S', -1, '銀の大量放出のうわさ'],
    ['S', 1, '銀食器ブーム到来！'],
    ['G', 1, '景気不安で金に人気が集中'],
    ['S', -1, '銀山の採掘量が急増'],
  ];

  function newMarket() {
    const m = { news: null };
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
    if (rng() < 0.06) {
      const [k, dir, text] = NEWS[Math.floor(rng() * NEWS.length)];
      const amt = 0.12 + rng() * 0.15;
      m[k].price *= 1 + dir * amt;
      m.news = { k, dir, text, amt };
    }
    for (const k in COMMODITIES) {
      const c = COMMODITIES[k];
      const s = m[k];
      const drift = ((c.base - s.price) / c.base) * 0.06;
      s.price = clamp(s.price * Math.exp(drift + gauss(rng) * c.vol), c.base * 0.3, c.base * 3);
      s.hist.push(s.price);
      if (s.hist.length > HIST) s.hist.shift();
      s.marks = s.marks.map((mk) => Object.assign(mk, { i: mk.i - 1 })).filter((mk) => mk.i >= 0);
    }
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const buyPrice = (m, k) => Math.round(m[k].price);
  const sellPrice = (m, k) => Math.floor(m[k].price * (1 - FEE));

  // 1枚買う / 売る。who: 0 = プレイヤー, 1 = 相手（チャートに印を付ける）
  function trade(m, k, side, pl, who) {
    const s = m[k];
    const c = COMMODITIES[k];
    if (pl.trades <= 0) return { ok: false, why: 'この手番の売買回数を使い切りました' };
    if (side === 'buy') {
      const cost = buyPrice(m, k);
      if (pl.money < cost) return { ok: false, why: 'お金が足りません' };
      pl.money -= cost;
      pl.parts[k]++;
      s.price = Math.min(c.base * 3, s.price * (1 + c.impact));
      pl.trades--;
      s.marks.push({ i: HIST - 1, side, who });
      s.hist[HIST - 1] = s.price;
      return { ok: true, amount: cost };
    }
    if (pl.parts[k] <= 0) return { ok: false, why: `${c.name}を持っていません` };
    const get = sellPrice(m, k);
    pl.money += get;
    pl.parts[k]--;
    s.price = Math.max(c.base * 0.3, s.price * (1 - c.impact));
    pl.trades--;
    s.marks.push({ i: HIST - 1, side, who });
    s.hist[HIST - 1] = s.price;
    return { ok: true, amount: get };
  }

  window.FuEco = {
    SHOP_ITEMS,
    REROLL_COST,
    FUSE_COST,
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
