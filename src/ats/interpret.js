import { hasKeyword, skillFit } from '../text/keywords.js';
import { structuredResumeToText } from '../resume/structuredResume.js';
import { breakdownFrom, combineBreakdown } from './breakdown.js';
import { checkedVerdicts, heldVerdicts, skillVerdicts } from './verdicts.js';

// What the code decides from the model's answer: the stored match fields.

/** The job's skills checked verbatim against the resume — the same skillFit the Jobs page shows. */
export function verifiedSkills(job, resumeText) {
  const required = skillFit(resumeText, job?.skills || []);
  const preferred = skillFit(resumeText, job?.preferredSkills || []);
  return {
    required: { listed: required.have.length + required.missing.length, foundCount: required.have.length, found: required.have, notFound: required.missing },
    preferred: { found: preferred.have, notFound: preferred.missing },
  };
}

/** A matched keyword the resume does not contain is a fabrication; keep only the verbatim ones. */
export function filterMatchedKeywords(keywords, resumeText) {
  // Providers can return valid JSON with a string or object where an array was requested.
  // Ignore that field so otherwise valid scoring evidence does not trigger a fallback call.
  return (Array.isArray(keywords) ? keywords : []).filter((k) => typeof k === 'string' && hasKeyword(resumeText, k));
}

/**
 * Turn a model answer into the stored match fields. The score is decided in code from the
 * verdicts: the skills' (checked in code alone) and the requirements' (the model's, checked).
 * `score` is null when nothing could be judged.
 */
export function interpretScoreAnswer(data, { job, resume, resumeText, requirements = [], supportedYears = null, prior = null }) {
  const requiredSkills = skillVerdicts(resume ?? resumeText, job?.skills || []);
  const requiredNames = new Set(requiredSkills.map((s) => s.skill.toLowerCase()));
  const preferredSkills = skillVerdicts(resume ?? resumeText, (job?.preferredSkills || []).filter((s) => !requiredNames.has(String(s).trim().toLowerCase())));
  // Everything the resume says except its Skills list: where a quote has to be for a met to stand.
  const evidence = resume && typeof resume === 'object' ? structuredResumeToText({ ...resume, skills: [], skillGroups: [] }) : null;
  const verdicts = heldVerdicts(checkedVerdicts(requirements, data, { resumeText, evidence, supportedYears }), prior, resumeText);
  const breakdown = breakdownFrom({ required: requiredSkills, preferred: preferredSkills, verdicts });

  const byPriority = (a, b) => (a.priority === b.priority ? 0 : a.priority === 'required' ? -1 : 1);
  const weakEvidence = [
    ...verdicts.filter((v) => v.verdict === 'weak').sort(byPriority).map((v) => v.text),
    ...requiredSkills.filter((s) => s.verdict === 'weak').map((s) => `${s.skill} (listed under skills, not shown in your experience)`),
  ].slice(0, 6);
  const missingRequirements = verdicts.filter((v) => v.verdict === 'missing' && v.priority === 'required').map((v) => v.text).slice(0, 6);

  return {
    score: combineBreakdown(breakdown),
    breakdown,
    matchedKeywords: filterMatchedKeywords(data?.matchedKeywords, resumeText),
    topMissingKeywords: Array.isArray(data?.topMissingKeywords) ? data.topMissingKeywords.filter((k) => typeof k === 'string') : [],
    weakEvidence,
    missingRequirements,
    tailoringOpportunities: Array.isArray(data?.tailoringOpportunities) ? data.tailoringOpportunities.filter((k) => typeof k === 'string') : [],
    requirements: verdicts,
    // The job's own skills, each met (shown in a line of work), weak (only listed) or missing:
    // what the tailoring's gap pass (tailor/gap.js) answers alongside the requirements. Not stored.
    requiredSkillVerdicts: requiredSkills,
    // The same for the job's nice-to-have skills: a gap only for the score-first mode. Not stored.
    preferredSkillVerdicts: preferredSkills,
  };
}
