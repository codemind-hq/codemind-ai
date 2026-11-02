// The term an internship or a new-grad start is for, as the title names it: "Software Engineer
// Intern (Summer 2027)", "Fall 2026 Co-op", "2027 Summer Analyst". Nothing is read from the
// description: a posting's text names the terms of other programmes too.

export const SEASONS = ['summer', 'fall', 'winter', 'spring'];

const SEASON_WORDS = { summer: /\bsummer\b/i, fall: /\b(?:fall|autumn)\b/i, winter: /\bwinter\b/i, spring: /\bspring\b/i };
// The month a term starts, for a title that names the season and not the year.
const STARTS = { summer: 5, fall: 8, winter: 11, spring: 2 };
const YEAR = /\b(20[2-3]\d)\b/;

/**
 * `{ season, year }` from a title, or null when it names neither. A season without a year is the
 * next one from `now` (a "Summer Intern" posting in November is for next summer); a year without a
 * season gives `season: ''`, and is only worth storing on an intern or new-grad posting.
 */
export function termFromTitle(title, { now = new Date() } = {}) {
  const text = String(title || '');
  const season = SEASONS.find((name) => SEASON_WORDS[name].test(text)) || '';
  const named = text.match(YEAR);
  if (!season && !named) return null;
  let year = named ? Number(named[1]) : now.getUTCFullYear();
  if (!named && now.getUTCMonth() >= STARTS[season]) year += 1;
  return { season, year };
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
