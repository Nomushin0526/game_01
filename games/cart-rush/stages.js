// カートラッシュ！ ステージ定義
// 距離の単位は「m」くらいのイメージ。z = 0 がスタート。速度は m/秒。
(function () {
  'use strict';

  // 区間タイプごとの基本設定
  //   roadW: 道（通路）の半分の幅 / limit: プレイヤーが動ける範囲
  //   maxSpeed: 通常の最高速度 / accel: 加速の強さ / steer: キーボード操作時の横移動速度
  window.CartThemes = {
    market: { roadW: 3.2, limit: 2.75, maxSpeed: 22, accel: 10, steer: 7 },
    street: { roadW: 3.5, limit: 3.1, maxSpeed: 28, accel: 11, steer: 8 },
    highway: { roadW: 5.0, limit: 4.5, maxSpeed: 36, accel: 12, steer: 9 },
  };

  // 加速パネル
  window.CartBoost = {
    multiplier: 1.45, // 最高速度の何倍まで上がるか
    duration: 2.2, // 効果時間（秒）
  };

  window.CartStages = [
    {
      id: 'market',
      no: 1,
      name: 'スーパーマーケット',
      desc: '買い物客や商品棚をかわして、レジまで駆け抜けろ！',
      length: 2000,
      startTime: 30, // スタート時の持ち時間（秒）
      cpBonus: [26, 26, 26], // 各チェックポイントで追加される秒数
      taPenalty: 3, // タイムアタックでぶつかったときの加算秒数
      checkpoints: [500, 1000, 1500],
      goalLabel: 'レジ',
      zones: [
        { to: 500, type: 'market', name: '青果コーナー', tint: '#6cc070', shelf: 'produce' },
        { to: 1000, type: 'market', name: '精肉・鮮魚コーナー', tint: '#ec6f6f', shelf: 'fresh' },
        { to: 1500, type: 'market', name: '日用品コーナー', tint: '#5fa4e6', shelf: 'daily' },
        { to: Infinity, type: 'market', name: 'お菓子コーナー', tint: '#f3b740', shelf: 'snack' },
      ],
    },
    {
      id: 'home',
      no: 2,
      name: '帰り道',
      desc: '一般道から高速道路へ。車や工事現場をかわして家まで帰ろう！',
      length: 2600,
      startTime: 28,
      cpBonus: [22, 22, 28],
      taPenalty: 3,
      checkpoints: [600, 1250, 1900],
      goalLabel: 'わが家',
      zones: [
        { to: 600, type: 'street', name: '一般道' },
        { to: 1900, type: 'highway', name: '高速道路' },
        { to: Infinity, type: 'street', name: '家の近所' },
      ],
    },
  ];
})();
