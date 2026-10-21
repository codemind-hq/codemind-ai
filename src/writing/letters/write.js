import { jobPostingBlock } from '../../text/fence.js';
import { tailorEffort } from '../../llm/routing.js';
import { isExecutionStopped } from '../../llm/errors.js';

// What the letters, answers and referrals share: how a draft is written and checked, and the
// prompt pieces they are assembled from.

export const cap = (text, n = 12000) => String(text || '').slice(0, n);

/** `value` when the user wrote one, otherwise the built-in prompt. */
export function pickPrompt(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

// A subject line a model adds anyway ("Betreff: …", "Re: …"), which a form has no place for.
const SUBJECT_LINE_RE = /^\s*(?:subject|re|betreff|objet|oggetto|asunto|assunto|onderwerp)\s*:[^\n]*\n+/i;
export const withoutSubjectLine = (text) => String(text || '').replace(SUBJECT_LINE_RE, '');

/** The job as the letters and answers see it: its title and company, then the posting, fenced. */
export const jobSection = ({ jobTitle, company, jobDescription }) =>
  `${jobTitle || 'Not specified'}${company?.trim() ? ` at ${company.trim()}` : ''}\n${jobPostingBlock(jobDescription || '', 12000)}`;

/** Optional prompt sections: only the ones that have something to say. */
export const sections = (pairs) =>
  pairs
    .filter(([, body]) => body && String(body).trim())
    .map(([name, body]) => `${name}:\n${body}`)
    .join('\n\n');

/** Model settings for the letters and answers: the writer model of the user's tier (ai/settings.js), at the effort tailoring would use on it. */
export const writerSettings = (model) => (model ? { model, reasoningEffort: tailorEffort(model) } : {});

/**
 * Write once and check the draft's voice (text/voice.js). When it has problems, ask once more for a
 * revision that fixes exactly those, and keep whichever draft has fewer. At most one extra call;
 * a failed revision leaves the first draft standing.
 */
export async function writeInVoice({ write, check }) {
  const first = await write(null);
  const issues = check(first);
  if (!issues.length) return first;
  const revise = `REVISE: here is your draft. Write it again fixing only these problems. Keep every fact, the meaning and about the same length.
${issues.map((i) => `- ${i.message}`).join('\n')}

DRAFT:
${first}`;
  try {
    const second = await write(revise);
    return second && check(second).length < issues.length ? second : first;
  } catch (err) {
    if (isExecutionStopped(err)) throw err;
    return first;
  }
}
