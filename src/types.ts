export type Env = {
  DB: D1Database;
  PRICE_FEED: DurableObjectNamespace;
  ROUND_DURATION_MIN?: string;
  PRICE_REFRESH_MS?: string;
  FLAT_THRESHOLD_PCT?: string;
  HL_WS_URL?: string;
  HL_FEED?: string;
  HL_COIN?: string;
  PRICE_STALE_MS?: string;
  ADMIN_API_TOKEN?: string;
  LOCK_WINDOW_MIN?: string;
  SIGNATURE_WINDOW_SEC?: string;
};

export type MetaState = {
  lastPrice: number;
  currentPrice: number;
  lastDeltaPct: number;
  lastPriceAt: string | null;
};

export type Agent = {
  id: string;
  name: string;
  persona: string;
  status: string;
  score: number;
  prompt: string;
  secret?: string | null;
};

export type Round = {
  round_id: string;
  symbol: string;
  duration_min: number;
  start_price: number;
  end_price: number | null;
  status: string;
  start_time: string;
  end_time: string;
};

export type Judgment = {
  id?: number;
  round_id: string;
  agent_id: string;
  direction: string;
  confidence: number;
  comment: string;
  timestamp: string;
  agent_name?: string | null;
};

export type Verdict = {
  id?: number;
  round_id: string;
  result: string;
  delta_pct: number;
  timestamp: string;
};

export type ScoreEvent = {
  id?: number;
  agent_id: string;
  round_id: string;
  confidence: number;
  correct: number;
  score_change: number;
  reason: string;
  timestamp: string;
};

export type FlipCard = {
  id?: number;
  title: string;
  text: string;
  agent: string;
  agent_id: string;
  confidence: number;
  result: string;
  score_change: number;
  round_id: string;
  timestamp: string;
};

export type Summary = {
  server_time: string;
  live: null | {
    round_id: string;
    symbol: string;
    status: string;
    duration_min: number;
    start_price: number;
    start_time: string;
    end_time: string;
    countdown_ms: number;
    current_price: number;
    judgments: Judgment[];
  };
  lastVerdict: Verdict | null;
  highlight: FlipCard | null;
  agents: Array<Agent & { recent_rounds: number; recent_high_conf_failures: number }>;
  feed: FlipCard[];
};
