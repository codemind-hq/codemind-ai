// The term an internship or a new-grad start is for, as the title names it: "Software Engineer
// Intern (Summer 2027)", "Fall 2026 Co-op", "2027 Summer Analyst". Nothing is read from the
// description: a posting's text names the terms of other programmes too.

export const SEASONS = ['summer', 'fall', 'winter', 'spring'];

const SEASON_WORDS = { summer: /\bsummer\b/gi, fall: /\b(?:fall|autumn)\b/gi, winter: /\bwinter\b/gi, spring: /\bspring\b/gi };
// The month a term starts, for a title that names the season and not the year.
const STARTS = { summer: 5, fall: 8, winter: 11, spring: 2 };
// A year, never a requisition's digits: "R-2027", "Req 2027", "2027-1138".
const YEAR = /(?<!\b[A-Z]{1,6}-|#|\b(?:[Rr]eq|REQ|ID|[Rr]ef|REF)\s*:?\s*)\b(20[2-3]\d)\b(?!-\d)/;
// When the student graduates, which is no term: "Grad Year: Winter 2027", "Graduating in 2029",
// "Class of 2027", "2028 Graduates". "2027 Graduate Programme" stays: that is the programme's year.
const SEASON = String.raw`(?:summer|fall|autumn|winter|spring)`;
const GRADUATION = new RegExp(String.raw`\b(?:grad(?:uation)?\s+(?:year|date|class)\s*[:-]?|graduating(?:\s+(?:in|by|from))?|class\s+of)\s*(?:${SEASON}\s*)?(?:20[2-3]\d)?|\b20[2-3]\d\s+graduates\b`, 'gi');
// The word as something else: a place, a safety course, or Spring the Java framework, named after its language.
const NOT_A_TERM_AFTER = /^\s*(?:boot|framework|mvc|cloud|security|data|batch|webflux|developer|park|river|haven|garden|hill|valley|street|road|lake|city|protection|detection|prevention|[,/&+]\s*(?:j2ee|jpa|hibernate|java|kotlin|react|angular|rest|sql|docker|aws|microservices)\b)/i;
const NOT_A_TERM_BEFORE = /(?:java|j2ee|jpa|kotlin|hibernate|react|angular|rest|sql|microservices)\s*[,/&+(-]*\s*\(?\s*$/i;
const NOT_A_TERM_STATE = /^,\s*[A-Z]{2}\b/;

const namesSeason = (text, name) =>
  [...text.matchAll(SEASON_WORDS[name])].some((m) => {
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + m[0].length);
    // Beside a year it is a term, whatever comes before it ("Intern - Java - Spring 2027").
    if (/^[\s-]*20[2-3]\d\b/.test(after) || /\b20[2-3]\d[\s-]*$/.test(before)) return true;
    return !NOT_A_TERM_AFTER.test(after) && !NOT_A_TERM_STATE.test(after) && !(name === 'spring' && NOT_A_TERM_BEFORE.test(before));
  });

/**
 * `{ season, year }` from a title, or null when it names neither. A season without a year is the
 * next one from `now` (a "Summer Intern" posting in November is for next summer); a year without a
 * season gives `season: ''`, and is only worth storing on an intern or new-grad posting.
 */
export function termFromTitle(title, { now = new Date() } = {}) {
  const text = String(title || '').replace(GRADUATION, ' ');
  const season = SEASONS.find((name) => namesSeason(text, name)) || '';
  const named = text.match(YEAR);
  if (!season && !named) return null;
  let year = named ? Number(named[1]) : now.getUTCFullYear();
  if (!named && now.getUTCMonth() >= STARTS[season]) year += 1;
  return { season, year };
}

/** The first year a season's term has not begun in: what asking for "Summer" with no year means. */
export const nextTermYear = (season, { now = new Date() } = {}) => (termStarted({ season, year: now.getUTCFullYear() }, { now }) ? now.getUTCFullYear() + 1 : now.getUTCFullYear());

/** The first day of the month a season's term starts. */
export const termStart = ({ season, year }) => new Date(Date.UTC(year, STARTS[season] ?? 0, 1));

/** Whether a season's term has begun by `now`: an internship for it is no longer one to apply to. */
export function termStarted({ season, year }, { now = new Date() } = {}) {
  const thisYear = now.getUTCFullYear();
  return year < thisYear || (year === thisYear && now.getUTCMonth() > STARTS[season]);
}

/** "Summer 2027", "Fall 2026"; a bare year as it is. */
export function termLabel(term) {
  if (!term?.year) return '';
  const season = term.season ? term.season[0].toUpperCase() + term.season.slice(1) : '';
  return [season, term.year].filter(Boolean).join(' ');
}

/** The term as a page slug and back: "summer-2027". */
export const termSlug = (term) => (term?.season && term.year ? `${term.season}-${term.year}` : '');
export function termFromSlug(slug) {
  const match = /^(summer|fall|winter|spring)-(20[2-3]\d)$/.exec(String(slug || ''));
  return match ? { season: match[1], year: Number(match[2]) } : null;
}
