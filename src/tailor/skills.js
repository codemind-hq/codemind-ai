import { hasKeyword } from '../text/keywords.js';
import { canonicalSkill } from '../text/dict/skills.js';
import { addToSkillGroups, mergeSkillGroups, OTHER_CATEGORY } from '../resume/structuredResume.js';
import { lower, squash } from './text.js';

// ── Skills: relevance and count ────────────────────────────────────────────
//
// A skills section longer than the experience reads as keyword stuffing, and the model, told to
// drop what the job does not need, kept all 82 of one resume's skills and added seven. So the
// cut is code's: what the job names first, in the job's own order, then the model's order, at
// most MAX_SKILLS in all (MAX_JOB_SKILLS when the job's own would otherwise be cut, never for
// anything else), at most MAX_OTHER_SKILLS the job does not ask for and MAX_GROUP_OTHERS of them
// in a category — the categories that name something the job asks for take theirs first, so a
// DevOps job's Cloud category keeps Docker and Linux before a database category keeps Firebase.
// A category with nothing the job names stays only when the model ranked it among the first
// LEADING_GROUPS. A category left with one skill reads as a leftover ("Testing: Monitoring", on
// a resume whose Testing category had seven), so one the job's own skills leave alone takes a
// second — the model's next for it, else the resume's own from that category — before the other
// categories fill, and one the fill leaves alone with a skill the job does not ask for goes.
// Soft skills, job titles and leftover labels ("Languages:") are never skills. A skill the
// rewrite added stays only when the job lists it, the user confirmed it, or the skill dictionary
// knows it: the rest are activities and job-ad phrases ("code reviews", "Token economics"). A
// term written in on assumption — asked for by the job, never confirmed — is a skill only when
// the dictionary knows it: the skills list is a bare claim, and "wire" or "instant payment
// networks" under Other is the posting's wording, not a skill. Repeats go, after a trailing dash
// is stripped ("Github Actions-"), by what the dictionary resolves them to ("Go", "Golang"), and
// by the skill a phrase names ("Terraform modules" beside "Terraform"). Every skill of the
// resume's own that is cut is reported, for the user to put back.

const MAX_SKILLS = 30;
const MAX_JOB_SKILLS = 35;
const MAX_OTHER_SKILLS = 15;
const MAX_GROUP_OTHERS = 4;
const MIN_GROUP = 2;
const LEADING_GROUPS = 3;
// "Terraform modules", "Kafka clusters", "CI/CD pipelines": the skill's name with a generic noun.
const GENERIC_SKILL_WORDS_RE = /\b(?:modules?|pipelines?|clusters?|environments?|deployments?|workflows?|tooling|tools|stack)\b/gi;
// Matched inside a word too: resumes read from a PDF run words together ("Fastauto-didacticLearner").
const SOFT_SKILL_RE =
  /team ?player|thinker|learner|innovator|self[- ]?starter|self[- ]?motivated|detail[- ]oriented|hard[- ]?working|interpersonal|communication skills|people skills|problem[- ]?solv|critical thinking|time management|work ethic|fast learner|leadership skills/i;
const JOB_TITLE_SKILL_RE = /(engineer|developer|manager|consultant|architect|specialist|analyst)$/i;
const LABEL_RE = /:\s*$/;
// "Github Actions-", "Speech-to-Text-": a dash the resume's parse left at the end.
const cleanSkill = (skill) => squash(skill).replace(/[\s\-–—]+$/, '');
/** One skill however it is spaced or punctuated: "AWS incl.EKS" is "AWSincl.EKS". */
export const skillKey = (skill) => lower(skill).replace(/[^a-z0-9+#]+/g, '');

// A word that names a kind of work, not a skill: the job's "API" written into Backend and API as
// a skill of its own. One the resume itself lists stays; the rewrite never adds one.
const GENERIC_SKILL_RE = /^(?:apis?|backend|back-end|frontend|front-end|cloud|software|code|coding|programming|development|systems?|platforms?|tools?|data|technology|engineering)$/i;

/**
 * The spellings a skill or a job term goes by: itself, without its parentheses, and what the
 * parentheses hold. "Model Context Protocol (MCP)" is "MCP", so "MCP Protocol (stdio + HTTP)"
 * names it.
 */
export function termForms(term) {
  const text = squash(term);
  const inner = [...text.matchAll(/\(([^()]+)\)/g)].map((m) => squash(m[1]));
  const outer = squash(text.replace(/\([^()]*\)/g, ' '));
  return [...new Set([text, outer, ...inner].filter((f) => f.length >= 2))];
}
/** True when `skill` and `term` name the same thing under any of their spellings (termForms). */
export const namesSkill = (skill, term) => termForms(skill).some((s) => termForms(term).some((k) => hasKeyword(s, k) || hasKeyword(k, s)));

/**
 * A skill the user was offered and did not confirm stays out of the skills list: that list is
 * a bare claim, with no bullet behind it to show how the skill was used.
 */
export function allowedSkills(skills, blocked) {
  if (!blocked.length) return skills;
  return skills.filter((skill) => !blocked.some((k) => hasKeyword(skill, k)));
}

/**
 * The tailored skills of a resume that lists them by category: the model's order of categories
 * and skills, under the resume's own category names. A skill of the resume's own stays in its own
 * category wherever the model put it (Python is a language, not a backend skill, because the
 * resume said so); the model places only the skills new to the resume, and one in a category the
 * resume does not have goes in Other. A skill the job names that the model dropped goes back in
 * its category; a confirmed keyword the model left out goes in Other. Returns the groups.
 */
export function tailoredSkillGroups(sourceGroups, draftGroups, { blocked, protectedKeywords, confirmed }) {
  const names = new Map(sourceGroups.map((g) => [lower(g.category), g.category]));
  const home = new Map(sourceGroups.flatMap((g) => g.items.map((skill) => [lower(skill), g.category])));
  let groups = [];
  for (const g of draftGroups.length ? draftGroups : sourceGroups) {
    const category = names.get(lower(g.category)) ?? OTHER_CATEGORY;
    for (const skill of allowedSkills(g.items, blocked)) groups = addToSkillGroups(groups, [skill], home.get(lower(skill)) ?? category);
  }
  if (draftGroups.length) {
    const named = sourceGroups.map((g) => ({ category: g.category, items: g.items.filter((skill) => protectedKeywords.some((k) => namesSkill(skill, k))) }));
    groups = mergeSkillGroups(groups, named);
  }
  const listed = groups.flatMap((g) => g.items);
  return addToSkillGroups(
    groups,
    confirmed.filter((k) => !listed.some((skill) => hasKeyword(skill, k)))
  );
}

/**
 * The skills a tailored resume keeps. `groups` are the tailored skills by category (one group
 * with category '' for a resume without categories), `relevant` every term the job asks for,
 * `named` the skills the job itself lists and the ones the user confirmed, `assumed` the terms
 * written in on assumption and `confirmed` the ones the user confirmed. Returns { groups,
 * dropped }: `dropped` is [{ skill, category }] of the source resume's own skills left out.
 */
export function limitSkills(
  source,
  groups,
  { relevant = [], named = [], assumed = [], confirmed = [], max = MAX_SKILLS, jobMax = MAX_JOB_SKILLS, otherMax = MAX_OTHER_SKILLS, perGroup = MAX_GROUP_OTHERS } = {}
) {
  const sourceKeys = new Set((source.skills || []).map(skillKey));
  const term = (k) => typeof k === 'string' && k.trim();
  const matches = (skill, terms) => terms.some((k) => term(k) && namesSkill(skill, k));
  const own = (skill) => sourceKeys.has(skillKey(skill));
  const known = (skill) => Boolean(canonicalSkill(skill));
  // Written in on assumption, never confirmed, not the resume's own and not a skill the dictionary knows.
  const bareAssumption = (skill) => matches(skill, assumed) && !matches(skill, confirmed) && !own(skill) && !known(skill);
  const isSkill = (skill) =>
    !SOFT_SKILL_RE.test(skill) &&
    !LABEL_RE.test(skill) &&
    !bareAssumption(skill) &&
    !(GENERIC_SKILL_RE.test(cleanSkill(skill)) && !own(skill)) &&
    (matches(skill, named) || (!JOB_TITLE_SKILL_RE.test(skill) && (own(skill) || known(skill))));
  const flat = groups.length === 1 && !groups[0].category;

  // Each skill once, in the first place it appears; a phrase of a skill that is listed is that skill.
  const listed = new Set(groups.flatMap((g) => g.items).map(skillKey));
  const seen = new Set();
  const candidates = groups.map((g) =>
    g.items
      .filter(isSkill)
      .map(cleanSkill)
      .filter((skill) => {
        const keys = [skillKey(skill), canonicalSkill(skill)].filter(Boolean);
        if (!skill || keys.some((k) => seen.has(k))) return false;
        const base = skillKey(skill.replace(GENERIC_SKILL_WORDS_RE, ' '));
        if (base && base !== skillKey(skill) && listed.has(base)) return false;
        keys.forEach((k) => seen.add(k));
        return true;
      })
  );
  const isRelevant = (skill) => matches(skill, [...relevant, ...named]);
  // Where the job lists a skill: its own stack comes out in its order, the rest after.
  const rank = (skill) => {
    const at = named.findIndex((k) => term(k) && namesSkill(skill, k));
    return at < 0 ? named.length : at;
  };
  const kept = groups.map(() => []);
  const filled = groups.map(() => 0);
  let count = 0;
  let others = 0;
  const keep = (i, skill) => {
    kept[i].push(skill);
    count += 1;
  };
  // What the job names first, wherever it is, in the job's order: up to jobMax of them.
  candidates.forEach((items, i) => {
    const wanted = items.filter(isRelevant).map((skill, pos) => ({ skill, rank: rank(skill), pos }));
    wanted.sort((a, b) => a.rank - b.rank || a.pos - b.pos);
    for (const { skill } of wanted) if (count < jobMax) keep(i, skill);
  });
  // A category the job's own skills left with one takes a second before the rest fill: the
  // model's next for it, else the resume's own from that category (added to the candidates, so
  // it comes out with them). It counts as one the job does not ask for, except against otherMax.
  const keptKeys = () => new Set(kept.flat().flatMap((skill) => [skillKey(skill), canonicalSkill(skill)]).filter(Boolean));
  if (!flat) {
    kept.forEach((items, i) => {
      if (items.length !== 1 || count >= jobMax) return;
      let second = candidates[i].find((skill) => !items.includes(skill));
      if (!second) {
        const taken = keptKeys();
        const pool = (source.skillGroups || []).find((g) => lower(g.category) === lower(groups[i].category))?.items || [];
        second = pool.filter(isSkill).map(cleanSkill).find((skill) => skill && !taken.has(skillKey(skill)) && !taken.has(canonicalSkill(skill)));
        if (second) candidates[i].push(second);
      }
      if (!second) return;
      keep(i, second);
      others += 1;
      filled[i] += 1;
    });
  }
  // Then the model's order: the categories that speak to the job first, then the ones it put
  // first; up to max in all, no more than otherMax the job does not ask for, and no more than
  // perGroup of those in a category (otherMax for a resume without categories).
  const order = candidates.map((_, i) => i).sort((a, b) => Number(!kept[a].length) - Number(!kept[b].length) || a - b);
  const starved = groups.map(() => false);
  for (const i of order) {
    if (!kept[i].length && i >= LEADING_GROUPS) continue;
    for (const skill of candidates[i]) {
      if (filled[i] >= (flat ? otherMax : perGroup) || kept[i].includes(skill)) continue;
      if (count >= max || others >= otherMax) {
        starved[i] = true;
        break;
      }
      keep(i, skill);
      others += 1;
      filled[i] += 1;
    }
  }
  // A category the budget cut to one skill the job does not ask for is a leftover, not a category
  // (one the model itself returned with one skill is the model's choice).
  if (!flat) kept.forEach((items, i) => starved[i] && items.length < MIN_GROUP && !items.some(isRelevant) && kept[i].splice(0));

  const out = groups
    .map((g, i) => ({ category: g.category, items: candidates[i].filter((s) => kept[i].includes(s)) }))
    .filter((g) => g.items.length);
  // Kept under this spelling or another: "Golang" is not lost while "Go" stays.
  const final = new Set(out.flatMap((g) => g.items).flatMap((skill) => [skillKey(skill), canonicalSkill(skill)]).filter(Boolean));
  const isKept = (skill) => final.has(skillKey(skill)) || final.has(canonicalSkill(skill));
  const categoryOf = (skill) => (source.skillGroups || []).find((g) => g.items.some((s) => lower(s) === lower(skill)))?.category || '';
  const dropped = (source.skills || [])
    .filter((s) => !isKept(cleanSkill(s)) && !LABEL_RE.test(s))
    .map((skill) => ({ skill: cleanSkill(skill), category: categoryOf(skill) }));
  return { groups: out, dropped };
}

/**
 * The skill groups with every skill that has no line of work behind it taken out: a skill new to
 * the resume with no line of work behind it is a bare claim — the posting's list copied into
 * skills (nine networking terms in an Other group, on a web engineer's resume). The resume's own
 * skills, what the user `confirmed`, and what the resume's text (`shown`) names stay.
 */
export function backedSkillGroups(groups, { sourceSkills = [], confirmed = [], shown = '' }) {
  const own = new Set(sourceSkills.flatMap((s) => [skillKey(s), canonicalSkill(s)]).filter(Boolean));
  const backed = (skill) => own.has(skillKey(skill)) || own.has(canonicalSkill(skill)) || confirmed.some((k) => hasKeyword(skill, k)) || hasKeyword(shown, skill);
  return groups.map((g) => ({ ...g, items: g.items.filter(backed) })).filter((g) => g.items.length);
}
