// 軍師の進言。ゲームの中身は変えず、今の数字から「この国でやるとよい命令」を理由つきで並べるだけにする。
// 点数（score）が高いほど急ぐもの。初心者が迷ったときの目安なので、強い手を読み切ることはしない
import * as G from './game.js';

const fmt = (n) => n.toLocaleString('ja-JP');
const clanName = (game, id) => `${G.clanInfo(game, id).name}家`;

// 攻めてきうる隣国。同盟・和睦の相手や、雪・長雨で動けない国は数えない
function threats(game, p) {
  return G.neighbors(game, p).filter((n) => n.clan !== p.clan && !G.allied(game, p.clan, n.clan)
    && G.truceLeft(game, p.clan, n.clan) === 0 && !G.snowedIn(game, n) && !n.rain);
}

function attackPower(game, n) {
  return G.marchSize(n, 0.8) * G.attackFactor(game, n);
}

// いちばん怖い隣国と、その攻める力
function worstThreat(game, p) {
  return threats(game, p).map((n) => ({ n, power: attackPower(game, n) }))
    .sort((a, b) => b.power - a.power)[0] ?? null;
}

function defenseAdvice(game, p, threat) {
  const why = `${threat.n.name}（${clanName(game, threat.n.clan)}）に攻め込まれるおそれがある（攻める力 ${fmt(Math.round(threat.power))}／守りの力 ${fmt(Math.round(G.defensePower(game, p)))}）。`;
  const list = [];
  if (G.canRecruit(game, p)) list.push({ score: 90, title: '徴兵', why: `${why}兵を集めて守りを固める。` });
  if (G.canFortify(game, p)) list.push({ score: 85, title: '築城', why: `${why}城を堅くして守りの倍率を上げる。` });
  const chance = G.truceChance(game, p.clan, threat.n.clan);
  if (G.canTruce(game, p, threat.n.clan) && chance >= 0.2) {
    list.push({ score: 80, title: `和睦：${clanName(game, threat.n.clan)}`, why: `${why}1年間たがいに攻めない約束をする。応じる見込み${Math.round(chance * 100)}%。` });
  }
  // 同じ理由を何行も繰り返すと読みにくいので、2つ目からは手立てだけを書く
  return list.map((a, i) => (i === 0 ? a : { ...a, why: a.why.slice(why.length) }));
}

// 出したあとの留守を、ほかの隣国に突かれないか
function safeToLeave(game, p, target, size) {
  const left = (p.troops - size) * G.defenseFactor(game, p);
  return threats(game, p).filter((n) => n !== target).every((n) => attackPower(game, n) < left);
}

function attackAdvice(game, p) {
  const list = [];
  for (const n of G.neighbors(game, p).filter((x) => x.clan !== p.clan)) {
    const power = G.defensePower(game, n);
    for (const [ratio, label] of [[0.5, '半数'], [0.8, '8割']]) {
      const size = G.marchSize(p, ratio);
      const edge = (size * G.attackFactor(game, p)) / Math.max(1, power);
      if (!G.canMarch(game, p, n, ratio) || edge < 1.3 || !safeToLeave(game, p, n, size)) continue;
      const busy = G.isBusySeason(game) ? '農繁期なので敵の守りも手薄。' : '';
      list.push({ score: 75 + Math.min(10, (edge - 1.3) * 10) - (ratio === 0.8 ? 2 : 0), title: `出陣：${n.name}へ${label}`, why: `${n.name}（${clanName(game, n.clan)}）の守りの力 ${fmt(Math.round(power))} に対して有利。留守も守れる。${busy}` });
      break;
    }
  }
  return list;
}

function loyaltyAdvice(game, p) {
  const target = G.rewardTarget(game, p);
  const { leave } = game.data.rules.loyalty;
  if (!target || target.loyalty >= leave + 15 || !G.canReward(game, p)) return [];
  return [{ score: target.loyalty < leave ? 88 : 65, title: `褒美：${target.name}`, why: `忠誠${target.loyalty}。${leave}を切ると出奔のおそれがあり、敵の調略にも乗りやすい。` }];
}

function diplomacyAdvice(game, p) {
  const list = [];
  for (const n of G.neighbors(game, p).filter((x) => x.clan !== p.clan)) {
    const chance = G.plotChance(game, p, n);
    const target = G.plotTarget(game, n);
    if (target && G.canPlot(game, p, n) && chance >= 0.4) {
      list.push({ score: 55, title: `調略：${n.name}の${target.name}`, why: `成功の見込み${Math.round(chance * 100)}%。寝返れば敵の国が弱まり、こちらの武将が増える。` });
    }
  }
  const clans = [...new Set(threats(game, p).map((n) => n.clan))];
  for (const c of clans) {
    const chance = G.allianceChance(game, p.clan, c);
    if (G.troopsOf(game, c) > G.troopsOf(game, p.clan) * 1.5 && G.canAlly(game, p, c) && chance >= 0.2) {
      list.push({ score: 58, title: `同盟：${clanName(game, c)}`, why: `相手の兵はこちらの1.5倍を超える。敵に回すより組んだほうがよい。応じる見込み${Math.round(chance * 100)}%。` });
    }
  }
  return list;
}

// 敵と接していない国は、兵を前線へ送るのが仕事
function frontAdvice(game, p) {
  if (G.neighbors(game, p).some((n) => n.clan !== p.clan)) return [];
  const front = G.neighbors(game, p).find((n) => G.canMove(game, p, n) && G.neighbors(game, n).some((x) => x.clan !== p.clan));
  if (!front || p.troops < 1000) return [];
  return [{ score: 60, title: `移動：${front.name}へ`, why: '敵と接していないので、兵を置いておいても役に立たない。前線へ送る。' }];
}

function growthAdvice(game, p) {
  const list = [];
  const busy = G.isBusySeason(game);
  if (G.canDevelop(game, p)) {
    list.push({ score: busy ? 50 : 42, title: '開墾', why: `石高を増やし、秋の収穫と兵の上限を伸ばす。${busy ? '農繁期でも収穫は減らない。' : ''}` });
  }
  if (G.canRecruit(game, p) && p.troops < G.troopCap(game, p) * 0.6) {
    list.push({ score: busy ? 35 : 48, title: '徴兵', why: `兵が上限の6割に届いていない。${busy ? 'ただし農繁期なので秋の収穫が減る。' : ''}` });
  }
  return list;
}

// 兵糧が乏しいと、費用のかかる命令を勧めても季節を越せない
function riceWarning(game) {
  const clan = game.clans[game.player];
  const upkeep = Math.ceil((G.troopsOf(game, game.player) / 100) * game.data.rules.upkeepPer100);
  if (clan.rice >= upkeep * 2) return null;
  return { score: 70, title: '兵糧を温存', why: `兵糧が${fmt(clan.rice)}しかない。毎季節${fmt(upkeep)}使うので、費用のかかる命令は控え、秋の収穫を待つ。` };
}

// この国への進言を、急ぐものから並べて返す
export function advise(game, p) {
  if (p.clan !== game.player || p.acted) return [];
  const threat = worstThreat(game, p);
  // CPU は攻めっ気（兵力差の倍率）を満たしたときに攻めてくるので、その少し手前から危ないと見る
  const aggression = threat ? G.clanInfo(game, threat.n.clan).aggression ?? 1.15 : 1;
  const danger = threat && threat.power >= G.defensePower(game, p) * aggression * 0.9;
  const list = [
    ...(danger ? defenseAdvice(game, p, threat) : attackAdvice(game, p)),
    ...loyaltyAdvice(game, p),
    ...diplomacyAdvice(game, p),
    ...frontAdvice(game, p),
    ...growthAdvice(game, p),
  ];
  const rice = riceWarning(game);
  if (rice) list.push(rice);
  if (list.length === 0) list.push({ score: 0, title: '様子見', why: 'いま急いでやることはない。命令せずに季節を進めてもよい。' });
  // 守りの徴兵と育てる徴兵が重なったときは、急ぐほうだけ残す
  const seen = new Set();
  return list.sort((a, b) => b.score - a.score).filter((a) => !seen.has(a.title) && seen.add(a.title));
}
