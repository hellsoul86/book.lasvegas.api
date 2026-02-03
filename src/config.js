const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const ROUND_DURATION_MIN = Number(process.env.ROUND_DURATION_MIN || 30);
const ROUND_DURATION_MS = ROUND_DURATION_MIN * 60 * 1000;
const PRICE_REFRESH_MS = Number(process.env.PRICE_REFRESH_MS || 10000);
const FLAT_THRESHOLD_PCT = Number(process.env.FLAT_THRESHOLD_PCT || 0.2);

const FEED_LIMIT = 200;
const VERDICT_LIMIT = 200;
const JUDGMENT_LIMIT = 800;
const ROUND_LIMIT = 200;
const SCORE_EVENT_LIMIT = 1000;

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'store.sqlite');

module.exports = {
  PORT,
  ROUND_DURATION_MIN,
  ROUND_DURATION_MS,
  PRICE_REFRESH_MS,
  FLAT_THRESHOLD_PCT,
  FEED_LIMIT,
  VERDICT_LIMIT,
  JUDGMENT_LIMIT,
  ROUND_LIMIT,
  SCORE_EVENT_LIMIT,
  DB_PATH,
};
