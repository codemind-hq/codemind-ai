// How to improve a resume's match, read from a score already made (service.js quickScoreResume):
// no model call. Each suggestion names a requirement the scorer judged and says what to do about it,
// and only ever asks the reader to show what they really have:
// - `missing`: the resume does not show it at all. It may be experience the reader lacks, so the
//   advice says to add it only if it is true, and to leave the gap otherwise.
// - `evidence`: the resume mentions it without showing it (a skill only listed, a claim with no
//   work behind it). The fix is the proof the reader already has: where, how, with what result.
// - `emphasize`: experience already in the resume that the scorer saw as worth bringing forward
//   (the model's tailoringOpportunities, which it is told to draw from the resume alone).
// Most important first: required before preferred, then experience, responsibilities, education,
// then the job's named skills, then what to emphasize.

export const IMPROVEMENT_KINDS = ['missing', 'evidence', 'emphasize'];

const KIND_ORDER = { experience: 0, responsibility: 1, education: 2 };
const MAX_QUOTE = 90;

const shortQuote = (quote) => {
  const text = String(quote || '').replace(/\s+/g, ' ').trim();
  return text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE - 1).replace(/\s+\S*$/, '')}…` : text;
};

/** What to do about a requirement the resume does not show. */
function missingAdvice(kind) {
  if (kind === 'education') return 'If you hold this degree or certification, list it under Education or Certifications. If you do not, leave it out.';
  if (kind === 'responsibility') return 'Not found in your resume. If you have done this, add a bullet under the role where you did it: what you did, at what scale, and what came of it.';
  return 'Not found in your resume. If you have this experience, state it under the role where you gained it, with the years and scope. If you do not, this is a real gap: never add it.';
}

/** What to do about a requirement the resume mentions without showing. */
function evidenceAdvice(quote) {
  const said = shortQuote(quote);
  return said
    ? `Your resume says "${said}" but does not show the work behind it. If it is real, expand it under that role: what you built, your part in it, and a result you can stand behind.`
    : 'Your resume touches on this without showing it. If you have done it, add a bullet under the role where you did: what, how, and the outcome.';
}

/**
 * The suggestions for one score, most important first: [{ kind, requirement, suggestion, priority }].
 * `requirement` is the posting's own words (null for an `emphasize`). Reads the score's
 * `requirements` (verdicts), `requiredSkillVerdicts`, `preferredSkillVerdicts` and
 * `tailoringOpportunities`; any of them may be absent.
 */
export function improvementSuggestions(scoring, { limit = 8 } = {}) {
  const verdicts = Array.isArray(scoring?.requirements) ? scoring.requirements : [];
  const out = [];
  const seen = new Set();
  const push = (item) => {
    const key = `${item.kind}:${String(item.requirement || item.suggestion).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  const gaps = verdicts
    .filter((v) => v && typeof v.text === 'string' && (v.verdict === 'missing' || v.verdict === 'weak'))
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'required' ? -1 : 1) || (KIND_ORDER[a.kind] ?? 3) - (KIND_ORDER[b.kind] ?? 3) || (a.verdict === b.verdict ? 0 : a.verdict === 'weak' ? -1 : 1));
  // Required requirements, then the job's required skills, then the preferred ones of both.
  const skillGaps = (list, priority) =>
    (Array.isArray(list) ? list : [])
      .filter((s) => s && typeof s.skill === 'string' && (s.verdict === 'missing' || s.verdict === 'weak'))
      .map((s) => ({
        kind: s.verdict === 'weak' ? 'evidence' : 'missing',
        requirement: s.skill,
        priority,
        suggestion:
          s.verdict === 'weak'
            ? `${s.skill} is in your skills list but in none of your roles. If you used it at work, name it in the bullet where you did.`
            : `${s.skill} is not in your resume. If you have used it, add it to your skills and to the role where you used it. If not, leave it out.`,
      }));
  const fromVerdict = (v) => ({
    kind: v.verdict === 'weak' ? 'evidence' : 'missing',
    requirement: v.text,
    priority: v.priority === 'required' ? 'required' : 'preferred',
    suggestion: v.verdict === 'weak' ? evidenceAdvice(v.quote) : missingAdvice(v.kind),
  });

  for (const v of gaps.filter((g) => g.priority === 'required')) push(fromVerdict(v));
  for (const item of skillGaps(scoring?.requiredSkillVerdicts, 'required')) push(item);
  for (const v of gaps.filter((g) => g.priority !== 'required')) push(fromVerdict(v));
  for (const item of skillGaps(scoring?.preferredSkillVerdicts, 'preferred')) push(item);
  for (const text of Array.isArray(scoring?.tailoringOpportunities) ? scoring.tailoringOpportunities : []) {
    if (typeof text === 'string' && text.trim()) push({ kind: 'emphasize', requirement: null, priority: 'preferred', suggestion: text.trim() });
  }
  return out.slice(0, limit);
}
