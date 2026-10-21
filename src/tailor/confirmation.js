import { hasKeyword } from '../text/keywords.js';
import { cleanStructuredResume } from '../resume/structuredResume.js';

/** Conservative final guard for known job keywords that the candidate has not confirmed.
 * Restore the source section if the model introduced a blocked term, including in repairs.
 * This policy checks named terms, not the semantic truth of arbitrary generated claims.
 */
export function enforceConfirmation(tailored, sourceForm, blocked) {
  if (!blocked.length) return tailored;
  const source = cleanStructuredResume(sourceForm);
  const contains = (value) => typeof value === 'string'
    ? blocked.some((term) => hasKeyword(value, term))
    : Array.isArray(value) ? value.some(contains)
      : value && typeof value === 'object' ? Object.values(value).some(contains) : false;
  const form = { ...tailored.form };
  const restored = [];
  for (const key of ['title', 'summary', 'skills', 'skillGroups', 'experience', 'projects', 'achievements', 'otherSections']) {
    if (contains(form[key])) {
      form[key] = source[key];
      restored.push(key);
    }
  }
  // Skills and categorized skills represent the same information; restore them together.
  if (restored.includes('skills') || restored.includes('skillGroups')) {
    form.skills = source.skills;
    form.skillGroups = source.skillGroups;
  }
  if (!restored.length) return tailored;
  const restoredExperience = restored.includes('experience');
  return {
    ...tailored, form,
    changes: restoredExperience ? [] : tailored.changes,
    estimates: restoredExperience ? [] : tailored.estimates,
    applied: restoredExperience ? 0 : tailored.applied,
    warnings: [...(tailored.warnings || []), { stage: 'confirmation', code: 'unconfirmed_keywords_removed', sections: restored }],
  };
}
