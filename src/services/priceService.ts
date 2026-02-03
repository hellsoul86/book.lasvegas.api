import type { Env, MetaState } from '../types';

const DEFAULT_PRICE_STALE_MS = 30_000;

export type LivePrice = {
  price: number;
  updatedAt: string;
};

function getStaleMs(env: Env) {
  const parsed = Number(env.PRICE_STALE_MS);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PRICE_STALE_MS;
}

export async function getLivePrice(env: Env): Promise<LivePrice> {
  const id = env.PRICE_FEED.idFromName('primary');
  const stub = env.PRICE_FEED.get(id);
  const res = await stub.fetch('https://price-feed/price');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Price feed error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { price: number; updated_at: string };
  const price = Number(data.price);
  if (!Number.isFinite(price)) {
    throw new Error('Invalid live price');
  }
  return { price, updatedAt: data.updated_at };
}

export async function refreshPrice(env: Env, meta: MetaState): Promise<MetaState> {
  const live = await getLivePrice(env);
  const updatedAtMs = Date.parse(live.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    throw new Error('Invalid updated_at');
  }

  const staleMs = getStaleMs(env);
  if (Date.now() - updatedAtMs > staleMs) {
    throw new Error('Price stale');
  }

  const price = live.price;
  const next: MetaState = {
    ...meta,
    lastDeltaPct: ((price - meta.lastPrice) / meta.lastPrice) * 100,
    lastPrice: price,
    currentPrice: price,
    lastPriceAt: new Date(updatedAtMs).toISOString(),
  };

  return next;
}
