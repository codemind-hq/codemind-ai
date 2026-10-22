import { PROMPT_VERSIONS } from '../../promptVersions.js';
import { complete } from '../../llm/index.js';
import { PROSE_VOICE_RULES, proseIssues } from '../../text/voice.js';
import { applicationQuestionBlock, cap, jobSection, pickPrompt, sections, writeInVoice, writerSettings } from './write.js';

// Answers to the questions on an application form.

const FALLBACK_ANSWER_SYSTEM_PROMPT = `You are helping a candidate fill out a job application form.
Your ONLY job is to answer the specific APPLICATION QUESTION provided.

Critical rules:
- Answer the exact question asked. Do not substitute a different question (e.g. do not write "why I want this role" unless that is the question).
- Use the job description and resume only as supporting context when relevant to the question.
- For factual, yes/no, short, or trick questions, give a direct answer. Do not expand into a cover-letter style paragraph.
- Only reference experience and qualifications supported by the resume. Do not invent employers, degrees, dates, or skills.
- Salary expectations, notice period, start date, work authorization and relocation: state a figure or a fact only when EARLIER ANSWERS give one. Otherwise answer without one (open to discussing salary for the role; available after the usual notice) and never make one up.
${PROSE_VOICE_RULES}
- Respond with only the answer text. No labels, headings, or markdown.`;

const FALLBACK_ANSWER_USER_PROMPT = `Answer the APPLICATION QUESTION below. Use the job description and optimized resume only when they help answer that specific question. Be concise and truthful. Do not invent experience. Do not ignore the question or replace it with a generic interest statement. Sound like a person, not a model.`;

/**
 * Answer one application question. `context` is the application as it stands (workspace
 * applicationContext): the job, the resume going out, and `pastAnswers` — what the candidate
 * answered to similar questions before, so their facts stay the same from one form to the next.
 *
 * @param {{ jobDescription: string, jobTitle?: string, company?: string, optimizedResumeText: string, question: string, prompt?: string, pastAnswers?: object[], model?: string }} input
 * @param {import('../../types.js').CallMeta} [meta]
 * @returns {Promise<string>} The answer.
 */
export async function generateApplicationAnswer({ jobDescription, jobTitle = '', company = '', optimizedResumeText, question, prompt, pastAnswers = [], model }, meta = {}) {
  const past = pastAnswers.map((p) => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n');
  const user = `${pickPrompt(prompt, FALLBACK_ANSWER_USER_PROMPT)}

APPLICATION QUESTION (answer this exactly):
${applicationQuestionBlock(question)}

${sections([
  ['EARLIER ANSWERS (the candidate answered these similar questions before; keep every fact consistent with them (salary, dates, authorization, notice period) and reuse their wording where it still fits this job)', cap(past, 4000)],
  ['JOB', jobSection({ jobTitle, company, jobDescription })],
  ['RESUME (context only; use it if relevant to the question)', cap(optimizedResumeText)],
])}

Write the answer to the APPLICATION QUESTION only.`;
  return writeInVoice({
    write: async (revise) => {
      const { text } = await complete(
        { ...writerSettings(model), system: FALLBACK_ANSWER_SYSTEM_PROMPT, user: revise ? `${user}\n\n${revise}` : user, temperature: 0.5 },
        { ...meta, kind: 'answer', promptVersion: `${PROMPT_VERSIONS.answer}${revise ? '+revise' : ''}` }
      );
      return text;
    },
    check: (text) => proseIssues(text, { ownText: `${optimizedResumeText}\n${jobDescription}\n${past}` }),
  });
}

// How many answers are written at once. Each takes up to two model calls, and a form of twenty
// questions all at once would be forty calls on the shared key from one request.
const ANSWERS_AT_ONCE = 3;

/**
 * Answer several questions; `pastAnswersFor(text)` supplies each one's earlier answers. One
 * answer failing does not lose the others, already written and paid for: it comes back as
 * { id, error } beside the { id, answer } rows. Only when none could be written does the call
 * throw, with the first failure.
 *
 * @param {{ questions: string[], pastAnswersFor?: (question: string) => object[] } & object} input The questions, and the context generateApplicationAnswer takes.
 * @param {import('../../types.js').CallMeta} [meta]
 * @returns {Promise<object[]>}
 */
export async function generateApplicationAnswers({ questions, pastAnswersFor = () => [], ...context }, meta = {}) {
  const answers = [];
  let firstError = null;
  for (let start = 0; start < questions.length; start += ANSWERS_AT_ONCE) {
    const batch = questions.slice(start, start + ANSWERS_AT_ONCE).map(({ id, text }) =>
      generateApplicationAnswer({ ...context, question: text, pastAnswers: pastAnswersFor(text) }, meta).then(
        (answer) => ({ id, answer }),
        (err) => {
          firstError ||= err;
          return { id, error: String(err?.message || 'The answer could not be written.') };
        }
      )
    );
    answers.push(...(await Promise.all(batch)));
  }
  if (firstError && !answers.some((a) => a.answer)) throw firstError;
  return answers;
}
