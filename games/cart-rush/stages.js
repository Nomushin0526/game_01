// カートラッシュ！ ステージ定義（舞台: 東京の下町〜湾岸）
// 距離の単位は「m」くらいのイメージ。z = 0 がスタート。速度は m/秒。
(function () {
  'use strict';

  // 区間タイプごとの基本設定
  //   roadW: 道（通路）の半分の幅 / limit: プレイヤーが動ける範囲
  //   maxSpeed: 通常の最高速度 / accel: 加速の強さ / steer: キーボード操作時の横移動速度
  //   lanes: 車が走る車線の位置
  window.CartThemes = {
    market: { roadW: 3.2, limit: 2.75, maxSpeed: 75, accel: 35, steer: 8 }, // スーパーの店内
    shotengai: { roadW: 3.0, limit: 2.6, maxSpeed: 80, accel: 36, steer: 8 }, // 商店街のアーケード
    avenue: { roadW: 5.0, limit: 4.5, maxSpeed: 105, accel: 42, steer: 10, lanes: [-3.33, 0, 3.33] }, // 大通り
    bridge: { roadW: 5.0, limit: 4.5, maxSpeed: 110, accel: 42, steer: 10, lanes: [-3.33, 0, 3.33] }, // 隅田川の橋
    expressway: { roadW: 5.5, limit: 5.0, maxSpeed: 125, accel: 46, steer: 10, lanes: [-3.67, 0, 3.67] }, // 首都高（高架）
  };

  // 加速ジャンプ台
  //   坂を登りきったところから飛び出す。位置が合っていても、坂の表面に触れていなければ反応しない。
  //   トラック・バスの後ろに付いた台は、屋根の高さから飛び出す。
  window.CartJump = {
    levels: [1.35, 1.6, 1.85],
    duration: 2.6, // 加速が続く時間（秒）。台に乗るたびにリセット
    launchVy: 11.5, // 跳び上がる勢い
    chainVy: 1.6, // 連続ジャンプごとに増える勢い
    gravity: 26,
    ramp: { w: 1.0, len: 8, h: 1.4 }, // 置き型の台の半幅・長さ・高さ
    truckRamp: { w: 1.0, len: 7 }, // 車の後ろに付く台（高さは車の屋根）
  };

  // 自分でするジャンプ・スライディング（上スワイプ / 下スワイプ）
  window.CartMove = {
    hopVy: 9.5, // ジャンプの勢い（約1.7m）
    dropVy: -20, // 空中で下スワイプしたときの急降下
    slideTime: 0.75, // スライディングの長さ（秒）
    sidewalkSpeed: 0.72, // 歩道を走っているときの最高速度（車道の何倍か）。歩道ばかりだと時間に間に合わない
    standH: 1.55, // 立っているときの高さ（当たり判定）
    slideH: 0.7, // スライディング中の高さ
  };

  // セールゲージ / タイムセール
  //   コーンや看板をはね飛ばす・空中で技を決める・ギリギリで避ける とたまる。
  //   満タンでタイムセール発動: 無敵＋超加速＋ぶつかった物をはね飛ばす。
  window.CartSale = {
    duration: 6,
    speedMul: 1.6,
    gain: { smash: 12, trick: 10, nearMiss: 6, hop: 5, ramp: 6, truckRamp: 10 },
  };

  // 操作
  window.CartControl = { dragSensitivity: 1.7, maxSideSpeed: 26 };

  // 制限時間の決め方
  //   各区間（スタート→CP1→CP2→CP3→ゴール）を「ミスなし・ジャンプ台なし」で走ったときの最短タイムを
  //   ゲーム側で計算し、そこに slack 秒を足したものをその区間の持ち時間にする。余りは次の区間へ持ち越し。

  window.CartStages = [
    {
      id: 'market',
      no: 1,
      level: 1,
      name: '下町のスーパー',
      desc: '買い物客や商品棚をかわして、レジまで駆け抜けろ！',
      length: 5000,
      slack: 3, // いちばんやさしいステージなので少しだけ余裕を多めに
      hitPenalty: 0.5,
      taPenalty: 3,
      checkpoints: [1250, 2500, 3750],
      cpNames: ['精肉・鮮魚', '日用品', 'お菓子'],
      goalLabel: 'レジ',
      goalScene: 'registers',
      zones: [
        { to: 1250, type: 'market', name: '青果コーナー', tint: '#6cc070', shelf: 'produce' },
        { to: 2500, type: 'market', name: '精肉・鮮魚コーナー', tint: '#ec6f6f', shelf: 'fresh' },
        { to: 3750, type: 'market', name: '日用品コーナー', tint: '#5fa4e6', shelf: 'daily' },
        { to: Infinity, type: 'market', name: 'お菓子コーナー', tint: '#f3b740', shelf: 'snack' },
      ],
    },
    {
      id: 'home',
      no: 2,
      level: 2,
      name: '下町の帰り道',
      route: '浅草 → 月島',
      desc: '商店街を抜けて大通りへ。車はウィンカーを出して車線変更してくる。',
      length: 6500,
      slack: 1.5,
      hitPenalty: 0.5,
      taPenalty: 3,
      checkpoints: [1500, 3400, 4900],
      cpNames: ['蔵前', '隅田川', '門前仲町'],
      goalLabel: '月島のわが家',
      goalScene: 'home',
      laneChange: { chance: 0.45, blinker: true },
      zones: [
        { to: 1500, type: 'shotengai', name: '浅草の商店街' },
        { to: 3400, type: 'avenue', name: '江戸通り' },
        { to: 3900, type: 'bridge', name: '隅田川' },
        { to: Infinity, type: 'avenue', name: '清澄通り' },
      ],
    },
    {
      id: 'rush',
      no: 3,
      level: 3,
      name: '湾岸ハイウェイ',
      route: '月島 → 葛西',
      desc: '首都高の湾岸線でタイムセールへ！車はウィンカーなしで急に割り込んでくる。',
      length: 7000,
      slack: 1.5,
      hitPenalty: 0.5,
      taPenalty: 3,
      checkpoints: [1250, 3200, 5000],
      cpNames: ['晴海', '東雲', '新木場'],
      goalLabel: '葛西のスーパー',
      goalScene: 'store',
      sky: 'evening',
      laneChange: { chance: 0.5, blinker: false },
      zones: [
        { to: 1250, type: 'avenue', name: '晴海通り' },
        { to: 6000, type: 'expressway', name: '首都高 湾岸線', bay: true },
        { to: Infinity, type: 'avenue', name: '葛西' },
      ],
    },
  ];
})();
