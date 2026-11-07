// ウインナー焼き ― 焼け方と破裂の計算（画面とは別。シミュレーションでも使う）
(function (root) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const BINS = 12;

  // 調整用の数値
  const K = {
    panMax: 250, // 強火のフライパンの温度(℃)
    panRate: 0.2, // フライパンの温まりやすさ
    waterAdd: 40, // 1回に入れる水(ml)
    evap: 3.0, // 強火での水の蒸発(ml/秒)
    kWater: 0.08, // 水があるとき（蒸し焼き）の中への伝わりやすさ
    kDry: 0.024, // 焼いているときの伝わりやすさ
    dryEff: 0.62, // 焼いているとき中に伝わる温度の割合（下の面しか触れていない）
    pStart: 58, // 圧力がかかり始める中の温度(℃)
    pSpan: 52, // 何℃上がると皮の限界に届くか
    rush: 0.05, // 急に熱くなると上乗せされる圧力
    rushOver: 1.0, // これ以上の速さ(℃/秒)で熱くなると上乗せ
    brownStart: 115, // 焼き色が付き始めるフライパンの温度
    brownRate: 0.18,
    dryOut: 0.0005, // 中が熱いと水分が抜ける
    cooked: 72, // 中まで火が通った温度
  };

  function create(seed) {
    const r = seed === undefined ? Math.random() : seed;
    return {
      heat: 0, // 火加減 0〜1
      panT: 25,
      water: 0,
      coreT: 6, // 冷蔵庫から出したて
      prevCore: 6,
      rush: 0,
      moist: 1,
      brown: new Array(BINS).fill(0),
      roll: 0,
      strength: 0.97 + r * 0.06, // 皮の強さ（1本ごとに少し違う）
      pressure: 0,
      tension: 0,
      gloss: 0,
      burst: false,
      t: 0,
    };
  }

  // down: いま下になっている区切り
  function step(s, dt, down) {
    if (s.burst) return;
    s.t += dt;
    const target = 25 + s.heat * (K.panMax - 25);
    s.panT += (target - s.panT) * K.panRate * dt;
    const wet = s.water > 0.5;
    if (wet) {
      // 水があるあいだは100℃より上がらない（蒸発に熱が使われる）
      if (s.panT > 100) s.panT = 100;
      if (s.panT >= 96) s.water = Math.max(0, s.water - (0.3 + s.heat * K.evap) * dt);
    }
    // 中の温度
    const eff = wet ? Math.min(100, s.panT) : 25 + (s.panT - 25) * K.dryEff;
    const k = wet ? K.kWater : K.kDry;
    s.prevCore = s.coreT;
    s.coreT += (eff - s.coreT) * k * dt;
    const rate = (s.coreT - s.prevCore) / Math.max(dt, 1e-4);
    // 急に熱くなると、皮が伸びるより先に蒸気が増える
    s.rush += Math.max(0, rate - K.rushOver) * K.rush * dt * (s.coreT > 40 ? 1 : 0.3);
    s.rush -= s.rush * 0.22 * dt;
    // 水分
    // 水分（蒸し焼きのあいだはほとんど抜けない）
    if (s.coreT > 75) s.moist = Math.max(0.2, s.moist - (s.coreT - 75) * K.dryOut * dt * (wet ? 0.05 : 1));
    // 焼き色（下の面に付く。水があるあいだは付かない）
    if (!wet && s.panT > K.brownStart) {
      const amt = ((s.panT - K.brownStart) / 100) * K.brownRate * dt;
      // フライパンに触れている幅（真下ほど濃く）。90度ずつ転がすとムラなく焼ける
      const wgt = [1, 0.8, 0.25];
      for (let d = -2; d <= 2; d++) s.brown[(down + d + BINS) % BINS] += amt * wgt[Math.abs(d)];
      s.gloss = Math.min(1, s.gloss + amt * 0.6); // 脂がにじんでツヤ
    }
    // 圧力と皮の強さ（焦げると弱くなる）
    const base = clamp((s.coreT - K.pStart) / K.pSpan, 0, 2) * (0.62 + 0.38 * s.moist);
    s.pressure = base + s.rush;
    const burnt = Math.max(0, Math.max(...s.brown) - 1.05);
    const str = s.strength - burnt * 0.6;
    s.tension = clamp(s.pressure / str, 0, 1.5);
    if (s.pressure >= str) s.burst = true;
  }

  function addWater(s) {
    if (s.burst) return false;
    s.water = Math.min(80, s.water + K.waterAdd);
    if (s.panT > 100) s.panT = 100; // ジュワッと冷める
    return true;
  }

  // 採点（0〜100）と内訳
  function score(s) {
    if (s.burst) return { total: 0, burst: true };
    const cooked = s.coreT >= K.cooked;
    let bs = 0;
    let burnt = false;
    for (const b of s.brown) {
      if (b > 1.1) burnt = true;
      // 0.8 前後が「こんがり」
      bs += clamp(1 - Math.abs(b - 0.8) / 0.7, 0, 1);
    }
    bs /= s.brown.length;
    const mean = s.brown.reduce((a, b) => a + b, 0) / s.brown.length;
    const sd = Math.sqrt(s.brown.reduce((a, b) => a + (b - mean) * (b - mean), 0) / s.brown.length);
    const even = clamp(1 - sd * 2.2, 0, 1);
    const juicy = clamp((s.moist - 0.45) / 0.5, 0, 1);
    const tight = clamp((s.tension - 0.45) / 0.47, 0, 1); // 破裂寸前ほど「パンパン」
    let total = 100 * (0.32 * bs + 0.13 * even + 0.2 * juicy + 0.35 * tight);
    if (!cooked) total = Math.min(total, 15 + (s.coreT / K.cooked) * 10);
    if (burnt) total *= 0.6;
    return { total: Math.round(total), cooked, brown: bs, even, juicy, tight, burnt, burst: false };
  }

  root.WienerPhysics = { K, BINS, create, step, addWater, score };
})(typeof window !== 'undefined' ? window : globalThis);
