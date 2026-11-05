// カートラッシュ！ ステージ定義
// 距離の単位は「m」くらいのイメージ。z = 0 がスタート。
(function () {
  'use strict';

  // 区間タイプごとの基本設定
  window.CartThemes = {
    market: { roadW: 3.2, limit: 2.75, maxSpeed: 13, steer: 6.0, accel: 5.5 },
    street: { roadW: 3.5, limit: 3.1, maxSpeed: 16, steer: 6.5, accel: 6.0 },
    highway: { roadW: 5.0, limit: 4.5, maxSpeed: 21, steer: 7.5, accel: 6.5 },
  };

  window.CartStages = [
    {
      id: 'market',
      no: 1,
      name: 'スーパーマーケット',
      desc: '買い物客や商品棚をかわして、レジまで駆け抜けろ！',
      length: 1200,
      startTime: 30, // スタート時の持ち時間（秒）
      cpBonus: [22, 22, 22], // 各チェックポイントで追加される秒数
      taPenalty: 3, // タイムアタックでぶつかったときの加算秒数
      checkpoints: [300, 600, 900],
      goalLabel: 'レジ',
      zones: [
        { to: 300, type: 'market', name: '青果コーナー', tint: '#6cc070' },
        { to: 600, type: 'market', name: '精肉・鮮魚コーナー', tint: '#ec6f6f' },
        { to: 900, type: 'market', name: '日用品コーナー', tint: '#5fa4e6' },
        { to: Infinity, type: 'market', name: 'お菓子コーナー', tint: '#f3b740' },
      ],
    },
    {
      id: 'home',
      no: 2,
      name: '帰り道',
      desc: '一般道から高速道路へ。車や工事現場をかわして家まで帰ろう！',
      length: 1500,
      startTime: 30,
      cpBonus: [20, 20, 25],
      taPenalty: 3,
      checkpoints: [380, 760, 1150],
      goalLabel: 'わが家',
      zones: [
        { to: 380, type: 'street', name: '一般道' },
        { to: 1150, type: 'highway', name: '高速道路' },
        { to: Infinity, type: 'street', name: '家の近所' },
      ],
    },
  ];
})();
