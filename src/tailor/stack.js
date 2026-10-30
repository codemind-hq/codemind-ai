import { hasKeyword } from '../text/keywords.js';

// ── Stack terms ─────────────────────────────────────────────────────────────
//
// A language, a cloud or a container platform is a fact of the work, not a word for it: a resume
// that never shows Go, GCP or Kubernetes cannot be given "Go utilities", "GCP deployments" or
// "Kubernetes release targets" because the posting lists them as nice-to-haves. Score first
// wrote all three into one member's tailoring (Cobalt Staff AI Engineer, 2026-10-27), each on a
// role that used Python, Azure and Docker. Such a term is written in only when the resume
// already names it, or the member confirmed it; otherwise it is asked ("do you have these?").

// Matched in this case only: "Go" the language, never "go" the verb; "R" and "C" are left out,
// one letter is no evidence either way.
const EXACT = [
  ['Go', 'Golang'],
  ['Rust'],
  ['Swift'],
  ['Dart'],
];
const LANGUAGES = [
  'Java', 'Kotlin', 'Scala', 'Ruby', 'PHP', 'Elixir', 'Erlang', 'Haskell', 'Clojure', 'C++', 'C#', 'F#',
  'Objective-C', 'Perl', 'Julia', 'Lua', 'TypeScript', 'JavaScript', 'Python', 'Solidity', 'COBOL', 'Fortran',
];
// The clouds, each by its names: "Google Cloud" is GCP.
const CLOUDS = [['AWS', 'Amazon Web Services'], ['GCP', 'Google Cloud', 'Google Cloud Platform'], ['Azure', 'Microsoft Azure'], ['Oracle Cloud', 'OCI'], ['IBM Cloud'], ['Alibaba Cloud']];
const PLATFORMS = [['Kubernetes', 'K8s', 'EKS', 'GKE', 'AKS', 'OpenShift'], ['Nomad'], ['ECS'], ['Mesos']];

const caseWord = (word) => new RegExp(`(?<![\\p{L}\\p{N}+#.])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}+#])`, 'u');
const FAMILIES = [
  ...EXACT.map((names) => ({ names, shows: (text) => names.some((n) => caseWord(n).test(text)) })),
  ...[...LANGUAGES.map((n) => [n]), ...CLOUDS, ...PLATFORMS].map((names) => ({ names, shows: (text) => names.some((n) => hasKeyword(text, n)) })),
];
const familyOf = (term) => FAMILIES.find((f) => f.names.some((n) => n.toLowerCase() === String(term || '').trim().toLowerCase()) || f.shows(term));

/** True when `term` names a language, cloud or container platform (stack.js FAMILIES). */
export const isStackTerm = (term) => Boolean(familyOf(term));

/** True when `a` and `b` name the same language, cloud or platform ("Go", "Golang"). */
export const sameStack = (a, b) => {
  const family = familyOf(a);
  return Boolean(family) && family === familyOf(b);
};

/** The stack terms of `terms`, one per family under its first name ("Golang" is Go); the rest as they are. */
export function oneNamePerStack(terms) {
  const seen = new Set();
  return (terms || []).flatMap((term) => {
    const name = familyOf(term)?.names[0] ?? term;
    if (seen.has(name.toLowerCase())) return [];
    seen.add(name.toLowerCase());
    return [name];
  });
}

/**
 * The stack terms of `terms` that `sourceText` (the resume as uploaded and as a form) never
 * names under any of their names, and the member did not confirm: the ones no rewrite may write in.
 */
export function unbackedStackTerms(terms, sourceText, confirmed = []) {
  return (terms || []).filter((term) => {
    const family = familyOf(term);
    if (!family || family.shows(sourceText)) return false;
    return !confirmed.some((c) => family.names.some((n) => n.toLowerCase() === String(c).trim().toLowerCase()) || family.shows(c));
  });
}

/**
 * The stack families `text` names that `before` (the bullet it rewrites, '' for a new line) and
 * `sourceText` (the whole resume) do not, and the member did not confirm: [] when it brings none.
 * Covers every term, listed for the rewrite or not: a model asked for the job's words writes the
 * posting's stack in whether or not it was offered.
 */
export function newStackTerms(text, { before = '', sourceText = '', confirmed = [] } = {}) {
  return FAMILIES.filter((f) => f.shows(text) && !f.shows(before) && !f.shows(sourceText) && !confirmed.some((c) => f.shows(c)))
    .map((f) => f.names[0]);
}
