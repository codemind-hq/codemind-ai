import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkResumeText } from './resumeCheck.js';

// A student's resume: education and projects, no roles yet. Its project bullets are its lines of
// work, scored as a role's would be, rather than nothing at all.
const STUDENT = `Jordan Lee
jordan.lee@example.edu · +1 415 555 0100 · Austin, TX · github.com/jordanlee

Education
University of Texas at Austin — B.S. Computer Science, expected May 2027

Projects
• Built a Flask and PostgreSQL course planner used by 1,200 students, cutting schedule conflicts by 40%
• Trained a PyTorch image classifier on 50,000 photos to 94% accuracy for a robotics club
• Wrote a Go CLI that compresses build logs 6x, adopted by 3 open-source repositories

Skills
Python, Go, PyTorch, Flask, PostgreSQL, Docker, Git
`;

test('a student resume scores its project bullets as lines of work', () => {
  const result = checkResumeText(STUDENT);
  assert.equal(result.stats.student, true);
  assert.equal(result.stats.projects, 3);
  assert.equal(result.stats.achievements, 3);
  assert.equal(result.stats.withNumbers, 3);
  assert.ok(result.parts.find((p) => p.key === 'impact').got > 30, 'the impact part credits the quantified project bullets');
});

test('a resume with roles is not a student resume, and its projects join its lines of work', () => {
  const working = STUDENT.replace('Projects\n', 'Experience\nAcme — Software Engineer, 2024–2026\n• Shipped a payments service handling 2M requests a day\n\nProjects\n');
  const result = checkResumeText(working);
  assert.equal(result.stats.student, false);
  assert.equal(result.stats.projects, 3);
  assert.equal(result.stats.achievements, 4);
});
