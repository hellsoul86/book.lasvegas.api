const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

global.fetch = async () => ({
  ok: true,
  json: async () => ({ price: '42000' }),
});

const { buildApp } = require('../src/app');

test('GET /api/health returns ok with time', async () => {
  const app = buildApp();
  await app.ready();

  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.statusCode, 200);

  const body = res.json();
  assert.equal(body.ok, true);
  assert.match(body.time, /^\d{4}-\d{2}-\d{2}T/);

  await app.close();
});
