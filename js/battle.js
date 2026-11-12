// 合戦は数日の削り合いとして計算し、日ごとの経過を文章で返す（結果だけより読み物として楽しめるように）

function fmt(n) {
  return n.toLocaleString('ja-JP');
}

// 夜襲は合戦の始まりに一度だけ判定する。当たれば城の守りを無いものにし、外れれば攻め手が手痛く崩れる
function nightRaid(game, side, plan, rand, lines) {
  const { tactics } = game.data.rules;
  if (rand() < plan.nightChance) {
    const hit = Math.round(side.defend * tactics.nightHit);
    side.defend -= hit;
    side.castle = 1;
    lines.push(`夜襲が当たった！ 守り手 -${fmt(hit)}。城の守りは役に立たない。`);
  } else {
    const miss = Math.round(side.attack * tactics.nightMiss);
    side.attack -= miss;
    side.castle *= 1.2;
    lines.push(`夜襲は見破られた。攻め手 -${fmt(miss)}。`);
  }
}

// 策ごとの損害の倍率と日数。兵糧攻めは長引くが、どちらも兵を損じにくい（攻め手のほうがより損じにくい）
function battlePlan(game, plan) {
  const { battle, tactics } = game.data.rules;
  if (plan.tactic === 'siege') return { attackLoss: tactics.siegeAttackLoss, defendLoss: tactics.siegeDefendLoss, rounds: Math.round(battle.rounds * 1.5) };
  return { attackLoss: 1, defendLoss: 1, rounds: battle.rounds };
}

// command は攻め手の大将の采配による倍率（統率50で1倍）。plan.tactic は攻め手の策、plan.sortie は守り手が城を出て戦うか
export function fight(game, size, to, castle, rand, command = 1, plan = {}) {
  const { battle, tactics } = game.data.rules;
  const side = { attack: size, defend: to.troops, castle };
  const lines = [`攻め手 ${fmt(side.attack)}（采配 ×${command.toFixed(2)}）対 守り手 ${fmt(side.defend)}（守りの倍率 ×${castle.toFixed(2)}）`];
  if (side.defend === 0) {
    lines.push('城は空だった。戦わずに城を取った。');
    return { won: true, attackerLeft: side.attack, defenderLeft: 0, lines };
  }
  if (plan.tactic === 'night') nightRaid(game, side, plan, rand, lines);
  const mod = battlePlan(game, plan);
  for (let day = 1; day <= mod.rounds; day++) {
    const lossA = Math.min(side.attack, Math.round(side.defend * side.castle * battle.lossRate * mod.attackLoss * (0.6 + 0.8 * rand())));
    const lossD = Math.min(side.defend, Math.round(side.attack * command * battle.lossRate * mod.defendLoss * (0.6 + 0.8 * rand())));
    side.attack -= lossA;
    side.defend -= lossD;
    lines.push(`${day}日目　攻め手 -${fmt(lossA)}（残り${fmt(side.attack)}）／守り手 -${fmt(lossD)}（残り${fmt(side.defend)}）`);
    if (side.defend <= to.troops * battle.breakRatio) {
      lines.push('守り手が崩れた。城を落とした！');
      return { won: true, attackerLeft: side.attack, defenderLeft: side.defend, lines };
    }
    if (side.attack <= size * battle.breakRatio) {
      // 城を出て戦った守り手は、崩れた攻め手をそのまま追い討てる
      const pursuit = plan.sortie ? Math.round(side.attack * tactics.pursuit) : 0;
      side.attack -= pursuit;
      lines.push(pursuit ? `攻め手が崩れ、追い討ちを受けた（-${fmt(pursuit)}）。` : '攻め手が崩れ、兵を引いた。');
      return { won: false, attackerLeft: side.attack, defenderLeft: side.defend, lines };
    }
  }
  lines.push('城は落ちず、兵を引いた。');
  return { won: false, attackerLeft: side.attack, defenderLeft: side.defend, lines };
}
