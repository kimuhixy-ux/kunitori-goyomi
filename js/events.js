// 季節の始まりに起きる出来事と、武将の生き死に・出奔。毎季節の結果を読み切れなくし、兵糧の蓄えや家臣の扱いに意味を持たせる
import * as G from './game.js';

// 元服した若武者の名前。実在の人物と重なりにくいよう、よく使われる字を組み合わせて作る
const NAME_CHARS = ['信', '長', '秀', '義', '忠', '勝', '政', '景', '元', '氏', '直', '重', '家', '康', '光', '清', '高', '房', '利', '正', '昌', '輝', '宗', '時'];

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

// 自分の国の出来事だけを知らせる。他家の出来事まで並べると読み切れないため
function note(game, p, text) {
  return p.clan === game.player ? [{ text: `${p.name}：${text}`, mine: true }] : [];
}

// 夏に秋の実りの見込みが決まる
function rollCrop(game, p, rand) {
  const { bumper, poor, cropRate } = game.data.rules.events;
  const r = rand();
  if (r < bumper) {
    p.crop = 1 + cropRate;
    return note(game, p, `豊作の見込み。秋の収穫が${Math.round(cropRate * 10)}割増える。`);
  }
  if (r < bumper + poor) {
    p.crop = 1 - cropRate;
    return note(game, p, `凶作の見込み。秋の収穫が${Math.round(cropRate * 10)}割減る。`);
  }
  return [];
}

// 農繁期に兵を動かした国や、奪ったばかりの国では一揆が起きやすい
function rollRiot(game, p, rand) {
  const { riotBusy, riotUnrest, riotLoss } = game.data.rules.events;
  const chance = (p.busy > 0 ? riotBusy : 0) + (p.unrest ? riotUnrest : 0);
  if (chance === 0 || rand() >= chance) return [];
  const loss = Math.floor(p.troops * riotLoss);
  p.troops -= loss;
  p.unrest = Math.max(p.unrest ?? 0, 2);
  return note(game, p, `一揆が起きた。兵 -${loss.toLocaleString('ja-JP')}、民心が乱れた。`);
}

function rollProvince(game, p, rand) {
  const { rain, plague, plagueLoss } = game.data.rules.events;
  const lines = [];
  if (game.season === 1) lines.push(...rollCrop(game, p, rand));
  if (game.season !== game.data.rules.winterSeason && rand() < rain) {
    p.rain = true;
    lines.push(...note(game, p, '長雨。この季節は兵を出せず、攻め込まれもしない。'));
  }
  lines.push(...rollRiot(game, p, rand));
  if (rand() < plague) {
    const loss = Math.floor(p.troops * plagueLoss);
    p.troops -= loss;
    lines.push(...note(game, p, `疫病がはやった。兵 -${loss.toLocaleString('ja-JP')}。`));
  }
  return lines;
}

// 大雪の冬は、雪国に接する国まで雪に閉ざされる
function rollHeavySnow(game, rand) {
  if (game.season !== game.data.rules.winterSeason || rand() >= game.data.rules.events.heavySnow) return [];
  for (const p of game.provinces) {
    if (!p.snow && G.neighbors(game, p).some((n) => n.snow)) p.heavySnow = true;
  }
  return [{ text: '大雪の冬。雪国に接する国も雪に閉ざされた（❄）。', mine: true }];
}

// 年が進むほど、老いや病で亡くなる者が増える
function rollDeaths(game, rand) {
  const { death, deathPerYear } = game.data.rules.age;
  const chance = death + deathPerYear * (game.year - game.data.rules.startYear);
  const lines = [];
  for (const g of game.generals.filter((x) => x.alive && !x.captive && rand() < chance)) {
    g.alive = false;
    const heir = g.lord ? G.succeed(game, g.clan) : null;
    if (g.clan !== game.player) continue;
    if (g.lord) G.chronicle(game, `当主${g.name}が亡くなった。`);
    lines.push({ text: `${g.name}${g.lord ? '（当主）' : ''}が亡くなった。`, mine: true });
    if (g.lord) lines.push({ text: heir ? `${heir.name}が家督を継いだ。家臣の忠誠が下がった。` : '跡を継ぐ者がいない。', mine: true });
  }
  return lines;
}

function youngName(game, clan, rand) {
  for (let i = 0; i < 20; i++) {
    const a = pick(NAME_CHARS, rand);
    const b = pick(NAME_CHARS, rand);
    const name = `${clan.name}${a}${b}`;
    if (a !== b && !game.generals.some((g) => g.name === name)) return name;
  }
  return null;
}

// 若武者は家のいちばん大きな国で元服する。仕え始めなので忠誠は高い
function rollComingOfAge(game, rand) {
  const { comingOfAge, minStat, maxStat } = game.data.rules.age;
  const lines = [];
  for (const clan of game.data.clans) {
    const home = G.provincesOf(game, clan.id).sort((a, b) => b.troops - a.troops)[0];
    if (!home || rand() >= comingOfAge) continue;
    const name = youngName(game, clan, rand);
    if (!name) continue;
    const stat = () => minStat + Math.floor(rand() * (maxStat - minStat + 1));
    const g = { id: `young_${game.nextGeneral++}`, name, clan: clan.id, loc: home.id, alive: true, lead: stat(), admin: stat(), loyalty: game.data.rules.loyalty.max - 10, young: true, skill: G.randomSkill(game, rand) };
    game.generals.push(g);
    const skill = g.skill ? `・特技 ${G.SKILLS[g.skill]}` : '';
    if (clan.id === game.player) lines.push({ text: `${home.name}：${g.name}が元服した（統率${g.lead}・政務${g.admin}${skill}）。`, mine: true });
  }
  return lines;
}

// 忠誠の低い家臣は主家を去る。隣に敵の家があればそこへ走る
function rollDesertions(game, rand) {
  const { leave, leaveChance, plotted } = game.data.rules.loyalty;
  const lines = [];
  for (const g of game.generals.filter((x) => x.alive && !x.captive && !x.lord && x.loyalty < leave && rand() < leaveChance)) {
    const from = G.province(game, g.loc);
    const enemy = from ? G.neighbors(game, from).find((n) => n.clan !== g.clan) : null;
    const mine = g.clan === game.player;
    if (enemy) Object.assign(g, { clan: enemy.clan, loc: enemy.id, loyalty: plotted });
    else g.alive = false;
    if (!mine) continue;
    const text = enemy ? `${g.name}が出奔し、${G.clanInfo(game, enemy.clan).name}家へ走った。` : `${g.name}が出奔した。`;
    G.chronicle(game, text);
    lines.push({ text, mine: true });
  }
  return lines;
}

// 年が改まるたび、恩賞の記憶は薄れて忠誠が少し下がる
function yearlyLoyalty(game) {
  for (const clan of game.data.clans) G.changeLoyalty(game, clan.id, -game.data.rules.loyalty.yearly);
}

// 新しい季節に入った直後に呼ぶ
export function seasonEvents(game, rand) {
  const lines = [];
  if (game.season === 0) {
    yearlyLoyalty(game);
    lines.push(...rollDeaths(game, rand), ...rollComingOfAge(game, rand));
  }
  lines.push(...rollHeavySnow(game, rand));
  for (const p of game.provinces) lines.push(...rollProvince(game, p, rand));
  lines.push(...rollDesertions(game, rand));
  return lines;
}

// 季節の終わりに、その季節かぎりの出来事を片づける
export function clearSeasonEffects(game) {
  for (const p of game.provinces) {
    p.rain = false;
    p.heavySnow = false;
  }
}
