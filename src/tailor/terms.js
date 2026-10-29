import { hasKeyword } from '../text/keywords.js';
import { claimsClearance, claimsCredential } from './claims.js';
import { SAME_WORDING, sameTerm, sameWording, squash, termsIn, unique } from './text.js';

// ── Keywords and assumed terms ──────────────────────────────────────────────
//
// Score first writes in the job's terms the resume lacks. Which of them, and how many, is what
// keeps the result a resume: twenty resumes read by another grader lost their realism to the
// pairs where 14 to 22 terms went in (a full-stack resume made an inference engineer, a web
// engineer a network ASIC tester), and to terms that were never a skill at all ("GitCI/CD?",
// "MS-SQL 2016 or later", "natural language processing techniques like fuzzy wuzzy").

/** The job's keywords split by whether the resume text has them verbatim. */
export function splitJobKeywords(keywords, resumeText) {
  const terms = unique((Array.isArray(keywords) ? keywords : []).filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim()));
  return {
    matchedKeywords: terms.filter((k) => hasKeyword(resumeText, k)),
    missingKeywords: terms.filter((k) => !hasKeyword(resumeText, k)),
  };
}

/**
 * The terms of `terms` the posting's `description` names, as the scorer and the rewrite read it:
 * a term the model or the scorer brought in that the posting never says ("monitoring" on a
 * payments posting, matched from the resume's own skills) protects no line and keeps no skill.
 * Without a description, every term stands.
 */
export function postingTerms(description, terms) {
  const list = (Array.isArray(terms) ? terms : []).filter((k) => typeof k === 'string' && k.trim());
  return description?.trim() ? list.filter((k) => hasKeyword(description, k)) : list;
}

// The balanced mode's caps; each mode sets its own (style.js TAILOR_MODES), these are the
// defaults where no mode is given. At most MAX_ASSUMED_TERMS terms are written in on assumption;
// the rest are left as the gaps they are. MAX_NEW_TERMS_PER_LINE and MAX_NEW_TERMS_PER_ROLE
// are how many assumed terms a line may bring in, and a role may carry: beyond this the resume
// reads as the posting pasted in, whatever the score says (another grader put the realism of
// six resumes at 7-8.5 of 10 for exactly this).
export const MAX_ASSUMED_TERMS = 8;
export const MAX_NEW_TERMS_PER_LINE = 2;
export const MAX_NEW_TERMS_PER_ROLE = 8;

const TERM_WORDS = 3;
// A phrase, a question mark, a version clause or an activity noun: the posting's wording, not a skill's name.
const NOT_A_TERM_RE = /[?]|\b(?:or|like|such as|similar|etc|and|incl?\.?|including|e\.g)\b/i;
const ACTIVITY_NOUN_RE = /\b(?:development|services|practices|techniques|processes|principles|concepts|methodologies|fundamentals|strategies|skills|experience|knowledge|understanding|abilities)$/i;
const VERB_FORM_RE = /^[a-z]+(?:ised|ized)$/i;

/** True when a keyword reads as a skill's name — the kind of term a resume lists — and not a phrase of the posting. */
export function assumableTerm(keyword) {
  const term = squash(keyword);
  if (!term || term.length > 40 || term.split(/\s+/).length > TERM_WORDS) return false;
  if (NOT_A_TERM_RE.test(term) || ACTIVITY_NOUN_RE.test(term) || VERB_FORM_RE.test(term)) return false;
  return /[\p{L}\p{N}]/u.test(term);
}

// What a posting asks of the candidate that no skills list names: a check they pass, a condition
// of the job ("background check", "travel", "on-call"). A clearance or a credential is caught by claims.js.
const CANDIDATE_CONDITION_RE =
  /\b(?:(?:background|criminal|reference|credit|employment) (?:checks?|screening)|drug (?:tests?|testing|screen\w*)|relocat\w*|travel\w*|on-?site|in-?office|hybrid|on-?call|overtime|weekends?|shifts?|driver'?s licen[cs]e|years?)\b/i;

/** True when a keyword is a skill a resume lists — NestJS, unit testing — not a phrase of the posting or a condition of the job. */
export const skillTerm = (keyword) => assumableTerm(keyword) && !CANDIDATE_CONDITION_RE.test(keyword) && !claimsClearance(keyword) && !claimsCredential(keyword);

/**
 * The assumed terms score first writes in, from everything the job asks for that the resume
 * lacks (`missing`, already without what the user confirmed or declined): `assumed` are forced
 * in — what the job requires, by a non-preferred requirement naming it or its skills list, up
 * to MAX_ASSUMED_TERMS, the ones a requirement names first and then the job's own order;
 * `optional` are the nice-to-haves, added only where the candidate's work makes them plausible
 * (keywordRules); `leftOut` are the required terms the cap left out — not offered to the model
 * at all (offered as plausible, nine networking terms went into a web engineer's skills), and
 * reported so the fit reads as it is. What is not a term is dropped. `scoring` is the job's
 * score (its requirements), `job` the job (its skills), `max` the mode's cap (style.js).
 */
export function splitAssumedTerms(missing, { job = null, scoring = null, max = MAX_ASSUMED_TERMS } = {}) {
  const terms = unique((missing || []).filter((k) => typeof k === 'string' && assumableTerm(k)));
  const requiredTexts = (Array.isArray(scoring?.requirements) ? scoring.requirements : []).filter((r) => r?.priority !== 'preferred').map((r) => r?.text || '');
  const named = (k) => requiredTexts.some((t) => hasKeyword(t, k));
  const listed = (k) => (job?.skills || []).some((s) => sameTerm(s, k));
  const required = terms.filter((k) => named(k) || listed(k));
  // The job's own skills that a requirement also names first, then its skills, then what only
  // a requirement's sentence names (a phrase more often than a tool: "presales").
  const weight = (k) => Number(listed(k)) * 2 + Number(named(k));
  const ordered = required.map((k, i) => ({ k, i })).sort((a, b) => weight(b.k) - weight(a.k) || a.i - b.i).map(({ k }) => k);
  const assumed = ordered.slice(0, max);
  const leftOut = ordered.slice(max);
  const optional = terms.filter((k) => !required.some((a) => sameTerm(a, k)));
  return { assumed, optional, leftOut };
}

// ── Platforms ───────────────────────────────────────────────────────────────
// A term of one platform written into a bullet about another ("XCTest unit tests across Android
// components") is a line nobody who did the work would write. The platforms whose tools are
// theirs alone; a bullet names one by any of its words.
const PLATFORMS = [
  { name: 'iOS', words: ['iOS', 'iPhone', 'iPad', 'Swift', 'SwiftUI', 'UIKit', 'XCTest', 'Xcode', 'Objective-C', 'CocoaPods', 'Core Data', 'TestFlight'] },
  { name: 'Android', words: ['Android', 'Jetpack Compose', 'Android Studio', 'Espresso', 'Kotlin Multiplatform', 'Play Store'] },
  { name: '.NET', words: ['.NET', 'C#', 'ASP.NET', 'Entity Framework', 'Blazor'] },
  { name: 'Spring', words: ['Spring', 'Spring Boot', 'Hibernate', 'J2EE', 'Jakarta EE'] },
];
const platformOf = (text) => PLATFORMS.filter((p) => p.words.some((w) => hasKeyword(text, w))).map((p) => p.name);

/**
 * True when `text` brings a term of one platform onto a bullet that is about another: `before` is
 * the bullet as it was (its platform is what it is about), `terms` the assumed terms. A bullet
 * that already spanned two platforms is left alone.
 */
export function crossesPlatform(before, text, terms = []) {
  const about = platformOf(before);
  if (about.length !== 1) return false;
  const fresh = termsIn(text, terms).filter((k) => !hasKeyword(before, k));
  return fresh.some((k) => {
    const of = platformOf(k);
    return of.length === 1 && of[0] !== about[0];
  });
}

// A term as one item of a list: ", X", ", and X", " and X", " or X" — or "X, " and "X and " at
// a list's head. The words of a term may be joined by spaces, hyphens or underscores.
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termBody = (term) => squash(term).split(/[-_\s]+/).filter(Boolean).map(escapeRegex).join('[-_\\s]+');
const EDGE_BEFORE = '(?<![\\p{L}\\p{N}+#])';
const EDGE_AFTER = '(?![\\p{L}\\p{N}+#])';
const listItemPatterns = (term) => {
  const body = termBody(term);
  if (!body) return [];
  return [
    new RegExp(`(?:,\\s*(?:and|or|&)?\\s*|\\s+(?:and|or|&)\\s+)${EDGE_BEFORE}${body}${EDGE_AFTER}`, 'iu'),
    new RegExp(`${EDGE_BEFORE}${body}${EDGE_AFTER}(?:,\\s*|\\s+(?:and|or|&)\\s+)`, 'iu'),
  ];
};

/**
 * True when `text` is `before` with an assumed term glued on as one more item of a list:
 * "Designed backend services with REST APIs, PostgreSQL, Redis, and instant payment networks" is
 * the source bullet with the posting's term appended, not a line about work with it. The term is
 * taken out with its comma or "and", and what is left is checked against `before`: the same
 * wording (SAME_WORDING) means nothing but the term came in. A term that became part of the
 * work ("the GitHub Actions CI pipeline") or a clause that says something new is not glue.
 */
export function gluedTerm(before, text, terms = []) {
  const fresh = termsIn(text, terms).filter((k) => !hasKeyword(before, k));
  return fresh.some((k) =>
    listItemPatterns(k).some((pattern) => {
      const match = pattern.exec(text);
      if (!match) return false;
      const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
      return sameWording(before, rest) >= SAME_WORDING;
    })
  );
}

/**
 * True when a line brings in more assumed terms than a line may (`perLine`, beyond what
 * `before` already named), or takes the role past `perRole` with the terms the role's other
 * lines (`roleTerms`) already carry. The caps are the mode's (style.js); the balanced ones by default.
 */
export function tooManyTerms(text, assumed, { before = '', roleTerms = new Set(), perLine = MAX_NEW_TERMS_PER_LINE, perRole = MAX_NEW_TERMS_PER_ROLE } = {}) {
  const fresh = termsIn(text, assumed).filter((k) => !hasKeyword(before, k));
  return fresh.length > perLine || new Set([...roleTerms, ...termsIn(text, assumed)]).size > perRole;
}
