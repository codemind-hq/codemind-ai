import { GENERATE_STYLE, tailorStyle } from '../style.js';
import { buildGeneratePrompt } from './generate.js';
import { buildTailoringPrompt } from './tailor.js';

// The prompts a rewrite is shown, one per kind of resume: tailor.js for "Tailor my resume"
// (score first, balanced, looks real) and generate.js for "Write a new resume for this job".
// What both show — the resume, the keyword rules, the scorer's findings, the job — is in
// sections.js.

export { buildGeneratePrompt, GENERATE_SYSTEM_PROMPT } from './generate.js';
export { buildTailoringPrompt, TAILOR_SYSTEM_PROMPT } from './tailor.js';
export { resumeBlock } from './sections.js';

/**
 * The prompt for a rewrite in `style`: the generate style gets the new-resume prompt, with
 * `refocus` and the company summary; every other style the tailoring prompt.
 */
export function buildTailorPrompt({ style, refocus = false, ...request }) {
  style = tailorStyle(style);
  return style === GENERATE_STYLE ? buildGeneratePrompt({ ...request, refocus }) : buildTailoringPrompt({ ...request, style });
}
