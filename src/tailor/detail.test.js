import test from 'node:test';
import assert from 'node:assert/strict';
import { borrowedBullet, denseBullet, losesDetail, lostDetails, namesOf } from './detail.js';
import { tailoredResumeForm } from './form.js';
import { limitSkills, namesSkill } from './skills.js';
import { summaryWithSourceCredentials } from './summary.js';

// Lines from the Cobalt Staff AI Engineer tailoring (2026-10-27) that read worse than the resume.
const PWC = 'ML Engineering: PyTorch ResNet-50 CNN (98.3% accuracy), LightGBM with SHAP explainability, hybrid recommender systems. Enterprise MLOps framework (Docker, MLflow, Azure ML) cutting deployment times by 40%. Automated drift detection for 12+ production models.';
const MUSIC =
  'Music AI: Audio intelligence platform for professional DJs: ShazamKit fingerprinting, Chromaprint, CoreML inference, LLM metadata normalization. 500K+ tracks processed. FastAPI backend, PostgreSQL (2M+ records), 3.5TB Azure Blob Storage. Dashboard response times optimized from 90s to 150ms.';
const CI = 'Cross-project: Multi-stage CI/CD with immutable artifact patterns, semantic versioning, multi-environment Docker image promotion.';
const EVIDENCE = 'Evidence: 1,205 tests (69% coverage), full CI/CD with GitHub Actions, published article series on harness engineering.';

test("a rewrite's details are its figures and names; a label's plain words and a sentence's first word are not names", () => {
  assert.deepEqual(namesOf('Agent Platform: Built a production AI agent platform on Azure.'), ['Azure']);
  assert.ok(namesOf('Engineered specialized agents (PDFAgent, Table Agent) with Databricks.').includes('PDFAgent'));
  assert.deepEqual(lostDetails(MUSIC, 'Operated a FastAPI backend with PostgreSQL, Azure Blob Storage and managed cloud model platforms, reducing dashboard response time from 90s to 150ms.').slice(0, 3), ['500', '2', '3.5']);
  assert.ok(losesDetail(PWC, 'Built an enterprise MLOps framework with Docker, MLflow and Azure ML, cutting deployment times by 40% and supporting production monitoring for 12+ models with automated drift detection.'), 'ResNet-50, 98.3%, LightGBM and SHAP are gone');
  assert.ok(!losesDetail('Built data services on AWS.', 'Built Python data services on AWS for the analytics team.'), 'a rewrite that says more stands');
  assert.ok(!losesDetail('Built a production AI agent platform.', 'Built a production LLM-based agent platform.'), '"AI" names nothing');
  assert.ok(!losesDetail('Built a cluster on Kubernetes.', 'Built a cluster on K8s.'), 'an alias of the same tool is the same name');
});

test('a dense bullet keeps most of its wording: it gains the job\'s terms, it is not written afresh', () => {
  assert.ok(denseBullet(MUSIC));
  assert.ok(!denseBullet('Built data services on AWS.'));
  const reworded = 'Ran ShazamKit, Chromaprint and CoreML models, LLM jobs, a FastAPI service, PostgreSQL and Azure Blob Storage for DJs: 500K+ songs, 2M+ rows, 3.5TB, 90s to 150ms.';
  assert.deepEqual(lostDetails(MUSIC, reworded), [], 'every detail is still there');
  assert.ok(losesDetail(MUSIC, reworded), 'but the bullet was written afresh');
  assert.ok(!losesDetail(MUSIC, MUSIC.replace('FastAPI backend', 'Asynchronous FastAPI backend')), 'a term worked in stands');
});

test("a line that repeats another role's bullet is found, beyond the job's own terms", () => {
  const copy = 'Established CI/CD with 1,205 tests, 69% coverage, immutable artifacts, semantic versioning and multi-environment Docker image promotion for safe rollout of system changes.';
  assert.equal(borrowedBullet(copy, { ownText: EVIDENCE, elsewhere: [CI, PWC], jobText: 'safe rollout of system changes' }), CI);
  assert.equal(borrowedBullet('Established CI/CD with 1,205 tests and 69% coverage on GitHub Actions for safe rollout of system changes.', { ownText: EVIDENCE, elsewhere: [CI], jobText: 'safe rollout of system changes' }), null);

  const source = {
    name: 'A',
    experience: [
      { company: 'Cogentrex', title: 'Lead Engineer', period: '2026 - Present', achievements: [EVIDENCE] },
      { company: 'element61', title: 'Senior ML Engineer', period: '2023 - Present', achievements: [CI] },
    ],
  };
  const written = { experience: [{ ...source.experience[0], achievements: [{ text: copy, from: 0 }] }, { ...source.experience[1], achievements: [{ text: CI, from: 0 }] }] };
  const { form, changes } = tailoredResumeForm(source, written, { protectedKeywords: ['safe rollout of system changes'], style: 'ats' });
  assert.deepEqual(form.experience[0].achievements, [EVIDENCE], 'the side project keeps its own bullet');
  assert.deepEqual(changes, []);
});

test("the summary's credentials stay: a short sentence of an award or a book the draft dropped goes back at its end", () => {
  const source = 'I build agent systems that work in production. 10x Microsoft MVP in AI. Author of Master Machine Learning with Python (BPB Publishing). Based in Brussels.';
  const draft = 'Senior AI engineer with 9+ years in machine learning engineering and production AI systems. Known for mentoring 112 professionals.';
  assert.equal(summaryWithSourceCredentials(draft, source), `${draft} 10x Microsoft MVP in AI. Author of Master Machine Learning with Python (BPB Publishing).`);
  assert.equal(summaryWithSourceCredentials(`${draft} A 10x Microsoft MVP in AI.`, source), `${draft} A 10x Microsoft MVP in AI. Author of Master Machine Learning with Python (BPB Publishing).`, 'one it still says is not said twice');
  assert.equal(summaryWithSourceCredentials(draft, 'Backend engineer in Brussels.'), draft, 'a summary with no credential is left alone');
});

test('a skill matches a job term under its parentheses or its acronym, and a bare generic word is never added as a skill', () => {
  assert.ok(namesSkill('MCP Protocol (stdio + HTTP)', 'Model Context Protocol (MCP)'));
  assert.ok(!namesSkill('Docker', 'Model Context Protocol (MCP)'));
  const source = { skills: ['Python', 'FastAPI', 'MCP Protocol (stdio + HTTP)', 'SvelteKit'], skillGroups: [] };
  const { groups, dropped } = limitSkills(source, [{ category: '', items: ['Python', 'FastAPI', 'API', 'MCP Protocol (stdio + HTTP)', 'SvelteKit'] }], {
    relevant: ['Model Context Protocol (MCP)', 'API'],
    named: ['Model Context Protocol (MCP)', 'API', 'Python'],
    otherMax: 1,
  });
  assert.deepEqual(groups[0].items, ['Python', 'FastAPI', 'MCP Protocol (stdio + HTTP)'], 'MCP is the job\'s, so it stays past the one other skill allowed; "API" is not a skill');
  assert.deepEqual(dropped.map((d) => d.skill), ['SvelteKit']);
});

test('a language, cloud or container platform the resume never shows is never written in; one it shows, or the member confirmed, is', async () => {
  const { newStackTerms, unbackedStackTerms } = await import('./stack.js');
  const source = 'Python, FastAPI, Docker and Azure; GitHub Actions CI/CD.';
  assert.deepEqual(unbackedStackTerms(['Go', 'GCP', 'Kubernetes', 'Azure', 'Python', 'prompt injection'], source), ['Go', 'GCP', 'Kubernetes']);
  assert.deepEqual(unbackedStackTerms(['Kubernetes'], source, ['K8s']), [], 'confirmed under another name');
  assert.deepEqual(newStackTerms('Built CI/CD across Azure environments and GCP deployments with Kubernetes release targets.', { sourceText: source }), ['GCP', 'Kubernetes']);
  assert.deepEqual(newStackTerms('Added 243 tests, with Go services supporting the agent platform.', { sourceText: source }), ['Go']);
  assert.deepEqual(newStackTerms('Let go of the legacy queue and moved to Azure Service Bus.', { sourceText: source }), [], '"go" the verb is not Go');
});

test('the same work said twice is said once; two pieces of work that read alike stay', async () => {
  const { withoutRepeatedBullets } = await import('./detail.js');
  const twice = 'Built multi-stage CI/CD with immutable artifact patterns, semantic versioning and multi-environment Docker image promotion.';
  const again = 'Established multi-stage CI/CD with immutable artifact patterns, semantic versioning and Docker image promotion across environments.';
  const tailored = {
    form: { experience: [{ company: 'A', achievements: ['Built the evaluation harness.', again] }, { company: 'B', achievements: ['Ran the data platform.', twice] }] },
    changes: [{ role: 0, kind: 'rewritten', before: 'Evidence: 1,205 tests.', after: again }],
    estimates: [],
  };
  const out = withoutRepeatedBullets(tailored, ['safe rollout']);
  assert.equal(out.removed, 1);
  assert.deepEqual(out.form.experience[1].achievements, ['Ran the data platform.'], 'the older role loses its copy on a tie');
  assert.deepEqual(out.form.experience[0].achievements, ['Built the evaluation harness.', again]);
  const alike = { form: { experience: [{ company: 'A', achievements: ['Built the billing API on AWS with Python and Postgres for finance.', 'Built the reporting API on AWS with Python and Postgres for finance.'] }] }, changes: [], estimates: [] };
  assert.equal(withoutRepeatedBullets(alike).removed, 0);
});

test('a summary counts its figures without its years or its credentials', async () => {
  const { summaryFigures } = await import('./summary.js');
  assert.deepEqual(summaryFigures('Senior AI Engineer with 9+ years in ML. Recent systems include Cogentrex, with 176 mechanisms, 100 scenarios and 1,205 tests. 10x Microsoft MVP in AI.'), ['176', '100', '1205']);
});

test('a tailored resume that runs well onto a third page loses its least relevant bullets, oldest role first, to fit two', async () => {
  const { withinPageBudget } = await import('./pages.js');
  const bullet = (i, term = '') => `Built and operated data service number ${i}${term} on the shared platform, cutting the nightly run from six hours to under one for three product teams.`;
  const experience = Array.from({ length: 6 }, (_, r) => ({ company: `Company ${r}`, title: 'Engineer', period: '2019 – 2021', achievements: Array.from({ length: 9 }, (_, i) => bullet(i, r === 0 ? ' with Python' : '')) }));
  const out = withinPageBudget({ form: { name: 'A', summary: 'Engineer.', experience }, changes: [], estimates: [] }, { protectedKeywords: ['Python'] });
  assert.ok(out.cut > 0 && out.cut <= 8);
  assert.equal(out.form.experience[0].achievements.length, 9, 'the bullets that name the job go last');
  assert.ok(out.form.experience[5].achievements.length < 9, 'the oldest role gives first');
  assert.equal(out.changes.filter((c) => c.kind === 'removed').length, out.cut, 'each cut can be put back');
});

test('a short skills list is topped up from the skills the bullets use, a whole category the cut dropped first', () => {
  const source = {
    skills: [],
    skillGroups: [
      { category: 'Backend', items: ['Python', 'FastAPI'] },
      { category: 'Infrastructure', items: ['Docker', 'GitHub Actions', 'MLflow', 'Terraform'] },
      { category: 'Frontend', items: ['React', 'SvelteKit'] },
    ],
  };
  source.skills = source.skillGroups.flatMap((g) => g.items);
  const shown = 'Typed ReAct loop in Python on FastAPI. Shipped with Docker and GitHub Actions; models tracked in MLflow.';
  const { groups } = limitSkills(source, [{ category: 'Backend', items: ['Python', 'FastAPI'] }], { relevant: ['Python'], named: ['Python'], shown });
  assert.deepEqual(groups, [
    { category: 'Backend', items: ['Python', 'FastAPI'] },
    { category: 'Infrastructure', items: ['Docker', 'GitHub Actions', 'MLflow'] },
  ], 'Terraform is in no bullet; "ReAct" the agent pattern is not React, and SvelteKit alone is no category');
});

test('a bullet the model keeps as written comes back as the resume has it, without being retyped', async () => {
  const { traceBullets, writtenBullets } = await import('./bullets.js');
  const source = ['Built the billing API on AWS.', 'Ran the data platform for three teams.'];
  const written = writtenBullets([{ text: '', from: 1, estimate: '' }, { text: 'Built the billing API on AWS with Terraform.', from: 0, estimate: '' }, { text: '', from: 7, estimate: '' }, { text: '', from: null, estimate: '' }]);
  assert.equal(written.length, 3, 'an empty line with no source is nothing');
  const { bullets, changes } = traceBullets(source, written, { confirmed: [], protectedKeywords: ['Terraform'], sources: { figures: [], text: source.join('\n') } });
  assert.deepEqual(bullets, ['Ran the data platform for three teams.', 'Built the billing API on AWS with Terraform.'], "kept in the model's order; a source that does not exist is skipped");
  assert.deepEqual(changes.map((c) => c.kind), ['rewritten']);
});
