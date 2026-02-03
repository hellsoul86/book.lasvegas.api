const https = require('https');

function fetchJson(url, timeoutMs = 6000) {
  if (typeof fetch === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .finally(() => clearTimeout(timer));
  }

  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }

      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Timeout'));
    });
  });
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

function simulatePrice(lastPrice) {
  const base = lastPrice || 42000;
  const drift = (Math.random() - 0.5) * 0.8;
  const next = base * (1 + drift / 100);
  return Number(next.toFixed(2));
}

function createPriceService({ state }) {
  async function getPrice() {
    try {
      const price = await fetchPriceFromBinance();
      state.lastDeltaPct = ((price - state.lastPrice) / state.lastPrice) * 100;
      state.lastPrice = price;
      state.currentPrice = price;
      state.lastPriceAt = new Date().toISOString();
      return price;
    } catch (error) {
      const price = simulatePrice(state.lastPrice);
      state.lastDeltaPct = ((price - state.lastPrice) / state.lastPrice) * 100;
      state.lastPrice = price;
      state.currentPrice = price;
      state.lastPriceAt = new Date().toISOString();
      return price;
    }
  }

  async function refresh() {
    await getPrice();
  }

  return {
    getPrice,
    refresh,
  };
}

module.exports = {
  createPriceService,
};
