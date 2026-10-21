import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterMatchedKeywords } from './interpret.js';
import { quickScoreResume } from './service.js';
import { installFakeLlm } from '../testing/fakeLlm.js';

const resumeText = 'Built Python services on PostgreSQL.';
const invalidLists = [undefined, null, '', 'Python', 42, true, {}, { 0: 'Python', length: 1 }];

test('non-array matched keyword values are treated as an empty list', () => {
  for (const value of invalidLists) {
    // Valid JSON may still contain the wrong field type; do not coerce it into keywords.
    assert.deepEqual(filterMatchedKeywords(value, resumeText), []);
  }
});

test('valid keyword arrays keep existing matching behavior and reject non-string entries', () => {
  assert.deepEqual(filterMatchedKeywords([], resumeText), []);
  assert.deepEqual(
    filterMatchedKeywords(['Python', 'Kubernetes', null, 42, {}, ['Python'], 'PostgreSQL', 'Python'], resumeText),
    ['Python', 'PostgreSQL', 'Python'],
    'preserve matching strings, their order and duplicates; discard unsupported or malformed entries'
  );
});

test('malformed keyword fields do not fail scoring or trigger a fallback model call', async () => {
  const requirement = { text: 'Build backend services', kind: 'responsibility', priority: 'required' };
  const job = { description: requirement.text, skills: ['Python'], requirements: [requirement] };
  for (const value of invalidLists) {
    const llm = installFakeLlm([{
      verdicts: [{ id: 0, verdict: 'met', quote: 'Built Python services on PostgreSQL' }],
      matchedKeywords: value,
      topMissingKeywords: value,
      tailoringOpportunities: ['Emphasize backend services'],
    }]);
    try {
      // Dropping unusable keyword lists must not discard valid evidence or spend a fallback call.
      const result = await quickScoreResume(resumeText, job);
      assert.equal(result.score, 100);
      assert.equal(result.requirements[0].verdict, 'met');
      assert.deepEqual(result.matchedKeywords, []);
      assert.deepEqual(result.topMissingKeywords, []);
      assert.deepEqual(result.tailoringOpportunities, ['Emphasize backend services']);
      assert.equal(llm.calls.length, 1);
      assert.equal(llm.events.length, 1);
      assert.equal(llm.events[0].ok, true);
    } finally {
      llm.restore();
    }
  }
});
