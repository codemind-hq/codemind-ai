import { hasKeyword } from '../text/keywords.js';
import { contentWords } from './text.js';
import { figuresOf, namesOf } from './detail.js';
import { formResumeModel, renderedPages } from '../resume/docx.js';
import { DEFAULT_TEMPLATE } from '../resume/templates.js';

// ── Page budget ─────────────────────────────────────────────────────────────
//
// A tailored resume is two pages at most, and no role runs past its cap (MAX_BULLETS_BY_ROLE). The
// rendering sets a resume a little tighter when it spills a few lines over (resume/docx.js
// fittedTemplate); one that runs well onto a third page has more said than two pages hold, and
// one just over a page ends on one. The least of it goes: the oldest role's bullets first, the
// ones that name nothing the job asks for before any that do. A role keeps at least one bullet,
// and every cut is listed as a removal the member can put back.

export const MAX_PAGES = 2;
// At most this many bullets go to the budget: past that, the resume is long by its own design.
const MAX_CUTS = 8;
// A bullet answers a requirement when it shares this many of its words ("Mentored 112
// professionals… internal ML engineering playbook" and "Mentor engineers… internal talks").
const REQUIREMENT_WORDS = 3;
// The page estimate is within a few hundredths of Word's (docx.js MEASURED): this under the
// page count is two pages for certain.
const PAGE_SLACK = 0.03;
// The bullets a role keeps at most, newest role first; every older one keeps the last. A role of
// 13-17 bullets (the Inabia tailorings, 2026-10-29) ran the resume to 1.4 pages, broke onto
// page 2 with no heading and left it half empty; past ten, a role's bullets say the same work again.
export const MAX_BULLETS_BY_ROLE = [10, 6, 4];
const roleCap = (role) => MAX_BULLETS_BY_ROLE[Math.min(role, MAX_BULLETS_BY_ROLE.length - 1)];
// A resume the caps leave this little over one page loses a few more bullets to end on one
// (the rendering's own tightening, resume/docx.js fittedTemplate, counted in), at most ONE_PAGE_CUTS.
const JUST_OVER_ONE = 1.25;
const ONE_PAGE_CUTS = 4;

/**
 * The tailoring cut to its page budget as rendered in `template` (the default when not given; the
 * other templates are tighter): each role to its cap (MAX_BULLETS_BY_ROLE), then to MAX_PAGES,
 * and one that is then just over a page to one. `protectedKeywords` are the job's terms and
 * `requirements` its requirements ([{ text }] or strings): a bullet naming more of them, or
 * answering one, stays longer. Returns { form, changes, estimates, cut } with `cut` the bullets
 * taken out, each listed as a removal the member can put back.
 */
export function withinPageBudget(tailored, { protectedKeywords = [], requirements = [], template = DEFAULT_TEMPLATE } = {}) {
  const copy = (f) => ({ ...f, experience: (f.experience || []).map((e) => ({ ...e, achievements: [...(e.achievements || [])] })) });
  let form = copy(tailored.form);
  let changes = (tailored.changes || []).map((c) => ({ ...c }));
  let estimates = (tailored.estimates || []).map((e) => ({ ...e }));
  const pages = () => renderedPages(formResumeModel(form), template);
  const asked = (requirements || []).map((r) => contentWords(typeof r === 'string' ? r : r?.text || ''));
  const answers = (text) => {
    const own = contentWords(text);
    return asked.filter((req) => [...req].filter((w) => own.has(w)).length >= REQUIREMENT_WORDS).length;
  };
  const weight = (text) => protectedKeywords.filter((k) => typeof k === 'string' && k.trim() && hasKeyword(text, k)).length + answers(text);
  // Every bullet that may go (`roles` limits it to some), least relevant first: fewest job terms and
  // requirements answered, then fewest figures and names (detail.js: "Predictive maintenance
  // pipelines (92% forecast accuracy)" goes before "PyTorch ResNet-50 CNN (98.3% accuracy),
  // LightGBM with SHAP…"), then the oldest role (experience is newest first), then the role's last bullet.
  const leastRelevant = (roles = null) =>
    form.experience
      .flatMap((e, role) => (e.achievements.length > 1 && (!roles || roles.includes(role)) ? e.achievements.map((text, at) => ({ role, at, text, weight: weight(text), details: figuresOf(text).length + namesOf(text).length })) : []))
      .sort((a, b) => a.weight - b.weight || a.details - b.details || b.role - a.role || b.at - a.at)[0];
  let cut = 0;
  const drop = (next) => {
    form.experience[next.role].achievements.splice(next.at, 1);
    const change = changes.find((c) => c.role === next.role && c.kind !== 'removed' && c.after === next.text);
    changes = changes.filter((c) => c !== change);
    const source = change ? change.before : next.text;
    if (source) changes.push({ role: next.role, kind: 'removed', before: source, after: '' });
    estimates = estimates.filter((e) => !(e.role === next.role && e.text === next.text));
    cut += 1;
  };

  form.experience.forEach((e, role) => {
    while (e.achievements.length > roleCap(role)) drop(leastRelevant([role]));
  });
  for (let n = 0; n < MAX_CUTS && pages() > MAX_PAGES - PAGE_SLACK; n += 1) {
    const next = leastRelevant();
    if (!next) break;
    drop(next);
  }
  // A few lines onto page 2 is a page break with nothing behind it: a few more bullets end it on one.
  const over = pages();
  if (over > 1 && over <= JUST_OVER_ONE) {
    const before = { form: copy(form), changes: [...changes], estimates: [...estimates], cut };
    for (let n = 0; n < ONE_PAGE_CUTS && pages() > 1 - PAGE_SLACK; n += 1) {
      const next = leastRelevant();
      if (!next) break;
      drop(next);
    }
    // Still over: those cuts bought nothing, so they are put back.
    if (pages() > 1 - PAGE_SLACK) ({ form, changes, estimates, cut } = before);
  }
  return { form, changes, estimates, cut };
}
