import { AiError } from '../errors.js';

/** One absolute deadline is shared by every call in a workflow, including fallbacks. */
export function executionSignal({ signal, deadlineAt } = {}) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw AiError.badRequest('signal must be an AbortSignal');
  if (deadlineAt !== undefined && (!Number.isFinite(deadlineAt) || deadlineAt < 0)) throw AiError.badRequest('deadlineAt must be a finite timestamp');
  const signals = signal ? [signal] : [];
  if (deadlineAt !== undefined) {
    const remaining = Math.ceil(deadlineAt - Date.now());
    if (remaining > 2 ** 31 - 1) throw AiError.badRequest('deadlineAt must be within the next 2147483647 milliseconds');
    signals.push(AbortSignal.timeout(Math.max(0, remaining)));
  }
  const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  if (deadlineAt !== undefined && deadlineAt <= Date.now()) throw new AiError(504, 'ai_timeout', 'The AI request exceeded its deadline.');
  if (combined?.aborted) throw executionError(combined);
  return combined;
}

export function executionError(signal) {
  return signal?.reason?.name === 'TimeoutError'
    ? new AiError(504, 'ai_timeout', 'The AI request exceeded its deadline.')
    : new AiError(499, 'ai_cancelled', 'The AI request was cancelled.');
}

/** Also bounds injected clients; the SDK receives the same signal to stop network work. */
export async function abortable(call, signal) {
  if (!signal) return call();
  if (signal.aborted) throw executionError(signal);
  let onAbort;
  const stopped = new Promise((_, reject) => {
    onAbort = () => reject(executionError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(call), stopped]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
