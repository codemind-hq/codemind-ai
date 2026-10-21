import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResumeText } from './service.js';
import { installFakeLlm } from '../testing/fakeLlm.js';

test('empty and non-string resume inputs are rejected before any provider calls', async () => {
  const fake = installFakeLlm([]);
  try {
    for (const input of ['', ' \n\t', null, undefined, 42, {}]) {
      await assert.rejects(parseResumeText(input), (err) => err.code === 'bad_request' && err.status === 400);
    }
    assert.equal(fake.calls.length, 0);
  } finally { fake.restore(); }
});

test('unusable resume output triggers one fallback and then a safe error', async () => {
  for (const output of [{}, { name: ' ', skills: [null], experience: [{}] }, { name: 42 }]) {
    const fake = installFakeLlm([output, output]);
    try {
      await assert.rejects(parseResumeText('Built APIs'), (err) => err.code === 'upstream_failed');
      assert.equal(fake.calls.length, 2);
    } finally { fake.restore(); }
  }
});

test('valid partial anonymized content is returned unchanged, including after fallback', async () => {
  const output = { summary: 'Built APIs' };
  const fake = installFakeLlm([{}, output]);
  try {
    assert.deepEqual(await parseResumeText('Built APIs'), output);
    assert.equal(fake.calls.length, 2);
  } finally { fake.restore(); }
});
