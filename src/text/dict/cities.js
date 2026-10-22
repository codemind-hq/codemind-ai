import { readFileSync } from 'node:fs';

// Which country a city name belongs to, from the GeoNames cities1000 gazetteer that freehire
// generated (data/cities1000.tsv: canonical name, ISO 3166-1 alpha-2 code, '|'-joined lowercase
// aliases; see data/README.md). It answers one question for the location parser: "Berlin",
// "Bengaluru" or "São Paulo" with no country named - which country is that?
//
// The answer is given only when it is certain. A spelling more than one country claims states
// nothing: "Cambridge" (GB, US, CA, NZ), "Springfield" (nine in the US alone, plus others) and
// "Birmingham" resolve to null, because naming the wrong country for a job is worse than naming
// none. The file marks such an alias with a trailing '*', counted by its generator across the
// whole GeoNames dump, hamlets included; a name the file itself lists under two countries is
// treated the same way in case the mark is ever missing.
//
// Over the gazetteer sit freehire's hand-pinned spellings (data/countries.json, nameToCountry):
// "paris", "berlin", "amsterdam" and "são paulo" are all contested in GeoNames (Paris, Texas;
// Berlin, New Hampshire), yet a job posting that says only "Paris" means France. Those pins
// are asserted rather than inferred, so they win outright, the way freehire's cityOverrides do.
//
// The file is 3.4 MB and 238k aliases, so it is parsed on the first lookup rather than at
// import, in one pass over the text (about 150 ms) into a Map keyed by alias.

const GAZETTEER = new URL('./data/cities1000.tsv', import.meta.url);
const PINS = new URL('./data/countries.json', import.meta.url);

// The file's mark for an alias more than one country claims.
const CONTESTED = '*';

// alias -> the codes claiming it, '|'-joined in file order (most populous first), with a leading
// CONTESTED when the gazetteer says other countries claim the spelling too. A string rather than
// an object per alias keeps 238k entries cheap; a code never contains '|', so a two-character
// value is exactly one uncontested country.
let claims = null;
// pinned spelling -> code.
let pins = null;

function load() {
  if (claims) return;
  const table = new Map();
  const text = readFileSync(GAZETTEER, 'utf8');
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, text[end - 1] === '\r' ? end - 1 : end);
    start = end + 1;
    if (!line || line[0] === '#') continue;
    const tab1 = line.indexOf('\t');
    const tab2 = line.indexOf('\t', tab1 + 1);
    if (tab1 === -1 || tab2 === -1) continue;
    const code = line.slice(tab1 + 1, tab2);
    for (const raw of line.slice(tab2 + 1).split('|')) {
      const marked = raw.endsWith(CONTESTED);
      const alias = marked ? raw.slice(0, -1) : raw;
      const prev = table.get(alias);
      if (prev === undefined) {
        table.set(alias, marked ? CONTESTED + code : code);
      } else if (!prev.includes(code)) {
        table.set(alias, (marked || prev[0] === CONTESTED ? CONTESTED : '') + prev.replace(CONTESTED, '') + '|' + code);
      }
    }
  }
  pins = new Map(Object.entries(JSON.parse(readFileSync(PINS, 'utf8')).nameToCountry));
  claims = table;
}

// The file's aliases are lowercase and keep their diacritics ("são paulo", "münchen") next to
// their folded forms ("sao paulo"), so the lookup only lowercases and composes the input.
function key(name) {
  return String(name || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Parses the gazetteer now rather than on the first lookup; returns the number of aliases. */
export function loadGazetteer() {
  load();
  return claims.size;
}

/**
 * The ISO 3166-1 alpha-2 code of the one country that claims this city name, or null when none
 * does or several do: cityCountry('Bengaluru') is 'in', cityCountry('Cambridge') is null.
 */
export function cityCountry(name) {
  const k = key(name);
  if (!k) return null;
  load();
  const pinned = pins.get(k);
  if (pinned) return pinned;
  const claim = claims.get(k);
  return claim && claim.length === 2 ? claim : null;
}

/** True when a city of this name exists in the country: cityCountryIn('Cambridge', 'us'). */
export function cityCountryIn(name, code) {
  const k = key(name);
  const c = String(code || '').toLowerCase();
  if (!k || !c) return false;
  load();
  if (pins.get(k) === c) return true;
  const claim = claims.get(k);
  return Boolean(claim) && claim.replace(CONTESTED, '').split('|').includes(c);
}

/**
 * Which of the given countries (ISO codes) a city name speaks for, or null. A two-letter code
 * after a city is a US state or a country ("Berlin, DE": Delaware or Germany; "San Francisco,
 * CA": California or Canada), and the city is what tells them apart. The pinned or sole country
 * of the name wins when it is one of them (Berlin is Germany's, though New Hampshire has one;
 * San Francisco is the United States'); else the only one of them with a city of that name
 * (Portland is in no Montenegro); else null, for a name none has or both do, or none at all.
 */
export function cityCountryAmong(name, codes) {
  const wanted = (codes || []).map((code) => String(code || '').toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return null;
  const known = cityCountry(name);
  if (known && wanted.includes(known)) return known;
  const claiming = wanted.filter((code) => cityCountryIn(name, code));
  return claiming.length === 1 ? claiming[0] : null;
}

// Cities whose official name changed while postings keep the old one. To the reader and to the
// city filter the two spellings are one city, so the current name is the one stored; the
// gazetteer has both as aliases but names no preferred one, hence the table.
const RENAMED = new Map([
  ['bangalore', 'Bengaluru'],
  ['bombay', 'Mumbai'],
  ['calcutta', 'Kolkata'],
  ['madras', 'Chennai'],
  ['poona', 'Pune'],
  ['kiev', 'Kyiv'],
]);

/** The current official name of a city a posting names by its old one ("Bangalore" → "Bengaluru"), or '' when the name is not one. */
export function canonicalCity(name) {
  return RENAMED.get(key(name)) || '';
}
