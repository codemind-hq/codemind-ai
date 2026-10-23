import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanStructuredResume, normalizeStructuredResume, structuredResumeToText, withoutSkills, withSkills } from './structuredResume.js';

test('cleanStructuredResume keeps new sections and drops empty entries', () => {
  const resume = cleanStructuredResume({
    name: ' Jane Doe ',
    skills: ['Go', '', 7],
    projects: [{ name: 'Ledger', highlights: ['Built it', ''] }, { name: '', highlights: [] }],
    certifications: [{ name: 'CKA', issuer: 'CNCF', year: '2024' }, {}],
    languages: ['English', ' '],
    otherSections: [{ title: 'Awards', content: 'Hackathon winner' }, { title: '', content: '' }],
    unknown: 'ignored',
  });
  assert.equal(resume.name, 'Jane Doe');
  assert.deepEqual(resume.skills, ['Go']);
  assert.deepEqual(resume.projects, [{ name: 'Ledger', role: '', period: '', link: '', highlights: ['Built it'] }]);
  assert.equal(resume.certifications.length, 1);
  assert.deepEqual(resume.languages, ['English']);
  assert.deepEqual(resume.otherSections, [{ title: 'Awards', content: 'Hackathon winner' }]);
  assert.equal('unknown' in resume, false);
});

test('list items are stored without leading bullet symbols', () => {
  const resume = cleanStructuredResume({
    experience: [{ title: 'Engineer', achievements: ['• Led payments', '- Built APIs', '➤ Shipped', '-5% latency', '•', '* Mentored'] }],
    achievements: ['▪ Hackathon winner'],
    skills: ['• Go'],
  });
  assert.deepEqual(resume.experience[0].achievements, ['Led payments', 'Built APIs', 'Shipped', '-5% latency', 'Mentored']);
  assert.deepEqual(resume.achievements, ['Hackathon winner']);
  assert.deepEqual(resume.skills, ['Go']);
});

test('cleanStructuredResume accepts junk without throwing; normalize still requires name and email', () => {
  assert.equal(cleanStructuredResume(null).name, '');
  assert.deepEqual(normalizeStructuredResume({ name: 'Jane' }), { error: 'Email is required' });
  assert.ok(normalizeStructuredResume({ name: 'Jane', email: 'j@x.io' }).resume);
});

test('structuredResumeToText includes every section with single blank lines', () => {
  const text = structuredResumeToText(
    cleanStructuredResume({
      name: 'Jane Doe',
      email: 'j@x.io',
      experience: [{ company: 'Acme', title: 'Engineer', period: '2020 – now', achievements: ['Shipped payments'] }],
      projects: [{ name: 'Ledger', link: 'github.com/j/ledger', highlights: ['Double-entry engine'] }],
      education: [{ school: 'MIT', degree: 'BSc', year: '2018' }],
      certifications: [{ name: 'CKA', issuer: 'CNCF' }],
      languages: ['English', 'Korean'],
      achievements: ['Hackathon winner', ''],
      otherSections: [{ title: 'Publications', content: 'Paper on ledgers' }],
    })
  );
  assert.ok(text.includes('ACHIEVEMENTS\n• Hackathon winner'));
  for (const heading of ['EXPERIENCE', 'PROJECTS', 'EDUCATION', 'CERTIFICATIONS', 'ACHIEVEMENTS', 'LANGUAGES', 'PUBLICATIONS']) {
    assert.ok(text.includes(heading), heading);
  }
  assert.ok(text.includes('Ledger | github.com/j/ledger\n• Double-entry engine'));
  assert.ok(text.includes('CKA — CNCF'));
  assert.equal(/\n{3,}/.test(text), false);
});

test('a skills section kept as text becomes skill groups under its own heading', () => {
  const resume = cleanStructuredResume({
    skills: ['Docker'],
    otherSections: [
      { title: 'Technical Proficiencies', content: '• Languages: Python, Go\nCloud: AWS; GCP\n' },
      { title: 'Publications', content: 'Paper on ledgers' },
    ],
  });
  assert.equal(resume.skillsHeading, 'Technical Proficiencies');
  assert.deepEqual(resume.skillGroups, [
    { category: 'Languages', items: ['Python', 'Go'] },
    { category: 'Cloud', items: ['AWS', 'GCP'] },
    { category: 'Other', items: ['Docker'] },
  ]);
  assert.deepEqual(resume.skills, ['Python', 'Go', 'AWS', 'GCP', 'Docker']);
  assert.deepEqual(resume.otherSections, [{ title: 'Publications', content: 'Paper on ledgers' }]);
  assert.ok(structuredResumeToText(resume).includes('TECHNICAL PROFICIENCIES\nLanguages: Python, Go\nCloud: AWS, GCP\nOther: Docker'));
});

test('a section that only sounds like skills, or groups with no category, stay as they were', () => {
  const prose = cleanStructuredResume({ otherSections: [{ title: 'Technical Expertise', content: 'I have spent ten years building distributed systems for banks.' }] });
  assert.equal(prose.otherSections.length, 1);
  assert.deepEqual(prose.skillGroups, []);
  const plain = cleanStructuredResume({ skills: ['Go'], skillGroups: [{ category: '', items: ['Rust', 'go'] }] });
  assert.deepEqual(plain.skillGroups, [], 'no category: a plain list');
  assert.deepEqual(plain.skills, ['Go', 'Rust']);
});

test('skills added or removed keep the groups and the flat list in step', () => {
  const form = cleanStructuredResume({ skillGroups: [{ category: 'Languages', items: ['Python', 'Go'] }] });
  const added = withSkills(form, ['Kubernetes', 'python']);
  assert.deepEqual(added.skillGroups, [
    { category: 'Languages', items: ['Python', 'Go'] },
    { category: 'Other', items: ['Kubernetes'] },
  ]);
  assert.deepEqual(added.skills, ['Python', 'Go', 'Kubernetes']);
  const removed = withoutSkills(added, (s) => s === 'Kubernetes');
  assert.deepEqual(removed.skillGroups, [{ category: 'Languages', items: ['Python', 'Go'] }]);
  assert.deepEqual(removed.skills, ['Python', 'Go']);
  assert.deepEqual(withSkills(cleanStructuredResume({ skills: ['Go'] }), ['Rust']), { skills: ['Go', 'Rust'], skillGroups: [] });
});

test('invisible format characters a PDF leaves behind are stripped from every string', () => {
  const form = cleanStructuredResume({ phone: '(555) 010-0838‬', name: 'Ja​ne', skills: ['Py‍thon'], experience: [{ company: 'Acme⁠', title: 'Eng', period: '', achievements: ['Built it.‬'] }] });
  assert.equal(form.phone, '(555) 010-0838');
  assert.equal(form.name, 'Jane');
  assert.deepEqual(form.skills, ['Python']);
  assert.equal(form.experience[0].company, 'Acme');
  assert.deepEqual(form.experience[0].achievements, ['Built it.']);
});

test('skills parsed into fragments are read as the resume meant them: a nested category is a group of its own, a parenthesis is not a split', () => {
  const resume = cleanStructuredResume({
    skillGroups: [
      { category: 'Languages & Frameworks', items: ['Frontend Architecture & Modern Web: React.js', 'TypeScript', 'Server-Side & Backend Core: Node.js', 'Python (FastAPI/Asyncio)'] },
      { category: 'Databases & Storage', items: ['SQL Query Tuning & Optimization (PostgreSQL', 'ClickHouse)', 'Redis', 'https://example.com/skills: not a category'] },
    ],
  });
  assert.deepEqual(resume.skillGroups, [
    { category: 'Frontend Architecture & Modern Web', items: ['React.js', 'TypeScript'] },
    { category: 'Server-Side & Backend Core', items: ['Node.js', 'Python (FastAPI/Asyncio)'] },
    { category: 'Databases & Storage', items: ['SQL Query Tuning & Optimization (PostgreSQL, ClickHouse)', 'Redis', 'https://example.com/skills: not a category'] },
  ]);
  const section = cleanStructuredResume({ otherSections: [{ title: 'Skills', content: 'Cloud: Cloud Platforms (AWS, GCP), Docker\nLanguages: Python; Go' }] });
  assert.deepEqual(section.skillGroups, [
    { category: 'Cloud', items: ['Cloud Platforms (AWS, GCP)', 'Docker'] },
    { category: 'Languages', items: ['Python', 'Go'] },
  ]);
});

test("a role's city and state are kept for application forms and never written into the resume's text", () => {
  const resume = cleanStructuredResume({
    name: 'Jane Doe',
    experience: [{ company: 'Acme, Austin, TX', title: 'Engineer', period: '2020 - 2024', city: ' Austin ', state: 'TX', achievements: ['Built the API'] }],
  });
  assert.equal(resume.experience[0].city, 'Austin');
  assert.equal(resume.experience[0].state, 'TX');
  const text = structuredResumeToText({ ...resume, experience: [{ ...resume.experience[0], company: 'Acme' }] });
  assert.doesNotMatch(text, /Austin|\bTX\b/);
});
