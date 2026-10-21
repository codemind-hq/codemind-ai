import { test } from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { configure } from '../runtime.js';
import { complete } from './complete.js';
import { withFallback } from './routing.js';
import { costFor } from './catalog.js';

const secret = 'private-resume-content sk-test-secret';
const request = { model: 'gpt-4o-mini', system: 's', user: 'u', json: true };
const answer = (content) => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200 } } });

function setup(create, onUsage) {
  const events = [];
  const logs = [];
  const calls = [];
  const client = { chat: { completions: { create: (...args) => { calls.push(args); return create(...args); } } } };
  configure({ providers: { openai: { client } }, onUsage: onUsage || ((event) => events.push(event)), logger: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) } });
  return { events, logs, calls };
}

test('empty, malformed and wrong-type responses retain billable usage in one failure event', async () => {
  try {
    for (const content of ['', '{', { unexpected: true }]) {
      const { events, calls } = setup(async () => answer(content));
      await assert.rejects(complete(request), (err) => err.code === 'upstream_failed');
      assert.equal(calls.length, 1);
      assert.equal(events.length, 1);
      assert.equal(events[0].ok, false);
      assert.equal(events[0].tokensIn, 1000);
      assert.equal(events[0].tokensOut, 100);
      assert.equal(events[0].cachedIn, 200);
      assert.equal(events[0].costUsd, costFor(request.model, 1000, 100, { cachedIn: 200 }));
    }
  } finally { configure({}); }
});

test('successful JSON and allowed empty responses keep existing result and metering behavior', async () => {
  try {
    const { events } = setup(async () => answer('{"ok":true}'));
    assert.deepEqual((await complete(request)).data, { ok: true });
    assert.equal(events.length, 1);
    assert.equal(events[0].ok, true);
    const empty = setup(async () => answer(''));
    assert.equal((await complete({ ...request, allowEmpty: true })).text, '');
    assert.equal(empty.events[0].ok, true);
  } finally { configure({}); }
});

test('provider and usage-sink errors do not expose raw messages in logs or usage events', async () => {
  try {
    const providerError = Object.assign(new Error(secret), { status: 400 });
    const { events, logs, calls } = setup(async () => { throw providerError; });
    await assert.rejects(complete(request), (err) => err.code === 'upstream_failed' && !err.message.includes(secret));
    assert.equal(calls.length, 1, 'non-retryable provider errors are not retried');
    assert.equal(events[0].tokensIn, 0);
    assert.ok(!JSON.stringify({ events, logs }).includes(secret));
    const sink = setup(async () => answer('{}'), () => { throw new Error(secret); });
    await complete(request);
    assert.ok(!JSON.stringify(sink.logs).includes(secret));
    const fallbackLogs = [];
    await withFallback(async (model) => { if (model === 'a') throw providerError; return 'ok'; }, { model: 'a', fallbackModel: 'b' }, { warn: (...args) => fallbackLogs.push(args) });
    assert.ok(!JSON.stringify(fallbackLogs).includes(secret));
  } finally { configure({}); }
});

test('pre-cancelled and expired requests make no provider or fallback calls', async () => {
  try {
    const { calls } = setup(async () => answer('{}'));
    for (const [meta, code] of [[{ signal: AbortSignal.abort(new Error(secret)) }, 'ai_cancelled'], [{ deadlineAt: Date.now() - 1 }, 'ai_timeout']]) {
      let fallbacks = 0;
      await assert.rejects(withFallback(async () => { fallbacks += 1; return complete(request, meta); }, { model: 'a', fallbackModel: 'b' }), (err) => err.code === code);
      assert.equal(fallbacks, 1);
    }
    assert.equal(calls.length, 0);
  } finally { configure({}); }
});

test('an in-flight deadline cancels the client and records one safe failure', async () => {
  try {
    const { calls, events } = setup((_body, { signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(answer('{}')), 1000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error(secret)); }, { once: true });
    }));
    await assert.rejects(complete(request, { deadlineAt: Date.now() + 30 }), (err) => err.code === 'ai_timeout');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].signal.aborted, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].error, 'ai_timeout');
  } finally { configure({}); }
});

test('cancelling retry backoff prevents another provider attempt', async () => {
  try {
    const controller = new AbortController();
    const { calls } = setup(async () => { setTimeout(() => controller.abort(), 10); throw Object.assign(new Error(secret), { status: 429 }); });
    await assert.rejects(complete(request, { signal: controller.signal }), (err) => err.code === 'ai_cancelled');
    assert.equal(calls.length, 1);
  } finally { configure({}); }
});

test('rate limits and SDK timeouts retain the bounded three-attempt retry policy', async () => {
  try {
    for (const error of [Object.assign(new Error(secret), { status: 429 }), new OpenAI.APIConnectionTimeoutError({ message: secret })]) {
      const { calls, events, logs } = setup(async () => { throw error; });
      await assert.rejects(complete(request), (err) => ['ai_busy', 'upstream_failed'].includes(err.code));
      assert.equal(calls.length, 3);
      assert.equal(events.length, 1);
      assert.ok(!JSON.stringify(logs).includes(secret));
    }
  } finally { configure({}); }
});

test('quota and flex-capacity refusals are not retried and flex prices remain discounted', async () => {
  try {
    for (const [code, expected] of [['insufficient_quota', 'ai_no_credits'], ['resource_unavailable', 'ai_flex_unavailable']]) {
      const { calls } = setup(async () => { throw Object.assign(new Error(secret), { status: 429, code }); });
      await assert.rejects(complete(request), (err) => err.code === expected);
      assert.equal(calls.length, 1);
    }
    const { events } = setup(async () => answer('{'));
    await assert.rejects(complete({ ...request, serviceTier: 'flex' }));
    assert.equal(events[0].costUsd, costFor(request.model, 1000, 100, { cachedIn: 200, flex: true }));
  } finally { configure({}); }
});

test('one absolute deadline bounds both the primary call and its fallback', async () => {
  try {
    let count = 0;
    const { calls } = setup((_body, { signal }) => new Promise((resolve, reject) => {
      count += 1;
      const first = count === 1;
      const timer = setTimeout(() => resolve(answer(first ? '{' : '{}')), first ? 5 : 1000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error(secret)); }, { once: true });
    }));
    const meta = { deadlineAt: Date.now() + 100 };
    await assert.rejects(withFallback(() => complete(request, meta), { model: 'a', fallbackModel: 'b' }), (err) => err.code === 'ai_timeout');
    assert.equal(calls.length, 2);
  } finally { configure({}); }
});

test('invalid execution metadata fails before reaching a provider', async () => {
  try {
    const { calls } = setup(async () => answer('{}'));
    for (const meta of [{ signal: {} }, { deadlineAt: NaN }, { deadlineAt: Infinity }, { deadlineAt: Date.now() + 2 ** 32 }]) {
      await assert.rejects(complete(request, meta), (err) => err.code === 'bad_request');
    }
    assert.equal(calls.length, 0);
  } finally { configure({}); }
});
