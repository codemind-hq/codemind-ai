import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTailoring } from './pipeline.js';
import { enforceConfirmation } from './confirmation.js';
import { installFakeLlm } from '../testing/fakeLlm.js';
import { structuredResumeToText } from '../resume/structuredResume.js';

const form = { name: 'Jane', summary: 'Built Python services.', skills: ['Python'], experience: [{ company: 'Acme', title: 'Engineer', period: '2020–2024', achievements: ['Built Python services for billing customers.'] }] };
const job = { title: 'Engineer', description: 'Build Python services on Kubernetes.', skills: ['Python', 'Kubernetes'] };
const scoring = { score: 50, requirements: [], topMissingKeywords: ['Kubernetes'] };
const draft = {
  ...form, skills: ['Python', 'Kubernetes'],
  experience: [{ ...form.experience[0], achievements: [{ text: 'Built Python services for billing customers on Kubernetes.', from: 0, estimate: '' }] }],
};
const input = { form, originalText: structuredResumeToText(form), job, scoring, style: 'ats', model: 'gpt-4o-mini' };

function scripted({ gapError = false, repairError = false, repairAbort } = {}) {
  return installFakeLlm((request) => {
    switch (request.response_format?.json_schema?.name) {
      case 'tailored_resume': return { resume: repairError || repairAbort ? { ...draft, summary: 'Built Python services for billing customers.' } : draft, jobKeywords: ['Python', 'Kubernetes'], suggestions: [], headline: { role: 'Engineer', specialties: [] } };
      case 'tailor_repair':
        if (repairError) return Object.assign(new Error('private repair failure'), { status: 400 });
        repairAbort?.abort();
        return { lines: [] };
      case 'ats_score': return { verdicts: [{ id: 0, verdict: 'missing', quote: '' }], matchedKeywords: ['Python'], topMissingKeywords: [], tailoringOpportunities: [] };
      case 'tailor_gaps':
        if (gapError) return Object.assign(new Error('private provider details'), { status: 400 });
        return { lines: [] };
      default: throw new Error('Unexpected scripted request');
    }
  });
}

test('confirmation guard restores every affected section and clears stale experience changes', () => {
  const result = enforceConfirmation({
    form: { ...draft, summary: 'Operated Kubernetes.', projects: [{ name: 'Kubernetes' }] },
    changes: [{ kind: 'rewritten' }], estimates: [{ clause: '~20%' }], applied: 1,
  }, form, ['Kubernetes']);
  assert.deepEqual(result.form.experience, form.experience);
  assert.equal(result.form.summary, form.summary);
  assert.deepEqual(result.form.projects, []);
  assert.deepEqual(result.form.skills, form.skills);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.estimates, []);
  assert.equal(result.applied, 0);
});

test('confirmation-only workflow blocks known unconfirmed job terms after model generation', async () => {
  const fake = scripted();
  try {
    const result = await runTailoring({ ...input, requireConfirmedKeywords: true });
    assert.ok(!structuredResumeToText(result.tailored.form).includes('Kubernetes'));
    assert.deepEqual(result.assumedAll, []);
    assert.equal(result.review.required, false);
    assert.equal(result.completion.status, 'partial', 'restored sections are disclosed');
    assert.ok(result.completion.warnings.some((warning) => warning.code === 'unconfirmed_keywords_removed'));
  } finally { fake.restore(); }
});

test('explicitly confirmed terms are allowed and normal completion is reported', async () => {
  const fake = scripted();
  try {
    const result = await runTailoring({ ...input, requireConfirmedKeywords: true, confirmedKeywords: ['Kubernetes'] });
    assert.ok(structuredResumeToText(result.tailored.form).includes('Kubernetes'));
    assert.equal(result.review.required, false);
    assert.equal(result.completion.status, 'complete');
    assert.equal(result.after.score, 100);
  } finally { fake.restore(); }
});

test('existing ATS behavior stays available but unconfirmed additions require review', async () => {
  const fake = scripted();
  try {
    const result = await runTailoring(input);
    assert.deepEqual(result.review.unconfirmedKeywords, ['Kubernetes']);
    assert.equal(result.review.required, true);
  } finally { fake.restore(); }
});

test('failed gap calls retain the last valid resume and disclose partial completion', async () => {
  const fake = scripted({ gapError: true });
  try {
    // A requirement keeps a gap open even though the keyword score alone would be 100.
    const requirements = [{ text: 'Own production APIs', kind: 'responsibility', priority: 'required' }];
    const result = await runTailoring({ ...input, job: { ...job, requirements } });
    assert.ok(result.tailored.form.experience.length);
    assert.equal(result.completion.status, 'partial');
    assert.ok(result.completion.warnings.some((warning) => warning.stage === 'gap'));
    assert.ok(!JSON.stringify(result.completion).includes('private provider details'));
  } finally { fake.restore(); }
});

test('invalid budgets and cancelled workflows do not call any model', async () => {
  const fake = scripted();
  try {
    await assert.rejects(runTailoring({ ...input, timeoutMs: 0 }), (err) => err.code === 'bad_request');
    await assert.rejects(runTailoring({ ...input, meta: { signal: AbortSignal.abort() } }), (err) => err.code === 'ai_cancelled');
    assert.equal(fake.calls.length, 0);
  } finally { fake.restore(); }
});

test('repair failures are disclosed while preserving the accepted rewrite', async () => {
  const fake = scripted({ repairError: true });
  try {
    const result = await runTailoring(input);
    assert.equal(result.completion.status, 'partial');
    assert.ok(result.completion.warnings.some((warning) => warning.stage === 'repair'));
    assert.ok(!JSON.stringify(result.completion).includes('private repair failure'));
    assert.ok(result.tailored.form.experience.length);
  } finally { fake.restore(); }
});

test('cancellation during repair propagates instead of returning a partial success', async () => {
  const controller = new AbortController();
  const fake = scripted({ repairAbort: controller });
  try {
    await assert.rejects(runTailoring({ ...input, meta: { signal: controller.signal } }), (err) => err.code === 'ai_cancelled');
    assert.equal(fake.calls.filter(({ request }) => request.response_format?.json_schema?.name === 'tailor_repair').length, 1);
    assert.equal(fake.calls.filter(({ request }) => request.response_format?.json_schema?.name === 'ats_score').length, 0);
  } finally { fake.restore(); }
});

test('cancellation is not swallowed by optional repair, fallback or gap recovery', async () => {
  const controller = new AbortController();
  const fake = installFakeLlm((request) => {
    if (request.response_format?.json_schema?.name === 'tailored_resume') {
      controller.abort();
      return { resume: draft, jobKeywords: [], suggestions: [] };
    }
    throw new Error('Cancellation should stop further requests');
  });
  try {
    await assert.rejects(runTailoring({ ...input, meta: { signal: controller.signal } }), (err) => err.code === 'ai_cancelled');
    assert.equal(fake.calls.length, 1);
  } finally { fake.restore(); }
});
