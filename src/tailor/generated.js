import { cleanStructuredResume } from '../resume/structuredResume.js';
import { lower } from './text.js';

// "Write a new resume for this job": the model's answer is the resume. Unlike a tailoring
// (form.js), nothing it wrote is traced, refused or put back from the source; only what the
// generate prompt leaves to the application (prompts/generate.js) is copied from the source:
// contact details, education, certifications and languages. The repair round (repair.js) is the
// one pass that follows (service.js), and nothing after it changes the resume (pipeline.js).

const FROM_SOURCE = ['name', 'email', 'phone', 'location', 'linkedin', 'github', 'portfolio', 'education', 'certifications', 'languages'];

const text = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.text === 'string' ? v.text : '');

/** The headline as the model wrote it: its role, then up to three specialties. */
function writtenHeadline(headline, fallback) {
  const role = String(headline?.role || '').replace(/\s+/g, ' ').trim();
  if (!role) return fallback || '';
  const specialties = (Array.isArray(headline?.specialties) ? headline.specialties : []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 3);
  return specialties.length ? `${role} | ${specialties.join(' · ')}` : role;
}

/**
 * The resume the model wrote (`written`, the answer's `resume`, with `headline`), with the
 * source's contact details, education, certifications and languages. Returns the shape a
 * tailoring has: { form, changes, estimates, droppedSkills, pairedExperience, source }, where
 * `changes` lists every bullet the model wrote as added and every source bullet it left out as
 * removed (role: an index into the new experience), and `source` is the source's roles lined up
 * with the new ones by employer, for the repair round's checks.
 */
export function generatedResumeForm(sourceForm, written, { headline = null } = {}) {
  const source = cleanStructuredResume(sourceForm);
  // The form's cleaning drops bullets written as { text, estimate }, so they are read as text first.
  const draft = cleanStructuredResume({
    ...(written || {}),
    experience: (Array.isArray(written?.experience) ? written.experience : []).map((e) => ({ ...e, achievements: (e?.achievements || []).map(text).filter((t) => t.trim()) })),
  });
  const form = { ...draft, title: writtenHeadline(headline, source.title) };
  for (const field of FROM_SOURCE) form[field] = source[field];

  // The source role each new one is about, by employer: what the repair round reads a line against.
  const aligned = form.experience.map((e) => source.experience.find((s) => lower(s.company) === lower(e.company)) || { ...e, achievements: [] });
  const changes = [];
  form.experience.forEach((e, role) => {
    const before = aligned[role].achievements;
    for (const after of e.achievements) if (!before.some((b) => lower(b) === lower(after))) changes.push({ role, kind: 'added', before: '', after });
    for (const was of before) if (!e.achievements.some((a) => lower(a) === lower(was))) changes.push({ role, kind: 'removed', before: was, after: '' });
  });
  return {
    form,
    changes,
    estimates: [],
    droppedSkills: [],
    pairedExperience: aligned.filter((s) => source.experience.includes(s)).length,
    source: { ...source, experience: aligned },
  };
}
