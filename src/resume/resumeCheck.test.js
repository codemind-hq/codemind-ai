import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkResumeText } from './resumeCheck.js';

const STRONG = `Jane Doe
Austin, TX | jane@example.com | +1 512 555 0134 | linkedin.com/in/janedoe

Summary
Backend engineer with 8 years building payment systems in Go and PostgreSQL.

Experience
Senior Backend Engineer, Acme Pay, Jan 2021 – Present
• Built a ledger service in Go that settles 2M payments a day with 99.99% uptime
• Cut checkout latency from 480ms to 90ms by moving session reads to Redis
• Led a team of 4 engineers through the migration from MySQL to PostgreSQL
• Designed the retry queue on Kafka that recovered $1.2M in failed charges a year
Backend Engineer, Shopco, 2017 – 2020
• Shipped the order API used by 300 merchants, written in Python and Django
• Automated deploys with Terraform and GitHub Actions, cutting release time by 70%
• Wrote integration tests that took coverage from 40% to 85%
• Mentored 3 junior engineers through code review and pairing sessions

Skills
Go, Python, PostgreSQL, MySQL, Redis, Kafka, Docker, Kubernetes, Terraform, AWS, Django, GraphQL

Education
B.S. Computer Science, University of Texas, 2016
${'Owned the on-call rotation and wrote the runbooks the team still uses for incidents and audits. '.repeat(14)}`;

test('a complete resume scores high and passes every contact and section check', () => {
  const result = checkResumeText(STRONG);
  assert.ok(result.score >= 85, `score ${result.score}`);
  assert.equal(
    result.parts.reduce((s, p) => s + p.of, 0),
    100
  );
  for (const label of ['Email address', 'Phone number', 'Profile link', 'Location', 'Experience section', 'Skills section', 'Education section', 'Summary', 'Dates for each role']) {
    assert.ok(result.passed.includes(label), label);
  }
  assert.ok(result.stats.skills.includes('Kafka'));
  assert.equal(result.stats.withNumbers, 8);
});

test('a thin resume is told what to fix, the costliest first', () => {
  const thin = `John Smith
Experience
Responsible for maintaining the company website and fixing bugs when they came up
Helped the team with testing and worked on various projects as needed
I was in charge of my own tasks and I attended the daily meetings
Worked on customer support tickets and helped my manager with reports`;
  const result = checkResumeText(thin.padEnd(220, ' '));
  assert.ok(result.score < 40, `score ${result.score}`);
  const keys = result.issues.map((i) => i.key);
  for (const key of ['email', 'phone', 'skills_section', 'education', 'numbers', 'verbs', 'dates', 'first_person', 'length']) assert.ok(keys.includes(key), key);
  assert.deepEqual(
    result.issues.map((i) => i.lost),
    [...result.issues.map((i) => i.lost)].sort((a, b) => b - a)
  );
  assert.equal(result.issues.find((i) => i.key === 'numbers').severity, 'high');
  assert.match(result.issues.find((i) => i.key === 'verbs').title, /3 bullets describe duties/);
});

test('a bullet a PDF broke over two lines is read as one', () => {
  const text = `Experience
Engineer, Acme, 2019 – 2022
• Built the billing service that handles invoices for every customer and
partner account across 12 countries
• Reduced cloud spend by 30% by moving batch jobs to spot instances`;
  const result = checkResumeText(text);
  assert.equal(result.stats.achievements, 2);
  assert.equal(result.stats.withNumbers, 2);
});

test('a country the caller read counts as the location; years alone are not a number', () => {
  const text = `Ana Lopez\nana@example.com\nExperience\nDeveloper, Initech, 2018 – 2020\n• Maintained internal tools for the finance team in 2019 and 2020`;
  const result = checkResumeText(text, { country: 'Spain' });
  assert.ok(result.passed.includes('Location'));
  assert.equal(result.stats.withNumbers, 0);
});

test('joined headings count, and a bullet mark on its own line marks the next', () => {
  const text = `EXPERIENCE/PROJECTS
Engineer, Acme, 2019 – 2022
•
Built the billing service that handles invoices for 400 customers
PROFESSIONAL SKILLS
Go, Python
EDUCATION & CONTINUOUS LEARNING
B.S. Computer Science`;
  const result = checkResumeText(text);
  for (const label of ['Experience section', 'Skills section', 'Education section']) assert.ok(result.passed.includes(label), label);
  assert.equal(result.stats.achievements, 1);
  assert.equal(result.stats.withNumbers, 1);
});
