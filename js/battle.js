// 合戦は数日の削り合いとして計算し、日ごとの経過を文章で返す（結果だけより読み物として楽しめるように）

function fmt(n) {
  return n.toLocaleString('ja-JP');
}

// command は攻め手の大将の采配による倍率（統率50で1倍）
export function fight(game, size, to, castle, rand, command = 1) {
  const { battle } = game.data.rules;
  let attack = size;
  let defend = to.troops;
  const lines = [`攻め手 ${fmt(attack)}（采配 ×${command.toFixed(2)}）対 守り手 ${fmt(defend)}（守りの倍率 ×${castle.toFixed(2)}）`];
  if (defend === 0) {
    lines.push('城は空だった。戦わずに城を取った。');
    return { won: true, attackerLeft: attack, defenderLeft: 0, lines };
  }
  for (let day = 1; day <= battle.rounds; day++) {
    const lossA = Math.min(attack, Math.round(defend * castle * battle.lossRate * (0.6 + 0.8 * rand())));
    const lossD = Math.min(defend, Math.round(attack * command * battle.lossRate * (0.6 + 0.8 * rand())));
    attack -= lossA;
    defend -= lossD;
    lines.push(`${day}日目　攻め手 -${fmt(lossA)}（残り${fmt(attack)}）／守り手 -${fmt(lossD)}（残り${fmt(defend)}）`);
    if (defend <= to.troops * battle.breakRatio) {
      lines.push('守り手が崩れた。城を落とした！');
      return { won: true, attackerLeft: attack, defenderLeft: defend, lines };
    }
    if (attack <= size * battle.breakRatio) {
      lines.push('攻め手が崩れ、兵を引いた。');
      return { won: false, attackerLeft: attack, defenderLeft: defend, lines };
    }
  }
  lines.push('城は落ちず、兵を引いた。');
  return { won: false, attackerLeft: attack, defenderLeft: defend, lines };
}
