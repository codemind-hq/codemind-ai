import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGeneratePrompt, GENERATE_SYSTEM_PROMPT } from './generate.js';

const FORM = {
  name: 'Private Candidate',
  email: 'private@example.com',
  experience: [{
    company: 'Workshop',
    title: 'Fabrication Engineer',
    period: '2020 - Present',
    description: 'Prepared bespoke curved panels and machining drawings.',
    achievements: ['Programmed CNC fixture setups in Mastercam.'],
  }],
};

const JOB = {
  title: 'Millwork Production Engineer',
  description: 'Create CNC programs in Mastercam and fabrication models in Rhino 3D.',
  requirements: [{
    text: 'Develop complete mill handoff packages',
    priority: 'required',
    internalNote: 'Private scoring metadata',
  }],
};

test('job-specific drafting uses the posting and original work without conflicting factual-only instructions', () => {
  const { system, user } = buildGeneratePrompt({ form: FORM, job: JOB });
  assert.match(system, /unverified draft wording/);
  assert.match(user, /MODE: JOB_REQUIREMENT_EXPERIENCE_DRAFT/);
  assert.match(user, /resume\.experience\[\]\.achievements/);
  assert.match(user, /not verified work history/);
  assert.match(user, /Keep the supplied companies, periods, role order/);
  assert.match(user, /CANDIDATE_WORK_EXPERIENCE:\n/);
  assert.ok(user.includes(FORM.experience[0].description));
  assert.ok(user.includes(FORM.experience[0].achievements[0]));
  assert.ok(user.includes(JOB.requirements[0].text));
  assert.doesNotMatch(user, /Candidate facts alone support employment claims/);
  for (const privateValue of [FORM.name, FORM.email, JOB.requirements[0].internalNote]) {
    assert.ok(!user.includes(privateValue), privateValue);
  }
});

test('factual-only generation can opt out of job-derived duties without losing work details', () => {
  const { system, user } = buildGeneratePrompt({ form: FORM, job: JOB, jobRequirementDraftMode: false });
  assert.equal(system, GENERATE_SYSTEM_PROMPT);
  assert.match(user, /Candidate facts alone support employment claims/);
  assert.doesNotMatch(user, /MODE: JOB_REQUIREMENT_EXPERIENCE_DRAFT/);
  assert.ok(user.includes(FORM.experience[0].description));
});

test('work descriptions support nested profiles and employment aliases with the same precedence as the company digest', () => {
  const nested = buildGeneratePrompt({ candidateProfile: { resume: FORM }, job: JOB }).user;
  assert.ok(nested.includes(FORM.experience[0].description));
  const aliased = buildGeneratePrompt({
    candidateProfile: {
      resume: FORM,
      employment: [{ employer: 'Current Workshop', jobTitle: 'Machinist', workNotes: 'Prepared custom curved laminations.' }],
    },
    job: JOB,
  }).user;
  assert.match(aliased, /Current Workshop/);
  assert.match(aliased, /Prepared custom curved laminations/);
  assert.ok(!aliased.includes(FORM.experience[0].description));
});
