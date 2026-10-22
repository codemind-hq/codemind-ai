import { cityCountryAmong } from './dict/cities.js';

// Derives canonical country / region names from free-text location strings such as
// "Remote - US", "USA, Canada", "Remote, EMEA" or "North America".

// Regions are matched first so "North America" never triggers a United States match.
const REGIONS = [
  ['Worldwide', ['worldwide', 'global', 'anywhere', 'international', 'any location', 'remote worldwide']],
  ['North America', ['north america', 'na only', 'us/canada', 'us & canada', 'us and canada']],
  ['South America', ['south america']],
  ['Latin America', ['latin america', 'latam', 'central america']],
  ['Europe', ['europe', 'eu', 'european union', 'eea', 'cet', 'cest']],
  ['EMEA', ['emea']],
  ['APAC', ['apac', 'asia pacific', 'asia-pacific']],
  ['Asia', ['asia', 'south east asia', 'southeast asia']],
  ['Middle East', ['middle east', 'mena', 'gcc']],
  ['Africa', ['africa']],
  ['Americas', ['americas']],
];

// Every country freehire's dictionary knows (text/dict/data/countries.json), with the English name the
// app shows and filters by, its ISO 3166-1 alpha-2 code, and the spellings a location may use for
// it: English, the country's own name, and the Spanish, Portuguese and German names that boards
// in those languages write. A city is never an alias here, however unambiguous ("Berlin" is a
// place in Germany, not Germany): the gazetteer in text/dict/cities.js answers for cities, and a
// country alias would swallow the city. "Dubai" and "Abu Dhabi" predate that rule and stay.
//
// Two names are withheld on purpose, following freehire: "georgia" is the US state far more
// often than the country in job postings ("Atlanta, Georgia"), so the country answers only to
// its unambiguous long forms; "palestine" is also Palestine, Texas.
const COUNTRIES = [
  ['United States', 'US', ['united states', 'united states of america', 'usa', 'us', 'u.s.', 'u.s.a.', 'us only', 'us-based', 'us based', 'estados unidos', 'vereinigte staaten']],
  ['Canada', 'CA', ['canada', 'canadian']],
  ['United Kingdom', 'GB', ['united kingdom', 'uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland', 'reino unido', 'vereinigtes königreich']],
  ['Ireland', 'IE', ['ireland', 'irland']],
  ['Germany', 'DE', ['germany', 'deutschland', 'alemania', 'alemanha', 'bundesweit']],
  ['France', 'FR', ['france', 'francia', 'frança', 'frankreich']],
  ['Spain', 'ES', ['spain', 'españa', 'espanha', 'spanien']],
  ['Portugal', 'PT', ['portugal']],
  ['Italy', 'IT', ['italy', 'italia', 'italien']],
  ['Netherlands', 'NL', ['netherlands', 'the netherlands', 'holland', 'países bajos', 'países baixos', 'niederlande']],
  ['Belgium', 'BE', ['belgium', 'belgien']],
  ['Switzerland', 'CH', ['switzerland', 'suiza', 'suíça', 'schweiz']],
  ['Austria', 'AT', ['austria', 'österreich']],
  ['Poland', 'PL', ['poland', 'polska', 'polonia', 'polónia', 'polen']],
  ['Czech Republic', 'CZ', ['czech republic', 'czechia', 'tschechien']],
  ['Slovakia', 'SK', ['slovakia']],
  ['Hungary', 'HU', ['hungary', 'magyarország', 'hungría', 'hungria', 'ungarn']],
  ['Romania', 'RO', ['romania', 'rumanía', 'roménia', 'rumänien']],
  ['Bulgaria', 'BG', ['bulgaria', 'bulgarien']],
  ['Greece', 'GR', ['greece', 'grecia', 'grécia', 'griechenland']],
  ['Croatia', 'HR', ['croatia']],
  ['Serbia', 'RS', ['serbia']],
  ['Slovenia', 'SI', ['slovenia']],
  ['Ukraine', 'UA', ['ukraine', 'україна', 'украина']],
  ['Lithuania', 'LT', ['lithuania']],
  ['Latvia', 'LV', ['latvia']],
  ['Estonia', 'EE', ['estonia']],
  ['Sweden', 'SE', ['sweden', 'sverige', 'suecia', 'schweden']],
  ['Norway', 'NO', ['norway', 'norge', 'norwegen']],
  ['Denmark', 'DK', ['denmark', 'danmark', 'dänemark']],
  ['Finland', 'FI', ['finland', 'suomi', 'finnland']],
  ['Iceland', 'IS', ['iceland']],
  ['Luxembourg', 'LU', ['luxembourg']],
  ['Liechtenstein', 'LI', ['liechtenstein']],
  ['Monaco', 'MC', ['monaco']],
  ['Andorra', 'AD', ['andorra']],
  ['San Marino', 'SM', ['san marino']],
  ['Malta', 'MT', ['malta']],
  ['Cyprus', 'CY', ['cyprus']],
  ['Bosnia and Herzegovina', 'BA', ['bosnia and herzegovina']],
  ['North Macedonia', 'MK', ['north macedonia']],
  ['Albania', 'AL', ['albania']],
  ['Montenegro', 'ME', ['montenegro']],
  ['Kosovo', 'XK', ['kosovo']],
  ['Russia', 'RU', ['russia', 'россия', 'рф']],
  ['Belarus', 'BY', ['belarus', 'беларусь']],
  ['Moldova', 'MD', ['moldova']],
  ['Georgia', 'GE', ['republic of georgia', 'sakartvelo']],
  ['Armenia', 'AM', ['armenia']],
  ['Azerbaijan', 'AZ', ['azerbaijan']],
  ['Kazakhstan', 'KZ', ['kazakhstan', 'казахстан']],
  ['Uzbekistan', 'UZ', ['uzbekistan', 'узбекистан']],
  ['Kyrgyzstan', 'KG', ['kyrgyzstan']],
  ['Tajikistan', 'TJ', ['tajikistan']],
  ['Turkmenistan', 'TM', ['turkmenistan']],
  ['Turkey', 'TR', ['turkey', 'türkiye', 'turquía', 'turquia', 'türkei']],
  ['Israel', 'IL', ['israel']],
  ['United Arab Emirates', 'AE', ['united arab emirates', 'uae', 'dubai', 'abu dhabi', 'emiratos árabes unidos', 'emirados árabes unidos', 'vereinigte arabische emirate']],
  ['Saudi Arabia', 'SA', ['saudi arabia', 'ksa', 'arabia saudita', 'arábia saudita', 'saudi-arabien']],
  ['Qatar', 'QA', ['qatar']],
  ['Kuwait', 'KW', ['kuwait']],
  ['Bahrain', 'BH', ['bahrain']],
  ['Oman', 'OM', ['oman']],
  ['Jordan', 'JO', ['jordan']],
  ['Lebanon', 'LB', ['lebanon']],
  ['Iraq', 'IQ', ['iraq']],
  ['Iran', 'IR', ['iran']],
  ['Yemen', 'YE', ['yemen']],
  ['Palestine', 'PS', ['palestinian territories', 'state of palestine']],
  ['Egypt', 'EG', ['egypt', 'egipto', 'egito', 'ägypten']],
  ['Morocco', 'MA', ['morocco']],
  ['Algeria', 'DZ', ['algeria']],
  ['Tunisia', 'TN', ['tunisia']],
  ['Libya', 'LY', ['libya']],
  ['South Africa', 'ZA', ['south africa']],
  ['Nigeria', 'NG', ['nigeria']],
  ['Kenya', 'KE', ['kenya']],
  ['Ghana', 'GH', ['ghana']],
  ['Ethiopia', 'ET', ['ethiopia']],
  ['Tanzania', 'TZ', ['tanzania']],
  ['Uganda', 'UG', ['uganda']],
  ['Rwanda', 'RW', ['rwanda']],
  ['Senegal', 'SN', ['senegal']],
  ['Ivory Coast', 'CI', ['ivory coast', "côte d'ivoire", "cote d'ivoire"]],
  ['Cameroon', 'CM', ['cameroon']],
  ['Angola', 'AO', ['angola']],
  ['Mozambique', 'MZ', ['mozambique']],
  ['Zambia', 'ZM', ['zambia']],
  ['Zimbabwe', 'ZW', ['zimbabwe']],
  ['Mauritius', 'MU', ['mauritius']],
  ['India', 'IN', ['india']],
  ['Pakistan', 'PK', ['pakistan']],
  ['Bangladesh', 'BD', ['bangladesh']],
  ['Sri Lanka', 'LK', ['sri lanka']],
  ['Nepal', 'NP', ['nepal']],
  ['Singapore', 'SG', ['singapore']],
  ['Malaysia', 'MY', ['malaysia', 'malasia']],
  ['Indonesia', 'ID', ['indonesia', 'indonesien']],
  ['Philippines', 'PH', ['philippines', 'filipinas', 'philippinen']],
  ['Vietnam', 'VN', ['vietnam']],
  ['Thailand', 'TH', ['thailand', 'tailandia']],
  ['Cambodia', 'KH', ['cambodia']],
  ['Laos', 'LA', ['laos']],
  ['Myanmar', 'MM', ['myanmar', 'burma']],
  ['Mongolia', 'MN', ['mongolia']],
  ['Brunei', 'BN', ['brunei', 'brunei darussalam']],
  ['Japan', 'JP', ['japan', 'japón', 'japão']],
  ['South Korea', 'KR', ['south korea', 'korea', 'corea del sur', 'coreia do sul', 'südkorea']],
  ['China', 'CN', ['china']],
  ['Hong Kong', 'HK', ['hong kong']],
  ['Macao', 'MO', ['macao', 'macau']],
  ['Taiwan', 'TW', ['taiwan']],
  ['Australia', 'AU', ['australia']],
  ['New Zealand', 'NZ', ['new zealand']],
  ['Brazil', 'BR', ['brazil', 'brasil']],
  ['Mexico', 'MX', ['mexico', 'méxico', 'méjico']],
  ['Argentina', 'AR', ['argentina']],
  ['Colombia', 'CO', ['colombia']],
  ['Chile', 'CL', ['chile']],
  ['Peru', 'PE', ['peru', 'perú']],
  ['Uruguay', 'UY', ['uruguay']],
  ['Costa Rica', 'CR', ['costa rica']],
  ['Ecuador', 'EC', ['ecuador']],
  ['Bolivia', 'BO', ['bolivia']],
  ['Paraguay', 'PY', ['paraguay']],
  ['Venezuela', 'VE', ['venezuela']],
  ['Panama', 'PA', ['panama']],
  ['Guatemala', 'GT', ['guatemala']],
  ['Honduras', 'HN', ['honduras']],
  ['El Salvador', 'SV', ['el salvador']],
  ['Nicaragua', 'NI', ['nicaragua']],
  ['Dominican Republic', 'DO', ['dominican republic']],
  ['Puerto Rico', 'PR', ['puerto rico']],
];

function escape(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Text is compared with its accents removed, so "España", "Espana" and "ESPAÑA" are one
// spelling; the aliases go through the same folding so an accented alias can match at all.
const fold = (text) =>
  String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// A country name inside a longer place name is not the country: New Mexico, New South Wales,
// New England, Panama City (Florida).
const NOT_AFTER = { mexico: 'new ', wales: 'new south ', england: 'new ' };
const NOT_BEFORE = { panama: ' city' };
const aliasPattern = (alias) =>
  (NOT_AFTER[alias] ? `(?<!${NOT_AFTER[alias]})` : '') + escape(alias) + (NOT_BEFORE[alias] ? `(?!${NOT_BEFORE[alias]})` : '');

const NAMED = [...REGIONS.map(([name, aliases]) => [name, aliases]), ...COUNTRIES.map(([name, , aliases]) => [name, aliases])];

const RULES = NAMED.map(([name, aliases]) => [
  name,
  new RegExp(`(^|[^a-z])(${aliases.map((alias) => aliasPattern(fold(alias))).join('|')})(?![a-z])`, 'i'),
]);

const ALIAS_TO_NAME = new Map(NAMED.flatMap(([name, aliases]) => aliases.map((alias) => [fold(alias), name])));

/** The country or region a whole token names ("UK", "United States"), or '' for anything else. */
export function countryForToken(token) {
  const key = fold(token).replace(/\s+/g, ' ').trim();
  return ALIAS_TO_NAME.get(key) || ALIAS_TO_NAME.get(key.replace(/^the /, '')) || '';
}

export const COUNTRY_NAMES = NAMED.map(([name]) => name);

const NAME_BY_CODE = new Map(COUNTRIES.map(([name, code]) => [code, name]));

// The names that are countries in their own right. COUNTRY_NAMES is wider: it also holds the
// regions a job can be open to and the catch-alls a source writes instead of a place ("Worldwide"),
// which are answers to "where is this job" but not to "which country is this".
const REAL_COUNTRIES = new Set(NAME_BY_CODE.values());

/** Whether a name is a country, as against a region ("Europe") or a catch-all ("Worldwide"). */
export const isCountryName = (name) => REAL_COUNTRIES.has(String(name || '').trim());

/** The canonical name for an ISO 3166-1 alpha-2 code ("de", "GB" -> "Germany", "United Kingdom"), or ''. */
export function countryNameFromCode(code) {
  return NAME_BY_CODE.get(String(code || '').trim().toUpperCase()) || '';
}

const CODE_BY_NAME = new Map(COUNTRIES.map(([name, code]) => [name, code]));

/** The ISO code for a canonical country name ("Germany" -> "DE"), or ''. Regions and catch-alls have none. */
export function countryCodeFromName(name) {
  return CODE_BY_NAME.get(String(name || '').trim()) || '';
}

/**
 * What the "Work from" filter matches for a region: the region itself, wider regions that
 * contain it (a job open to the "Americas" is open to North America), and its countries.
 * Membership follows freehire's regionCountries (text/dict/data/countries.json), which
 * countries.test.js checks; Europe is the whole continent, not the Union, and Middle East is
 * MENA, so it takes North Africa.
 */
export const REGION_FILTERS = {
  'North America': ['North America', 'Americas', 'United States', 'Canada', 'Mexico'],
  'Latin America': [
    'Latin America',
    'South America',
    'Americas',
    'Mexico',
    'Brazil',
    'Argentina',
    'Colombia',
    'Chile',
    'Peru',
    'Uruguay',
    'Costa Rica',
    'Ecuador',
    'Bolivia',
    'Paraguay',
    'Venezuela',
    'Panama',
    'Guatemala',
    'Honduras',
    'El Salvador',
    'Nicaragua',
    'Dominican Republic',
    'Puerto Rico',
  ],
  Europe: [
    'Europe',
    'EMEA',
    'United Kingdom',
    'Ireland',
    'Germany',
    'France',
    'Spain',
    'Portugal',
    'Italy',
    'Netherlands',
    'Belgium',
    'Switzerland',
    'Austria',
    'Poland',
    'Czech Republic',
    'Slovakia',
    'Hungary',
    'Romania',
    'Bulgaria',
    'Greece',
    'Croatia',
    'Serbia',
    'Slovenia',
    'Ukraine',
    'Lithuania',
    'Latvia',
    'Estonia',
    'Sweden',
    'Norway',
    'Denmark',
    'Finland',
    'Iceland',
    'Luxembourg',
    'Liechtenstein',
    'Monaco',
    'Andorra',
    'San Marino',
    'Malta',
    'Cyprus',
    'Bosnia and Herzegovina',
    'North Macedonia',
    'Albania',
    'Montenegro',
    'Kosovo',
  ],
  APAC: [
    'APAC',
    'Asia',
    'Singapore',
    'Japan',
    'Australia',
    'New Zealand',
    'India',
    'Hong Kong',
    'Taiwan',
    'South Korea',
    'China',
    'Malaysia',
    'Thailand',
    'Philippines',
    'Vietnam',
    'Indonesia',
    'Bangladesh',
    'Pakistan',
    'Sri Lanka',
    'Nepal',
    'Cambodia',
    'Laos',
    'Myanmar',
    'Mongolia',
    'Brunei',
    'Macao',
  ],
  'Middle East': [
    'Middle East',
    'EMEA',
    'United Arab Emirates',
    'Saudi Arabia',
    'Israel',
    'Egypt',
    'Turkey',
    'Qatar',
    'Kuwait',
    'Bahrain',
    'Oman',
    'Jordan',
    'Lebanon',
    'Iraq',
    'Iran',
    'Morocco',
    'Algeria',
    'Tunisia',
    'Libya',
    'Yemen',
    'Palestine',
  ],
  Africa: [
    'Africa',
    'EMEA',
    'South Africa',
    'Nigeria',
    'Kenya',
    'Ghana',
    'Ethiopia',
    'Tanzania',
    'Uganda',
    'Rwanda',
    'Senegal',
    'Ivory Coast',
    'Cameroon',
    'Angola',
    'Mozambique',
    'Zambia',
    'Zimbabwe',
    'Mauritius',
  ],
};

/** The `countries` values a location filter matches: a region's whole group, or the one name. */
export function countryFilterValues(name) {
  if (REGION_FILTERS[name]) return REGION_FILTERS[name];
  return COUNTRY_NAMES.includes(name) ? [name] : [];
}

// "Austin, TX" / "Warren, MI" / "Remote - California": a US state with no country named.
// Georgia is left out of the full names because it is also a country.
const US_STATE_ABBREVIATIONS =
  'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
const US_STATE_NAMES =
  'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming';
const US_STATE_CODE = new RegExp(`,\\s*(${US_STATE_ABBREVIATIONS})(?![A-Za-z])`, 'gi');
const US_STATE_NAME = new RegExp(`(?:^|[^a-z])(?:${US_STATE_NAMES})(?![a-z])`, 'i');

// State codes that are also the ISO code of a country in the table: ", DE" is Delaware after
// "Wilmington" and Germany after "Berlin", ", IN" Indiana or India, ", CA" California or Canada.
// Workday and SAP boards write a city with its country's code this way ("Pune, IN, 411013"), and
// before the city was asked, every such posting was read as a US one.
const AMBIGUOUS_STATE_CODES = new Set(US_STATE_ABBREVIATIONS.split('|').filter((code) => NAME_BY_CODE.has(code)));

/**
 * Whether a ", ST" in the text is a US state. A code that is also a country's is one only when
 * the city before the comma says so (dict/cities.js cityCountryAmong, tried on the last one to
 * three words before it, longest first): "San Francisco, CA" is, "Berlin, DE" is not, and a
 * name the gazetteer places in neither says nothing, so the code adds no country.
 */
function namesUsState(text) {
  for (const match of text.matchAll(US_STATE_CODE)) {
    const code = match[1].toUpperCase();
    if (!AMBIGUOUS_STATE_CODES.has(code)) return true;
    const before = text.slice(0, match.index).split(/[,;/|()]/).pop().trim().split(/\s+/).filter(Boolean);
    for (let size = Math.min(3, before.length); size >= 1; size -= 1) {
      const says = cityCountryAmong(before.slice(-size).join(' '), [code, 'US']);
      if (says === 'us') return true;
      if (says) break;
    }
  }
  return false;
}

export function isUsStateLocation(text) {
  const source = String(text || '');
  return namesUsState(source) || US_STATE_NAME.test(source);
}

// Eligibility phrases in a description, e.g. "must be based in the US",
// "authorized to work in Canada", "open to candidates in the UK or Ireland",
// "US-based", "United States only". Only the text right after the phrase is
// scanned so incidental mentions ("offices in Germany") are ignored.
const ELIGIBILITY_PHRASES =
  /\b(?:based|located|reside|resides|residing|live|living|physically located|eligible to work|authori[sz]ed to work|legally (?:authori[sz]ed|eligible|able) to work|right to work|work authori[sz]ation|residents?|candidates?|applicants?|hiring|open to (?:candidates|applicants)|must be|only available|available only|remote)\s+(?:in|within|from|of|to|across)\s+(?:the\s+)?([^.;\n]{0,60})/gi;
const SUFFIX_PHRASES = /\b([A-Za-z.]{2,30}(?:\s[A-Za-z]{2,20})?)[-\s](?:based|only|residents)\b/gi;
const LOCATION_LINE = /^[\s*•-]*location\s*:\s*([^.;\n]{0,80})/gim;
const TIMEZONE_PHRASES = /\b([A-Za-z.]{2,30}(?:\s[A-Za-z]{2,20})?)\s+time\s?zones?\b/gi;

const windowsOf = (text, patterns) => patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]));

export function extractCountriesFromDescription(description) {
  const text = String(description || '');
  if (!text) return [];
  const stated = extractCountries(...windowsOf(text, [ELIGIBILITY_PHRASES, SUFFIX_PHRASES, LOCATION_LINE]));
  // A time zone sets working hours, not where one may live: it places the job only when nothing
  // else does. "Location: LATAM 100% Remote. Working hours are based on the US Central Time Zone"
  // is a Latin America job (Abstra, 2026-10-07).
  return stated.length > 0 ? stated : extractCountries(...windowsOf(text, [TIMEZONE_PHRASES]));
}

let regionNames;

/** The English region name for an ISO 3166-1 alpha-2 code ("gb" -> "United Kingdom"), or ''. */
export function regionNameFromCode(code) {
  const upper = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '';
  regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
  try {
    const name = regionNames.of(upper);
    return name && name !== upper ? name : '';
  } catch {
    return '';
  }
}

// countryNameFromCode under the name the sources import it by (sources/aggregators/hiringcafe.js).
export { countryNameFromCode as countryFromCode };

export function extractCountries(...texts) {
  const text = fold(texts.filter(Boolean).map(String).join(' | '));
  if (!text.trim()) return [];

  const found = [];
  let remaining = text;
  for (const [name, pattern] of RULES) {
    if (pattern.test(remaining)) {
      found.push(name);
      // Remove the matched alias so a region name can't also feed a country rule.
      remaining = remaining.replace(new RegExp(pattern.source, 'gi'), '$1 ');
    }
  }
  if (found.length === 0 && isUsStateLocation(text)) found.push('United States');
  return found;
}

const PATTERN_FOR_PLACE = new Map(RULES);

// "Worldwide" needs explicit wording: "global network" or "work together from anywhere in the
// world" in company copy says nothing about where candidates may work.
const WORLDWIDE_WORDING =
  /\bworldwide\b|\b(work|working|remote|remotely) from anywhere\b|\bremote[- ]anywhere\b|\bany (location|country)\b|\blocation: ?anywhere\b/i;

/** True when the text names the country or region by any of its aliases (or by its own name when the table lacks it). */
export function placeMentioned(name, text) {
  const source = String(text || '').normalize('NFKD').replace(/\p{M}+/gu, '');
  if (name === 'Worldwide') return WORLDWIDE_WORDING.test(source);
  const pattern = PATTERN_FOR_PLACE.get(name);
  if (pattern) return pattern.test(source) || (name === 'United States' && isUsStateLocation(source));
  return new RegExp('(^|[^a-z])' + escape(name) + '(?![a-z])', 'i').test(source);
}
