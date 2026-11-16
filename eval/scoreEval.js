// Outcome eval for ATS scoring. The snapshot tests pin what the scorer *sends*; this checks whether
// the score it *produces* lands where a human reviewer agreed it should, reported as a pass rate.
//
//   node eval/scoreEval.js            offline: a scripted model feeds each case the correct verdicts,
//                                     so this checks the scoring pipeline (verdicts -> score) with no key.
//   node eval/scoreEval.js --live     live: the real model scores each case; the pass rate is how often
//                                     it agrees with the human labels. Needs OPENAI_API_KEY.
//   node eval/scoreEval.js --threshold=0.9   fail the process if the pass rate drops below this.
//
// Exit code is non-zero when the pass rate is under the threshold, so it can gate a prompt or model
// change in CI the same way a test does: "did this change make scoring better or worse?" as a number.

import { createCodemind, quickScoreResume } from '../src/index.js';
import { DEFAULT_MODELS, installFakeLlm } from '../src/testing/fakeLlm.js';
import { CASES } from './cases.js';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const thresholdArg = args.find((a) => a.startsWith('--threshold='));
const THRESHOLD = thresholdArg ? Number(thresholdArg.split('=')[1]) : LIVE ? 0.75 : 1.0;

/** Check one scored result against a case's labels. Returns the list of failures (empty = pass). */
function checkCase(expect, score) {
  const failures = [];
  if (typeof expect.scoreMin === 'number' && score.score < expect.scoreMin) failures.push(`score ${score.score} < min ${expect.scoreMin}`);
  if (typeof expect.scoreMax === 'number' && score.score > expect.scoreMax) failures.push(`score ${score.score} > max ${expect.scoreMax}`);
  if (typeof expect.maxScore === 'number' && score.score > expect.maxScore) failures.push(`score ${score.score} breached hard ceiling ${expect.maxScore}`);
  const missing = (score.topMissingKeywords || []).map((k) => String(k).toLowerCase());
  for (const kw of expect.missingKeywords || []) {
    if (!missing.includes(String(kw).toLowerCase())) failures.push(`expected "${kw}" among missing keywords, got [${(score.topMissingKeywords || []).join(', ')}]`);
  }
  for (const [idx, want] of Object.entries(expect.verdicts || {})) {
    const got = score.requirements?.[Number(idx)]?.verdict;
    if (got !== want) failures.push(`requirement #${idx} verdict ${got ?? '(none)'} != expected ${want}`);
  }
  return failures;
}

async function scoreCase(testCase) {
  if (LIVE) return quickScoreResume(testCase.resume, testCase.job);
  // Offline: the fake model returns this case's correct verdicts; the real pipeline turns them into a score.
  const fake = installFakeLlm([testCase.ideal], { models: DEFAULT_MODELS });
  try {
    return await quickScoreResume(testCase.resume, testCase.job);
  } finally {
    fake.restore();
  }
}

async function main() {
  if (LIVE) {
    if (!process.env.OPENAI_API_KEY) {
      console.error('--live needs OPENAI_API_KEY set. Run without --live for the offline pipeline check.');
      process.exit(2);
    }
    createCodemind({ providers: { openai: { apiKey: process.env.OPENAI_API_KEY } }, models: () => DEFAULT_MODELS, onUsage: () => {} });
  }

  console.log(`\nATS scoring eval  (${LIVE ? 'LIVE — real model' : 'offline — scripted verdicts'}, threshold ${THRESHOLD})\n`);
  const results = [];
  for (const testCase of CASES) {
    let score, failures, error = null;
    try {
      score = await scoreCase(testCase);
      failures = checkCase(testCase.expect, score);
    } catch (err) {
      error = err; failures = [`threw: ${err.message}`];
    }
    const pass = !error && failures.length === 0;
    results.push({ name: testCase.name, pass, failures, score: score?.score });
    const mark = pass ? 'PASS' : 'FAIL';
    console.log(`  ${mark}  ${testCase.name.padEnd(28)} score=${score?.score ?? '—'}`);
    for (const f of failures) console.log(`          ↳ ${f}`);
  }

  const passed = results.filter((r) => r.pass).length;
  const rate = passed / results.length;
  console.log(`\n  pass rate: ${passed}/${results.length} = ${(rate * 100).toFixed(0)}%   (threshold ${(THRESHOLD * 100).toFixed(0)}%)\n`);
  process.exit(rate < THRESHOLD ? 1 : 0);
}

main();
