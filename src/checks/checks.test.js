import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  certificationClaims,
  factSources,
  figureClaims,
  inflatedTenure,
  normalizeNumber,
  resumeWarnings,
  sourcedCertifications,
  sourcedFigures,
  supportedYears,
  tenureClaims,
  unsourcedFigures,
  unsupportedFacts,
} from './index.js';

// Cases below marked "(ai-job-hunter)" are taken from the upstream test suite these rules were
// ported with (apps/desktop/src-tauri/src/validate/content/test.rs).

const invented = (written, source) => unsourcedFigures(written, sourcedFigures(source));

test('numbers compare across grouping and decimal conventions', () => {
  for (const [raw, n] of [['1,200', '1200'], ['1.200', '1200'], ['1 200', '1200'], ["1'200", '1200'], ['3,5', '3.5'], ['3.5', '3.5'], ['12,000,000', '12000000']]) {
    assert.equal(normalizeNumber(raw), n, raw);
  }
});

test('a figure is one claim, whatever form it is written in', () => {
  assert.deepEqual([...figureClaims('Onboarded 35k users')], ['35000'], 'expanded; the mantissa is not a second claim (ai-job-hunter)');
  assert.deepEqual([...figureClaims('Cut costs by 40% and grew 3x')], ['40%', '3x']);
  assert.deepEqual([...figureClaims('Engineer with 8 years of experience')], [], 'tenure is its own check');
  assert.deepEqual([...figureClaims('Runs on S3, EC2, k8s and OAuth2')], [], 'a digit inside a name is not a figure');
  assert.ok(figureClaims('Doubled throughput').has('2x'));
});

test('a restated figure is not an invented one (ai-job-hunter)', () => {
  assert.deepEqual(invented('Cut latency from 480ms to 90ms', 'Cut latency from 480ms to 90ms'), []);
  assert.deepEqual(invented('Cut latency from 480ms to 250ms', 'Cut latency from 480ms to 90ms'), ['250']);
  assert.deepEqual(invented('Grew to 10,000 users', 'Grew to 10k users'), []);
  assert.deepEqual(invented('Grew to 10k users', 'Grew to 10,000 users'), []);
  assert.deepEqual(invented('2x throughput', 'Doubled throughput'), []);
  assert.deepEqual(invented('Cut cost by 40%', 'cut cost by 40 percent'), []);
});

test('a figure off by a magnitude, or a percentage from a count, is invented', () => {
  assert.deepEqual(invented('Grew to 10M users', 'Grew to 10k users'), ['10000000']);
  assert.deepEqual(invented('Onboarded 3.5m users', 'Onboarded 4,000 users'), ['3500000']);
  assert.deepEqual(invented('Grew installs 40%', 'Shipped an app with 40k installs'), ['40%']);
  assert.deepEqual(invented('Tripled revenue', 'Grew revenue'), ['3x']);
});

test('contact details cannot vouch for a figure (ai-job-hunter)', () => {
  const form = { phone: '+1 555 123 4567', email: 'a@b.io', experience: [] };
  const sources = factSources(form, 'Jane\n+1 555 123 4567\nBuilt billing.', '');
  assert.deepEqual(unsupportedFacts('Processed 4567 settlements', sources), [{ code: 'figure', value: '4567' }]);
});

test('a tenure is a claim only with career wording or a role before it (ai-job-hunter)', () => {
  for (const text of ['Engineer with 8 years of experience.', 'Backend engineer with 20 years.', 'Backend engineer, eight years across payment systems.', '10+ years of professional software development']) {
    assert.equal(tenureClaims(text).length, 1, text);
  }
  for (const text of ['Rebuilt a platform with 15 years of accumulated technical debt.', 'Inherited a codebase with 20 years in production.', 'Cut cloud spend by 1.2M USD per year', 'Mentored two interns last year', 'Signed a 3-year contract']) {
    assert.equal(tenureClaims(text).length, 0, text);
  }
});

test('the years a resume supports are what it states, or its dated span plus one', () => {
  const now = new Date('2026-06-01');
  const form = (periods, summary = '') => ({ summary, experience: periods.map((period) => ({ period, achievements: [] })) });
  assert.equal(supportedYears(form(['2018 – 2021']), { now }), 4, 'a year of slack on the span (ai-job-hunter)');
  assert.equal(supportedYears(form(['Jan 2019 – Present']), { now }), 8);
  assert.equal(supportedYears(form(['2022 – 2024'], 'Engineer with 10 years of experience.'), { now }), 10, 'what the source states stands');
  assert.equal(supportedYears(form(['2022 – 2024'], 'Over a decade of experience.'), { now }), null, 'unreadable: the check stays silent (ai-job-hunter)');
  assert.equal(supportedYears(form([]), { now }), null);
});

test('"decades" in a bullet about something else does not switch the tenure check off', () => {
  const now = new Date('2026-06-01');
  const form = (achievement, summary = '') => ({ summary, experience: [{ period: '2022 – Present', achievements: [achievement] }] });
  const claim = 'Backend engineer with 15 years of experience';
  for (const bullet of ['Indexed decades of archived documents for search', 'Kept the billing service running for several years of sales']) {
    const years = supportedYears(form(bullet), { now });
    assert.equal(years, 5, bullet);
    assert.equal(inflatedTenure(claim, years).length, 1, `${bullet}: an invented tenure is still caught`);
  }
  assert.equal(supportedYears(form('Built an API', 'Engineer with several years of experience.'), { now }), null, 'a stated unreadable tenure still stays silent');
});

test('certifications are compared on the issuer, generously on the source side (ai-job-hunter)', () => {
  assert.deepEqual([...certificationClaims('CKA and AWS Certified Solutions Architect')].sort(), ['aws', 'kubernetes']);
  assert.ok(sourcedCertifications('Certified Kubernetes Administrator').has('kubernetes'), 'the expansion backs the acronym');
  assert.ok(sourcedCertifications('passed the cka in 2022').has('kubernetes'), 'any casing in the source');
  assert.ok(sourcedCertifications('Certifications: Amazon Web Services Solutions Architect').has('aws'));
  for (const text of [
    'Certified the release for our AWS solutions architect to sign off',
    'Shipped Docker Certified images to the internal registry',
    'Deployed onto Kubernetes certified clusters in two regions',
    'Ran a Certified Scrum team through the settlement rewrite',
  ]) {
    assert.equal(certificationClaims(text).size, 0, text);
  }
});

test('one line against its sources names every unsupported fact', () => {
  const form = { summary: '', experience: [{ period: '2020 – 2022', achievements: ['Built billing on AWS for 2,000 merchants.'] }], certifications: [] };
  const sources = factSources(form, 'Built billing on AWS for 2,000 merchants.\n2020 – 2022');
  assert.deepEqual(unsupportedFacts('Built billing on AWS for 2,000 merchants.', sources), []);
  assert.deepEqual(
    unsupportedFacts('CISSP engineer with 9 years of experience; billing for 20,000 merchants.', sources).map((f) => f.code).sort(),
    ['certification', 'figure', 'tenure']
  );
});

test('hygiene warnings: long, crowded, repeated, stuffed, and listed-but-never-shown', () => {
  const long = `Built ${'the billing and reporting services '.repeat(8)}on AWS.`;
  const form = {
    summary: 'Python engineer.',
    skills: ['Python', 'Kubernetes', 'Photoshop'],
    experience: [
      { company: 'Acme', achievements: [long, 'Built the Python billing service for merchants.', 'Built the Python billing service for all merchants.', 'a', 'b', 'c', 'd'] },
    ],
  };
  const codes = resumeWarnings(form, { keywords: ['Python', 'Kubernetes'] }).map((w) => w.code);
  assert.ok(codes.includes('long_bullet'));
  assert.ok(codes.includes('bullet_count'));
  assert.ok(codes.includes('duplicate_bullet'));
  assert.ok(codes.includes('skill_not_shown'), 'Kubernetes is listed and never used');
  assert.ok(!resumeWarnings(form, { keywords: ['Python', 'Kubernetes'] }).some((w) => w.code === 'skill_not_shown' && /Python|Photoshop/.test(w.message)), 'only a job keyword, and only when unshown');

  const stuffed = { summary: 'Python Python Python Python Python Python Python.', skills: ['Python'], experience: [] };
  assert.ok(resumeWarnings(stuffed, { keywords: ['Python'] }).some((w) => w.code === 'keyword_stuffing'));
  assert.deepEqual(resumeWarnings({ summary: 'Python engineer.', skills: ['Python'], experience: [{ company: 'Acme', achievements: ['Built billing in Python.'] }] }, { keywords: ['Python'] }), []);
});
