import type { Env } from './types';

type PriceFeedDiagnostics = {
  ok: boolean;
  status: 'connected' | 'connecting' | 'closed' | 'error';
  ws_url: string;
  feed: string;
  coin: string;
  last_price: number | null;
  last_update_at: string | null;
  last_event_at: string | null;
  last_error: string | null;
  ready_state: number | null;
};

type PriceResponse = {
  price: number;
  updated_at: string;
};

const DEFAULT_WS_URL = 'wss://api.hyperliquid.xyz/ws';
const DEFAULT_FEED = 'allMids';
const DEFAULT_COIN = 'BTC';
const RECONNECT_DELAY_MS = 5000;

export class PriceFeedDO {
  private state: DurableObjectState;
  private env: Env;
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private latestPrice: number | null = null;
  private lastUpdateAt: string | null = null;
  private lastEventAt: string | null = null;
  private lastError: string | null = null;
  private status: 'connected' | 'connecting' | 'closed' | 'error' = 'closed';

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      await this.ensureConnected();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/price') {
      return this.handlePrice();
    }
    if (url.pathname === '/diag') {
      return this.json(this.buildDiag());
    }
    return new Response('Not found', { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.ensureConnected(true);
  }

  private get wsUrl() {
    return this.env.HL_WS_URL || DEFAULT_WS_URL;
  }

  private get feed() {
    return this.env.HL_FEED || DEFAULT_FEED;
  }

  private get coin() {
    return this.env.HL_COIN || DEFAULT_COIN;
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  private buildDiag(): PriceFeedDiagnostics {
    return {
      ok: this.status === 'connected',
      status: this.status,
      ws_url: this.wsUrl,
      feed: this.feed,
      coin: this.coin,
      last_price: this.latestPrice,
      last_update_at: this.lastUpdateAt,
      last_event_at: this.lastEventAt,
      last_error: this.lastError,
      ready_state: this.ws ? this.ws.readyState : null,
    };
  }

  private async handlePrice(): Promise<Response> {
    await this.ensureConnected();
    if (!Number.isFinite(this.latestPrice) || !this.lastUpdateAt) {
      return this.json(
        { ok: false, message: 'No price available', diag: this.buildDiag() },
        503
      );
    }
    const payload: PriceResponse = {
      price: this.latestPrice as number,
      updated_at: this.lastUpdateAt,
    };
    return this.json(payload);
  }

  private buildSubscription(): Record<string, string> {
    if (this.feed === 'allMids') {
      return { type: 'allMids' };
    }
    if (this.feed === 'trades') {
      return { type: 'trades', coin: this.coin };
    }
    return { type: this.feed, coin: this.coin };
  }

  private scheduleReconnect() {
    void this.state.storage.setAlarm(Date.now() + RECONNECT_DELAY_MS);
  }

  private async ensureConnected(force = false): Promise<void> {
    if (!force && this.ws) {
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        return;
      }
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.status = 'connecting';
    this.lastError = null;

    this.connecting = new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      ws.addEventListener('open', () => {
        this.status = 'connected';
        this.lastEventAt = new Date().toISOString();
        try {
          ws.send(
            JSON.stringify({
              method: 'subscribe',
              subscription: this.buildSubscription(),
            })
          );
        } catch (error) {
          this.lastError =
            error instanceof Error ? error.message : 'Failed to send subscribe';
        }
        settle();
      });

      ws.addEventListener('message', (event) => {
        this.lastEventAt = new Date().toISOString();
        this.handleMessage(event.data);
      });

      ws.addEventListener('close', (event) => {
        this.status = 'closed';
        this.lastError = `Close ${event.code}: ${event.reason || 'no reason'}`;
        this.ws = null;
        this.connecting = null;
        this.scheduleReconnect();
        settle();
      });

      ws.addEventListener('error', () => {
        this.status = 'error';
        this.lastError = 'WebSocket error';
        this.ws = null;
        this.connecting = null;
        this.scheduleReconnect();
        settle();
      });

      setTimeout(() => {
        if (this.status === 'connecting') {
          this.lastError = 'WebSocket connect timeout';
          this.status = 'error';
          this.ws = null;
          this.connecting = null;
          this.scheduleReconnect();
        }
        settle();
      }, 5000);
    });

    return this.connecting;
  }

  private handleMessage(data: unknown) {
    if (typeof data !== 'string') return;

    let message: any;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }

    if (message?.channel === 'allMids') {
      const mids = message?.data?.mids;
      const raw = mids ? mids[this.coin] : null;
      const price = Number(raw);
      if (Number.isFinite(price)) {
        this.latestPrice = price;
        this.lastUpdateAt = new Date().toISOString();
      }
      return;
    }

    if (message?.channel === 'trades' && Array.isArray(message?.data)) {
      const last = message.data[message.data.length - 1];
      const raw = last?.px ?? last?.price;
      const price = Number(raw);
      if (Number.isFinite(price)) {
        this.latestPrice = price;
        this.lastUpdateAt = new Date().toISOString();
      }
    }
  }
}
