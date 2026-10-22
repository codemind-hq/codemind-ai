import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withFallback } from './routing.js';

const quiet = { warn: () => {} };

test('withFallback uses the primary model when it succeeds', async () => {
  const calls = [];
  const result = await withFallback((m) => (calls.push(m), `ok:${m}`), { model: 'a', fallbackModel: 'b' }, quiet);
  assert.equal(result, 'ok:a');
  assert.deepEqual(calls, ['a']);
});

test('withFallback tries the fallback once after a failure', async () => {
  const calls = [];
  const result = await withFallback(
    async (m) => {
      calls.push(m);
      if (m === 'a') throw new Error('malformed JSON');
      return `ok:${m}`;
    },
    { model: 'a', fallbackModel: 'b' },
    quiet
  );
  assert.equal(result, 'ok:b');
  assert.deepEqual(calls, ['a', 'b']);
});

test('withFallback does not try the fallback on a failure it would only repeat', async () => {
  for (const code of ['ai_refused', 'ai_no_credits', 'ai_not_configured']) {
    const calls = [];
    const fail = async (m) => {
      calls.push(m);
      throw Object.assign(new Error(code), { code });
    };
    await assert.rejects(withFallback(fail, { model: 'a', fallbackModel: 'b' }, quiet), { code });
    assert.deepEqual(calls, ['a'], code);
  }
});

test('withFallback rethrows when there is no distinct fallback, or the fallback fails too', async () => {
  const fail = async (m) => {
    throw new Error(`fail:${m}`);
  };
  await assert.rejects(withFallback(fail, { model: 'a', fallbackModel: '' }, quiet), /fail:a/);
  await assert.rejects(withFallback(fail, { model: 'a', fallbackModel: 'a' }, quiet), /fail:a/);
  await assert.rejects(withFallback(fail, { model: 'a', fallbackModel: 'b' }, quiet), /fail:b/);
});
