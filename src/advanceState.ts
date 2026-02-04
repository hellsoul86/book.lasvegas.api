import { getMeta, setMeta } from './db';
import type { Env, MetaState } from './types';
import { refreshPrice } from './services/priceService';
import { createRoundService } from './services/roundService';
import type { RuntimeConfig } from './config';

export async function advanceState(env: Env, config: RuntimeConfig): Promise<MetaState> {
  let meta = await getMeta(env);
  const lastAt = meta.lastPriceAt ? Date.parse(meta.lastPriceAt) : 0;
  if (!lastAt || Date.now() - lastAt >= config.priceRefreshMs) {
    meta = await refreshPrice(env, meta);
  }

  const roundService = createRoundService(env, config);
  let live = await roundService.getLiveRound();

  if (live && live.status === 'betting') {
    const lockMs = roundService.getLockTimeMs(live);
    if (lockMs <= Date.now()) {
      const submissions = await roundService.countJudgments(live.round_id);
      if (submissions === 0) {
        await roundService.cancelRound(live);
        live = null;
      } else {
        await roundService.lockRound(live);
        live = { ...live, status: 'locked' };
      }
    }
  }

  if (live && live.status === 'locked') {
    const endMs = new Date(live.end_time).getTime();
    if (endMs <= Date.now()) {
      await roundService.settleRound(live, meta);
    }
  }

  const liveAfter = await roundService.getLiveRound();
  if (!liveAfter) {
    const hasAgents = await roundService.hasActiveAgents();
    if (hasAgents) {
      await roundService.startRound(meta);
    }
  }

  await setMeta(env, meta);
  return meta;
}
