// 年ごとの課題。天下取りは長いので、途中に「2年でここまで」という手ごろな目当てを置く
import * as G from './game.js';

function enemyNeighbors(game) {
  return [...new Set(G.provincesOf(game, game.player).flatMap((p) => G.neighbors(game, p)))].filter((n) => n.clan !== game.player);
}

// 隣の国を取る課題か、国の数を増やす課題。どちらもいまの力で届きそうなものにする
function makeQuest(game, rand) {
  const { seasons, extra } = game.data.rules.quest;
  const deadline = G.turnIndex(game) + seasons;
  const targets = enemyNeighbors(game).sort((a, b) => G.defensePower(game, a) - G.defensePower(game, b)).slice(0, 3);
  if (targets.length && rand() < 0.6) return { kind: 'take', provinceId: targets[Math.floor(rand() * targets.length)].id, deadline };
  return { kind: 'count', count: G.provincesOf(game, game.player).length + extra, deadline };
}

export function questText(game, q) {
  const left = Math.max(0, q.deadline - G.turnIndex(game));
  const goal = q.kind === 'take' ? `${G.province(game, q.provinceId).name}を取る` : `${q.count}か国を治める`;
  return `${goal}（あと${left}季節）`;
}

function done(game, q) {
  if (q.kind === 'take') return G.province(game, q.provinceId).clan === game.player;
  return G.provincesOf(game, game.player).length >= q.count;
}

// 達成すれば兵糧と銭が届き、家臣も勇む。期限を過ぎれば家臣が少し落胆する
function settle(game, q) {
  const { rice, gold, loyalty, fail } = game.data.rules.quest;
  const clan = game.clans[game.player];
  const goal = questText(game, q).replace(/（.*）$/, '');
  if (done(game, q)) {
    clan.rice += rice;
    clan.gold += gold;
    G.changeLoyalty(game, game.player, loyalty);
    G.chronicle(game, `課題「${goal}」を果たした。`);
    return [{ text: `課題「${goal}」を果たした。兵糧 +${rice}・銭 +${gold}・家臣の忠誠 +${loyalty}。`, mine: true }];
  }
  if (G.turnIndex(game) < q.deadline) return null;
  G.changeLoyalty(game, game.player, -fail);
  return [{ text: `課題「${goal}」は期限までに果たせなかった。家臣の忠誠 -${fail}。`, mine: true }];
}

// 季節が改まった直後に呼ぶ。片づいた課題は消し、年の初めに次の課題を出す
export function updateQuest(game, rand) {
  const lines = [];
  if (game.quest) {
    const result = settle(game, game.quest);
    if (result) {
      lines.push(...result);
      game.quest = null;
    }
  }
  if (!game.quest && !game.result && game.season === 0 && G.provincesOf(game, game.player).length > 0) {
    game.quest = makeQuest(game, rand);
    lines.push({ text: `新しい課題：${questText(game, game.quest)}`, mine: true });
  }
  return lines;
}
