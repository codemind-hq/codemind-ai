// The shapes @codemind/ai takes and returns, as JSDoc typedefs: editors read them for hints and
// checks, and a caller can name them with `import('@codemind/ai/types.js').Job` style references.
// Nothing here runs.

/**
 * @typedef {object} TailoringCompletion
 * @property {'complete'|'partial'} status Whether optional stages completed without warnings; not a quality guarantee.
 * @property {{ stage: string, code: string, sections?: string[] }[]} warnings Safe diagnostics, without provider messages.
 * @property {number} gapPassesAttempted
 * @property {boolean} targetReached
 */

/**
 * @typedef {object} TailoringReview
 * @property {boolean} required Known unconfirmed job terms or estimated figures remain for user review.
 * @property {string[]} unconfirmedKeywords
 * @property {object[]} estimates Figures generated as estimates, not verified facts.
 */

/**
 * @typedef {object} ProviderSettings
 * @property {string} [apiKey] The provider's API key.
 * @property {string} [baseUrl] The provider's endpoint (Qwen's Model Studio, Ollama).
 * @property {object} [client] A ready chat.completions client to use instead (tests).
 */

/**
 * @typedef {{ openai?: ProviderSettings, dashscope?: ProviderSettings, ollama?: ProviderSettings }} Providers
 */

/**
 * @typedef {object} ModelPair A feature's model and its one fallback.
 * @property {string} model
 * @property {string} [effort] Reasoning effort for a reasoning model: none, minimal, low, medium, high.
 * @property {string} [fallbackModel]
 * @property {string} [fallbackEffort]
 */

/**
 * @typedef {object} Models The models in force, read on every call.
 * @property {string} defaultModel The model of a call that names none.
 * @property {ModelPair} ats Scoring and job requirements.
 * @property {ModelPair} enrich Job enrichment.
 * @property {ModelPair} parse Resume parsing.
 */

/**
 * @typedef {object} UsageEvent One model call's usage, as onUsage receives it.
 * @property {*} userId
 * @property {string} kind score, tailor, cover_letter, answer, job_enrich, job_requirements, resume_parse, interview, referral, other…
 * @property {string} model
 * @property {string} promptVersion
 * @property {number|null} attempt
 * @property {number} tokensIn
 * @property {number} tokensOut
 * @property {number} cachedIn
 * @property {number} costUsd
 * @property {boolean} batch
 * @property {boolean} flex
 * @property {number} latencyMs
 * @property {boolean} ok
 * @property {string} error
 * @property {string} period "YYYY-MM"
 * @property {*} ref
 * @property {string} requestId
 */

/**
 * @typedef {object} CodemindOptions
 * @property {Providers | (() => Providers)} [providers]
 * @property {Models | (() => Models)} [models]
 * @property {(event: UsageEvent) => unknown} [onUsage]
 * @property {{ debug: Function, info: Function, warn: Function, error: Function }} [logger]
 */

/**
 * @typedef {object} CallMeta Who and what a call is for, recorded on its usage event.
 * @property {*} [userId]
 * @property {*} [ref]
 * @property {string} [requestId]
 * @property {AbortSignal} [signal] Cancels model calls, retries and feature fallbacks.
 * @property {number} [deadlineAt] Absolute Unix timestamp in milliseconds, shared across all workflow calls.
 */

/**
 * @typedef {object} Experience
 * @property {string} company
 * @property {string} title
 * @property {string} period
 * @property {string[]} achievements
 */

/**
 * @typedef {object} ResumeForm The structured resume (resume/structuredResume.js).
 * @property {string} name
 * @property {string} [title]
 * @property {string} [email]
 * @property {string} [phone]
 * @property {string} [location]
 * @property {string} [summary]
 * @property {string[]} skills
 * @property {Experience[]} experience
 * @property {object[]} [education]
 * @property {object[]} [projects]
 * @property {object[]} [certifications]
 * @property {string[]} [languages]
 * @property {string[]} [achievements]
 * @property {{ title: string, content: string }[]} [otherSections]
 */

/**
 * @typedef {object} Requirement One thing a posting asks beyond named skills.
 * @property {string} text
 * @property {'experience'|'responsibility'|'education'} kind
 * @property {'required'|'preferred'} priority
 */

/**
 * @typedef {object} Job A posting as the AI code reads it.
 * @property {string} [title]
 * @property {string} [company]
 * @property {string} description
 * @property {string[]} [skills]
 * @property {string[]} [preferredSkills]
 * @property {Requirement[]} [requirements]
 * @property {string} [category]
 * @property {string} [subcategory]
 */

/**
 * @typedef {object} Scoring A resume judged against a job (ats/service.js quickScoreResume).
 * @property {number} score 0-100, worked out in code from the verdicts.
 * @property {object} breakdown The score by category.
 * @property {(Requirement & { verdict: 'met'|'weak'|'missing', quote: string })[]} requirements
 * @property {object[]} requiredSkillVerdicts The job's required skills, each with its verdict.
 * @property {object[]} preferredSkillVerdicts The job's nice-to-have skills, each with its verdict.
 * @property {string[]} matchedKeywords
 * @property {string[]} topMissingKeywords
 * @property {string[]} weakEvidence
 * @property {string[]} missingRequirements
 * @property {string[]} tailoringOpportunities
 * @property {string} model
 */

/**
 * @typedef {'ats'|'balanced'|'realistic'} TailorStyle How far tailoring leans to the score (tailor/style.js).
 */

export {};
