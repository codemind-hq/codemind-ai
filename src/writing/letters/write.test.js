import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiError } from '../../errors.js';
import { writeInVoice } from './write.js';

test('ordinary revision failures still return the first draft', async () => {
  const result = await writeInVoice({
    write: async (revision) => { if (revision) throw new Error('provider failed'); return 'First draft'; },
    check: () => [{ message: 'Revise voice' }],
  });
  assert.equal(result, 'First draft');
});

test('cancelled and expired revisions propagate their terminal errors', async () => {
  for (const code of ['ai_cancelled', 'ai_timeout']) {
    await assert.rejects(writeInVoice({
      write: async (revision) => { if (revision) throw new AiError(503, code, 'Stopped'); return 'First draft'; },
      check: () => [{ message: 'Revise voice' }],
    }), (err) => err.code === code);
  }
});
