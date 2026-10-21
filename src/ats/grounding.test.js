import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretScoreAnswer } from './interpret.js';
import { quickScoreResume, scoreVersion } from './service.js';
import { PROMPT_VERSIONS } from '../promptVersions.js';
import { installFakeLlm } from '../testing/fakeLlm.js';

const resumeText = 'Built Python services on PostgreSQL.';
// With one requirement and no scored skills, scores of 0/50/100 directly expose
// missing/weak/met credit without other categories masking the grounding effect.
const requirement = { text: 'Design and own production APIs', kind: 'responsibility', priority: 'required' };
const job = { description: requirement.text, requirements: [requirement] };
const answer = (verdict, quote) => ({ verdicts: [{ id: 0, verdict, quote }], matchedKeywords: [] });
const interpret = (data, options = {}) => interpretScoreAnswer(data, { job, resumeText, requirements: [requirement], ...options });

let llm;
afterEach(() => {
  llm?.restore();
  llm = null;
});

// Providers may return valid JSON containing invalid evidence. Both met and weak
// must be rejected, including non-string quotes and quotes with no actual words.
for (const quote of ['Designed payment APIs for millions of users', '', '   ', '!!!', null, 42, {}]) {
  for (const verdict of ['met', 'weak']) {
    test(`a ${verdict} with unverified evidence ${JSON.stringify(quote)} earns no credit`, () => {
      const result = interpret(answer(verdict, quote));
      assert.equal(result.score, 0);
      assert.deepEqual(result.requirements, [{ ...requirement, verdict: 'missing', quote: '' }]);
      assert.deepEqual(result.weakEvidence, []);
      assert.deepEqual(result.missingRequirements, [requirement.text]);
    });
  }
}

test('grounded full and partial credit retain case, spacing and punctuation normalization', () => {
  assert.equal(interpret(answer('met', 'built  PYTHON services on PostgreSQL!')).score, 100);
  assert.equal(interpret(answer('weak', 'Python services')).score, 50);
  assert.equal(interpret(answer('missing', 'Built Python services')).score, 0);
});

test('empty or malformed verdict lists remain missing without throwing', () => {
  for (const data of [null, {}, { verdicts: null }, { verdicts: 'met' }, { verdicts: [null] }]) {
    assert.equal(interpret(data).score, 0);
  }
  assert.equal(interpret(answer('met', 'Built Python services'), { resumeText: '' }).score, 0);
});

test('a grounded prior verdict is preserved when a rewrite keeps its evidence', () => {
  // The existing before/after stabilization may retain credit from a verified earlier
  // quote, but only while the rewritten resume still contains that quote.
  const prior = {
    resumeText,
    requirements: [{ ...requirement, verdict: 'met', quote: 'Built Python services on PostgreSQL' }],
  };
  assert.equal(interpret(answer('met', 'invented evidence'), { prior }).score, 100);
  assert.equal(interpret(answer('met', 'invented evidence'), { prior, resumeText: 'Built a different system' }).score, 0);
});

test('the public scorer rejects invented evidence without another model call', async () => {
  // A successful API response can contain bad evidence. Reject it in code rather than
  // spend another model call; usage still records the completed request as successful.
  llm = installFakeLlm([answer('met', 'Designed payment APIs for millions of users')]);
  const result = await quickScoreResume(resumeText, job);
  assert.equal(result.score, 0);
  assert.deepEqual(result.missingRequirements, [requirement.text]);
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.events.length, 1);
  assert.equal(llm.events[0].ok, true, 'the model call succeeded; grounding determines the score');
});

test('the score cache version includes the grounding revision and configured model', () => {
  llm = installFakeLlm([]);
  assert.equal(scoreVersion(), `${PROMPT_VERSIONS.score}/gpt-4.1-mini/grounding.v2`);
});
