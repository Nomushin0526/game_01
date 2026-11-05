// カートラッシュ！ ステージ定義
// 距離の単位は「m」くらいのイメージ。z = 0 がスタート。速度は m/秒。
(function () {
  'use strict';

  // 区間タイプごとの基本設定
  //   roadW: 道（通路）の半分の幅 / limit: プレイヤーが動ける範囲
  //   maxSpeed: 通常の最高速度 / accel: 加速の強さ / steer: キーボード操作時の横移動速度
  window.CartThemes = {
    market: { roadW: 3.2, limit: 2.75, maxSpeed: 30, accel: 14, steer: 8 },
    street: { roadW: 3.5, limit: 3.1, maxSpeed: 38, accel: 16, steer: 9 },
    highway: { roadW: 5.0, limit: 4.5, maxSpeed: 48, accel: 18, steer: 10 },
  };

  // スピードメーターの表示倍率（ゲーム内の速度 × 3.6 × この値 = 表示 km/h）
  // 画面上の実際の速さは「障害物が見えてから反応できる」範囲に抑え、表示だけ思いきり盛る。
  // 2.6 で スーパー約280km/h、一般道約350km/h、高速道路約450km/h、ジャンプ連続で最大約830km/h
  window.CartSpeedo = { scale: 2.6 };

  // 加速ジャンプ台
  //   乗るとジャンプしながら加速。ジャンプ中にさらに台に乗ると、もう一段加速して滞空が伸びる。
  //   levels: 段階ごとの最高速度の倍率（1回目, 2回目連続, 3回目連続…）
  window.CartJump = {
    levels: [1.35, 1.6, 1.85],
    duration: 2.6, // 加速が続く時間（秒）。台に乗るたびにリセット
    launchVy: 8.5, // 跳び上がる勢い
    chainVy: 1.3, // 連続ジャンプごとに増える勢い（高く・長く飛ぶ）
    gravity: 22,
  };

  window.CartStages = [
    {
      id: 'market',
      no: 1,
      name: 'スーパーマーケット',
      desc: '買い物客や商品棚をかわして、レジまで駆け抜けろ！',
      length: 2000,
      startTime: 23, // スタート時の持ち時間（秒）
      cpBonus: [19, 19, 19], // 各チェックポイントで追加される秒数
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
      startTime: 22,
      cpBonus: [17, 17, 21],
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
