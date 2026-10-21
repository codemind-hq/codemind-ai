import { AiError } from '../errors.js';
import { isConfigured, log, models } from '../runtime.js';
import { cachedTokensOf, costFor } from './catalog.js';
import { providerOf } from './providers.js';
import { clientFor, FLEX_TIMEOUT_MS } from './client.js';
import { isFlexUnavailable, isOutOfCredits, isTransient, safeErrorDetails } from './errors.js';
import { abortable, executionError, executionSignal } from './execution.js';
import { setTimeout as delay } from 'node:timers/promises';
import { buildRequest, unfence } from './request.js';
import { recordUsage } from './usage.js';

// The one door to the model. Every call is timed, metered into usage_events, and
// retried on transient failures. Callers pass `meta` ({ userId, kind, promptVersion,
// ref, requestId }) so a call is attributable without the caller knowing how.

const MAX_ATTEMPTS = 3;

/**
 * complete({ system, user, json, responseFormat, temperature, model, maxTokens, reasoningEffort,
 * serviceTier, allowEmpty }, meta) → { text, data?, usage }
 * `json: true` asks for a JSON object response and parses it into `data`; `responseFormat` sends
 * a JSON schema instead. `serviceTier: 'flex'` asks OpenAI for its half-price flex tier, which
 * answers more slowly and refuses with a 429 when it has no capacity (isFlexUnavailable).
 * `allowEmpty` returns an empty answer rather than throwing, for callers that treat it as a failed
 * attempt of their own. `meta.signal` cancels in-flight work and retries; `meta.deadlineAt`
 * is an absolute deadline shared with the caller's other model calls.
 *
 * @param {{ system: string, user: string, json?: boolean, responseFormat?: object, temperature?: number, model?: string, maxTokens?: number, reasoningEffort?: string, serviceTier?: string, allowEmpty?: boolean }} request
 * @param {import('../types.js').CallMeta & { kind?: string, promptVersion?: string, attempt?: number }} [meta]
 * @returns {Promise<{ text: string, data?: any, usage: { model: string, tokensIn: number, tokensOut: number, cachedIn: number, costUsd: number } }>}
 */
export async function complete(
  { system, user, json = false, responseFormat, temperature = 0.5, model = models().defaultModel, maxTokens, reasoningEffort, serviceTier, allowEmpty = false },
  meta = {}
) {
  if (!isConfigured()) throw new Error('The AI code was called before createCodemind() set it up');
  const signal = executionSignal(meta);
  const client = clientFor(model);
  const flex = serviceTier === 'flex' && Boolean(providerOf(model).flexTier);
  const started = Date.now();
  let lastErr;
  // Keep billable usage even when parsing rejects the provider's answer.
  let receivedUsage = {};

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const options = { ...(flex ? { timeout: FLEX_TIMEOUT_MS } : {}), ...(signal ? { signal } : {}) };
      const response = await abortable(() => client.chat.completions.create(
        buildRequest({ system, user, json, responseFormat, temperature, model, maxTokens, reasoningEffort, serviceTier }),
        Object.keys(options).length ? options : undefined
      ), signal);

      const tokensIn = response?.usage?.prompt_tokens || 0;
      const tokensOut = response?.usage?.completion_tokens || 0;
      const cachedIn = cachedTokensOf(response?.usage);
      const usage = { model, tokensIn, tokensOut, cachedIn, costUsd: costFor(model, tokensIn, tokensOut, { flex, cachedIn }) };
      receivedUsage = { tokensIn, tokensOut, cachedIn };
      const content = response?.choices?.[0]?.message?.content;
      if (content != null && typeof content !== 'string') throw AiError.upstream('The model returned invalid response content');
      const text = unfence(content?.trim() || '');

      if (!text && !allowEmpty) throw AiError.upstream('The model returned an empty response');
      let data;
      if (json && text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw AiError.upstream('The model returned malformed JSON');
        }
      }
      // Recorded once the answer is known to be usable: an empty or malformed one is the failure
      // recorded below, not a success and a failure both.
      await recordUsage({ ...meta, model, tokensIn, tokensOut, cachedIn, flex, latencyMs: Date.now() - started, ok: true });
      return data === undefined ? { text, usage } : { text, data, usage };
    } catch (err) {
      lastErr = signal?.aborted ? executionError(signal) : err;
      // A refused flex request is not retried here: the caller leaves the work for a later cycle.
      if (lastErr instanceof AiError || isOutOfCredits(err) || isFlexUnavailable(err) || !isTransient(err) || attempt === MAX_ATTEMPTS) break;
      log().warn({ ...safeErrorDetails(err), attempt, model }, 'model call failed, retrying');
      try {
        await delay(500 * 2 ** (attempt - 1), undefined, { signal });
      } catch {
        lastErr = executionError(signal);
        break;
      }
    }
  }

  await recordUsage({
    ...meta,
    model,
    latencyMs: Date.now() - started,
    ok: false,
    flex,
    ...receivedUsage,
    error: safeErrorDetails(lastErr).category,
  });
  if (lastErr instanceof AiError) throw lastErr;

  log().error({ ...safeErrorDetails(lastErr), model }, 'model call failed');
  const status = lastErr?.status || lastErr?.statusCode;
  if (status === 401) throw new AiError(503, 'ai_not_configured', 'The AI provider rejected the server key');
  if (isOutOfCredits(lastErr)) {
    throw new AiError(503, 'ai_no_credits', 'The AI provider account has no credits left. Add credits to continue.');
  }
  if (isFlexUnavailable(lastErr)) throw new AiError(503, 'ai_flex_unavailable', 'OpenAI has no flex capacity right now.');
  if (status === 429) throw new AiError(503, 'ai_busy', 'The AI provider is busy. Try again in a minute.');
  throw AiError.upstream('The AI provider did not respond. Try again.');
}
