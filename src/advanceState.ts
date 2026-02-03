import { getMeta, seedAgents, setMeta } from './db';
import type { Env, MetaState } from './types';
import { refreshPrice } from './services/priceService';
import { createRoundService } from './services/roundService';
import type { RuntimeConfig } from './config';

export async function advanceState(env: Env, config: RuntimeConfig): Promise<MetaState> {
  await seedAgents(env);

  let meta = await getMeta(env);
  const lastAt = meta.lastPriceAt ? Date.parse(meta.lastPriceAt) : 0;
  if (!lastAt || Date.now() - lastAt >= config.priceRefreshMs) {
    meta = await refreshPrice(env, meta);
  }

  const roundService = createRoundService(env, config);
  const live = await roundService.getLiveRound();

  if (live) {
    const endMs = new Date(live.end_time).getTime();
    if (endMs <= Date.now()) {
      await roundService.settleRound(live, meta);
    }
  }

  const liveAfter = await roundService.getLiveRound();
  if (!liveAfter) {
    await roundService.startRound(meta);
  }

  await setMeta(env, meta);
  return meta;
}
