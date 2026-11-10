import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyImprovement, improvableLines } from './improve.js';

const form = {
  name: 'Jane Tester',
  title: 'Developer',
  summary: 'Backend developer with 4 years of experience.',
  skills: ['Python', 'Flask'],
  experience: [
    {
      title: 'Software Engineer',
      company: 'Acme',
      achievements: ['Responsible for REST APIs in Flask serving 2M requests a day.', 'Worked on batch jobs.', 'Helped with tests.'],
    },
  ],
  projects: [{ name: 'Tracker', highlights: ['Built a job tracker.'] }],
  achievements: [],
};

test('every bullet gets an id by where it sits', () => {
  assert.deepEqual(
    improvableLines(form).map((l) => l.id),
    ['e0.0', 'e0.1', 'e0.2', 'p0.0']
  );
});

test('a rewrite is kept only when it keeps the facts and adds no figure', () => {
  const { form: next, changes } = applyImprovement(form, {
    title: 'Backend Engineer',
    summary: 'Backend engineer with 4 years building Python APIs.',
    lines: [
      { id: 'e0.0', text: 'Built Flask REST APIs serving 2M requests a day.' }, // kept: 2M and Flask stay
      { id: 'e0.1', text: 'Moved batch jobs to a scheduler, cutting failures by 90%.' }, // refused: 90% is invented
      { id: 'e0.2', text: 'Wrote automated tests.' }, // kept
      { id: 'p0.0', text: '- Built a job tracker app.' }, // kept, bullet mark dropped
    ],
  });
  assert.equal(next.title, 'Backend Engineer');
  assert.equal(next.summary, 'Backend engineer with 4 years building Python APIs.');
  assert.equal(next.experience[0].achievements[0], 'Built Flask REST APIs serving 2M requests a day.');
  assert.equal(next.experience[0].achievements[1], 'Worked on batch jobs.');
  assert.equal(next.experience[0].achievements[2], 'Wrote automated tests.');
  assert.equal(next.projects[0].highlights[0], 'Built a job tracker app.');
  assert.deepEqual(
    changes.map((c) => c.id),
    ['t', 's', 'e0.0', 'e0.2', 'p0.0']
  );
  assert.deepEqual(next.skills, form.skills);
  assert.equal(form.experience[0].achievements[0], 'Responsible for REST APIs in Flask serving 2M requests a day.', 'the source form is not changed');
});

test('a rewrite that drops a figure or a name stays as it was', () => {
  const { form: next, changes } = applyImprovement(form, {
    title: '',
    summary: '',
    lines: [{ id: 'e0.0', text: 'Built REST APIs serving millions of requests.' }],
  });
  assert.equal(next.experience[0].achievements[0], form.experience[0].achievements[0]);
  assert.equal(changes.length, 0);
});
