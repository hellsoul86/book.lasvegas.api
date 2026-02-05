import type { RuntimeConfig } from '../config';
import { trimTable } from '../db';
import type {
  Agent,
  Env,
  FlipCard,
  Judgment,
  MetaState,
  ReasonRule,
  Round,
  ScoreEvent,
  Summary,
  Verdict,
} from '../types';

function roundIdFor(date: Date) {
  const pad = (num: number) => String(num).padStart(2, '0');
  return `r_${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
    date.getUTCDate()
  )}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

function computeResult(deltaPct: number, flatThresholdPct: number) {
  if (Math.abs(deltaPct) < flatThresholdPct) return 'FLAT';
  return deltaPct > 0 ? 'UP' : 'DOWN';
}

function formatDelta(deltaPct: number) {
  const sign = deltaPct > 0 ? '+' : '';
  return `${sign}${deltaPct.toFixed(1)}%`;
}

function buildFlipCard({
  agent,
  judgment,
  verdict,
  scoreChange,
}: {
  agent: Agent;
  judgment: Judgment;
  verdict: Verdict;
  scoreChange: number;
}): FlipCard {
  const result = judgment.direction === verdict.result ? 'WIN' : 'FAIL';
  const deltaText = formatDelta(verdict.delta_pct);

  return {
    title: `${result === 'FAIL' ? '❌' : '✅'} ${agent.name} ${
      result === 'FAIL' ? '被当场否决' : '暂时免刑'
    }`,
    text: `自信度：${judgment.confidence}% · 结果：${deltaText}`,
    agent: agent.name,
    agent_id: agent.id,
    confidence: judgment.confidence,
    result,
    score_change: scoreChange,
    round_id: verdict.round_id,
    timestamp: verdict.timestamp,
  };
}

function parseIntervals(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item));
    }
  } catch {
    return null;
  }
  return null;
}

function parseReasonRule(value: unknown): ReasonRule | null {
  if (!value) return null;

  const coerce = (candidate: any): ReasonRule | null => {
    if (!candidate || typeof candidate !== 'object') return null;
    const timeframe = typeof candidate.timeframe === 'string' ? candidate.timeframe : null;
    const pattern = typeof candidate.pattern === 'string' ? candidate.pattern : null;
    const direction = typeof candidate.direction === 'string' ? candidate.direction : null;
    const horizon = candidate.horizon_bars;
    const horizonBars = typeof horizon === 'number' ? horizon : Number(horizon);
    if (!timeframe || !pattern || !direction) return null;
    if (!Number.isFinite(horizonBars)) return null;
    return {
      timeframe,
      pattern,
      direction: direction as ReasonRule['direction'],
      horizon_bars: Math.floor(horizonBars),
    };
  };

  if (typeof value === 'object') {
    return coerce(value);
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return coerce(JSON.parse(value));
  } catch {
    return null;
  }
}

export function createRoundService(env: Env, config: RuntimeConfig) {
  const lockWindowMs = config.lockWindowMs;

  async function getLiveRound(): Promise<Round | null> {
    return (
      await env.DB.prepare(
        "SELECT * FROM rounds WHERE status != 'settled' ORDER BY start_time DESC LIMIT 1"
      ).first<Round>()
    ) ?? null;
  }

  function getLockTimeMs(round: Round): number {
    return new Date(round.start_time).getTime() + lockWindowMs;
  }

  async function startRound(meta: MetaState): Promise<Round | null> {
    const existing = await getLiveRound();
    if (existing) return existing;

    const now = new Date();
    const round: Round = {
      round_id: roundIdFor(now),
      symbol: 'BTCUSDT',
      duration_min: config.roundDurationMin,
      start_price: Number(meta.currentPrice.toFixed(2)),
      end_price: null,
      status: 'betting',
      start_time: now.toISOString(),
      end_time: new Date(now.getTime() + config.roundDurationMs).toISOString(),
    };

    const statements = [
      env.DB.prepare(
        'INSERT INTO rounds (round_id, symbol, duration_min, start_price, end_price, status, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        round.round_id,
        round.symbol,
        round.duration_min,
        round.start_price,
        round.end_price,
        round.status,
        round.start_time,
        round.end_time
      ),
    ];

    await env.DB.batch(statements);
    await trimTable(env, 'rounds', config.roundLimit);

    return round;
  }

  async function lockRound(round: Round): Promise<Round> {
    await env.DB.prepare('UPDATE rounds SET status = ? WHERE round_id = ?').bind(
      'locked',
      round.round_id
    ).run();
    return { ...round, status: 'locked' };
  }

  async function cancelRound(round: Round): Promise<void> {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM judgments WHERE round_id = ?').bind(round.round_id),
      env.DB.prepare('DELETE FROM rounds WHERE round_id = ?').bind(round.round_id),
    ]);
  }

  async function countJudgments(roundId: string): Promise<number> {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM judgments WHERE round_id = ?'
    ).bind(roundId).first<{ count: number | string }>();
    return Number(row?.count ?? 0);
  }

  async function hasActiveAgents(): Promise<boolean> {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM agents WHERE status = 'active' AND secret IS NOT NULL AND secret != ''"
    ).first<{ count: number | string }>();
    return Number(row?.count ?? 0) > 0;
  }

  async function settleRound(round: Round, meta: MetaState): Promise<void> {
    if (round.status === 'settled') return;

    const endPrice = Number(meta.currentPrice.toFixed(2));
    const deltaPct = ((endPrice - round.start_price) / round.start_price) * 100;
    const verdict: Verdict = {
      round_id: round.round_id,
      result: computeResult(deltaPct, config.flatThresholdPct),
      delta_pct: Number(deltaPct.toFixed(1)),
      timestamp: new Date().toISOString(),
    };

    const judgmentsResult = await env.DB.prepare(
      'SELECT * FROM judgments WHERE round_id = ?'
    )
      .bind(round.round_id)
      .all<Judgment>();
    const judgments = judgmentsResult.results ?? [];

    const agentsResult = await env.DB.prepare(
      'SELECT id, name, persona, status, score, prompt FROM agents'
    ).all<Agent>();
    const agents = agentsResult.results ?? [];
    const agentMap = new Map(agents.map((agent) => [agent.id, agent]));

    const statements = [
      env.DB.prepare(
        'UPDATE rounds SET end_price = ?, status = ? WHERE round_id = ?'
      ).bind(endPrice, 'settled', round.round_id),
      env.DB.prepare(
        'INSERT INTO verdicts (round_id, result, delta_pct, timestamp) VALUES (?, ?, ?, ?)'
      ).bind(verdict.round_id, verdict.result, verdict.delta_pct, verdict.timestamp),
    ];

    for (const judgment of judgments) {
      const agent = agentMap.get(judgment.agent_id);
      if (!agent) continue;

      const correct = judgment.direction === verdict.result;
      const scoreChange = correct
        ? judgment.confidence
        : -Math.round(judgment.confidence * 1.5);

      const scoreEvent: ScoreEvent = {
        agent_id: agent.id,
        round_id: round.round_id,
        confidence: judgment.confidence,
        correct: correct ? 1 : 0,
        score_change: scoreChange,
        reason: correct ? 'Correct' : 'High confidence failure',
        timestamp: verdict.timestamp,
      };

      const flipCard = buildFlipCard({
        agent,
        judgment,
        verdict,
        scoreChange,
      });

      statements.push(
        env.DB.prepare('UPDATE agents SET score = score + ? WHERE id = ?').bind(
          scoreChange,
          agent.id
        ),
        env.DB.prepare(
          'INSERT INTO score_events (agent_id, round_id, confidence, correct, score_change, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          scoreEvent.agent_id,
          scoreEvent.round_id,
          scoreEvent.confidence,
          scoreEvent.correct,
          scoreEvent.score_change,
          scoreEvent.reason,
          scoreEvent.timestamp
        ),
        env.DB.prepare(
          'INSERT INTO flip_cards (title, text, agent, agent_id, confidence, result, score_change, round_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          flipCard.title,
          flipCard.text,
          flipCard.agent,
          flipCard.agent_id,
          flipCard.confidence,
          flipCard.result,
          flipCard.score_change,
          flipCard.round_id,
          flipCard.timestamp
        )
      );
    }

    await env.DB.batch(statements);
    await trimTable(env, 'verdicts', config.verdictLimit);
    await trimTable(env, 'score_events', config.scoreEventLimit);
    await trimTable(env, 'flip_cards', config.feedLimit);
  }

  async function buildSummary(meta: MetaState): Promise<Summary> {
    const live = await getLiveRound();

    const liveJudgmentsResult = live
      ? await env.DB.prepare(
          'SELECT j.*, a.name AS agent_name FROM judgments j LEFT JOIN agents a ON a.id = j.agent_id WHERE j.round_id = ?'
        )
          .bind(live.round_id)
          .all<Judgment & { agent_name: string | null }>()
      : { results: [] as Array<Judgment & { agent_name: string | null }> };

    const liveJudgments = (liveJudgmentsResult.results ?? []).map((item) => ({
      ...item,
      intervals: parseIntervals(item.intervals) ?? undefined,
      reason_rule: parseReasonRule(item.reason_rule) ?? undefined,
      reason_pattern_holds:
        typeof item.reason_pattern_holds === 'number'
          ? Boolean(item.reason_pattern_holds)
          : item.reason_pattern_holds ?? undefined,
      reason_correct:
        typeof item.reason_correct === 'number'
          ? Boolean(item.reason_correct)
          : item.reason_correct ?? undefined,
      agent_name: item.agent_name || item.agent_id,
    }));

    const lastVerdict =
      (await env.DB.prepare('SELECT * FROM verdicts ORDER BY timestamp DESC LIMIT 1').first<
        Verdict
      >()) ?? null;

    let highlight: FlipCard | null = null;
    if (lastVerdict) {
      const top = await env.DB.prepare(
        'SELECT * FROM judgments WHERE round_id = ? ORDER BY confidence DESC LIMIT 1'
      )
        .bind(lastVerdict.round_id)
        .first<Judgment>();

      if (top) {
        const agent = await env.DB.prepare(
          'SELECT id, name, persona, status, score, prompt FROM agents WHERE id = ?'
        )
          .bind(top.agent_id)
          .first<Agent>();
        if (agent) {
          const correct = top.direction === lastVerdict.result;
          const scoreChange = correct ? top.confidence : -Math.round(top.confidence * 1.5);
          highlight = buildFlipCard({
            agent,
            judgment: top,
            verdict: lastVerdict,
            scoreChange,
          });
        }
      }
    }

    const agentsResult = await env.DB.prepare('SELECT * FROM agents').all<Agent>();
    const agents = agentsResult.results ?? [];

    const agentSnapshots = [] as Array<Agent & {
      recent_rounds: number;
      recent_high_conf_failures: number;
    }>;

    for (const agent of agents) {
      const recentEventsResult = await env.DB.prepare(
        'SELECT * FROM score_events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 5'
      )
        .bind(agent.id)
        .all<ScoreEvent>();
      const recentEvents = recentEventsResult.results ?? [];
      const highConfFails = recentEvents.filter(
        (event) => !event.correct && event.confidence >= 80
      ).length;

      agentSnapshots.push({
        ...agent,
        recent_rounds: recentEvents.length,
        recent_high_conf_failures: highConfFails,
      });
    }

    agentSnapshots.sort((a, b) => b.score - a.score);

    const feedResult = await env.DB.prepare(
      'SELECT * FROM flip_cards ORDER BY timestamp DESC LIMIT ?'
    )
      .bind(config.feedLimit)
      .all<FlipCard>();
    const sortedFeed = feedResult.results ?? [];
    const defaultFeed = sortedFeed.filter(
      (item) => item.result === 'FAIL' && item.confidence >= 80
    );
    const feed = (defaultFeed.length > 0 ? defaultFeed : sortedFeed).slice(0, 30);

    return {
      server_time: new Date().toISOString(),
      live: live
        ? {
            round_id: live.round_id,
            symbol: live.symbol,
            status: live.status,
            duration_min: live.duration_min,
            start_price: live.start_price,
            start_time: live.start_time,
            end_time: live.end_time,
            countdown_ms: Math.max(0, new Date(live.end_time).getTime() - Date.now()),
            current_price: meta.currentPrice,
            judgments: liveJudgments,
          }
        : null,
      lastVerdict,
      highlight,
      agents: agentSnapshots,
      feed,
    };
  }

  return {
    getLiveRound,
    getLockTimeMs,
    startRound,
    lockRound,
    cancelRound,
    countJudgments,
    hasActiveAgents,
    settleRound,
    buildSummary,
  };
}
