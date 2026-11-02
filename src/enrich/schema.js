import { z } from 'zod';

// What the model must return for one posting. JOB_ENRICHMENT_SCHEMA is sent to OpenAI as a
// strict JSON schema; groupSchemas mirror it for validate.js, which checks each top-level group
// on its own (a job that never gets a fully valid answer keeps the groups that passed). The
// allowed values below are read from the JSON schema, and schema.test.js keeps the two in step.

export const ENRICH_GROUPS = ['category', 'workplace', 'location', 'salary', 'role', 'skills', 'conditions', 'company', 'keywords', 'internship'];

// Without these two a job is not shown; the other groups are left blank when they fail.
export const REQUIRED_GROUPS = ['category', 'workplace'];

// What a group added since an answer was written stands for when the answer leaves it out: a batch
// submitted under the previous prompt is still collected and re-validated under this one, and must
// not fail (and be retried, at a cost) for a field it was never asked for. A field added to a group
// that was already asked for is defaulted in groupSchemas instead (`added` below).
export const GROUP_DEFAULTS = { keywords: { tags: [] }, internship: { graduationFrom: null, graduationTo: null, enrollmentRequired: 'unknown', durationWeeks: null, evidence: null } };

// Subcategories per primary category. Strict mode cannot tie them to the primary, so the schema
// allows any of them and validate.js drops one that belongs to another category.
export const SUBCATEGORIES = {
  mobile: ['ios', 'android', 'cross_platform'],
  frontend: ['web_ui', 'design_system'],
  backend: ['api_services', 'distributed_systems', 'databases_storage', 'integrations'],
  fullstack: ['product_fullstack'],
  devops: ['sre', 'platform', 'cloud_infrastructure', 'build_release'],
  data: ['data_pipelines', 'analytics_engineering', 'data_platform'],
  ml_ai: ['llm_applications', 'ml_modeling', 'ml_infrastructure', 'computer_vision', 'recommender_systems'],
  qa: ['test_automation', 'manual_qa', 'performance_testing'],
  security: ['application_security', 'cloud_security', 'security_operations', 'identity_access', 'offensive_security'],
  embedded: ['firmware', 'embedded_linux', 'robotics_autonomy'],
  // Roles found across categories.
  any: ['forward_deployed', 'enterprise_platforms', 'game_development', 'blockchain'],
};

const TRISTATE = ['yes', 'no', 'unknown'];

export const JOB_ENRICHMENT_SCHEMA = {
  type: 'object',
  properties: {
    category: {
      type: 'object',
      properties: {
        primary: {
          type: 'string',
          enum: ['mobile', 'frontend', 'backend', 'fullstack', 'devops', 'data', 'ml_ai', 'qa', 'security', 'embedded', 'software', 'other'],
        },
        subcategory: {
          type: ['string', 'null'],
          enum: [...Object.values(SUBCATEGORIES).flat(), null],
        },
      },
      required: ['primary', 'subcategory'],
      additionalProperties: false,
    },

    workplace: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['remote', 'hybrid', 'onsite', 'unknown'] },
        evidence: { type: ['string', 'null'] },
      },
      required: ['type', 'evidence'],
      additionalProperties: false,
    },

    location: {
      type: 'object',
      properties: {
        locations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              city: { type: ['string', 'null'] },
              region: { type: ['string', 'null'] },
              country: { type: ['string', 'null'] },
            },
            required: ['city', 'region', 'country'],
            additionalProperties: false,
          },
        },
        remoteEligibleCountries: { type: 'array', items: { type: 'string' } },
        mustResideIn: { type: ['string', 'null'] },
        timezone: { type: ['string', 'null'] },
        mustResideInEvidence: { type: ['string', 'null'] },
        // Where a remote job may be done from: anywhere in the world, or only within named places.
        remoteScope: { enum: ['global', 'region', null] },
      },
      required: ['locations', 'remoteEligibleCountries', 'mustResideIn', 'timezone', 'mustResideInEvidence', 'remoteScope'],
      additionalProperties: false,
    },

    salary: {
      type: 'object',
      properties: {
        min: { type: ['number', 'null'] },
        max: { type: ['number', 'null'] },
        currency: { type: ['string', 'null'] },
        period: { enum: ['year', 'month', 'week', 'day', 'hour', null] },
        evidence: { type: ['string', 'null'] },
      },
      required: ['min', 'max', 'currency', 'period', 'evidence'],
      additionalProperties: false,
    },

    role: {
      type: 'object',
      properties: {
        seniority: { enum: ['intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'lead', 'manager', null] },
        yearsExperienceMin: { type: ['integer', 'null'] },
        yearsExperienceMax: { type: ['integer', 'null'] },
        employmentType: { enum: ['full-time', 'part-time', 'contract', 'internship', 'temporary', null] },
      },
      required: ['seniority', 'yearsExperienceMin', 'yearsExperienceMax', 'employmentType'],
      additionalProperties: false,
    },

    skills: {
      type: 'object',
      properties: {
        required: { type: 'array', maxItems: 20, items: { type: 'string' } },
        preferred: { type: 'array', maxItems: 20, items: { type: 'string' } },
      },
      required: ['required', 'preferred'],
      additionalProperties: false,
    },

    conditions: {
      type: 'object',
      properties: {
        visaSponsorship: { type: 'string', enum: TRISTATE },
        securityClearance: { type: ['string', 'null'] },
        travelPercent: { type: ['integer', 'null'] },
        relocationAssistance: { type: 'string', enum: TRISTATE },
        degree: { enum: ['none', 'associate', 'bachelor', 'master', 'phd', null] },
        languages: { type: 'array', items: { type: 'string' } },
        onsiteInterview: { type: 'string', enum: TRISTATE },
        onsiteInterviewEvidence: { type: ['string', 'null'] },
      },
      required: [
        'visaSponsorship',
        'securityClearance',
        'travelPercent',
        'relocationAssistance',
        'degree',
        'languages',
        'onsiteInterview',
        'onsiteInterviewEvidence',
      ],
      additionalProperties: false,
    },

    // The hiring company as the posting describes it: whether it calls itself a startup, the funding
    // it has raised and its headcount. Read for the startup badge (startups.js).
    company: {
      type: 'object',
      properties: {
        fundingStage: {
          enum: ['pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'venture_backed', 'later_stage', 'public', 'bootstrapped', null],
        },
        calledStartup: { type: 'boolean' },
        employeeCount: { type: ['integer', 'null'] },
        evidence: { type: ['string', 'null'] },
      },
      required: ['fundingStage', 'calledStartup', 'employeeCount', 'evidence'],
      additionalProperties: false,
    },

    // Domain words copied from the posting (the industry, the problem area, the engineering context)
    // for keyword search; validate.js drops any the posting does not contain (jobs/keywords.js).
    keywords: {
      type: 'object',
      properties: { tags: { type: 'array', maxItems: 15, items: { type: 'string' } } },
      required: ['tags'],
      additionalProperties: false,
    },

    // Who an internship or new-grad posting is for, as it states it: asked only of those postings
    // (enrichJob.js unaskedGroups), so no other job pays for it. The minimum degree is conditions.degree.
    internship: {
      type: 'object',
      properties: {
        graduationFrom: { type: ['string', 'null'] },
        graduationTo: { type: ['string', 'null'] },
        enrollmentRequired: { type: 'string', enum: TRISTATE },
        durationWeeks: { type: ['integer', 'null'] },
        evidence: { type: ['string', 'null'] },
      },
      required: ['graduationFrom', 'graduationTo', 'enrollmentRequired', 'durationWeeks', 'evidence'],
      additionalProperties: false,
    },
  },
  required: ['category', 'workplace', 'location', 'salary', 'role', 'skills', 'conditions', 'company', 'keywords', 'internship'],
  additionalProperties: false,
};

/** The `response_format` sent to the model. */
export const ENRICHMENT_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: { name: 'job_enrichment', strict: true, schema: JOB_ENRICHMENT_SCHEMA },
};

// The format with some groups left out: a job whose salary is settled before the model reads it
// (enrich/apply.js salaryKept), or one that is no internship, is not charged for output it does not
// need. One format per set of left-out groups, built once.
const formats = new Map();
export function responseFormatWithout(unasked = []) {
  const key = [...unasked].sort().join(',');
  if (!key) return ENRICHMENT_RESPONSE_FORMAT;
  if (!formats.has(key)) {
    const properties = Object.fromEntries(Object.entries(JOB_ENRICHMENT_SCHEMA.properties).filter(([group]) => !unasked.includes(group)));
    formats.set(key, {
      type: 'json_schema',
      json_schema: { name: 'job_enrichment', strict: true, schema: { ...JOB_ENRICHMENT_SCHEMA, properties, required: JOB_ENRICHMENT_SCHEMA.required.filter((group) => !unasked.includes(group)) } },
    });
  }
  return formats.get(key);
}
export const ENRICHMENT_RESPONSE_FORMAT_WITHOUT_SALARY = responseFormatWithout(['salary']);

// What a group the model was not asked for stands for in its answer.
export const UNASKED_GROUPS = { salary: { min: null, max: null, currency: null, period: null, evidence: null }, internship: GROUP_DEFAULTS.internship };

const allowed = (group, field) => JOB_ENRICHMENT_SCHEMA.properties[group].properties[field].enum;
const nullableEnum = (values) => z.enum(values.filter((value) => value !== null)).nullable();
const text = () => z.string().nullable();
// A field added after answers were first collected: missing from an older answer means not stated.
const added = (schema) => schema.default(null);

export const groupSchemas = {
  category: z.object({
    primary: z.enum(allowed('category', 'primary')),
    subcategory: nullableEnum(allowed('category', 'subcategory')),
  }),
  workplace: z.object({
    type: z.enum(allowed('workplace', 'type')),
    evidence: text(),
  }),
  location: z.object({
    locations: z.array(z.object({ city: text(), region: text(), country: text() })),
    remoteEligibleCountries: z.array(z.string()),
    mustResideIn: text(),
    timezone: text(),
    mustResideInEvidence: text(),
    remoteScope: added(nullableEnum(allowed('location', 'remoteScope'))),
  }),
  salary: z.object({
    min: z.number().nullable(),
    max: z.number().nullable(),
    currency: text(),
    period: nullableEnum(allowed('salary', 'period')),
    evidence: text(),
  }),
  role: z.object({
    seniority: nullableEnum(allowed('role', 'seniority')),
    yearsExperienceMin: z.number().int().nullable(),
    yearsExperienceMax: added(z.number().int().nullable()),
    employmentType: nullableEnum(allowed('role', 'employmentType')),
  }),
  skills: z.object({
    required: z.array(z.string()),
    preferred: z.array(z.string()),
  }),
  conditions: z.object({
    visaSponsorship: z.enum(TRISTATE),
    securityClearance: text(),
    travelPercent: z.number().int().nullable(),
    relocationAssistance: z.enum(TRISTATE),
    degree: nullableEnum(allowed('conditions', 'degree')),
    languages: z.array(z.string()),
    onsiteInterview: z.enum(TRISTATE),
    onsiteInterviewEvidence: text(),
  }),
  company: z.object({
    fundingStage: nullableEnum(allowed('company', 'fundingStage')),
    calledStartup: z.boolean(),
    employeeCount: z.number().int().nullable(),
    evidence: text(),
  }),
  keywords: z.object({ tags: z.array(z.string()) }),
  internship: z.object({
    graduationFrom: text(),
    graduationTo: text(),
    enrollmentRequired: z.enum(TRISTATE),
    durationWeeks: z.number().int().nullable(),
    evidence: text(),
  }),
};

const emptyOf = (property) => {
  const types = [].concat(property.type ?? []);
  if (types.includes('null') || property.enum?.includes(null)) return null;
  if (types.includes('array')) return [];
  return undefined;
};

/**
 * An answer with the fields it left out filled in as empty: null, or [] for a list. Models held to
 * the schema (OpenAI) never leave one out; gpt-oss on Ollama, which only reads the schema in its
 * prompt, drops the fields it would answer with null or [] (gpt-oss:20b did in 155 of 160 answers
 * on a 60-job dry run). Only fields that can be empty are filled, and only in groups the answer has.
 */
export function fillOmitted(answer) {
  const filled = { ...answer };
  for (const [group, schema] of Object.entries(JOB_ENRICHMENT_SCHEMA.properties)) {
    const value = filled[group];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const complete = { ...value };
    for (const [field, property] of Object.entries(schema.properties)) {
      if (!(field in complete) && emptyOf(property) !== undefined) complete[field] = emptyOf(property);
    }
    filled[group] = complete;
  }
  return filled;
}
