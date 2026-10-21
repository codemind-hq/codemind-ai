import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretScoreAnswer } from './interpret.js';

const requirement = { text: 'Build APIs', kind: 'responsibility', priority: 'required' };
const score = (verdict) => interpretScoreAnswer({ verdicts: [{ id: 0, verdict, quote: 'Built APIs' }] }, { job: {}, resumeText: 'Built APIs', requirements: [requirement] });

test('invalid verdicts, including inherited object keys, never produce non-finite scores', () => {
  for (const verdict of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'MET', '', null, {}, ['met']]) {
    const result = score(verdict);
    assert.equal(result.score, 0);
    assert.equal(result.breakdown.responsibilities, 0);
    assert.equal(result.requirements[0].verdict, 'missing');
    assert.equal(result.requirements[0].quote, '');
  }
});

test('valid verdicts keep their existing weights', () => {
  for (const [verdict, expected] of [['met', 100], ['weak', 50], ['missing', 0]]) assert.equal(score(verdict).score, expected);
});
