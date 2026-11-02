import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAttempt, enrichJob, failedChecksOf, resultFrom, settledAsOther, validateAnswer } from './enrichJob.js';
import { ENRICHMENT_RESPONSE_FORMAT, ENRICHMENT_RESPONSE_FORMAT_WITHOUT_SALARY, responseFormatWithout } from './schema.js';

// A senior posting is not asked for the internship group; an intern's is (enrichJob.js unaskedGroups).
const PLAIN_FORMAT = responseFormatWithout(['internship']);
import { PROMPT_VERSION, buildPostingText, buildUserPrompt } from './prompt.js';

const JOB = {
  _id: 'job-1',
  title: 'Senior Backend Engineer',
  company: 'Acme',
  location: 'Remote - US',
  description: 'This is a fully remote role. Pay: $150,000 - $190,000 a year. You will build APIs in Go.',
};

const PLAN = [
  { model: 'nano', reasoningEffort: 'minimal', withFeedback: false },
  { model: 'nano', reasoningEffort: 'minimal', withFeedback: true },
  { model: 'mini', reasoningEffort: 'low', withFeedback: true },
];

function good(overrides = {}) {
  return {
    category: { primary: 'backend', subcategory: 'api_services' },
    workplace: { type: 'remote', evidence: 'fully remote role' },
    location: { locations: [], remoteEligibleCountries: ['United States'], mustResideIn: null, timezone: null, mustResideInEvidence: null },
    salary: { min: 150000, max: 190000, currency: 'USD', period: 'year', evidence: '$150,000 - $190,000 a year' },
    role: { seniority: 'senior', yearsExperienceMin: null, employmentType: null },
    skills: { required: ['Go'], preferred: [] },
    conditions: {
      visaSponsorship: 'unknown',
      securityClearance: null,
      travelPercent: null,
      relocationAssistance: 'unknown',
      degree: null,
      languages: [],
      onsiteInterview: 'unknown',
      onsiteInterviewEvidence: null,
    },
    company: { fundingStage: null, calledStartup: false, employeeCount: null, evidence: null },
    ...overrides,
  };
}

const BAD_SALARY = { salary: { min: 150000, max: 999999, currency: 'USD', period: 'year', evidence: '$150,000 - $190,000 a year' } };
const BAD_WORKPLACE = { workplace: { type: 'remote', evidence: 'remote-first culture' } };
const BAD_CATEGORY = { category: { primary: 'sales', subcategory: null } };

// Stand-in for provider.complete: answers in order (objects are sent as JSON), records every call.
function fakeModel(...answers) {
  const calls = [];
  const call = async (request, meta) => {
    calls.push({ request, meta });
    const next = answers[calls.length - 1];
    return { text: typeof next === 'string' ? next : JSON.stringify(next), usage: { costUsd: 0.001 } };
  };
  return { call, calls };
}

test('a valid first answer is used as is: one call to the main model', async () => {
  const { call, calls } = fakeModel(good());
  const result = await enrichJob(JOB, { call, attempts: PLAN });

  assert.equal(result.status, 'done');
  assert.deepEqual(result.blankedFields, []);
  assert.equal(result.data.salary.min, 150000);
  assert.deepEqual(result.data.category, { primary: 'backend', subcategory: 'api_services', isSoftwareRole: true });
  assert.equal(result.costUsd, 0.001);
  assert.equal(result.promptVersion, PROMPT_VERSION);
  assert.deepEqual(result.attempts, [{ model: 'nano', ok: true, errors: [], codes: [] }]);

  const [{ request, meta }] = calls;
  assert.equal(request.model, 'nano');
  assert.equal(request.reasoningEffort, 'minimal');
  assert.equal(request.responseFormat, PLAIN_FORMAT);
  assert.equal('internship' in PLAIN_FORMAT.json_schema.schema.properties, false);
  assert.equal(request.allowEmpty, true);
  assert.equal(request.user, buildUserPrompt(buildPostingText(JOB)), 'the posting, fenced as data');
  assert.deepEqual(meta, { kind: 'job_enrich', promptVersion: PROMPT_VERSION, attempt: 1, ref: 'job-1' });
});

test('a job whose salary is settled is not asked for one, and its answer is complete without it', async () => {
  const settled = { ...JOB, salaryMin: 150000, salaryMax: 190000, fieldSources: { salary: 'description' } };
  const { salary: _salary, ...withoutSalary } = good();
  const { call, calls } = fakeModel(withoutSalary);
  const result = await enrichJob(settled, { call, attempts: PLAN });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.responseFormat, responseFormatWithout(['salary', 'internship']));
  assert.equal('salary' in ENRICHMENT_RESPONSE_FORMAT_WITHOUT_SALARY.json_schema.schema.properties, false);
  assert.equal(ENRICHMENT_RESPONSE_FORMAT_WITHOUT_SALARY.json_schema.schema.required.includes('salary'), false);
  assert.equal(result.status, 'done');
  assert.deepEqual(result.blankedFields, []);
  assert.equal(result.data.salary.min, null);
  // An answer collected under the full format (a batch sent before the salary was settled) stands too,
  // its salary unread.
  assert.equal(validateAnswer(settled, JSON.stringify(good(BAD_SALARY))).ok, true);
  // A salary the model may still replace is asked for.
  const { call: aiCall, calls: aiCalls } = fakeModel(good());
  await enrichJob({ ...settled, fieldSources: { salary: 'ai' } }, { call: aiCall, attempts: PLAN });
  assert.equal(aiCalls[0].request.responseFormat, PLAIN_FORMAT);
  // An intern posting is asked for its terms, with the whole schema.
  const { call: internCall, calls: internCalls } = fakeModel(good());
  await enrichJob({ ...JOB, title: 'Software Engineer Intern (Summer 2027)', seniority: 'intern' }, { call: internCall, attempts: PLAN });
  assert.equal(internCalls[0].request.responseFormat, ENRICHMENT_RESPONSE_FORMAT);
  assert.equal(internCalls[0].request.responseFormat.json_schema.schema.required.includes('internship'), true);
});

test('a failed answer is retried with the main model, told which checks failed', async () => {
  const { call, calls } = fakeModel(good(BAD_SALARY), good());
  const result = await enrichJob(JOB, { call, attempts: PLAN });

  assert.equal(result.status, 'done');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].request.model, 'nano');
  assert.equal(calls[1].meta.attempt, 2);
  assert.match(calls[1].request.user, /FAILED THESE CHECKS/);
  assert.match(calls[1].request.user, /- salary\.max 999999 does not appear in salary\.evidence/);
  assert.equal(result.attempts[0].ok, false);
  assert.ok(result.attempts[0].codes.includes('salary.amount_not_in_quote'));
});

test('after two failures the fallback model gets one try', async () => {
  const { call, calls } = fakeModel(good(BAD_SALARY), 'not json', good());
  const result = await enrichJob(JOB, { call, attempts: PLAN });

  assert.equal(result.status, 'done');
  assert.deepEqual(calls.map((c) => [c.request.model, c.request.reasoningEffort]), [
    ['nano', 'minimal'],
    ['nano', 'minimal'],
    ['mini', 'low'],
  ]);
  assert.deepEqual(result.attempts[1].errors, ['the answer was not a valid JSON object']);
});

test('when no answer passes, failing groups are blanked and the job stays usable', async () => {
  const { call } = fakeModel(good(BAD_SALARY), good(BAD_SALARY), good(BAD_SALARY));
  const result = await enrichJob(JOB, { call, attempts: PLAN });

  assert.equal(result.status, 'partial');
  assert.deepEqual(result.blankedFields, ['salary']);
  assert.equal(result.data.salary, null);
  assert.equal(result.data.category.primary, 'backend');
  assert.ok(Math.abs(result.costUsd - 0.003) < 1e-12);
});

test('each group comes from the latest answer where it passed', async () => {
  const { call } = fakeModel(
    good(BAD_SALARY), // workplace passes here only
    good({ ...BAD_WORKPLACE, skills: { required: ['Go', 'Kubernetes'], preferred: [] } }),
    '' // an empty answer fails every group
  );
  const result = await enrichJob(JOB, { call, attempts: PLAN });

  assert.equal(result.status, 'done'); // every group passed in some answer
  assert.equal(result.data.workplace.evidence, 'fully remote role');
  assert.equal(result.data.salary.max, 190000);
  assert.deepEqual(result.data.skills.required, ['Go', 'Kubernetes']);
});

test('a job whose category or work type never passes is failed (hidden)', async () => {
  const { call } = fakeModel(good(BAD_CATEGORY), good(BAD_CATEGORY), good({ ...BAD_CATEGORY, ...BAD_SALARY }));
  const result = await enrichJob(JOB, { call, attempts: PLAN });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.blankedFields, ['category']); // salary passed in the first two answers
});

const OTHER = { category: { primary: 'other', subcategory: null } };

test('an answer that files the job as other is not retried, though other checks failed', async () => {
  const { call, calls } = fakeModel(good({ ...OTHER, ...BAD_SALARY }), good());
  const result = await enrichJob(JOB, { call, attempts: PLAN });

  assert.equal(calls.length, 1);
  assert.equal(result.status, 'partial');
  assert.equal(result.data.category.primary, 'other');
  assert.deepEqual(result.blankedFields, ['salary']);
});

test('other with a work type that failed is partial, not failed: the category is still saved', async () => {
  const { call, calls } = fakeModel(good({ ...OTHER, ...BAD_WORKPLACE }));
  const result = await enrichJob(JOB, { call, attempts: PLAN });

  assert.equal(calls.length, 1);
  assert.equal(result.status, 'partial');
  assert.equal(result.data.category.primary, 'other');
  assert.equal(result.data.workplace, null);
});

test('a batch answer settled as other merges without another call', () => {
  const answer = validateAnswer(JOB, JSON.stringify(good({ ...OTHER, ...BAD_WORKPLACE })));
  assert.equal(settledAsOther(answer), true);
  assert.equal(settledAsOther(validateAnswer(JOB, JSON.stringify(good(BAD_WORKPLACE)))), false);
  assert.equal(settledAsOther(validateAnswer(JOB, JSON.stringify(good(OTHER)))), false); // passed: nothing to settle
  const result = resultFrom([answer], [describeAttempt('nano', answer)], 0.0002);
  assert.equal(result.status, 'partial');
  assert.equal(result.data.category.primary, 'other');
});

test('network and API errors are not attempts: they are thrown', async () => {
  let calls = 0;
  const call = async () => {
    calls += 1;
    throw new Error('The AI provider did not respond. Try again.');
  };
  await assert.rejects(enrichJob(JOB, { call, attempts: PLAN }), /did not respond/);
  assert.equal(calls, 1);
});

test('a Batch API answer stands in for the first attempt; retries continue with direct calls', async () => {
  const { call, calls } = fakeModel(good());
  const retried = await enrichJob(JOB, {
    call,
    attempts: PLAN,
    firstAnswer: { text: JSON.stringify(good(BAD_SALARY)), usage: { costUsd: 0.0002 } },
  });
  assert.equal(retried.status, 'done');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].meta.attempt, 2);
  assert.match(calls[0].request.user, /FAILED THESE CHECKS/);
  assert.ok(Math.abs(retried.costUsd - 0.0012) < 1e-12);

  const { call: unused, calls: none } = fakeModel();
  const valid = await enrichJob(JOB, { call: unused, attempts: PLAN, firstAnswer: { text: JSON.stringify(good()), usage: { costUsd: 0.0002 } } });
  assert.equal(valid.status, 'done');
  assert.equal(none.length, 0);
});

test('answers collected in separate batches merge without another call', () => {
  const first = validateAnswer(JOB, JSON.stringify(good(BAD_SALARY)));
  const second = validateAnswer(JOB, JSON.stringify(good(BAD_WORKPLACE)));
  const merged = resultFrom(
    [first, second],
    [describeAttempt('nano', first), describeAttempt('nano', second)],
    0.0004
  );

  // Each group comes from the answer where it passed, even though they arrived in different cycles.
  assert.equal(merged.status, 'done');
  assert.equal(merged.data.salary.min, 150000);
  assert.equal(merged.data.workplace.type, 'remote');
  assert.equal(merged.costUsd, 0.0004);
  assert.deepEqual(merged.attempts.map((a) => a.ok), [false, false]);
});

test('the fallback resumes a batched retry: numbered 3, told the checks, keeping what passed', async () => {
  const batched = validateAnswer(JOB, JSON.stringify(good(BAD_SALARY)));
  const { call, calls } = fakeModel(good());
  const result = await enrichJob(JOB, {
    call,
    attempts: [PLAN[2]],
    priorResults: [batched],
    priorAttempts: [describeAttempt('nano', batched)],
    attemptOffset: 2,
    failedChecks: failedChecksOf(batched),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.model, 'mini');
  assert.equal(calls[0].meta.attempt, 3, 'usage is attributed to attempt 3, not 1');
  assert.match(calls[0].request.user, /FAILED THESE CHECKS/);
  assert.equal(result.status, 'done');
  assert.deepEqual(result.attempts.map((a) => a.model), ['nano', 'mini']);
});

test('a resumed attempt that also fails still merges the earlier answer', async () => {
  const batched = validateAnswer(JOB, JSON.stringify(good(BAD_WORKPLACE)));
  const { call } = fakeModel(good(BAD_SALARY));
  const result = await enrichJob(JOB, {
    call,
    attempts: [PLAN[2]],
    priorResults: [batched],
    priorAttempts: [describeAttempt('nano', batched)],
    attemptOffset: 2,
    failedChecks: failedChecksOf(batched),
  });

  assert.equal(result.status, 'done');
  assert.equal(result.data.salary.min, 150000, 'salary comes from the batched answer');
  assert.equal(result.data.workplace.type, 'remote', 'work type comes from the fallback answer');
});

test('flex mode sends every attempt on the flex tier; otherwise no tier is named', async () => {
  const flex = fakeModel('not json', good());
  await enrichJob(JOB, { call: flex.call, attempts: PLAN, serviceTier: 'flex' });
  assert.deepEqual(flex.calls.map((c) => c.request.serviceTier), ['flex', 'flex']);

  const plain = fakeModel(good());
  await enrichJob(JOB, { call: plain.call, attempts: PLAN });
  assert.equal(plain.calls[0].request.serviceTier, undefined);
});
