import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRepairs, buildRepairPrompt, buildTailorPrompt, limitSkills, overstatedEstimate, repairTargets, resumeBlock, resumeHeadline, withEstimate, withoutEstimate, splitJobKeywords, tailoredResumeForm, tailorStyle, TAILOR_STYLES, withoutCuts } from './index.js';
import { TAILOR_RESPONSE_FORMAT } from './schema.js';
import { cleanStructuredResume } from '../resume/structuredResume.js';

const SOURCE = {
  name: 'Jane Doe',
  title: 'Full Stack Engineer',
  email: 'jane@x.io',
  phone: '(555) 010-2030',
  location: 'Austin, Texas',
  summary: 'Engineer with 8 years of experience building data services.',
  skills: ['Python', 'Postgres', 'React', 'Photoshop'],
  experience: [
    { company: 'Northwind', title: 'Senior Data Engineer', period: 'Oct 2019 – Present', achievements: ['Built data services on AWS.', 'Defined core data models.'] },
    { company: 'Contoso', title: 'Software Consultant', period: 'Jan 2018 – Oct 2019', achievements: ['Maintained backend systems in C#.'] },
  ],
  education: [{ school: 'University of Texas', degree: 'BS Computer Science', year: '2017' }],
  projects: [
    { name: 'Spam Radar', role: 'Solo', period: '2021', link: 'https://spam.example', highlights: ['Shipped an iOS app with 40k installs.'] },
    { name: 'Recipe Box', role: '', period: '2016', link: '', highlights: ['A weekend project.'] },
  ],
  certifications: [{ name: 'AWS Solutions Architect', issuer: 'Amazon', year: '2022' }],
  languages: ['English', 'Mandarin'],
  achievements: ['Hackathon winner 2020'],
  otherSections: [{ title: 'Volunteering', content: 'Mentored students at a coding club.' }],
};

const JOB = { title: 'Data Engineer', company: 'Acme', skills: ['Python', 'Kubernetes'], description: 'We need Python and Kubernetes.' };

// What a model would write: reworded, with the facts slightly off in the ways models get them wrong.
const WRITTEN = {
  title: 'Senior Data Engineer',
  summary: 'Senior data engineer with 8 years building Python data services on AWS.',
  skills: ['Python', 'PostgreSQL', 'Kubernetes', 'python'],
  experience: [
    { company: 'Northwind, Inc.', title: 'Lead Data Engineer', period: 'Oct 2019 - present', achievements: [{ text: 'Built Python data services on AWS.', from: 0 }] },
    { company: 'Contoso', title: 'Software Consultant', period: '2018 – 2019', achievements: [] },
    { company: 'Globex', title: 'Staff Engineer', period: '2015 – 2018', achievements: ['Led a platform team.'] },
  ],
  projects: [{ name: 'Spam Radar', role: 'Founder', period: '2021', link: '', highlights: ['Shipped an iOS app with 40k installs.'] }],
  achievements: [],
  otherSections: [
    { title: 'Volunteering', content: 'Mentored students.' },
    { title: 'Publications', content: 'A paper nobody wrote.' },
  ],
};

test('the model rewrites wording; employers, titles, dates, education and contact stay the source\'s', () => {
  const { form, pairedExperience } = tailoredResumeForm(SOURCE, WRITTEN);

  assert.equal(pairedExperience, 2);
  assert.equal(form.experience.length, 2, 'an employer the resume does not have is left out');
  assert.deepEqual(
    form.experience.map((e) => [e.company, e.title, e.period]),
    SOURCE.experience.map((e) => [e.company, e.title, e.period]),
    'a promotion or a reformatted date never reaches the resume'
  );
  assert.deepEqual(form.experience[0].achievements, ['Built Python data services on AWS.'], 'the rewritten bullets are kept');
  assert.deepEqual(form.experience[1].achievements, SOURCE.experience[1].achievements, 'a role never loses all its bullets');

  assert.equal(form.title, 'Full Stack Engineer', 'with no headline written, the resume keeps its own title');
  assert.equal(form.summary, WRITTEN.summary);
  for (const field of ['name', 'email', 'phone', 'location', 'education', 'certifications', 'languages']) {
    assert.deepEqual(form[field], cleanStructuredResume(SOURCE)[field], field);
  }
});

test('projects may be dropped but not altered, and no section is invented', () => {
  const { form } = tailoredResumeForm(SOURCE, WRITTEN);
  assert.deepEqual(form.projects, [SOURCE.projects[0]], 'the irrelevant project is gone; the kept one has its own role and link');
  assert.deepEqual(form.otherSections, [{ title: 'Volunteering', content: 'Mentored students.' }]);
  assert.deepEqual(form.achievements, [], 'resume-wide achievements may be trimmed away');
});

test('an achievement the summary or a bullet already says is left off; one with a figure shown nowhere else stays', () => {
  // The case reported 2026-10-07 (CareDx): the resume's own Accomplishments kept under the rewrite.
  const source = {
    ...SOURCE,
    summary: 'Senior Full Stack Engineer delivering web, backend, mobile, and AI products, owning products from frontend and API design through backend infrastructure, monitoring, and production support.',
    achievements: [
      'Built full-stack AI applications using React/Next.js, Python/FastAPI, PostgreSQL, Redis, and LLM APIs.',
      'Shipped 20+ production iOS and macOS applications with 4M+ cumulative installs.',
      'Owned products from frontend and API design through backend infrastructure, CI/CD, monitoring, and production releases.',
      'Hackathon winner 2020',
    ],
  };
  const written = {
    ...WRITTEN,
    summary: source.summary,
    experience: [
      { ...WRITTEN.experience[0], achievements: [{ text: 'Built full-stack AI features with React, Next.js, Python, FastAPI, PostgreSQL, Redis and LLM APIs.', from: 0 }, { text: 'Shipped iOS and macOS applications to the App Store.', from: 1 }] },
      WRITTEN.experience[1],
    ],
    achievements: source.achievements,
  };
  const { form } = tailoredResumeForm(source, written);
  assert.deepEqual(form.achievements, ['Shipped 20+ production iOS and macOS applications with 4M+ cumulative installs.', 'Hackathon winner 2020']);
  const restored = withoutCuts(source, { ...form, achievements: [] }).form;
  assert.deepEqual(restored.achievements, form.achievements, 'putting the cuts back does not bring a repeat back');
});

test('a keyword the user declined to confirm stays out of the skills list, and so does a new skill no line of work backs', () => {
  const bare = tailoredResumeForm(SOURCE, WRITTEN).form;
  assert.deepEqual(bare.skills, ['Python', 'PostgreSQL'], "repeats collapse; the job's spelling of a skill is allowed; Kubernetes, in no bullet or summary, is a bare claim and comes off");
  const shown = { ...WRITTEN, summary: 'Senior data engineer with 8 years building Python data services on AWS and Kubernetes.' };
  const open = tailoredResumeForm(SOURCE, shown).form;
  assert.deepEqual(open.skills, ['Python', 'PostgreSQL', 'Kubernetes'], 'named in the summary, it stays');
  const blocked = tailoredResumeForm(SOURCE, shown, { blockedKeywords: ['Kubernetes'] }).form;
  assert.deepEqual(blocked.skills, ['Python', 'PostgreSQL']);
  const confirmed = tailoredResumeForm(SOURCE, WRITTEN, { confirmedKeywords: ['Kubernetes'] }).form;
  assert.ok(confirmed.skills.includes('Kubernetes'), 'what the user confirmed stays whether or not a line names it');
});

test('an empty or shapeless answer leaves the source resume standing', () => {
  for (const written of [null, {}, { experience: 'nope' }]) {
    const { form, pairedExperience } = tailoredResumeForm(SOURCE, written);
    assert.equal(pairedExperience, 0, 'which the caller treats as a failed attempt');
    assert.deepEqual(form.experience, cleanStructuredResume(SOURCE).experience);
    assert.equal(form.summary, SOURCE.summary);
    assert.deepEqual(form.skills, SOURCE.skills);
  }
});

test('entries pair by position when the model kept the count but mangled the names', () => {
  const written = {
    ...WRITTEN,
    experience: [
      { company: 'FO', title: 'x', period: '', achievements: [{ text: 'Defined the core data models shared by the billing and reporting services.', from: 1 }] },
      { company: 'FE', title: 'y', period: '', achievements: [{ text: 'Maintained the C# backend systems behind the state filing portal.', from: 0 }] },
    ],
  };
  const { form, pairedExperience } = tailoredResumeForm(SOURCE, written);
  assert.equal(pairedExperience, 2);
  assert.deepEqual(form.experience.map((e) => e.achievements[0]), ['Defined the core data models shared by the billing and reporting services.', 'Maintained the C# backend systems behind the state filing portal.']);
  assert.equal(form.experience[0].company, 'Northwind');
});

const role = (achievements) => ({ ...WRITTEN, experience: [{ company: 'Northwind', title: '', period: '', achievements }, WRITTEN.experience[1]] });

test('every bullet is traced to its source, and what changed is reported for review', () => {
  const { form, changes } = tailoredResumeForm(
    SOURCE,
    role([
      { text: 'Defined core data models.', from: 1 }, // the same words, moved up
      { text: 'Built AWS data services in Python.', from: 0 },
    ])
  );
  assert.deepEqual(form.experience[0].achievements, ['Defined core data models.', 'Built AWS data services in Python.']);
  assert.deepEqual(changes, [{ role: 0, kind: 'rewritten', before: 'Built data services on AWS.', after: 'Built AWS data services in Python.' }], 'a moved bullet is not a change');

  const trimmed = tailoredResumeForm(SOURCE, role([{ text: 'Built data services on AWS.', from: 0 }]));
  assert.deepEqual(trimmed.changes, [{ role: 0, kind: 'removed', before: 'Defined core data models.', after: '' }]);
});

test('a bullet from nowhere stands within the mode\'s allowance, listed as added; one that names a declined keyword never does', () => {
  const written = role([
    { text: 'Built data services on AWS.', from: 0 },
    { text: 'Led a platform migration to Kubernetes.', from: null },
    { text: 'Ran the quarterly planning for the platform group.', from: null },
  ]);
  // Balanced (the default) and score first take any number of new lines a role; looking real first takes one.
  const balanced = tailoredResumeForm(SOURCE, written);
  assert.deepEqual(balanced.form.experience[0].achievements, ['Built data services on AWS.', 'Led a platform migration to Kubernetes.', 'Ran the quarterly planning for the platform group.']);
  assert.deepEqual(
    balanced.changes.filter((c) => c.kind === 'added').map((c) => c.after),
    ['Led a platform migration to Kubernetes.', 'Ran the quarterly planning for the platform group.'],
    'each is listed on its own, so each can be taken out on its own'
  );
  const realistic = tailoredResumeForm(SOURCE, written, { style: 'realistic' });
  assert.deepEqual(realistic.form.experience[0].achievements, ['Built data services on AWS.', 'Led a platform migration to Kubernetes.'], 'one new line a role, the first');

  const declined = tailoredResumeForm(SOURCE, written, { blockedKeywords: ['Kubernetes'] });
  assert.ok(!declined.form.experience[0].achievements.some((b) => b.includes('Kubernetes')), 'a keyword the user switched off is never written in');

  const confirmed = tailoredResumeForm(SOURCE, written, { confirmedKeywords: ['Kubernetes'], style: 'realistic' });
  assert.deepEqual(confirmed.form.experience[0].achievements, ['Built data services on AWS.', 'Led a platform migration to Kubernetes.', 'Ran the quarterly planning for the platform group.'], 'a confirmed keyword\'s line is not counted against the allowance');
  assert.deepEqual(confirmed.changes.filter((c) => c.kind === 'added').map((c) => c.after), ['Led a platform migration to Kubernetes.', 'Ran the quarterly planning for the platform group.']);
});

test('a bullet that cites a source it does not resemble is put back as the resume said it, and stands beside it as a new line', () => {
  const { form, changes } = tailoredResumeForm(SOURCE, role([{ text: 'Managed vendor contracts and budgets.', from: 0 }, { text: 'Defined core data models.', from: 1 }]));
  assert.deepEqual(form.experience[0].achievements, ['Built data services on AWS.', 'Managed vendor contracts and budgets.', 'Defined core data models.']);
  assert.deepEqual(changes, [{ role: 0, kind: 'added', before: '', after: 'Managed vendor contracts and budgets.' }], 'an addition to review, not a rewrite of the bullet it cited');
});

test('a figure the resume never states does not survive, in a bullet or in the summary', () => {
  const written = { ...role([{ text: 'Built data services on AWS serving 2M users.', from: 0 }]), summary: 'Engineer with 8 years of experience who cut costs by 40%.' };
  const { form } = tailoredResumeForm(SOURCE, written);
  assert.deepEqual(form.experience[0].achievements, ['Built data services on AWS.'], 'the bullet is put back');
  assert.equal(form.summary, SOURCE.summary, 'and so is the summary');

  const told = tailoredResumeForm(SOURCE, written, { confirmedKeywords: [], evidence: [{ keyword: 'x', note: 'served 2M users and cut costs by 40%' }] });
  assert.deepEqual(told.form.experience[0].achievements, ['Built data services on AWS serving 2M users.'], 'a figure the user gave is theirs to state');
  assert.equal(tailoredResumeForm(SOURCE, { ...written, summary: 'Engineer with 8 years of experience.' }).form.summary, 'Engineer with 8 years of experience.', 'a tenure the resume supports stands');
});

test('a tenure the dates cannot reach, a figure off by a magnitude, or a certification the resume never names does not survive', () => {
  const summary = (text) => tailoredResumeForm(SOURCE, { ...role([{ text: 'Built data services on AWS.', from: 0 }]), summary: text }).form.summary;
  assert.equal(summary('Engineer with 30 years of experience.'), SOURCE.summary, 'the roles start in 2018');
  assert.equal(summary('Engineer who shipped an iOS app with 40M installs.'), SOURCE.summary, 'the resume says 40k');
  assert.equal(summary('Engineer who shipped an iOS app with 40,000 installs.'), 'Engineer who shipped an iOS app with 40,000 installs.', '40k is 40,000');
  assert.equal(summary('CKA-certified data engineer.'), SOURCE.summary, 'no Kubernetes certification in the resume');
  assert.equal(summary('AWS Certified data engineer.'), 'AWS Certified data engineer.', 'the resume lists an Amazon certification');
  assert.equal(summary('Data engineer working with S3, EC2 and k8s.'), 'Data engineer working with S3, EC2 and k8s.', 'a digit in a name is not a figure');
});

test('bullets that arrive as plain strings are traced by resemblance', () => {
  const { form, changes } = tailoredResumeForm(SOURCE, role(['Built AWS data services in Python.', 'An unrelated claim about sales.']));
  assert.deepEqual(form.experience[0].achievements, ['Built AWS data services in Python.', 'An unrelated claim about sales.']);
  assert.equal(changes.find((c) => c.kind === 'rewritten').before, 'Built data services on AWS.');
  assert.equal(changes.find((c) => c.kind === 'added').after, 'An unrelated claim about sales.', 'what resembles nothing is a new line, listed for review');
});

test('the prompt shows the whole resume without contact details, then the job', () => {
  const { system, user } = buildTailorPrompt({ form: SOURCE, job: JOB });
  assert.match(system, /never invent/i);
  assert.ok(!user.includes('jane@x.io') && !user.includes('Jane Doe') && !user.includes('(327)'), 'no contact details');
  for (const text of ['Defined core data models.', 'Recipe Box', 'BS Computer Science', 'Mentored students']) assert.ok(user.includes(text), text);
  assert.ok(user.indexOf('RESUME:') < user.indexOf('JOB_DESCRIPTION:'), 'the resume first, so the prefix is shared across jobs');
  assert.match(user, /"notFound":\["Kubernetes"\]/, 'the job skills the resume lacks are stated as fact');
  assert.ok(!user.includes('SCORER_NOTES:\n') && !user.includes('CANDIDATE_INSTRUCTIONS:\n'), 'optional sections are absent when empty');
});

test('keyword rules follow what the user was asked', () => {
  // The rules run to the next section of the prompt.
  const rules = (confirmedKeywords, assumedKeywords) =>
    buildTailorPrompt({ form: SOURCE, job: JOB, confirmedKeywords, assumedKeywords }).user.split('KEYWORD_RULES:\n')[1].split(/\n\n[A-Z_]+:\n/)[0];
  assert.match(rules(null), /already demonstrates it under another name/);
  assert.match(rules([]), /^Add no skill/);
  const left = rules([], ['Express', 'Jest']);
  assert.match(left, /has not said whether they have them: Express, Jest\./, 'keywords left to the rewrite are named');
  assert.match(left, /the candidate's existing work makes plausible/, 'added where the work makes it plausible');
  assert.match(left, /Leave out what belongs to a programming language, framework family, cloud or field RESUME shows no sign of/);
  assert.match(left, /Add no other skill/);
  assert.match(rules(['Kubernetes']), /confirmed real experience with:\n- Kubernetes\n.*Add no other skill/s);
  const said = buildTailorPrompt({ form: SOURCE, job: JOB, confirmedKeywords: ['Kubernetes'], evidence: [{ keyword: 'kubernetes', role: 1, note: 'ran the staging cluster' }] }).user;
  assert.ok(said.includes('- Kubernetes — used at Contoso, Software Consultant: "ran the staging cluster"'), 'where and how the user used it');
});

test("the scorer's findings and the user's instructions reach the prompt", () => {
  const { user } = buildTailorPrompt({
    form: SOURCE,
    job: JOB,
    scoring: { score: 61, tailoringOpportunities: ['AWS data services'], weakEvidence: [], missingRequirements: ['Kubernetes in production'], missingKeywords: ['Kubernetes'] },
    instructions: '  British spelling.  ',
  });
  assert.match(user, /SCORER_NOTES:\n\{"tailoringOpportunities":\["AWS data services"\],"missingRequirements":\["Kubernetes in production"\]\}/);
  assert.match(user, /CANDIDATE_INSTRUCTIONS:\nBritish spelling\.\n/);
});

test('an over-long resume gets shorter strings, never fewer bullets', () => {
  const long = { ...SOURCE, experience: [{ ...SOURCE.experience[0], achievements: Array.from({ length: 60 }, (_, i) => `Bullet ${i} ${'x'.repeat(450)}`) }] };
  const block = JSON.parse(resumeBlock(cleanStructuredResume(long)));
  assert.equal(block.experience[0].achievements.length, 60);
  assert.ok(block.experience[0].achievements.every((b, i) => b.i === i && b.text.length <= 260), 'each bullet carries its index');
});

test('the headline is written apart from the job title: its role gets specialties the resume shows', () => {
  const source = { ...SOURCE, title: 'Senior Software Engineer' };
  const sourceText = 'Senior Software Engineer. Built LLM agents and agentic systems on AI infrastructure with Kubernetes. Backend services in Python.';
  const job = { jobTitle: 'Machine Learning Engineer: Personalization', company: 'Acme', sourceText };
  const headline = (role, specialties = []) => resumeHeadline(source, { role, specialties }, job);

  assert.equal(headline('Senior AI Systems Engineer', ['LLMs', 'Agentic Systems', 'AI Infrastructure']), 'Senior AI Systems Engineer | LLMs · Agentic Systems · AI Infrastructure');
  assert.equal(headline('Senior AI / Machine Learning Engineer'), 'Senior AI / Machine Learning Engineer');
  assert.equal(resumeHeadline(source, { role: 'Senior ML Engineer', specialties: ['Recommender Systems'] }, { ...job, sourceText: 'Senior engineer. Built a recommendation service and ranking systems.' }), 'Senior ML Engineer | Recommender Systems', 'a word is matched by its stem');
  assert.equal(headline('Senior AI Systems Engineer', ['LLMs', 'Recommender Systems', 'Personalization', 'Kubernetes', 'Python']), 'Senior AI Systems Engineer | LLMs · Kubernetes · Python', 'a specialty the resume never shows is dropped, and three at most');

  // A role that copies the posting gives way to the resume's own title; the specialties stay.
  assert.equal(headline('Machine Learning Engineer: Personalization', ['LLMs']), 'Senior Software Engineer | LLMs');
  assert.equal(headline('Personalization Machine Learning Engineer'), 'Senior Software Engineer', "the title's qualifier");
  assert.equal(headline('Acme AI Engineer'), 'Senior Software Engineer', 'the company');
  assert.equal(headline('Staff AI Engineer'), 'Senior Software Engineer', 'a level the resume never states');
  assert.equal(resumeHeadline(source, { role: 'Senior Backend Engineer', specialties: [] }, { ...job, jobTitle: 'Software Engineer, Backend' }), 'Senior Backend Engineer', "a qualifier the resume shows is the candidate's own");
  assert.equal(resumeHeadline(source, null, job), 'Senior Software Engineer', "no headline is the resume's title");
  assert.equal(resumeHeadline({ title: 'Engineer | Go · Rust' }, { role: 'Engineer: Payments', specialties: ['Go'] }, job), 'Engineer | Go · Rust');
});

test("the job's keywords are split by what the resume text really contains", () => {
  const split = splitJobKeywords(['Python', 'Java', 'python', 'Kubernetes', '', null], 'Python and JavaScript on AWS');
  assert.deepEqual(split, { matchedKeywords: ['Python'], missingKeywords: ['Java', 'Kubernetes'] });
});

test('the tailor schema covers exactly the parts of the form tailoring may rewrite', () => {
  const resume = TAILOR_RESPONSE_FORMAT.json_schema.schema.properties.resume.properties;
  assert.deepEqual(Object.keys(resume).sort(), ['achievements', 'experience', 'otherSections', 'projects', 'skillGroups', 'skills', 'summary']);
  const form = cleanStructuredResume({});
  for (const key of Object.keys(resume)) assert.ok(key in form, `${key} is a form field`);
  assert.equal(Object.keys(TAILOR_RESPONSE_FORMAT.json_schema.schema.properties)[0], 'jobKeywords', 'the target is named before the rewrite');
});

test('what the user confirmed is always in the skills list, and filler sections never survive', () => {
  const written = { ...WRITTEN, skills: ['Python', 'Apache Airflow'], otherSections: [{ title: 'Interests', content: 'Climbing.' }] };
  const source = { ...SOURCE, otherSections: [{ title: 'Interests', content: 'Climbing, sourdough.' }] };
  const { form } = tailoredResumeForm(source, written, { confirmedKeywords: ['Airflow', 'dbt'] });
  assert.deepEqual(form.skills, ['Python', 'Apache Airflow', 'dbt'], 'a confirmed skill the model already listed is not repeated');
  assert.deepEqual(form.otherSections, []);
});

test('a finding about a keyword the user has since confirmed does not reach the prompt', () => {
  const { user } = buildTailorPrompt({
    form: SOURCE,
    job: JOB,
    confirmedKeywords: ['Kubernetes'],
    scoring: { missingRequirements: ['Kubernetes in production', 'Spark at scale'] },
  });
  assert.match(user, /SCORER_NOTES:\n\{"missingRequirements":\["Spark at scale"\]\}/);
  assert.match(user, /"notFound":\[\]/, 'and it counts as found among the job skills');
});

test('a cut bullet that speaks to the job is put back; one that does not stays cut', () => {
  const source = { ...SOURCE, experience: [{ ...SOURCE.experience[0], achievements: ['Built data services on AWS.', 'Designed SQL-backed data workflows.', 'Organised the office party.'] }, SOURCE.experience[1]] };
  const written = role([{ text: 'Built data services on AWS.', from: 0 }]);
  const { form, changes } = tailoredResumeForm(source, written, { protectedKeywords: ['SQL', 'Kubernetes'] });
  assert.deepEqual(form.experience[0].achievements, ['Built data services on AWS.', 'Designed SQL-backed data workflows.'], "the resume's only SQL evidence is not the model's to cut");
  assert.deepEqual(changes, [{ role: 0, kind: 'removed', before: 'Organised the office party.', after: '' }]);

  const merged = tailoredResumeForm(source, role([{ text: 'Built data services on AWS and designed SQL-backed data workflows.', from: 0 }]), { protectedKeywords: ['SQL'] });
  assert.equal(merged.form.experience[0].achievements.length, 1, 'a bullet merged into one that is still there is not said twice');
});

test('a rewrite that only swaps words is not a change; one that surfaces what the job asks for is', () => {
  const swapped = tailoredResumeForm(SOURCE, role([{ text: 'Built data services with AWS.', from: 0 }, { text: 'Defined core data models.', from: 1 }]), { protectedKeywords: ['Python'] });
  assert.deepEqual(swapped.form.experience[0].achievements, ['Built data services on AWS.', 'Defined core data models.'], 'the original stands');
  assert.deepEqual(swapped.changes, []);

  const surfaced = tailoredResumeForm(SOURCE, role([{ text: 'Built Python data services on AWS.', from: 0 }, { text: 'Defined core data models.', from: 1 }]), { protectedKeywords: ['Python'] });
  assert.deepEqual(surfaced.changes.map((c) => c.after), ['Built Python data services on AWS.']);
});

test('a rewrite that drops what the job asks for is refused: the original bullet stands', () => {
  const vaguer = role([{ text: 'Built cloud data services for internal teams.', from: 0 }, { text: 'Defined core data models.', from: 1 }]);
  const { form, changes } = tailoredResumeForm(SOURCE, vaguer, { protectedKeywords: ['AWS'] });
  assert.deepEqual(form.experience[0].achievements, ['Built data services on AWS.', 'Defined core data models.']);
  assert.deepEqual(changes, []);
  assert.equal(tailoredResumeForm(SOURCE, vaguer, { protectedKeywords: ['Go'] }).changes.length, 1, 'a keyword the bullet never had is not lost');
});

test('a skill the job names survives the trimming of the skills list', () => {
  const written = { ...WRITTEN, skills: ['Python'] };
  assert.deepEqual(tailoredResumeForm(SOURCE, written, { protectedKeywords: ['React', 'Go'] }).form.skills, ['Python', 'React']);
  assert.deepEqual(tailoredResumeForm(SOURCE, written).form.skills, ['Python']);
});

test('putting the cuts back keeps the rewording and restores everything that was dropped but skills', () => {
  const tailored = tailoredResumeForm(SOURCE, { ...role([{ text: 'Built AWS data services in Python.', from: 0 }]), skills: ['Python'], projects: [], achievements: [], otherSections: [] });
  assert.equal(tailored.changes.filter((c) => c.kind === 'removed').length, 1);
  const { form, changes } = withoutCuts(SOURCE, tailored.form, tailored.changes);
  assert.deepEqual(form.experience[0].achievements, ['Built AWS data services in Python.', 'Defined core data models.'], 'the rewrite stays, the cut line returns');
  assert.deepEqual(form.skills, ['Python'], 'the skills stay cut to what the job needs');
  assert.deepEqual(tailored.droppedSkills.map((d) => d.skill), ['Postgres', 'React', 'Photoshop'], 'and the ones cut are listed to put back');
  assert.deepEqual(form.projects.map((p) => p.name), ['Spam Radar', 'Recipe Box']);
  assert.deepEqual(form.achievements, SOURCE.achievements);
  assert.deepEqual(form.otherSections.map((o) => o.title), ['Volunteering']);
  assert.deepEqual(changes.map((c) => c.kind), ['rewritten'], 'and the list of changes no longer offers to put back what is back');
});

test('a keyword left to the rewrite may get a line of its own, but never a figure', () => {
  const written = role([
    { text: 'Built data services on AWS.', from: 0 },
    { text: 'Built the REST APIs behind the data services with Node.js and Express.', from: null },
    { text: 'Cut API latency by 40% with Express middleware.', from: null },
    { text: 'Led the migration to Kubernetes.', from: null },
  ]);
  const { form, changes } = tailoredResumeForm(SOURCE, written, { assumedKeywords: ['Express'], blockedKeywords: ['Kubernetes'] });
  assert.deepEqual(form.experience[0].achievements, ['Built data services on AWS.', 'Built the REST APIs behind the data services with Node.js and Express.', 'Defined core data models.']
    .filter((b) => form.experience[0].achievements.includes(b)));
  assert.ok(form.experience[0].achievements.includes('Built the REST APIs behind the data services with Node.js and Express.'), 'the plausible line is kept');
  assert.ok(!form.experience[0].achievements.some((b) => b.includes('40%')), 'a figure the resume never gave is not');
  assert.ok(!form.experience[0].achievements.some((b) => b.includes('Kubernetes')), 'nor a line for a keyword the user switched off');
  assert.deepEqual(changes.filter((c) => c.kind === 'added').map((c) => c.after), ['Built the REST APIs behind the data services with Node.js and Express.'], 'and it is listed, so it can be removed');
});

// ── the score-first style ─────────────────────────────────────────────────────

test('a style the client did not send, or one it made up, is the balanced one; each mode has its target and caps', async () => {
  const { TAILOR_MODES, tailorMode } = await import('./index.js');
  assert.deepEqual(TAILOR_STYLES, ['ats', 'balanced', 'realistic']);
  assert.equal(tailorStyle(undefined), 'balanced');
  assert.equal(tailorStyle('bold'), 'balanced');
  assert.equal(tailorStyle('ats'), 'ats');
  assert.equal(tailorStyle('realistic'), 'realistic');
  assert.deepEqual(Object.values(TAILOR_MODES).map((m) => m.target), [95, 90, 80]);
  assert.deepEqual(Object.values(TAILOR_MODES).map((m) => m.gapPasses), [4, 3, 2]);
  assert.deepEqual(Object.values(TAILOR_MODES).map((m) => m.maxAssumedTerms), [12, 8, 4]);
  assert.equal(tailorMode('nonsense'), TAILOR_MODES.balanced);
  assert.equal(TAILOR_MODES.ats.preferredGaps, true, 'only score first counts a nice-to-have as a gap');
  assert.equal(TAILOR_MODES.realistic.newBulletsPerRole, 1);
});

test('each mode has its STYLE section: score first writes in every keyword left to it, the others the plausible ones by their bar', () => {
  const prompt = (style) => buildTailorPrompt({ form: SOURCE, job: JOB, confirmedKeywords: [], assumedKeywords: ['Kubernetes', 'Go'], optionalKeywords: ['Jest'], style }).user;
  const ats = prompt('ats');
  assert.match(ats, /has not said whether they have them: Kubernetes, Go\.\nAdd every one of them/);
  assert.match(ats, /STYLE — score first:\n/);
  assert.match(ats, /scores above 95/);
  assert.match(ats, /employers, job titles, dates, degrees and certifications stay exactly as RESUME has them, and no number/, 'the hard limits are restated where the style is');
  assert.match(ats, /nice to have, and the candidate has not said whether they have them: Jest\./, 'a nice-to-have is added where plausible, even for the score');
  assert.match(ats, /up to 6 bullets get a realistic number/);
  const balanced = prompt('balanced');
  assert.match(balanced, /STYLE — balanced:\n/);
  assert.match(balanced, /scores above 90/);
  assert.match(balanced, /has not said whether they have them: Kubernetes, Go\.\nAdd the ones the candidate's existing work makes plausible, and lean towards adding/);
  assert.match(balanced, /a tool that lives inside a stack RESUME already shows/);
  assert.doesNotMatch(balanced, /Add every one of them/);
  assert.match(balanced, /Employers, job titles, dates, degrees and certifications stay exactly as RESUME has them/);
  const realistic = prompt('realistic');
  assert.match(realistic, /STYLE — looks real first:\n/);
  assert.match(realistic, /scores above 80/);
  assert.match(realistic, /Add only the ones the candidate's existing work makes plausible by the bar below; when unsure, leave it out/);
  assert.match(realistic, /nearly names already/);
  assert.match(realistic, /at most one new bullet/);
  assert.match(realistic, /up to 4 bullets get a realistic number/);
  for (const [style, sentences] of [
    [ats, '4-5 sentences'],
    [balanced, '3-4 sentences'],
    [realistic, '3-4 sentences'],
  ]) {
    assert.match(style, new RegExp(`summary: ${sentences} and at least 40 words`), 'the summary has a floor');
    assert.match(style, /never shorter than RESUME's summary/);
  }
});

const scoreFirst = (written) => tailoredResumeForm(SOURCE, written, { assumedKeywords: ['Kubernetes'], style: 'ats' });

test('score first lets a line stand that names no keyword, listed as added; a figure the resume never gave still does not', () => {
  const written = role([
    { text: 'Built data services on AWS.', from: 0 },
    { text: 'Mentored the engineers who joined the platform group.', from: null },
    { text: 'Ran the Kubernetes cluster the data services deploy to.', from: null },
    { text: 'Cut pipeline costs by 30% on Kubernetes.', from: null },
    { text: 'Defined core data models.', from: 1 },
  ]);
  const { form, changes } = scoreFirst(written);
  assert.deepEqual(form.experience[0].achievements, [
    'Built data services on AWS.',
    'Mentored the engineers who joined the platform group.',
    'Ran the Kubernetes cluster the data services deploy to.',
    'Defined core data models.',
  ]);
  assert.deepEqual(
    changes.filter((c) => c.kind === 'added').map((c) => c.after),
    ['Mentored the engineers who joined the platform group.', 'Ran the Kubernetes cluster the data services deploy to.'],
    'each added line is listed on its own, so each can be taken out on its own'
  );
  const more = role([...written.experience[0].achievements, { text: 'Ran the quarterly planning for the platform group.', from: null }]);
  const cautious = tailoredResumeForm(SOURCE, more, { assumedKeywords: ['Kubernetes'], style: 'realistic' });
  assert.ok(cautious.form.experience[0].achievements.some((b) => b.includes('Mentored')), 'looking real first keeps one line from nowhere a role');
  assert.ok(!cautious.form.experience[0].achievements.some((b) => b.includes('quarterly planning')), 'and drops the second');
  assert.ok(cautious.form.experience[0].achievements.some((b) => b.includes('Kubernetes cluster')), "a line for an assumed keyword is not counted against the role's one");
});

test('score first still traces a bullet by resemblance, and keeps the source beside a line that cites it without resembling it', () => {
  const traced = scoreFirst(role(['Built AWS data services in Python.', 'Defined core data models.']));
  assert.deepEqual(traced.changes.map((c) => c.kind), ['rewritten'], 'a plain-string answer is not a pile of additions and removals');

  const { form, changes } = scoreFirst(role([{ text: 'Mentored the engineers who joined the platform group.', from: 0 }, { text: 'Defined core data models.', from: 1 }]));
  assert.deepEqual(form.experience[0].achievements, ['Built data services on AWS.', 'Mentored the engineers who joined the platform group.', 'Defined core data models.'], 'nothing the resume said is lost');
  assert.deepEqual(changes, [{ role: 0, kind: 'added', before: '', after: 'Mentored the engineers who joined the platform group.' }]);
});

test("score first moves no fact: employers, titles, dates, education and contact stay the source's", () => {
  const { form } = tailoredResumeForm(SOURCE, WRITTEN, { assumedKeywords: ['Kubernetes'], style: 'ats' });
  assert.equal(form.experience.length, 2, 'an employer the resume does not have is still left out');
  assert.deepEqual(
    form.experience.map((e) => [e.company, e.title, e.period]),
    SOURCE.experience.map((e) => [e.company, e.title, e.period])
  );
  for (const field of ['name', 'email', 'education', 'certifications']) assert.deepEqual(form[field], cleanStructuredResume(SOURCE)[field], field);
  assert.equal(tailoredResumeForm(SOURCE, { ...WRITTEN, summary: 'Cut costs by 40%.' }, { style: 'ats' }).form.summary, SOURCE.summary, 'nor a figure in the summary');
});

test('the repair round flags only lines the model wrote, and only for what reads badly', () => {
  const written = { ...role([{ text: 'Leveraged Python to build robust data services on AWS.', from: 0 }, { text: 'Defined core data models.', from: 1 }]), summary: 'Results-driven engineer with 8 years of experience building data services.' };
  const tailored = tailoredResumeForm(SOURCE, written);
  const targets = repairTargets(tailored, SOURCE);
  assert.deepEqual(targets.map((t) => [t.id, t.role, t.text]), [
    [0, null, 'Results-driven engineer with 8 years of experience building data services.'],
    [1, 0, 'Leveraged Python to build robust data services on AWS.'],
  ]);
  assert.match(targets[1].problems[0], /"leveraged", "robust"/);
  const { user } = buildRepairPrompt(targets);
  assert.ok(!user.includes('Defined core data models.'), 'an untouched line is never sent');
  assert.ok(!user.includes('jane@x.io'), 'nor contact details');

  const unchanged = tailoredResumeForm(SOURCE, { ...role([{ text: 'Built data services on AWS.', from: 0 }]), summary: SOURCE.summary });
  assert.deepEqual(repairTargets(unchanged, SOURCE), [], 'nothing flagged, no call');
});

test('the repair round flags a summary that says too little, with the mode\'s length, and a sentence of it that lists tools', () => {
  const short = tailoredResumeForm(SOURCE, { ...role([{ text: 'Built data services on AWS.', from: 0 }]), summary: 'Senior data engineer with 8 years building Python data services on AWS.' });
  const [target] = repairTargets(short, SOURCE);
  assert.equal(target.role, null);
  assert.match(target.problems[0], /it is 1 sentence and 12 words; a summary is 3-4 sentences and at least 40 words/);
  assert.match(repairTargets(short, SOURCE, { style: 'ats' })[0].problems[0], /4-5 sentences/);
  assert.match(buildRepairPrompt([target], { style: 'ats' }).user, /The summary is 4-5 sentences and at least 40 words/);
  assert.match(buildRepairPrompt([target]).user, /The summary is 3-4 sentences/);

  const listed = tailoredResumeForm(SOURCE, {
    ...role([{ text: 'Built data services on AWS.', from: 0 }]),
    // Two sentences keep their list sentence (summary.js) so the repair round can make it a sentence about work.
    summary: 'Senior data engineer with 8 years building Python data services on AWS for a telecom analytics product. Experienced with Python, AWS, Postgres, React, Docker, Spark, Kafka, and Terraform.',
  });
  const [list] = repairTargets(listed, SOURCE);
  assert.match(list.problems[0], /^"Experienced with Python, AWS, Postgres, React, Docker, Spark, Kafka, and Terrafo" reads as a list of tools/, 'the sentence, not the whole summary');
  assert.match(list.problems[1], /it is 2 sentences and 28 words/);
  assert.equal(list.problems.length, 2, 'a summary is not held to a bullet\'s length');
  const long = tailoredResumeForm(SOURCE, {
    ...role([{ text: 'Built data services on AWS.', from: 0 }]),
    summary: 'Senior data engineer with 8 years building Python data services on AWS for a telecom analytics product. Designs the data models and services behind the analytics products, from ingestion through the APIs that serve them. Known for the data models that the whole analytics team builds on, and for keeping them simple.',
  });
  assert.deepEqual(repairTargets(long, SOURCE), [], 'three sentences past 200 characters is a summary, not a problem');

  // A longer summary with the problem gone is better; one that merely rewords it is not.
  const fixed = applyRepairs(short, [target], { lines: [{ id: 0, text: 'Senior data engineer with 8 years building Python data services on AWS. Designs the data models and services behind analytics products, from ingestion through the APIs that serve them. Works across AWS, Python and Postgres on production systems the business uses daily.' }] });
  assert.equal(fixed.repaired, 1);
  const reworded = applyRepairs(short, [target], { lines: [{ id: 0, text: 'Senior data engineer, 8 years of Python data services on AWS.' }] });
  assert.equal(reworded.repaired, 0, 'still one sentence: no better');
});

test('the repair round flags a line that lists tools and one that repeats a requirement of the posting', async () => {
  const { copiedRequirement } = await import('./index.js');
  const requirements = [
    { text: 'Experience leading incident response processes and driving meaningful postmortem outcomes' },
    { text: 'Strong experience building and maintaining Terraform modules across large cloud environments' },
  ];
  assert.equal(copiedRequirement('Led incident response processes and drove postmortem outcomes across the data platform.', requirements), requirements[0].text);
  assert.equal(copiedRequirement('Wrote Terraform modules for the data platform on AWS.', requirements), null, 'two words of a requirement are its term, not its sentence');
  assert.equal(copiedRequirement('Has experience with the design of data services.', ['Experience with the design of distributed systems']), null, 'a run of small words is not a copy');

  const list = 'Containerized and deployed services using Docker, Terraform modules, Kubernetes, EKS, Argo CD, AWS, GitHub Actions, Bash, CI/CD pipelines, cloud infrastructure, and observability tooling.';
  const copy = 'Led incident response processes and drove postmortem outcomes across the data platform.';
  const tailored = tailoredResumeForm(SOURCE, role([{ text: list, from: 0 }, { text: copy, from: 1 }]), { style: 'ats' });
  const targets = repairTargets(tailored, SOURCE, { requirements });
  const problemsOf = (text) => targets.find((t) => t.text === text)?.problems || [];
  assert.match(problemsOf(list).join(' '), /list of tools/);
  assert.match(problemsOf(copy).join(' '), /repeats the posting's wording/);
  assert.deepEqual(repairTargets(tailored, SOURCE).filter((t) => t.text === copy), [], 'without the requirements, a copy cannot be told');
});

test("every mode sees the scorer's verdict on every unmet requirement, measured ones marked; only score first sees the nice-to-haves", () => {
  const scoring = {
    requirements: [
      { text: '8+ years in DevOps', kind: 'experience', priority: 'required', verdict: 'weak' },
      { text: 'Improve cloud cost efficiency without sacrificing reliability', kind: 'responsibility', priority: 'required', verdict: 'missing' },
      { text: 'Deep hands-on expertise with AWS', kind: 'experience', priority: 'required', verdict: 'met' },
      { text: 'Familiarity with Argo CD', kind: 'skill', priority: 'preferred', verdict: 'missing' },
    ],
  };
  const ats = buildTailorPrompt({ form: SOURCE, job: JOB, style: 'ats', confirmedKeywords: [], scoring }).user;
  assert.match(ats, /REQUIREMENT_VERDICTS:\n- \[required experience\] 8\+ years in DevOps — weak\n- \[required responsibility, measured\] Improve cloud cost efficiency without sacrificing reliability — missing\n- \[preferred skill\] Familiarity with Argo CD — missing/);
  assert.doesNotMatch(ats, /Deep hands-on expertise with AWS — met/);
  for (const style of ['balanced', 'realistic', undefined]) {
    const user = buildTailorPrompt({ form: SOURCE, job: JOB, style, confirmedKeywords: [], scoring }).user;
    assert.match(user, /REQUIREMENT_VERDICTS:\n- \[required experience\] 8\+ years in DevOps — weak\n- \[required responsibility, measured\] Improve cloud cost efficiency without sacrificing reliability — missing\n\n/, String(style));
    assert.doesNotMatch(user, /Argo CD — missing/, `${style}: a nice-to-have is not a gap`);
  }
  assert.doesNotMatch(buildTailorPrompt({ form: SOURCE, job: JOB, style: 'ats', confirmedKeywords: [], scoring: { requirements: [] } }).user, /REQUIREMENT_VERDICTS:\n/);

  // The retry is told why each line fell short, so it fixes the line rather than writing another.
  const second = buildTailorPrompt({
    form: SOURCE,
    job: JOB,
    style: 'ats',
    confirmedKeywords: [],
    scoring: {
      requirements: [
        { text: 'Measurable improvement of DORA metrics', kind: 'experience', priority: 'required', verdict: 'weak', quote: 'CI/CD' },
        { text: 'Database performance tuning', kind: 'experience', priority: 'required', verdict: 'weak', quote: 'Tuned PostgreSQL and Redis workflows for low-latency services' },
        { text: 'Deep AWS expertise', kind: 'experience', priority: 'required', verdict: 'weak', quote: 'AWS, PostgreSQL, Redis, Docker, CI/CD, GitHub Actions, monitoring, and production support' },
      ],
    },
  }).user;
  assert.match(second, /DORA metrics — weak: the scorer found only "CI\/CD", a bare term, not a line of work; and no figure/);
  assert.match(second, /Database performance tuning — weak: the line states no figure/);
  assert.match(second, /Deep AWS expertise — weak: the line it found only lists tools/);
});

test('the gap pass asks one line per requirement still open, and merges the lines that pass the same checks as a rewrite', async () => {
  const { applyGapLines, buildGapPrompt } = await import('./index.js');
  const tailored = tailoredResumeForm(SOURCE, role([{ text: 'Built Python data services on AWS.', from: 0 }, { text: 'Defined core data models.', from: 1 }]), { protectedKeywords: ['Python'] });
  const scoring = {
    requirements: [
      { text: 'Measurable improvement of pipeline latency', kind: 'experience', priority: 'required', verdict: 'weak', quote: 'Built Python data services on AWS.' },
      { text: 'Deep AWS expertise', kind: 'experience', priority: 'required', verdict: 'met', quote: 'Built Python data services on AWS.' },
      { text: 'Lead incident response and drive postmortem outcomes', kind: 'responsibility', priority: 'required', verdict: 'missing' },
      { text: 'Reduce cloud cost without sacrificing reliability', kind: 'responsibility', priority: 'required', verdict: 'missing' },
    ],
  };
  const prompt = buildGapPrompt({ tailoredForm: tailored.form, scoring, job: JOB });
  assert.deepEqual(prompt.open.map((o) => o.id), [0, 2, 3], 'the met one is not asked for');
  assert.match(prompt.user, /0\. \[required experience, measured\] Measurable improvement of pipeline latency — weak: the line states no figure/);
  assert.match(prompt.user, /"bullets":\[\{"i":0,"text":"Built Python data services on AWS\."\}/);
  assert.equal(buildGapPrompt({ tailoredForm: tailored.form, scoring: { requirements: [{ text: 'x', verdict: 'met' }] } }), null);
  assert.doesNotMatch(prompt.user, /FIGURES ALREADY STATED/);
  const withFigures = buildGapPrompt({ tailoredForm: tailored.form, scoring, job: JOB, estimates: [{ role: 0, text: 't', plain: 'p', clause: 'cutting deployment lead time by ~20%' }] });
  assert.match(withFigures.user, /FIGURES ALREADY STATED[^\n]*\n- cutting deployment lead time by ~20%/);

  const answer = {
    lines: [
      { id: 0, role: 0, from: 0, text: 'Built Python data services on AWS, cutting pipeline latency by ~20%.', estimate: ', cutting pipeline latency by ~20%' },
      { id: 2, role: 0, from: null, text: 'Ran incident response for the data services and wrote up the postmortems that followed.', estimate: '' },
      { id: 3, role: 0, from: null, text: 'Cut cloud spend for the data services by rightsizing AWS instances, saving $60k a year.', estimate: '' },
      { id: 2, role: 0, from: null, text: 'A second line for a gap already answered.', estimate: '' },
      { id: 5, role: 0, from: null, text: 'Worked with AWS, Terraform, Kubernetes, Docker, Datadog, Kafka, and Bash.', estimate: '' },
      { id: 6, role: 0, from: 1, text: 'Defined core data models for 3M users.', estimate: '' },
      { id: 7, role: 9, from: null, text: 'A role the resume does not have.', estimate: '' },
    ],
  };
  const merged = applyGapLines(tailored, SOURCE, answer, { protectedKeywords: ['Python'], requirements: scoring.requirements });
  assert.equal(merged.applied, 2, 'the figure line and the incident line; a dollar figure, a repeat, a tool list, an invented count and a bad role are dropped');
  const tenure = applyGapLines(
    tailored,
    SOURCE,
    {
      lines: [
        { id: 0, role: 0, from: null, text: 'Supported AWS infrastructure across more than eight years of software engineering.', estimate: '' },
        { id: 1, role: 0, from: null, text: 'Ran the data platform on AWS.', estimate: '' },
      ],
    },
    { requirements: [{ text: 'Pipeline latency' }, { text: '8+ years in DevOps or infrastructure engineering' }] }
  );
  assert.equal(tenure.applied, 0, 'a line stating a tenure, and a line for a years requirement, are not taken');
  const credential = applyGapLines(
    tailored,
    SOURCE,
    {
      lines: [
        { id: 0, role: 0, from: null, text: 'Completed advanced graduate-level study in computer science focused on data systems.', estimate: '' },
        { id: 1, role: 0, from: null, text: 'Applied Azure data-engineering practices across Data Factory and Databricks.', estimate: '' },
        { id: 2, role: 0, from: null, text: 'Ran the data platform on AWS after an AWS certification.', estimate: '' },
      ],
    },
    { requirements: [{ text: 'Advanced degree preferred', kind: 'education' }, { text: 'Certifications such as DP-203', kind: 'education' }, { text: 'AWS', kind: 'experience' }] }
  );
  assert.equal(credential.applied, 0, 'an education gap is never written, and a line claiming a credential is not taken for any gap');
  const invented = tailoredResumeForm(SOURCE, role([{ text: 'Built data services on AWS.', from: 0 }, { text: 'Completed a Kubernetes certification for the platform work.', from: null }]), { style: 'ats' });
  assert.deepEqual(invented.form.experience[0].achievements, ['Built data services on AWS.'], 'nor does the rewrite add one (the untouched bullet is cut as irrelevant, as with no job keywords it is)');
  assert.deepEqual(
    merged.form.experience[0].achievements,
    ['Built Python data services on AWS, cutting pipeline latency by ~20%.', 'Ran incident response for the data services and wrote up the postmortems that followed.', 'Defined core data models.'],
    'a new line goes in after the last bullet tailoring touched, before the ones left as they were'
  );
  assert.deepEqual(merged.estimates, [{ role: 0, text: 'Built Python data services on AWS, cutting pipeline latency by ~20%.', plain: 'Built Python data services on AWS.', clause: 'cutting pipeline latency by ~20%' }]);
  assert.equal(merged.changes.find((c) => c.kind === 'rewritten').after, 'Built Python data services on AWS, cutting pipeline latency by ~20%.', 'the existing change record follows the extended line');
  assert.equal(merged.changes.find((c) => c.kind === 'rewritten').before, 'Built data services on AWS.');
  assert.equal(merged.changes.filter((c) => c.kind === 'added').length, 1);
  assert.deepEqual(tailored.form.experience[0].achievements, ['Built Python data services on AWS.', 'Defined core data models.'], 'the tailoring handed in is not changed');
});

test('a summary sentence that only lists tools comes out, unless it is the source\'s own; a draft of nothing but lists gives way', async () => {
  const { summaryWithoutLists } = await import('./index.js');
  const source = 'Senior Full Stack Engineer with 10+ years delivering web products. Expert in React, Next.js, TypeScript, Node.js, Python, PostgreSQL, Redis, GraphQL, and cloud infrastructure.';
  const draft = 'Senior Full Stack Engineer with 10+ years delivering web products. Experienced with AWS, Kubernetes, Terraform, EKS, Argo CD, GitHub Actions, Datadog, Python, and Kafka across production services. Owns features from API design through CI/CD, monitoring and production support.';
  assert.equal(summaryWithoutLists(draft, source), 'Senior Full Stack Engineer with 10+ years delivering web products. Owns features from API design through CI/CD, monitoring and production support.');
  assert.equal(summaryWithoutLists(source, source), source, "the source's own list sentence is the candidate's");
  const dotted = 'Senior engineer with 10+ years. Built production web applications with React, TypeScript and Next.js on Node.js services. Owns features end to end.';
  assert.equal(summaryWithoutLists(dotted, 'x'), dotted, '"Next.js" and "Node.js" are not sentence ends');
  const twoSentences = 'Senior engineer with 10+ years. Experienced with React, Next.js, Node.js, TypeScript, GraphQL, AWS, Docker, and CI/CD.';
  assert.equal(summaryWithoutLists(twoSentences, 'x'), twoSentences, 'a cut that would leave one sentence is not made: the repair round is asked to make the list a sentence about work');
  assert.equal(summaryWithoutLists('AWS, Kubernetes, Terraform, EKS, Argo CD, Datadog, Kafka, and Bash.', source), source);
  const listed = `${SOURCE.summary} Worked with AWS, Kubernetes, Terraform, EKS, Argo CD, Datadog, Kafka, and Bash.`;
  const { form } = tailoredResumeForm(SOURCE, { ...WRITTEN, summary: listed });
  assert.equal(form.summary, listed, 'two sentences keep the list sentence for the repair round rather than fall to one');
  const three = tailoredResumeForm(SOURCE, { ...WRITTEN, summary: `${listed} Owns data models end to end.` });
  assert.equal(three.form.summary, `${SOURCE.summary} Owns data models end to end.`, 'with a third sentence the list goes');
});

test('the same estimated figure is not given twice in a role, by the rewrite or by the gap pass', async () => {
  const { applyGapLines } = await import('./index.js');
  const twice = tailoredResumeForm(
    SOURCE,
    role([
      { text: 'Built data services on AWS, cutting query latency by ~20%.', from: 0, estimate: ', cutting query latency by ~20%' },
      { text: 'Defined core data models, cutting query latency by ~20%.', from: 1, estimate: ', cutting query latency by ~20%' },
    ])
  );
  assert.deepEqual(twice.form.experience[0].achievements, ['Built data services on AWS, cutting query latency by ~20%.', 'Defined core data models.'], 'the second carries no figure, so the original stands');
  assert.equal(twice.estimates.length, 1);
  const acrossRoles = tailoredResumeForm(SOURCE, {
    ...WRITTEN,
    experience: [
      { company: 'Northwind', title: '', period: '', achievements: [{ text: 'Built data services on AWS, cutting query latency by ~20%.', from: 0, estimate: ', cutting query latency by ~20%' }] },
      { company: 'Contoso', title: '', period: '', achievements: [{ text: 'Maintained backend systems in C#, cutting query latency by ~20%.', from: 0, estimate: ', cutting query latency by ~20%' }] },
    ],
  });
  assert.deepEqual(acrossRoles.form.experience[1].achievements, ['Maintained backend systems in C#.'], 'nor under another employer');
  assert.equal(acrossRoles.estimates.length, 1);
  const gap = applyGapLines(twice, SOURCE, { lines: [{ id: 0, role: 0, from: 1, text: 'Defined core data models for the billing pipeline, cutting query latency by ~20%.', estimate: 'cutting query latency by ~20%' }] }, {});
  assert.equal(gap.form.experience[0].achievements[1], 'Defined core data models for the billing pipeline.', 'the repeated figure comes off and the line stands without it');
  assert.equal(gap.estimates.length, 1);

  // Extending the bullet that carries the estimate keeps the estimate, moves its record to the new text, and takes no second figure.
  const extended = applyGapLines(
    twice,
    SOURCE,
    { lines: [{ id: 0, role: 0, from: 0, text: 'Built data services on AWS with Terraform, cutting query latency by ~20%, and halving costs by ~30%.', estimate: 'halving costs by ~30%' }] },
    {}
  );
  assert.equal(extended.applied, 1);
  assert.equal(extended.form.experience[0].achievements[0], 'Built data services on AWS with Terraform, cutting query latency by ~20%.');
  assert.deepEqual(extended.estimates, [{ role: 0, text: 'Built data services on AWS with Terraform, cutting query latency by ~20%.', plain: 'Built data services on AWS with Terraform.', clause: 'cutting query latency by ~20%' }]);
});

test('a line that shares most of a requirement\'s words in any order is a copy too, and skill gaps are listed after the requirements', async () => {
  const { copiedRequirement, buildGapPrompt } = await import('./index.js');
  const req = 'Track record of taking a scoped infrastructure project from an ambiguous starting point to production without needing daily direction';
  assert.equal(copiedRequirement('Built internal platforms for scoped projects, taking ambiguous requirements through production without daily direction.', [req]), req);
  assert.equal(copiedRequirement('Moved the ingestion pipeline to Kubernetes on my own, from scoping to production.', [req]), null);
  assert.equal(
    copiedRequirement('Led production incident response across frontend, backend, data, and infrastructure services, maintaining SLO and SLA targets while reducing incident frequency by ~15% and duration by ~20%.', [
      'Maintain or exceed defined SLO/SLA targets with reduced incident frequency and duration',
    ]),
    null,
    "a bullet twice the requirement's length that uses its terms around real work is the translation asked for"
  );
  const prompt = buildGapPrompt({
    tailoredForm: cleanStructuredResume(SOURCE),
    scoring: { requirements: [{ text: 'Deep AWS expertise', verdict: 'met' }], requiredSkillVerdicts: [{ skill: 'Python', verdict: 'met' }, { skill: 'EKS', verdict: 'weak' }, { skill: 'Bash', verdict: 'missing' }] },
  });
  assert.deepEqual(prompt.open, [
    { id: 2, line: '[required skill] EKS — weak: listed under skills, not shown in a line of work' },
    { id: 3, line: '[required skill] Bash — missing' },
  ]);
});

test("the prompts carry the field's notes for the job's category, between the job data and the posting; a pasted job gets the general note", async () => {
  const { buildGapPrompt } = await import('./index.js');
  const devops = { ...JOB, category: 'devops', subcategory: 'sre' };
  const { user } = buildTailorPrompt({ form: SOURCE, job: devops });
  const at = (s) => user.indexOf(s);
  assert.ok(at('JOB_JSON:') < at('FIELD_NOTES (DevOps / SRE):') && at('FIELD_NOTES (DevOps / SRE):') < at('JOB_DESCRIPTION:'));
  assert.match(user, /error-budget burn/);
  assert.match(buildTailorPrompt({ form: SOURCE, job: { title: 'Pasted', description: 'x' } }).user, /FIELD_NOTES \(Software engineering\):/);
  const gap = buildGapPrompt({ tailoredForm: cleanStructuredResume(SOURCE), scoring: { requirements: [{ text: 'SLO attainment', verdict: 'missing' }] }, job: devops });
  assert.match(gap.user, /FIELD_NOTES \(DevOps \/ SRE\):[\s\S]*Rules:/);
});

test('score first forces in what is required and treats a nice-to-have as plausible-only; a preferred requirement is not a gap', async () => {
  const { buildGapPrompt } = await import('./index.js');
  const { user } = buildTailorPrompt({ form: SOURCE, job: JOB, style: 'ats', confirmedKeywords: [], assumedKeywords: ['Kubernetes'], optionalKeywords: ['Terraform', 'Datadog'] });
  assert.match(user, /The job requires these[^\n]*: Kubernetes\.\nAdd every one of them/);
  assert.match(user, /The job lists these as nice to have[^\n]*: Terraform, Datadog\.\nAdd the ones the candidate's existing work makes plausible/);
  const gap = buildGapPrompt({
    tailoredForm: cleanStructuredResume(SOURCE),
    scoring: { requirements: [{ text: 'Required thing', priority: 'required', verdict: 'missing' }, { text: 'Nice thing', priority: 'preferred', verdict: 'missing' }] },
  });
  assert.deepEqual(gap.open.map((o) => o.id), [0]);
});

test('a line that brings in more than two assumed terms, or takes a role past eight, is refused; figures are kept apart', async () => {
  const { applyGapLines } = await import('./index.js');
  const assumed = ['Terraform', 'Kubernetes', 'EKS', 'Argo CD', 'Datadog', 'Kafka', 'Bash', 'Helm', 'Vault', 'Consul'];
  const dense = tailoredResumeForm(SOURCE, role([{ text: 'Built data services on AWS with Terraform, Kubernetes, EKS, Argo CD and Datadog.', from: 0 }, { text: 'Defined core data models in Terraform and Kubernetes.', from: 1 }]), {
    assumedKeywords: assumed,
    style: 'ats',
  });
  assert.deepEqual(dense.form.experience[0].achievements, ['Built data services on AWS.', 'Defined core data models in Terraform and Kubernetes.'], 'five new terms in one line: the source bullet stands; two: the rewrite stands');

  const base = tailoredResumeForm(SOURCE, role([{ text: 'Built data services on AWS with Terraform and Kubernetes.', from: 0 }, { text: 'Defined core data models on EKS with Argo CD.', from: 1 }]), { assumedKeywords: assumed, style: 'ats' });
  const gap = applyGapLines(
    base,
    SOURCE,
    {
      lines: [
        { id: 0, role: 0, from: null, text: 'Monitored the data services with Datadog, Kafka and Bash alerts.', estimate: '' },
        { id: 1, role: 0, from: null, text: 'Monitored the data services with Datadog and Kafka alerts.', estimate: '' },
        { id: 2, role: 0, from: null, text: 'Packaged the services with Helm and Vault.', estimate: '' },
        { id: 3, role: 0, from: null, text: 'Registered the services in Consul.', estimate: '' },
      ],
    },
    { assumedKeywords: assumed }
  );
  assert.equal(gap.applied, 2, 'three terms in one line is refused; two and two are taken; the ninth term for the role is refused');

  const spaced = tailoredResumeForm(
    SOURCE,
    role([
      { text: 'Built data services on AWS, cutting query latency by ~20%.', from: 0, estimate: ', cutting query latency by ~20%' },
      { text: 'Defined core data models, cutting modelling time by ~30%.', from: 1, estimate: ', cutting modelling time by ~30%' },
    ])
  );
  assert.deepEqual(spaced.form.experience[0].achievements, ['Built data services on AWS, cutting query latency by ~20%.', 'Defined core data models.'], 'no figure on the bullet after one with a figure');
  const beside = applyGapLines(spaced, SOURCE, { lines: [{ id: 0, role: 0, from: 1, text: 'Defined core data models for billing, cutting modelling time by ~30%.', estimate: 'cutting modelling time by ~30%' }] }, {});
  assert.equal(beside.form.experience[0].achievements[1], 'Defined core data models for billing.', 'the gap pass keeps figures apart too');
});

test('the prompt says to translate work into the job\'s terms, not to paste its sentences or list its tools', () => {
  const { user } = buildTailorPrompt({ form: SOURCE, job: JOB, style: 'ats', confirmedKeywords: [], assumedKeywords: ['Kubernetes'] });
  assert.match(user, /Translate, never paste/);
  assert.match(user, /A skill is a name, not a phrase of one/);
  assert.match(user, /at most 3 of them to a bullet/, "score first's cap on terms a bullet takes");
  assert.match(buildTailorPrompt({ form: SOURCE, job: JOB, style: 'balanced', confirmedKeywords: [], assumedKeywords: ['Kubernetes'] }).user, /At most two of the job's tools new to a bullet/);
  assert.match(user, /stays as RESUME states it/);
});

test('a repair stands only when it is better and no less true', () => {
  const written = { ...role([{ text: 'Leveraged Python to build robust data services on AWS.', from: 0 }]), summary: 'Results-driven engineer with 8 years of experience building data services.' };
  const tailored = tailoredResumeForm(SOURCE, written);
  const targets = repairTargets(tailored, SOURCE);
  const answer = (summary, bullet) => ({ lines: [{ id: 0, text: summary }, { id: 1, text: bullet }] });
  const protectedKeywords = ['Python', 'AWS'];

  const good = applyRepairs(tailored, targets, answer('Engineer with 8 years of experience building data services.', 'Built Python data services on AWS.'), { protectedKeywords });
  assert.equal(good.repaired, 2);
  assert.equal(good.form.summary, 'Engineer with 8 years of experience building data services.');
  assert.deepEqual(good.form.experience[0].achievements, ['Built Python data services on AWS.']);
  assert.equal(good.changes.find((c) => c.kind === 'rewritten').after, 'Built Python data services on AWS.', 'what changed follows the repair, so it can still be put back');

  const refused = applyRepairs(tailored, targets, answer('Engineer with 15 years of experience building data services.', 'Built data services on AWS for 2M users.'), { protectedKeywords });
  assert.equal(refused.repaired, 0, 'an inflated tenure and an invented figure are refused');
  const lostTerm = applyRepairs(tailored, targets, answer('', 'Built data services on AWS.'), { protectedKeywords });
  assert.equal(lostTerm.repaired, 0, 'a fix that drops Python, a job term, is refused; an empty one is ignored');
  const noBetter = applyRepairs(tailored, targets, answer('Results-driven engineer building data services.', 'Leveraged Python to build seamless data services on AWS.'), { protectedKeywords });
  assert.equal(noBetter.repaired, 0, 'a fix with as many problems is refused');
  assert.equal(applyRepairs(tailored, targets, null, { protectedKeywords }).repaired, 0, 'a shapeless answer changes nothing');
  assert.deepEqual(tailored.form.experience[0].achievements, ['Leveraged Python to build robust data services on AWS.'], 'the tailoring passed in is never mutated');
});

// A resume that lists its skills by category under its own heading, kept as a free-text section.
const GROUPED = {
  ...SOURCE,
  skills: [],
  otherSections: [
    { title: 'Technical Proficiencies', content: 'Languages: Python, TypeScript, C#\nData: Postgres, Kafka\nDesign: Photoshop' },
    ...SOURCE.otherSections,
  ],
};

test('a skills section kept as text is tailored as the skills, under its own heading and categories', () => {
  const written = {
    ...WRITTEN,
    skills: [],
    skillGroups: [
      { category: 'Data', items: ['PostgreSQL', 'Kafka'] },
      { category: 'languages', items: ['Python'] },
      { category: 'Cloud', items: ['Kubernetes'] },
    ],
    otherSections: [{ title: 'Volunteering', content: 'Mentored students.' }],
  };
  const { form } = tailoredResumeForm(GROUPED, written, { confirmedKeywords: ['Kubernetes', 'dbt'], protectedKeywords: ['TypeScript'] });
  assert.equal(form.skillsHeading, 'Technical Proficiencies');
  assert.deepEqual(
    form.skillGroups,
    [
      { category: 'Data', items: ['PostgreSQL', 'Kafka'] },
      { category: 'Languages', items: ['Python', 'TypeScript'] },
      { category: 'Other', items: ['Kubernetes', 'dbt'] },
    ],
    "the resume's category names; a skill the job names comes back; an invented category and a forgotten confirmed keyword go in Other"
  );
  assert.deepEqual(form.skills, ['PostgreSQL', 'Kafka', 'Python', 'TypeScript', 'Kubernetes', 'dbt'], 'the flat list is the groups in order');
  assert.deepEqual(
    form.otherSections.map((o) => o.title),
    ['Volunteering'],
    'no second skills section'
  );
});

test('the prompt shows grouped skills once, and cut skills are listed by category to put back', () => {
  const { user } = buildTailorPrompt({ form: GROUPED, job: JOB });
  assert.match(user, /"skillGroups":\[\{"category":"Languages","items":\["Python","TypeScript","C#"\]\}/);
  assert.doesNotMatch(user, /Technical Proficiencies/);
  const tailored = tailoredResumeForm(GROUPED, { ...WRITTEN, skills: [], skillGroups: [{ category: 'Languages', items: ['Python'] }] });
  const { form } = withoutCuts(GROUPED, tailored.form, tailored.changes);
  assert.deepEqual(form.skillGroups, [{ category: 'Languages', items: ['Python'] }]);
  assert.deepEqual(tailored.droppedSkills, [
    { skill: 'TypeScript', category: 'Languages' },
    { skill: 'C#', category: 'Languages' },
    { skill: 'Postgres', category: 'Data' },
    { skill: 'Kafka', category: 'Data' },
    { skill: 'Photoshop', category: 'Design' },
  ]);
});

test('skills are cut to what the job needs: its own first, then the model order, 15 others and 10 a category', () => {
  const source = {
    skills: [],
    skillGroups: [
      { category: 'Big Data & AI', items: ['PyTorch', 'LangChain', ...Array.from({ length: 14 }, (_, i) => `AiTool${i}`)] },
      { category: 'Web Dev', items: Array.from({ length: 12 }, (_, i) => `WebTool${i}`) },
      { category: 'Cloud', items: ['AWS', 'GCP'] },
      { category: 'Misc.', items: ['Nextcloud', 'Moodle'] },
      { category: 'Other', items: ['Teamplayer', 'Analytical&HolisticThinker', 'SystemsEngineer', 'Python'] },
    ],
  };
  source.skills = source.skillGroups.flatMap((g) => g.items);
  const groups = [
    ...source.skillGroups.slice(0, 1),
    { category: 'Big Data & AI', items: [] },
    ...source.skillGroups.slice(1),
  ].filter((g) => g.items.length);
  groups[0] = { ...groups[0], items: ['unit testing', 'code reviews', 'Languages:', ...groups[0].items, 'tool calling', 'AI-powered matching process', 'Large Language Models', 'machine learning'] };
  const { groups: kept, dropped } = limitSkills(source, groups, { relevant: ['PyTorch', 'AWS', 'Python', 'LangChain', 'tool calling'], named: ['machine learning'] });

  const all = kept.flatMap((g) => g.items);
  assert.ok(all.length <= 30, `${all.length} skills`);
  assert.deepEqual(kept.map((g) => g.category), ['Big Data & AI', 'Web Dev', 'Cloud', 'Other'], 'Misc. names nothing the job asks for and was not ranked first');
  assert.deepEqual(kept.find((g) => g.category === 'Other').items, ['Python'], 'a soft skill or a job title is never a skill');
  assert.ok(kept[0].items.includes('machine learning'), 'a phrase the job itself lists stays');
  assert.ok(!all.includes('tool calling') && !all.includes('AI-powered matching process'), 'a phrase the rewrite added is an activity, not a skill');
  assert.ok(all.includes('unit testing') && !all.includes('code reviews'), 'unless the skill dictionary knows it as a method');
  assert.ok(!all.includes('Languages:'), 'a leftover label is not a skill');
  assert.equal(kept[0].items.length, 7, 'three the job names, and four a category it does not');
  const jobTerms = ['PyTorch', 'AWS', 'Python', 'LangChain', 'machine learning'];
  assert.equal(all.filter((s) => !jobTerms.includes(s)).length, 9, 'four a category the job does not ask for: Web Dev four, Cloud one');
  assert.ok(['PyTorch', 'LangChain', 'AWS', 'Python'].every((s) => all.includes(s)), 'what the job names always stays');
  assert.ok(dropped.some((d) => d.skill === 'Nextcloud' && d.category === 'Misc.'));
  assert.ok(dropped.some((d) => d.skill === 'Teamplayer'));
  assert.ok(!dropped.some((d) => d.skill === 'tool calling'), "only the resume's own skills are offered back");
});

test("the job's own skills may take the list to 35, never anything else", () => {
  const jobSkills = Array.from({ length: 40 }, (_, i) => `JobTool${i}`);
  const skills = [...jobSkills, ...Array.from({ length: 10 }, (_, i) => `Other${i}`)];
  const { groups } = limitSkills({ skills }, [{ category: '', items: skills }], { relevant: jobSkills });
  assert.equal(groups[0].items.length, 35);
  assert.ok(groups[0].items.every((s) => s.startsWith('JobTool')));

  const few = [...jobSkills.slice(0, 20), ...Array.from({ length: 40 }, (_, i) => `Other${i}`)];
  assert.equal(limitSkills({ skills: few }, [{ category: '', items: few }], { relevant: jobSkills }).groups[0].items.length, 30, '30 when the job names fewer');
  const labelled = limitSkills({ skills: ['Power Apps:'] }, [{ category: '', items: ['Power Apps:'] }], { named: ['Power Apps'] });
  assert.deepEqual(labelled.groups, [], 'a label is not a skill, even one the job names');
});

test('a resume without categories is cut the same way: what the job names, and 15 others', () => {
  const skills = ['Python', ...Array.from({ length: 40 }, (_, i) => `Tool${i}`)];
  const { groups } = limitSkills({ skills }, [{ category: '', items: skills }], { relevant: ['Python'] });
  assert.equal(groups[0].items.length, 16);
  assert.equal(groups[0].items[0], 'Python');
});

test('a skill the rewrite added stays only when the job lists it, the user confirmed it or the dictionary knows it', () => {
  const source = { skills: ['Python', 'AWSincl.EKS'] };
  const written = ['Python', 'AWS incl.EKS', 'Kubernetes', 'Token economics', 'Level-2 support', 'Acme Flow', 'Payments Ledger'];
  const { groups } = limitSkills(source, [{ category: '', items: written }], { named: ['Acme Flow'] });
  assert.deepEqual(groups[0].items, ['Python', 'AWS incl.EKS', 'Kubernetes', 'Acme Flow'], "the resume's own however it is spaced, a known tool, a listed one");
});

test('repeats go after a trailing dash is stripped, and by what the dictionary resolves them to', () => {
  const skills = ['Github Actions-', 'GitHub Actions', 'Go', 'Golang', 'Regression Evaluation', 'Regression Evaluation-', 'Microsoft 365:'];
  const { groups, dropped } = limitSkills({ skills }, [{ category: '', items: skills }]);
  assert.deepEqual(groups[0].items, ['Github Actions', 'Go', 'Regression Evaluation']);
  assert.deepEqual(dropped, [], 'a repeat or a label is not a skill lost');
});

test('a source bullet cited twice is said once: the rewrite stands and the copy goes, whichever came first', () => {
  const rewrite = { text: 'Built trust across product and data teams while delivering data services on AWS.', from: 0 };
  const copy = 'Built data services on AWS.';
  const first = tailoredResumeForm(SOURCE, role([rewrite, { text: 'Defined core data models.', from: 1 }, copy]), { protectedKeywords: ['AWS'] });
  assert.deepEqual(first.form.experience[0].achievements, [rewrite.text, 'Defined core data models.']);
  const second = tailoredResumeForm(SOURCE, role([copy, { text: 'Defined core data models.', from: 1 }, rewrite]), { protectedKeywords: ['AWS'] });
  assert.deepEqual(second.form.experience[0].achievements, ['Defined core data models.', rewrite.text]);
  assert.equal(second.changes.filter((c) => c.kind === 'rewritten').length, 1, 'one change, not a change and a copy');
});

test('a cut bullet put back goes after the last line that speaks to the job, not after the ones that do not', () => {
  const source = { ...SOURCE, experience: [{ ...SOURCE.experience[0], achievements: ['Built data services on AWS.', 'Designed SQL-backed data workflows.', 'Ran the book club.'] }, SOURCE.experience[1]] };
  const written = role([{ text: 'Built data services on AWS.', from: 0 }, { text: 'Ran the book club.', from: 2 }]);
  const { form } = tailoredResumeForm(source, written, { protectedKeywords: ['AWS', 'SQL'] });
  assert.deepEqual(form.experience[0].achievements, ['Built data services on AWS.', 'Designed SQL-backed data workflows.', 'Ran the book club.']);
});

test("a skill of the resume's own keeps its own category wherever the model put it; a new one takes the model's", () => {
  const source = {
    ...SOURCE,
    skills: [],
    skillGroups: [
      { category: 'Languages', items: ['Python', 'TypeScript', 'C#'] },
      { category: 'Backend', items: ['Node.js', 'FastAPI'] },
      { category: 'Cloud', items: ['AWS', 'Docker'] },
    ],
  };
  source.skills = source.skillGroups.flatMap((g) => g.items);
  const written = {
    ...WRITTEN,
    experience: [{ ...WRITTEN.experience[0], achievements: [{ text: 'Built Python data services on AWS, provisioned with Terraform and fed by Kafka.', from: 0 }] }, ...WRITTEN.experience.slice(1)],
    skillGroups: [
      { category: 'Cloud', items: ['Terraform', 'AWS', 'Kafka', 'Docker'] },
      { category: 'Backend', items: ['Python', 'TypeScript', 'Node.js', 'FastAPI'] },
    ],
  };
  const { form } = tailoredResumeForm(source, written, { assumedKeywords: ['Terraform', 'Kafka'], protectedKeywords: ['Terraform', 'AWS', 'Kafka', 'Python'], job: { skills: ['Terraform', 'AWS', 'Kafka', 'Python'] } });
  assert.deepEqual(
    form.skillGroups.map((g) => [g.category, g.items]),
    [
      ['Cloud', ['Terraform', 'AWS', 'Kafka', 'Docker']],
      ['Languages', ['Python', 'TypeScript']],
      ['Backend', ['Node.js', 'FastAPI']],
    ],
    "Python stays a language; Kafka is new and goes where the model put it; the model's category order stands"
  );
});

test("the Worth AI case: the job's stack in its order, the resume's neighbours kept, unrelated databases cut, a phrase of a skill folded", () => {
  const source = {
    skills: [],
    skillGroups: [
      { category: 'Languages', items: ['Python', 'TypeScript', 'JavaScript', 'C#', 'Swift', 'Rust'] },
      { category: 'Backend & APIs', items: ['Node.js', 'FastAPI', 'Django', 'REST APIs', 'GraphQL', 'Background Jobs'] },
      { category: 'Data & Databases', items: ['PostgreSQL', 'MySQL', 'Microsoft SQL Server', 'MongoDB', 'Redis', 'Firebase', 'pgvector', 'FAISS'] },
      { category: 'AI / ML', items: ['OpenAI API', 'LangChain', 'PyTorch', 'RAG'] },
      { category: 'Cloud & DevOps', items: ['AWS', 'GCP', 'Microsoft Azure', 'Docker', 'CI/CD', 'GitHub Actions', 'Git', 'Linux'] },
      { category: 'Testing', items: ['Automated Testing', 'Structured Logging', 'Monitoring', 'Crash Analytics'] },
    ],
  };
  source.skills = source.skillGroups.flatMap((g) => g.items);
  const draft = [
    { category: 'Cloud & DevOps', items: ['Terraform', 'Terraform modules', 'Kubernetes', 'EKS', 'Argo CD', 'AWS', 'GitHub Actions', 'Datadog', 'Kafka', 'Bash', 'CI/CD', 'Docker', 'Git', 'Linux', 'GCP'] },
    { category: 'Languages', items: ['Python', 'TypeScript', 'JavaScript', 'C#', 'Swift'] },
    { category: 'Backend & APIs', items: ['Node.js', 'FastAPI', 'Django', 'REST APIs', 'GraphQL', 'Background Jobs'] },
    { category: 'Data & Databases', items: ['PostgreSQL', 'Redis', 'MySQL', 'Microsoft SQL Server', 'MongoDB', 'Firebase', 'pgvector', 'FAISS'] },
    { category: 'Testing', items: ['Monitoring', 'Structured Logging', 'Automated Testing'] },
  ];
  const jobSkills = ['Terraform', 'Kubernetes', 'AWS', 'EKS', 'Argo CD', 'GitHub Actions', 'Datadog', 'PostgreSQL', 'Kafka', 'Redis', 'Bash', 'Python', 'TypeScript', 'JavaScript'];
  const { groups, dropped } = limitSkills(source, draft, { relevant: [...jobSkills, 'Monitoring', 'CI/CD'], named: jobSkills });
  const items = Object.fromEntries(groups.map((g) => [g.category, g.items]));
  assert.deepEqual(
    items['Cloud & DevOps'],
    ['Terraform', 'Kubernetes', 'EKS', 'Argo CD', 'AWS', 'GitHub Actions', 'Datadog', 'Kafka', 'Bash', 'CI/CD', 'Docker', 'Git', 'Linux', 'GCP'],
    "the job's order (EKS is a spelling of Kubernetes to the dictionary, so it ranks with it), then the resume's neighbours; no 'Terraform modules'"
  );
  assert.deepEqual(items['Languages'], ['Python', 'TypeScript', 'JavaScript', 'C#', 'Swift']);
  assert.deepEqual(items['Data & Databases'], ['PostgreSQL', 'Redis', 'MySQL', 'Microsoft SQL Server', 'MongoDB', 'Firebase'], 'four the job does not name, so pgvector and FAISS go');
  assert.deepEqual(items['Testing'], ['Monitoring', 'Structured Logging', 'Automated Testing'], 'a category the posting text speaks to survives past the leading three');
  assert.ok(dropped.some((d) => d.skill === 'FAISS' && d.category === 'Data & Databases'));
  assert.ok(!dropped.some((d) => d.skill === 'Docker'));
});

test('the Raydar case: a category the cut would leave with one skill takes a second, and the ones the fill leaves alone go', () => {
  const source = {
    skills: [],
    skillGroups: [
      { category: 'Languages', items: ['Python', 'TypeScript', 'JavaScript', 'C#', 'C++', 'Swift'] },
      { category: 'Frontend', items: ['React', 'Next.js', 'React Native'] },
      { category: 'Backend & APIs', items: ['FastAPI', 'Node.js', 'Django', '.NET', 'REST APIs'] },
      { category: 'Data & Databases', items: ['PostgreSQL', 'MySQL', 'Microsoft SQL Server', 'MongoDB', 'Redis'] },
      { category: 'Cloud & DevOps', items: ['AWS', 'GCP', 'Microsoft Azure', 'CI/CD', 'Docker'] },
      { category: 'Testing', items: ['Automated Testing', 'Evaluation Harnesses', 'Regression Testing', 'A/B Testing', 'Structured Logging', 'Monitoring'] },
    ],
  };
  source.skills = source.skillGroups.flatMap((g) => g.items);
  // The model kept one Testing skill, the one the posting text names.
  const draft = [...source.skillGroups.slice(0, 5), { category: 'Testing', items: ['Monitoring'] }];
  const jobSkills = ['Python', 'TypeScript', 'React', 'React Native', 'REST APIs', 'PostgreSQL', 'AWS'];
  const { groups } = limitSkills(source, draft, { relevant: [...jobSkills, 'Monitoring'], named: jobSkills });
  const items = Object.fromEntries(groups.map((g) => [g.category, g.items]));
  assert.ok(groups.every((g) => g.items.length >= 2), `no category of one: ${JSON.stringify(items)}`);
  assert.deepEqual(items['Testing'], ['Monitoring', 'Automated Testing'], "the resume's own from that category when the model left none");
  assert.deepEqual(items['Cloud & DevOps'].slice(0, 2), ['AWS', 'GCP'], "the model's next when it has one");
  assert.equal(groups.flatMap((g) => g.items).filter((s) => !jobSkills.includes(s) && s !== 'Monitoring').length, 15, 'the seconds count toward the 15 the job does not name');

  // A category the job does not ask for, cut to one skill by the budget, goes rather than stand alone.
  const lone = {
    skills: [],
    skillGroups: [
      { category: 'Languages', items: ['Python', 'TypeScript', 'Go', 'Rust', 'Elixir', 'Scala'] },
      { category: 'Mobile', items: ['SwiftUI', 'UIKit', 'Kotlin'] },
      { category: 'Backend', items: ['FastAPI', 'Node.js', 'Django', '.NET', 'Flask'] },
      { category: 'Data', items: ['PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Firebase'] },
      { category: 'Cloud', items: ['AWS', 'GCP', 'Azure'] },
    ],
  };
  lone.skills = lone.skillGroups.flatMap((g) => g.items);
  const cut = limitSkills(lone, lone.skillGroups, { relevant: ['Python', 'TypeScript', 'FastAPI', 'PostgreSQL', 'AWS'], named: ['Python', 'TypeScript', 'FastAPI', 'PostgreSQL', 'AWS'] });
  const left = Object.fromEntries(cut.groups.map((g) => [g.category, g.items]));
  assert.equal(left['Mobile'], undefined, `Mobile had room for one skill the job never asked for: ${JSON.stringify(left)}`);
  assert.ok(cut.dropped.some((d) => d.skill === 'SwiftUI' && d.category === 'Mobile'), 'and it is offered back');
  assert.ok(cut.groups.every((g) => g.items.length >= 2));
});

test('a term written in on assumption is a skill only when the dictionary knows it; the user confirming it is enough', () => {
  const source = { skills: ['Python'], skillGroups: [{ category: 'Languages', items: ['Python'] }] };
  const draft = [
    { category: 'Languages', items: ['Python'] },
    { category: 'Other', items: ['ACH', 'wire', 'instant payment networks', 'Kubernetes'] },
  ];
  const jobSkills = ['Python', 'ACH', 'wire', 'instant payment networks', 'Kubernetes'];
  const assumed = ['ACH', 'wire', 'instant payment networks', 'Kubernetes'];
  const { groups } = limitSkills(source, draft, { relevant: jobSkills, named: jobSkills, assumed });
  assert.deepEqual(groups.map((g) => [g.category, g.items]), [['Languages', ['Python']], ['Other', ['Kubernetes']]], "the posting's wording is not a skill; a tool the dictionary knows is");
  const confirmed = limitSkills(source, draft, { relevant: jobSkills, named: [...jobSkills, 'ACH'], assumed, confirmed: ['ACH'] });
  assert.deepEqual(confirmed.groups[1].items, ['ACH', 'Kubernetes'], 'confirmed, it stays');
});

test("the scorer's and the model's keywords protect a line or a skill only where the posting says them", async () => {
  const { postingTerms } = await import('./index.js');
  const description = 'Hands-on experience with bank transfer methods such as ACH, wire and instant payment networks. Proficiency in Python or TypeScript.';
  assert.deepEqual(postingTerms(description, ['monitoring', 'Python', 'ACH', 'CI/CD', 'typescript']), ['Python', 'ACH', 'typescript']);
  assert.deepEqual(postingTerms('', ['monitoring', 'Python']), ['monitoring', 'Python'], 'no description, every term stands');
  assert.deepEqual(postingTerms(description, null), []);
});

test("the summary's tenure sentence stays the source's when the draft writes a job term into it", async () => {
  const { summaryWithSourceTenure, titleTerms } = await import('./index.js');
  const source = 'Senior Full Stack Engineer with 10+ years delivering scalable web, backend, mobile, and AI-driven products. Expert in React and Node.js.';
  const draft = 'Senior Full Stack Engineer with 10+ years delivering scalable web, backend, mobile, AI-driven products, and cloud infrastructure. Hands-on work spans Terraform and Kubernetes.';
  assert.deepEqual(titleTerms('Senior DevOps Engineer, Infrastructure & Reliability'), ['DevOps', 'Infrastructure', 'Reliability']);
  assert.equal(
    summaryWithSourceTenure(draft, source, ['Terraform', ...titleTerms('Senior DevOps Engineer, Infrastructure & Reliability')]),
    'Senior Full Stack Engineer with 10+ years delivering scalable web, backend, mobile, and AI-driven products. Hands-on work spans Terraform and Kubernetes.'
  );
  const reworded = 'Full Stack Engineer with 10+ years of web, backend and mobile products. Hands-on work spans Terraform.';
  assert.equal(summaryWithSourceTenure(reworded, source, ['Terraform', 'Infrastructure']), reworded, 'a reworded tenure sentence that claims no job term stands');
  assert.equal(summaryWithSourceTenure('No years here.', source, ['Infrastructure']), 'No years here.');

  const { form } = tailoredResumeForm({ ...SOURCE, summary: source }, { ...WRITTEN, summary: draft }, { protectedKeywords: ['Terraform'], assumedKeywords: ['Terraform'], job: { title: 'Senior DevOps Engineer, Infrastructure & Reliability' } });
  assert.ok(form.summary.startsWith('Senior Full Stack Engineer with 10+ years delivering scalable web, backend, mobile, and AI-driven products. Hands-on'), form.summary);
});

test('a summary sentence that claims a job term the resume never shows and nobody assumed comes out', async () => {
  const { summaryWithoutClaims } = await import('./index.js');
  const source = 'Senior Full Stack Engineer with 10+ years delivering web, backend, mobile, and AI-driven products. Expert in React and Node.js.';
  const claim = 'Experience includes payment flows using ACH, wire, and instant payment networks, ledger-based accounting models, and record-keeping systems, alongside React Native mobile development.';
  const draft = `${source} ${claim}`;
  const terms = ['ACH', 'wire', 'instant payment networks', 'ledger-based accounting model', 'record-keeping systems', 'React Native', 'React'];
  const sourceText = 'React Native\nReact\nShipped 20 iOS apps.';
  const allowed = ['ACH', 'wire', 'instant payment networks', 'record-keeping systems'];
  assert.equal(summaryWithoutClaims(draft, source, { terms, allowed, sourceText }), source, '"ledger-based accounting models" was never assumed: the sentence goes');
  assert.equal(summaryWithoutClaims(draft, source, { terms, allowed: [...allowed, 'ledger-based accounting model'], sourceText }), draft, 'assumed, every term of it is allowed');
  assert.equal(summaryWithoutClaims(draft, source, { terms, allowed, sourceText: `${sourceText}\nKept the ledger-based accounting model.` }), draft, 'or shown by the resume');
  assert.equal(summaryWithoutClaims(claim, source, { terms, allowed, sourceText }), source, 'a draft of nothing but claims gives way to the source');
  assert.equal(summaryWithoutClaims(`${source} Works with React.`, source, { terms, allowed, sourceText }), `${source} Works with React.`, 'a term the resume shows is no claim');

  const written = { ...WRITTEN, summary: `${SOURCE.summary} Hands-on with Kubernetes and Python data services.` };
  const { form } = tailoredResumeForm(SOURCE, written, { protectedKeywords: ['Python', 'Kubernetes'], job: JOB });
  assert.equal(form.summary, SOURCE.summary, 'Kubernetes is nowhere in the resume and was not assumed');
  const assumed = tailoredResumeForm(SOURCE, written, { protectedKeywords: ['Python', 'Kubernetes'], assumedKeywords: ['Kubernetes'], job: JOB });
  assert.equal(assumed.form.summary, written.summary);
});

test('a bullet that is the source with a term glued onto its list is refused; a term that became part of the work is not', async () => {
  const { applyGapLines, gluedTerm } = await import('./index.js');
  const before = 'Designed backend services using Python, Node.js, REST APIs, PostgreSQL, Redis, and asynchronous processing for customer-facing and internal product workflows.';
  const glued = 'Designed Python and Node.js backend services with REST APIs, PostgreSQL, Redis, asynchronous processing, and instant payment networks for customer-facing and internal product workflows.';
  const terms = ['instant payment networks', 'ACH', 'GitHub Actions', 'Kafka'];
  assert.ok(gluedTerm(before, glued, terms), 'the Raydar bullet');
  assert.ok(gluedTerm('Used Redis for events.', 'Used Kafka and Redis for events.', terms), 'at the head of a list too');
  assert.ok(!gluedTerm('Built the CI pipeline for the mobile app.', 'Built the GitHub Actions CI pipeline for the mobile app.', terms), 'the term names what the work was');
  assert.ok(!gluedTerm('Built the CI pipeline for the mobile app.', 'Built the CI pipeline for the mobile app, and moved its deploys to GitHub Actions with a staging gate.', terms), 'a clause that says something new');
  assert.ok(!gluedTerm(before, 'Designed Python and Node.js backend services with REST APIs, PostgreSQL and Redis.', terms), 'no term came in');

  const source = { ...SOURCE, experience: [{ ...SOURCE.experience[0], achievements: [before, 'Defined core data models.'] }, SOURCE.experience[1]] };
  const { form, changes } = tailoredResumeForm(source, role([{ text: glued, from: 0 }, { text: 'Defined core data models.', from: 1 }]), { assumedKeywords: ['instant payment networks'], style: 'ats' });
  assert.deepEqual(form.experience[0].achievements, [before, 'Defined core data models.'], 'the source bullet stands');
  assert.deepEqual(changes, []);

  // The gap pass rewrote the Worth AI bullet this way: "Designed distributed backend services using Python, Node.js, Kafka, REST APIs…".
  const tailored = tailoredResumeForm(source, role([{ text: before, from: 0 }, { text: 'Defined core data models.', from: 1 }]), { protectedKeywords: ['Python'] });
  const kafka = 'Designed distributed backend services using Python, Node.js, Kafka, REST APIs, PostgreSQL, Redis, and asynchronous processing for customer-facing and internal product workflows.';
  const gap = applyGapLines(tailored, source, { lines: [{ id: 0, role: 0, from: 0, text: kafka, estimate: '' }] }, { assumedKeywords: ['Kafka'], requirements: [{ text: 'Kafka' }] });
  assert.equal(gap.applied, 0, 'the gap pass refuses it too');
  const work = 'Designed Kafka-backed event pipelines between the backend services, with consumers in Python and Node.js feeding PostgreSQL and Redis.';
  assert.equal(applyGapLines(tailored, source, { lines: [{ id: 0, role: 0, from: 0, text: work, estimate: '' }] }, { assumedKeywords: ['Kafka'], requirements: [{ text: 'Kafka' }] }).applied, 1, 'a line about work with it stands');
});

// ── estimated figures ─────────────────────────────────────────────────────────

const withRole = (achievements) => ({ ...WRITTEN, experience: [{ ...WRITTEN.experience[0], achievements }, WRITTEN.experience[1]] });

test('an estimated figure goes into the bullet and is listed with the bullet it came from', () => {
  const text = 'Built data services on AWS, cutting query times by ~30%.';
  const { form, estimates, changes } = tailoredResumeForm(SOURCE, withRole([{ text, from: 0, estimate: ', cutting query times by ~30%' }, { text: 'Defined core data models.', from: 1, estimate: '' }]));
  assert.deepEqual(form.experience[0].achievements, [text, 'Defined core data models.']);
  assert.deepEqual(estimates, [{ role: 0, text, plain: 'Built data services on AWS.', clause: 'cutting query times by ~30%' }]);
  assert.ok(changes.some((c) => c.kind === 'rewritten' && c.after === text), 'and shows as a change');
});

test('an estimate is refused on a bullet that states a figure, past five, or with a figure outside its clause', () => {
  const letters = 'abcdefghijkl'.split('');
  const source = { ...SOURCE, experience: [{ ...SOURCE.experience[0], achievements: ['Served 40k users from the data API.', ...letters.map((c) => `Built service ${c} on AWS.`)] }, SOURCE.experience[1]] };
  const bullets = [
    { text: 'Served 40k users from the data API, with ~99.9% uptime.', from: 0, estimate: ', with ~99.9% uptime' },
    ...letters.map((c, i) => ({ text: `Built service ${c} on AWS, cutting ${c} deploy time by ~${20 + i}%.`, from: i + 1, estimate: `, cutting ${c} deploy time by ~${20 + i}%` })),
  ];
  const { form, estimates } = tailoredResumeForm(source, withRole(bullets));
  assert.equal(estimates.length, 5, 'five at most');
  assert.equal(form.experience[0].achievements[0], 'Served 40k users from the data API.', 'the source stated a figure: the bullet stays without the estimate');
  assert.equal(form.experience[0].achievements[1], 'Built service a on AWS, cutting a deploy time by ~20%.');
  assert.equal(form.experience[0].achievements[2], 'Built service b on AWS.', 'no figure on the bullet after one with a figure');
  assert.equal(form.experience[0].achievements[3], 'Built service c on AWS, cutting c deploy time by ~22%.');
  assert.equal(form.experience[0].achievements.at(-1), 'Built service l on AWS.', 'past five, a bullet loses its estimate, not its text');

  const invented = tailoredResumeForm(SOURCE, withRole([{ text: 'Built 12 data services on AWS, cutting query times by ~30%.', from: 0, estimate: ', cutting query times by ~30%' }]));
  assert.deepEqual(invented.estimates, []);
  assert.equal(invented.form.experience[0].achievements[0], 'Built data services on AWS.', 'a figure outside the clause is an invention');
});

test('an estimate comes out and goes in as a clause, leaving the bullet whole', () => {
  assert.equal(withoutEstimate('Built data services on AWS, cutting query times by ~30%.', ', cutting query times by ~30%'), 'Built data services on AWS.');
  assert.equal(withoutEstimate('Built data services on AWS.', ', cutting query times by ~30%'), null);
  assert.equal(withEstimate('Built data services on AWS.', 'cutting query times by ~25%'), 'Built data services on AWS, cutting query times by ~25%.');
  assert.equal(withEstimate('Built data services on AWS', ', serving about 2,000 users'), 'Built data services on AWS, serving about 2,000 users');
});

test('a clause with no figure in it is not an estimate', () => {
  const text = 'Built data services on AWS, including Spark jobs for model data.';
  const { estimates, form } = tailoredResumeForm(SOURCE, withRole([{ text, from: 0, estimate: ', including Spark jobs for model data' }]));
  assert.deepEqual(estimates, []);
  assert.equal(form.experience[0].achievements[0], text, 'it is traced as an ordinary rewrite');
});

test('an estimate is realistic, not impressive: over 40% or a multiplier is taken out', () => {
  assert.equal(overstatedEstimate('cutting response times by ~30%'), false);
  assert.equal(overstatedEstimate('serving about 2,000 users'), false);
  assert.equal(overstatedEstimate('cutting response times by ~60%'), true);
  assert.equal(overstatedEstimate('speeding up deploys 3x'), true);
  assert.equal(overstatedEstimate('doubling throughput'), true);
  const text = 'Built data services on AWS, cutting query times by ~70%.';
  const { estimates, form } = tailoredResumeForm(SOURCE, withRole([{ text, from: 0, estimate: ', cutting query times by ~70%' }]));
  assert.deepEqual(estimates, []);
  assert.equal(form.experience[0].achievements[0], 'Built data services on AWS.', 'the bullet stands without it');
});

test("score first writes in at most eight required terms, a requirement's own first, and never a phrase of the posting", async () => {
  const { assumableTerm, MAX_ASSUMED_TERMS, splitAssumedTerms } = await import('./index.js');
  assert.equal(MAX_ASSUMED_TERMS, 8);
  for (const phrase of ['GitCI/CD?', 'MS-SQL 2016 or later', 'natural language processing techniques like fuzzy wuzzy', 'extract, transform, and load processes', 'GPT-3.5/4 or similar AI models', 'containerised', 'data services', 'cloud-native development', '']) {
    assert.equal(assumableTerm(phrase), false, phrase);
  }
  for (const term of ['Kubernetes', 'REST APIs', 'Spring Boot', 'C#', 'Node.js', 'Test Automation', 'CI/CD', 'OAuth 2.0']) assert.equal(assumableTerm(term), true, term);

  const skills = ['Apex', 'SOQL', 'Salesforce APIs', 'LWC', 'Sales Cloud', 'SQL Server', 'OAuth 2.0', 'Git', 'C#', '.NET', 'Java', 'Spring'];
  const scoring = { requirements: [{ text: 'Strong Java and Spring experience', priority: 'required' }, { text: 'Nice to have: Sales Cloud', priority: 'preferred' }] };
  const split = splitAssumedTerms([...skills, 'GraphQL', 'Jest', 'GitCI/CD?'], { job: { skills }, scoring });
  assert.deepEqual(split.assumed, ['Java', 'Spring', 'Apex', 'SOQL', 'Salesforce APIs', 'LWC', 'Sales Cloud', 'SQL Server'], "the job's skills a requirement names first, then the job's order, eight in all");
  assert.deepEqual(split.leftOut, ['OAuth 2.0', 'Git', 'C#', '.NET'], 'the required terms past the cap, offered to nobody');
  assert.deepEqual(split.optional, ['GraphQL', 'Jest'], 'plausible-only: the nice-to-haves; the phrase is gone');
  const phrased = splitAssumedTerms(['presales', 'PyTorch', 'Spark'], { job: { skills: ['PyTorch', 'Spark'] }, scoring: { requirements: [{ text: 'presales and PyTorch work', priority: 'required' }] } });
  assert.deepEqual(phrased.assumed, ['PyTorch', 'Spark', 'presales'], "a tool the job lists comes before a phrase only a requirement's sentence names");
  assert.deepEqual(splitAssumedTerms(['Jest'], {}), { assumed: [], optional: ['Jest'], leftOut: [] }, 'with no job or score nothing is required');
});

test('credential and clearance checks do not drop ordinary engineering lines that reuse those words', async () => {
  const { claimsClearance, claimsCredential } = await import('./index.js');
  for (const line of [
    'Integrated Visa and Mastercard payments for 40k users.',
    'Rotated TLS certificates with cert-manager.',
    'Built 360-degree feedback dashboards.',
    'Built a license key validation service.',
    'Tracked conference sponsorship leads in a CRM.',
    'Shipped a citizen-facing permits portal.',
    'Automated eligibility for benefits checks.',
    'Open sourced a library licensed under MIT.',
  ]) {
    assert.equal(claimsCredential(line), false, `credential: ${line}`);
    assert.equal(claimsClearance(line), false, `clearance: ${line}`);
  }
  for (const line of ['Completed an Azure certification.', "Holds a bachelor's degree.", 'Licensed CPA.']) {
    assert.equal(claimsCredential(line), true, line);
  }
  for (const line of ['Must be a US citizen.', 'Requires visa sponsorship.', 'No sponsorship available.', 'Valid work visa.']) {
    assert.equal(claimsClearance(line), true, line);
  }
});

test('a clearance is never written: not as a gap, not as a line for any gap, not as an added bullet', async () => {
  const { applyGapLines, buildGapPrompt, claimsClearance } = await import('./index.js');
  assert.equal(claimsClearance('Eligible to obtain a DoD Secret clearance based on experience supporting production services.'), true);
  assert.equal(claimsClearance('Rotated Kubernetes secrets with Vault.'), false);
  const tailored = tailoredResumeForm(SOURCE, role([{ text: 'Built Python data services on AWS.', from: 0 }]), { protectedKeywords: ['Python'] });
  const scoring = {
    requirements: [
      { text: 'Ability to obtain a DoD Secret clearance', kind: 'experience', priority: 'required', verdict: 'missing' },
      { text: 'Must be a US citizen', kind: 'experience', priority: 'required', verdict: 'missing' },
      { text: 'Lead incident response', kind: 'responsibility', priority: 'required', verdict: 'missing' },
    ],
  };
  const prompt = buildGapPrompt({ tailoredForm: tailored.form, scoring, job: JOB });
  assert.deepEqual(prompt.open.map((o) => o.id), [2], 'the clearance and the citizenship are not gaps to fill');
  const merged = applyGapLines(
    tailored,
    SOURCE,
    {
      lines: [
        { id: 0, role: 0, from: null, text: 'Supported production data services in a role eligible for a Secret clearance.', estimate: '' },
        { id: 2, role: 0, from: null, text: 'Ran incident response for the data services, holding an active security clearance.', estimate: '' },
        { id: 2, role: 0, from: null, text: 'Ran incident response for the data services and wrote the postmortems.', estimate: '' },
      ],
    },
    { requirements: scoring.requirements }
  );
  assert.equal(merged.applied, 1, 'the clearance gap and the line claiming one are refused; the plain incident line stands');
  assert.ok(merged.form.experience[0].achievements.includes('Ran incident response for the data services and wrote the postmortems.'));
  const added = tailoredResumeForm(SOURCE, role([{ text: 'Built data services on AWS.', from: 0 }, { text: 'Eligible to obtain a DoD Secret clearance, having supported security-sensitive systems.', from: null }]), { style: 'ats', protectedKeywords: ['AWS'] });
  assert.deepEqual(added.form.experience[0].achievements, ['Built data services on AWS.']);
});

test('one rewrite per source bullet: a second rewrite of the same bullet is dropped, a copy still gives way to the rewrite', () => {
  const first = { text: 'Defined core data models for the React dashboards with Redux Toolkit.', from: 1 };
  const second = { text: 'Defined core data models for the monitoring screens with React Context API.', from: 1 };
  const { form, changes } = tailoredResumeForm(SOURCE, role([{ text: 'Built data services on AWS.', from: 0 }, first, second]), { protectedKeywords: ['AWS', 'React'] });
  assert.deepEqual(form.experience[0].achievements, ['Built data services on AWS.', first.text]);
  assert.equal(changes.filter((c) => c.kind === 'rewritten').length, 1);
  const copyFirst = tailoredResumeForm(SOURCE, role([{ text: 'Defined core data models.', from: 1 }, first]), { protectedKeywords: ['React'] });
  assert.deepEqual(copyFirst.form.experience[0].achievements, [first.text], 'the copy goes, the rewrite stands');
});

test('a term of one platform is not written onto a bullet about another: the source bullet stands, and a gap line is refused', async () => {
  const { applyGapLines, crossesPlatform } = await import('./index.js');
  assert.equal(crossesPlatform('Implemented unit tests across all Android components.', 'Implemented XCTest unit tests across Android components.', ['XCTest']), true);
  assert.equal(crossesPlatform('Shipped the iOS app to TestFlight.', 'Shipped the iOS app to TestFlight with XCTest coverage.', ['XCTest']), false, 'the same platform');
  assert.equal(crossesPlatform('Built the mobile app for iOS and Android.', 'Built the mobile app for iOS and Android with XCTest.', ['XCTest']), false, 'a bullet across both is left alone');
  assert.equal(crossesPlatform('Built REST APIs in C# on .NET.', 'Built REST APIs in C# on .NET and Spring Boot.', ['Spring Boot']), true);
  const source = { ...SOURCE, experience: [{ ...SOURCE.experience[0], achievements: ['Ensured code quality by implementing unit tests across all Android components.', 'Defined core data models.'] }, SOURCE.experience[1]] };
  const swapped = tailoredResumeForm(source, role([{ text: 'Ensured code quality by implementing XCTest unit tests across Android components.', from: 0 }, { text: 'Defined core data models.', from: 1 }]), { assumedKeywords: ['XCTest'], protectedKeywords: ['XCTest', 'Android'] });
  assert.deepEqual(swapped.form.experience[0].achievements, source.experience[0].achievements, 'the Android bullet stands as it was');
  const tailored = tailoredResumeForm(source, role([{ text: 'Ensured code quality by implementing unit tests across all Android components.', from: 0 }, { text: 'Defined core data models.', from: 1 }]), { protectedKeywords: ['Android'] });
  const gap = applyGapLines(tailored, source, { lines: [{ id: 0, role: 0, from: 0, text: 'Ensured code quality by implementing XCTest unit tests across Android components.', estimate: '' }] }, { assumedKeywords: ['XCTest'], requirements: [{ text: 'XCTest' }] });
  assert.equal(gap.applied, 0);
});

test('the gap pass asks for a skill gap only when the tailoring may write that skill in, or the resume already names it', async () => {
  const { buildGapPrompt } = await import('./index.js');
  const tailored = tailoredResumeForm(SOURCE, role([{ text: 'Built Python data services on AWS.', from: 0 }]), { protectedKeywords: ['Python'] });
  const scoring = {
    requirements: [{ text: 'Python services', verdict: 'met' }],
    requiredSkillVerdicts: [
      { skill: 'Python', verdict: 'weak' },
      { skill: 'Kubernetes', verdict: 'missing' },
      { skill: 'Apex', verdict: 'missing' },
    ],
  };
  const any = buildGapPrompt({ tailoredForm: tailored.form, scoring, job: JOB });
  assert.deepEqual(any.open.map((o) => o.line), ['[required skill] Python — weak: listed under skills, not shown in a line of work', '[required skill] Kubernetes — missing', '[required skill] Apex — missing'], 'with no allowed list, every one');
  const some = buildGapPrompt({ tailoredForm: tailored.form, scoring, job: JOB, allowedTerms: ['Kubernetes'] });
  assert.deepEqual(some.open.map((o) => o.id), [1, 2], 'Python is in the resume, Kubernetes is allowed; Apex past the cap stays the gap it is');
  assert.equal(buildGapPrompt({ tailoredForm: tailored.form, scoring: { requirements: [], requiredSkillVerdicts: [{ skill: 'Apex', verdict: 'missing' }] }, job: JOB, allowedTerms: [] }), null);
});

test("a phrase of the posting's own, five words in a row, is a copy; three tools the posting also names are not", async () => {
  const { copiedRequirement, repairTargets } = await import('./index.js');
  const description = 'We operate as an autonomous team with a follow-the-sun on-call model across three time zones (NZT, GMT, PT). Our stack is React, TypeScript and Node.js on AWS.';
  assert.equal(copiedRequirement('Participated in on-call incident response through a follow-the-sun model across three time zones, documenting root causes.', [], description), 'model across three time zones');
  assert.equal(copiedRequirement('Built the billing console in React, TypeScript and Node.js on AWS for 3M users.', [], description), null);
  assert.equal(copiedRequirement('Participated in on-call incident response through a follow-the-sun model across three time zones.', []), null, 'without the posting, only the requirements are checked');
  const tailored = { form: { summary: '', experience: [{ achievements: [] }] }, changes: [{ role: 0, kind: 'rewritten', before: 'x', after: 'Participated in an on-call roster as part of a follow-the-sun model across three time zones.' }] };
  const targets = repairTargets(tailored, SOURCE, { description });
  assert.equal(targets.length, 1);
  assert.match(targets[0].problems[0], /repeats the posting's wording \("model across three time zones"\)/);
});

test("a gap line that rewrote a bullet without its figure gets the clause back; one with a figure of its own is refused, and so is one past the gap line's length", async () => {
  const { applyGapLines, MAX_GAP_LINE_CHARS } = await import('./index.js');
  const tailored = tailoredResumeForm(SOURCE, role([{ text: 'Built data services on AWS, cutting query latency by ~20%.', from: 0, estimate: ', cutting query latency by ~20%' }, { text: 'Defined core data models.', from: 1 }]));
  assert.equal(tailored.estimates.length, 1);
  const requirements = [{ text: 'Operate services on AWS', kind: 'responsibility', priority: 'required' }, { text: 'Monitor production', kind: 'responsibility', priority: 'required' }];
  const answer = {
    lines: [
      { id: 0, role: 0, from: 0, text: 'Built and operated data services on AWS, monitoring failures through logs and alerts.', estimate: '' },
      { id: 1, role: 0, from: 1, text: `Defined core data models ${'and documented every field '.repeat(12)}for the team.`, estimate: '' },
    ],
  };
  const merged = applyGapLines(tailored, SOURCE, answer, { protectedKeywords: ['AWS'], requirements });
  assert.equal(merged.applied, 1);
  assert.equal(merged.form.experience[0].achievements[0], 'Built and operated data services on AWS, monitoring failures through logs and alerts, cutting query latency by ~20%.', 'the clause is back at the end');
  assert.equal(merged.estimates[0].text, merged.form.experience[0].achievements[0], "the estimate's record follows the line");
  assert.equal(merged.estimates[0].plain, 'Built and operated data services on AWS, monitoring failures through logs and alerts.');
  assert.equal(merged.rejected.length, 1);
  assert.match(merged.rejected[0].reason, new RegExp(`over ${MAX_GAP_LINE_CHARS} characters`));
  assert.equal(MAX_GAP_LINE_CHARS, 240);

  const own = applyGapLines(tailored, SOURCE, { lines: [{ id: 0, role: 0, from: 0, text: 'Built data services on AWS, serving ~2k requests a second.', estimate: ', serving ~2k requests a second' }] }, { protectedKeywords: ['AWS'], requirements });
  assert.equal(own.applied, 0, 'two figures on one bullet is refused');
  assert.match(own.rejected[0].reason, /existing estimate clause/);
});

test('a line that says a requirement back with nothing of the role in it is an echo; one about the role\'s own product is not', async () => {
  const { echoesRequirement, applyGapLines } = await import('./index.js');
  const requirements = [
    { text: 'Agile experience', kind: 'experience', priority: 'required' },
    { text: 'experience in medium- to large-sized engineering organizations', kind: 'experience', priority: 'required' },
    { text: 'use AI-assisted development tools judiciously', kind: 'responsibility', priority: 'required' },
  ];
  const roleText = ['Built data services on AWS for the caller-ID product.', 'Defined core data models for the reputation pipeline.'].join('\n');
  assert.equal(echoesRequirement('Participated in Agile teams and Software Development Lifecycle practices to iterate over design and development cycles.', requirements, roleText), 'Agile experience');
  const collaborated = 'Collaborated with product, design, QA, backend, data, and mobile teams from planning through release.';
  assert.equal(
    echoesRequirement('Collaborated across product, design, QA, backend, data, and mobile teams in a medium-sized engineering organization.', requirements, roleText, { before: collaborated }),
    'experience in medium- to large-sized engineering organizations',
    'a rewrite judged on what it added: the requirement glued onto the bullet'
  );
  assert.equal(
    echoesRequirement('Collaborated with product, design, QA, backend, data, and mobile teams, taking the caller-ID release through review with each.', requirements, roleText, { before: collaborated }),
    null,
    'what it added names the role\'s own product'
  );
  assert.equal(echoesRequirement('Used AI-assisted development tools to draft and inspect application code, then verified changes through automated testing.', requirements, roleText), 'use AI-assisted development tools judiciously');
  assert.equal(echoesRequirement('Ran two-week Agile sprints for the reputation pipeline, shipping a caller-ID release each sprint.', requirements, roleText), null, 'the role\'s pipeline and product anchor it');
  assert.equal(echoesRequirement('Drafted the caller-ID data models with AI-assisted development tools, then verified each against the reputation pipeline.', requirements, roleText), null);
  assert.equal(echoesRequirement('Built data services on AWS for the caller-ID product.', requirements, roleText), null, 'a line about something else is not an echo');

  // The gap pass refuses the echo and says why; the repair round flags it on a rewritten line.
  const tailored = tailoredResumeForm(SOURCE, role([{ text: 'Built data services on AWS.', from: 0 }, { text: 'Defined core data models.', from: 1 }]));
  const merged = applyGapLines(tailored, SOURCE, { lines: [{ id: 0, role: 0, from: null, text: 'Participated in Agile teams and development lifecycle practices to iterate over design cycles.', estimate: '' }] }, { requirements });
  assert.equal(merged.applied, 0);
  assert.match(merged.rejected[0].reason, /repeats the posting \("Agile experience"\) without the role's own work/);
  const echoed = { form: { summary: '', experience: [{ achievements: ['Participated in Agile teams and development lifecycle practices to iterate over design cycles.'] }] }, changes: [{ role: 0, kind: 'added', before: '', after: 'Participated in Agile teams and development lifecycle practices to iterate over design cycles.' }] };
  const [target] = repairTargets(echoed, SOURCE, { requirements });
  assert.match(target.problems[0], /says the requirement back \("Agile experience"\) without naming any work of this role/);
  const fixed = applyRepairs(echoed, [target], { lines: [{ id: 0, text: 'Ran two-week Agile sprints for the AWS data services, shipping a data-model change each sprint.' }] }, { requirements });
  assert.equal(fixed.repaired, 1, 'a repair that names the role\'s own work stands');
});
