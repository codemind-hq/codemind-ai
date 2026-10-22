import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountsIn,
  countriesInEntry,
  normalizeForMatch,
  quoteFound,
  resolveCountry,
  degreeStated,
  employmentTypeStated,
  equityFromText,
  seniorityFromTitle,
  subcategoryFromTitle,
  validateEnrichment,
} from './validate.js';
import { buildPostingText } from './prompt.js';
import { ENRICH_GROUPS } from './schema.js';
import { placeMentioned } from '../text/countries.js';

const POSTING = buildPostingText({
  title: 'Senior Backend Engineer (Go)',
  company: 'Acme',
  location: 'Remote - US',
  description: [
    'We’re hiring a Senior Backend Engineer. This is a fully remote role — open to candidates living in the United States.',
    'Pay range: $140,000 – $180,000 per year, plus equity.',
    'Requirements: 5+ years building APIs with Go, k8s and Postgres. Nice to have: React, golang tooling.',
    'Visa sponsorship is not available. Travel up to 10%.',
    'The final interview round is held in person at our Austin office.',
  ].join('\n'),
});

const NO_PAY = { min: null, max: null, currency: null, period: null, evidence: null };

// A valid answer for POSTING; `overrides` replaces fields inside a group, or drops the group when null.
function answer(overrides = {}) {
  const base = {
    category: { primary: 'backend', subcategory: 'api_services' },
    workplace: { type: 'remote', evidence: 'This is a fully remote role' },
    location: {
      locations: [],
      remoteEligibleCountries: ['US'],
      mustResideIn: 'United States',
      timezone: null,
      mustResideInEvidence: 'open to candidates living in the United States',
      remoteScope: 'region',
    },
    salary: { min: 140000, max: 180000, currency: 'usd', period: 'year', evidence: '$140,000 – $180,000 per year' },
    role: { seniority: 'senior', yearsExperienceMin: 5, yearsExperienceMax: null, employmentType: null },
    skills: { required: ['Go', 'k8s', 'Postgres', 'golang'], preferred: ['React', 'Go'] },
    conditions: {
      visaSponsorship: 'no',
      securityClearance: 'None',
      travelPercent: 10,
      relocationAssistance: 'unknown',
      degree: null,
      languages: ['English', 'english'],
      onsiteInterview: 'yes',
      onsiteInterviewEvidence: 'The final interview round is held in person',
    },
    company: { fundingStage: null, calledStartup: false, employeeCount: null, evidence: null },
    keywords: { tags: ['APIs'] },
  };
  for (const [group, fields] of Object.entries(overrides)) {
    if (fields === null) delete base[group];
    else base[group] = { ...base[group], ...fields };
  }
  return base;
}

const validate = (overrides) => validateEnrichment(answer(overrides), { posting: POSTING });
const codesFor = (result, group) => result.errors.filter((e) => e.group === group).map((e) => e.code);

test('a valid answer passes and is normalized: countries, currency, skills', () => {
  const result = validate();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failedGroups, []);
  assert.deepEqual(result.value.category, { primary: 'backend', subcategory: 'api_services', isSoftwareRole: true });
  assert.deepEqual(result.value.location.remoteEligibleCountries, ['United States']);
  assert.equal(result.value.salary.currency, 'USD');
  assert.deepEqual(result.value.skills, { required: ['Go', 'Kubernetes', 'PostgreSQL'], preferred: ['React'] });
  assert.equal(result.value.conditions.securityClearance, null); // "None" means none required
  assert.deepEqual(result.value.conditions.languages, ['English']);
  assert.equal(result.value.conditions.onsiteInterview, 'yes');
  assert.equal(result.value.conditions.equityOffered, 'yes');
});

test('a group the request left out states nothing, whatever the answer holds', () => {
  const unasked = (overrides) => validateEnrichment(answer(overrides), { posting: POSTING, unasked: ['salary'] });
  const left = unasked({ salary: null });
  assert.equal(left.ok, true);
  assert.deepEqual([left.value.salary.min, left.value.salary.max], [null, null]);
  // An answer written to the full format has its salary ignored, even one that would fail.
  const full = unasked({ salary: { min: 1 } });
  assert.equal(full.ok, true);
  assert.equal(full.value.salary.min, null);
});

test('keywords: only tags the posting contains are kept, folded, without the employer, filler or repeats', () => {
  const result = validate({
    keywords: {
      tags: [
        'Senior', // filler: true of every job
        'Acme', // the employer
        'fintech', // not in the posting
        'Remote', // filler
        'K8s', // a technology this posting already lists as a skill
        'apis',
        'APIs', // a repeat once folded
        'building APIs with Go', // too long
        'Visa sponsorship', // in the posting
        '',
      ],
    },
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.value.keywords, { tags: ['api', 'visa sponsorship'] });
});

test('keywords: the city the job is in is dropped, a word that only looks like one is kept', () => {
  const posting = buildPostingText({
    title: 'VistA Developer',
    company: 'Acme',
    location: 'Austin, United States',
    description: 'Maintain the VistA health record for the VA in Austin. Requirements: MUMPS.',
  });
  const result = validateEnrichment(answer({ keywords: { tags: ['VistA', 'Austin', 'VA'] } }), { posting });
  assert.deepEqual(result.value.keywords.tags, ['vista', 'va']);
});

test('keywords: an empty list is a valid answer, and the list is capped', () => {
  assert.deepEqual(validate({ keywords: { tags: [] } }).value.keywords, { tags: [] });
  const words = Array.from({ length: 20 }, (_, i) => `domain${i}`);
  const posting = buildPostingText({ title: 'T', company: 'C', location: '', description: words.join(' ') });
  const result = validateEnrichment(answer({ keywords: { tags: words } }), { posting });
  assert.equal(result.value.keywords.tags.length, 15);
});

test('placeholders a model writes instead of null ("", 0, "unknown", "Not specified") mean not stated', () => {
  const result = validate({
    location: {
      locations: [{ city: '', region: 'N/A', country: 'unknown' }],
      remoteEligibleCountries: ['unknown'],
      mustResideIn: 'unknown',
      timezone: '',
      mustResideInEvidence: '',
    },
    salary: { min: 0, max: 0, currency: '', period: null, evidence: 'Not specified' },
    conditions: { securityClearance: '', travelPercent: 0, languages: ['none'] },
    workplace: { type: 'hybrid', evidence: 'This is a fully remote role' },
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.value.location, {
    locations: [],
    remoteEligibleCountries: [],
    mustResideIn: null,
    timezone: null,
    mustResideInEvidence: null,
    remoteScope: null,
  });
  assert.deepEqual(result.value.salary, NO_PAY);
  assert.equal(result.value.conditions.travelPercent, null);
  assert.deepEqual(result.value.conditions.languages, []);
});

test('a quote that backs a value must be in the posting, or its group fails', () => {
  const result = validate({ workplace: { evidence: 'Remote-first company with an async culture' } });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failedGroups, ['workplace']);
  assert.equal(result.value.workplace, undefined);
  assert.ok(result.value.salary);
  assert.match(result.errors[0].message, /^workplace\.evidence ".+" is not an exact quote from the posting$/);

  // Punctuation, curly quotes, dashes and a copied label don't matter; passages may be joined with "...".
  assert.equal(validate({ workplace: { evidence: "We're hiring ... a fully remote role - open to" } }).ok, true);
  assert.equal(validate({ workplace: { evidence: 'DESCRIPTION: This is a fully remote role' } }).ok, true);
});

test('an optional quote that is not in the posting is dropped, not failed', () => {
  const result = validate({ location: { mustResideIn: null, mustResideInEvidence: 'Candidates anywhere' } });
  assert.equal(result.ok, true);
  assert.equal(result.value.location.mustResideInEvidence, null);
});

test('quotes match whole words only', () => {
  const posting = normalizeForMatch(POSTING);
  assert.equal(quoteFound('Acme', posting), true);
  assert.equal(quoteFound('Acm', posting), false);
  assert.equal(quoteFound('   ', posting), false);
});

test('salary: amounts must appear in the quote, with a real currency, a period and a plausible size', () => {
  assert.deepEqual(codesFor(validate({ salary: { min: 150000 } }), 'salary'), ['amount_not_in_quote']);
  assert.deepEqual(codesFor(validate({ salary: { currency: null, period: null } }), 'salary'), ['currency', 'period_missing']);
  assert.deepEqual(codesFor(validate({ salary: { min: 180000, max: 140000 } }), 'salary'), ['min_above_max']);
  assert.deepEqual(codesFor(validate({ salary: { evidence: 'Salary: competitive' } }), 'salary'), ['evidence_not_found']);

  // An hourly rate labelled yearly.
  const contract = buildPostingText({ title: 'Contract Developer', description: 'Rate: $65/hour for a 6-month contract.' });
  const hourly = validateEnrichment(
    answer({ salary: { min: 65, max: 65, currency: 'USD', period: 'year', evidence: '$65/hour' } }),
    { posting: contract }
  );
  assert.deepEqual(codesFor(hourly, 'salary'), ['out_of_range']);
});

test('salary: "from" and "up to" keep the open end null', () => {
  const posting = buildPostingText({ title: 'Engineer', description: 'Base pay from $120,000 per year. Bonus up to $150,000.' });
  const from = validateEnrichment(
    answer({ salary: { min: 120000, max: null, currency: 'USD', period: 'year', evidence: 'Base pay from $120,000 per year' } }),
    { posting }
  );
  assert.deepEqual(codesFor(from, 'salary'), []);
  assert.deepEqual(from.value.salary, { min: 120000, max: null, currency: 'USD', period: 'year', evidence: 'Base pay from $120,000 per year' });

  const upTo = validate({ salary: { min: null, max: 180000, evidence: '$180,000 per year' } });
  assert.deepEqual([upTo.value.salary.min, upTo.value.salary.max], [null, 180000]);
});

test('salary: the same round figure at both ends is a placeholder, not pay; one that is not round is a stated figure', () => {
  const posting = buildPostingText({ title: 'Engineer', description: 'Salary: ₹1,000,000 – ₹1,000,000 per year. Fixed pay of $87,500 per year.' });
  const placeholder = validateEnrichment(
    answer({ salary: { min: 1000000, max: 1000000, currency: 'INR', period: 'year', evidence: '₹1,000,000 – ₹1,000,000 per year' } }),
    { posting }
  );
  assert.deepEqual(codesFor(placeholder, 'salary'), []);
  assert.deepEqual(placeholder.value.salary, NO_PAY);
  const fixed = validateEnrichment(
    answer({ salary: { min: 87500, max: 87500, currency: 'USD', period: 'year', evidence: '$87,500 per year' } }),
    { posting }
  );
  assert.deepEqual(codesFor(fixed, 'salary'), []);
  assert.deepEqual([fixed.value.salary.min, fixed.value.salary.max], [87500, 87500]);
});

test('amountsIn reads thousands separators, decimals and units written once for a range', () => {
  assert.deepEqual(amountsIn('$120-150k').sort((a, b) => a - b), [120, 150, 120000, 150000]);
  assert.ok(amountsIn('€65.000 - €80.000 brutto').includes(80000));
  assert.ok(amountsIn('45 000 – 60 000 € par an').includes(60000));
  assert.ok(amountsIn('$95.50 per hour').includes(95.5));
  assert.ok(amountsIn('₹12 LPA').includes(1200000));
  assert.ok(amountsIn('CHF 1.2M').includes(1200000));
});

test('workplace: remote and hybrid need a quote; unknown needs none', () => {
  assert.deepEqual(codesFor(validate({ workplace: { evidence: null } }), 'workplace'), ['evidence_missing']);
  assert.deepEqual(codesFor(validate({ workplace: { type: 'hybrid', evidence: null } }), 'workplace'), ['evidence_missing']);
  // On-site with no quote is a plain location read as on-site: unknown, not a failure.
  const onsite = validate({ workplace: { type: 'onsite', evidence: null } });
  assert.deepEqual(codesFor(onsite, 'workplace'), []);
  assert.deepEqual(onsite.value.workplace, { type: 'unknown', evidence: null });
  // Remote or hybrid with no quote, from a posting with no such words, is unknown too: a retry
  // could not quote what the posting does not say.
  const silent = buildPostingText({ title: 'Backend Engineer', location: 'Austin, TX', description: 'Build Go services at our Austin office.' });
  for (const type of ['remote', 'hybrid']) {
    const read = validateEnrichment(answer({ workplace: { type, evidence: null } }), { posting: silent });
    assert.deepEqual(read.errors.filter((e) => e.group === 'workplace'), []);
    assert.deepEqual(read.value.workplace, { type: 'unknown', evidence: null });
  }

  const unknown = validate({ workplace: { type: 'unknown', evidence: null } });
  assert.equal(unknown.ok, true);
  assert.deepEqual(unknown.value.workplace, { type: 'unknown', evidence: null });
});

test('workplace: a quote with no arrangement words (a city, "based in") makes the type unknown', () => {
  const cityOnly = validate({ workplace: { type: 'onsite', evidence: 'open to candidates living in the United States' } });
  assert.equal(cityOnly.ok, true);
  assert.deepEqual(cityOnly.value.workplace, { type: 'unknown', evidence: null });

  const office = buildPostingText({ title: 'Engineer', description: 'Hybrid: 3 days a week in our Austin office.' });
  const hybrid = validateEnrichment(
    answer({
      workplace: { type: 'hybrid', evidence: '3 days a week in our Austin office' },
      conditions: { onsiteInterview: 'unknown', onsiteInterviewEvidence: null },
    }),
    { posting: office }
  );
  assert.deepEqual(hybrid.value.workplace, { type: 'hybrid', evidence: '3 days a week in our Austin office' });
});

test('onsite interview: yes and no need a quote about the interview; unknown drops any quote', () => {
  const noQuote = validate({ conditions: { onsiteInterviewEvidence: null } });
  assert.deepEqual(codesFor(noQuote, 'conditions'), ['evidence_missing']);

  const invented = validate({ conditions: { onsiteInterviewEvidence: 'All interviews are in person' } });
  assert.deepEqual(codesFor(invented, 'conditions'), ['evidence_not_found']);

  const officeOnly = validate({ conditions: { onsiteInterviewEvidence: 'at our Austin office' } });
  assert.equal(officeOnly.ok, true);
  assert.equal(officeOnly.value.conditions.onsiteInterview, 'unknown');
  assert.equal(officeOnly.value.conditions.onsiteInterviewEvidence, null);

  const unknown = validate({ conditions: { onsiteInterview: 'unknown' } });
  assert.equal(unknown.ok, true);
  assert.equal(unknown.value.conditions.onsiteInterviewEvidence, null);
});

test('onsite interview: a tentative "may" is not a requirement; "no" needs the whole process to be virtual', () => {
  const posting = buildPostingText({
    title: 'Senior Backend Engineer',
    description:
      'This is a fully remote role. Candidates may be asked to attend an in-person interview. ' +
      'Please keep cameras on during video interviews. All interviews are conducted via Zoom.',
  });
  const interview = (onsiteInterview, onsiteInterviewEvidence) =>
    validateEnrichment(
      answer({
        workplace: { evidence: 'This is a fully remote role' },
        location: { remoteEligibleCountries: [], mustResideIn: null, mustResideInEvidence: null },
        salary: NO_PAY,
        conditions: { onsiteInterview, onsiteInterviewEvidence },
      }),
      { posting }
    ).value.conditions.onsiteInterview;
  assert.equal(interview('yes', 'Candidates may be asked to attend an in-person interview'), 'unknown'); // seen live
  assert.equal(interview('no', 'Please keep cameras on during video interviews'), 'unknown'); // seen live
  assert.equal(interview('no', 'All interviews are conducted via Zoom'), 'no');
});

test('subcategory: kept when it belongs to the primary category or to any category, otherwise dropped', () => {
  const category = (primary, subcategory) => validate({ category: { primary, subcategory } }).value.category;
  assert.equal(category('backend', 'api_services').subcategory, 'api_services');
  assert.equal(category('backend', 'ios').subcategory, null);
  assert.equal(category('software', 'enterprise_platforms').subcategory, 'enterprise_platforms');
  assert.equal(category('ml_ai', 'forward_deployed').subcategory, 'forward_deployed');
  assert.deepEqual(category('other', 'forward_deployed'), { primary: 'other', subcategory: null, isSoftwareRole: false });

  const invented = validate({ category: { subcategory: 'web3' } });
  assert.deepEqual(invented.failedGroups, ['category']);
  assert.equal(invented.errors[0].code, 'schema');
});

test('location: regions with descriptions are read; unknown places and places the posting never names are dropped', () => {
  const posting = buildPostingText({
    title: 'Senior Backend Engineer',
    location: 'Remote',
    description: 'This is a fully remote role open to North America, Australia, New Zealand and EMEA. Our global network spans the world.',
  });
  const regions = validateEnrichment(
    answer({
      workplace: { evidence: 'This is a fully remote role' },
      location: {
        remoteEligibleCountries: ['North America (the U.S. and Canada)', 'Oceania (Australia, New Zealand)', 'Bay Area', 'EMEA', 'Worldwide', 'Germany'],
        mustResideIn: null,
        mustResideInEvidence: null,
      },
    }),
    { posting }
  );
  assert.deepEqual(regions.errors.filter((e) => e.group === 'location'), []);
  assert.deepEqual(regions.value.location.remoteEligibleCountries, ['North America', 'Australia', 'New Zealand', 'EMEA']);

  assert.deepEqual(codesFor(validate({ location: { mustResideInEvidence: null } }), 'location'), ['evidence_missing']);

  const onsite = validate({ workplace: { type: 'onsite' } }); // quote "fully remote role" has arrangement words
  assert.deepEqual(onsite.failedGroups, ['location']);
  assert.deepEqual(codesFor(onsite, 'location'), ['onsite_remote_countries']);
});

test('remote-from places must be named in the posting; "Worldwide" needs explicit wording', () => {
  assert.equal(placeMentioned('United States', 'Remote - USA'), true);
  assert.equal(placeMentioned('Latin America', 'Ubicación: LATAM'), true);
  assert.equal(placeMentioned('Luxembourg', 'Based in Luxembourg'), true);
  assert.equal(placeMentioned('Germany', 'Remote - USA'), false);
  assert.equal(placeMentioned('Worldwide', 'LOCATION: Worldwide'), true);
  assert.equal(placeMentioned('Worldwide', 'You can work from anywhere.'), true);
  assert.equal(placeMentioned('Worldwide', 'traffic routed through its intelligent global network'), false); // seen live
  assert.equal(placeMentioned('Worldwide', 'work together in real time from anywhere in the world'), false); // seen live
});

test('countriesInEntry and resolveCountry map codes, aliases, regions and any ISO country name', () => {
  assert.equal(resolveCountry('US'), 'United States');
  assert.equal(resolveCountry('de'), 'Germany');
  assert.equal(resolveCountry('EMEA'), 'EMEA');
  assert.equal(resolveCountry('Czechia'), 'Czech Republic');
  assert.equal(resolveCountry('Luxembourg'), 'Luxembourg'); // not in the app's table, still a country
  assert.equal(resolveCountry('Bay Area'), '');
  assert.deepEqual(countriesInEntry('United States/Canada/United Kingdom'), ['United States', 'Canada', 'United Kingdom']);
  assert.deepEqual(countriesInEntry('Asia (selected countries)'), ['Asia']);
  assert.deepEqual(countriesInEntry('Remote'), []);
});

test('role and conditions ranges', () => {
  const result = validate({ role: { yearsExperienceMin: 45 }, conditions: { travelPercent: 150 } });
  assert.deepEqual(result.failedGroups, ['role', 'conditions']);
  assert.deepEqual(validate({ role: { yearsExperienceMax: 50 } }).failedGroups, ['role']);
});

test('yearsExperienceMax is the top of a range: kept above the minimum, dropped at or below it', () => {
  const most = (role) => validate({ role }).value.role.yearsExperienceMax;
  assert.equal(most({ yearsExperienceMin: 3, yearsExperienceMax: 5 }), 5);
  assert.equal(most({ yearsExperienceMin: 5, yearsExperienceMax: 5 }), null); // "5 years" is no range
  assert.equal(most({ yearsExperienceMin: 5, yearsExperienceMax: 3 }), null);
  assert.equal(most({ yearsExperienceMin: null, yearsExperienceMax: 2 }), 2); // "up to 2 years"
  assert.equal(most({ yearsExperienceMax: 0 }), null);
});

test('an answer written before remoteScope and yearsExperienceMax were asked for reads them as not stated', () => {
  const older = answer();
  delete older.role.yearsExperienceMax;
  delete older.location.remoteScope;
  const result = validateEnrichment(older, { posting: POSTING });
  assert.deepEqual(result.errors, []);
  assert.equal(result.value.role.yearsExperienceMax, null);
  // The reading limits this remote job to the United States: a region, though the answer never said.
  assert.equal(result.value.location.remoteScope, 'region');
});

test('remoteScope: "global" needs the posting to say anywhere, and a job limited to places is a region', () => {
  const noLimits = { remoteEligibleCountries: [], mustResideIn: null, mustResideInEvidence: null, timezone: null };
  const scope = (location, posting = POSTING, workplace = {}) =>
    validateEnrichment(answer({ location: { ...noLimits, ...location }, workplace }), { posting }).value.location.remoteScope;
  const anywhere = buildPostingText({
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'Remote',
    description: 'This is a fully remote role. Work from anywhere in the world.',
  });
  assert.equal(scope({ remoteScope: 'global' }, anywhere), 'global');
  // POSTING only says "fully remote": a worldwide the posting never states is dropped.
  assert.equal(scope({ remoteScope: 'global' }), null);
  // "Anywhere in the United States" is not anywhere.
  const anywhereInUs = buildPostingText({
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'Remote',
    description: 'This is a fully remote role. Work from anywhere in the United States.',
  });
  assert.equal(scope({ remoteScope: 'global', remoteEligibleCountries: ['US'] }, anywhereInUs), 'region');
  assert.equal(scope({ remoteScope: null, timezone: 'CET +/- 2 hours' }, anywhere), 'region');
  assert.equal(scope({ remoteScope: 'region' }), 'region');
  assert.equal(scope({ remoteScope: null }), null);
  // An onsite or hybrid job has no remote scope.
  assert.equal(scope({ remoteScope: 'global' }, anywhere, { type: 'hybrid' }), null);
});

test('seniority falls back to what the title states when the model leaves it out', () => {
  assert.equal(validate({ role: { seniority: null } }).value.role.seniority, 'senior'); // "Senior Backend Engineer (Go)"
  assert.equal(validate({ role: { seniority: 'lead' } }).value.role.seniority, 'lead'); // the model's value is kept

  // The one table ingest reads with (seniority.js): a lead outranks a senior, a numeral is a level.
  assert.equal(seniorityFromTitle('Sr. Cybersecurity Engineer'), 'senior');
  assert.equal(seniorityFromTitle('Staff Machine Learning Engineer, Personalization'), 'staff');
  assert.equal(seniorityFromTitle('Senior Frontend Lead Developer (React)'), 'lead');
  assert.equal(seniorityFromTitle('Software Engineer Intern (Summer 2027)'), 'intern');
  assert.equal(seniorityFromTitle('Mid-Level Java Developer'), 'mid');
  assert.equal(seniorityFromTitle('Member of Technical Staff Engineering'), null);
  assert.equal(seniorityFromTitle('Software Engineer III'), 'senior');
});

test('a skill the dictionary does not know must be in the posting, and a practice is not a skill', () => {
  const result = validate({
    skills: {
      required: ['Go', 'docs', 'tests', 'source freshness', 'Git (source control) Wildlife Jenkins', 'communication', 'Austin office'],
      preferred: ['React', 'teamwork', 'golang tooling'],
    },
  });
  assert.deepEqual(result.errors.filter((e) => e.group === 'skills'), []);
  // "Austin office" and "golang tooling" are in the posting's words; the dictionary knows neither,
  // so they stay as the posting names them, where the run-on and the practices go.
  assert.deepEqual(result.value.skills, { required: ['Go', 'Austin office'], preferred: ['React', 'golang tooling'] });
});

test('a long posting answered with no skills at all is retried; a short one may have none', () => {
  const long = buildPostingText({
    title: 'Senior Backend Engineer',
    description: 'This is a fully remote role. We use Kubernetes. ' + 'We build reliable services for our customers. '.repeat(40),
  });
  const empty = validateEnrichment(answer({ skills: { required: [], preferred: [] } }), { posting: long });
  assert.deepEqual(empty.errors.filter((e) => e.group === 'skills').map((e) => e.code), ['skills_missing']);
  assert.deepEqual(codesFor(validate({ skills: { required: [], preferred: [] } }), 'skills'), []);
});

test('a long posting that names no skill the dictionary knows may have none', () => {
  const patrol = buildPostingText({
    title: 'Security Officer Mobile Patrol Driver',
    description: 'This is a fully remote role. ' + 'Patrol client sites and write clear incident reports each shift. '.repeat(30),
  });
  const empty = validateEnrichment(answer({ skills: { required: [], preferred: [] } }), { posting: patrol });
  assert.deepEqual(empty.errors.filter((e) => e.group === 'skills'), []);
});

test('a non-object answer fails every group; a malformed group fails only itself', () => {
  const notJson = validateEnrichment(null, { posting: POSTING });
  assert.equal(notJson.ok, false);
  assert.equal(notJson.failedGroups.length, ENRICH_GROUPS.length);
  assert.deepEqual(notJson.errors.map((e) => e.code), ['invalid_json']);

  const missingGroup = validate({ role: null });
  assert.deepEqual(missingGroup.failedGroups, ['role']);
  assert.match(missingGroup.errors[0].message, /^role: /);

  const badEnum = validate({ workplace: { type: 'flexible' } });
  assert.deepEqual(badEnum.failedGroups, ['workplace']);
  assert.equal(badEnum.errors[0].code, 'schema');
});

test('words glued where HTML blocks were joined still match a quote ("USDAbout Us", seen live)', () => {
  const posting = buildPostingText({
    title: 'Engineer',
    description: 'Base Salary Range$157,000—$184,000 USDAbout Us\nWe build things remotely.',
  });
  const result = validateEnrichment(
    answer({
      workplace: { evidence: 'We build things remotely' },
      location: { remoteEligibleCountries: [], mustResideIn: null, mustResideInEvidence: null },
      salary: { min: 157000, max: 184000, currency: 'USD', period: 'year', evidence: 'Base Salary Range$157,000—$184,000 USD' },
      conditions: { onsiteInterview: 'unknown', onsiteInterviewEvidence: null },
    }),
    { posting }
  );
  assert.deepEqual(result.errors, []);
});

test('equity is read from the posting: compensation wording counts, other meanings of "equity" do not', () => {
  const offered = [
    'Our Approach to Equity: Receive stock options upon hire and promotion.', // seen live
    'The base range is $227,495.00 - $324,993 USD, plus equity.', // seen live
    'Compensation including salary, benefits, and meaningful early-stage equity.', // seen live
    "This role is eligible to participate in Cloudflare's equity plan.", // seen live
    'Benefits: • paid sick leave • equity', // seen live
  ];
  for (const text of offered) assert.equal(equityFromText(text), 'yes', text);

  const otherMeanings = [
    'Pay is based on skills, abilities of the applicant, equity with other team members, alignment with market data.', // seen live
    'Experience in a private equity-backed or multi-entity portfolio company environment.', // seen live
    'We are committed to diversity, equity, and inclusion.',
    'We value inclusion and equity in hiring.',
  ];
  for (const text of otherMeanings) assert.equal(equityFromText(text), 'unknown', text);

  assert.equal(equityFromText('This is a cash-only role with no equity.'), 'no');
});

test('a cross-category subcategory the title names wins over the model', () => {
  assert.equal(subcategoryFromTitle('Software Engineer, Forward Deployed'), 'forward_deployed');
  assert.equal(subcategoryFromTitle('Senior ABAP Developer'), 'enterprise_platforms');
  assert.equal(subcategoryFromTitle('UiPath IXP Lead developer (remote)'), 'enterprise_platforms');
  assert.equal(subcategoryFromTitle('Senior Backend Engineer'), null);

  const posting = buildPostingText({ title: 'Senior ABAP Developer', description: 'Build SAP integrations.' });
  const result = validateEnrichment(answer({ category: { primary: 'backend', subcategory: 'api_services' } }), { posting });
  assert.equal(result.value.category.subcategory, 'enterprise_platforms');
});

test('a clearance without a level is shown as required with the level not stated', () => {
  const clearance = (value) => validate({ conditions: { securityClearance: value } }).value.conditions.securityClearance;
  assert.equal(clearance('required'), 'Clearance required (level not stated)'); // seen live
  assert.equal(clearance('TS/SCI'), 'TS/SCI');
  assert.equal(clearance('None'), null);
});

test('employment type and degree are kept only when the posting has words for them', () => {
  const posting = buildPostingText({ title: 'Engineer', description: 'This is a fully remote role building APIs.' });
  const result = validateEnrichment(
    answer({
      workplace: { evidence: 'This is a fully remote role' },
      location: { remoteEligibleCountries: [], mustResideIn: null, mustResideInEvidence: null },
      salary: NO_PAY,
      role: { employmentType: 'full-time' },
      conditions: { degree: 'none', onsiteInterview: 'unknown', onsiteInterviewEvidence: null },
    }),
    { posting }
  );
  assert.equal(result.value.role.employmentType, null); // seen live: nano answered full-time
  assert.equal(result.value.conditions.degree, null); // seen live: nano answered none

  assert.equal(employmentTypeStated('full-time', 'Full-time, remote'), 'full-time');
  assert.equal(employmentTypeStated('contract', 'A 6-month contract role'), 'contract');
  assert.equal(employmentTypeStated('internship', 'Our internal tools team'), null);
  assert.equal(employmentTypeStated('full-time', 'US citizen or permanent resident'), null);
  assert.equal(degreeStated('none', "Bachelor's degree or equivalent experience"), 'none');
  assert.equal(degreeStated('bachelor', 'BS in Computer Science'), 'bachelor');
  assert.equal(degreeStated('none', 'We build jobs software for teams'), null);
});

test('skills filed only as preferred are treated as required', () => {
  const result = validate({ skills: { required: [], preferred: ['Go', 'Kubernetes'] } });
  assert.deepEqual(result.value.skills, { required: ['Go', 'Kubernetes'], preferred: [] });
});

test('control characters a model emits for text it cannot copy are removed', () => {
  const result = validate({ location: { mustResideIn: String.fromCharCode(0), mustResideInEvidence: null } });
  assert.equal(result.ok, true);
  assert.equal(result.value.location.mustResideIn, null);
});

test('what the posting says of the hiring company is kept only where its quote says it', () => {
  const posting = buildPostingText({
    title: 'Founding Engineer',
    company: 'Tiny',
    location: 'Remote',
    description: [
      'We are an early-stage startup of 12 people, backed by Sequoia and Y Combinator.',
      'We raised our $8M Series A in March.',
      'Bonus: experience at a Series B startup.',
    ].join('\n'),
  });
  const read = (company) => validateEnrichment(answer({ company }), { posting });
  const none = { fundingStage: null, calledStartup: false, employeeCount: null, evidence: null };

  const evidence = 'We are an early-stage startup of 12 people...We raised our $8M Series A';
  assert.deepEqual(read({ fundingStage: 'series_a', calledStartup: true, employeeCount: 12, evidence }).value.company, {
    fundingStage: 'series_a',
    calledStartup: true,
    employeeCount: 12,
    evidence,
  });
  const backed = read({ fundingStage: 'venture_backed', calledStartup: false, employeeCount: null, evidence: 'backed by Sequoia and Y Combinator' });
  assert.equal(backed.value.company.fundingStage, 'venture_backed');

  // Never retried: an invented quote, a stage the quote does not name, or a headcount it does not
  // state is dropped rather than failing the answer.
  const invented = read({ fundingStage: 'seed', calledStartup: false, employeeCount: null, evidence: 'We closed a seed round' });
  assert.deepEqual([invented.failedGroups.includes('company'), invented.value.company], [false, none]);
  assert.deepEqual(read({ fundingStage: 'series_b', calledStartup: false, employeeCount: null, evidence: 'We raised our $8M Series A' }).value.company, none);
  const headcount = read({ fundingStage: null, calledStartup: true, employeeCount: 40, evidence: 'We are an early-stage startup of 12 people' });
  assert.deepEqual([headcount.value.company.calledStartup, headcount.value.company.employeeCount], [true, null]);
  // What is asked of the candidate is not the company's stage.
  assert.deepEqual(read({ fundingStage: 'series_b', calledStartup: true, employeeCount: null, evidence: 'experience at a Series B startup' }).value.company, none);
});

test('a reading without its quote is backed by the sentence of the posting that says it', () => {
  const posting = buildPostingText({
    title: 'Backend Engineer',
    company: 'SentiLink',
    location: 'Remote',
    description: "We serve 13 of the top 15 U.S. banks.\nWe're backed by Craft Ventures, Andreessen Horowitz and NYCA. You will build APIs.",
  });
  // Seen live: gpt-5-nano answers the stage and writes "null" for the quote.
  const read = (company) => validateEnrichment(answer({ company: { calledStartup: false, employeeCount: null, ...company } }), { posting }).value.company;
  assert.deepEqual(read({ fundingStage: 'venture_backed', evidence: 'null' }), {
    fundingStage: 'venture_backed',
    calledStartup: false,
    employeeCount: null,
    evidence: "We're backed by Craft Ventures, Andreessen Horowitz and NYCA.",
  });
  // Nothing in the posting says Series A; "15" is a count of banks, not of people.
  assert.equal(read({ fundingStage: 'series_a', evidence: null }).fundingStage, null);
  assert.equal(read({ fundingStage: null, employeeCount: 15, evidence: null }).employeeCount, null);
});

test('a company valued at a billion is late stage, whatever round it names', () => {
  const posting = buildPostingText({
    title: 'Backend Engineer',
    company: 'Scribe',
    location: 'San Francisco',
    description: "We've been named a LinkedIn Top Startup, are valued at over $1 billion, and are backed by leading investors.",
  });
  const company = { fundingStage: 'venture_backed', calledStartup: true, employeeCount: null, evidence: 'backed by leading investors' };
  const result = validateEnrichment(answer({ company }), { posting });
  assert.equal(result.value.company.fundingStage, 'later_stage');
  assert.equal(result.value.company.calledStartup, false);
});

test('venture-backed needs funding wording in its quote, not "investors" or "backed by" alone', () => {
  const posting = buildPostingText({
    title: 'Software Engineer',
    company: 'Big Bank',
    location: 'Charlotte',
    description: 'We are backed by the strength of our investors and funded by a century of growth.\nOur peer Acme is backed by Sequoia Capital and raised $40M last year.',
  });
  const read = (evidence) => validateEnrichment(answer({ company: { fundingStage: 'venture_backed', calledStartup: false, employeeCount: null, evidence } }), { posting }).value.company;
  // A bank's words about itself: the stage is dropped, the answer kept.
  assert.deepEqual(read('backed by the strength of our investors'), { fundingStage: null, calledStartup: false, employeeCount: null, evidence: null });
  assert.deepEqual(read('funded by a century of growth'), { fundingStage: null, calledStartup: false, employeeCount: null, evidence: null });
  // Funding wording in the quote keeps it.
  assert.equal(read('backed by Sequoia Capital').fundingStage, 'venture_backed');
  assert.equal(read('raised $40M last year').fundingStage, 'venture_backed');
  // Without a quote, the sentence of the posting that says it is found; the bank's sentence is not it.
  assert.equal(read(null).evidence, 'Our peer Acme is backed by Sequoia Capital and raised $40M last year.');
});

test("a recruiter's posting says nothing about the company it hires for", () => {
  const posting = buildPostingText({ title: 'Engineer', company: 'Agency', location: 'Remote', description: 'Our client is a Series A fintech startup.' });
  const company = { fundingStage: 'series_a', calledStartup: true, employeeCount: null, evidence: 'a Series A fintech startup' };
  const result = validateEnrichment(answer({ company }), { posting });
  assert.deepEqual(result.value.company, { fundingStage: null, calledStartup: false, employeeCount: null, evidence: null });
});
