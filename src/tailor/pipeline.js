import { quickScoreResume } from '../ats/service.js';
import { hasKeyword, keywordList, sameKeyword, uniqueKeywords } from '../text/keywords.js';
import { structuredResumeToText } from '../resume/structuredResume.js';
import { fillTailoringGaps, repairGapLines, tailorResumeForm } from './service.js';
import { markAnswered } from './requirements.js';
import { oneNamePerStack, sameStack, unbackedStackTerms } from './stack.js';
import { withListedSkills } from './skills.js';
import { canonicalSkill } from '../text/dict/skills.js';
import { skillTerm } from './terms.js';
import { withinPageBudget } from './pages.js';
import { GENERATE_STYLE, postingTerms, splitAssumedTerms, tailorMode, tailorStyle, withoutCuts } from './index.js';

// The whole tailoring of one resume for one job, as the calls run it: the source scored (unless
// a score is handed in), the rewrite, the rewrite scored against the source's own verdicts, the
// cuts put back when they cost more than the rewording gained, then the mode's gap passes until
// the score reaches its target. What it returns is for the caller to store; nothing is saved here.

// The scorer moves 5-8 points on the same resume from one run to the next (17 prod pairs
// re-run, 2026-10-06), so a gap pass that fixed two verdicts was thrown away when its score
// landed a point lower. A pass is kept when the score rose, or when more requirements and
// skills are met and the score fell no further than the noise.
//
// `scoreRounds` is how often the scorer runs inside the loop. 'each' (the original) scores after
// every gap pass and keeps or drops the pass by that score: four scores for three passes. 'ends'
// scores the rewrite and the finished resume only: the passes run on the rewrite's verdicts,
// each marking the gaps it answered met for the next (requirements.js markAnswered), and the
// finished resume is kept over the rewrite by the same progress rule, once. Two scores instead
// of four, at the cost of the per-pass gate, which the scorer's own noise makes a weak one.
const SCORE_NOISE = 3;
export const SCORE_ROUNDS = ['each', 'ends'];
// 'ends' passes: a gap whose lines were refused this often is not asked again.
const MAX_GAP_TRIES = 2;
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
 * first, because the scorer's findings steer the rewrite (not for the generate style, whose
 * `before` is then null). `confirmedKeywords` (missing keywords the
 * user says they have; null when not asked) limits added keywords to those, and `evidence` is what
 * they said about them ([{ keyword, role, note }]). `assumedKeywords` are missing keywords they
 * neither confirmed nor declined, `declinedKeywords` the ones they switched off. `style` is how far
 * the rewrite goes (style.js); `instructions` the user's own notes; `model` the tailoring model.
 * Returns { before, after, tailored, style, confirmed, candidates, assumed, assumedAll, split }.
 *
 * @param {{ form: import('../types.js').ResumeForm, originalText: string, job: import('../types.js').Job, scoring?: import('../types.js').Scoring | null, confirmedKeywords?: string[] | null, assumedKeywords?: string[], declinedKeywords?: string[], evidence?: object[], style?: import('../types.js').TailorStyle, instructions?: string, model: string, meta?: import('../types.js').CallMeta }} input
 * @returns {Promise<{ before: import('../types.js').Scoring, after: import('../types.js').Scoring, tailored: object, style: import('../types.js').TailorStyle, confirmed: string[], candidates: string[], assumed: string[], assumedAll: string[], split: object }>}
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
  // 'flex' for a tailoring nobody is waiting on (Smart Apply): every call rides OpenAI's half-price tier.
  serviceTier,
  scoreRounds = 'each',
  // A generated resume (prompt.js REFOCUS_SECTION): the rewrite leads with the work that transfers.
  refocus = false,
}) {
  style = tailorStyle(style);
  // A new resume for the job is written from the job, not steered by the old one's verdicts:
  // nothing scores the source first (`before` is null unless the caller had a score).
  const before = scoring || (style === GENERATE_STYLE ? null : await quickScoreResume(form, job, meta, { serviceTier }));

  // Every keyword the rewrite could be tempted to add. Asked and not confirmed means blocked.
  const confirmed = confirmedKeywords || [];
  const candidates = [...(job.skills || []), ...(job.preferredSkills || []), ...keywordList(before?.missingKeywords || before?.topMissingKeywords)];
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
  const offeredSplit = splitAssumedTerms(missing, { job, scoring: before, max: mode.maxAssumedTerms });
  // A language, cloud or container platform the resume never shows is not the rewrite's to write
  // in, in any mode (stack.js): it is asked instead ("do you have these?"), and kept out.
  const unbackedStack = unbackedStackTerms([...offeredSplit.assumed, ...offeredSplit.optional], originalText, confirmed);
  const backed = (k) => !unbackedStack.some((s) => sameKeyword(s, k));
  const split = {
    assumed: offeredSplit.assumed.filter(backed),
    optional: offeredSplit.optional.filter(backed),
    leftOut: uniqueKeywords([...offeredSplit.leftOut, ...unbackedStack]),
  };
  // Score first: every skill among the missing keywords the user left on (the chips, sent as
  // `assumedKeywords`) must be in — NestJS, unit testing — past the cap and whether or not the
  // rewrite finds a line for it; one it leaves out is listed under skills after the rewrite. Not
  // a condition of the job ("background check"), and not a stack the resume never shows
  // (asked instead, as above). Each is listed after tailoring for the user to keep or remove.
  const chipSkills = mode.forceAssumed
    ? uniqueKeywords(assumedKeywords).filter((k) => skillTerm(k) && !hasKeyword(originalText, k) && !declined(k) && !confirmed.some((c) => sameKeyword(c, k)))
    : [];
  const chipStack = unbackedStackTerms(chipSkills, originalText, confirmed);
  const mustInclude = chipSkills.filter((k) => !chipStack.some((s) => sameKeyword(s, k)));
  // A language, cloud or platform the job asks for and the resume never shows (Go, Rust, GCP) is
  // still a skill the job requires: score first lists every one under skills — chip or not, past
  // the cap or not, unless switched off — one name a family ("Go", not "Go" and "Golang"), and
  // keeps it out of the bullets, where it would claim work on that stack. It is listed after
  // tailoring for the user to keep or remove, like any assumed term.
  const listedStack = mode.forceAssumed ? oneNamePerStack([...chipStack, ...unbackedStackTerms(missing, originalText, confirmed)]) : [];
  const listed = (k) => listedStack.some((s) => sameStack(s, k));
  // Score first forces the nice-to-haves in as well, after the required terms and within the
  // same cap: the job's preferred skills are a tenth of the score (ats/breakdown.js), and a
  // resume that names none of them tops out around 85 whatever else it says.
  const capped = uniqueKeywords([...split.assumed, ...split.optional]).filter((k) => !mustInclude.some((m) => sameKeyword(m, k)));
  const forced = mode.forceAssumed ? [...mustInclude, ...capped.slice(0, Math.max(0, mode.maxAssumedTerms - mustInclude.length))] : split.assumed;
  const assumed = forced;
  const optional = split.optional.filter((k) => !forced.some((f) => sameKeyword(f, k)));
  const assumedAll = [...assumed, ...optional];
  const allowed = [...confirmed, ...assumedAll];
  const blockedKeywords = uniqueKeywords([
    ...(Array.isArray(confirmedKeywords) ? candidates.filter((k) => !hasKeyword(originalText, k) && !allowed.some((c) => sameKeyword(c, k))) : []),
    ...unbackedStack,
    ...chipStack,
  ]);
  split.leftOut = uniqueKeywords([...split.leftOut, ...chipStack]).filter((k) => !listed(k));

  const request = { confirmedKeywords, blockedKeywords, evidence, style, instructions, model, meta, serviceTier };
  let tailored = await tailorResumeForm(form, job, { ...request, refocus, scoring: before, assumedKeywords: assumed, optionalKeywords: optional });
  // A must-include skill the rewrite (or its skill checks) left out goes in the skills list, before
  // anything is scored, and so does a stack chip the resume never shows (listedStack). Only a
  // skill by name — the dictionary knows it, or the job lists it as one: onX's "Hunt", "Fish" and
  // "outdoor navigation" are its products, and went under Other as skills.
  const skillByName = (k) => Boolean(canonicalSkill(k)) || (job.skills || []).some((s) => sameKeyword(s, k));
  const listedSkills = oneNamePerStack([...mustInclude, ...listedStack]).filter(skillByName);
  if (listedSkills.length) tailored = { ...tailored, form: withListedSkills(tailored.form, listedSkills, structuredResumeToText(tailored.form)) };

  // The rewrite is judged against the source's own verdicts, so its score moves only for what it changed.
  const beforeRequirements = typeof before?.toObject === 'function' ? before.toObject().requirements : before?.requirements;
  const prior = beforeRequirements?.length ? { requirements: beforeRequirements, resumeText: structuredResumeToText(form) } : null;
  let after = await quickScoreResume(tailored.form, job, meta, { prior, serviceTier });
  // A new resume for the job is the model's answer and its repair round (service.js): scored, and
  // nothing after this changes it — no cuts put back, no gap passes, no page budget.
  if (style === GENERATE_STYLE) return { before, after, tailored, style, confirmed, candidates, assumed, assumedAll: [...assumedAll, ...listedStack], split };
  // A rewrite that scores below the resume it started from lost more by cutting than it gained
  // by rewording. Put the cuts back, keep the rewording, and keep whichever scores higher.
  if (after.score < before.score && tailored.changes.some((c) => c.kind === 'removed')) {
    const restored = withoutCuts(form, tailored.form, tailored.changes);
    const rescored = await quickScoreResume(restored.form, job, meta, { prior, serviceTier });
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
  // The finished resume within two pages (pages.js): what the job asks for decides what stays.
  // Only bullets that name the fewest job terms go, so the last score stands for it.
  const toPageBudget = (done) => {
    const budget = withinPageBudget(done, {
      protectedKeywords: [...(job.skills || []), ...(job.preferredSkills || []), ...postingTerms(job.description, keywordList(after.matchedKeywords))],
      requirements: job.requirements || [],
    });
    return budget.cut ? { ...done, form: budget.form, changes: budget.changes, estimates: budget.estimates } : done;
  };
  const gapOptions = (scoring) => ({
    scoring,
    confirmedKeywords: confirmed,
    evidence,
    assumedKeywords: assumedAll,
    protectedKeywords: [...(job.skills || []), ...(job.preferredSkills || []), ...postingTerms(job.description, keywordList(scoring.matchedKeywords))],
    style,
    model: request.model,
    meta,
    serviceTier,
  });

  if (scoreRounds === 'ends') {
    // The passes run on the rewrite's verdicts, each taking the gaps the one before answered
    // off the list; nothing is scored until the passes are done, and the finished resume stands
    // or the rewrite does, by one score.
    //
    // The gap stage runs `gapAttempts` times from the same rewrite (style.js), at once, and the
    // best finished resume stands: the model writes very different lines from one run to the next
    // (a Staff AI Engineer resume finished at 62, 68 and 76 in three runs of the same code), so
    // the better of two takes the low runs out for one more stage and one more score.
    const gapStage = async (start) => {
      let current = start;
      let verdicts = after;
      let applied = 0;
      // How often each gap was answered with a line the checks refused. A Staff AI Engineer
      // tailoring asked four passes for the same 13-20 lines and kept one or two a pass: a gap
      // refused MAX_GAP_TRIES times is not asked again. (Stopping after a pass that landed one line
      // was tried and cut the second pass every time, costing duty verdicts.)
      const refused = new Map();
      // Lines refused for repeating the posting are reworded by one repair call after the last
      // pass, not one per pass (each found a handful): the gaps the passes answered since are left out.
      const copied = [];
      const answeredAll = new Set();
      for (let pass = 0; pass < mode.gapPasses; pass += 1) {
        try {
          const filled = await fillTailoringGaps(current, form, job, { ...gapOptions(verdicts), repair: false });
          copied.push(...(filled.copied || []));
          if (!filled.applied) break;
          current = filled;
          applied += filled.applied;
          const answered = new Set(filled.answered || []);
          answered.forEach((id) => answeredAll.add(id));
          for (const r of filled.rejected || []) if (Number.isInteger(r.id) && !answered.has(r.id)) refused.set(r.id, (refused.get(r.id) || 0) + 1);
          const spent = [...refused].filter(([, n]) => n >= MAX_GAP_TRIES).map(([id]) => id);
          verdicts = markAnswered(verdicts, [...answered, ...spent], { preferred: mode.preferredGaps });
        } catch {
          break; // the attempt so far stands
        }
      }
      if (copied.length) {
        const { scoring: _scoring, ...options } = gapOptions(verdicts);
        const repaired = await repairGapLines(current, form, job, copied, { ...options, answered: [...answeredAll] });
        if (repaired.applied) {
          current = repaired;
          applied += repaired.applied;
        }
      }
      if (!applied) return null;
      try {
        return { tailored: current, final: await quickScoreResume(current.form, job, meta, { prior, serviceTier }) };
      } catch {
        return null; // this attempt goes without a score; another may stand
      }
    };
    if (after.score < mode.target) {
      const attempts = await Promise.all(Array.from({ length: Math.max(1, mode.gapAttempts || 1) }, () => gapStage(tailored)));
      const best = attempts.filter((a) => a && gapPassProgressed(after, a.final)).sort((a, b) => b.final.score - a.final.score)[0];
      if (best) {
        tailored = best.tailored;
        after = best.final;
      }
    }
    return { before, after, tailored: toPageBudget(tailored), style, confirmed, candidates, assumed, assumedAll: [...assumedAll, ...listedStack], split };
  }

  let flat = 0;
  for (let pass = 0; after.score < mode.target && pass < mode.gapPasses; pass += 1) {
    try {
      const filled = await fillTailoringGaps(tailored, form, job, gapOptions(after));
      if (!filled.applied) break;
      const rescored = await quickScoreResume(filled.form, job, meta, { prior, serviceTier });
      if (!gapPassProgressed(after, rescored)) {
        flat += 1;
        if (flat > mode.flatPasses) break;
        continue;
      }
      [tailored, after] = [filled, rescored];
    } catch {
      break; // the attempt so far stands
    }
  }

  return { before, after, tailored: toPageBudget(tailored), style, confirmed, candidates, assumed, assumedAll: [...assumedAll, ...listedStack], split };
}
