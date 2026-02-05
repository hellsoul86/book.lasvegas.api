export type Env = {
  DB: D1Database;
  PRICE_FEED: DurableObjectNamespace;
  ROUND_DURATION_MIN?: string;
  PRICE_REFRESH_MS?: string;
  FLAT_THRESHOLD_PCT?: string;
  HL_WS_URL?: string;
  HL_FEED?: string;
  HL_COIN?: string;
  HL_INFO_URL?: string;
  PRICE_STALE_MS?: string;
  ADMIN_API_TOKEN?: string;
  LOCK_WINDOW_MIN?: string;
  SIGNATURE_WINDOW_SEC?: string;
  KLINE_DEFAULT_INTERVALS?: string;
  KLINE_DEFAULT_LIMIT?: string;
  KLINE_MAX_LIMIT?: string;
  KLINE_CACHE_SEC?: string;
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
  claim_token?: string | null;
  verification_code?: string | null;
  claimed_at?: string | null;
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

export type ReasonRule = {
  timeframe: string;
  pattern: string;
  direction: 'UP' | 'DOWN' | 'FLAT';
  horizon_bars: number;
};

export type Judgment = {
  id?: number;
  round_id: string;
  agent_id: string;
  direction: string;
  confidence: number;
  comment: string;
  timestamp: string;
  intervals?: string[] | string | null;
  analysis_start_time?: string | null;
  analysis_end_time?: string | null;
  reason_rule?: ReasonRule | string | null;
  reason_timeframe?: string | null;
  reason_pattern?: string | null;
  reason_direction?: string | null;
  reason_horizon_bars?: number | null;
  reason_t_close_ms?: number | null;
  reason_target_close_ms?: number | null;
  reason_base_close?: number | null;
  reason_pattern_holds?: number | boolean | null;
  reason_target_close?: number | null;
  reason_delta_pct?: number | null;
  reason_outcome?: string | null;
  reason_correct?: number | boolean | null;
  reason_evaluated_at?: string | null;
  reason_eval_error?: string | null;
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

export type Kline = {
  open_time: number;
  close_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades_count: number;
};

export type KlinesResponse = {
  ok: boolean;
  source: 'hyperliquid';
  symbol: string;
  coin: string;
  intervals: string[];
  limit: number;
  updated_at: string;
  data: Record<string, Kline[]>;
  errors?: Record<string, string>;
  raw?: Record<string, unknown>;
};

export type ReasonStatsRow = {
  total_evaluated: number;
  total_valid: number;
  accuracy_all: number;
  accuracy_valid: number;
};

export type ReasonStatsResponse = {
  ok: true;
  scope: 'global' | 'agent';
  agent_id?: string;
  since: string;
  until: string;
  total_evaluated: number;
  total_valid: number;
  accuracy_all: number;
  accuracy_valid: number;
  avg_delta_pct: number;
  avg_abs_delta_pct: number;
  by_timeframe: Array<ReasonStatsRow & { timeframe: string }>;
  by_pattern: Array<ReasonStatsRow & { pattern: string }>;
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
