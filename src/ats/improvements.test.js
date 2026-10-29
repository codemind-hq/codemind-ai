import { test } from 'node:test';
import assert from 'node:assert/strict';
import { improvementSuggestions } from './improvements.js';

const scoring = {
  requirements: [
    { text: 'Experience with payments', kind: 'experience', priority: 'preferred', verdict: 'missing' },
    { text: 'Lead a team of engineers', kind: 'responsibility', priority: 'required', verdict: 'weak', quote: 'Mentored two junior engineers on code reviews' },
    { text: '5+ years building backend services', kind: 'experience', priority: 'required', verdict: 'missing' },
    { text: 'Design distributed systems', kind: 'responsibility', priority: 'required', verdict: 'met', quote: 'Designed the event pipeline' },
    { text: 'BS in Computer Science', kind: 'education', priority: 'required', verdict: 'missing' },
  ],
  requiredSkillVerdicts: [
    { skill: 'Python', verdict: 'met' },
    { skill: 'Kafka', verdict: 'missing' },
    { skill: 'Terraform', verdict: 'weak' },
  ],
  preferredSkillVerdicts: [{ skill: 'GraphQL', verdict: 'missing' }],
  tailoringOpportunities: ['Bring forward the 2M requests/day pipeline you built at Acme'],
};

test('required gaps come first, experience before responsibilities before education, then skills, then preferred, then what to emphasize', () => {
  const out = improvementSuggestions(scoring, { limit: 20 });
  assert.deepEqual(
    out.map((s) => [s.kind, s.requirement]),
    [
      ['missing', '5+ years building backend services'],
      ['evidence', 'Lead a team of engineers'],
      ['missing', 'BS in Computer Science'],
      ['missing', 'Kafka'],
      ['evidence', 'Terraform'],
      ['missing', 'Experience with payments'],
      ['missing', 'GraphQL'],
      ['emphasize', null],
    ]
  );
  assert.ok(!out.some((s) => s.requirement === 'Design distributed systems'), 'a met requirement needs nothing');
});

test('missing experience and missing evidence read differently, and nothing invites making things up', () => {
  const out = improvementSuggestions(scoring, { limit: 20 });
  const missing = out.find((s) => s.requirement === '5+ years building backend services');
  const evidence = out.find((s) => s.requirement === 'Lead a team of engineers');
  assert.match(missing.suggestion, /If you have this experience/);
  assert.match(missing.suggestion, /never add it/);
  assert.match(evidence.suggestion, /Mentored two junior engineers/);
  assert.match(evidence.suggestion, /If it is real/);
  for (const s of out.filter((x) => x.kind === 'missing')) assert.match(s.suggestion, /If you/, s.requirement);
});

test('the limit keeps the most important, and an empty score gives none', () => {
  assert.equal(improvementSuggestions(scoring).length, 8);
  assert.deepEqual(
    improvementSuggestions(scoring, { limit: 2 }).map((s) => s.requirement),
    ['5+ years building backend services', 'Lead a team of engineers']
  );
  assert.deepEqual(improvementSuggestions({}), []);
  assert.deepEqual(improvementSuggestions(null), []);
});

test('a long quote is shortened at a word', () => {
  const [s] = improvementSuggestions({ requirements: [{ text: 'Own CI/CD', kind: 'responsibility', priority: 'required', verdict: 'weak', quote: 'word '.repeat(40) }] });
  assert.ok(s.suggestion.includes('…"'));
});
