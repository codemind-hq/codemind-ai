import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Packer } from 'docx';
import JSZip from 'jszip';
import { buildCoverLetterDocx, buildResumeDocx, estimatePages, fittedTemplate, formResumeModel, parseTailoredResume } from './docx.js';
import { DEFAULT_TEMPLATE, listResumeTemplates, RESUME_TEMPLATES, resumeTemplate, TEMPLATE_IDS } from './templates.js';

// What the tailoring model writes today, including the stray "Details" label a two-column
// PDF leaves in the extracted text.
const TEXT = `Jane Doe
SENIOR DATA ENGINEER
Details
Austin, Texas
(555) 010-2030
jane.doe@example.com

Summary
Senior Data Engineer with over 10 years of experience building data pipelines.

Experience
Senior Data Engineer, Northwind
OCT 2019 — PRESENT
• Defined and implemented core data models for user interactions.
• Built and deployed data services on AWS.

Software Consultant at Contoso
JAN 2018 — OCT 2019
- Developed and maintained backend systems.

Education
University of Texas, Austin
APR 2015 — MAY 2017
Bachelor's Degree - Computer Science

Skills
• Programming: Python, SQL, C#
• Cloud Platforms: AWS (S3, Lambda, Redshift), Docker
`;

const FORM = { name: 'Jane Doe', title: 'Full Stack Engineer', email: 'jane.doe@example.com', phone: '(555) 010-2030', location: 'Austin, Texas', portfolio: 'apps.example.com' };

test('the header comes from the saved form, the headline from the tailored text, and stray labels are dropped', () => {
  const m = parseTailoredResume(TEXT, FORM);
  assert.equal(m.name, 'Jane Doe');
  assert.equal(m.title, 'SENIOR DATA ENGINEER', 'the tailoring may retitle the resume for the job');
  assert.deepEqual(m.contact, ['jane.doe@example.com', '(555) 010-2030', 'Austin, Texas', 'apps.example.com']);
  const all = JSON.stringify(m.sections);
  assert.ok(!all.includes('Details'), 'the PDF sidebar label never reaches the document');
  assert.deepEqual(m.sections.map((s) => s.heading), ['Summary', 'Experience', 'Education', 'Skills']);
});

test('experience becomes entries with title, organisation and dates, followed by their bullets', () => {
  const m = parseTailoredResume(TEXT, FORM);
  const exp = m.sections.find((s) => s.heading === 'Experience').blocks;
  assert.deepEqual(exp[0], { type: 'entry', title: 'Senior Data Engineer', org: 'Northwind', dates: 'OCT 2019 — PRESENT' });
  assert.deepEqual(exp[1], { type: 'bullets', items: ['Defined and implemented core data models for user interactions.', 'Built and deployed data services on AWS.'] });
  assert.deepEqual(exp[2], { type: 'entry', title: 'Software Consultant', org: 'Contoso', dates: 'JAN 2018 — OCT 2019' });
  assert.equal(exp[3].type, 'bullets');
  const edu = m.sections.find((s) => s.heading === 'Education').blocks;
  assert.equal(edu[0].type, 'entry');
  assert.deepEqual(edu[1], { type: 'paragraph', text: "Bachelor's Degree - Computer Science" });
});

test("an entry written by this renderer parses back, so re-tailoring its own output keeps the shape", () => {
  const m = parseTailoredResume('Jane\n\nExperience\nSenior Engineer · Acme\n2019 — 2021\n• Shipped things.', null);
  assert.deepEqual(m.sections[0].blocks[0], { type: 'entry', title: 'Senior Engineer', org: 'Acme', dates: '2019 — 2021' });
});

test('a date range at the end of a line is an entry too, and summary text stays a paragraph', () => {
  const m = parseTailoredResume('Jane\n\nExperience\nEngineer | Acme | 2019 – 2021\n• Shipped things.\n\nSummary\nBuilds APIs.', null);
  const exp = m.sections[0].blocks;
  assert.deepEqual(exp[0], { type: 'entry', title: 'Engineer', org: 'Acme', dates: '2019 – 2021' });
  assert.deepEqual(m.sections[1].blocks, [{ type: 'paragraph', text: 'Builds APIs.' }]);
});

test('a "Name — Title" header line, as the form text has it, yields just the title', () => {
  const withForm = parseTailoredResume('Jane Doe — Full Stack AI Engineer\njane@x.io\n\nSkills\n• Go', { name: 'Jane Doe', email: 'jane@x.io' });
  assert.equal(withForm.name, 'Jane Doe');
  assert.equal(withForm.title, 'Full Stack AI Engineer');
  const noTitle = parseTailoredResume('Jane Doe\njane@x.io\n\nSkills\n• Go', { name: 'Jane Doe', title: 'Engineer' });
  assert.equal(noTitle.title, 'Engineer', 'falls back to the form title when the text has none');
  const without = parseTailoredResume('Jane Doe | Data Engineer\n\nSkills\n• SQL', null);
  assert.equal(without.name, 'Jane Doe', 'with no form a "Name | Title" first line is split the same way');
  assert.equal(without.title, 'Data Engineer');
});

test('without a form, the contact line is what the text carries', () => {
  const m = parseTailoredResume('Jane Doe\nEngineer\njane@x.io | +1 555 0100\n\nSkills\n• Go', null);
  assert.equal(m.name, 'Jane Doe');
  assert.equal(m.title, 'Engineer');
  assert.deepEqual(m.contact, ['jane@x.io', '+1 555 0100']);
});

test('three templates, all single-column with standard headings; an unknown id falls back to the default', () => {
  assert.deepEqual(TEMPLATE_IDS, ['classic', 'modern', 'compact']);
  assert.equal(resumeTemplate('nope').id, DEFAULT_TEMPLATE);
  assert.deepEqual(listResumeTemplates().map((t) => t.id), TEMPLATE_IDS);
  for (const t of Object.values(RESUME_TEMPLATES)) {
    assert.ok(t.fonts.body && t.fonts.heading && t.sizes.body >= 10 && t.margins >= 0.5, t.id);
    assert.ok(t.description.length > 20, `${t.id} explains itself`);
  }
});

test('each template renders a real .docx: headings and bullets present, no tables, no header/footer', async () => {
  const model = parseTailoredResume(TEXT, FORM);
  for (const id of TEMPLATE_IDS) {
    const buffer = await Packer.toBuffer(buildResumeDocx(model, id));
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml').async('string');
    assert.ok(xml.includes('Jane Doe'), `${id}: name`);
    assert.ok(xml.includes('Experience'), `${id}: section heading`);
    assert.ok(xml.includes('Northwind'), `${id}: entry`);
    assert.ok(xml.includes('<w:numPr>'), `${id}: real bullets`);
    assert.ok(!xml.includes('<w:tbl>'), `${id}: no tables`);
    assert.ok(!xml.includes('<w:headerReference') && !xml.includes('<w:footerReference'), `${id}: nothing in header/footer`);
  }
});

const TAILORED_FORM = {
  ...FORM,
  title: 'Senior Data Engineer',
  summary: 'Senior data engineer with 10 years building pipelines.',
  skills: ['Python', 'SQL', 'AWS'],
  experience: [{ company: 'Northwind', title: 'Senior Data Engineer', period: 'Oct 2019 – Present', achievements: ['Built data services on AWS.'] }],
  education: [{ school: 'University of Texas', degree: "Bachelor's Degree - Computer Science", year: '2017' }],
  projects: [{ name: 'Spam Radar', role: '', period: '2021', link: 'https://spam.example', highlights: ['Shipped an iOS app.'] }],
  certifications: [{ name: '', issuer: 'Amazon', year: '2022' }],
  languages: ['English', 'Mandarin'],
  achievements: [],
  otherSections: [{ title: 'Volunteering', content: '• Mentored students.\n• Ran a coding club.' }],
};

test('a resume form becomes the document model directly: nothing is parsed or guessed', () => {
  const m = formResumeModel(TAILORED_FORM);
  assert.equal(m.name, 'Jane Doe');
  assert.equal(m.title, 'Senior Data Engineer');
  assert.deepEqual(m.contact, ['jane.doe@example.com', '(555) 010-2030', 'Austin, Texas', 'apps.example.com']);
  assert.deepEqual(m.sections.map((s) => s.heading), ['Summary', 'Skills', 'Experience', 'Projects', 'Education', 'Certifications', 'Languages', 'Volunteering'], 'empty sections are left out');
  const section = (heading) => m.sections.find((s) => s.heading === heading).blocks;
  assert.deepEqual(section('Skills'), [{ type: 'paragraph', text: 'Python, SQL, AWS' }]);
  assert.deepEqual(section('Experience'), [
    { type: 'entry', title: 'Senior Data Engineer', org: 'Northwind', dates: 'Oct 2019 – Present' },
    { type: 'bullets', items: ['Built data services on AWS.'] },
  ]);
  assert.deepEqual(section('Projects')[1], { type: 'paragraph', text: 'https://spam.example' }, 'a project keeps its link');
  assert.deepEqual(section('Education'), [{ type: 'entry', title: "Bachelor's Degree - Computer Science", org: 'University of Texas', dates: '2017' }]);
  assert.deepEqual(section('Certifications'), [{ type: 'entry', title: 'Amazon', org: '', dates: '2022' }], 'an entry with one name leads with it');
  assert.deepEqual(section('Volunteering'), [{ type: 'bullets', items: ['Mentored students.', 'Ran a coding club.'] }]);
  const located = formResumeModel({ education: [{ school: 'University of Texas', degree: 'B.S.', location: 'Austin', year: '2017' }] });
  assert.deepEqual(located.sections[0].blocks[0].org, 'University of Texas, Austin', 'the location follows the school name');
  assert.deepEqual(formResumeModel(null), { name: '', title: '', contact: [], sections: [] });
});

test('a form renders in every template', async () => {
  for (const id of TEMPLATE_IDS) {
    const zip = await JSZip.loadAsync(await Packer.toBuffer(buildResumeDocx(formResumeModel(TAILORED_FORM), id)));
    const xml = await zip.file('word/document.xml').async('string');
    for (const text of ['Jane Doe', 'Northwind', 'Python, SQL, AWS', 'Ran a coding club.']) assert.ok(xml.includes(text), `${id}: ${text}`);
    assert.ok(!xml.includes('<w:tbl>'), `${id}: no tables`);
  }
});

test('the page estimate tells one page from two, and the compact layout from the others', () => {
  const short = formResumeModel(TAILORED_FORM);
  assert.ok(estimatePages(short, 'classic') < 1, 'a short resume fits a page');

  const bullets = Array.from({ length: 9 }, (_, i) => `Built and operated data service number ${i} on AWS, cutting the nightly run from six hours to under one for three product teams.`);
  const long = formResumeModel({ ...TAILORED_FORM, experience: Array.from({ length: 4 }, (_, i) => ({ company: `Company ${i}`, title: 'Engineer', period: '2019 – 2021', achievements: bullets })) });
  const pages = Object.fromEntries(TEMPLATE_IDS.map((id) => [id, estimatePages(long, id)]));
  assert.ok(pages.classic > 1.5 && pages.classic < 3.5, `about two pages, got ${pages.classic}`);
  // Classic and Modern may swap places: either may be fitted tighter to end a page sooner (fittedTemplate).
  assert.ok(pages.compact < Math.min(pages.modern, pages.classic), `compact is the tightest: ${JSON.stringify(pages)}`);
  assert.equal(estimatePages(formResumeModel(null), 'classic'), 0.1);
});

test("skills by category print under the resume's own heading, one bold-labelled line per category", () => {
  const model = formResumeModel({
    name: 'Jane',
    skillsHeading: 'Technical Proficiencies',
    skills: ['Python', 'Go', 'AWS'],
    skillGroups: [
      { category: 'Languages', items: ['Python', 'Go'] },
      { category: 'Cloud (IaaS)', items: ['AWS'] },
    ],
  });
  const section = model.sections.find((s) => s.heading === 'Technical Proficiencies');
  assert.deepEqual(section.blocks, [
    { type: 'paragraph', text: 'Languages: Python, Go', label: 'Languages' },
    { type: 'paragraph', text: 'Cloud (IaaS): AWS', label: 'Cloud (IaaS)' },
  ]);
  assert.ok(!model.sections.some((s) => s.heading === 'Skills'));
  assert.deepEqual(formResumeModel({ skills: ['Go'] }).sections[0], { heading: 'Skills', blocks: [{ type: 'paragraph', text: 'Go' }] });
});

test('a cover letter keeps its paragraphs and line breaks, in the template font', async () => {
  const letter = 'Dear hiring team,\r\n\r\nI build data pipelines.\n\n\n\nBest regards,\nJo Doe\n';
  const zip = await JSZip.loadAsync(await Packer.toBuffer(buildCoverLetterDocx(letter, 'modern')));
  const xml = await zip.file('word/document.xml').async('string');
  assert.equal((xml.match(/<w:p>|<w:p /g) || []).length, 3);
  assert.match(xml, /Best regards,<\/w:t><\/w:r><w:r><w:br\/><w:t[^>]*>Jo Doe/);
  const styles = await zip.file('word/styles.xml').async('string');
  assert.match(styles, /Calibri/);
});

test('dates that fit beside the title sit at the right margin; ones that do not go on the next line, never against the name', async () => {
  const xmlOf = async (form, id = 'classic') => (await JSZip.loadAsync(await Packer.toBuffer(buildResumeDocx(formResumeModel(form), id)))).file('word/document.xml').async('string');
  const short = await xmlOf({ name: 'A', experience: [{ company: 'Acme', title: 'Engineer', period: '2019 – 2021', achievements: ['Built things.'] }] });
  assert.match(short, /<w:tab w:val="right" w:pos="9602"\/>/, 'the tab stop is the A4 text edge, 11906 less two 0.8-inch margins');
  assert.match(short, /<w:t xml:space="preserve">\t2019 – 2021<\/w:t>/);
  // "HarmoniqHubDec 2024 - Present" in Word: the title left the right tab no room.
  const long = await xmlOf({ name: 'A', experience: [{ company: 'HarmoniqHub', title: 'Founder and Lead AI Engineer, Music Intelligence Platform', period: 'Dec 2024 - Present', achievements: ['Built things.'] }] });
  assert.match(long, /<w:br\/><w:t xml:space="preserve">Dec 2024 - Present<\/w:t>/);
  assert.doesNotMatch(long, /\tDec 2024/);
});

test('a resume that would spill a few lines onto a last page is set tighter to end a page sooner; one well into it is left alone', () => {
  const bullet = 'Built and operated the billing data service on AWS, cutting the nightly run from six hours to under one for three product teams.';
  const form = (n) => ({ ...TAILORED_FORM, experience: Array.from({ length: 4 }, (_, i) => ({ company: `Company ${i}`, title: 'Engineer', period: '2019 – 2021', achievements: Array.from({ length: n }, () => bullet) })) });
  const spill = [8, 9, 10, 11, 12].map(form).find((f) => {
    const pages = estimatePages(formResumeModel(f), 'classic');
    return fittedTemplate(formResumeModel(f), 'classic') !== RESUME_TEMPLATES.classic && pages <= 2;
  });
  assert.ok(spill, 'one of these runs a few lines onto a third page and is fitted back to two');
  const fitted = fittedTemplate(formResumeModel(spill), 'classic');
  assert.ok(fitted.spacing.sectionBefore < RESUME_TEMPLATES.classic.spacing.sectionBefore, 'spacing gives first');
  assert.equal(fittedTemplate(formResumeModel(TAILORED_FORM), 'classic'), RESUME_TEMPLATES.classic, 'a one-page resume keeps its template');
});
