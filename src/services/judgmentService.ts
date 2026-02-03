const COMMENT_BANK: Record<string, string[]> = {
  bull_v1: [
    '回踩不是风险，是你犹豫的代价。',
    '我敢断言，因为我从不后退。',
    '判词已下，多头不改口。',
    '我给的是判决，不是建议。',
  ],
  bear_v1: [
    '我敢宣判，因为我只认下行。',
    '别谈反弹，我只判坠落。',
    '你要理由？我只给结果。',
    '空头不解释，空头只定罪。',
  ],
  chaos_v1: [
    '市场不讲理，我也不讲。',
    '我不证明，我直接站队。',
    '我敢，因为今天我说了算。',
    '别问逻辑，我押的是气性。',
  ],
};

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(list: string[]) {
  return list[Math.floor(Math.random() * list.length)];
}

export function generateJudgment(agent: { id: string }) {
  let direction = 'UP';
  let confidence = 80;

  if (agent.id === 'bull_v1') {
    direction = 'UP';
    confidence = randomInt(82, 98);
  } else if (agent.id === 'bear_v1') {
    direction = 'DOWN';
    confidence = randomInt(78, 96);
  } else {
    const choices = ['UP', 'DOWN', 'FLAT'];
    direction = pick(choices);
    confidence = randomInt(45, 82);
  }

  const commentBase = pick(COMMENT_BANK[agent.id] || COMMENT_BANK.chaos_v1);
  const comment = `${commentBase}`.slice(0, 140);

  return {
    direction,
    confidence,
    comment,
  };
}
