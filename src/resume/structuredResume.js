// A PDF's text carries invisible format characters (a U+202C after a phone number, zero-width
// joiners); an ATS phone parser trips on them, and they never mean anything in a form.
const FORMAT_CHARS_RE = /\p{Cf}/gu;

function asString(value) {
  return typeof value === 'string' ? value.replace(FORMAT_CHARS_RE, '').trim() : '';
}

// A bullet symbol at the start of a list item ("• Led…", "- Led…", "➤ Led…"). Dashes count
// only when followed by a space, so "-5% latency" survives. The editor draws bullets
// itself, so none are stored.
const LEADING_BULLET = /^(?:[•·●▪▫◦‣∙○■□➢➤►▶✓✔*]+\s*|[-–—]+\s+)/;

/** One list item as the form stores it: trimmed, without a leading bullet symbol. */
export const cleanListItem = (item) => asString(item).replace(LEADING_BULLET, '').trim();

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanListItem).filter(Boolean);
}

/** Pick string fields and string-list fields from an entry; null when all are empty. */
function entry(input, fields, listFields = []) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const f of fields) out[f] = asString(input[f]);
  for (const f of listFields) out[f] = asStringArray(input[f]);
  const empty = fields.every((f) => !out[f]) && listFields.every((f) => out[f].length === 0);
  return empty ? null : out;
}

const entries = (value, fields, listFields) =>
  Array.isArray(value) ? value.map((item) => entry(item, fields, listFields)).filter(Boolean) : [];

// The longest strings the form accepts on save (schemas.js structuredResumeSchema). A draft the
// model wrote is cut to the same lengths, or the editor could not save it as it came ("Python,
// Java, Go, …" read as one 130-character skill). Entries and bullets are never dropped: tailoring
// depends on that (tailor/form.js), and a list past the form's count is the editor's to say so.
const TEXT_LIMITS = { name: 200, title: 200, email: 254, phone: 50, location: 200, linkedin: 300, github: 300, portfolio: 300, summary: 5000 };
const LIST_LIMITS = { skills: 100, languages: 100, achievements: 2000 };
const ENTRY_LIMITS = {
  // A role's city and state are for application forms only; the resume's text never shows them.
  experience: { company: 200, title: 200, period: 100, city: 100, state: 100, achievements: 2000 },
  education: { school: 200, degree: 200, location: 200, year: 50 },
  projects: { name: 200, role: 200, period: 100, link: 300, highlights: 2000 },
  certifications: { name: 200, issuer: 200, year: 50 },
  otherSections: { title: 200, content: 10000 },
};
const ENTRY_LISTS = { experience: ['achievements'], projects: ['highlights'] };
const cut = (value, max) => (Array.isArray(value) ? value.map((item) => item.slice(0, max)) : value.slice(0, max));

// ── skills by category ────────────────────────────────────────────────────────
// A resume may list its skills under its own categories ("Languages: Python, Go") and under its
// own heading ("Technical Proficiencies"). `skillGroups` holds them; `skills` stays the flat
// list of the same skills, in the same order, because scoring, search and the profile read that.
// A resume without categories has no groups, only `skills`.

const HEADING_MAX = 60;
const CATEGORY_MAX = 60;
export const OTHER_CATEGORY = 'Other';
const low = (s) => String(s || '').trim().toLowerCase();

/** Drop repeats across the whole list, keeping the first spelling. */
function uniqueSkills(items) {
  const seen = new Set();
  return items.filter((s) => !seen.has(low(s)) && seen.add(low(s)));
}

// A nested category inside a group's items — "Frontend Architecture & Modern Web: React.js" as
// one item, with the skills that follow it belonging to that category — the way a parse of a
// two-level skills section leaves them. Not a link, not a long sentence.
const NESTED_CATEGORY_RE = /^([^:/]{2,60}?):\s*(?!\/)(.+)$/;
const NESTED_CATEGORY_WORDS = 6;
const unbalanced = (s) => (s.match(/\(/g) || []).length > (s.match(/\)/g) || []).length;

/**
 * A group's items as a resume meant them: an item split at a comma inside its parentheses
 * ("SQL Query Tuning (PostgreSQL" and "ClickHouse)") is joined back, and a nested category
 * starts a group of its own with the items after it. Returns groups.
 */
function repairSkillGroup(category, items) {
  const joined = [];
  for (const item of items) {
    const last = joined.length - 1;
    if (last >= 0 && unbalanced(joined[last])) joined[last] = `${joined[last]}, ${item}`;
    else joined.push(item);
  }
  const groups = [{ category, items: [] }];
  for (const item of joined) {
    const nested = item.match(NESTED_CATEGORY_RE);
    if (nested && nested[1].trim().split(/\s+/).length <= NESTED_CATEGORY_WORDS) {
      groups.push({ category: cut(nested[1].trim(), CATEGORY_MAX), items: [nested[2].trim()] });
    } else groups[groups.length - 1].items.push(item);
  }
  return groups;
}

/** Skill groups as stored: trimmed, no empty ones, each skill once across all groups. */
function cleanSkillGroups(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .filter((g) => g && typeof g === 'object')
    .flatMap((g) => repairSkillGroup(cut(asString(g.category), CATEGORY_MAX), cut(asStringArray(g.items), LIST_LIMITS.skills)))
    .map((g) => ({ category: g.category, items: g.items.filter((s) => !seen.has(low(s)) && seen.add(low(s))) }))
    .filter((g) => g.items.length);
}

const categorized = (groups) => groups.some((g) => g.category);
const flatten = (groups) => groups.flatMap((g) => g.items);

/**
 * `extra` skills added to groups: each into the group whose category matches its own, when it
 * names one, otherwise into the Other group (made at the end when there is none). A skill the
 * groups already have is not added twice.
 */
export function addToSkillGroups(groups, extra, category = OTHER_CATEGORY) {
  const out = groups.map((g) => ({ ...g, items: [...g.items] }));
  const have = new Set(flatten(out).map(low));
  for (const skill of extra) {
    if (!skill || have.has(low(skill))) continue;
    have.add(low(skill));
    let group = out.find((g) => low(g.category) === low(category));
    if (!group) out.push((group = { category, items: [] }));
    group.items.push(skill);
  }
  return out;
}

/** Every skill of `more` groups put into `groups`, category by category; a category `groups` lacks comes after. */
export function mergeSkillGroups(groups, more) {
  return more.reduce((out, g) => addToSkillGroups(out, g.items, g.category), groups);
}

// A section of the resume's own that is really its skills: "Technical Proficiencies",
// "Core Competencies", "Tools & Technologies"…
const SKILLS_TITLE_RE = /skill|proficienc|competenc|technolog|tech stack|toolkit|tools|expertise|kenntnisse|compétences|habilidades|competenze/i;
const CATEGORY_LINE_RE = /^([^:]{1,60}):\s*(.+)$/;
// Split at the list's separators, except inside parentheses: "Cloud Platforms (AWS, GCP)" is one skill.
function splitOutsideParens(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(text || '')) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,;|•·]/.test(ch)) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  return parts;
}
const splitSkills = (text) => splitOutsideParens(text).map(cleanListItem).filter(Boolean);
const shortSkill = (s) => s.length <= 40 && s.split(/\s+/).length <= 5;

/**
 * A skills section written as free text, read as groups: every line "Category: a, b, c", or
 * every line a plain list of short skills. Null when it reads as prose.
 */
function skillsFromSection(section) {
  if (!SKILLS_TITLE_RE.test(section.title)) return null;
  const lines = section.content
    .split('\n')
    .map(cleanListItem)
    .filter(Boolean);
  if (!lines.length) return null;
  const labelled = lines.map((l) => l.match(CATEGORY_LINE_RE));
  if (labelled.every(Boolean)) {
    const groups = labelled.map((m) => ({ category: m[1].trim(), items: splitSkills(m[2]) }));
    return groups.every((g) => g.items.every(shortSkill)) ? groups : null;
  }
  const items = lines.flatMap(splitSkills);
  return labelled.some(Boolean) || !items.every(shortSkill) ? null : [{ category: '', items }];
}

/**
 * The skills fields of a cleaned form: `skillsHeading`, `skillGroups` (only when some group has
 * a category) and `skills` (the flat list), plus the other sections left once one that was the
 * resume's skills has moved into them.
 */
function cleanSkills(source, skills, otherSections) {
  let heading = cut(asString(source.skillsHeading), HEADING_MAX);
  let groups = cleanSkillGroups(source.skillGroups);
  let others = otherSections;
  if (!categorized(groups)) {
    // A skills section kept as free text, which tailoring would otherwise answer with a second
    // Skills section of its own: it becomes the skills, under its own heading.
    const index = otherSections.findIndex((o) => skillsFromSection(o));
    if (index >= 0) {
      const found = cleanSkillGroups(skillsFromSection(otherSections[index]));
      groups = [...groups, ...found];
      heading ||= cut(otherSections[index].title, HEADING_MAX);
      others = otherSections.filter((_, i) => i !== index);
    }
  }
  if (!categorized(groups)) return { skillsHeading: heading, skills: uniqueSkills([...skills, ...flatten(groups)]), skillGroups: [], otherSections: others };
  // Skills listed without a category keep their place in the Other group.
  const all = addToSkillGroups(groups, skills);
  return { skillsHeading: heading, skills: flatten(all), skillGroups: all, otherSections: others };
}

/** The skills section as lines: "Category: a, b" per group, or the flat list on one line. */
export function skillLines(resume) {
  const groups = Array.isArray(resume?.skillGroups) ? resume.skillGroups.filter((g) => g?.items?.length) : [];
  if (categorized(groups)) return groups.map((g) => (g.category ? `${g.category}: ${g.items.join(', ')}` : g.items.join(', ')));
  return resume?.skills?.length ? [resume.skills.join(', ')] : [];
}

/** The heading the skills section is printed under. */
export const skillsHeading = (resume) => asString(resume?.skillsHeading) || 'Skills';

/**
 * A form's skills without the ones `drop` matches, in the flat list and in every group. Works on
 * a plain object or a stored document: returns the fields to set.
 */
export function withoutSkills(resume, drop) {
  const keep = (s) => !drop(s);
  const groups = (resume.skillGroups || []).map((g) => ({ category: g.category, items: g.items.filter(keep) })).filter((g) => g.items.length);
  return { skills: (resume.skills || []).filter(keep), skillGroups: groups };
}

/** A form's skills with `extra` added (grouped ones into Other): returns the fields to set. */
export function withSkills(resume, extra) {
  const groups = (resume.skillGroups || []).map((g) => ({ category: g.category, items: [...g.items] }));
  if (!categorized(groups)) return { skills: uniqueSkills([...(resume.skills || []), ...extra]), skillGroups: groups };
  const all = addToSkillGroups(groups, extra);
  return { skills: flatten(all), skillGroups: all };
}

/**
 * Clean a structured resume without checking required fields. Used for AI-parsed
 * drafts, which may lack a name or email until the user reviews them.
 */
export function cleanStructuredResume(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  for (const [field, max] of Object.entries(TEXT_LIMITS)) out[field] = cut(asString(source[field]), max);
  for (const [field, max] of Object.entries(LIST_LIMITS)) out[field] = cut(asStringArray(source[field]), max);
  for (const [field, limits] of Object.entries(ENTRY_LIMITS)) {
    const listFields = ENTRY_LISTS[field] || [];
    const fields = Object.keys(limits).filter((f) => !listFields.includes(f));
    out[field] = entries(source[field], fields, listFields).map((item) =>
      Object.fromEntries(Object.entries(item).map(([f, value]) => [f, cut(value, limits[f])]))
    );
  }
  Object.assign(out, cleanSkills(source, out.skills, out.otherSections));
  return out;
}

/**
 * Normalize and validate a structured resume payload.
 * @returns {{ resume: object } | { error: string }}
 */
export function normalizeStructuredResume(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Resume data is required' };
  }
  const resume = cleanStructuredResume(input);
  if (!resume.name) return { error: 'Name is required' };
  if (!resume.email) return { error: 'Email is required' };
  return { resume };
}

/** Flatten structured resume to plain text for ATS optimize / scoring. */
export function structuredResumeToText(resume) {
  const lines = [];
  const section = (heading) => lines.push('', heading);

  const header = [resume.name, resume.title].filter(Boolean).join(' — ');
  if (header) lines.push(header);

  const contact = [resume.email, resume.phone, resume.location].filter(Boolean).join(' | ');
  if (contact) lines.push(contact);

  const links = [
    resume.linkedin && `LinkedIn: ${resume.linkedin}`,
    resume.github && `GitHub: ${resume.github}`,
    resume.portfolio && `Portfolio: ${resume.portfolio}`,
  ].filter(Boolean);
  if (links.length) lines.push(links.join(' | '));

  if (resume.summary) {
    section('PROFESSIONAL SUMMARY');
    lines.push(resume.summary);
  }

  const skills = skillLines(resume);
  if (skills.length) {
    section(skillsHeading(resume).toUpperCase());
    lines.push(...skills);
  }

  if (resume.experience?.length) {
    section('EXPERIENCE');
    for (const exp of resume.experience) {
      const role = [exp.title, exp.company].filter(Boolean).join(' at ');
      const heading = [role, exp.period].filter(Boolean).join(' | ');
      if (heading) lines.push(heading);
      for (const item of exp.achievements || []) lines.push(`• ${item}`);
      lines.push('');
    }
  }

  if (resume.projects?.length) {
    section('PROJECTS');
    for (const project of resume.projects) {
      const heading = [project.name, project.role, project.period, project.link].filter(Boolean).join(' | ');
      if (heading) lines.push(heading);
      for (const item of project.highlights || []) lines.push(`• ${item}`);
      lines.push('');
    }
  }

  if (resume.education?.length) {
    section('EDUCATION');
    for (const edu of resume.education) {
      const parts = [edu.degree, [edu.school, edu.location].filter(Boolean).join(', '), edu.year].filter(Boolean);
      if (parts.length) lines.push(parts.join(' — '));
    }
  }

  if (resume.certifications?.length) {
    section('CERTIFICATIONS');
    for (const cert of resume.certifications) {
      const parts = [cert.name, cert.issuer, cert.year].filter(Boolean);
      if (parts.length) lines.push(parts.join(' — '));
    }
  }

  if (resume.achievements?.length) {
    section('ACHIEVEMENTS');
    for (const item of resume.achievements) lines.push(`• ${item}`);
  }

  if (resume.languages?.length) {
    section('LANGUAGES');
    lines.push(resume.languages.join(', '));
  }

  for (const other of resume.otherSections || []) {
    section((other.title || 'Additional').toUpperCase());
    if (other.content) lines.push(other.content);
  }

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function displayNameForStructuredResume(resume) {
  if (resume.title) return `${resume.name} — ${resume.title}`;
  return `${resume.name} Resume`;
}
