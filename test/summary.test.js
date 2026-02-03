const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

global.fetch = async () => ({
  ok: true,
  json: async () => ({ price: '42000' }),
});

const { buildApp } = require('../src/app');

test('GET /api/summary returns expected shape', async () => {
  const app = buildApp();
  await app.ready();

  const res = await app.inject({ method: 'GET', url: '/api/summary' });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.ok(body.server_time);
  assert.ok(Array.isArray(body.agents));
  assert.ok(Array.isArray(body.feed));
  assert.ok(body.live);
  assert.ok(body.live.round_id);
  assert.ok(Array.isArray(body.live.judgments));

  await app.close();
});
