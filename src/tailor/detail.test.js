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
