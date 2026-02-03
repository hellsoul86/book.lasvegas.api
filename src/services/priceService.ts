import type { MetaState } from '../types';

async function fetchJson(url: string, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPriceFromBinance() {
  const data = await fetchJson(
    'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'
  );
  const price = Number(data.price);
  if (!Number.isFinite(price)) {
    throw new Error('Invalid price');
  }
  return price;
}

function simulatePrice(lastPrice: number) {
  const base = lastPrice || 42000;
  const drift = (Math.random() - 0.5) * 0.8;
  const next = base * (1 + drift / 100);
  return Number(next.toFixed(2));
}

export async function refreshPrice(meta: MetaState): Promise<MetaState> {
  let price: number;
  try {
    price = await fetchPriceFromBinance();
  } catch {
    price = simulatePrice(meta.lastPrice);
  }

  const next: MetaState = {
    ...meta,
    lastDeltaPct: ((price - meta.lastPrice) / meta.lastPrice) * 100,
    lastPrice: price,
    currentPrice: price,
    lastPriceAt: new Date().toISOString(),
  };

  return next;
}
