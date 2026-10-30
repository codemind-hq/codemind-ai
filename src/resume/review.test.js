import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedReview } from './review.js';

const RESUME = `Jane Doe
Experience
Backend Engineer, Acme, 2019 – 2022
• Responsible for maintaining the   billing service
• Worked on the migration to PostgreSQL for 40 merchants`;

test('a bullet the resume never wrote is dropped', () => {
  const review = checkedReview(
    {
      verdict: 'Duties, not results.',
      strengths: [],
      bullets: [
        { original: 'Responsible for maintaining the billing service', problem: 'A duty.', rewrite: 'Ran the billing service.' },
        { original: 'Built a search engine from scratch', problem: 'Vague.', rewrite: 'Built search.' },
      ],
      advice: [],
    },
    RESUME
  );
  assert.deepEqual(
    review.bullets.map((b) => b.original),
    ['Responsible for maintaining the billing service']
  );
});

test('a rewrite may use the resume figures and placeholders, never a new figure', () => {
  const review = checkedReview(
    {
      verdict: 'x',
      strengths: [],
      bullets: [
        { original: '• Worked on the migration to PostgreSQL for 40 merchants', problem: 'No outcome.', rewrite: 'Moved 40 merchants to PostgreSQL, cutting query time by [X%].' },
        { original: 'Responsible for maintaining the billing service', problem: 'A duty.', rewrite: 'Kept billing at 99.9% uptime for 2M invoices.' },
      ],
      advice: [{ title: 'Add a summary', detail: 'Two lines on what you do.' }, { title: '', detail: 'no title' }],
    },
    RESUME
  );
  assert.deepEqual(
    review.bullets.map((b) => [b.original, b.rewrite]),
    [['Worked on the migration to PostgreSQL for 40 merchants', 'Moved 40 merchants to PostgreSQL, cutting query time by [X%].']]
  );
  assert.equal(review.advice.length, 1);
});

test('a malformed answer reads as an empty review', () => {
  assert.deepEqual(checkedReview(null, RESUME), { verdict: '', strengths: [], bullets: [], advice: [] });
});
