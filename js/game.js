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
  return { data, provinces, clans, player: playerId, year: data.rules.startYear, season: 0, result: null };
}

// 保存するのは遊んでいるうちに変わる値だけ。地図や大名の設定は毎回 data/*.json から読み直す
export function snapshot(game) {
  return {
    player: game.player,
    year: game.year,
    season: game.season,
    result: game.result,
    clans: game.clans,
    provinces: game.provinces.map(({ id, clan, koku, troops, acted, busy }) => ({ id, clan, koku, troops, acted, busy })),
  };
}

export function restore(game, snap) {
  Object.assign(game, { player: snap.player ?? game.player, year: snap.year, season: snap.season, result: snap.result });
  for (const [id, c] of Object.entries(snap.clans)) {
    if (game.clans[id]) Object.assign(game.clans[id], c);
  }
  for (const s of snap.provinces) {
    const p = province(game, s.id);
    if (p) Object.assign(p, s);
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

function useAction(game, p) {
  p.acted = true;
  if (isBusySeason(game)) p.busy += 1;
}

export function canDevelop(game, p) {
  const { develop } = game.data.rules;
  return !p.acted && p.koku < p.baseKoku * develop.maxRate && game.clans[p.clan].rice >= develop.cost;
}

export function develop(game, p) {
  if (!canDevelop(game, p)) return false;
  game.clans[p.clan].rice -= game.data.rules.develop.cost;
  p.koku += game.data.rules.develop.gain;
  p.acted = true;
  return true;
}

export function troopCap(game, p) {
  return p.koku * game.data.rules.troopsPerKoku;
}

export function recruitPlan(game, p) {
  const { recruit } = game.data.rules;
  const amount = Math.max(0, Math.min(p.koku * recruit.perKoku, troopCap(game, p) - p.troops));
  return { amount, cost: Math.ceil((amount / 100) * recruit.costPer100) };
}

export function canRecruit(game, p) {
  const plan = recruitPlan(game, p);
  return !p.acted && plan.amount >= 100 && game.clans[p.clan].rice >= plan.cost;
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
  if (snowedIn(game, from) || snowedIn(game, to)) return false;
  return size >= game.data.rules.minMarch && game.clans[from.clan].rice >= marchCost(game, size);
}

// 守りの倍率。農繁期は兵が田畑に出ていて手薄になる（攻める側は収穫を削ってでもそこを突ける）
export function defenseFactor(game, p) {
  const { castleBonus, busyDefense } = game.data.rules;
  return (1 + castleBonus * p.castle) * (isBusySeason(game) ? busyDefense : 1);
}

// 勝算の目安にも使う
export function defensePower(game, p) {
  return p.troops * defenseFactor(game, p);
}

export function march(game, from, to, ratio, rand = Math.random) {
  if (!canMarch(game, from, to, ratio)) return null;
  const size = marchSize(from, ratio);
  const attacker = from.clan;
  const defender = to.clan;
  from.troops -= size;
  game.clans[attacker].rice -= marchCost(game, size);
  useAction(game, from);
  const result = fight(game, size, to, defenseFactor(game, to), rand);
  if (result.won) {
    takeProvince(game, to, attacker, result);
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
  Object.assign(to, { clan: attacker, troops: result.attackerLeft, acted: true, busy: 0 });
}

function updateAlive(game, clanId) {
  if (provincesOf(game, clanId).length === 0) game.clans[clanId].alive = false;
}

export function canMove(game, from, to) {
  return !from.acted && to.clan === from.clan && from.adj.includes(to.id) && marchSize(from, 0.8) >= 100;
}

export function move(game, from, to, ratio) {
  if (!canMove(game, from, to)) return false;
  const size = marchSize(from, ratio);
  from.troops -= size;
  to.troops += size;
  from.acted = true;
  return true;
}
