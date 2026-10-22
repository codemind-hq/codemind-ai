import { hasKeyword } from '../text/keywords.js';

// ── Verdicts ───────────────────────────────────────────────────────────────
//
// Each thing the job asks for gets one verdict, worth a fixed share of its category. Skills are
// judged in code alone: shown in a line of work, only listed, or absent. For the requirements the
// model gives a verdict and a quote, and code throws out a quote the resume does not contain and
// caps a years requirement at what the dates support. Verdict-with-quote checking follows
// ai-job-hunter-app's evidence grounding (Apache-2.0), pipeline/resume/stages/evidence.rs and
// verbatim.rs.

export const VERDICT_POINTS = { met: 1, weak: 0.5, missing: 0 };
const LOWER = { met: 'weak', weak: 'missing', missing: 'missing' };
export const RANK = { missing: 0, weak: 1, met: 2 };
const lowest = (a, b) => (RANK[a] <= RANK[b] ? a : b);

/** Where a resume form shows its work, as opposed to where it only lists skills. */
function evidenceText(form) {
  return [
    form.title,
    form.summary,
    ...(form.experience || []).flatMap((e) => [e.title, ...(e.achievements || [])]),
    ...(form.projects || []).flatMap((p) => [p.name, p.role, ...(p.highlights || [])]),
    ...(form.achievements || []),
    ...(form.otherSections || []).map((o) => o.content),
    ...(form.certifications || []).map((c) => [c.name, c.issuer].filter(Boolean).join(' ')),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The verdict on each job skill, decided in code: shown in a line of work (a bullet, the summary,
 * a project) is met, only in the Skills list is weak, absent is missing. `resume` is the form,
 * or a resume's text, where found anywhere is met. [{ skill, verdict }], in the job's order.
 */
export function skillVerdicts(resume, skills) {
  const seen = new Set();
  const unique = (skills || [])
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim())
    .filter((s) => !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
  if (typeof resume === 'string') return unique.map((skill) => ({ skill, verdict: hasKeyword(resume, skill) ? 'met' : 'missing' }));
  const shown = evidenceText(resume || {});
  const listed = (resume?.skills || []).join(', ');
  return unique.map((skill) => ({ skill, verdict: hasKeyword(shown, skill) ? 'met' : hasKeyword(listed, skill) ? 'weak' : 'missing' }));
}

// Words only, lower case, one space between: "Built  the  API (Go)." and "built the api go" are one quote.
const squash = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim();
const holds = (text, q) => Boolean(q) && ` ${squash(text)} `.includes(` ${q} `);

/**
 * True when `quote` is words the resume actually contains, whole words in order, ignoring case,
 * punctuation and spacing. The rule the model's evidence is held to. Length is not judged: a
 * model quotes "PostgreSQL" one run and the whole line the next, and both are the same evidence.
 */
export function quoteInResume(quote, resumeText) {
  return holds(resumeText, squash(quote));
}

const YEARS_ASKED_RE = /\b(\d{1,2})(?:\s*(?:-|–|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b/i;

/**
 * The verdict a requirement can have at most, given the years it asks for and the years the
 * resume supports (checks/tenure.js supportedYears): enough is no limit, one short is weak, more is
 * missing. No limit when either side states no number.
 */
export function yearsCap(requirement, supported) {
  const asked = Number(String(requirement || '').match(YEARS_ASKED_RE)?.[1]);
  if (!asked || supported == null) return 'met';
  if (supported >= asked) return 'met';
  return supported >= asked - 1 ? 'weak' : 'missing';
}

// A requirement about something measured: ownership of DORA metrics, database performance, cost
// efficiency. A line shows it only by stating a figure; "improved performance" without one is a
// mention, as a skills-list entry is.
export const MEASURED_RE = /\b(measurabl\w*|metrics?|dora|slos?|slas?|error budgets?|tun(?:e|ed|ing)|optimi[sz]\w*|costs?|latenc\w*|throughput|uptime|performance|efficiency|incident (?:frequency|duration|rate)s?|reduc\w+ (?:production )?incidents?)\b/i;
const statesFigure = (text) => /\d/.test(text);

/**
 * True when a quote is mostly a list of names ("AWS, PostgreSQL, Redis, Docker, CI/CD, GitHub
 * Actions, monitoring, and production support"): four or more comma-separated parts, and the
 * short ones (two words or fewer) hold at least half of its words. Such a line names tools; it
 * shows no work with them, so it is the Skills list in a sentence.
 */
export function listLike(quote) {
  const parts = String(quote || '')
    .split(/[,;]|\band\b/)
    .map((p) => squash(p))
    .filter(Boolean);
  if (parts.length < 4) return false;
  const words = (p) => p.split(' ').length;
  const total = parts.reduce((n, p) => n + words(p), 0);
  const short = parts.filter((p) => words(p) <= 2).reduce((n, p) => n + words(p), 0);
  return short * 2 >= total;
}

/**
 * The model's verdicts made trustworthy: a met or weak whose quote is not in the resume drops a
 * level; a met whose quote is only in the Skills list is weak, as a skill listed but never shown
 * is (skillVerdicts), when `evidence` (the resume without its Skills list) is given; a met whose
 * quote is a list of names (listLike), or that states no figure for a requirement about
 * something measured, is weak; and an experience requirement asking for more years than the
 * resume supports is capped. `requirements` are [{ text, kind, priority }]; returns them with
 * `verdict` and `quote`.
 */
export function checkedVerdicts(requirements, answer, { resumeText, evidence = null, supportedYears = null }) {
  const given = new Map((Array.isArray(answer?.verdicts) ? answer.verdicts : []).filter((v) => Number.isInteger(v?.id)).map((v) => [v.id, v]));
  return requirements.map((req, id) => {
    const said = given.get(id);
    let verdict = VERDICT_POINTS[said?.verdict] !== undefined ? said.verdict : 'missing';
    const quote = typeof said?.quote === 'string' ? said.quote.trim() : '';
    if (verdict !== 'missing' && !quoteInResume(quote, resumeText)) verdict = LOWER[verdict];
    else if (verdict === 'met' && evidence !== null && !holds(evidence, squash(quote))) verdict = 'weak';
    else if (verdict === 'met' && listLike(quote)) verdict = 'weak';
    else if (verdict === 'met' && req.kind !== 'education' && MEASURED_RE.test(req.text) && !statesFigure(quote)) verdict = 'weak';
    if (req.kind === 'experience') verdict = lowest(verdict, yearsCap(req.text, supportedYears));
    return { ...req, verdict, quote: verdict === 'missing' ? '' : quote };
  });
}

/**
 * Verdicts on a rewritten resume held against the ones its source got (`prior`: { requirements,
 * resumeText }), so a before and after comparison moves only for what the rewrite changed. A
 * verdict may not drop while the line that earned the earlier one is still in the resume, and may
 * not rise on a line that was already in the source: either move would be the model reading the
 * same evidence twice, differently. Requirements are matched by their text; one without an
 * earlier verdict keeps its new one.
 */
export function heldVerdicts(verdicts, prior, resumeText) {
  if (!prior?.requirements?.length) return verdicts;
  const earlier = new Map(prior.requirements.map((r) => [r.text, r]));
  return verdicts.map((v) => {
    const p = earlier.get(v.text);
    if (!p || RANK[p.verdict] === undefined || p.verdict === v.verdict) return v;
    if (RANK[v.verdict] < RANK[p.verdict] && p.quote && quoteInResume(p.quote, resumeText)) return { ...v, verdict: p.verdict, quote: p.quote };
    if (RANK[v.verdict] > RANK[p.verdict] && quoteInResume(v.quote, prior.resumeText || '')) return { ...v, verdict: p.verdict, quote: p.quote || '' };
    return v;
  });
}
