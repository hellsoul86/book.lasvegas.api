import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateClaimToken,
  generateVerificationCode,
  slugifyAgentId,
} from '../src/services/agentService.ts';

test('slugifyAgentId normalizes names', () => {
  assert.equal(slugifyAgentId('Bull Claw'), 'bull_claw');
  assert.equal(slugifyAgentId('  Multi   Space  '), 'multi_space');
  assert.equal(slugifyAgentId('AI-Agent#1'), 'ai_agent_1');
});

test('generateClaimToken returns hex string', () => {
  const token = generateClaimToken();
  assert.match(token, /^[0-9a-f]+$/);
  assert.equal(token.length, 32);
});

test('generateVerificationCode returns 6-digit code', () => {
  const code = generateVerificationCode();
  assert.match(code, /^\d{6}$/);
});
