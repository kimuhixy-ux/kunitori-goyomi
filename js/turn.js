// 季節の終わりの処理。CPU の行動 → 秋なら収穫 → 兵糧の消費 → 次の季節の出来事 → 勝ち負けの判定、の順に進める
import * as G from './game.js';
import { cpuTurn } from './ai.js';
import { seasonEvents, clearSeasonEffects } from './events.js';

function fmt(n) {
  return n.toLocaleString('ja-JP');
}

function clanName(game, id) {
  return `${G.clanInfo(game, id).name}家`;
}

function battleLine(game, r) {
  const outcome = r.won ? `${r.to}を奪った` : '退けられた';
  const tactic = r.tactic && r.tactic !== 'assault' ? `${G.TACTICS[r.tactic]}で` : '';
  return `${clanName(game, r.attacker)}が${r.from}から${r.to}（${clanName(game, r.defender)}）へ${fmt(r.size)}で${tactic}攻め込み、${outcome}。`;
}

// 他家どうしの調略までは知らせない。自分の家臣が狙われたときだけ伝える
function plotLine(game, r) {
  const outcome = r.ok ? `${r.name}は寝返った。` : `${r.name}は誘いを断った。`;
  return { text: `${clanName(game, r.attacker)}が${r.to}の${r.name}に寝返りを持ちかけた。${outcome}`, mine: true };
}

// 大きくなった同盟相手は、季節の初めに約束を破ってそのまま攻めてくることがある
function rollBetrayals(game, rand) {
  const lines = [];
  for (const key of Object.keys(game.alliances)) {
    const [a, b] = key.split('|');
    const betrayer = G.troopsOf(game, a) >= G.troopsOf(game, b) ? a : b;
    const victim = betrayer === a ? b : a;
    if (!game.clans[a].alive || !game.clans[b].alive) {
      delete game.alliances[key];
      continue;
    }
    if (betrayer === game.player || rand() >= G.betrayChance(game, betrayer, victim)) continue;
    G.betray(game, betrayer, victim);
    if (victim === game.player) lines.push({ text: `${clanName(game, betrayer)}が同盟を破った！`, mine: true });
  }
  return lines;
}

function runCpu(game, rand) {
  const lines = rollBetrayals(game, rand);
  const order = game.data.clans.map((c) => c.id).filter((id) => id !== game.player && game.clans[id].alive);
  order.sort(() => rand() - 0.5);
  for (const id of order) {
    if (!game.clans[id].alive) continue;
    const partner = G.cpuAlly(game, id, rand);
    if (partner) lines.push({ text: `${clanName(game, id)}と${clanName(game, partner)}が同盟を結んだ。` });
    for (const r of cpuTurn(game, id, rand)) {
      const mine = r.defender === game.player;
      if (r.plot) {
        if (mine) lines.push(plotLine(game, r));
        continue;
      }
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
    // 兵を養えない主君からは家臣の心も離れる
    G.changeLoyalty(game, id, -game.data.rules.loyalty.starve);
    if (id === game.player) lines.push({ text: '兵糧が尽き、兵が逃げ出した（各国の兵 -15%）。家臣の忠誠が下がった。', mine: true });
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
    const rate = Math.max(minHarvestRate, 1 - busyPenalty * p.busy) * unrest * (p.crop ?? 1);
    game.clans[p.clan].rice += Math.round(amount * rate);
    if (p.clan === game.player) {
      full += amount;
      got += Math.round(amount * rate);
    }
    p.busy = 0;
    p.crop = 1;
  }
  const loss = full - got;
  const note = loss > 0 ? `（動員・民心・凶作で -${fmt(loss)}）` : loss < 0 ? `（豊作で +${fmt(-loss)}）` : '';
  return [{ text: `秋の収穫：兵糧 +${fmt(got)}${note}`, mine: true }];
}

// 処遇を決めないまま季節を越した捕虜は、そのまま解き放つ（情けをかけたことにはならない）
function releaseLeftCaptives(game) {
  const lines = [];
  for (const g of game.generals.filter((x) => x.alive && x.captive === game.player)) {
    G.releaseCaptive(game, g, false);
    lines.push({ text: `処遇を決めなかった${g.name}を解き放った。`, mine: true });
  }
  return lines;
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
  lines.push(...payUpkeep(game), ...releaseLeftCaptives(game));
  for (const p of game.provinces) {
    p.acted = false;
    if (p.unrest) p.unrest -= 1;
  }
  clearSeasonEffects(game);
  game.season = (game.season + 1) % 4;
  if (game.season === 0) game.year += 1;
  lines.push(...seasonEvents(game, rand));
  // 領国の数の移り変わりは年の初めに一度だけ記録する
  if (game.season === 0) game.stats.history.push({ year: game.year, count: G.provincesOf(game, game.player).length });
  judge(game);
  return lines;
}
