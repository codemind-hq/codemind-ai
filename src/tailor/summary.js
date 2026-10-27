import { hasKeyword } from '../text/keywords.js';
import { listLike } from '../ats/index.js';
import { TENURE_RE } from './claims.js';
import { figuresOf, lostDetails, namesOf } from './detail.js';
import { newStackTerms } from './stack.js';
import { lower, sameTerm, sentencesOf, shows } from './text.js';

// ── Summary: the tenure sentence ───────────────────────────────────────────
//
// "Senior Full Stack Engineer with 10+ years delivering web, backend, mobile and AI products" came
// back as "… and cloud infrastructure" for a DevOps job, and the scorer read ten years of
// infrastructure work. A field the job asks for, written into the sentence that counts the years,
// turns the tenure into a claim; the rest of the summary may say what the candidate does with it.

const ROLE_NOUN_RE =
  /^(?:engineer|engineering|developer|development|manager|management|specialist|analyst|consultant|architect|lead|senior|sr|junior|jr|staff|principal|head|director|chief|vp|distinguished|intern|remote|hybrid|and|the|for|with)$/i;

/** The job title's own words ("DevOps", "Infrastructure", "Reliability"), without levels and role nouns. */
export function titleTerms(title) {
  return String(title || '')
    .split(/[^\p{L}\p{N}+#/]+/u)
    .filter((w) => w.length >= 3 && !ROLE_NOUN_RE.test(w));
}

/**
 * The draft summary without a sentence that only lists tools ("Experienced with AWS, Kubernetes,
 * Terraform, EKS, Argo CD, GitHub Actions, Datadog…"): the skills section says it already, and
 * the scorer, quoting it, rates each of those as a mention. A sentence the source summary has is
 * the candidate's own and stays. A draft that was nothing but lists gives way to the source.
 * A draft the cut would leave at one sentence keeps its list sentence instead: a one-line
 * summary says less than a list does, and the repair round (repair.js) is asked to make the
 * list a sentence about work rather than lose it.
 */
export function summaryWithoutLists(draft, source, { minSentences = MIN_SUMMARY_SENTENCES } = {}) {
  const own = new Set(sentencesOf(source).map((s) => lower(s)));
  const parts = sentencesOf(draft);
  const kept = parts.filter((s) => own.has(lower(s)) || !listLike(s));
  if (!kept.length) return source;
  // `minSentences` is the mode's (style.js summarySentences): a Staff AI Engineer tailoring lost
  // "Builds LLM-based agents with asynchronous workflows, tool orchestration, human oversight…",
  // the one sentence saying what the candidate builds in the job's terms, and kept three.
  const floor = Math.max(MIN_SUMMARY_SENTENCES, minSentences);
  return (kept.length < floor && parts.length >= MIN_SUMMARY_SENTENCES ? parts : kept).join('').replace(/\s+/g, ' ').trim();
}

/** Fewer sentences than this, or fewer words than MIN_SUMMARY_WORDS, and a summary is short (repair.js). */
export const MIN_SUMMARY_SENTENCES = 2;
export const MIN_SUMMARY_WORDS = 40;
export const summaryWords = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;
/** The sentences of a summary that read as a list of tools, which the scorer marks as mentions. */
export const listSentences = (text) => sentencesOf(text).filter((s) => listLike(s));

// A term named by its own spelling or by stems, so "ledger-based accounting models" names the
// requirement "ledger-based accounting model".
const names = (text, term) => hasKeyword(text, term) || shows(text, term);

/**
 * The draft summary without a sentence that claims a job term the resume never shows: `terms`
 * are what the job asks for, `allowed` the terms the user confirmed or left to the rewrite, and
 * `sourceText` the source resume's text. "Experience includes payment flows using ACH and
 * ledger-based accounting models" went into a summary when the resume showed neither and only
 * ACH was assumed; the sentence goes, as a bullet that invents a fact does (claims.js). A
 * sentence the source summary has is the candidate's own and stays. A draft left with nothing
 * gives way to the source.
 */
export function summaryWithoutClaims(draft, source, { terms = [], allowed = [], sourceText = '' } = {}) {
  const own = new Set(sentencesOf(source).map((s) => lower(s)));
  const claims = (s) => terms.some((k) => typeof k === 'string' && k.trim() && names(s, k) && !names(sourceText, k) && !allowed.some((a) => sameTerm(a, k) || names(a, k)));
  const kept = sentencesOf(draft).filter((s) => own.has(lower(s)) || !claims(s));
  return kept.length ? kept.join('').replace(/\s+/g, ' ').trim() : source;
}

// A sentence of the source summary that states a standing the work alone does not show: an
// award, a book, a patent, a talk. "10x Microsoft MVP in AI." and "Author of Master Machine
// Learning with Python (BPB Publishing)." went missing from a Staff AI Engineer tailoring whose
// posting asked for public writing; the rewrite has no reason to drop such a line.
const CREDENTIAL_RE =
  /\b(?:MVPs?|awards?|awarded|author(?:ed)?|co-?author(?:ed)?|published|publications?|patents?|patented|speaker|spoke at|keynote|fellow(?:ship)?|winner|won|maintainer|Google Developer Expert|GDE|Kaggle|champion|top \d+%?)\b/i;
const MAX_CREDENTIAL_CHARS = 160;
// Half or more of the sentence's details gone from the draft and it is not said there.
const CREDENTIAL_LOST = 0.5;

/** At most this many figures in a summary, years and credentials aside: more reads as a list of metrics (repair.js). */
export const MAX_SUMMARY_FIGURES = 2;
const YEARS_FIGURE_RE = /\d+\+?\s*(?:years?|yrs?)\b/gi;

/**
 * The figures a summary states, not counting its tenure ("9+ years") or a credential sentence
 * ("10x Microsoft MVP in AI").
 */
export function summaryFigures(text) {
  return sentencesOf(text)
    .filter((s) => !CREDENTIAL_RE.test(s))
    .flatMap((s) => figuresOf(s.replace(YEARS_FIGURE_RE, ' ')));
}

/**
 * The draft summary without a sentence that names a language, cloud or container platform the
 * resume (`sourceText`) never shows and the member did not confirm (stack.js). A draft left with
 * nothing gives way to the source.
 */
export function summaryWithoutNewStack(draft, source, { sourceText = '', confirmed = [] } = {}) {
  const kept = sentencesOf(draft).filter((s) => !newStackTerms(s, { sourceText, confirmed }).length);
  return kept.length ? kept.join('').replace(/\s+/g, ' ').trim() : source;
}

/**
 * The draft summary with every short credential sentence of the source's that it dropped put
 * back at its end. A sentence counts as dropped when half or more of its figures and names
 * (detail.js) are nowhere in the draft.
 */
export function summaryWithSourceCredentials(draft, source) {
  const missing = sentencesOf(source)
    .map((s) => s.trim())
    .filter((s) => s.length <= MAX_CREDENTIAL_CHARS && CREDENTIAL_RE.test(s))
    .filter((s) => {
      const details = [...figuresOf(s), ...namesOf(s)];
      return details.length > 0 && lostDetails(s, draft).length / details.length >= CREDENTIAL_LOST;
    });
  if (!missing.length) return draft;
  const text = String(draft || '').trim();
  return [/[.!?]$/.test(text) ? text : `${text}.`, ...missing].join(' ');
}

/**
 * The draft summary with its tenure as the source states it: when the draft's sentence that
 * counts the years names a job term (`terms`: the job's keywords and its title's words) that the
 * source's does not, the source's sentence takes its place and the rest of the draft stands.
 */
export function summaryWithSourceTenure(draft, source, terms = []) {
  const own = sentencesOf(source).find((s) => TENURE_RE.test(s));
  const parts = sentencesOf(draft);
  const at = parts.findIndex((s) => TENURE_RE.test(s));
  if (!own || at < 0) return draft;
  const claims = terms.some((k) => typeof k === 'string' && k.trim() && hasKeyword(parts[at], k) && !hasKeyword(own, k));
  if (!claims) return draft;
  parts[at] = `${own.trim()} `;
  return parts.join('').replace(/\s+/g, ' ').trim();
}
