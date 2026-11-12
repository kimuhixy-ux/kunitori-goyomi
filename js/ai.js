// CPU 大名の判断。強い手を読むより「戦国大名らしく見える」素直な優先順位にしている
import * as G from './game.js';

const RICE_RESERVE_SEASONS = 2;

function shuffle(list, rand) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function upkeep(game, clanId) {
  return Math.ceil((G.troopsOf(game, clanId) / 100) * game.data.rules.upkeepPer100);
}

function enemyNeighbors(game, p) {
  return G.neighbors(game, p).filter((n) => n.clan !== p.clan);
}

// 出陣後に残る兵で、ほかの隣国が攻めてこない程度の守りが保てるか（留守を突かれて国を失わないため）
function safeToLeave(game, p, target, size) {
  const left = (p.troops - size) * G.defenseFactor(game, p);
  return enemyNeighbors(game, p)
    .filter((n) => n !== target)
    .every((n) => G.marchSize(n, 0.8) < left * aggressionOf(game, n.clan));
}

// 攻めっ気（何倍の兵力差で攻めるか）は大名ごとに data/clans.json で決める。プレイヤーには平均的な値を仮に当てる
function aggressionOf(game, clanId) {
  return G.clanInfo(game, clanId).aggression ?? 1.15;
}

function tryAttack(game, p, rand) {
  const targets = enemyNeighbors(game, p).filter((n) => G.canMarch(game, p, n, 0.5));
  if (targets.length === 0) return null;
  const weakest = targets.reduce((a, b) => (G.defensePower(game, a) <= G.defensePower(game, b) ? a : b));
  for (const ratio of [0.8, 0.6]) {
    const size = G.marchSize(p, ratio);
    if (size * G.attackFactor(game, p) < G.defensePower(game, weakest) * aggressionOf(game, p.clan) || !safeToLeave(game, p, weakest, size)) continue;
    return G.march(game, p, weakest, ratio, rand);
  }
  return null;
}

// 敵と接していない国の兵は、いちばん危ない前線の国へ送る
function tryReinforce(game, p) {
  if (enemyNeighbors(game, p).length > 0 || p.troops < 500) return false;
  const front = G.neighbors(game, p)
    .filter((n) => G.canMove(game, p, n))
    .sort((a, b) => enemyNeighbors(game, b).length - enemyNeighbors(game, a).length)[0];
  // 内地に武将が2人以上いれば、統率のいちばん高い者を前線へ出す
  const generals = G.generalsIn(game, p);
  return front ? G.move(game, p, front, 0.8, generals.length >= 2 ? generals[0].id : null) : false;
}

function tryRecruit(game, p) {
  const rice = game.clans[p.clan].rice;
  const plan = G.recruitPlan(game, p);
  const threatened = enemyNeighbors(game, p).some((n) => G.marchSize(n, 0.8) > G.defensePower(game, p));
  if (G.isBusySeason(game) && !threatened) return false;
  if (p.troops >= G.troopCap(game, p) * G.clanInfo(game, p.clan).army) return false;
  if (rice - plan.cost < upkeep(game, p.clan) * RICE_RESERVE_SEASONS) return false;
  return G.recruit(game, p);
}

export function cpuTurn(game, clanId, rand) {
  const reports = [];
  for (const p of shuffle(G.provincesOf(game, clanId), rand)) {
    if (p.acted || p.clan !== clanId) continue;
    const report = tryAttack(game, p, rand);
    if (report) {
      reports.push(report);
      continue;
    }
    if (tryReinforce(game, p) || tryRecruit(game, p)) continue;
    if (game.clans[clanId].rice > upkeep(game, clanId) * 4) G.develop(game, p);
  }
  return reports;
}
