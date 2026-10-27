import { hasKeyword } from '../text/keywords.js';
import { cleanStructuredResume, structuredResumeToText } from '../resume/structuredResume.js';
import { factSources } from '../checks/index.js';
import { traceBullets, writtenBullets } from './bullets.js';
import { withoutRepeatedBullets } from './detail.js';
import { inventsFact } from './claims.js';
import { resumeHeadline } from './headline.js';
import { allowedSkills, backedSkillGroups, limitSkills, namesSkill, tailoredSkillGroups } from './skills.js';
import { tailorMode } from './style.js';
import { summaryWithoutClaims, summaryWithoutLists, summaryWithoutNewStack, summaryWithSourceCredentials, summaryWithSourceTenure, titleTerms } from './summary.js';
import { contentWords, lower, unique } from './text.js';

// ── The tailored form ──────────────────────────────────────────────────────
//
// What the code decides for itself after the model answers. Everything that is a fact rather
// than wording — who the candidate is, where they worked and when, what they studied — is put
// back from the source here, so a rewrite can never change it.

// Facts are compared without case, spacing or punctuation: "2019 – Present" is "2019-present".
const fact = (value) => lower(value).replace(/[^a-z0-9]+/g, '');
const sameFact = (a, b) => Boolean(fact(a)) && fact(a) === fact(b);
// "Northwind, Inc." is "Northwind": one name may carry a suffix the other lacks.
function sameName(a, b) {
  const [x, y] = [fact(a), fact(b)];
  return x.length > 2 && y.length > 2 && (x.startsWith(y) || y.startsWith(x));
}

/**
 * Pair each source entry with the entry the model wrote for it. `rules` run strictest first,
 * each over every unpaired entry before the next, so a loose match never takes an entry a
 * strict one would have claimed (two roles at one employer). When the model returned the same
 * number of entries, what is left pairs by position. An entry the model wrote that pairs with
 * nothing is an invention and is left out.
 */
function pairEntries(sourceEntries, written, rules) {
  const pairs = sourceEntries.map(() => null);
  const free = new Set(written.keys());
  const byPosition = (_source, _written, s, w) => sourceEntries.length === written.length && s === w;
  for (const rule of [...rules, byPosition]) {
    sourceEntries.forEach((entry, s) => {
      if (pairs[s]) return;
      for (const w of free) {
        if (rule(entry, written[w], s, w)) {
          pairs[s] = written[w];
          free.delete(w);
          break;
        }
      }
    });
  }
  return pairs;
}

const EXPERIENCE_RULES = [
  (a, b) => sameName(a.company, b.company) && sameFact(a.period, b.period),
  (a, b) => sameName(a.company, b.company) && sameFact(a.title, b.title),
  (a, b) => sameName(a.company, b.company),
];
const PROJECT_RULES = [(a, b) => sameName(a.name, b.name)];

// Sections that tell a recruiter nothing about fit; a tailored resume never carries them.
const FILLER_SECTION_RE = /^\s*(interests?|hobbies|hobbies (and|&) interests|references?)\s*$/i;

// A resume-wide achievement ("Built full-stack AI applications using React, Python…") that the
// summary or one bullet already says, once those are rewritten for the job: an Achievements
// section at the foot repeating the experience above reads as padding. Prod's tailored resumes
// (2026-10-07) put most such lines at 0.6 or more of their words in one other line.
const REPEATED_SHARE = 0.6;
const figures = (text) => String(text || '').match(/\d[\d,.]*\s*[+%kKmMbB]?/g)?.map((n) => n.replace(/\s+/g, '')) || [];

/** The achievements the summary or a bullet does not already say; a line whose figure is shown nowhere else stays. */
export function achievementsNotRepeated(achievements = [], { summary = '', experience = [] } = {}) {
  const others = [summary, ...experience.flatMap((e) => e.achievements || [])].filter(Boolean);
  return achievements.filter((line) => {
    const own = contentWords(line);
    if (!own.size) return true;
    return !others.some((other) => {
      const theirs = contentWords(other);
      const share = [...own].filter((w) => theirs.has(w)).length / own.size;
      return share >= REPEATED_SHARE && figures(line).every((n) => figures(other).includes(n));
    });
  });
}

/** Every figure, tenure and certification a rewrite may state: the resume's own, and what the user told us. */
export function tailoringSources(source, confirmedKeywords = [], evidence = []) {
  return factSources(source, structuredResumeToText(source), [...confirmedKeywords, ...(evidence || []).map((e) => e?.note || '')].join('\n'));
}

/**
 * The tailored resume form: the model's wording on the source resume's facts. Of the missing
 * keywords the user was offered, `confirmedKeywords` are the ones they have (`evidence` is
 * what they said about them), `assumedKeywords` the ones they were not asked to confirm, and
 * `blockedKeywords` the ones they declined; `style` is the mode (style.js), which sets how many
 * lines a role may gain that come from no bullet and name no keyword, the caps on assumed
 * terms and the estimated figures; `protectedKeywords`
 * are what the job asks for — a bullet or a skill that names one is never cut. `headline` is the
 * model's { role, specialties } and `job` the job it was written for (resumeHeadline); the
 * skills are cut to what the job needs (limitSkills), and `droppedSkills` lists the resume's own
 * skills left out; `estimates` are the bullets given a realistic figure the resume did not state,
 * for the candidate to edit or remove. Returns { form, pairedExperience, changes } —
 * `changes` is every experience bullet rewritten, added or removed, as [{ role, kind, before,
 * after }] with `role` an index into experience; the caller treats a rewrite that paired with
 * none of the source's roles as a failed attempt.
 */
export function tailoredResumeForm(
  sourceForm,
  written,
  { confirmedKeywords = [], assumedKeywords = [], evidence = [], blockedKeywords = [], protectedKeywords = [], style, headline = null, job = null } = {}
) {
  const mode = tailorMode(style);
  const limits = { perLine: mode.maxTermsPerLine, perRole: mode.maxTermsPerRole };
  const source = cleanStructuredResume(sourceForm);
  const draft = cleanStructuredResume(written);
  const confirmed = confirmedKeywords || [];
  const sources = tailoringSources(source, confirmed, evidence);
  const sourceText = structuredResumeToText(source);

  // The form's cleaning flattens bullets to strings, so the traced ones are read from the answer itself.
  const writtenRoles = (Array.isArray(written?.experience) ? written.experience : [])
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({ company: lower(e.company), title: lower(e.title), period: lower(e.period), bullets: writtenBullets(e.achievements) }));
  const roles = pairEntries(source.experience, writtenRoles, EXPERIENCE_RULES);
  let changes = [];
  let estimated = [];
  // `list` is the role's estimates, `taken` every earlier role's: a figure is stated once in the resume.
  const budget = { left: mode.maxEstimates, list: [], taken: estimated };
  // What the job asks for by name: the words a line may share with another role's bullet.
  const jobText = [...protectedKeywords, ...(assumedKeywords || []), ...confirmed, ...(job?.skills || []), ...(job?.preferredSkills || [])].join('\n');
  const tracedRoles = source.experience.map((entry, role) => {
    if (!roles[role]) return entry;
    budget.list = [];
    const traced = traceBullets(entry.achievements, roles[role].bullets, {
      confirmed,
      assumed: assumedKeywords || [],
      blocked: blockedKeywords || [],
      sources,
      protectedKeywords,
      newBullets: mode.newBulletsPerRole,
      limits,
      estimates: budget,
      elsewhere: source.experience.filter((_, i) => i !== role).flatMap((e) => e.achievements),
      jobText,
      sourceText,
    });
    changes.push(...traced.changes.map((c) => ({ role, ...c })));
    estimated.push(...budget.list.filter((e) => traced.bullets.includes(e.text)).map((e) => ({ role, ...e })));
    return { ...entry, achievements: traced.bullets };
  });
  // The same work said twice, in one role or across two, is said once (detail.js).
  const deduped = withoutRepeatedBullets({ form: { experience: tracedRoles }, changes, estimates: estimated }, protectedKeywords);
  const experience = deduped.form.experience;
  changes = deduped.changes;
  estimated = deduped.estimates;

  // Projects may be dropped or reordered, so the model's order stands; their facts do not change.
  const projectPairs = pairEntries(source.projects, draft.projects, PROJECT_RULES);
  const projects = draft.projects
    .map((p) => {
      const i = projectPairs.indexOf(p);
      return i < 0 ? null : { ...source.projects[i], highlights: p.highlights.length ? p.highlights : source.projects[i].highlights };
    })
    .filter(Boolean);

  const sourceTitles = new Set(source.otherSections.map((o) => lower(o.title)));
  const added = [...confirmed, ...(assumedKeywords || [])];
  let skills;
  let skillGroups = [];
  if (source.skillGroups.length) {
    // The resume's categories stay; the model only orders and trims what is in them.
    skillGroups = tailoredSkillGroups(source.skillGroups, draft.skillGroups, { blocked: blockedKeywords, protectedKeywords, confirmed });
    skills = skillGroups.flatMap((g) => g.items);
  } else {
    // What the user confirmed is in the skills list whether or not the model remembered it.
    const kept = allowedSkills(draft.skills.length ? draft.skills : source.skills, blockedKeywords);
    // A skill the job names stays, even when the model trimmed it away with the irrelevant ones.
    const named = draft.skills.length ? source.skills.filter((skill) => protectedKeywords.some((k) => namesSkill(skill, k))) : [];
    skills = unique([...kept, ...named, ...confirmed.filter((k) => !kept.some((skill) => hasKeyword(skill, k)))]);
  }
  // A skill the posting's own text names is relevant whether or not its skills list has it
  // ("Monitoring & Observability: Datadog" asks for monitoring).
  const textNamed = job?.description ? source.skills.filter((skill) => hasKeyword(job.description, skill)) : [];
  const limited = limitSkills(source, skillGroups.length ? skillGroups : [{ category: '', items: skills }], {
    relevant: [...protectedKeywords, ...added, ...textNamed],
    named: [...(job?.skills || []), ...(job?.preferredSkills || []), ...confirmed],
    assumed: assumedKeywords || [],
    confirmed,
    // The work on the page, for a list the cut left short (limitSkills tops it up from what this names).
    shown: [...experience.flatMap((e) => e.achievements || []), ...projects.flatMap((p) => p.highlights || [])].join('\n'),
  });
  const jobTerms = [...protectedKeywords, ...(job?.skills || []), ...(job?.preferredSkills || [])];
  const summary =
    draft.summary && !inventsFact(draft.summary, sources)
      ? summaryWithSourceCredentials(
          summaryWithSourceTenure(
            summaryWithoutNewStack(
              summaryWithoutClaims(summaryWithoutLists(draft.summary, source.summary, { minSentences: mode.summarySentences[0] }), source.summary, { terms: jobTerms, allowed: added, sourceText }),
              source.summary,
              { sourceText, confirmed: added }
            ),
            source.summary,
            [...protectedKeywords, ...titleTerms(job?.title)]
          ),
          source.summary
        )
      : source.summary;
  // A skill new to the resume with no line of work behind it comes off; the resume's own skills
  // and what the user confirmed stay.
  const shown = [summary, ...experience.flatMap((e) => e.achievements || []), ...projects.flatMap((p) => p.highlights || [])].join('\n');
  const backedGroups = backedSkillGroups(limited.groups, { sourceSkills: source.skills, confirmed, shown });
  skillGroups = skillGroups.length ? backedGroups : [];
  skills = backedGroups.flatMap((g) => g.items);

  return {
    pairedExperience: roles.filter(Boolean).length,
    changes,
    droppedSkills: limited.dropped,
    // The bullets that carry an estimated figure: [{ role, text, plain, clause }].
    estimates: estimated,
    // What the rewrite was checked against, for a repair of it to be checked the same way.
    sources,
    form: {
      ...source,
      title: resumeHeadline(source, headline, { jobTitle: job?.title, company: job?.company, sourceText: [sourceText, ...confirmed].join('\n') }),
      summary,
      skills,
      skillGroups,
      experience,
      projects,
      achievements: achievementsNotRepeated(draft.achievements, { summary, experience }),
      otherSections: draft.otherSections.filter((o) => sourceTitles.has(lower(o.title)) && !FILLER_SECTION_RE.test(o.title)),
    },
  };
}

/**
 * The tailored resume with everything it cut put back: removed bullets return to their roles,
 * and dropped achievements, projects and sections return after the kept ones. The skills stay as
 * limitSkills left them: the job's own are in them already, and the rest is a list's length,
 * not evidence. The rewording stays. This is what tailoring falls back on when its cuts cost more score than its
 * rewrites earned. Returns { form, changes } with the `removed` changes gone.
 */
export function withoutCuts(sourceForm, tailoredForm, changes = []) {
  const source = cleanStructuredResume(sourceForm);
  const removed = changes.filter((c) => c.kind === 'removed');
  const experience = tailoredForm.experience.map((entry, role) => ({
    ...entry,
    achievements: unique([...entry.achievements, ...removed.filter((c) => c.role === role).map((c) => c.before)]),
  }));
  const keptProjects = new Set(tailoredForm.projects.map((p) => lower(p.name)));
  const keptSections = new Set(tailoredForm.otherSections.map((o) => lower(o.title)));
  return {
    changes: changes.filter((c) => c.kind !== 'removed'),
    form: {
      ...tailoredForm,
      experience,
      projects: [...tailoredForm.projects, ...source.projects.filter((p) => !keptProjects.has(lower(p.name)))],
      achievements: achievementsNotRepeated(unique([...tailoredForm.achievements, ...source.achievements]), { summary: tailoredForm.summary, experience }),
      otherSections: [...tailoredForm.otherSections, ...source.otherSections.filter((o) => !keptSections.has(lower(o.title)) && !FILLER_SECTION_RE.test(o.title))],
    },
  };
}
