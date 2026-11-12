// 国と大名家の状態、命令ひとつひとつのルールを置く。プレイヤーも CPU も同じ命令を使う
import { fight } from './battle.js';

// playerId を省くと clans.json で player の印がついた家（織田）になる。古い保存を読むときのため
export function createGame(data, playerId = data.clans.find((c) => c.player).id) {
  const provinces = data.provinces.provinces.map((p) => ({ ...p, baseKoku: p.koku, acted: false, busy: 0, adj: [] }));
  for (const [a, b] of data.provinces.edges) {
    provinces.find((p) => p.id === a).adj.push(b);
    provinces.find((p) => p.id === b).adj.push(a);
  }
  const clans = {};
  for (const c of data.clans) clans[c.id] = { rice: 0, alive: true };
  for (const p of provinces) clans[p.clan].rice += Math.round(p.koku * data.rules.startRicePerKoku);
  const generals = data.generals.map((g) => ({ ...g, alive: true }));
  return { data, provinces, clans, generals, truces: {}, player: playerId, year: data.rules.startYear, season: 0, result: null };
}

// 保存するのは遊んでいるうちに変わる値だけ。地図や大名の設定は毎回 data/*.json から読み直す
export function snapshot(game) {
  return {
    player: game.player,
    year: game.year,
    season: game.season,
    result: game.result,
    clans: game.clans,
    truces: game.truces,
    provinces: game.provinces.map(({ id, clan, koku, troops, castle, unrest, acted, busy }) => ({ id, clan, koku, troops, castle, unrest, acted, busy })),
    generals: game.generals.map(({ id, clan, loc, alive }) => ({ id, clan, loc, alive })),
  };
}

export function restore(game, snap) {
  Object.assign(game, { player: snap.player ?? game.player, year: snap.year, season: snap.season, result: snap.result, truces: snap.truces ?? {} });
  for (const [id, c] of Object.entries(snap.clans)) {
    if (game.clans[id]) Object.assign(game.clans[id], c);
  }
  for (const s of snap.provinces) {
    const p = province(game, s.id);
    if (p) Object.assign(p, s);
  }
  // 武将が入る前の保存では、武将は最初の配置のまま
  for (const s of snap.generals ?? []) {
    const g = game.generals.find((x) => x.id === s.id);
    if (g) Object.assign(g, s);
  }
  return game;
}

export function province(game, id) {
  return game.provinces.find((p) => p.id === id);
}

export function clanInfo(game, id) {
  return game.data.clans.find((c) => c.id === id);
}

export function neighbors(game, p) {
  return p.adj.map((id) => province(game, id));
}

export function provincesOf(game, clanId) {
  return game.provinces.filter((p) => p.clan === clanId);
}

export function troopsOf(game, clanId) {
  return provincesOf(game, clanId).reduce((sum, p) => sum + p.troops, 0);
}

export function seasonName(game) {
  return game.data.rules.seasons[game.season];
}

export function isBusySeason(game) {
  return game.data.rules.busySeasons.includes(game.season);
}

function isWinter(game) {
  return game.season === game.data.rules.winterSeason;
}

// 雪国は冬のあいだ出陣も攻め込まれることもない（越後や越前が冬に動けなかったことに倣う）
export function snowedIn(game, p) {
  return isWinter(game) && p.snow;
}

// その国にいる自分の家の武将。統率の高い順に並べ、先頭を大将や守将にする
export function generalsIn(game, p) {
  return game.generals.filter((g) => g.alive && g.loc === p.id && g.clan === p.clan).sort((a, b) => b.lead - a.lead);
}

// 国の働きは、その国にいる武将のうちいちばん得意な者の能力で決まる。武将がいなければ並以下の値
function bestStat(game, p, key) {
  return Math.max(game.data.rules.generals.noneStat, ...generalsIn(game, p).map((g) => g[key]));
}

// 統率50で1倍。統率100なら1.25倍、武将なしなら0.9倍
function leadFactor(lead) {
  return 0.75 + lead / 200;
}

export function attackFactor(game, p, commander = generalsIn(game, p)[0]) {
  return leadFactor(commander?.lead ?? game.data.rules.generals.noneStat);
}

// 政務50で表どおりの費用。政務が高いほど安く、低いほど高くつく
export function developCost(game, p) {
  return Math.round(game.data.rules.develop.cost * (1.5 - bestStat(game, p, 'admin') / 100));
}

function useAction(game, p) {
  p.acted = true;
  if (isBusySeason(game)) p.busy += 1;
}

export function canDevelop(game, p) {
  const { develop } = game.data.rules;
  return !p.acted && p.koku < p.baseKoku * develop.maxRate && game.clans[p.clan].rice >= developCost(game, p);
}

export function develop(game, p) {
  if (!canDevelop(game, p)) return false;
  game.clans[p.clan].rice -= developCost(game, p);
  p.koku += game.data.rules.develop.gain;
  p.acted = true;
  return true;
}

export function troopCap(game, p) {
  return p.koku * game.data.rules.troopsPerKoku;
}

export function recruitPlan(game, p) {
  const { recruit } = game.data.rules;
  // 政務の高い武将がいる国ほど人が集まる（政務50で表どおり）
  const gather = Math.floor((p.koku * recruit.perKoku * (0.75 + bestStat(game, p, 'admin') / 200)) / 10) * 10;
  const amount = Math.max(0, Math.min(gather, troopCap(game, p) - p.troops));
  return { amount, cost: Math.ceil((amount / 100) * recruit.costPer100) };
}

export function canRecruit(game, p) {
  const plan = recruitPlan(game, p);
  return !p.acted && !p.unrest && plan.amount >= 100 && game.clans[p.clan].rice >= plan.cost;
}

export function recruit(game, p) {
  if (!canRecruit(game, p)) return false;
  const plan = recruitPlan(game, p);
  game.clans[p.clan].rice -= plan.cost;
  p.troops += plan.amount;
  useAction(game, p);
  return true;
}

export function marchSize(p, ratio) {
  return Math.floor((p.troops * ratio) / 10) * 10;
}

export function marchCost(game, size) {
  return Math.ceil((size / 100) * game.data.rules.marchCostPer100);
}

export function canMarch(game, from, to, ratio) {
  const size = marchSize(from, ratio);
  if (from.acted || to.clan === from.clan || !from.adj.includes(to.id)) return false;
  if (snowedIn(game, from) || snowedIn(game, to) || truceLeft(game, from.clan, to.clan) > 0) return false;
  return size >= game.data.rules.minMarch && game.clans[from.clan].rice >= marchCost(game, size);
}

// 守りの倍率。農繁期は兵が田畑に出ていて手薄になる（攻める側は収穫を削ってでもそこを突ける）
export function defenseFactor(game, p) {
  const { castleBonus, busyDefense } = game.data.rules;
  return (1 + castleBonus * p.castle) * (isBusySeason(game) ? busyDefense : 1) * leadFactor(bestStat(game, p, 'lead'));
}

// 勝算の目安にも使う
export function defensePower(game, p) {
  return p.troops * defenseFactor(game, p);
}

// 大将を省くと、その国でいちばん統率の高い武将が出る
export function march(game, from, to, ratio, rand = Math.random, commanderId = null) {
  if (!canMarch(game, from, to, ratio)) return null;
  const size = marchSize(from, ratio);
  const attacker = from.clan;
  const defender = to.clan;
  const commander = generalsIn(game, from).find((g) => g.id === commanderId) ?? generalsIn(game, from)[0];
  const keeper = generalsIn(game, to)[0];
  from.troops -= size;
  game.clans[attacker].rice -= marchCost(game, size);
  useAction(game, from);
  const result = fight(game, size, to, defenseFactor(game, to), rand, attackFactor(game, from, commander));
  result.lines.unshift(`大将 ${commander?.name ?? 'なし'}／守将 ${keeper?.name ?? 'なし'}`);
  if (result.won) {
    result.lines.push(...displaceGenerals(game, to, attacker, rand));
    takeProvince(game, to, attacker, result);
    if (commander) commander.loc = to.id;
  } else {
    from.troops += result.attackerLeft;
    to.troops = result.defenderLeft;
  }
  updateAlive(game, defender);
  return { ...result, attacker, defender, from: from.name, to: to.name, size };
}

// 負けた側の生き残りは隣の味方の国へ落ちのびる。行き場がなければ散り散りになる
function takeProvince(game, to, attacker, result) {
  const refuge = neighbors(game, to).find((n) => n.clan === to.clan);
  if (refuge) refuge.troops += result.defenderLeft;
  // 奪ったばかりの国は民が従わず、しばらく収穫が減り兵も集まらない
  Object.assign(to, { clan: attacker, troops: result.attackerLeft, acted: true, busy: 0, unrest: game.data.rules.unrest.seasons });
}

// 城を落とされた国の武将は味方の国へ落ちのびる。逃げ場がなければ捕らえられ、当主は討たれ、家臣は降るか去る
function displaceGenerals(game, to, attacker, rand) {
  const refuge = neighbors(game, to).find((n) => n.clan === to.clan);
  const lines = [];
  for (const g of generalsIn(game, to)) {
    if (refuge) {
      g.loc = refuge.id;
    } else if (!g.lord && rand() < game.data.rules.generals.joinChance) {
      g.clan = attacker;
      lines.push(`${g.name}が降り、家臣に加わった。`);
    } else {
      g.alive = false;
      lines.push(g.lord ? `${g.name}は討たれた。` : `${g.name}は行方知れずになった。`);
    }
  }
  return lines;
}

function updateAlive(game, clanId) {
  if (provincesOf(game, clanId).length === 0) game.clans[clanId].alive = false;
}

export function canMove(game, from, to) {
  return !from.acted && to.clan === from.clan && from.adj.includes(to.id) && marchSize(from, 0.8) >= 100;
}

// generalId を渡すと、その武将も兵といっしょに移る
export function move(game, from, to, ratio, generalId = null) {
  if (!canMove(game, from, to)) return false;
  const size = marchSize(from, ratio);
  const general = generalsIn(game, from).find((g) => g.id === generalId);
  if (general) general.loc = to.id;
  from.troops -= size;
  to.troops += size;
  from.acted = true;
  return true;
}

// 季節を通し番号にする。和睦の期限を年をまたいで数えるため
export function turnIndex(game) {
  return (game.year - game.data.rules.startYear) * 4 + game.season;
}

function truceKey(a, b) {
  return [a, b].sort().join('|');
}

// 和睦の残り季節数。0 なら和睦していない
export function truceLeft(game, a, b) {
  return Math.max(0, (game.truces[truceKey(a, b)] ?? 0) - turnIndex(game));
}

export function fortifyCost(game, p) {
  return game.data.rules.fortify.cost * (p.castle + 1);
}

export function canFortify(game, p) {
  return !p.acted && p.castle < game.data.rules.fortify.max && game.clans[p.clan].rice >= fortifyCost(game, p);
}

// 普請には人手がいるので、農繁期なら動員として数える
export function fortify(game, p) {
  if (!canFortify(game, p)) return false;
  game.clans[p.clan].rice -= fortifyCost(game, p);
  p.castle += 1;
  useAction(game, p);
  return true;
}

// 寝返らせる相手は、相手の国でいちばん政務の低い家臣（主家への忠義を説かれにくい者）。当主は寝返らない
export function plotTarget(game, to) {
  return generalsIn(game, to).filter((g) => !g.lord).sort((a, b) => a.admin - b.admin)[0] ?? null;
}

// 仕掛ける側の政務が相手の家臣の政務を上回るほど成功しやすい
export function plotChance(game, from, to) {
  const target = plotTarget(game, to);
  if (!target) return 0;
  const { base, max } = game.data.rules.plot;
  return Math.min(max, Math.max(0.05, base + (bestStat(game, from, 'admin') - target.admin) / 150));
}

export function canPlot(game, from, to) {
  return !from.acted && to.clan !== from.clan && from.adj.includes(to.id)
    && plotTarget(game, to) !== null && game.clans[from.clan].rice >= game.data.rules.plot.cost;
}

export function plot(game, from, to, rand = Math.random) {
  if (!canPlot(game, from, to)) return null;
  const target = plotTarget(game, to);
  const chance = plotChance(game, from, to);
  game.clans[from.clan].rice -= game.data.rules.plot.cost;
  from.acted = true;
  if (rand() >= chance) return { ok: false, name: target.name };
  Object.assign(target, { clan: from.clan, loc: from.id });
  return { ok: true, name: target.name };
}

// 天下を取りかけた家には、まわりの大名が手を組んで当たる
export function underSiege(game, clanId) {
  return clanId === game.player && provincesOf(game, clanId).length >= game.data.rules.siege.provinces;
}

export function truceCost(game, other) {
  return game.data.rules.truce.costPerProvince * provincesOf(game, other).length;
}

// 相手より兵が多いほど和睦に応じやすい。包囲網のさなかは誰も応じない
export function truceChance(game, clanId, other) {
  if (underSiege(game, clanId)) return 0;
  const ratio = troopsOf(game, clanId) / Math.max(1, troopsOf(game, other));
  return Math.min(0.8, Math.max(0.1, 0.3 + (ratio - 1) * 0.3));
}

export function canTruce(game, from, other) {
  return !from.acted && other !== from.clan && truceLeft(game, from.clan, other) === 0
    && game.clans[from.clan].rice >= truceCost(game, other);
}

export function truce(game, from, other, rand = Math.random) {
  if (!canTruce(game, from, other)) return null;
  const chance = truceChance(game, from.clan, other);
  game.clans[from.clan].rice -= truceCost(game, other);
  from.acted = true;
  if (rand() >= chance) return false;
  game.truces[truceKey(from.clan, other)] = turnIndex(game) + game.data.rules.truce.seasons;
  return true;
}
