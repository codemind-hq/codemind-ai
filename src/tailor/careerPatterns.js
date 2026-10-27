// What a resume's own work says, read by pattern: the activities, the systems and domains, and the
// technologies a role's bullets name. A job requirement is never evidence of prior work, so these
// read only the candidate's text (prompts/generate.js condensedCareerFacts).

export const CAREER_FACT_PATTERNS = [
  ['REST API development and integration', /\brest\s*apis?\b|\bapi contracts?\b|\bbackend apis?\b/i],
  ['Backend application development', /\bbackend (?:systems?|services?|applications?)\b/i],
  ['Database design and automation', /\bdatabase(?:[ -]driven| (?:workflows?|automations?|design|business logic))\b/i],
  ['Workflow automation', /\b(?:workflow|process) automations?\b|\b(?:workflow|process)\b.{0,35}\bautomat(?:e|ed|ion|ing)\b/i],
  ['Production incident troubleshooting', /\bproduction telemetry\b|\b(?:api failures?|incident response|crash(?:es| investigation))\b/i],
  ['Application performance analysis', /\b(?:performance profiling|profiling launch time|memory usage|latency|performance optimization)\b/i],
  ['Software testing', /\b(?:unit tests?|ui tests?|test coverage|automated testing|regression coverage)\b/i],
  ['CI/CD and software delivery', /\bci\s*\/\s*cd\b|\brelease automation\b|\bdeployment reliability\b/i],
  ['Release management', /\brelease workflows?\b|\brelease validation\b|\bapp store submission\b/i],
  ['Cross-team API coordination', /\bapi contracts?\b|\bcollaborated with backend\b|\bpartnered with backend\b/i],
  ['Production analytics and monitoring', /\b(?:production monitoring|analytics|crash monitoring|structured logging)\b/i],
  ['Fraud detection and statistical analysis', /\bfraud.scoring\b|\bhistorical data and statistical methods\b/i],
  ['Business application development', /\b(?:c# applications?|internal business users|tax.processing workflows?)\b/i],
  ['Identity and authentication integration', /\b(?:authentication services?|identity.scoring|caller.intelligence|caller id)\b/i],
  ['Native Apple application development', /\b(?:ios features?|swiftui|uikit|testflight|app store)\b/i],
  // These specialized signals are emitted ONLY if candidate work actually
  // names the platform AND the activity. A ServiceNow job ad cannot create them.
  ['ServiceNow workflow and script development', /\bservicenow\b.{0,100}\b(?:workflows?|business rules?|gliderecord|script includes?|flow designer)\b|\b(?:business rules?|gliderecord|script includes?|flow designer)\b.{0,100}\bservicenow\b/i],
  ['ServiceNow IT service management and administration', /\bservicenow\b.{0,100}\b(?:itsm|itbm|ham modules?|administration|upgrades?|cmdb)\b|\b(?:itsm|itbm|ham modules?|administration|upgrades?|cmdb)\b.{0,100}\bservicenow\b/i],
];
// Specific system/domain labels are reconstructed from evidence in the role,
// not from the target job. They add substance to fresh bullets without copying
// the candidate's old sentences or implying experience with a target platform.
export const CAREER_SYSTEM_PATTERNS = [
  ['Branded calling and caller identity', /\b(?:branded calling|caller id|call identity|caller.identity)\b/i],
  ['Telecom identity and reputation services', /\b(?:telecom|identity.scoring|reputation intelligence|caller.intelligence)\b/i],
  ['Account onboarding and notifications', /\b(?:onboarding|account flows?|notification flows?|push notifications)\b/i],
  ['API synchronization, retries and recovery', /\b(?:api synchronization|retry handling|state.recovery|failure recovery|caching, retry)\b/i],
  ['Backend authentication and API integrations', /\b(?:authentication services?|backend apis?|api contracts?)\b/i],
  ['Production telemetry and API failure analysis', /\b(?:production telemetry|structured logging|api failures?|crash.reporting)\b/i],
  ['Application releases and automated testing', /\b(?:ci\s*\/\s*cd|release workflows?|release automation|xcuitest|xctest)\b/i],
  ['Tax-processing business applications', /\b(?:tax.processing|tax returns?)\b/i],
  ['Database-backed business automation', /\b(?:database.driven business logic|database workflows?|database automations?)\b/i],
  ['Tax fraud scoring and anomaly detection', /\b(?:fraud.scoring|fraud detection|anomalous patterns)\b/i],
  ['Internal business applications', /\b(?:internal business users|internal tasks|c# applications)\b/i],
  ['ServiceNow workflow development', /\bservicenow\b.{0,100}\b(?:workflows?|business rules?|flow designer|script includes)\b/i],
  ['ServiceNow ITSM or HAM administration', /\bservicenow\b.{0,100}\b(?:itsm|ham modules?|administration|it business management)\b/i],
];
export const CAREER_TECH_PATTERNS = [
  ['REST APIs', /\brest\s*apis?\b/i], ['JSON', /\bjson\b/i],
  ['JavaScript', /\bjavascript\b/i], ['C#', /\bc#(?=\W|$)/i],
  ['.NET', /(?<!\w)\.net\b/i], ['Microsoft SQL Server', /\b(?:microsoft\s+)?sql server\b/i],
  ['SQL', /\bsql\b/i], ['CI/CD', /\bci\s*\/\s*cd\b/i],
  ['XCTest', /\bxctest\b/i], ['XCUITest', /\bxcuittest\b/i],
  ['Swift', /\bswift\b/i], ['SwiftUI', /\bswiftui\b/i],
  ['UIKit', /\buikit\b/i], ['Combine', /\bcombine\b/i],
  ['ServiceNow', /\bservicenow\b/i], ['ITSM', /\bitsm\b/i],
  ['IT Business Management', /\bit business management\b/i],
  ['XML', /\bxml\b/i], ['AWS', /\baws\b|\bamazon web services\b/i],
];
