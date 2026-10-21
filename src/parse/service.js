import { AiError } from '../errors.js';
import { PROMPT_VERSIONS } from '../promptVersions.js';
import { complete } from '../llm/index.js';
import { withFallback } from '../llm/routing.js';
import { models } from '../runtime.js';
import { PARSE_RESUME_RESPONSE_FORMAT } from './schema.js';
import { cleanStructuredResume } from '../resume/structuredResume.js';

// Reading an uploaded resume into the structured form.

const PARSE_RESUME_SYSTEM_PROMPT = `You convert resume text extracted from a PDF or DOCX file into JSON.
Rules:
- Copy the candidate's wording exactly. Never invent, summarize, reword, or translate.
- The text may be out of order (columns, headers); put each piece in the section it belongs to.
- Leave a field as "" or [] when the resume does not have it.
- "achievements" holds resume-wide achievements, awards and honors, one per item. Bullets under a job stay in that job's achievements.
- List items never start with a bullet symbol (•, -, *, ➤ and the like); drop it and keep the text.
- Anything that fits no other field (publications, volunteering, interests...) goes in otherSections with its heading as title, so no content is lost.
- In education, "school" is the institution's name and "location" is only the city written with it, never its state or country ("University of Texas, Austin, TX" → school "University of Texas", location "Austin"). A place that is part of the name stays in it ("University of Arkansas, Fayetteville" when no other place follows). Never repeat the place in both.
- "skills" is one skill per item (split comma lists). "period" is the date range as written.
- When the skills section lists skills under categories ("Languages: Python, Go"), put each category in skillGroups as { category, items } with one skill per item, list the same skills in "skills" too, and set skillsHeading to the section's heading as written ("Technical Proficiencies"). Otherwise skillGroups is [] and skillsHeading is "". A categorized skills section never goes in otherSections.
- Headings may be in any language; map them by meaning, and keep the content in its own language. Experience: Berufserfahrung, Werdegang, expérience professionnelle, experiencia laboral, esperienza professionale, werkervaring, experiência profissional. Education: Ausbildung, Studium, formation, études, educación, formación, istruzione, formazione, opleiding, formação. Skills: Kenntnisse, Kompetenzen, compétences, habilidades, competencias, competenze, vaardigheden, competências. Summary: Profil, Kurzprofil, Zusammenfassung, profil professionnel, perfil, resumen, profilo, samenvatting, resumo. Projects: Projekte, projets, proyectos, progetti, projecten, projetos. Certifications: Zertifikate, certificats, certificaciones, certificazioni, certificados. Languages: Sprachen, langues, idiomas, lingue, talen, línguas. Achievements: Auszeichnungen, distinctions, premios, logros, premi, prêmios, conquistas.`;

// Which model reads a resume, and what it falls back to: the app's `parse` models (createCodemind).
const parseResumeTries = () => {
  const parse = models().parse;
  return {
    model: { model: parse.model, reasoningEffort: parse.effort },
    fallbackModel: { model: parse.fallbackModel, reasoningEffort: parse.fallbackEffort },
  };
};

/**
 * Split resume text into the structured form's fields. The caller cleans the result.
 *
 * @param {string} resumeText
 * @param {import('../types.js').CallMeta} [meta]
 * @returns {Promise<import('../types.js').ResumeForm>} The model's reading, for the caller to clean.
 */
export async function parseResumeText(resumeText, meta = {}) {
  // Validate before entering the fallback loop so bad input never spends a model call.
  if (typeof resumeText !== 'string' || !resumeText.trim()) throw AiError.badRequest('Resume text is required');
  return withFallback(async ({ model, reasoningEffort }) => {
    const { data } = await complete(
      {
        model,
        reasoningEffort,
        system: PARSE_RESUME_SYSTEM_PROMPT,
        user: `Convert this resume into the structured resume form.

RESUME:
${resumeText.slice(0, 20000)}`,
        json: true,
        responseFormat: PARSE_RESUME_RESPONSE_FORMAT,
      },
      { ...meta, kind: 'resume_parse', promptVersion: PROMPT_VERSIONS.parseResume }
    );
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw AiError.upstream('The model did not return a resume');
    // Cleaning removes malformed fields. Require some usable content without requiring
    // contact details, since anonymized resumes are valid inputs too.
    const cleaned = cleanStructuredResume(data);
    if (!Object.values(cleaned).some((value) => typeof value === 'string' ? value.trim() : Array.isArray(value) && value.length)) {
      throw AiError.upstream('The model did not return usable resume content');
    }
    return data;
  }, parseResumeTries());
}
