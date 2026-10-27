import { hasKeyword } from '../../text/keywords.js';
import { structuredResumeToText } from '../../resume/structuredResume.js';
import { compact, jobForModel, verifiedSkills } from '../../ats/index.js';
import { jobPostingBlock } from '../../text/fence.js';
import { fieldNotesFor } from '../fieldNotes.js';
import { openRequirements } from '../requirements.js';
import { DEFAULT_TAILOR_STYLE, PLAUSIBLE_BY_STYLE, tailorMode, tailorStyle } from '../style.js';
import { lower } from '../text.js';

// What the tailoring prompt (tailor.js) and the new-resume prompt (generate.js) both show the
// model: the resume, the keyword rules, the scorer's findings and the job. The instructions
// and the STYLE section are each prompt's own.

const CONTACT_FIELDS = ['name', 'email', 'phone', 'location', 'linkedin', 'github', 'portfolio'];
const LIMITS = { bulletChars: 500, summaryChars: 2000, contentChars: 1500, budgetChars: 20000 };
const TIGHT = { bulletChars: 260, summaryChars: 1200, contentChars: 600, budgetChars: Infinity };
const JOB_DESCRIPTION_CHARS = 12000;
const INSTRUCTIONS_CHARS = 4000;
const NOTE_ITEMS = 8;

const cut = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The resume as the tailoring model sees it: the whole form as JSON, contact details left
 * out. Unlike the scorer's view no bullet is dropped — what the model cannot see it cannot
 * keep — so an over-long resume gets shorter strings instead.
 */
export function resumeBlock(form, limits = LIMITS) {
  const bullets = (arr) => (arr || []).map((b) => cut(b, limits.bulletChars));
  const out = {
    ...form,
    summary: cut(form.summary, limits.summaryChars),
    // Experience bullets carry their index: the model cites it for every bullet it writes.
    experience: (form.experience || []).map((e) => ({ ...e, achievements: bullets(e.achievements).map((text, i) => ({ i, text })) })),
    projects: (form.projects || []).map((p) => ({ ...p, highlights: bullets(p.highlights) })),
    achievements: bullets(form.achievements),
    otherSections: (form.otherSections || []).map((o) => ({ ...o, content: cut(o.content, limits.contentChars) })),
  };
  // Grouped skills are shown once, in their groups; the heading is the program's to keep.
  if (out.skillGroups?.length) delete out.skills;
  delete out.skillsHeading;
  for (const f of CONTACT_FIELDS) delete out[f];
  const block = JSON.stringify(compact(out) || {});
  return block.length > limits.budgetChars && limits !== TIGHT ? resumeBlock(form, TIGHT) : block;
}

// Every mode's STYLE lead holds the same facts fixed.
export const HARD_LIMITS =
  'employers, job titles, dates, degrees and certifications stay exactly as RESUME has them, and no number, percentage or metric appears that RESUME does not state, other than the estimates "How to tailor" allows.';
export const HARD_LIMITS_SENTENCE = `${HARD_LIMITS[0].toUpperCase()}${HARD_LIMITS.slice(1)}`;

/**
 * The scorer's verdict on every requirement the resume did not meet, so the rewrite answers
 * the rubric it is marked by and not a six-item digest of it (scorerNotes). A measured
 * requirement is marked as one, because a line meets it only with a figure (score/verdicts.js).
 * A nice-to-have is on the list only for the mode that writes those in (style.js preferredGaps).
 */
function requirementVerdicts(scoring, style) {
  const open = openRequirements(scoring, { preferred: tailorMode(style).preferredGaps });
  return open.length ? open.map(({ line }) => `- ${line}`).join('\n') : null;
}

/**
 * Which keywords the rewrite may add. `confirmed` null means the user was never asked.
 * `evidence` is what the user said about a confirmed keyword: [{ keyword, role, note }], `role`
 * an index into the resume's experience. With it the model writes what the user told it, not
 * a guess at where the skill was used. `assumed` are missing keywords the user neither confirmed
 * nor declined: added where plausible, and listed afterwards for the user to keep or remove.
 */
export function keywordRules(confirmed, evidence, source, assumed = [], style = DEFAULT_TAILOR_STYLE, optional = []) {
  if (!Array.isArray(confirmed)) {
    return 'Add a keyword from the job only when RESUME already demonstrates it under another name or clearly implies it ("REST APIs" for a bullet about building HTTP endpoints). When unsure, leave it out.';
  }
  const nothingElse =
    'skill, tool or technology that RESUME does not already contain, even if the job asks for it. A category the job names is not a new skill when RESUME names a member of it: a resume with PostgreSQL and MySQL may say "relational databases (PostgreSQL, MySQL)", one with AWS may say "cloud infrastructure on AWS". Use the job\'s term that way, in the summary or the bullet that shows it, with the member named beside it.';
  // Added where the candidate's existing work makes it plausible, by the mode's bar (style.js
  // PLAUSIBLE_BY_STYLE): the balanced and realistic modes' rule for every assumed keyword, and
  // the score-first mode's for a nice-to-have.
  const mode = tailorStyle(style);
  const lean =
    mode === 'realistic'
      ? 'Add only the ones the candidate\'s existing work makes plausible by the bar below; when unsure, leave it out and name it in suggestions.'
      : 'Add the ones the candidate\'s existing work makes plausible, and lean towards adding: the candidate reviews every addition and removes what is not true.';
  const plausible = (list, lead) => `${lead} ${list.join(', ')}.
${lean} ${PLAUSIBLE_BY_STYLE[mode]}
One you add goes in skills, and gets one line that reads like the candidate wrote it: either extend the bullet where it would have been used, or write one new bullet ("from": null) in the role where it most plausibly belongs. Prefer extending: a new bullet is for a keyword no existing bullet can carry. The line is about work the role already describes — name the actual product, system or feature that role's other bullets name, in this candidate's own nouns — with the keyword as the tool or method used, in the same voice, length and level of detail as the bullets around it. It must be a sentence only this resume could contain: no stock phrasing, and never two resumes' worth of the same line. Extending a bullet keeps what that bullet says: a frontend bullet stays a frontend bullet. Never a number, a percentage, an outcome, a team size, or a product, customer or system the resume does not mention, and never a claim of expertise ("expert in", "deep experience with").`;
  const parts = [];
  if (confirmed.length) {
    const lines = confirmed.map((keyword) => {
      const said = (evidence || []).find((e) => lower(e?.keyword) === lower(keyword));
      const role = Number.isInteger(said?.role) ? source.experience[said.role] : null;
      const where = role ? ` — used at ${[role.company, role.title].filter(Boolean).join(', ')}` : '';
      const note = String(said?.note || '').trim();
      return `- ${keyword}${where}${note ? `: "${note.slice(0, 300)}"` : ''}`;
    });
    parts.push(`The candidate confirmed real experience with:
${lines.join('\n')}
This is experience the candidate has: never list it as a gap in suggestions. Each one must appear in skills and at least once in the summary or in a bullet. Where a role is named, put it in that role: extend the bullet it fits, or add one bullet ("from": null) that says only what the candidate's note says. With no role named, use the role where it most plausibly belongs and claim no more than having used it.`);
  }
  if (assumed.length && mode === 'ats') {
    const { maxTermsPerLine, maxTermsPerRole } = tailorMode(mode);
    parts.push(`The job requires these, and the candidate has not said whether they have them: ${assumed.join(', ')}.
Add every one of them: each goes in skills and into a bullet about work it fits — a bullet whose platform, language and stack could have used it — at most ${maxTermsPerLine} of them to a bullet and no more than ${maxTermsPerRole} of them in one role, as STYLE describes. Where the job offers alternatives ("an ORM such as Prisma, TypeORM or Knex"), one or two is enough — nobody lists them all.`);
  } else if (assumed.length) {
    parts.push(plausible(assumed, 'The job also asks for these, and the candidate has not said whether they have them:'));
  }
  if (optional.length) parts.push(plausible(optional, 'The job lists these as nice to have, and the candidate has not said whether they have them:'));
  parts.push(`Add no ${confirmed.length || assumed.length || optional.length ? 'other ' : ''}${nothingElse}`);
  return parts.join('\n\n');
}

/**
 * The scorer's findings worth acting on; accepts a fresh score or a cached match row. A finding
 * about a keyword the user has since confirmed is out of date, and would come back as advice
 * to go and learn what they already know.
 */
export function scorerNotes(scoring, confirmed) {
  if (!scoring) return null;
  const current = (s) => typeof s === 'string' && s.trim() && !confirmed.some((k) => hasKeyword(s, k));
  const list = (v) => (Array.isArray(v) ? v.filter(current).slice(0, NOTE_ITEMS) : []);
  return compact({
    tailoringOpportunities: list(scoring.tailoringOpportunities),
    weakEvidence: list(scoring.weakEvidence),
    missingRequirements: list(scoring.missingRequirements),
  });
}

/**
 * The sections after STYLE, in order: the scorer's findings and verdicts, the candidate's own
 * notes, the verified skills, and the job. `source` is the cleaned resume form.
 */
export function contextSections({ source, job, scoring, confirmedKeywords, instructions, style }) {
  const sections = [];
  // A confirmed keyword counts as found from here on, the same way the scorer's findings do.
  const confirmed = Array.isArray(confirmedKeywords) ? confirmedKeywords : [];
  const notes = scorerNotes(scoring, confirmed);
  if (notes) sections.push(`SCORER_NOTES:\n${JSON.stringify(notes)}`);
  const verdicts = requirementVerdicts(scoring, style);
  if (verdicts) sections.push(`REQUIREMENT_VERDICTS:\n${verdicts}`);
  const own = String(instructions || '').trim();
  if (own) sections.push(`CANDIDATE_INSTRUCTIONS:\n${own.slice(0, INSTRUCTIONS_CHARS)}`);
  sections.push(
    `VERIFIED_SKILLS:\n${JSON.stringify(verifiedSkills(job, [structuredResumeToText(source), ...confirmed].join('\n')))}`,
    `JOB_JSON:\n${JSON.stringify(jobForModel(job))}`,
    fieldNotesFor(job),
    `JOB_DESCRIPTION:\n${jobPostingBlock(job?.description || '', JOB_DESCRIPTION_CHARS)}`
  );
  return sections;
}
