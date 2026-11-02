import { parseSkills, skillLabel } from '../text/dict/skills.js';
import { aiTellWords } from '../text/voice.js';

// The general resume check: a resume read on its own, with no job to match it against (the ATS
// checker's "No job" mode). Code only, no model call: what an ATS and a recruiter's first skim look
// for in any resume. Five parts out of 100: contact details 10, sections 15, impact 55, skills 10,
// length and readability 10. Impact weighs most because it is what tells resumes apart: nearly every
// resume has an email and a Skills heading, few show their results in numbers. Each check that falls
// short says what to fix, worst first.

export const CHECK_PARTS = [
  { key: 'contact', label: 'Contact details', of: 10 },
  { key: 'sections', label: 'Sections', of: 15 },
  { key: 'impact', label: 'Impact', of: 55 },
  { key: 'skills', label: 'Skills', of: 10 },
  { key: 'format', label: 'Length and readability', of: 10 },
];

// Section headings an ATS looks for, written the usual ways. A heading is a short line of its own;
// a joined one ("Experience/Projects", "Education & Continuous Learning") is read by its first part
// that is one.
const HEADINGS = {
  experience: /^(?:(?:professional|work|relevant|employment|career)\s+)?(?:experience|history|employment(?:\s+history)?)$|^work\s+history$/,
  education: /^(?:education|academic\s+background|academics)$/,
  skills: /^(?:(?:technical|core|key|relevant|professional)\s+)?(?:skills|competencies|proficiencies)$|^(?:technologies|tech\s+stack|tools|technical\s+expertise)$/,
  summary: /^(?:(?:professional|career|executive)\s+)?(?:summary|profile|objective|overview)$|^about(?:\s+me)?$/,
  // Projects are read as lines of work beside the roles: a student's resume shows its work there.
  projects: /^(?:(?:selected|personal|side|academic|technical|key|notable|open[\s-]source)\s+)?projects?$|^portfolio$/,
  other:
    /^(?:certifications?|licenses?|awards|honou?rs|achievements|publications|languages|interests|volunteer(?:ing|\s+experience)?|references|activities|leadership|courses|training)$/,
};
const HEADING_MAX = 40;
const HEADING_JOINS = /\s*(?:\/|&|\+|,|\band\b)\s*/;

const BULLET = /^[•●▪◦‣∙·*►✓➢■□\-–—]\s*/;
const YEAR = String.raw`(?:\d{1,2}[/.])?(?:19|20)\d{2}`;
const DATE_RANGE = new RegExp(String.raw`${YEAR}\s*(?:[-–—]|to)\s*(?:[A-Za-z]{3,9}\.?\s+)?(?:${YEAR}|present|current|now|today|ongoing)\b`, 'i');
const YEARS = /\b(?:19|20)\d{2}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const PROFILE_LINK = /linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com|https?:\/\/|www\.|\b[\w-]+\.(?:dev|io|me|site)\b/i;
const PLACE = /\b[A-Z][a-zA-Z.'-]+(?:\s[A-Z][a-zA-Z.'-]+)*,\s*(?:[A-Z]{2}\b|[A-Z][a-z]+)|\bremote\b/i;
const HEADER_LINES = 8;
// A line of work that says what was done: long enough to be a sentence, not a title or a date.
const ACHIEVEMENT_WORDS = 6;
const LONG_ACHIEVEMENT_WORDS = 30;
// "I" only as a capital on its own ("i.e." and "Phase I." are not the candidate).
const FIRST_PERSON = [/\bI\b(?![.)])/g, /\b(?:me|my|mine|myself)\b/gi];
// Characters no real text has: a decoding failure, an icon font's private glyphs, control codes.
// eslint-disable-next-line no-control-regex
const GARBLED = new RegExp('[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000B\u000C\u000E-\u001F]', 'g');

// Openers that describe a duty rather than a result.
const WEAK_OPENERS =
  /^(?:responsible\s+for|responsibilities\s+included|duties\s+included|worked\s+on|working\s+on|helped|helping|assisted|assisting|involved\s+in|participated\s+in|tasked\s+with|in\s+charge\s+of|handled|was\s|were\s)/i;
// Verbs a line of work usually opens with, beyond any word ending in -ed: irregular past forms and
// the present tense of a current role ("Build", "Leads").
const VERBS = new Set(
  `lead led build built run ran own drive drove grow grew cut write wrote ship deliver implement migrate automate architect manage mentor scale
  optimize optimise establish introduce negotiate win won make made set sell sold teach taught oversee oversaw coordinate analyze analyse resolve
  maintain support plan organize organise direct spearhead rebuild rebuilt refactor integrate deploy test research define partner collaborate present
  train hire recruit conduct produce streamline secure raise save generate achieve earn found design develop create launch improve increase reduce
  speak spoke give gave bring brought take took keep kept begin began split meet met hold held prototype own co-found cofound handle`.split(/\s+/)
);

const words = (text) => (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'+#.-]*/gu) || []).length;
const headingKey = (line) => {
  const head = line
    .replace(BULLET, '')
    .replace(/[:|]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!head || head.length > HEADING_MAX || /\d/.test(head)) return null;
  const named = (text) => Object.keys(HEADINGS).find((key) => HEADINGS[key].test(text)) || null;
  return named(head) || head.split(HEADING_JOINS).map(named).find(Boolean) || null;
};
const opensWithVerb = (line) => {
  const first = (line.match(/^[A-Za-z-]+/) || [''])[0].toLowerCase();
  if (!first) return false;
  return /[a-z]{2,}ed$/.test(first) || VERBS.has(first) || VERBS.has(first.replace(/e?s$/, '')) || VERBS.has(first.replace(/s$/, ''));
};
const quantified = (line) => /\d/.test(line.replace(YEARS, ''));

/** The resume's lines, each section's own, with a wrapped line joined back to the one it continues. */
function readLines(text) {
  // Some PDFs draw a bullet's mark on a line of its own; the mark goes onto the line it marks.
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .reduce((out, line, i, all) => {
      if (!(BULLET.test(line) && line.replace(BULLET, '') === '')) out.push(i > 0 && BULLET.test(all[i - 1]) && all[i - 1].replace(BULLET, '') === '' ? `• ${line}` : line);
      return out;
    }, []);
  const sections = {
    experience: [],
    projects: [],
    education: [],
    skills: [],
    summary: [],
    other: [],
    top: [],
  };
  const found = new Set();
  let current = 'top';
  const usesBullets = lines.some((l) => BULLET.test(l) && words(l) >= ACHIEVEMENT_WORDS);
  for (const line of lines) {
    const key = headingKey(line);
    if (key) {
      current = key;
      found.add(key);
      continue;
    }
    const into = sections[current];
    const prev = into[into.length - 1];
    // A PDF breaks a long bullet over lines; the next line then starts mid-sentence, in lower case,
    // or, where bullets are marked, without a mark after a bullet that has not ended.
    const continues =
      prev && !DATE_RANGE.test(line) && (/^[a-z(&,]/.test(line) || (usesBullets && BULLET.test(prev) && !BULLET.test(line) && !/[.!?]$/.test(prev) && words(line) >= 4 && /[a-z]/.test(line)));
    if (continues) into[into.length - 1] = `${prev} ${line}`;
    else into.push(line);
  }
  return { lines, sections, found };
}

/** What a resume's skills section lists, split on the usual separators. */
function listedSkills(lines) {
  return lines
    .flatMap((l) => l.replace(/^[^:]{1,30}:\s*/, '').split(/[,;|•·/]|\s{2,}/))
    .map((s) => s.replace(BULLET, '').trim())
    .filter((s) => s && s.length <= 40 && words(s) <= 4);
}

/**
 * The general check of a resume's plain text. `country` is the country its header names when the
 * caller read one (a place written another way is looked for here). Answers the score out of 100,
 * the parts it adds up from, what to fix (worst first, each with the points it costs), what is
 * already right, and what was read: word count, lines of work, how many show a number, the skills.
 */
export function checkResumeText(text, { country = '' } = {}) {
  const body = String(text || '');
  const { lines, sections, found } = readLines(body);
  const header = lines.slice(0, HEADER_LINES).join('\n');
  const totalWords = words(body);

  // Lines of work: the experience section's, or every section's when the resume has no such heading.
  // Lines of work: the experience and projects sections', or every section's when the resume has neither heading.
  const pool = found.has('experience') || found.has('projects') ? [...sections.experience, ...sections.projects] : [...sections.top, ...sections.experience, ...sections.other];
  const achievements = pool.map((l) => l.replace(BULLET, '')).filter((l) => words(l) >= ACHIEVEMENT_WORDS && !DATE_RANGE.test(l) && !EMAIL.test(l));
  const withNumbers = achievements.filter(quantified);
  const withVerbs = achievements.filter(opensWithVerb);
  const weak = achievements.filter((l) => WEAK_OPENERS.test(l));
  const long = achievements.filter((l) => words(l) > LONG_ACHIEVEMENT_WORDS);
  const dateRanges = lines.filter((l) => DATE_RANGE.test(l)).length;
  const ownWords = [...sections.summary, ...achievements].join('\n');
  const firstPerson = FIRST_PERSON.reduce((n, re) => n + (ownWords.match(re) || []).length, 0);

  const skills = parseSkills(body);
  const listed = listedSkills(sections.skills);
  const skillCount = Math.max(skills.length, Math.min(listed.length, 30));
  const tells = aiTellWords(body);
  const garbled = (body.match(GARBLED) || []).length;
  const glued = (body.match(/[\p{L}]{26,}/gu) || []).filter((w) => !/^https?/i.test(w)).length;
  const phoneDigits = (body.match(PHONE) || []).filter((m) => !DATE_RANGE.test(m)).map((m) => m.replace(/\D/g, '').length);

  const share = (part, whole) => (whole ? part / whole : 0);
  const numberShare = share(withNumbers.length, achievements.length);
  const verbShare = share(withVerbs.length, achievements.length);
  const lengthRate = totalWords >= 450 && totalWords <= 900 ? 1 : totalWords >= 350 && totalWords <= 1100 ? 0.6 : totalWords >= 250 && totalWords <= 1400 ? 0.2 : 0;
  const tooShort = totalWords < 450;
  const sample = (list, n = 6) =>
    list
      .slice(0, n)
      .map((w) => `"${w}"`)
      .join(', ');

  // Each check: its part, its weight (`of`), how well the resume does on it (`rate`, 0 to 1), the
  // label it shows when right, and the fix when not.
  const checks = [
    {
      part: 'contact',
      key: 'email',
      of: 4,
      rate: EMAIL.test(body) ? 1 : 0,
      label: 'Email address',
      title: 'No email address',
      fix: 'Put your email address at the top, as plain text, so a recruiter can reply.',
    },
    {
      part: 'contact',
      key: 'phone',
      of: 3,
      rate: phoneDigits.some((d) => d >= 9 && d <= 15) ? 1 : 0,
      label: 'Phone number',
      title: 'No phone number',
      fix: 'Add a phone number with its country code next to your email.',
    },
    {
      part: 'contact',
      key: 'link',
      of: 2,
      rate: PROFILE_LINK.test(body) ? 1 : 0,
      label: 'Profile link',
      title: 'No LinkedIn, GitHub or portfolio link',
      fix: 'Add your LinkedIn profile, and GitHub or a portfolio if you have one, written out as a link.',
    },
    {
      part: 'contact',
      key: 'location',
      of: 1,
      rate: country || PLACE.test(header) ? 1 : 0,
      label: 'Location',
      title: 'No location',
      fix: 'Name your city and country (or "Remote") in the header; many searches filter by place.',
    },

    {
      part: 'sections',
      key: 'experience',
      of: 6,
      rate: found.has('experience') ? 1 : 0,
      label: 'Experience section',
      title: 'No "Experience" heading',
      fix: 'Head your work history "Experience" or "Work Experience" so an ATS files it as your experience.',
    },
    {
      part: 'sections',
      key: 'skills_section',
      of: 4,
      rate: found.has('skills') ? 1 : 0,
      label: 'Skills section',
      title: 'No "Skills" section',
      fix: 'Add a "Skills" section listing your tools and technologies; ATS keyword searches read it first.',
    },
    {
      part: 'sections',
      key: 'education',
      of: 3,
      rate: found.has('education') ? 1 : 0,
      label: 'Education section',
      title: 'No "Education" heading',
      fix: 'Add an "Education" section, even a short one (degree, school, year), or your courses and certifications.',
    },
    {
      part: 'sections',
      key: 'summary',
      of: 2,
      rate: found.has('summary') ? 1 : 0,
      label: 'Summary',
      title: 'No summary',
      fix: 'Open with two or three lines saying what you do, for how long, and with what.',
    },

    {
      part: 'impact',
      key: 'numbers',
      of: 30,
      rate: Math.min(1, numberShare / 0.6),
      label: 'Results with numbers',
      title: `${withNumbers.length} of ${achievements.length} lines of work show a number`,
      fix: 'Give results as figures: how much, how many, how fast, how big (users, revenue, time saved, %). Aim for at least 6 bullets in 10.',
    },
    {
      part: 'impact',
      key: 'verbs',
      of: 10,
      rate: Math.max(0, Math.min(1, verbShare / 0.9) - weak.length / 10),
      label: 'Bullets open with action verbs',
      title: weak.length ? `${weak.length} ${weak.length === 1 ? 'bullet describes a duty' : 'bullets describe duties'} ("Responsible for", "Helped")` : 'Few bullets open with an action verb',
      fix: 'Start each bullet with what you did (Built, Led, Cut, Shipped) and end with what came of it.',
    },
    {
      part: 'impact',
      key: 'dates',
      of: 5,
      rate: dateRanges >= 2 ? 1 : dateRanges === 1 ? 0.6 : 0,
      label: 'Dates for each role',
      title: dateRanges === 1 ? 'Only one role has dates' : 'No dates on your roles',
      fix: 'Give each role its start and end (Jan 2021 – Present); an ATS works out your years of experience from them.',
    },
    {
      part: 'impact',
      key: 'bullets',
      of: 5,
      rate: (achievements.length >= 3 ? 0.5 : 0) + (achievements.length && share(long.length, achievements.length) <= 0.1 ? 0.5 : 0),
      label: 'Clear bullet points',
      title: achievements.length < 3 ? 'Too few lines describing your work' : `${long.length} bullets run past ${LONG_ACHIEVEMENT_WORDS} words`,
      fix:
        achievements.length < 3
          ? 'Under each role, list three to six bullets saying what you did and what it achieved.'
          : 'Keep each bullet to one or two lines; split long ones into separate results.',
    },
    {
      part: 'impact',
      key: 'first_person',
      of: 5,
      rate: firstPerson === 0 ? 1 : 0,
      label: 'No "I" or "my"',
      title: `Says "I" or "my" ${firstPerson} ${firstPerson === 1 ? 'time' : 'times'}`,
      fix: 'Drop "I", "me" and "my": "Led the migration", not "I led the migration".',
    },

    {
      part: 'skills',
      key: 'skills',
      of: 10,
      rate: Math.min(1, skillCount / 20),
      label: 'Named skills and tools',
      title: `Only ${skillCount} ${skillCount === 1 ? 'skill or tool' : 'skills and tools'} named`,
      fix: 'Name the languages, frameworks, tools and methods you actually use, by their usual names; ATS searches match the words exactly.',
    },

    {
      part: 'format',
      key: 'length',
      of: 5,
      rate: lengthRate,
      label: 'Length',
      title: tooShort ? `Short: ${totalWords} words` : `Long: ${totalWords} words`,
      fix: tooShort
        ? 'A strong resume runs 450 to 900 words. Add what each role achieved, your skills and your projects.'
        : 'Keep to one or two pages (about 450 to 900 words). Cut old roles to a line and drop bullets that repeat.',
    },
    {
      part: 'format',
      key: 'readable',
      of: 3,
      rate: garbled > Math.max(3, body.length * 0.002) || glued > 3 ? 0 : 1,
      label: 'Text reads cleanly',
      title: 'Parts of the file come out garbled',
      fix: 'An ATS may read it the same way. Export the PDF from Word or Google Docs with real text, and avoid text in images, icons and columns.',
    },
    {
      part: 'format',
      key: 'filler',
      of: 2,
      rate: tells.length === 0 ? 1 : tells.length === 1 ? 0.5 : 0,
      label: 'No filler words',
      title: `Filler words: ${sample(tells)}`,
      fix: 'Swap buzzwords for the concrete thing: the tool you used, the number you moved, the project you shipped.',
    },
  ].map((c) => ({ ...c, got: Math.round(c.of * c.rate) }));

  const parts = CHECK_PARTS.map(({ key, label, of }) => ({
    key,
    label,
    of,
    got: checks.filter((c) => c.part === key).reduce((sum, c) => sum + c.got, 0),
  }));
  const issues = checks
    .filter((c) => c.got < c.of)
    .map((c) => ({
      key: c.key,
      part: c.part,
      lost: c.of - c.got,
      severity: c.of - c.got >= 8 ? 'high' : c.of - c.got >= 4 ? 'medium' : 'low',
      title: c.title,
      fix: c.fix,
    }))
    .sort((a, b) => b.lost - a.lost);
  const passed = checks.filter((c) => c.got === c.of).map((c) => c.label);

  return {
    score: parts.reduce((sum, p) => sum + p.got, 0),
    parts,
    issues,
    passed,
    stats: {
      words: totalWords,
      achievements: achievements.length,
      withNumbers: withNumbers.length,
      // Lines of work under a projects heading, and whether the resume is a student's: projects and education, no roles yet.
      projects: sections.projects.filter((l) => words(l.replace(BULLET, '')) >= ACHIEVEMENT_WORDS).length,
      student: !found.has('experience') && found.has('projects') && found.has('education'),
      skills: skills.slice(0, 40).map(skillLabel),
    },
  };
}
