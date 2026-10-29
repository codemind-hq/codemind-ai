import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { complete, DEFAULT_FLEX_PATIENCE_SEC } from './complete.js';
import { costFor } from './catalog.js';
import { retryDelayMs } from './errors.js';
import { withFallback } from './routing.js';
import { DEFAULT_MODELS, installFakeLlm, rawResponse } from '../testing/fakeLlm.js';

// What complete() does with what a response carries besides its content: why it stopped, a refusal,
// and the tokens it was billed for, also when the answer is unusable.

let fake;
afterEach(() => fake?.restore());

const answered = (content, finishReason = 'stop', usage = { prompt_tokens: 5000, completion_tokens: 2000 }) =>
  rawResponse({ choices: [{ message: { content }, finish_reason: finishReason }], usage });

test('an unusable answer is metered with the tokens the provider billed for it', async () => {
  fake = installFakeLlm([answered('{"a":')]);
  await assert.rejects(complete({ system: 's', user: 'u', json: true, model: 'gpt-5-mini' }), { code: 'upstream_failed' });
  const [event] = fake.events;
  assert.equal(event.ok, false);
  assert.equal(event.tokensIn, 5000);
  assert.equal(event.tokensOut, 2000);
  assert.equal(event.costUsd, costFor('gpt-5-mini', 5000, 2000));
});

test('an answer cut off at the token limit is an error of its own, not a success', async () => {
  fake = installFakeLlm([answered('Dear hiring manager, I am writing to', 'length')]);
  await assert.rejects(complete({ system: 's', user: 'u', model: 'gpt-5-mini' }), { code: 'ai_truncated' });
  assert.equal(fake.events[0].ok, false);
  assert.equal(fake.events[0].tokensOut, 2000);
});

test('a cut-off JSON answer says it was cut off, not that it was malformed', async () => {
  fake = installFakeLlm([answered('{"summary": "Built data', 'length')]);
  await assert.rejects(complete({ system: 's', user: 'u', json: true, model: 'gpt-5-mini' }), { code: 'ai_truncated' });
});

test('a caller that allows an empty answer still gets a cut-off one back to judge itself (enrichment)', async () => {
  fake = installFakeLlm([answered('', 'length')]);
  const result = await complete({ system: 's', user: 'u', model: 'gpt-5-nano', allowEmpty: true });
  assert.equal(result.text, '');
  assert.equal(fake.events[0].ok, true);
});

test('a refusal is reported as a refusal', async () => {
  fake = installFakeLlm([rawResponse({ choices: [{ message: { content: null, refusal: "I can't help with that." }, finish_reason: 'stop' }] })]);
  await assert.rejects(complete({ system: 's', user: 'u', model: 'gpt-5-mini' }), { code: 'ai_refused' });
  assert.equal(fake.events[0].ok, false);
  assert.equal(fake.events[0].tokensIn, 1000);
});

test('a refusal does not send the same prompt to the fallback model', async () => {
  const calls = [];
  const refused = Object.assign(new Error('refused'), { code: 'ai_refused' });
  await assert.rejects(
    withFallback(
      async (m) => {
        calls.push(m);
        throw refused;
      },
      { model: 'a', fallbackModel: 'b' },
      { warn() {} }
    ),
    { code: 'ai_refused' }
  );
  assert.deepEqual(calls, ['a']);
});

test('a flex call that timed out is not retried: each attempt may take ten minutes', async () => {
  fake = installFakeLlm([new OpenAI.APIConnectionTimeoutError(), 'unreachable']);
  await assert.rejects(complete({ system: 's', user: 'u', model: 'gpt-5-nano', serviceTier: 'flex' }));
  assert.equal(fake.calls.length, 1);
});

test('a standard call that timed out is still retried', async () => {
  fake = installFakeLlm([new OpenAI.APIConnectionTimeoutError(), 'ok']);
  const result = await complete({ system: 's', user: 'u', model: 'gpt-5-nano' });
  assert.equal(result.text, 'ok');
  assert.equal(fake.calls.length, 2);
});

test("a retry waits as long as the provider's Retry-After asks, within a cap", () => {
  const limited = (headers) => OpenAI.APIError.generate(429, { message: 'Rate limit reached' }, 'Rate limit reached', headers);
  assert.equal(retryDelayMs(limited({ 'retry-after': '20' }), 1), 20_000);
  assert.equal(retryDelayMs(limited({ 'retry-after-ms': '1500' }), 1), 1500);
  assert.equal(retryDelayMs(limited({ 'retry-after': '3600' }), 1), 30_000);
});

test('without Retry-After a retry backs off exponentially, with jitter so callers do not retry in step', () => {
  const err = { status: 503 };
  assert.equal(retryDelayMs(err, 1, () => 1), 500);
  assert.equal(retryDelayMs(err, 2, () => 1), 1000);
  assert.equal(retryDelayMs(err, 2, () => 0), 500);
  assert.equal(retryDelayMs({ status: 503, headers: { 'retry-after': 'soon' } }, 1, () => 1), 500);
});

test('a dated or differently cased model id is priced as its model, not at zero', () => {
  assert.equal(costFor('gpt-5-mini-2025-08-07', 1_000_000, 1_000_000), costFor('gpt-5-mini', 1_000_000, 1_000_000));
  assert.equal(costFor('GPT-4o-mini', 1_000_000, 0), costFor('gpt-4o-mini', 1_000_000, 0));
  assert.equal(costFor('gpt-4o-mini-2024-07-18', 1_000_000, 0), 0.15);
});

test('a call to a model with no price is logged once, so its spend does not go unnoticed', async () => {
  const warnings = [];
  const logger = { debug() {}, info() {}, error() {}, warn: (obj, msg) => warnings.push([obj, msg]) };
  fake = installFakeLlm(['a', 'b'], { logger });
  await complete({ system: 's', user: 'u', model: 'mystery-model-x' });
  await complete({ system: 's', user: 'u', model: 'mystery-model-x' });
  const unpriced = warnings.filter(([, msg]) => /no price/i.test(msg));
  assert.equal(unpriced.length, 1);
  assert.equal(unpriced[0][0].model, 'mystery-model-x');
});

// Scoring and tailoring on flex with a deadline (Admin › AI flex settings).
const flexOn = (flex) => ({ models: { ...DEFAULT_MODELS, flex } });
const refusedFlex = () => Object.assign(new Error('Resource unavailable'), { status: 429, code: 'resource_unavailable' });

test('a tailoring call goes on flex with the deadline once the admin turns it on, asked or not', async () => {
  fake = installFakeLlm(['ok'], flexOn({ tailoring: true, patienceSec: 30 }));
  await complete({ system: 's', user: 'u', model: 'gpt-6-luna' }, { kind: 'tailor', requestId: 'r1' });
  assert.equal(fake.calls[0].request.service_tier, 'flex');
  assert.equal(fake.calls[0].options.timeout, 30_000);
  assert.equal(fake.events[0].flex, true);
});

test('with no patience set the deadline is the default', async () => {
  fake = installFakeLlm(['ok'], flexOn({ scoring: true }));
  await complete({ system: 's', user: 'u', model: 'gpt-6-luna' }, { kind: 'score', requestId: 'r2' });
  assert.equal(fake.calls[0].options.timeout, DEFAULT_FLEX_PATIENCE_SEC * 1000);
});

test('a flex call past its deadline is sent again at once on the standard tier, and billed as standard', async () => {
  fake = installFakeLlm([new OpenAI.APIConnectionTimeoutError(), 'ok'], flexOn({ tailoring: true, patienceSec: 30 }));
  const result = await complete({ system: 's', user: 'u', model: 'gpt-6-luna' }, { kind: 'tailor', requestId: 'r3' });
  assert.equal(result.text, 'ok');
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1].request.service_tier, undefined);
  assert.equal(fake.calls[1].options, null);
  assert.equal(fake.events.length, 1);
  assert.equal(fake.events[0].flex, false);
  assert.equal(fake.events[0].costUsd, costFor('gpt-6-luna', 1000, 100));
});

test('a flex refusal on a call with a deadline goes to standard rather than back to the caller', async () => {
  fake = installFakeLlm([refusedFlex(), 'ok'], flexOn({ scoring: true }));
  const result = await complete({ system: 's', user: 'u', model: 'gpt-6-luna' }, { kind: 'score', requestId: 'r4' });
  assert.equal(result.text, 'ok');
  assert.equal(fake.calls[1].request.service_tier, undefined);
});

test('once a request went to standard, its later calls skip flex', async () => {
  fake = installFakeLlm([new OpenAI.APIConnectionTimeoutError(), 'ok', 'ok again'], flexOn({ tailoring: true }));
  await complete({ system: 's', user: 'u', model: 'gpt-6-luna' }, { kind: 'tailor', requestId: 'r5' });
  await complete({ system: 's', user: 'u', model: 'gpt-6-luna' }, { kind: 'tailor', requestId: 'r5' });
  assert.equal(fake.calls.length, 3);
  assert.equal(fake.calls[2].request.service_tier, undefined);
});

test('other flex work keeps the plain rules: a ten-minute wait, a refusal left to the caller', async () => {
  fake = installFakeLlm(['ok', refusedFlex()], flexOn({ scoring: true, tailoring: true, patienceSec: 30 }));
  await complete({ system: 's', user: 'u', model: 'gpt-6-luna', serviceTier: 'flex' }, { kind: 'cover_letter' });
  assert.equal(fake.calls[0].options.timeout, 600_000);
  await assert.rejects(complete({ system: 's', user: 'u', model: 'gpt-6-luna', serviceTier: 'flex' }, { kind: 'job_enrich' }), { code: 'ai_flex_unavailable' });
});

test('with flex off for scoring, a score asked for on the standard tier stays there', async () => {
  fake = installFakeLlm(['ok'], flexOn({ tailoring: true }));
  await complete({ system: 's', user: 'u', model: 'gpt-6-luna' }, { kind: 'score' });
  assert.equal(fake.calls[0].request.service_tier, undefined);
});
