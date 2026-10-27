// Tailoring: the pure half of rewriting a resume for one job. The model is shown a prompt
// (prompts/: tailor.js, or generate.js for a new resume for the job) and answers with the
// rewritable parts of the form; the code then puts every fact back and judges every line
// (form.js, with bullets.js, skills.js, headline.js, summary.js), and two smaller rounds follow the rewrite: the gap pass (gap.js) and the repair round (repair.js).
// The checks the rounds share — claims no line may make, estimated figures, assumed terms, a
// requirement pasted — have a file each. ai/service.js runs the calls; this folder decides.

export { buildGeneratePrompt, buildTailoringPrompt, buildTailorPrompt, GENERATE_SYSTEM_PROMPT, resumeBlock, TAILOR_SYSTEM_PROMPT } from './prompts/index.js';
export { DEFAULT_TAILOR_STYLE, GENERATE_STYLE, PLAUSIBLE_BY_STYLE, TAILOR_MODES, TAILOR_STYLES, tailorMode, tailorStyle } from './style.js';
export { tailoredResumeForm, withoutCuts } from './form.js';
export { generatedResumeForm } from './generated.js';
export { limitSkills } from './skills.js';
export { resumeHeadline } from './headline.js';
export { listSentences, MIN_SUMMARY_SENTENCES, MIN_SUMMARY_WORDS, summaryWithoutClaims, summaryWithoutLists, summaryWithSourceTenure, summaryWords, titleTerms } from './summary.js';
export { estimateClause, overstatedEstimate, withEstimate, withoutEstimate } from './estimates.js';
export { claimsClearance, claimsCredential } from './claims.js';
export { assumableTerm, crossesPlatform, gluedTerm, MAX_ASSUMED_TERMS, postingTerms, splitAssumedTerms, splitJobKeywords } from './terms.js';
export { copiedRequirement, echoesRequirement } from './copied.js';
export { applyGapLines, buildGapPrompt, MAX_GAP_LINE_CHARS } from './gap.js';
export { applyRepairs, buildRepairPrompt, REPAIR_SYSTEM_PROMPT, repairTargets } from './repair.js';
