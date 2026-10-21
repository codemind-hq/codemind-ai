import { readFile } from 'node:fs/promises';
import { checkedVerdicts } from '../ats/verdicts.js';

// A diagnostic baseline, not a passing quality gate or a live model benchmark.
// Labels describe the desired semantic result; failures expose gaps in today's checks.
const cases = JSON.parse(await readFile(new URL('./fixtures/evidence.json', import.meta.url), 'utf8'));
const results = cases.map((entry) => {
  const [result] = checkedVerdicts([{ text: entry.requirement, kind: 'responsibility', priority: 'required' }], {
    verdicts: [{ id: 0, verdict: entry.verdict, quote: entry.quote }],
  }, { resumeText: entry.resume });
  return { name: entry.name, expected: entry.expected, actual: result.verdict, passed: result.verdict === entry.expected };
});
process.stdout.write(`${JSON.stringify({
  evaluation: 'Synthetic evidence-check baseline; no live model calls',
  passed: results.filter((result) => result.passed).length,
  total: results.length,
  results,
}, null, 2)}\n`);
