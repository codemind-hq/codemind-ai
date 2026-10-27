import { hasKeyword } from '../text/keywords.js';
import { contentWords } from './text.js';
import { figuresOf, namesOf } from './detail.js';
import { formResumeModel, renderedPages } from '../resume/docx.js';
import { DEFAULT_TEMPLATE } from '../resume/templates.js';

// ── Page budget ─────────────────────────────────────────────────────────────
//
// A tailored resume is two pages. The rendering sets a resume a little tighter when it spills a
// few lines over (resume/docx.js fittedTemplate); one that runs well onto a third page has more
// said than two pages hold, and the least of it goes: the oldest role's bullets first, the ones
// that name nothing the job asks for before any that do. A role keeps at least one bullet, and
// every cut is listed as a removal the member can put back.

export const MAX_PAGES = 2;
// At most this many bullets go to the budget: past that, the resume is long by its own design.
const MAX_CUTS = 8;
// A bullet answers a requirement when it shares this many of its words ("Mentored 112
// professionals… internal ML engineering playbook" and "Mentor engineers… internal talks").
const REQUIREMENT_WORDS = 3;
// The page estimate is within a few hundredths of Word's (docx.js MEASURED): this under the
// page count is two pages for certain.
const PAGE_SLACK = 0.03;

/**
 * The tailoring cut to MAX_PAGES as rendered in `template` (the default when not given; the
 * other templates are tighter). `protectedKeywords` are the job's terms and `requirements` its
 * requirements ([{ text }] or strings): a bullet naming more of them, or answering one, stays
 * longer. Returns { form, changes, estimates, cut } with `cut` the bullets taken out.
 */
export function withinPageBudget(tailored, { protectedKeywords = [], requirements = [], template = DEFAULT_TEMPLATE } = {}) {
  let form = { ...tailored.form, experience: (tailored.form.experience || []).map((e) => ({ ...e, achievements: [...(e.achievements || [])] })) };
  let changes = (tailored.changes || []).map((c) => ({ ...c }));
  let estimates = (tailored.estimates || []).map((e) => ({ ...e }));
  const pages = () => renderedPages(formResumeModel(form), template);
  const asked = (requirements || []).map((r) => contentWords(typeof r === 'string' ? r : r?.text || ''));
  const answers = (text) => {
    const own = contentWords(text);
    return asked.filter((req) => [...req].filter((w) => own.has(w)).length >= REQUIREMENT_WORDS).length;
  };
  const weight = (text) => protectedKeywords.filter((k) => typeof k === 'string' && k.trim() && hasKeyword(text, k)).length + answers(text);
  let cut = 0;
  while (cut < MAX_CUTS && pages() > MAX_PAGES - PAGE_SLACK) {
    // Every bullet that may go, least relevant first: fewest job terms and requirements answered,
    // then fewest figures and names (detail.js: "Predictive maintenance pipelines (92% forecast
    // accuracy)" goes before "PyTorch ResNet-50 CNN (98.3% accuracy), LightGBM with SHAP…"), then
    // the oldest role (experience is newest first), then the role's last bullet.
    const options = form.experience
      .flatMap((e, role) => (e.achievements.length > 1 ? e.achievements.map((text, at) => ({ role, at, text, weight: weight(text), details: figuresOf(text).length + namesOf(text).length })) : []))
      .sort((a, b) => a.weight - b.weight || a.details - b.details || b.role - a.role || b.at - a.at);
    const next = options[0];
    if (!next) break;
    form.experience[next.role].achievements.splice(next.at, 1);
    const change = changes.find((c) => c.role === next.role && c.kind !== 'removed' && c.after === next.text);
    changes = changes.filter((c) => c !== change);
    const source = change ? change.before : next.text;
    if (source) changes.push({ role: next.role, kind: 'removed', before: source, after: '' });
    estimates = estimates.filter((e) => !(e.role === next.role && e.text === next.text));
    cut += 1;
  }
  return { form, changes, estimates, cut };
}
