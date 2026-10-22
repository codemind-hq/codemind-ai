import { unsupportedFacts } from '../checks/index.js';

// Claims no tailored line may make: a figure, tenure or credential the resume does not state,
// and the facts about the candidate that are never a line of work.

/** "10+ years", "8 yrs". */
export const TENURE_RE = /\b\d{1,2}\s*\+?\s*(?:years?|yrs?)\b/i;
/** The same said in words: "eight years", "more than ten years", "a decade". */
export const TENURE_WORDS_RE = /\b(?:(?:more than|over|nearly|almost|about)\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+years?\b|\ba decade\b/i;

// "completed an Azure certification", "graduate-level study in computer science": a credential
// the resume never lists, which checks/certifications.js catches only when it is named (CKA, AWS Certified).
const CREDENTIAL_RE = /\b(?:certif\w*|degree|diploma|graduate[- ]level|postgraduate|master'?s|bachelor'?s|ph\.?d|doctorate|licen[cs]ed|(?:professional|state|nursing|medical|practi[cs]ing|bar|cpa|pe) licen[cs]es?)\b/i;
// Engineering uses these words for things that are not credentials: TLS certificates, a 360-degree
// view, a library licensed under MIT. Blank those out before looking for a credential.
const NOT_A_CREDENTIAL_RE =
  /\b(?:(?:tls|ssl|x\.?509|mtls|client|server|root|ca|signed|self-signed|wildcard|ssh|signing)[- ]certificates?|certificates?[- ](?:rotation|renewal|expiry|expiration|authority|authorities|pinning|management|manager|chain|signing)|cert-manager|\d+[- ]degrees?|degrees? of|licen[cs]ed under)\b/gi;
export const claimsCredential = (text) => CREDENTIAL_RE.test(String(text || '').replace(NOT_A_CREDENTIAL_RE, ' '));

// A clearance, citizenship or work permit: a fact about the candidate no line may state, and a
// requirement no line meets ("Eligible to obtain a DoD Secret clearance" was written for one).
const CLEARANCE_RE =
  /\b(?:security clearance|clearance|clearances|citizenship|citizens? (?:of|status)|(?:u\.?s\.?|american|canadian|british|eu|uk) citizens?|(?:be|is|are) an? citizen|work (?:authori[sz]ation|permit)|authori[sz]ed to work|right to work|visa|(?:visa|work|employment|immigration|h-?1b) sponsorship|(?:no|without) sponsorship|(?:require|need|provide|offer)s? (?:\w+ )?sponsorship|green card|public trust|polygraph|eligib\w* to obtain|ts\/sci|top secret|secret clearance)\b/i;
// "Visa" the card network, not the work permit: "Visa and Mastercard payments", "Visa Direct".
const CARD_NETWORK_RE =
  /\b(?:(?:mastercard|amex|discover)(?:,|\s+and|\s*\/|\s*&)\s*visa|visa(?:\s+(?:and|or)|\s*\/|\s*&)?\s+(?:mastercard|amex|discover|cards?|payments?|debit|credit|direct|checkout|network|tokens?|api|acceptance))\b/gi;
export const claimsClearance = (text) => CLEARANCE_RE.test(String(text || '').replace(CARD_NETWORK_RE, ' '));

// A line that states a figure, a tenure or a certification the resume (and what the user told
// us) does not support is an invention (checks/facts.js). A percentage is its own kind of claim, so
// "40%" is not covered by a resume that says "40k installs"; "10k" is not "10M" either.
export const inventsFact = (text, sources) => unsupportedFacts(text, sources).length > 0;
