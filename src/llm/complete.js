import { AiError } from '../errors.js';
import { isConfigured, log, models } from '../runtime.js';
import { cachedTokensOf, costFor, hasPrice } from './catalog.js';
import { flexFor } from './providers.js';
import { clientFor, FLEX_TIMEOUT_MS } from './client.js';
import { isFlexUnavailable, isOutOfCredits, isTimeout, isTransient, retryDelayMs } from './errors.js';
import { buildRequest, unfence } from './request.js';
import { recordUsage } from './usage.js';

// The one door to the model. Every call is timed, metered into usage_events, and
// retried on transient failures. Callers pass `meta` ({ userId, kind, promptVersion,
// ref, requestId }) so a call is attributable without the caller knowing how.

const MAX_ATTEMPTS = 3;

// Models already warned about having no price (catalog.js PRICES): their calls are metered at zero.
const unpriced = new Set();

// Scoring and tailoring ride flex only when their caller asks for it, which is Smart Apply's
// background work alone (owner's call, 2026-10-29): a score or tailoring someone is waiting on (a
// job page, the ATS checker, For You) is always on the standard tier. Asked for, it rides flex
// with a deadline while the admin has that group on (Admin › AI, the app's `flex`), and on the
// standard tier while it is off: a call flex has not answered within `patienceSec`, or one flex
// refuses, is sent again at once on the standard tier, and the rest of that request (its
// requestId) goes straight to standard. Other flex work is left as it was: it waits up to
// FLEX_TIMEOUT_MS, and a refusal is its caller's to handle (enrichment, research and the like wait
// for capacity instead).
const FLEX_KINDS = { scoring: ['score', 'job_requirements'], tailoring: ['tailor'] };

/** Whether a call of `kind` is scoring or tailoring, whose flex the admin's switches govern. */
export const flexGoverned = (kind) => Object.values(FLEX_KINDS).some((kinds) => kinds.includes(kind));
export const DEFAULT_FLEX_PATIENCE_SEC = 45;
const STANDARD_FOR_MS = 30 * 60_000;
const onStandard = new Map(); // requestId → until when its calls skip flex

/** The deadline for a call of `kind` on flex, or null when its kind keeps the plain flex rules. */
export function flexDeadlineMs(kind, policy = models().flex || {}) {
  const on = Object.entries(FLEX_KINDS).some(([group, kinds]) => policy[group] && kinds.includes(kind));
  return on ? (Number(policy.patienceSec) || DEFAULT_FLEX_PATIENCE_SEC) * 1000 : null;
}

function sentToStandard(requestId) {
  const until = requestId && onStandard.get(requestId);
  if (until && until > Date.now()) return true;
  if (until) onStandard.delete(requestId);
  return false;
}

function keepOnStandard(requestId) {
  if (!requestId) return;
  const now = Date.now();
  for (const [id, until] of onStandard) if (until <= now) onStandard.delete(id);
  onStandard.set(requestId, now + STANDARD_FOR_MS);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * complete({ system, user, json, responseFormat, temperature, model, maxTokens, reasoningEffort,
 * serviceTier, allowEmpty }, meta) → { text, data?, usage }
 * `json: true` asks for a JSON object response and parses it into `data`; `responseFormat` sends
 * a JSON schema instead. `serviceTier: 'flex'` asks OpenAI for its half-price flex tier, which
 * answers more slowly and refuses with a 429 when it has no capacity (isFlexUnavailable); a model
 * whose family does not take the tier (providers.js flexFor) runs on the standard tier as if it
 * had not been asked. A scoring or tailoring call (by `meta.kind`) goes on flex only when asked,
 * and then with a deadline while the admin has that group on, on the standard tier while it is off
 * (flexDeadlineMs).
 * `allowEmpty` returns an empty answer rather than throwing, for callers that treat it as a failed
 * attempt of their own.
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
  const client = clientFor(model);
  const asked = serviceTier === 'flex';
  const governed = flexGoverned(meta.kind);
  const deadlineMs = asked && governed ? flexDeadlineMs(meta.kind) : null;
  // Scoring and tailoring: asked, and the admin's switch on. Anything else: asked.
  let flex = asked && flexFor(model) && (governed ? deadlineMs !== null && !sentToStandard(meta.requestId) : true);
  const started = Date.now();
  let lastErr;
  // What every answered attempt was billed for, also when its answer could not be used.
  const billed = { tokensIn: 0, tokensOut: 0, cachedIn: 0 };
  if (!hasPrice(model) && !unpriced.has(model)) {
    unpriced.add(model);
    log().warn({ model }, 'model has no price in the catalog; its calls are metered at $0');
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await client.chat.completions.create(
        buildRequest({ system, user, json, responseFormat, temperature, model, maxTokens, reasoningEffort, serviceTier: flex ? 'flex' : undefined }),
        flex ? { timeout: deadlineMs ?? FLEX_TIMEOUT_MS } : undefined
      );

      const choice = response.choices[0];
      const text = unfence(choice?.message?.content?.trim() || '');
      const tokensIn = response.usage?.prompt_tokens || 0;
      const tokensOut = response.usage?.completion_tokens || 0;
      const cachedIn = cachedTokensOf(response.usage);
      const usage = { model, tokensIn, tokensOut, cachedIn, costUsd: costFor(model, tokensIn, tokensOut, { flex, cachedIn }) };
      billed.tokensIn += tokensIn;
      billed.tokensOut += tokensOut;
      billed.cachedIn += cachedIn;

      // A caller that allows an empty answer judges a refused or cut-off one itself (enrichment
      // validates it as a failed attempt).
      if (!allowEmpty) {
        if (choice?.message?.refusal) throw new AiError(422, 'ai_refused', 'The AI declined to answer this request.');
        // Cut off at the token limit (a reasoning model can spend it all before answering): the text
        // is incomplete, and a JSON answer would only look malformed.
        if (choice?.finish_reason === 'length') throw new AiError(502, 'ai_truncated', "The AI's answer was cut off before it finished. Try again.");
      }
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
      lastErr = err;
      const status = err.status || err.statusCode;
      // Flex too slow or full for a call with a deadline: the same call on the standard tier, now,
      // and the rest of its request with it. Not a failed try (a timed-out call is not billed).
      if (flex && deadlineMs !== null && (isTimeout(err) || isFlexUnavailable(err))) {
        log().info({ model, kind: meta.kind, waitedMs: Date.now() - started, refused: isFlexUnavailable(err) }, 'flex too slow, sending on the standard tier');
        flex = false;
        keepOnStandard(meta.requestId);
        attempt -= 1;
        continue;
      }
      // A refused flex request is not retried here: the caller leaves the work for a later cycle.
      // Nor is a flex request that timed out: each attempt already waited up to FLEX_TIMEOUT_MS.
      if (err instanceof AiError || isOutOfCredits(err) || isFlexUnavailable(err) || (flex && isTimeout(err)) || !isTransient(err) || attempt === MAX_ATTEMPTS) break;
      log().warn({ status, attempt, model, err: err.message }, 'model call failed, retrying');
      await sleep(retryDelayMs(err, attempt));
    }
  }

  await recordUsage({
    ...meta,
    model,
    ...billed,
    latencyMs: Date.now() - started,
    ok: false,
    flex,
    error: String(lastErr?.message || lastErr).slice(0, 500),
  });
  if (lastErr instanceof AiError) throw lastErr;

  // Flex at capacity is OpenAI's answer on a busy day, not a failure of ours: the caller leaves the
  // work for later or sends it on the standard tier, so it is a warning, not an error for Sentry.
  if (isFlexUnavailable(lastErr)) {
    log().warn({ model, status: lastErr?.status || lastErr?.statusCode }, 'flex tier at capacity');
    throw new AiError(503, 'ai_flex_unavailable', 'OpenAI has no flex capacity right now.');
  }

  log().error({ err: lastErr, model }, 'model call failed');
  const status = lastErr?.status || lastErr?.statusCode;
  if (status === 401) throw new AiError(503, 'ai_not_configured', 'The AI provider rejected the server key');
  if (isOutOfCredits(lastErr)) {
    throw new AiError(503, 'ai_no_credits', 'The AI provider account has no credits left. Add credits to continue.');
  }
  if (status === 429) throw new AiError(503, 'ai_busy', 'The AI provider is busy. Try again in a minute.');
  throw AiError.upstream('The AI provider did not respond. Try again.');
}
