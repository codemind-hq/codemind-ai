import { log, onUsage } from '../runtime.js';
import { costFor } from './catalog.js';
import { safeErrorDetails } from './errors.js';

/** The month a call is billed to, as "YYYY-MM". */
export function periodOf(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

/**
 * Meters one model call through the app's `onUsage` (createCodemind); a Batch API or flex call is
 * billed at half price. The event is what the app stores as a usage_events row.
 */
export async function recordUsage({ userId = null, kind = 'other', promptVersion = '', attempt = null, ref = null, requestId = '', model, tokensIn = 0, tokensOut = 0, cachedIn = 0, latencyMs = 0, ok = true, error = '', batch = false, flex = false }) {
  try {
    await onUsage()?.({
      userId,
      kind,
      model,
      promptVersion,
      attempt,
      tokensIn,
      tokensOut,
      cachedIn,
      costUsd: costFor(model, tokensIn, tokensOut, { batch, flex, cachedIn }),
      batch,
      flex,
      latencyMs,
      ok,
      error,
      period: periodOf(),
      ref,
      requestId,
    });
  } catch (err) {
    // Metering must never fail a user request.
    log().warn(safeErrorDetails(err), 'failed to record usage event');
  }
}
