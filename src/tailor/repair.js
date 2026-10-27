import { hasKeyword } from '../text/keywords.js';
import { cleanListItem } from '../resume/structuredResume.js';
import { listLike } from '../ats/index.js';
import { MAX_BULLET_CHARS } from '../checks/index.js';
import { aiTellWords, RESUME_VOICE_RULES } from '../text/voice.js';
import { inventsFact } from './claims.js';
import { copiedRequirement, echoesRequirement } from './copied.js';
import { lostDetails } from './detail.js';
import { tailorMode } from './style.js';
import { listSentences, MIN_SUMMARY_WORDS, summaryWords } from './summary.js';
import { lower, sentencesOf } from './text.js';

// ── Repair round ───────────────────────────────────────────────────────────
//
// After a rewrite, the lines the model wrote that read badly (AI-sounding words, too long to scan)
// get one more pass: those lines only, each told its problem. A repaired line replaces the first
// only when code finds it better and no less true: fewer problems, no fact the sources lack, and
// every job keyword the line carried still there. The candidate's own wording is never sent.
//
// Ported in shape from ai-job-hunter-app (Apache-2.0), pipeline/resume/stages/repair.rs: failing
// lines only, one round, and a line that comes back worse is dropped.

const REPAIR_MAX_LINES = 8;

/**
 * What reads badly in one line the model wrote, as short instructions; [] when nothing does.
 * A bullet (the default) is also held to its length and to not being a list of tools; the
 * summary (`summary: true`) has its own length and list rules (summaryProblems).
 */
function lineProblems(text, { requirements = [], description = '', summary = false, roleText = null, before = '' } = {}) {
  const problems = [];
  const words = aiTellWords(text);
  if (words.length) problems.push(`it uses ${words.map((w) => `"${w}"`).join(', ')}, which reads as AI-written; say the plain thing`);
  // A bullet as long as the one it rewrites is not too long: cutting it to length would cut its details.
  if (!summary && text.length > Math.max(MAX_BULLET_CHARS, before.length)) problems.push(`it is ${text.length} characters; keep it under ${MAX_BULLET_CHARS}`);
  // What the scorer (score/verdicts.js) counts as a mention and not evidence.
  if (!summary && listLike(text)) problems.push('it reads as a list of tools; keep them, and say what was built or run with them');
  const copied = copiedRequirement(text, requirements, description);
  if (copied) problems.push(`it repeats the posting's wording ("${copied.slice(0, 80)}"); say what the candidate did, naming the product or system`);
  // A bullet that answers a requirement in the requirement's words with nothing of the role's own (copied.js).
  const echoed = !copied && roleText !== null ? echoesRequirement(text, requirements, roleText, { before }) : null;
  if (echoed) {
    problems.push(
      `it says the requirement back ("${echoed.slice(0, 80)}") without naming any work of this role; make it a real piece of work — name the product, pipeline, service or client this role's other bullets name, and what was done to it, with the requirement's term as the tool used once`
    );
  }
  return problems;
}

/**
 * What reads badly in the summary the model wrote: the line problems, a sentence that is a list
 * of tools (the scorer marks each as a mention, and summary.js would otherwise cut it), and too
 * little said — fewer sentences than the mode asks for (`sentences`, style.js) or under
 * MIN_SUMMARY_WORDS words. A summary that says less than the source's did is the most common
 * form of that: "the summary too short" was what a 74-point tailoring looked like.
 */
function summaryProblems(text, { requirements = [], description = '', sentences = [3, 4] } = {}) {
  const problems = lineProblems(text, { requirements, description, summary: true });
  const lists = listSentences(text);
  if (lists.length) problems.push(`"${lists[0].trim().slice(0, 80)}" reads as a list of tools; keep the technologies, inside a sentence about the work done with them`);
  const [min, max] = sentences;
  const count = sentencesOf(text).length;
  if (count < min || summaryWords(text) < MIN_SUMMARY_WORDS) {
    problems.push(
      `it is ${count} sentence${count === 1 ? '' : 's'} and ${summaryWords(text)} words; a summary is ${min}-${max} sentences and at least ${MIN_SUMMARY_WORDS} words — the candidate's level and years as stated, their strongest relevant experience, the technologies that matter for this job inside sentences about work, and what they are known for; say more about the work the line already names, and add no fact it does not`
    );
  }
  return problems;
}

/**
 * The lines of a tailoring worth repairing: the summary when the model rewrote it, and the
 * bullets it rewrote or added, each with its problems. [{ id, role, text, problems }], `role`
 * null for the summary. `requirements` are the job's (workspace/service.js anchoredJob), for
 * the lines that repeat one; `style` the mode, for the summary's length.
 */
export function repairTargets(tailored, sourceForm, { requirements = [], description = '', style } = {}) {
  const targets = [];
  const summary = tailored.form.summary || '';
  if (summary && lower(summary) !== lower(sourceForm?.summary)) {
    const problems = summaryProblems(summary, { requirements, description, sentences: tailorMode(style).summarySentences });
    if (problems.length) targets.push({ role: null, text: summary, problems });
  }
  // A line with an estimate is the candidate's to edit; a repair would lose track of its clause.
  const estimated = new Set((tailored.estimates || []).map((e) => e.text));
  // The role's bullets as the resume had them: what a real line about that role would name.
  const roleTextOf = (role) => (sourceForm?.experience?.[role]?.achievements || []).join('\n');
  for (const change of tailored.changes || []) {
    if (change.kind === 'removed' || !change.after || estimated.has(change.after)) continue;
    const roleText = roleTextOf(change.role);
    const before = change.before || '';
    const problems = lineProblems(change.after, { requirements, description, roleText, before });
    if (problems.length) targets.push({ role: change.role, text: change.after, problems, roleText, before });
  }
  return targets.slice(0, REPAIR_MAX_LINES).map((t, id) => ({ id, ...t }));
}

export const REPAIR_SYSTEM_PROMPT = 'You fix the wording of resume lines. You never add, drop or change a fact. Respond with JSON only.';

/** The repair prompt: each flagged line with its problems, and the rules a fix must keep. `style` sets the summary's length. */
export function buildRepairPrompt(targets, { style } = {}) {
  const [min, max] = tailorMode(style).summarySentences;
  const lines = targets.map((t) => `${t.id}. ${t.role === null ? '(summary) ' : ''}${t.text}\n   Problem: ${t.problems.join('; ')}.`).join('\n');
  return {
    system: REPAIR_SYSTEM_PROMPT,
    user: `Rewrite each resume line below to fix only its problem.

Rules:
- Keep every fact: every employer, product, technology, number and result the line names stays, and nothing new is added.
- Keep every technology and job term the line uses, spelled the same.
- A bullet stays one sentence under 30 words that opens with the action. The summary is ${min}-${max} sentences and at least ${MIN_SUMMARY_WORDS} words: when it is told it says too little, say more about the work and the technologies it already names — what was built or run with them, for whom, at what scale the line already states — never a number, employer or tool it does not name.
- Plain text: no markdown, no bullet symbol, no long dash.
${RESUME_VOICE_RULES}

LINES:
${lines}

Answer with every line, under its number as "id".`,
  };
}

/**
 * The tailoring with the repairs that pass applied. `answer` is the model's { lines: [{ id,
 * text }] }; `protectedKeywords` are the job's terms. A repair stands only when it has fewer
 * problems than the line it replaces, states no fact the sources lack, and keeps every job term
 * the line carried. Returns { form, changes, repaired } with `repaired` the number applied.
 */
export function applyRepairs(tailored, targets, answer, { protectedKeywords = [], requirements = [], description = '', style } = {}) {
  const byId = new Map((Array.isArray(answer?.lines) ? answer.lines : []).filter((l) => Number.isInteger(l?.id) && typeof l.text === 'string').map((l) => [l.id, cleanListItem(l.text)]));
  const form = { ...tailored.form, experience: tailored.form.experience.map((e) => ({ ...e, achievements: [...e.achievements] })) };
  const changes = (tailored.changes || []).map((c) => ({ ...c }));
  const sentences = tailorMode(style).summarySentences;
  let repaired = 0;
  for (const target of targets) {
    const text = byId.get(target.id);
    if (!text || text === target.text) continue;
    const problems = target.role === null ? summaryProblems(text, { requirements, description, sentences }) : lineProblems(text, { requirements, description, roleText: target.roleText ?? null, before: target.before || '' });
    const better = problems.length < target.problems.length;
    const keepsTerms = !protectedKeywords.some((k) => hasKeyword(target.text, k) && !hasKeyword(text, k));
    if (!better || !keepsTerms || lostDetails(target.text, text).length || (tailored.sources && inventsFact(text, tailored.sources))) continue;
    if (target.role === null) {
      form.summary = text;
    } else {
      const bullets = form.experience[target.role]?.achievements;
      const at = bullets ? bullets.indexOf(target.text) : -1;
      if (at < 0) continue;
      bullets[at] = text;
      for (const c of changes) if (c.role === target.role && c.after === target.text) c.after = text;
    }
    repaired += 1;
  }
  return { form, changes, repaired };
}
