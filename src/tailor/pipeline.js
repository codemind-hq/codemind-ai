import { quickScoreResume } from '../ats/service.js';
import { hasKeyword, keywordList, sameKeyword, uniqueKeywords } from '../text/keywords.js';
import { structuredResumeToText } from '../resume/structuredResume.js';
import { fillTailoringGaps, tailorResumeForm } from './service.js';
import { postingTerms, splitAssumedTerms, tailorMode, tailorStyle, withoutCuts } from './index.js';
import { AiError } from '../errors.js';
import { executionSignal } from '../llm/execution.js';
import { isExecutionStopped, safeErrorDetails } from '../llm/errors.js';
import { enforceConfirmation } from './confirmation.js';

// The whole tailoring of one resume for one job, as the calls run it: the source scored (unless
// a score is handed in), the rewrite, the rewrite scored against the source's own verdicts, the
// cuts put back when they cost more than the rewording gained, then the mode's gap passes until
// the score reaches its target. What it returns is for the caller to store; nothing is saved here.

// The scorer moves 5-8 points on the same resume from one run to the next (17 prod pairs
// re-run, 2026-10-06), so a gap pass that fixed two verdicts was thrown away when its score
// landed a point lower. A pass is kept when the score rose, or when more requirements and
// skills are met and the score fell no further than the noise.
const SCORE_NOISE = 3;
const metCount = (scoring) =>
  [...(scoring?.requirements || []), ...(scoring?.requiredSkillVerdicts || []), ...(scoring?.preferredSkillVerdicts || [])].filter((v) => v?.verdict === 'met').length;
/** True when the gap pass that produced `next` moved the tailoring forward from `prior`. */
export function gapPassProgressed(prior, next) {
  if (next.score > prior.score) return true;
  return metCount(next) > metCount(prior) && next.score >= prior.score - SCORE_NOISE;
}

/**
 * Tailor `form` (the source resume's structured form) for `job` (with its `requirements`).
 * `originalText` is everything the source resume says (its upload's text and its form), which
 * decides what it already has. `scoring` is its cached score for the job; without one it is scored
 * first, because the scorer's findings steer the rewrite. `confirmedKeywords` (missing keywords the
 * user says they have; null when not asked) limits added keywords to those, and `evidence` is what
 * they said about them ([{ keyword, role, note }]). `assumedKeywords` are missing keywords they
 * neither confirmed nor declined, `declinedKeywords` the ones they switched off. `style` is how far
 * the rewrite goes (style.js); `instructions` the user's own notes; `model` the tailoring model.
 * `requireConfirmedKeywords` blocks known new job terms unless confirmed (default false).
 * `timeoutMs` is a shared workflow budget; `meta.signal` supports cancellation.
 * `completion` reports optional-stage failures, while `review` identifies unconfirmed terms
 * and estimated figures for the host's review UI. Neither automatically approves an export.
 *
 * @param {{ form: import('../types.js').ResumeForm, originalText: string, job: import('../types.js').Job, scoring?: import('../types.js').Scoring | null, confirmedKeywords?: string[] | null, assumedKeywords?: string[], declinedKeywords?: string[], evidence?: object[], style?: import('../types.js').TailorStyle, instructions?: string, model: string, meta?: import('../types.js').CallMeta, requireConfirmedKeywords?: boolean, timeoutMs?: number }} input
 * @returns {Promise<{ before: import('../types.js').Scoring, after: import('../types.js').Scoring, tailored: object, style: import('../types.js').TailorStyle, confirmed: string[], candidates: string[], assumed: string[], assumedAll: string[], split: object, completion: import('../types.js').TailoringCompletion, review: import('../types.js').TailoringReview }>}
 */
export async function runTailoring({
  form,
  originalText,
  job,
  scoring = null,
  confirmedKeywords = null,
  assumedKeywords = [],
  declinedKeywords = [],
  evidence = [],
  style,
  instructions = '',
  model,
  meta = {},
  requireConfirmedKeywords = false,
  timeoutMs,
}) {
  if (timeoutMs !== undefined) {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2 ** 31 - 1) throw AiError.badRequest('timeoutMs must be a positive integer no greater than 2147483647');
    meta = { ...meta, deadlineAt: Math.min(meta.deadlineAt ?? Infinity, Date.now() + timeoutMs) };
  }
  executionSignal(meta); // Reject cancelled/expired requests before even using a cached score.
  const before = scoring || (await quickScoreResume(form, job, meta));

  // Every keyword the rewrite could be tempted to add. Asked and not confirmed means blocked.
  const confirmed = confirmedKeywords || [];
  const candidates = [...(job.skills || []), ...(job.preferredSkills || []), ...keywordList(before.missingKeywords || before.topMissingKeywords)];
  style = tailorStyle(style);
  const mode = tailorMode(style);
  const declined = (k) => declinedKeywords.some((d) => sameKeyword(d, k));
  // Left to the rewrite: everything the job asks for that the user did not switch off, not only
  // the chips that were on screen; not already in the resume, and not also confirmed.
  const offered = [...assumedKeywords, ...candidates.filter((k) => !declined(k))];
  const missing = uniqueKeywords(offered).filter((k) => !hasKeyword(originalText, k) && !confirmed.some((c) => sameKeyword(c, k)));
  // What the job requires, up to the mode's cap (terms.js splitAssumedTerms), is
  // `assumed`: score first writes every one in, the other modes the ones the resume's own work
  // makes plausible by their bar. A nice-to-have — a preferred skill, or a term only a preferred
  // requirement names — is `optional`, added where plausible in every mode. What the cap leaves
  // out is offered to nobody: twenty resumes read by another grader lost their realism exactly
  // where fourteen or more terms went in, for a tenth of the score. What is not a skill's name
  // ("GitCI/CD?") is never written in.
  // Confirmation-only mode leaves unknown terms open instead of offering them as assumptions.
  const split = requireConfirmedKeywords ? { assumed: [], optional: [], leftOut: missing } : splitAssumedTerms(missing, { job, scoring: before, max: mode.maxAssumedTerms });
  // Score first forces the nice-to-haves in as well, after the required terms and within the
  // same cap: the job's preferred skills are a tenth of the score (ats/breakdown.js), and a
  // resume that names none of them tops out around 85 whatever else it says.
  const forced = mode.forceAssumed ? uniqueKeywords([...split.assumed, ...split.optional]).slice(0, mode.maxAssumedTerms) : split.assumed;
  const assumed = forced;
  const optional = split.optional.filter((k) => !forced.some((f) => sameKeyword(f, k)));
  const assumedAll = [...assumed, ...optional];
  const allowed = [...confirmed, ...assumedAll];
  const blockedKeywords = requireConfirmedKeywords || Array.isArray(confirmedKeywords)
    ? uniqueKeywords(requireConfirmedKeywords ? [...candidates, ...missing] : candidates).filter((k) => !hasKeyword(originalText, k) && !allowed.some((c) => sameKeyword(c, k)))
    : [];

  const request = { confirmedKeywords: requireConfirmedKeywords ? confirmed : confirmedKeywords, blockedKeywords, evidence, style, instructions, model, meta };
  let tailored = await tailorResumeForm(form, job, { ...request, scoring: before, assumedKeywords: assumed, optionalKeywords: optional });
  if (requireConfirmedKeywords) tailored = enforceConfirmation(tailored, form, blockedKeywords);

  // The rewrite is judged against the source's own verdicts, so its score moves only for what it changed.
  const beforeRequirements = typeof before.toObject === 'function' ? before.toObject().requirements : before.requirements;
  const prior = beforeRequirements?.length ? { requirements: beforeRequirements, resumeText: structuredResumeToText(form) } : null;
  let after = await quickScoreResume(tailored.form, job, meta, { prior });
  // A rewrite that scores below the resume it started from lost more by cutting than it gained
  // by rewording. Put the cuts back, keep the rewording, and keep whichever scores higher.
  if (after.score < before.score && tailored.changes.some((c) => c.kind === 'removed')) {
    const restored = withoutCuts(form, tailored.form, tailored.changes);
    const rescored = await quickScoreResume(restored.form, job, meta, { prior });
    if (rescored.score > after.score) {
      after = rescored;
      tailored.form = restored.form;
      tailored.changes = restored.changes;
    }
  }

  // Still short of the mode's target: one small call writes a line for each requirement the
  // score still finds weak or missing (gap.js), and the result stays when it scores
  // higher. Tailoring the whole resume again, measured, moved the score a point or two a roll;
  // this answers what is short by name. A failed call leaves the first attempt standing. The
  // terms the rewrite was offered are what the gap pass may write in too, by the mode's bar; the
  // terms it writes are in the lines it adds, each one listed under "What changed" to put back.
  // The mode's passes at most: each reaches what the one before did not, and the passes stop
  // when nothing goes in, or when the score does not rise more often than the mode tolerates
  // (score first rolls once more after a flat pass; the others stop).
  let flat = 0;
  const warnings = [];
  let gapPassesAttempted = 0;
  for (let pass = 0; after.score < mode.target && pass < mode.gapPasses; pass += 1) {
    try {
      gapPassesAttempted += 1;
      let filled = await fillTailoringGaps(tailored, form, job, {
        scoring: after,
        confirmedKeywords: confirmed,
        evidence,
        assumedKeywords: assumedAll,
        protectedKeywords: [...(job.skills || []), ...(job.preferredSkills || []), ...postingTerms(job.description, keywordList(after.matchedKeywords))],
        style,
        model: request.model,
        meta,
      });
      if (requireConfirmedKeywords) filled = enforceConfirmation(filled, form, blockedKeywords);
      warnings.push(...(filled.warnings || []).filter((warning) => !(tailored.warnings || []).includes(warning)));
      if (!filled.applied) break;
      const rescored = await quickScoreResume(filled.form, job, meta, { prior });
      if (!gapPassProgressed(after, rescored)) {
        flat += 1;
        if (flat > mode.flatPasses) break;
        continue;
      }
      [tailored, after] = [filled, rescored];
    } catch (err) {
      if (isExecutionStopped(err)) throw err;
      warnings.push({ stage: 'gap', code: safeErrorDetails(err).category });
      break; // the attempt so far stands
    }
  }

  const finalWarnings = [...new Set([...(tailored.warnings || []), ...warnings])];
  const text = structuredResumeToText(tailored.form);
  const unconfirmed = uniqueKeywords([...candidates, ...assumedAll]).filter((term) => !hasKeyword(originalText, term) && !confirmed.some((k) => sameKeyword(k, term)) && hasKeyword(text, term));
  return {
    before, after, tailored, style, confirmed, candidates, assumed, assumedAll, split,
    completion: { status: finalWarnings.length ? 'partial' : 'complete', warnings: finalWarnings, gapPassesAttempted, targetReached: after.score >= mode.target },
    review: { required: unconfirmed.length > 0 || Boolean(tailored.estimates?.length), unconfirmedKeywords: unconfirmed, estimates: tailored.estimates || [] },
  };
}
