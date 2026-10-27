import { canonicalSkill, skillAliases } from './dict/skills.js';

// Free, local text checks: no AI calls. Used to colour a job's skills against a
// resume, to order unscored resumes, and to summarise what tailoring changed.

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A term as a whole word, case-insensitively; the words of a multi-word term may be
// joined by spaces, hyphens or underscores ("full stack", "full-stack"). Letters are
// Unicode so "ts" is not found inside the Swedish "möts".
// Compiled once per spelling: a job list scores thousands of jobs that share their skills, and
// building the same Unicode regex for every one was most of the quick match's time. A test without
// the g flag keeps no state, so one RegExp serves every caller. Cleared when it grows past
// CACHE_MAX, since postings bring free-text skills without end.
const CACHE_MAX = 20_000;
const patterns = new Map();
const spellings = new Map();
const remember = (cache, key, make) => {
  let value = cache.get(key);
  if (value === undefined) {
    if (cache.size >= CACHE_MAX) cache.clear();
    value = make(key);
    cache.set(key, value);
  }
  return value;
};

function termPattern(term) {
  return remember(patterns, term, compilePattern);
}

function compilePattern(term) {
  const body = term.split(/[-_\s]+/).filter(Boolean).map(escapeRegex).join('[-_\\s]+');
  return body ? new RegExp(`(?<![\\p{L}\\p{N}+#])${body}(?![\\p{L}\\p{N}+#])`, 'iu') : null;
}

// The spellings a keyword may appear under: its own, plus every dictionary alias of the
// skill it names, so "golang" in a resume satisfies the job skill "Go" and "k8s" satisfies
// "Kubernetes". The dictionary is asked, never guessed at: an unknown keyword is only
// itself.
function spellingsOf(term) {
  return remember(spellings, term, aliasesOf);
}

function aliasesOf(term) {
  const slug = canonicalSkill(term);
  return slug ? [term, ...skillAliases(slug)] : [term];
}

/**
 * True when `keyword`, or any alias of the skill it names, appears in `text` as a whole
 * term, case-insensitively. "Java" does not match "JavaScript"; "C++", "Node.js" and
 * ".NET" work.
 *
 * `seen`, a Map the caller keeps for one text, remembers each answer: a list asks the same resume
 * about the same skills for thousands of jobs.
 */
export function hasKeyword(text, keyword, seen = null) {
  const term = String(keyword || '').trim();
  if (!term || !text) return false;
  const known = seen?.get(term);
  if (known !== undefined) return known;
  const found = spellingsOf(term).some((spelling) => termPattern(spelling)?.test(text));
  seen?.set(term, found);
  return found;
}

/** The job's skills split by whether the resume text mentions them; `seen` as for hasKeyword. */
export function skillFit(text, skills, seen = null) {
  const unique = [...new Map((skills || []).filter(Boolean).map((s) => [s.toLowerCase(), s])).values()];
  const have = [];
  const missing = [];
  for (const skill of unique) (hasKeyword(text, skill, seen) ? have : missing).push(skill);
  return { have, missing };
}

/** Keywords the original resume lacked that the tailored text now contains. */
export function addedKeywords(originalText, tailoredText, candidates) {
  const seen = new Set();
  return (candidates || []).filter((k) => {
    const key = String(k || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !hasKeyword(originalText, k) && hasKeyword(tailoredText, k);
  });
}

const normalizeLine = (line) => line.replace(/^[\s•*\-–·]+/, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Lines of the tailored resume that are new or rewritten, in resume order. */
export function changedLines(originalText, tailoredText, limit = 8) {
  const original = new Set(String(originalText || '').split('\n').map(normalizeLine));
  return String(tailoredText || '')
    .split('\n')
    .map((line) => line.replace(/^[\s•*\-–·]+/, '').trim())
    .filter((line) => line.length >= 25 && !original.has(normalizeLine(line)))
    .slice(0, limit);
}

/** The same keyword, whatever its case or surrounding spaces. */
export const sameKeyword = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Each keyword once, the first spelling kept. */
export const uniqueKeywords = (list) => list.filter((k, i) => list.findIndex((other) => sameKeyword(other, k)) === i);

/** The non-empty strings of a list (a model's or a stored one); anything else is []. */
export function keywordList(value) {
  return Array.isArray(value) ? value.filter((k) => typeof k === 'string' && k.trim()) : [];
}

/**
 * The spellings a skill or a job term goes by: itself, without its parentheses, and what the
 * parentheses hold. "Model Context Protocol (MCP)" is "MCP", so "MCP Protocol (stdio + HTTP)"
 * names it. Shared by the scorer's skill verdicts (ats/verdicts.js) and tailoring's skills list.
 */
export function termForms(term) {
  const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const text = squash(term);
  const inner = [...text.matchAll(/\(([^()]+)\)/g)].map((m) => squash(m[1]));
  const outer = squash(text.replace(/\([^()]*\)/g, ' '));
  return [...new Set([text, outer, ...inner].filter((f) => f.length >= 2))];
}
