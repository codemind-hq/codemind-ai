import { hasKeyword } from '../text/keywords.js';
import { contentWords } from './text.js';

// ── A bullet's details ─────────────────────────────────────────────────────
//
// A rewrite may say the work in the job's words; it may not say less of it. One member's
// tailoring (Cobalt, 2026-10-27) traded "PyTorch ResNet-50 CNN (98.3% accuracy), LightGBM with
// SHAP explainability, hybrid recommender systems" for "Built an enterprise MLOps framework…",
// and "ShazamKit fingerprinting, Chromaprint, CoreML inference… 500K+ tracks… 3.5TB" for
// "Operated a FastAPI backend… and managed cloud model platforms": the score rose and the resume
// read worse. So the figures and the names a bullet states — tools, products, clients, models —
// are its details, and a rewrite that drops one is put back as the resume said it. A bullet
// dense with them is evidence as it stands: a rewrite of one keeps most of its wording too.

// Acronyms a sentence carries without naming anything: losing "AI" from "AI agent platform" to
// "LLM-based agent platform" drops no fact.
const GENERIC_NAMES = new Set(['ai', 'ml', 'api', 'apis', 'ui', 'ux', 'it', 'us', 'uk', 'eu', 'llm', 'llms', 'sdk', 'ceo', 'cto', 'pm', 'qa', 'kpi', 'kpis', 'b2b', 'b2c', 'saas']);
// "Agent Platform: Built…", "Argenx (Biotech) Deep-Research Platform: Engineered…": a short
// title-cased label before the bullet proper.
const LABEL_RE = /^([^:.]{2,80}):\s+/;
const MAX_LABEL_WORDS = 8;
// A name however it is written: "ShazamKit", "iOS", "ResNet-50", "CI/CD", "C#", ".NET", "Argenx".
const TOKEN_RE = /\.?[\p{L}\p{N}][\p{L}\p{N}+#./&-]*/gu;
// Internal capital, an acronym, a letter beside a digit, or a symbol only names carry.
const strongName = (t) => /\p{Ll}\p{Lu}|\p{Lu}{2}\p{Ll}/u.test(t) || /^\p{Lu}[\p{Lu}\p{N}+#&/.-]+$/u.test(t) || (/\p{L}/u.test(t) && /\p{N}/u.test(t)) || /[+#]/.test(t) || t.startsWith('.');
const capitalized = (t) => /^\p{Lu}\p{Ll}/u.test(t);

/** The figures a line states, as written without separators: "1,205" is "1205", "3.5TB" is "3.5". */
export const figuresOf = (text) => (String(text || '').match(/\d[\d,.]*/g) || []).map((n) => n.replace(/,/g, '').replace(/\.+$/, ''));

/**
 * The names a line states: words written as names are (ShazamKit, SHAP, ResNet-50, Argenx), the
 * sentence's first word aside, which is capitalised whatever it is. A label's words count only
 * when they are plainly names (an acronym, an inner capital): "Agent Platform:" names nothing.
 */
export function namesOf(text) {
  const line = String(text || '');
  const label = LABEL_RE.exec(line);
  const labelEnd = label && label[1].trim().split(/\s+/).length <= MAX_LABEL_WORDS ? label[0].length : 0;
  const names = [];
  for (const m of line.matchAll(TOKEN_RE)) {
    const token = m[0].replace(/[./&-]+$/, '');
    if (!token || GENERIC_NAMES.has(token.toLowerCase())) continue;
    const inLabel = m.index < labelEnd;
    const opensSentence = m.index === labelEnd || /(?:^|[.!?;:]\s+)$/.test(line.slice(0, m.index)) || m.index === 0;
    if (strongName(token) || (!inLabel && !opensSentence && capitalized(token))) names.push(token);
  }
  return [...new Set(names)];
}

/** The figures and names of `before` that `after` no longer states. */
export function lostDetails(before, after) {
  const have = new Set(figuresOf(after));
  return [...figuresOf(before).filter((n) => !have.has(n)), ...namesOf(before).filter((n) => !hasKeyword(after, n))];
}

// A bullet stating this many figures and names together is dense, and a rewrite of it keeps at
// least KEEP_DENSE_WORDING of its words: it gains the job's terms, it is not written afresh.
const DENSE_DETAILS = 6;
const KEEP_DENSE_WORDING = 0.6;
export const denseBullet = (text) => figuresOf(text).length + namesOf(text).length >= DENSE_DETAILS;

/**
 * True when a rewrite says less than the bullet it rewrites: a figure or a name gone, or, for a
 * dense bullet, most of its wording replaced.
 */
export function losesDetail(before, after) {
  if (!before) return false;
  if (lostDetails(before, after).length) return true;
  if (!denseBullet(before)) return false;
  const own = contentWords(before);
  const kept = contentWords(after);
  return [...own].filter((w) => kept.has(w)).length / Math.max(own.size, 1) < KEEP_DENSE_WORDING;
}

// Words a line shares with one bullet of another role, beyond its own role's and the job's, that
// say it is that bullet: "immutable artifacts, semantic versioning and multi-environment Docker
// image promotion" written under a side project, from the consultancy role's CI/CD bullet.
const BORROWED_WORDS = 4;

/**
 * The bullet of another role (`elsewhere`) that `text` repeats, or null: the line brings at least
 * BORROWED_WORDS words its own role (`ownText`) never uses and the job's terms (`jobText`) do not
 * name, all from that one bullet. The same work told under two employers reads as padding, and
 * under the wrong one it is not true. `jobText` is the job's terms, not its posting: words are
 * compared by their first four letters, and a whole posting has most of them ("versioning" is
 * "version", "promotion" is "promising").
 */
export function borrowedBullet(text, { ownText = '', elsewhere = [], jobText = '' } = {}) {
  const skip = new Set([...contentWords(ownText), ...contentWords(jobText)]);
  const fresh = [...contentWords(text)].filter((w) => !skip.has(w));
  if (fresh.length < BORROWED_WORDS) return null;
  return elsewhere.find((other) => {
    const theirs = contentWords(other);
    return fresh.filter((w) => theirs.has(w)).length >= BORROWED_WORDS;
  }) || null;
}
