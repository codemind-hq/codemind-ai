import { lower, squash } from './text.js';

// ── Estimated figures ──────────────────────────────────────────────────────
//
// Most bullets state no result (71% in production), and a rewrite may not invent one. So the
// model may add a realistic figure to a few of the most relevant ones, as a clause of its own
// ("…, cutting response times by ~30%"), and says which clause it added. Each one goes into the
// resume and is listed for the candidate to edit to their real number or remove; the clause is
// what is taken out, so the rest of the bullet stands as written.

// How many a resume may carry is the mode's (style.js TAILOR_MODES maxEstimates): the
// score-first mode answers each measured requirement with a figure, and a posting can ask for six.

// A believable figure, not an impressive one: no percentage above this and no multiplier.
const MAX_ESTIMATE_PERCENT = 40;
/** True when an estimate claims more than a hiring manager would believe unasked: "~60%", "3x", "10×". */
export function overstatedEstimate(clause) {
  const text = String(clause || '');
  if (/\b\d+(?:\.\d+)?\s*(?:x|×)(?![a-z])/i.test(text) || /\b(?:doubl|tripl|quadrupl)\w*/i.test(text)) return true;
  return (text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/gi) || []).some((p) => parseFloat(p) > MAX_ESTIMATE_PERCENT);
}

const tidy = (text) =>
  squash(text)
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[,;:]+(\.?)$/, '$1')
    .trim();

/** The estimate's clause as it is shown and edited: "cutting response times by ~30%". */
export const estimateClause = (clause) => squash(clause).replace(/^[,;:\s]+|[.,;\s]+$/g, '');

// What a clause measures, without its verb and figure: "reducing app start time by ~15%" is
// {app, start, time}. Two estimates of one measure contradict each other ("reducing app start time
// by ~15%" on one bullet and "by ~10%" on the next, both written in by one tailoring).
const MEASURE_FILLER = new Set(['by', 'about', 'around', 'roughly', 'approximately', 'nearly', 'over', 'up', 'to', 'from', 'the', 'a', 'an', 'of', 'per', 'and', 'in', 'on', 'for', 'percent', 'hours', 'hour', 'minutes', 'minute', 'seconds', 'second', 'days', 'day', 'weeks', 'week', 'ms']);
const measureOf = (clause) =>
  lower(estimateClause(clause))
    .replace(/[~≈]?\d[\d.,]*\s*(?:%|x|×|k|m|ms|s)?/g, ' ')
    .split(/[^a-z0-9+#-]+/)
    .filter((w, i) => w && !MEASURE_FILLER.has(w) && !(i === 0 && /ing$/.test(w)));

/**
 * True when two estimate clauses measure the same thing: the same words once verb and figure are
 * gone. Only the same words: "cutting deploy time" and "cutting billing deploy time" may be two
 * services' figures.
 */
export const sameMeasure = (a, b) => {
  const [x, y] = [new Set(measureOf(a)), new Set(measureOf(b))];
  return x.size > 0 && x.size === y.size && [...x].every((w) => y.has(w));
};

// Two clauses that end the same way state the same figure of the same thing ("…and reducing
// recurring production issues by ~15%" is "reducing recurring production issues by ~15%" again);
// two that measure the same thing state it twice, whatever the figures (sameMeasure).
export const sameFigure = (a, b) => {
  const tail = (c) => lower(estimateClause(c)).split(/\s+/).slice(-4).join(' ');
  return (Boolean(tail(a)) && tail(a) === tail(b)) || sameMeasure(a, b);
};

/** A bullet without its estimate clause, or null when the clause is not in it. */
export function withoutEstimate(text, clause) {
  const at = clause ? text.lastIndexOf(clause) : -1;
  if (at < 0) return null;
  const rest = tidy(text.slice(0, at) + text.slice(at + clause.length));
  return rest && rest !== tidy(text) ? rest : null;
}

/** A bullet with an estimate clause at its end: "Optimized X." + "cutting ~25%" gives "Optimized X, cutting ~25%." */
export function withEstimate(plain, clause) {
  const c = estimateClause(clause);
  if (!c) return plain;
  const stop = /\.$/.test(plain) ? '.' : '';
  return `${plain.replace(/\.$/, '')}, ${c}${stop}`;
}
