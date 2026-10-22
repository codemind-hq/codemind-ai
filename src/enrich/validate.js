import { countryForToken, extractCountries, placeMentioned, regionNameFromCode } from '../text/countries.js';
import { ENRICH_GROUPS, GROUP_DEFAULTS, SUBCATEGORIES, UNASKED_GROUPS, fillOmitted, groupSchemas } from './schema.js';
import { BILLION_VALUATION, FOR_A_CLIENT, VENTURE_BACKED } from '../text/startupSignals.js';
import { canonicalSkill as dictionarySkill, parseSkills, skillLabel } from '../text/dict/skills.js';
import { MAX_MODEL_KEYWORDS, canonicalKeyword, isGenericKeyword, normalizeKeyword } from '../text/jobKeywords.js';
import { cityCountry } from '../text/dict/cities.js';
import { seniorityFromTitle } from '../text/seniority.js';

// Deterministic checks on a model's answer: the same answer always gets the same verdict.
// A check that fails marks its field group as failed (retried, and left blank if it never
// passes); cosmetic problems (duplicate skills, stray whitespace) are fixed silently instead.
// Models often write "", 0, "unknown" or "not specified" for a fact the posting does not state:
// that is read as "not stated", never as a failure. A quote is only required where it backs a
// value (work type, salary, where the candidate must live, an onsite interview).

const MAX_SKILLS = 20;
const MAX_QUOTE_IN_MESSAGE = 80;

// Coarse USD rates, only to catch unit mistakes (hourly pay labelled yearly, a dropped "k");
// the bounds are wide on purpose. Currencies not listed skip the range check.
const USD_RATE = {
  USD: 1, EUR: 1.1, GBP: 1.3, CHF: 1.15, CAD: 0.73, AUD: 0.66, NZD: 0.6, SGD: 0.75, HKD: 0.13,
  INR: 0.012, PKR: 0.0036, JPY: 0.0068, KRW: 0.00073, CNY: 0.14, TWD: 0.031, PHP: 0.018,
  IDR: 0.00006, VND: 0.00004, THB: 0.029, MYR: 0.22, BRL: 0.18, MXN: 0.055, COP: 0.00025,
  ARS: 0.001, CLP: 0.001, CRC: 0.002, PLN: 0.26, CZK: 0.044, HUF: 0.0028, RON: 0.22, BGN: 0.56,
  SEK: 0.095, NOK: 0.095, DKK: 0.15, TRY: 0.03, ILS: 0.27, AED: 0.27, SAR: 0.27, EGP: 0.02,
  NGN: 0.00065, ZAR: 0.055,
};
const USD_BOUNDS = {
  year: [3000, 2_000_000],
  month: [250, 170_000],
  week: [60, 40_000],
  day: [12, 8000],
  hour: [1.5, 1000],
};

const AMOUNT_UNITS = { k: 1e3, m: 1e6, mm: 1e6, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, lpa: 1e5, crore: 1e7, crores: 1e7 };

// Placeholder text a model writes in place of null.
const NOT_STATED = /^(unknown|none|null|nil|n\/?a|tbd|unspecified|not (specified|stated|provided|mentioned|available|applicable|disclosed)|-+|\(.*\))$/i;
const NO_CLEARANCE = /^(no|not required|no clearance( required)?)$/i;

// Words that say how the work is arranged. A work-type quote without one (a bare city, "based in
// London") is not evidence of the type.
const ARRANGEMENT_WORDS =
  /\b(remote(ly)?|anywhere|distributed|work(ing)? from home|wfh|home[- ]?office|telecommut\w*|hybrid|office|on[- ]?site|in[- ]?person|days? (a|per|each) week|presencial\w*|remot[oa]|h[ií]brid[oa]|t[ée]l[ée]travail|hybride|sur site|vor ort|flex(ible)? work\w*)/i;

// Wording a remote or hybrid quote could come from; "office" and "on-site" are not it.
const REMOTE_OR_HYBRID_WORDS =
  /\b(remote(ly)?|anywhere|work(ing)? from home|wfh|home[- ]?office|telecommut\w*|hybrid|days? (a|per|each) week|remot[oa]|h[ií]brid[oa]|t[ée]l[ée]travail|hybride|flex(ible)? work\w*|homeoffice|mobiles arbeiten)/i;

// An onsite-interview quote has to talk about the interview process, not just an office.
const INTERVIEW_WORDS = /\b(interview\w*|assessment\w*|round|super ?day|hiring (event|day))/i;
// "May be asked to attend an in-person interview" does not require one, and a "no" needs wording
// about the whole process ("all interviews are on Zoom"), not just a video call.
const TENTATIVE_WORDS = /\b(may|might|could|possibly|optional(ly)?)\b/i;
const WHOLE_PROCESS_WORDS = /\b(all|every|entire(ly)?|fully|completely|whole|interview process)\b|100%/i;
const VIRTUAL_WORDS = /\b(virtual(ly)?|remote(ly)?|video|zoom|online|google meet|microsoft teams|phone)\b/i;

// Below this many characters a posting may name no technology; above it, an answer with no skills
// at all is a model slip (seen at random on the same postings across runs).
const LONG_DESCRIPTION_CHARS = 1500;

// Models sometimes copy the label the posting was given under ("LOCATION: Remote").
const POSTING_LABEL = /^\s*(title|company|location|description)\s*:\s*/i;


/** Whitespace collapsed; null when nothing, or only placeholder text, is left. */
function clean(value) {
  // Control and format characters too: models sometimes emit them for characters they cannot copy.
  const text = String(value ?? '').replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ').trim();
  return text && !NOT_STATED.test(text) ? text : null;
}

function shorten(text) {
  return text.length > MAX_QUOTE_IN_MESSAGE ? `${text.slice(0, MAX_QUOTE_IN_MESSAGE)}…` : text;
}

/** Lowercase letters and digits separated by single spaces: how quotes are compared. */
export function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    // Words glued where HTML blocks were joined ("USDAbout Us") still compare word by word.
    .replace(/(\p{Ll})(?=\p{Lu})|(\p{Lu})(?=\p{Lu}\p{Ll})/gu, '$1$2 ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True when every part of the quote (parts joined with "...") appears in the posting. */
export function quoteFound(quote, normalizedPosting) {
  const parts = String(quote || '')
    .split(/\.{3}|…/)
    .map((part) => normalizeForMatch(part.replace(POSTING_LABEL, '')))
    .filter(Boolean);
  if (parts.length === 0) return false;
  const haystack = ` ${normalizedPosting} `;
  return parts.every((part) => haystack.includes(` ${part} `));
}

/**
 * Every amount a salary quote could mean: "120-150k" gives 120, 150, 120000 and 150000,
 * because a unit written once applies to each number in the quote.
 */
export function amountsIn(quote) {
  const numbers = [];
  const units = new Set([1]);
  const pattern = /(\d{1,3}(?:[,.\s]\d{3})+|\d+(?:[.,]\d{1,2})?)\s*(k|mm|m|lakhs?|lacs?|lpa|crores?)?(?!\p{L})/giu;
  for (const [, digits, unit] of String(quote || '').matchAll(pattern)) {
    const grouped = /^\d{1,3}(?:[,.\s]\d{3})+$/.test(digits);
    numbers.push(grouped ? Number(digits.replace(/\D/g, '')) : Number(digits.replace(',', '.')));
    if (unit) units.add(AMOUNT_UNITS[unit.toLowerCase()]);
  }
  return [...new Set(numbers.flatMap((n) => [...units].map((u) => n * u)))];
}

let countryNames;

// English names of every ISO 3166 region ("luxembourg" -> "Luxembourg"), for countries the
// app's own table does not list.
function countryNameIndex() {
  if (countryNames) return countryNames;
  countryNames = new Map();
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const name = regionNameFromCode(String.fromCharCode(a, b));
      if (name && !/unknown|pseudo/i.test(name)) countryNames.set(normalizeForMatch(name), name);
    }
  }
  return countryNames;
}

/** A country or region as the app names it ("US" -> "United States", "EMEA"), or '' when it is neither. */
export function resolveCountry(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const known = countryForToken(text);
  if (known) return known;
  const code = /^[a-z]{2}$/i.test(text) ? regionNameFromCode(text) : '';
  const name = (code && !/unknown|pseudo/i.test(code) ? code : '') || countryNameIndex().get(normalizeForMatch(text)) || '';
  if (!name) return '';
  const canonical = extractCountries(name);
  return canonical.length === 1 ? canonical[0] : name;
}

/**
 * The countries or regions one answer entry names: "North America (the U.S. and Canada)" is
 * North America, "United States/Canada" both; an entry naming none gives [].
 */
export function countriesInEntry(entry) {
  const text = clean(entry);
  if (!text) return [];
  const direct = resolveCountry(text) || resolveCountry(text.replace(/\s*\([^)]*\)\s*/g, ' '));
  return direct ? [direct] : extractCountries(text);
}

// A skill the dictionary knows is stored under its display label, so "k8s", "Kubernetes"
// and "kubernetes" all read "Kubernetes" and "ci/cd" reads "CI/CD"; one the dictionary
// does not know keeps the model's words, since a skill outside the vocabulary is still
// a skill the posting names — provided the posting names it: a term the dictionary does not
// know and the posting never says ("Git (source control) Wildlife Jenkins", a company's name
// run into a tool's) is dropped, as is a practice that is no skill ("docs", "tests", "source
// freshness"), which lowered every resume's match for a thing nobody lists.
function canonicalSkill(value, posting = '') {
  const skill = clean(value);
  if (!skill || skill.length > 60) return null;
  const slug = dictionarySkill(skill);
  if (slug) return skillLabel(slug);
  if (NOT_A_SKILL.has(normalizeKeyword(skill)) || isGenericKeyword(normalizeKeyword(skill))) return null;
  if (posting && !quoteFound(skill, posting)) return null;
  return skill;
}

// Practices and nouns a model files as skills that no resume lists as one.
const NOT_A_SKILL = new Set([
  'docs', 'doc', 'documentation', 'tests', 'test', 'testing', 'unit tests', 'unit testing', 'source freshness',
  'code review', 'code reviews', 'pull requests', 'version control', 'source control', 'best practices', 'clean code',
  'problem solving', 'communication', 'teamwork', 'collaboration', 'mentoring', 'leadership', 'ownership',
  'attention to detail', 'time management', 'analytical skills', 'written communication', 'verbal communication',
  'english', 'german', 'french', 'spanish', 'bachelor', "bachelor's degree", 'degree', 'computer science',
  'on call', 'on-call', 'monitoring', 'observability', 'performance', 'scalability', 'security', 'reliability',
  'architecture', 'system design', 'data structures', 'algorithms', 'oop', 'object oriented programming',
  'software development', 'software engineering', 'web development', 'frontend', 'backend', 'full stack',
]);

function uniqueCaseless(values, limit = Infinity) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out.slice(0, limit);
}

// A quote that backs a value must be in the posting, or its group fails; an optional quote that
// is not in the posting is just dropped.
function verifiedQuote(quote, posting, fail, field, required) {
  const text = clean(quote);
  if (!text) {
    if (required) fail('evidence_missing', `${field} is required`);
    return null;
  }
  if (quoteFound(text, posting)) return text;
  if (required) fail('evidence_not_found', `${field} "${shorten(text)}" is not an exact quote from the posting`);
  return null;
}

const NO_SALARY = { min: null, max: null, currency: null, period: null, evidence: null };

// One function per field group: (parsed group, { posting, fail }) -> normalized group.
const CHECKS = {
  category(data) {
    // A subcategory of another category ("backend" + "ios") is dropped rather than retried.
    const allowed = data.primary === 'other' ? [] : [...(SUBCATEGORIES[data.primary] || []), ...SUBCATEGORIES.any];
    return {
      primary: data.primary,
      subcategory: allowed.includes(data.subcategory) ? data.subcategory : null,
      isSoftwareRole: data.primary !== 'other',
    };
  },

  workplace(data, { posting, rawPosting, fail }) {
    const { type } = data;
    if (type === 'unknown') return { type, evidence: null };
    // On-site with no quote is the model reading a plain location as on-site, which is what our
    // rules already did: it counts as unknown rather than failing. A retry rarely did better (about
    // 1 in 100 found another type; most quoted the location line, which is unknown below anyway).
    // Remote and hybrid without a quote fail only when the posting has words a retry could quote:
    // in production 196 of 213 such answers came from postings that never say remote or hybrid, and
    // no retry can find a quote that is not there.
    if (type === 'onsite' && !clean(data.evidence)) return { type: 'unknown', evidence: null };
    if (!clean(data.evidence) && !REMOTE_OR_HYBRID_WORDS.test(rawPosting)) return { type: 'unknown', evidence: null };

    const evidence = verifiedQuote(data.evidence, posting, fail, 'workplace.evidence', true);
    if (evidence && !ARRANGEMENT_WORDS.test(evidence)) return { type: 'unknown', evidence: null };
    return { type, evidence };
  },

  location(data, { posting, rawPosting, value, fail }) {
    const locations = [];
    const seen = new Set();
    for (const entry of data.locations) {
      const city = clean(entry.city);
      const region = clean(entry.region);
      const countries = countriesInEntry(entry.country);
      const country = countries.length === 1 ? countries[0] : null;
      const key = [city, region, country].join('|').toLowerCase();
      if ((city || region || country) && !seen.has(key)) {
        seen.add(key);
        locations.push({ city, region, country });
      }
    }

    const mustResideIn = clean(data.mustResideIn);
    // Only places the posting names: models add "Worldwide" or whole regions on their own.
    const remoteEligibleCountries = [...new Set(data.remoteEligibleCountries.flatMap(countriesInEntry))].filter((place) =>
      placeMentioned(place, rawPosting)
    );
    const timezone = clean(data.timezone);
    return {
      locations,
      remoteEligibleCountries,
      mustResideIn,
      timezone,
      mustResideInEvidence: verifiedQuote(
        data.mustResideInEvidence,
        posting,
        fail,
        'location.mustResideInEvidence',
        Boolean(mustResideIn)
      ),
      remoteScope: remoteScopeOf(data.remoteScope, {
        // Validated earlier this pass: workplace comes before location (schema.js ENRICH_GROUPS).
        workplace: value.workplace?.type,
        limited: remoteEligibleCountries.length > 0 || Boolean(mustResideIn) || Boolean(timezone),
        rawPosting,
      }),
    };
  },

  // "from $120,000" keeps max null and "up to $150,000" keeps min null.
  salary(data, { posting, fail }) {
    const stated = (amount) => (amount !== null && amount > 0 ? amount : null);
    const min = stated(data.min);
    const max = stated(data.max);
    if (min === null && max === null) return NO_SALARY;
    // The same round figure at both ends ("₹1,000,000 – ₹1,000,000", "$100,000 - $100,000") is a
    // board's required field filled in, not pay the posting states; the model read it as written,
    // so nothing is retried. One figure that is not round ("$87,500") stays as the one it is.
    if (min !== null && min === max && min % 10_000 === 0) return NO_SALARY;
    const currency = clean(data.currency)?.toUpperCase() || null;
    const { period } = data;
    const amounts = [['min', min], ['max', max]].filter(([, amount]) => amount !== null);

    if (min !== null && max !== null && min > max) fail('min_above_max', `salary.min ${min} is greater than salary.max ${max}`);
    if (!currency || !Intl.supportedValuesOf('currency').includes(currency)) {
      fail('currency', `salary.currency "${data.currency}" is not an ISO 4217 code`);
    }
    if (!period) fail('period_missing', 'salary.period is required when an amount is given');
    const evidence = verifiedQuote(data.evidence, posting, fail, 'salary.evidence', true);

    if (evidence) {
      const quoted = amountsIn(evidence);
      const near = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
      for (const [field, amount] of amounts) {
        if (field === 'max' && max === min) continue;
        if (!quoted.some((a) => near(a, amount))) {
          fail('amount_not_in_quote', `salary.${field} ${amount} does not appear in salary.evidence`);
        }
      }
    }
    if (currency && period && USD_RATE[currency]) {
      const [floor, ceiling] = USD_BOUNDS[period];
      if (amounts.some(([, amount]) => amount * USD_RATE[currency] < floor || amount * USD_RATE[currency] > ceiling)) {
        fail('out_of_range', `salary ${min ?? '?'}-${max ?? '?'} ${currency} per ${period} is implausible; check the period and the units`);
      }
    }
    return { min, max, currency, period, evidence };
  },

  role(data, { rawPosting, fail }) {
    const years = data.yearsExperienceMin;
    if (years !== null && (years < 0 || years > 30)) {
      fail('out_of_range', `role.yearsExperienceMin must be 0-30, got ${years}`);
    }
    // The top of a stated range ("3-5 years"); a bound at or below the minimum is not a range.
    const most = data.yearsExperienceMax;
    if (most !== null && (most < 0 || most > 30)) {
      fail('out_of_range', `role.yearsExperienceMax must be 0-30, got ${most}`);
    }
    return {
      seniority: data.seniority,
      yearsExperienceMin: years,
      yearsExperienceMax: most > 0 && (years === null || most > years) ? most : null,
      employmentType: employmentTypeStated(data.employmentType, rawPosting),
    };
  },

  skills(data, { posting, rawPosting, descriptionChars, fail }) {
    const required = uniqueCaseless(data.required.map((skill) => canonicalSkill(skill, posting)), MAX_SKILLS);
    const requiredKeys = new Set(required.map((skill) => skill.toLowerCase()));
    const preferred = uniqueCaseless(data.preferred.map((skill) => canonicalSkill(skill, posting))).filter((skill) => !requiredKeys.has(skill.toLowerCase()));
    // Only when the skill dictionary finds one in the text: a posting that names none (a patrol
    // officer, a plant engineer, an ad about the company) gave retries nothing but "valid driver's
    // license" or "Microsoft", at gpt-5-mini's price.
    const noSkills = required.length === 0 && preferred.length === 0;
    if (noSkills && descriptionChars > LONG_DESCRIPTION_CHARS && parseSkills(descriptionOf(rawPosting)).length > 0) {
      fail('skills_missing', 'skills.required and skills.preferred are both empty for a long posting; list the technologies it names');
    }
    // Models (gpt-5-mini especially) often file every skill as preferred; a posting that names skills
    // but marks none as required is rare, so they are treated as required.
    if (required.length === 0) return { required: preferred.slice(0, MAX_SKILLS), preferred: [] };
    return { required, preferred: preferred.slice(0, MAX_SKILLS) };
  },

  conditions(data, { posting, rawPosting, fail }) {
    const travel = data.travelPercent === 0 ? null : data.travelPercent;
    if (travel !== null && (travel < 0 || travel > 100)) {
      fail('out_of_range', `conditions.travelPercent must be 0-100, got ${travel}`);
    }

    let onsiteInterview = data.onsiteInterview;
    let onsiteInterviewEvidence = null;
    if (onsiteInterview !== 'unknown') {
      onsiteInterviewEvidence = verifiedQuote(
        data.onsiteInterviewEvidence,
        posting,
        fail,
        'conditions.onsiteInterviewEvidence',
        true
      );
      // "Our New York office" alone says nothing about the interview.
      const quote = onsiteInterviewEvidence;
      const unsupported =
        quote &&
        (!INTERVIEW_WORDS.test(quote) ||
          (onsiteInterview === 'yes' && TENTATIVE_WORDS.test(quote)) ||
          (onsiteInterview === 'no' && !(WHOLE_PROCESS_WORDS.test(quote) && VIRTUAL_WORDS.test(quote))));
      if (unsupported) {
        onsiteInterview = 'unknown';
        onsiteInterviewEvidence = null;
      }
    }

    const clearance = clean(data.securityClearance);
    return {
      visaSponsorship: data.visaSponsorship,
      securityClearance: clearanceName(clearance),
      travelPercent: travel,
      relocationAssistance: data.relocationAssistance,
      degree: degreeStated(data.degree, rawPosting),
      languages: uniqueCaseless(data.languages.map(clean)),
      onsiteInterview,
      onsiteInterviewEvidence,
      equityOffered: equityFromText(rawPosting),
    };
  },

  // Optional and never retried: a value its quote does not back is dropped, since a wrong startup
  // badge is worse than none.
  company(data, { posting, rawPosting }) {
    const none = { fundingStage: null, calledStartup: false, employeeCount: null, evidence: null };
    const claims = data.fundingStage || data.calledStartup || data.employeeCount != null;
    const description = descriptionOf(rawPosting);
    if (!claims || FOR_A_CLIENT.test(description)) return none;
    // A company valued at a billion is past early stage, whatever round it names (seen live: "valued
    // at over $1 billion, and are backed by leading investors" read as venture-backed).
    const unicorn = sentencesOf(description).find((s) => BILLION_VALUATION.test(s) && !CANDIDATE_BACKGROUND.test(s));
    if (unicorn) return { ...none, fundingStage: 'later_stage', evidence: unicorn.slice(0, 200) };

    // Each value needs a passage that says it of the company rather than the candidate: the model's
    // quote, or, when it left the quote out (gpt-5-nano often answers "null"), a sentence of the posting.
    const quoted = verifiedQuote(data.evidence, posting, () => {}, 'company.evidence', false);
    const passages = (quoted ? [quoted] : sentencesOf(description)).filter((p) => !CANDIDATE_BACKGROUND.test(p));
    const saying = (pattern) => passages.find((p) => pattern.test(p)) || null;
    const stageQuote = data.fundingStage ? saying(STAGE_WORDS[data.fundingStage]) : null;
    const startupQuote = data.calledStartup ? saying(STARTUP_WORD) : null;
    const count = data.employeeCount;
    const countQuote = count > 0 && count <= 1000000 ? passages.find((p) => HEADCOUNT_WORDS.test(p) && numbersIn(p).includes(count)) : null;
    if (!stageQuote && !startupQuote && !countQuote) return none;
    return {
      fundingStage: stageQuote ? data.fundingStage : null,
      calledStartup: Boolean(startupQuote),
      employeeCount: countQuote ? count : null,
      evidence: quoted || [...new Set([stageQuote, startupQuote, countQuote].filter(Boolean))].map((s) => s.slice(0, 200)).join(' ... '),
    };
  },

  // Domain words for keyword search (jobs/keywords.js). Nothing here fails the group: a tag the
  // posting does not contain, or one too generic to rank anything, is dropped, so search never
  // matches a word the posting never said.
  keywords(data, { rawPosting, value }) {
    return {
      tags: cleanKeywords(data.tags, {
        posting: rawPosting,
        company: companyOf(rawPosting),
        // Validated earlier this pass: keywords is the last group (schema.js ENRICH_GROUPS).
        skills: [...(value.skills?.required || []), ...(value.skills?.preferred || [])],
        location: labelled(rawPosting, 'LOCATION'),
      }),
    };
  },
};

const MAX_KEYWORD_WORDS = 3;
const MAX_KEYWORD_CHARS = 40;

/**
 * The tags found in the posting, folded to their stored spelling, each once, at most
 * MAX_MODEL_KEYWORDS. Compared with keywords.js normalizeKeyword rather than normalizeForMatch: a
 * tag is a word as written ("APIs"), not a quote, so the glued-word splitter would only mangle it.
 *
 * Dropped as well as the ungrounded and the generic: a tag that repeats one of this posting's own
 * skills, since keywordsFor adds every skill anyway, and a tag that names the place the posting is
 * in, since the location is indexed on its own. Measured on a 50-job dry run of v10, where 206 of
 * 441 tags were the job's own technologies. Only a city the LOCATION line names is dropped: "vista"
 * is a town in California and the VA's health record system, and the posting says which it means.
 */
export function cleanKeywords(tags, { posting, company, skills = [], location = '' }) {
  const haystack = ` ${normalizeKeyword(posting)} `;
  const companyKey = normalizeKeyword(company);
  const ownSkills = new Set(skills.map((skill) => canonicalKeyword(skill)).filter(Boolean));
  const where = ` ${normalizeKeyword(location)} `;
  const kept = [];
  for (const raw of tags || []) {
    const surface = normalizeKeyword(raw);
    if (!surface || surface === companyKey) continue;
    if (surface.split(' ').length > MAX_KEYWORD_WORDS || surface.length > MAX_KEYWORD_CHARS) continue;
    if (!haystack.includes(` ${surface} `)) continue;
    if (cityCountry(surface) && where.includes(` ${surface} `)) continue;
    const tag = canonicalKeyword(surface);
    if (isGenericKeyword(tag) || ownSkills.has(tag) || kept.includes(tag)) continue;
    kept.push(tag);
    if (kept.length >= MAX_MODEL_KEYWORDS) break;
  }
  return kept;
}

// The words each funding stage must be quoted with.
const STAGE_WORDS = {
  pre_seed: /\bpre[-\s]?seed\b/i,
  seed: /\bseed\b/i,
  series_a: /\bseries\s+a\b/i,
  series_b: /\bseries\s+b\b/i,
  series_c: /\bseries\s+c\b/i,
  // Funding wording, not "investors" or "backed by" alone (text/startupSignals.js VENTURE_BACKED):
  // a bank's "backed by the strength of our investors" made it a venture-backed startup.
  venture_backed: VENTURE_BACKED,
  later_stage: /\bseries\s+[d-h]\b|\bpre[-\s]?ipo\b/i,
  public: /\b(publicly|public company|nasdaq|nyse|lse|tsx|asx|stock exchange|listed on|ticker)\b/i,
  bootstrapped: /\b(bootstrapped|self[-\s]?funded|no (outside|external) (funding|investors))\b/i,
};
const STARTUP_WORD = /\bstart[-\s]?ups?\b/i;
// "a 15-person team", "we are 40 people", "200+ employees": a number alone may be anything.
const HEADCOUNT_WORDS = /\b(people|persons?|employees|team ?members|staff|strong|headcount|colleagues|engineers)\b|\d[-\s]?person\b/i;

/** A description's sentences and lines, trimmed. */
function sentencesOf(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
// "experience at an early-stage startup", "you've worked at a Series A company".
const CANDIDATE_BACKGROUND = /\b(experience (at|in|with|working)|you('ve| have)? (worked|been)|background (at|in)|previously (worked|at))\b/i;

/** Whole numbers written in a quote: "a 15-person team of 1,200" → [15, 1200]. */
function numbersIn(text) {
  return (String(text).match(/\d[\d,]*/g) || []).map((n) => Number(n.replace(/,/g, '')));
}

/** Rules between groups; applied to one answer and again to groups merged from several. */
export function crossGroupErrors(value) {
  const errors = [];
  if (value.workplace?.type === 'onsite' && value.location?.remoteEligibleCountries.length > 0) {
    errors.push({
      group: 'location',
      code: 'onsite_remote_countries',
      message: 'location.remoteEligibleCountries must be empty when workplace.type is "onsite"',
    });
  }
  return errors;
}

/**
 * validateEnrichment(answer, { posting, unasked }) → { ok, errors: [{ group, code, message }], failedGroups, value }
 * `answer` is the parsed model output (null when it was not JSON); `posting` the text the model
 * was given; `unasked` the groups its request left out, read as stating nothing whatever the answer
 * holds. `value` holds the normalized groups that passed.
 */
export function validateEnrichment(answer, { posting, unasked = [] }) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return {
      ok: false,
      errors: [{ group: 'response', code: 'invalid_json', message: 'the answer was not a valid JSON object' }],
      failedGroups: [...ENRICH_GROUPS],
      value: {},
    };
  }

  answer = fillOmitted(answer);
  const normalizedPosting = normalizeForMatch(posting);
  const descriptionChars = descriptionOf(posting).length;
  const errors = [];
  const value = {};
  for (const group of ENRICH_GROUPS) {
    const fail = (code, message) => errors.push({ group, code, message });
    const given = unasked.includes(group) ? UNASKED_GROUPS[group] : answer[group];
    const parsed = groupSchemas[group].safeParse(given ?? GROUP_DEFAULTS[group]);
    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      fail('schema', `${[group, ...issue.path].join('.')}: ${issue.message}`);
      continue;
    }
    value[group] = CHECKS[group](parsed.data, { posting: normalizedPosting, rawPosting: posting, descriptionChars, value, fail });
  }
  errors.push(...crossGroupErrors(value));

  const failedGroups = ENRICH_GROUPS.filter((group) => errors.some((e) => e.group === group));
  for (const group of failedGroups) delete value[group];
  // The title is explicit seniority language even when the model leaves seniority out.
  if (value.role && !value.role.seniority) value.role.seniority = seniorityFromTitle(titleOf(posting));
  // So does a cross-category subcategory the title names ("Software Engineer, Forward Deployed").
  const titleSubcategory = subcategoryFromTitle(titleOf(posting));
  if (value.category && titleSubcategory && value.category.primary !== 'other') value.category.subcategory = titleSubcategory;
  return { ok: errors.length === 0, errors, failedGroups, value };
}

// The seniority a job title states ("Sr. Backend Engineer" -> "senior"), or null: the one table
// ingest reads it with (../seniority.js), so a model that answered nothing leaves the level ingest gave.
export { seniorityFromTitle };

/** The value of one of the posting's header lines (buildPostingText): "TITLE: …", "COMPANY: …". */
const labelled = (posting, label) => new RegExp(`^${label}: (.*)$`, 'm').exec(String(posting || ''))?.[1] ?? '';
const titleOf = (posting) => labelled(posting, 'TITLE');
const companyOf = (posting) => labelled(posting, 'COMPANY');

function descriptionOf(posting) {
  const text = String(posting || '');
  const at = text.indexOf('\nDESCRIPTION:\n');
  return at < 0 ? text : text.slice(at + '\nDESCRIPTION:\n'.length);
}

// Roles found across categories that the title names outright; models rarely pick these subcategories.
const SUBCATEGORY_IN_TITLE = [
  ['forward_deployed', /\bforward[- ]deployed\b/i],
  ['enterprise_platforms', /\b(abap|sap|salesforce|servicenow|uipath|rpa|workday|dynamics 365|netsuite|oracle (ebs|fusion|apex))\b/i],
];

/** The cross-category subcategory a title names ("Senior ABAP Developer" -> "enterprise_platforms"), or null. */
export function subcategoryFromTitle(title) {
  return SUBCATEGORY_IN_TITLE.find(([, pattern]) => pattern.test(String(title || '')))?.[0] ?? null;
}

const GENERIC_CLEARANCE =
  /^(yes|required|clearance|clearance required|security clearance( required)?|active( security)? clearance|(us )?government( security)? clearance|dod clearance)$/i;

/** The named clearance, a note when the posting requires one without naming the level, or null. */
function clearanceName(clearance) {
  if (!clearance || NO_CLEARANCE.test(clearance)) return null;
  return GENERIC_CLEARANCE.test(clearance) ? 'Clearance required (level not stated)' : clearance;
}

// "Work from anywhere", "fully remote worldwide": wording that opens a remote job to every country.
const ANYWHERE_WORDS =
  /\b(anywhere|worldwide|world[- ]wide|globally|global(ly)? remote|remote[- ]global|any (country|location|time ?zone)|all (countries|time ?zones)|around the (world|globe)|location[- ](independent|agnostic))\b/i;

/**
 * Where a remote job may be done from. An onsite or hybrid job has no scope (one whose type the
 * posting leaves unstated may still be remote by its source); a job the reading limits to
 * countries, a place of residence or a timezone is "region" whatever the model said, and "global"
 * needs the posting's own words for anywhere (its location line counts), since a model may call any
 * remote job worldwide.
 */
function remoteScopeOf(scope, { workplace, limited, rawPosting }) {
  if (workplace === 'onsite' || workplace === 'hybrid') return null;
  if (limited) return 'region';
  if (scope === 'global') return ANYWHERE_WORDS.test(rawPosting) ? 'global' : null;
  return scope;
}

// Equity is read from the posting by rule: in the dry runs gpt-5-nano took "equity with other team
// members" (pay fairness) for stock and missed "receive stock options upon hire". Phrases where
// "equity" means something else are removed before looking for compensation wording.
const OTHER_EQUITY_MEANINGS =
  /\b(pay|internal|external|gender|racial|health|home|brand|private|public|social|digital|educational)\s+equity\b|\bequity\s+(with|among|across|between)\s+(other\s+)?(team\s+members|employees|peers|colleagues)\b|\bdiversity,?\s+equity\b|\bequity,?\s+(and|&)\s+inclusion\b|\binclusion,?\s+(and|&)\s+equity\b|\bequity\s+(research|markets?|trading|analysts?|capital|funds?|firms?|investors?|partners?|backed|financing)\b|\bprivate[- ]equity\b/gi;
const EQUITY_OFFERED =
  /\b(stock options?|rsus?|restricted stock( units?)?|equity (grants?|packages?|plans?|awards?|compensation|stakes?|refreshers?|incentives?|ownership)|(plus|with|and|includes?|including|offers?|receive|meaningful|early[- ]stage|competitive|generous|significant|substantial) equity|ownership stake|employee stock ownership)\b/i;
// A benefits list item that is just "Equity".
const EQUITY_LIST_ITEM = /(^|[\n•·|])\s*([-*]\s*)?equity\s*([\n•·|]|$)/i;
const NO_EQUITY = /\bno (equity|stock options)\b/i;

/** "yes" when the posting offers equity as compensation, "no" when it says it does not, otherwise "unknown". */
export function equityFromText(posting) {
  const text = String(posting || '').replace(OTHER_EQUITY_MEANINGS, ' ');
  if (NO_EQUITY.test(text)) return 'no';
  return EQUITY_OFFERED.test(text) || EQUITY_LIST_ITEM.test(text) ? 'yes' : 'unknown';
}

// gpt-5-nano answers "full-time" and degree "none" for postings that never say so (33 and 20 of 50
// jobs in the benchmark); a value the posting has no words for is dropped.
const EMPLOYMENT_WORDS = {
  'full-time': /\b(full[- ]?time|fte|permanent (role|position|employment|job|hire))\b/i,
  'part-time': /\bpart[- ]?time\b/i,
  contract: /\b(contract(or|ual)?|freelance|1099|c2c|corp[- ]to[- ]corp|fixed[- ]term)\b/i,
  internship: /\bintern(ship)?s?\b/i,
  temporary: /\b(temp|temporary|seasonal)\b/i,
};
const DEGREE_WORDS =
  /\b(degree|bachelor'?s?|master'?s?|ph\.?\s?d|doctorate|diploma|b\.?\s?s|m\.?\s?s|b\.?\s?a|b\.?\s?tech|m\.?\s?tech)\b|equivalent (practical |professional |work )?experience/i;

/** The employment type when the posting has words for it, otherwise null. */
export function employmentTypeStated(value, posting) {
  return value && EMPLOYMENT_WORDS[value]?.test(String(posting || '')) ? value : null;
}

/** The degree answer when the posting mentions degrees (or equivalent experience), otherwise null. */
export function degreeStated(value, posting) {
  return value && DEGREE_WORDS.test(String(posting || '')) ? value : null;
}
