// 季節の終わりの処理。CPU の行動 → 兵糧の消費 → 秋なら収穫 → 勝ち負けの判定、の順に進める
import * as G from './game.js';
import { cpuTurn } from './ai.js';

function fmt(n) {
  return n.toLocaleString('ja-JP');
}

function clanName(game, id) {
  return `${G.clanInfo(game, id).name}家`;
}

function battleLine(game, r) {
  const outcome = r.won ? `${r.to}を奪った` : '退けられた';
  return `${clanName(game, r.attacker)}が${r.from}から${r.to}（${clanName(game, r.defender)}）へ${fmt(r.size)}で攻め込み、${outcome}。`;
}

function runCpu(game, rand) {
  const lines = [];
  const order = game.data.clans.map((c) => c.id).filter((id) => id !== game.player && game.clans[id].alive);
  order.sort(() => rand() - 0.5);
  for (const id of order) {
    if (!game.clans[id].alive) continue;
    for (const r of cpuTurn(game, id, rand)) {
      const mine = r.defender === game.player;
      lines.push({ text: battleLine(game, r), mine, detail: mine ? r.lines : null });
    }
  }
  return lines;
}

// 兵糧が尽きると兵が逃げる。大軍を抱えたまま冬を越せない緊張をつくるため
function payUpkeep(game) {
  const lines = [];
  for (const [id, clan] of Object.entries(game.clans)) {
    if (!clan.alive) continue;
    clan.rice -= Math.ceil((G.troopsOf(game, id) / 100) * game.data.rules.upkeepPer100);
    if (clan.rice >= 0) continue;
    clan.rice = 0;
    for (const p of G.provincesOf(game, id)) p.troops = Math.floor(p.troops * 0.85);
    if (id === game.player) lines.push({ text: '兵糧が尽き、兵が逃げ出した（各国の兵 -15%）。', mine: true });
  }
  return lines;
}

function harvest(game) {
  const { harvestPerKoku, busyPenalty, minHarvestRate } = game.data.rules;
  let full = 0;
  let got = 0;
  for (const p of game.provinces) {
    const amount = p.koku * harvestPerKoku;
    const unrest = p.unrest ? game.data.rules.unrest.harvestRate : 1;
    const rate = Math.max(minHarvestRate, 1 - busyPenalty * p.busy) * unrest;
    game.clans[p.clan].rice += Math.round(amount * rate);
    if (p.clan === game.player) {
      full += amount;
      got += Math.round(amount * rate);
    }
    p.busy = 0;
  }
  const loss = full - got;
  const note = loss > 0 ? `（農繁期の動員と民心の乱れで -${fmt(loss)}）` : '';
  return [{ text: `秋の収穫：兵糧 +${fmt(got)}${note}`, mine: true }];
}

function judge(game) {
  const { capital, provinces } = game.data.rules.victory;
  const mine = G.provincesOf(game, game.player);
  if (mine.length === 0) game.result = 'lose';
  else if (mine.length >= provinces && mine.some((p) => p.id === capital)) game.result = 'win';
}

export function endSeason(game, rand = Math.random) {
  const lines = runCpu(game, rand);
  // 秋は取れた米で兵を養うので、収穫を先にする
  if (game.season === game.data.rules.harvestSeason) lines.push(...harvest(game));
  lines.push(...payUpkeep(game));
  for (const p of game.provinces) {
    p.acted = false;
    if (p.unrest) p.unrest -= 1;
  }
  game.season = (game.season + 1) % 4;
  if (game.season === 0) game.year += 1;
  judge(game);
  return lines;
}
