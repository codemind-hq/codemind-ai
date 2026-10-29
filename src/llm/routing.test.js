import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effortFor, tailorEffort, withFallback, writerEffort } from './routing.js';

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

test('tailorEffort goes by the model when no level is set: none for GPT-5.6, low for the rest', () => {
  assert.equal(tailorEffort('gpt-5.6-luna', ''), 'none');
  assert.equal(tailorEffort('gpt-6-luna', ''), 'low');
  assert.equal(tailorEffort('gpt-5-mini', ''), 'low');
});

test("tailorEffort takes the admin's level, put in each model family's words", () => {
  assert.equal(tailorEffort('gpt-6-luna', 'medium'), 'medium');
  assert.equal(tailorEffort('gpt-5.6-luna', 'low'), 'low');
  assert.equal(effortFor('gpt-6-luna', 'minimal'), 'none', 'GPT-6 refuses minimal');
  assert.equal(effortFor('gpt-5-mini', 'none'), 'minimal', 'the older GPT-5 models refuse none');
  assert.equal(effortFor('gpt-5.6-luna', 'none'), 'none');
});

test("writerEffort is the writer's own level, never tailoring's", () => {
  assert.equal(writerEffort('gpt-5.6-luna', ''), 'none');
  assert.equal(writerEffort('gpt-5.6-luna', 'low'), 'low');
  assert.equal(writerEffort('gpt-6-luna', 'none'), 'none');
});
