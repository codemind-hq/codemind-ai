import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gapPassProgressed } from './pipeline.js';
import { markAnswered, openRequirements } from './requirements.js';

test('a gap answered by one unscored round is met for the next, by the number the round was asked it under', () => {
  const scoring = {
    score: 70,
    requirements: [
      { text: 'Built APIs', verdict: 'met' },
      { text: 'Ran Kubernetes clusters in production', verdict: 'missing' },
      { text: 'Led a team', verdict: 'weak', quote: 'Led' },
    ],
    requiredSkillVerdicts: [{ skill: 'Terraform', verdict: 'missing' }, { skill: 'Go', verdict: 'weak' }],
    preferredSkillVerdicts: [{ skill: 'Rust', verdict: 'missing' }],
  };
  const open = openRequirements(scoring, { preferred: true });
  assert.deepEqual(open.map((o) => o.id), [1, 2, 3, 4, 5], 'requirements, then required skills, then nice-to-haves');
  // The round wrote lines for the clusters (1), Terraform (3) and Rust (5).
  const next = markAnswered(scoring, [1, 3, 5], { preferred: true });
  assert.deepEqual(openRequirements(next, { preferred: true }).map((o) => o.id), [2, 4]);
  assert.equal(next.score, 70, 'the score is the scorer\'s to move');
  assert.equal(scoring.requirements[1].verdict, 'missing', 'the scoring given is left as it was');
  // Without nice-to-haves as gaps the numbering has none, so id 5 names nothing.
  assert.deepEqual(openRequirements(markAnswered(scoring, [1, 3, 5]), {}).map((o) => o.id), [2, 4]);
  assert.equal(markAnswered(scoring, []), scoring, 'nothing answered, nothing copied');
});

test('a gap pass is kept when the score rose, or when more verdicts are met and the score fell no further than the noise', () => {
  const met = (n, score) => ({ score, requirements: Array.from({ length: n }, () => ({ verdict: 'met' })), requiredSkillVerdicts: [{ verdict: 'weak' }] });
  assert.equal(gapPassProgressed(met(3, 70), met(3, 72)), true, 'the score rose');
  assert.equal(gapPassProgressed(met(3, 70), met(5, 69)), true, 'two more verdicts met, one point down: noise');
  assert.equal(gapPassProgressed(met(3, 70), met(5, 66)), false, 'four points down is more than noise');
  assert.equal(gapPassProgressed(met(3, 70), met(3, 70)), false, 'nothing moved');
  assert.equal(gapPassProgressed(met(3, 70), met(2, 70)), false, 'a verdict lost');
});

test("score first's must-include chips: the skills among them, listed under skills when the rewrite left them out", async () => {
  const { skillTerm } = await import('./index.js');
  const { withListedSkills } = await import('./skills.js');
  const chips = ['NestJS', 'Unit Testing', 'end-to-end testing', 'agentic AI platforms', 'developer platforms', 'multi-agent workflows', 'platform engineering', 'background check'];
  assert.deepEqual(chips.filter(skillTerm), chips.slice(0, 7), 'a background check is a condition of the job, not a skill');
  for (const k of ['security clearance', 'willingness to travel', "Bachelor's degree", '5+ years', 'drug screening']) assert.equal(skillTerm(k), false, k);

  const grouped = { skills: ['Node.js', 'React'], skillGroups: [{ category: 'Backend', items: ['Node.js'] }, { category: 'Frontend', items: ['React'] }] };
  const out = withListedSkills(grouped, ['NestJS', 'React'], 'Node.js React');
  assert.deepEqual(out.skillGroups.at(-1), { category: 'Other', items: ['NestJS'] }, 'only what the text lacks, in Other');
  assert.deepEqual(out.skills, ['Node.js', 'React', 'NestJS']);
  assert.deepEqual(withListedSkills({ skills: ['Node.js'], skillGroups: [] }, ['NestJS'], 'Node.js').skills, ['Node.js', 'NestJS']);
  assert.equal(withListedSkills(grouped, ['React'], 'React'), grouped, 'nothing missing, nothing changed');
});

test('two estimates of one measure contradict each other, whatever the figures; a different measure is not one', async () => {
  const { sameFigure } = await import('./estimates.js');
  assert.equal(sameFigure('reducing app start time by ~15%', 'reducing app start time by ~10%'), true, 'the Inabia ATS tailoring wrote both');
  assert.equal(sameFigure('reducing recovery time by ~15%', 'reducing app start time by ~15%'), false);
  assert.equal(sameFigure('cutting deploy time by ~20%', 'cutting billing deploy time by ~15%'), false);
  assert.equal(sameFigure('saving about 2 hours per release cycle', 'saving ~3 hours per release cycle'), true);
});

test('looking real first keeps the resume\'s own bullet order; an added line stays after the bullet it followed', async () => {
  const { inSourceOrder } = await import('./bullets.js');
  const source = ['Shipped iOS features.', 'Led call identity flows.', 'Integrated scoring services.'];
  const changes = [{ kind: 'rewritten', before: 'Led call identity flows.', after: 'Led call identity flows with Swift concurrency.' }];
  const model = ['Integrated scoring services.', 'Ran sanitizer checks before releases.', 'Led call identity flows with Swift concurrency.', 'Shipped iOS features.'];
  assert.deepEqual(inSourceOrder(model, source, changes), ['Shipped iOS features.', 'Led call identity flows with Swift concurrency.', 'Integrated scoring services.', 'Ran sanitizer checks before releases.']);
});
