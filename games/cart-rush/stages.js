// カートラッシュ！ ステージ定義
// 距離の単位は「m」くらいのイメージ。z = 0 がスタート。速度は m/秒。
(function () {
  'use strict';

  // 区間タイプごとの基本設定
  //   roadW: 道（通路）の半分の幅 / limit: プレイヤーが動ける範囲
  //   maxSpeed: 通常の最高速度 / accel: 加速の強さ / steer: キーボード操作時の横移動速度
  //   lanes: 車が走る車線の位置
  window.CartThemes = {
    market: { roadW: 3.2, limit: 2.75, maxSpeed: 30, accel: 14, steer: 8 },
    street: { roadW: 3.5, limit: 3.1, maxSpeed: 38, accel: 16, steer: 9, lanes: [-1.75, 1.75] },
    highway: { roadW: 5.0, limit: 4.5, maxSpeed: 48, accel: 18, steer: 10, lanes: [-3.33, 0, 3.33] },
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

  // 制限時間の決め方
  //   各区間（スタート→CP1→CP2→CP3→ゴール）を「ミスなし・ジャンプ台なし」で走ったときの最短タイムを
  //   ゲーム側で計算し、そこに slack 秒を足したものをその区間の持ち時間にする。
  //   余った時間は次の区間に持ち越せる。
  //   hitPenalty: ぶつかったときに減る秒数（チェックポイントモード）
  //   taPenalty: タイムアタックでぶつかったときに足される秒数

  window.CartStages = [
    {
      id: 'market',
      no: 1,
      level: 1,
      name: 'スーパーマーケット',
      desc: '買い物客や商品棚をかわして、レジまで駆け抜けろ！',
      length: 2000,
      slack: 4, // いちばんやさしいステージなので余裕を多めに
      hitPenalty: 0.5,
      taPenalty: 3,
      checkpoints: [500, 1000, 1500],
      goalLabel: 'レジ',
      goalScene: 'registers',
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
      level: 2,
      name: '帰り道',
      desc: '車がウィンカーを出して車線変更してくる。合図を見て先読みしよう！',
      length: 2600,
      slack: 2, // 3回ほどぶつかると間に合わなくなるくらい
      hitPenalty: 0.5,
      taPenalty: 3,
      checkpoints: [600, 1250, 1900],
      goalLabel: 'わが家',
      goalScene: 'home',
      laneChange: { chance: 0.45, blinker: true },
      zones: [
        { to: 600, type: 'street', name: '一般道' },
        { to: 1900, type: 'highway', name: '高速道路' },
        { to: Infinity, type: 'street', name: '家の近所' },
      ],
    },
    {
      id: 'rush',
      no: 3,
      level: 3,
      name: '夕暮れハイウェイ',
      desc: '隣町のスーパーのタイムセールへ！車はウィンカーなしで急に割り込んでくる。',
      length: 2800,
      slack: 2,
      hitPenalty: 0.5,
      taPenalty: 3,
      checkpoints: [500, 1200, 2000],
      goalLabel: '隣町のスーパー',
      goalScene: 'store',
      sky: 'evening',
      laneChange: { chance: 0.5, blinker: false },
      zones: [
        { to: 500, type: 'street', name: '一般道' },
        { to: 2300, type: 'highway', name: '夕暮れの高速道路' },
        { to: Infinity, type: 'street', name: '隣町' },
      ],
    },
  ];
})();
