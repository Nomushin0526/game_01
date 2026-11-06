// 言霊デュエル ― カードの定義と「文」の効果の計算
(function () {
  'use strict';

  const MAX_HP = 130;
  const SLOTS = 3; // 言葉ゾーン・伏せゾーンの数
  const HAND_MAX = 8;
  const START_HAND = 5;

  const KIND = { food: '食べ物', drink: '飲み物', weapon: '武器', thing: '道具', animal: '動物' };
  // 動詞がない名詞だけで発動したときの効果
  const DEFAULT_ACT = { food: 'heal', drink: 'heal', weapon: 'attack', thing: 'attack', animal: 'attack' };
  const ACT = { attack: '攻撃', heal: '回復', guard: '守り', buff: 'バフ', debuff: 'デバフ', break: '妨害' };
  // 対象を選ぶ効果: own = 自分の別の文, op = 相手の文
  const TARGET = { attack: 'op', buff: 'own', debuff: 'op' };
  const ACT_DESC = {
    attack: '相手の言葉か相手に攻撃',
    heal: '自分のHPを回復',
    guard: '次の自分のターンまで、受けるダメージを減らす',
    buff: '自分の別の文を強くする（その分、守備も上がる）',
    debuff: '相手の文を弱くする（0になったら消える）',
    break: '相手の伏せカードを1枚破壊（なければ相手の手札を1枚捨てさせる）',
  };

  // ---------- カード ----------
  // 名詞: power が基本の強さ。kinds で動詞との相性が決まる
  const NOUNS = {
    apple: { word: 'りんご', kinds: ['food'], power: 10 },
    onigiri: { word: 'おにぎり', kinds: ['food'], power: 15 },
    curry: { word: 'カレー', kinds: ['food'], power: 25 },
    cake: { word: 'ケーキ', kinds: ['food'], power: 20 },
    ramen: { word: '激辛ラーメン', kinds: ['food'], power: 25, flag: 'spicy', note: '食べると辛さで相手にも15ダメージ。すすめると×1.5' },
    milk: { word: '牛乳', kinds: ['drink'], power: 10 },
    cola: { word: 'コーラ', kinds: ['drink'], power: 15 },
    durian: { word: 'ドリアン', kinds: ['food'], power: 15, flag: 'stink', note: '投げる・ぶちまける・すすめると くさくて×1.5' },
    bread: { word: 'フランスパン', kinds: ['food', 'weapon'], power: 15, note: '食べ物にも武器にもなる' },

    stone: { word: '石', kinds: ['thing'], power: 10 },
    rope: { word: 'ロープ', kinds: ['thing'], power: 15 },
    pillow: { word: 'まくら', kinds: ['thing'], power: 10, flag: 'soft', note: '守りに使うと×2' },
    bat: { word: 'バット', kinds: ['weapon'], power: 20 },
    hammer: { word: 'ハンマー', kinds: ['weapon'], power: 25 },
    pan: { word: 'フライパン', kinds: ['weapon', 'thing'], power: 20 },
    dict: { word: '辞書', kinds: ['thing'], power: 20, flag: 'heavy', note: '言葉の重み。攻撃×1.2' },
    umbrella: { word: '傘', kinds: ['weapon', 'thing'], power: 15 },
    boomerang: { word: 'ブーメラン', kinds: ['weapon'], power: 15, flag: 'boomerang', note: '投げても戻ってくる（なくならない）' },
    banana: { word: 'バナナの皮', kinds: ['thing'], power: 5, flag: 'slip', note: '相手の場に言葉があっても直接攻撃できる' },

    dog: { word: '犬', kinds: ['animal'], power: 15 },
    cat: { word: '猫', kinds: ['animal'], power: 10, flag: 'whim', note: '気まぐれ。効果が×0.5〜×2.5でゆれる' },
    bear: { word: 'クマ', kinds: ['animal'], power: 25 },
    bee: { word: 'ハチ', kinds: ['animal'], power: 10, flag: 'sting', note: 'かみつく（刺す）と×2' },
    gorilla: { word: 'ゴリラ', kinds: ['animal'], power: 20 },
    chicken: { word: 'ニワトリ', kinds: ['animal'], power: 10, flag: 'egg', note: '発動するたび、たまごで自分が10回復' },
    turtle: { word: 'カメ', kinds: ['animal'], power: 10, flag: 'shell', note: '守りに使うと×2' },
    lion: { word: 'ライオン', kinds: ['animal'], power: 20 },
    snake: { word: 'ヘビ', kinds: ['animal'], power: 15 },
  };

  // 動詞: act が効果の種類。p が正しい助詞。fit が名詞の種類ごとの倍率（合わないと other）
  // conj: 助動詞が付いたときの形
  const VERBS = {
    eat: { word: '食べる', act: 'heal', p: 'を', fit: { food: 2.5, drink: 1.5 }, other: 0.3, consume: true, draw: 1, miss: '歯が欠けた！（自分に5ダメージ）', conj: { ta: '食べた', masu: '食べます', makuru: '食べまくる', chau: '食べちゃう' } },
    drink: { word: '飲む', act: 'heal', p: 'を', fit: { drink: 3, food: 0.8 }, other: 0.3, consume: true, draw: 1, miss: 'のどにつまった！（自分に5ダメージ）', conj: { ta: '飲んだ', masu: '飲みます', makuru: '飲みまくる', chau: '飲んじゃう' } },
    throw: { word: '投げる', act: 'attack', p: 'を', fit: { thing: 2, weapon: 2, food: 1.8, drink: 1.8 }, other: 0.8, consume: true, conj: { ta: '投げた', masu: '投げます', makuru: '投げまくる', chau: '投げちゃう' } },
    splash: { word: 'ぶちまける', act: 'attack', p: 'を', fit: { food: 2.5, drink: 2.8 }, other: 1.2, consume: true, conj: { ta: 'ぶちまけた', masu: 'ぶちまけます', makuru: 'ぶちまけまくる', chau: 'ぶちまけちゃう' } },
    swing: { word: '振り回す', act: 'attack', p: 'を', fit: { weapon: 1.6, thing: 1.2 }, other: 0.5, conj: { ta: '振り回した', masu: '振り回します', makuru: '振り回しまくる', chau: '振り回しちゃう' } },
    guard: { word: '守る', act: 'guard', p: 'で', fit: { weapon: 1.5, thing: 1.5 }, other: 0.8, conj: { ta: '守った', masu: '守ります', makuru: '守りまくる', chau: '守っちゃう' } },
    offer: { word: 'すすめる', act: 'attack', p: 'を', fit: { food: 1.5, drink: 1.5 }, other: 0.4, missText: '誰もいらないって…', conj: { ta: 'すすめた', masu: 'すすめます', makuru: 'すすめまくる', chau: 'すすめちゃう' } },
    serve: { word: 'ふるまう', act: 'heal', p: 'を', fit: { food: 1.3, drink: 1.3 }, other: 0.3, miss: '誰も喜ばない…（自分に5ダメージ）', conj: { ta: 'ふるまった', masu: 'ふるまいます', makuru: 'ふるまいまくる', chau: 'ふるまっちゃう' } },
    call: { word: '呼ぶ', act: 'attack', p: 'を', fit: { animal: 1.3 }, other: 0.4, missText: '返事がない…', conj: { ta: '呼んだ', masu: '呼びます', makuru: '呼びまくる', chau: '呼んじゃう' } },
    bite: { word: 'かみつく', act: 'attack', p: 'が', fit: { animal: 1.5 }, other: 0.4, conj: { ta: 'かみついた', masu: 'かみつきます', makuru: 'かみつきまくる', chau: 'かみついちゃう' } },
    bark: { word: '吠える', act: 'guard', p: 'が', fit: { animal: 1.5 }, other: 0.4, conj: { ta: '吠えた', masu: '吠えます', makuru: '吠えまくる', chau: '吠えちゃう' } },
    // ---- バフ・デバフ・妨害 ----
    gift: { word: '差し入れする', act: 'buff', p: 'を', fit: { food: 1.3, drink: 1.3 }, other: 0.5, consume: true, conj: { ta: '差し入れした', masu: '差し入れします', makuru: '差し入れしまくる', chau: '差し入れしちゃう' } },
    feed: { word: '食べさせる', act: 'debuff', p: 'を', fit: { food: 1.2, drink: 1 }, other: 0.4, consume: true, sleep: true, note: '相手は満腹で次のターン眠る', conj: { ta: '食べさせた', masu: '食べさせます', makuru: '食べさせまくる', chau: '食べさせちゃう' } },
    spill: { word: 'こぼす', act: 'break', p: 'を', fit: { drink: 1.5, food: 1 }, other: 0.5, consume: true, conj: { ta: 'こぼした', masu: 'こぼします', makuru: 'こぼしまくる', chau: 'こぼしちゃう' } },
    sleep: { word: '寝る', act: 'heal', p: 'で', fit: { thing: 1.5 }, other: 0.3, miss: '寝ちがえた！（自分に5ダメージ）', note: 'まくらなら×2', conj: { ta: '寝た', masu: '寝ます', makuru: '寝まくる', chau: '寝ちゃう' } },
    polish: { word: '磨く', act: 'buff', p: 'を', fit: { weapon: 1.4, thing: 1.2 }, other: 0.5, consume: true, conj: { ta: '磨いた', masu: '磨きます', makuru: '磨きまくる', chau: '磨いちゃう' } },
    tie: { word: 'しばる', act: 'debuff', p: 'で', fit: { thing: 1.2, weapon: 0.8 }, other: 0.4, consume: true, sleep: true, note: '相手は次のターン動けない', conj: { ta: 'しばった', masu: 'しばります', makuru: 'しばりまくる', chau: 'しばっちゃう' } },
    smash: { word: 'たたき割る', act: 'break', p: 'で', fit: { weapon: 1.5, thing: 1 }, other: 0.5, consume: true, conj: { ta: 'たたき割った', masu: 'たたき割ります', makuru: 'たたき割りまくる', chau: 'たたき割っちゃう' } },
    pet: { word: 'なでる', act: 'heal', p: 'を', fit: { animal: 1.3 }, other: 0.3, missText: 'なでても反応がない…', conj: { ta: 'なでた', masu: 'なでます', makuru: 'なでまくる', chau: 'なでちゃう' } },
    flock: { word: '群れる', act: 'buff', p: 'が', fit: { animal: 1.3 }, other: 0.4, consume: true, conj: { ta: '群れた', masu: '群れます', makuru: '群れまくる', chau: '群れちゃう' } },
    threat: { word: '威嚇する', act: 'debuff', p: 'が', fit: { animal: 0.8 }, other: 0.3, conj: { ta: '威嚇した', masu: '威嚇します', makuru: '威嚇しまくる', chau: '威嚇しちゃう' } },
    dig: { word: '掘り返す', act: 'break', p: 'が', fit: { animal: 1.3 }, other: 0.5, conj: { ta: '掘り返した', masu: '掘り返します', makuru: '掘り返しまくる', chau: '掘り返しちゃう' } },
  };

  // 助詞: 動詞の正しい助詞なら×1.5、違うと文法ミスで×0.8。「こそ」はどの動詞でも×1.3
  const PARTS = {
    wo: { word: 'を' },
    ga: { word: 'が' },
    de: { word: 'で' },
    koso: { word: 'こそ', any: 1.3 },
  };
  // 助動詞（文の最後に付ける）
  const AUXS = {
    ta: { word: 'た', mult: 1.2, desc: '完了。×1.2' },
    masu: { word: 'ます', mult: 1.1, immune: true, desc: '丁寧語。×1.1＋この文は相手のトラップを受けない' },
    makuru: { word: 'まくる', mult: 1.6, burn: true, desc: 'やりすぎ。×1.6、ただし発動後この文は捨て札' },
    chau: { word: 'ちゃう', mult: 1.8, recoil: 15, desc: 'うっかり。×1.8、ただし自分も15ダメージ' },
  };
  // トラップ（伏せておき、相手の行動に反応して発動）
  const TRAPS = {
    hunt: { word: '言葉狩り', on: 'activate', desc: '相手が文を発動したとき：その発動を無効にし、その文を破壊する' },
    ru: { word: 'る攻め', on: 'verb', desc: '相手が「る」で終わる動詞を出したとき：その動詞を捨てさせ、相手に15ダメージ' },
    nitpick: { word: '揚げ足取り', on: 'attack', desc: '相手の攻撃のとき：ダメージの半分を相手にはね返す' },
    silence: { word: '沈黙は金', on: 'attack', desc: '相手の攻撃のとき：そのダメージを0にする' },
    mishear: { word: '聞き間違い', on: 'activate', desc: '相手が文を発動したとき：動詞をランダムな別の動詞に変えてしまう' },
  };

  const CARDS = {};
  for (const k in NOUNS) CARDS[k] = Object.assign({ type: 'noun', key: k }, NOUNS[k]);
  for (const k in VERBS) CARDS['v_' + k] = Object.assign({ type: 'verb', key: 'v_' + k }, VERBS[k]);
  for (const k in PARTS) CARDS['p_' + k] = Object.assign({ type: 'part', key: 'p_' + k }, PARTS[k]);
  for (const k in AUXS) CARDS['a_' + k] = Object.assign({ type: 'aux', key: 'a_' + k, id: k }, AUXS[k]);
  for (const k in TRAPS) CARDS['t_' + k] = Object.assign({ type: 'trap', key: 't_' + k, id: k }, TRAPS[k]);

  const TYPE_NAME = { noun: '名詞', verb: '動詞', part: '助詞', aux: '助動詞', trap: 'トラップ' };

  // ---------- デッキ（各30枚） ----------
  // どのデッキにも 攻撃・守り/回復・バフ・デバフ・妨害 がそろうようにしてある
  const AUX4 = ['a_ta', 'a_masu', 'a_makuru', 'a_chau'];
  const DECKS = {
    food: {
      name: '食べ物デッキ',
      desc: '回復とドローで粘り、差し入れで強化。食べさせて眠らせる',
      icon: '🍎',
      cards: ['apple', 'apple', 'onigiri', 'onigiri', 'curry', 'cake', 'ramen', 'milk', 'cola', 'durian',
        'v_eat', 'v_eat', 'v_offer', 'v_offer', 'v_splash', 'v_serve', 'v_gift', 'v_feed', 'v_spill',
        'p_wo', 'p_wo', 'p_wo'].concat(AUX4, ['t_hunt', 't_ru', 't_nitpick', 't_silence']),
    },
    tool: {
      name: '武器・道具デッキ',
      desc: '振り回して殴る。磨いて強化、ロープでしばり、罠はたたき割る',
      icon: '🔨',
      cards: ['stone', 'bat', 'pillow', 'bat', 'hammer', 'pan', 'dict', 'umbrella', 'boomerang', 'banana', 'rope',
        'v_swing', 'v_swing', 'v_throw', 'v_guard', 'v_sleep', 'v_polish', 'v_tie', 'v_smash',
        'p_wo', 'p_wo', 'p_de', 'p_de'].concat(AUX4, ['t_hunt', 't_nitpick', 't_silence']),
    },
    animal: {
      name: '動物デッキ',
      desc: '場に残って毎ターンかみつく。威嚇で弱らせ、群れて強くなる',
      icon: '🐻',
      cards: ['dog', 'dog', 'cat', 'bear', 'bee', 'gorilla', 'chicken', 'turtle', 'lion', 'snake',
        'v_bite', 'v_bite', 'v_call', 'v_bark', 'v_pet', 'v_flock', 'v_threat', 'v_dig',
        'p_ga', 'p_ga', 'p_ga', 'p_wo'].concat(AUX4, ['t_hunt', 't_ru', 't_nitpick', 't_mishear']),
    },
  };

  // ---------- 文 ----------
  // 文 = { noun, part, verb, aux, used }（それぞれカードのキー）
  function newSentence(noun) {
    return { noun, part: null, verb: null, aux: null, used: false, uid: Math.random().toString(36).slice(2) };
  }
  const stackCount = (s) => (s.part ? 1 : 0) + (s.verb ? 1 : 0) + (s.aux ? 1 : 0);
  // 守備力（攻撃されたとき、これより大きいダメージで破壊される）
  const defense = (s) => Math.max(1, CARDS[s.noun].power + stackCount(s) * 5 + Math.round((s.bonus || 0) / 2));

  // このカードをこの文に上乗せできるか
  function canAttach(s, key) {
    const c = CARDS[key];
    if (!s) return false;
    if (c.type === 'part') return !s.part && !s.verb;
    if (c.type === 'verb') return !s.verb;
    if (c.type === 'aux') return !!s.verb && !s.aux;
    return false;
  }
  function attach(s, key) {
    const c = CARDS[key];
    const ns = Object.assign({}, s);
    if (c.type === 'part') ns.part = key;
    else if (c.type === 'verb') ns.verb = key;
    else if (c.type === 'aux') ns.aux = key;
    return ns;
  }
  // 自然な文にする（例: りんご を 食べちゃう）
  function text(s) {
    const n = CARDS[s.noun].word;
    const p = s.part ? CARDS[s.part].word : '';
    if (!s.verb) return n + p;
    const v = CARDS[s.verb];
    return n + p + (s.aux ? v.conj[CARDS[s.aux].id] : v.word);
  }
  // 文を区切ったもの（色分け表示用）
  function pieces(s) {
    const out = [{ t: 'noun', w: CARDS[s.noun].word }];
    if (s.part) out.push({ t: 'part', w: CARDS[s.part].word });
    if (s.verb) {
      const v = CARDS[s.verb];
      if (s.aux) {
        const full = v.conj[CARDS[s.aux].id];
        // 動詞の部分と助動詞の部分に分ける（語幹は動詞の原形と共通の部分）
        let i = 0;
        while (i < full.length && i < v.word.length - 1 && full[i] === v.word[i]) i++;
        out.push({ t: 'verb', w: full.slice(0, i) });
        out.push({ t: 'aux', w: full.slice(i) });
      } else out.push({ t: 'verb', w: v.word });
    }
    return out;
  }

  // 文の効果を計算する。rng を渡すと猫の気まぐれが決まる（渡さなければ期待値）
  function evaluate(s, rng) {
    const n = CARDS[s.noun];
    const v = s.verb ? CARDS[s.verb] : null;
    const notes = [];
    let mult = 1;
    let act;
    let consume;
    let selfDmg = 0;
    let fits = true;
    if (!v) {
      act = DEFAULT_ACT[n.kinds[0]];
      consume = true; // 動詞のない言葉は言いっぱなし（発動すると消える）
    } else {
      act = v.act;
      consume = !!v.consume;
      let f = 0;
      for (const k of n.kinds) if (v.fit[k]) f = Math.max(f, v.fit[k]);
      if (!f) {
        f = v.other;
        fits = false;
        notes.push(v.missText || '意味がよくわからない文…');
        if (v.miss) selfDmg += 5;
      } else if (f !== 1) notes.push(`相性×${f}`);
      mult *= f;
    }
    if (s.part) {
      const p = CARDS[s.part];
      if (p.any) {
        mult *= p.any;
        notes.push(`強調×${p.any}`);
      } else if (v) {
        if (p.word === v.p) {
          mult *= 1.5;
          notes.push('正しい文法×1.5');
        } else {
          mult *= 0.8;
          notes.push('文法ミス×0.8');
        }
      }
    }
    let immune = false;
    let burn = false;
    if (s.aux) {
      const a = CARDS[s.aux];
      mult *= a.mult;
      notes.push(`${a.word}×${a.mult}`);
      if (a.immune) immune = true;
      if (a.burn) burn = true;
      if (a.recoil) selfDmg += a.recoil;
    }
    // 名詞の個性
    let extra = 0;
    let heal = 0;
    const vk = v && v.key;
    if (n.flag === 'stink' && (vk === 'v_throw' || vk === 'v_splash' || vk === 'v_offer')) (mult *= 1.5), notes.push('くさい×1.5');
    if (n.flag === 'spicy' && vk === 'v_offer') (mult *= 1.5), notes.push('激辛×1.5');
    if (n.flag === 'heavy' && act === 'attack') (mult *= 1.2), notes.push('言葉の重み×1.2');
    if (n.flag === 'sting' && vk === 'v_bite') (mult *= 2), notes.push('刺す×2');
    if ((n.flag === 'soft' || n.flag === 'shell') && (act === 'guard' || vk === 'v_sleep')) (mult *= 2), notes.push(vk === 'v_sleep' ? 'ふかふか×2' : '守り×2');
    if (n.flag === 'boomerang' && vk === 'v_throw') consume = false;
    if (n.flag === 'spicy' && act === 'heal' && fits) extra = 15;
    if (n.flag === 'egg') heal = 10;
    if (n.flag === 'whim') {
      const w = rng ? 0.5 + Math.floor(rng() * 5) * 0.5 : 1.5;
      mult *= w;
      notes.push(rng ? `気まぐれ×${w}` : '気まぐれ×0.5〜2.5');
    }
    if (burn) consume = true;
    const base = Math.round(n.power * mult);
    const bonus = s.bonus || 0;
    if (bonus > 0) notes.push(`バフ+${bonus}`);
    if (bonus < 0) notes.push(`デバフ${bonus}`);
    const value = Math.max(1, base + bonus);
    const draw = v && v.draw && fits ? v.draw : 0;
    if (draw) notes.push(`${draw}枚ドロー`);
    return { act, value, base, consume, selfDmg, immune, extra, heal, draw, notes, sleep: !!(v && v.sleep), target: TARGET[act] || null, slip: n.flag === 'slip' };
  }

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // カードの説明（手札で選んだときに出す）
  function describe(key) {
    const c = CARDS[key];
    if (c.type === 'noun') {
      const act = DEFAULT_ACT[c.kinds[0]];
      return `${c.kinds.map((k) => KIND[k]).join('・')}。そのまま発動すると${ACT[act]}${c.power}（1回で消える。動詞を重ねると強くなり、場に残る物も）。${c.note || ''}`;
    }
    if (c.type === 'verb') {
      const fit = Object.keys(c.fit).map((k) => `${KIND[k]}×${c.fit[k]}`).join('・');
      return `名詞に重ねると「${ACT[c.act]}」（${ACT_DESC[c.act]}）に${c.note ? '。' + c.note : ''}。${fit}。正しい助詞は「${c.p}」${c.consume ? '。使うと名詞はなくなる' : '。名詞は場に残る'}${c.draw ? '。合う物なら1枚引ける' : ''}`;
    }
    if (c.type === 'part') return c.any ? `強調。どの動詞でも×${c.any}（動詞より先に置く）` : `動詞の前に置く。「${c.word}」を取る動詞なら×1.5、違うと文法ミスで×0.8`;
    if (c.type === 'aux') return `動詞のあとに付ける。${c.desc}`;
    return `伏せておくと自動で反応（発動するか選べる）。${c.desc}`;
  }

  window.Koto = {
    MAX_HP,
    SLOTS,
    HAND_MAX,
    START_HAND,
    KIND,
    ACT,
    ACT_DESC,
    CARDS,
    TYPE_NAME,
    DECKS,
    newSentence,
    defense,
    canAttach,
    attach,
    text,
    pieces,
    evaluate,
    shuffle,
    describe,
  };
})();
