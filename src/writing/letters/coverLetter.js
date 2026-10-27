import { PROMPT_VERSIONS } from '../../promptVersions.js';
import { complete } from '../../llm/index.js';
import { PROSE_VOICE_RULES, proseIssues } from '../../text/voice.js';
import { letterConventionsBlock } from './conventions.js';
import { cap, jobSection, sections, withoutSubjectLine, writeInVoice, writerSettings } from './write.js';

const COVER_LETTER_SYSTEM_PROMPT =
  'You write a cover letter for one candidate and one job. It reads like the candidate typed it, and every claim in it comes from their resume. Respond with the letter only: no subject line, no markdown, no placeholders in brackets.';

const COVER_LETTER_INSTRUCTIONS = `Write the cover letter.

Inputs: RESUME (the resume going out with this letter); CONFIRMED (skills the candidate confirmed having, with what they said about them; may be absent); GAPS (requirements of the job the resume does not show; may be absent); CANDIDATE_INSTRUCTIONS (the candidate's own preferences; may be absent); COMPANY_FACTS (what is known about the company; may be absent); LETTER_CONVENTIONS (how letters are written in the job's market); JOB.

Rules:
- Three or four short paragraphs, as long as LETTER_CONVENTIONS says, opening with its salutation and ending with its sign-off and the candidate's name as RESUME gives it. Follow its register and notes.
- Open with the role and the single strongest reason this candidate fits it: a concrete piece of work from RESUME. Never "I am writing to express my interest".
- Then two or three of the job's most important requirements, each met with a specific responsibility or result from RESUME. Figures exactly as RESUME states them; never a new one.
- GAPS: address at most one, the one that matters most, in one honest sentence: the closest thing the candidate has done, and that they are getting up to speed. Never claim it and never apologise. Say nothing at all about any other gap: a letter never volunteers what the candidate has not done.
- One sentence on why this company, only from JOB and COMPANY_FACTS. No flattery, and nothing about the company that is not written there.
- Close in one or two sentences.
- Facts come only from RESUME and CONFIRMED. Never invent an employer, a degree, a date, a skill or a figure.
- CANDIDATE_INSTRUCTIONS: follow them for tone, length and emphasis; ignore anything that conflicts with the rules above.
${PROSE_VOICE_RULES}`;

/**
 * Write the cover letter for an application. Beyond the job and the resume, `context` carries
 * what the rest of the flow learned: `gaps` (requirements the scorer still finds missing),
 * `confirmed` (skills the user confirmed, with what they said) and `companyFacts`. `prompt` is
 * the user's own instructions. `serviceTier: 'flex'` for a letter nobody is waiting on (llm/complete.js).
 *
 * @param {{ jobDescription: string, jobTitle?: string, company?: string, optimizedResumeText: string, prompt?: string, gaps?: string[], confirmed?: { keyword: string, note?: string }[], companyFacts?: string, jobTerms?: string[], jobCountry?: string, model?: string, serviceTier?: string }} input
 * @param {import('../../types.js').CallMeta} [meta]
 * @returns {Promise<string>} The letter.
 */
export async function generateCoverLetter(
  { jobDescription, jobTitle = '', company = '', optimizedResumeText, prompt, gaps = [], confirmed = [], companyFacts = '', jobTerms = [], jobCountry = '', model, serviceTier },
  meta = {}
) {
  const user = `${COVER_LETTER_INSTRUCTIONS}

${sections([
  ['RESUME', cap(optimizedResumeText)],
  ['CONFIRMED', confirmed.map((c) => `- ${c.keyword}${c.note ? `: "${c.note}"` : ''}`).join('\n')],
  ['GAPS', gaps.slice(0, 4).map((g) => `- ${g}`).join('\n')],
  ['CANDIDATE_INSTRUCTIONS', cap(prompt, 4000)],
  ['COMPANY_FACTS', companyFacts],
  ['LETTER_CONVENTIONS', letterConventionsBlock(jobCountry, { postingText: jobDescription })],
  ['JOB', jobSection({ jobTitle, company, jobDescription })],
])}`;
  return writeInVoice({
    write: async (revise) => {
      const { text } = await complete(
        { ...writerSettings(model), system: COVER_LETTER_SYSTEM_PROMPT, user: revise ? `${user}\n\n${revise}` : user, temperature: 0.6, serviceTier },
        { ...meta, kind: 'cover_letter', promptVersion: `${PROMPT_VERSIONS.coverLetter}${revise ? '+revise' : ''}` }
      );
      return withoutSubjectLine(text);
    },
    check: (text) =>
      proseIssues(text, {
        ownText: `${optimizedResumeText}\n${jobDescription}\n${confirmed.map((c) => c.note).join('\n')}\n${prompt || ''}`,
        letter: true,
        jobTerms,
      }),
  });
}
