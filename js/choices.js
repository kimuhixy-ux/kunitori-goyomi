// 季節の初めに、ときどき二択のお伺いが来る。どちらを選んでも得と損があり、答えで家の行く末が変わる
import * as G from './game.js';

const clanName = (game, id) => `${G.clanInfo(game, id).name}家`;

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

function myNeighbors(game) {
  return [...new Set(G.provincesOf(game, game.player).flatMap((p) => G.neighbors(game, p)))].filter((n) => n.clan !== game.player);
}

// 縁組の申し入れ。包囲網のさなかは、どの家も手を組まない
function marriageOffer(game, rand) {
  if (G.underSiege(game, game.player)) return null;
  const clans = [...new Set(myNeighbors(game).map((n) => n.clan))].filter((c) => !G.allied(game, game.player, c));
  return clans.length ? { kind: 'marriage', clan: pick(clans, rand) } : null;
}

// 忠誠の揺らいでいる家臣について、ほかの家臣が知らせてくる
function deserterReport(game, rand) {
  const { leave } = game.data.rules.loyalty;
  const list = game.generals.filter((g) => g.alive && !g.captive && !g.lord && g.clan === game.player && g.loyalty < leave + 10);
  return list.length ? { kind: 'deserter', generalId: pick(list, rand).id } : null;
}

// 敵の城から内応の申し出。罠のこともある
function insiderOffer(game, rand) {
  const list = myNeighbors(game).filter((n) => !G.allied(game, game.player, n.clan) && G.truceLeft(game, game.player, n.clan) === 0);
  return list.length ? { kind: 'insider', provinceId: pick(list, rand).id } : null;
}

// 季節が改まった直後に呼ぶ。お伺いは一度に一つまで
export function rollChoice(game, rand) {
  if (game.result || rand() >= game.data.rules.choice.chance) return;
  const makers = [marriageOffer, deserterReport, insiderOffer];
  const start = Math.floor(rand() * makers.length);
  // 選んだ種類が起こせないときは、次の種類に回す
  for (let i = 0; i < makers.length; i++) {
    const choice = makers[(start + i) % makers.length](game, rand);
    if (choice) {
      game.pending = choice;
      return;
    }
  }
}

// 画面に出す問いと二つの答え
export function describeChoice(game, c) {
  const { insiderCost } = game.data.rules.choice;
  if (c.kind === 'marriage') {
    return { title: '縁組の申し入れ', text: `${clanName(game, c.clan)}から縁組の申し入れが来た。受ければ婚姻同盟となる。断れば恨まれ、しばらく攻められやすくなる。`, yes: '受ける', no: '断る' };
  }
  if (c.kind === 'deserter') {
    const g = game.generals.find((x) => x.id === c.generalId);
    return { title: '家臣の不穏な動き', text: `${g.name}（忠誠${g.loyalty}）が他家へ走ろうとしているとの知らせ。罰すれば家中は引き締まるが、${g.name}を失う。許せば忠誠が上がる。`, yes: '許す', no: '罰する' };
  }
  const p = G.province(game, c.provinceId);
  return { title: '内応の申し出', text: `${p.name}（${clanName(game, p.clan)}）の城から内応の申し出。兵糧${insiderCost}で応じれば、この季節は${p.name}の守りが大きく弱まる。ただし罠かもしれない。`, yes: '応じる', no: '疑って断る' };
}

// 季節のあいだに相手が滅んだり、家臣がいなくなったりしていれば、お伺いは立ち消えになる
function stillValid(game, c) {
  if (c.kind === 'marriage') return game.clans[c.clan].alive && !G.allied(game, game.player, c.clan);
  if (c.kind === 'deserter') return game.generals.some((g) => g.id === c.generalId && g.alive && !g.captive && g.clan === game.player);
  return G.province(game, c.provinceId).clan !== game.player;
}

function answerMarriage(game, c, yes) {
  if (yes) {
    G.acceptMarriage(game, c.clan);
    return [`${clanName(game, c.clan)}と婚姻同盟を結んだ。`];
  }
  game.grudges[c.clan] = G.turnIndex(game) + game.data.rules.choice.grudgeSeasons;
  return [`縁組を断った。${clanName(game, c.clan)}は恨みを抱いた。`];
}

function answerDeserter(game, c, yes) {
  const { forgive, punish } = game.data.rules.choice;
  const g = game.generals.find((x) => x.id === c.generalId);
  if (yes) {
    g.loyalty = Math.min(game.data.rules.loyalty.max, g.loyalty + forgive);
    return [`${g.name}を許した。忠誠が${forgive}上がった（${g.loyalty}）。`];
  }
  g.alive = false;
  G.changeLoyalty(game, game.player, punish);
  G.chronicle(game, `${g.name}を罰した。`);
  return [`${g.name}を罰した。ほかの家臣の忠誠が${punish}上がった。`];
}

// 罠なら、隣り合うこちらの国が伏兵に遭う
function answerInsider(game, c, yes, rand) {
  if (!yes) return ['内応の申し出を退けた。'];
  const { insiderCost, insiderTrue, trapLoss } = game.data.rules.choice;
  const p = G.province(game, c.provinceId);
  const clan = game.clans[game.player];
  if (clan.rice < insiderCost) return ['兵糧が足りず、申し出に応じられなかった。'];
  clan.rice -= insiderCost;
  if (rand() < insiderTrue) {
    p.insider = true;
    return [`内応の約束を取りつけた。この季節、${p.name}の守りは弱い。`];
  }
  const mine = G.neighbors(game, p).filter((n) => n.clan === game.player).sort((a, b) => b.troops - a.troops)[0];
  if (!mine) return ['罠だった。使者が討たれ、兵糧だけを失った。'];
  const loss = Math.floor(mine.troops * trapLoss);
  mine.troops -= loss;
  return [`罠だった。${mine.name}が伏兵に遭い、兵 -${loss.toLocaleString('ja-JP')}。`];
}

// yes は「受ける・許す・応じる」の側。答えたらお伺いは消える
export function answerChoice(game, yes, rand = Math.random) {
  const c = game.pending;
  game.pending = null;
  if (!c) return [];
  if (!stillValid(game, c)) return ['お伺いは立ち消えになった。'];
  if (c.kind === 'marriage') return answerMarriage(game, c, yes);
  if (c.kind === 'deserter') return answerDeserter(game, c, yes);
  return answerInsider(game, c, yes, rand);
}

// 返事をしないまま季節を終えたときは、断ったものとして扱う。ただし家臣の件は罰せず捨て置く
export function ignoreChoice(game, rand = Math.random) {
  if (game.pending?.kind !== 'deserter') return answerChoice(game, false, rand);
  game.pending = null;
  return ['家臣の件は捨て置いた。'];
}
