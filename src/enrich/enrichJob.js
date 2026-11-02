import { complete } from '../llm/index.js';
import { models } from '../runtime.js';
import { ENRICH_GROUPS, REQUIRED_GROUPS, responseFormatWithout } from './schema.js';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildPostingText, buildUserPrompt } from './prompt.js';
import { crossGroupErrors, validateEnrichment } from './validate.js';

// Reads one job posting with the model and validates the answer. A failed validation is
// retried with the main model (told which checks failed), then once with the fallback model.
// If no answer passes, each field group comes from the latest answer where it passed; groups
// that never passed stay blank, and the job is only usable when category and work type passed.

// Reasoning tokens count against this, so it is well above the ~1k tokens of an answer.
const MAX_COMPLETION_TOKENS = 8000;

export function enrichmentAttempts(enrich = models().enrich) {
  return [
    { model: enrich.model, reasoningEffort: enrich.effort, withFeedback: false },
    { model: enrich.model, reasoningEffort: enrich.effort, withFeedback: true },
    { model: enrich.fallbackModel, reasoningEffort: enrich.fallbackEffort, withFeedback: true },
  ];
}

// Salaries enrichment never replaces: the source's own, and one the posting's text states outright.
const KEPT_SALARY_SOURCES = new Set(['source', 'description']);

/** Whether a job's salary stays whatever enrichment reads, so the model need not be asked for one. */
export function salaryKept(job) {
  return KEPT_SALARY_SOURCES.has(job.fieldSources?.salary) && (job.salaryMin != null || job.salaryMax != null);
}

/** Whether the posting is for an intern or a new graduate (ingest's title rules), so its terms are worth reading. */
export const isStudentPosting = (job) => job.seniority === 'intern' || job.newGrad === true || /\bintern(?:ship)?s?\b|\bco-?op\b/i.test(String(job.title || ''));

/**
 * The groups a job's request leaves out: its salary, when enrichment would keep the one it has, and
 * the internship terms of any posting that is not for a student.
 */
export function unaskedGroups(job) {
  return [...(salaryKept(job) ? ['salary'] : []), ...(isStudentPosting(job) ? [] : ['internship'])];
}

/** The request for one attempt at one job; also the body of a Batch API line (batch.js). */
export function enrichmentRequest(job, step, failedChecks = []) {
  return {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(buildPostingText(job), step.withFeedback ? failedChecks : []),
    responseFormat: responseFormatWithout(unaskedGroups(job)),
    model: step.model,
    reasoningEffort: step.reasoningEffort,
    // Steadiest answers from models that take a temperature (ignored for GPT-5).
    temperature: 0,
    maxTokens: MAX_COMPLETION_TOKENS,
    allowEmpty: true,
  };
}

function parseAnswer(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Validates one answer on its own. The batch path needs this because its attempts are spread over
 * separate cycles: an answer collected today is validated here, and the ones collected earlier are
 * re-validated from their stored text to rebuild the merge (validation is pure, so this costs
 * nothing).
 */
export function validateAnswer(job, text) {
  return validateEnrichment(parseAnswer(text), { posting: buildPostingText(job), unasked: unaskedGroups(job) });
}

/** The checks an answer failed, as the next attempt's prompt lists them. */
export function failedChecksOf(result) {
  return [...new Set(result.errors.map((e) => e.message))];
}

/** One entry of a result's `attempts`, from an answer that was validated elsewhere. */
export function describeAttempt(model, result) {
  return {
    model,
    ok: result.ok,
    errors: failedChecksOf(result),
    codes: result.errors.map((e) => `${e.group}.${e.code}`),
  };
}

/**
 * True when an answer that failed validation still passed its category as "other": the job is not
 * software, so the checks it failed (skills on a civil engineering posting, a work type without a
 * quote) are not worth another attempt. Such answers were half the retries and most of the fallback
 * spend; the job is saved with what passed instead.
 */
export function settledAsOther(result) {
  return !result.ok && result.value?.category?.primary === 'other';
}

/** The finished result for answers already validated, without making another call. */
export function resultFrom(results, attempts, costUsd) {
  const last = results.at(-1);
  if (last?.ok) {
    return { status: 'done', data: last.value, blankedFields: [], attempts, costUsd, promptVersion: PROMPT_VERSION };
  }
  const merged = mergePassedGroups(results);
  // A job settled as "other" has its category, so a blank work type does not make it failed: failed
  // leaves the title's category standing (apply.js), which would list it as software.
  if (settledAsOther(last) && merged.status === 'failed' && merged.data.category) merged.status = 'partial';
  return { ...merged, attempts, costUsd, promptVersion: PROMPT_VERSION };
}

function mergePassedGroups(results) {
  const value = {};
  for (const group of ENRICH_GROUPS) {
    const passed = results.findLast((result) => result.value[group]);
    if (passed) value[group] = passed.value[group];
  }
  for (const { group } of crossGroupErrors(value)) delete value[group];

  const blankedFields = ENRICH_GROUPS.filter((group) => !value[group]);
  let status = blankedFields.length > 0 ? 'partial' : 'done';
  if (REQUIRED_GROUPS.some((group) => blankedFields.includes(group))) status = 'failed';
  return {
    status,
    data: Object.fromEntries(ENRICH_GROUPS.map((group) => [group, value[group] ?? null])),
    blankedFields,
  };
}

/**
 * enrichJob(job, { call, attempts, meta, firstAnswer }) →
 *   { status: 'done' | 'partial' | 'failed', data, blankedFields, attempts: [{ model, ok, errors, codes }],
 *     costUsd, promptVersion }
 * Network and API errors are not attempts: they are thrown, and the job stays queued.
 *
 * @param {object} job A stored job: title, company, location, description, source…
 * @param {{ call?: Function, attempts?: object[], serviceTier?: string, meta?: object, firstAnswer?: object | null, priorResults?: object[], priorAttempts?: object[], attemptOffset?: number, failedChecks?: string[] }} [options]
 * @returns {Promise<{ status: 'done'|'partial'|'failed', data: object, blankedFields: string[], attempts: object[], costUsd: number, promptVersion: string }>}
 */
export async function enrichJob(
  job,
  {
    call = complete,
    attempts: plan = enrichmentAttempts(),
    // 'flex' sends each call on OpenAI's half-price flex tier (worker.js, JOB_ENRICH_MODE=flex).
    serviceTier,
    meta = {},
    firstAnswer = null,
    // Attempts already made in earlier cycles (the batch path): their validated answers join the
    // merge, their descriptors join `attempts`, and `attemptOffset` keeps usage numbering honest.
    priorResults = [],
    priorAttempts = [],
    attemptOffset = 0,
    failedChecks: priorFailedChecks = [],
  } = {}
) {
  const posting = buildPostingText(job);
  const attempts = [...priorAttempts];
  const results = [...priorResults];
  let failedChecks = priorFailedChecks;
  let costUsd = 0;

  for (const [index, step] of plan.entries()) {
    // A Batch API answer ({ text, usage }) stands in for the first attempt; retries are direct calls.
    const { text, usage } =
      index === 0 && firstAnswer
        ? firstAnswer
        : await call({ ...enrichmentRequest(job, step, failedChecks), serviceTier }, {
            ...meta,
            kind: 'job_enrich',
            promptVersion: PROMPT_VERSION,
            attempt: attemptOffset + index + 1,
            ref: job._id ?? null,
          });
    costUsd += usage?.costUsd || 0;

    const result = validateEnrichment(parseAnswer(text), { posting, unasked: unaskedGroups(job) });
    failedChecks = failedChecksOf(result);
    attempts.push(describeAttempt(step.model, result));
    results.push(result);
    if (result.ok || settledAsOther(result)) return resultFrom(results, attempts, costUsd);
  }

  return resultFrom(results, attempts, costUsd);
}
