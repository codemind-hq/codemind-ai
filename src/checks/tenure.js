// ── Years of experience ────────────────────────────────────────────────────
//
// A tenure the source resume's dates cannot reach is an invention. Rules ported from
// ai-job-hunter-app (Apache-2.0), apps/desktop/src-tauri/src/validate/content/credentials/tenure.rs.

const SPELLED = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const YEARS_RE = new RegExp(String.raw`\b(\d{1,2}|${Object.keys(SPELLED).join('|')})(?:\s*\+\s*|\s+|-)(?:years?|yrs?)\b`, 'gi');
// Words that make a nearby "N years" a claim about the candidate's own career, rather than about
// a contract, a system or a migration ("a 3-year roadmap").
const EXPERIENCE_CONTEXT = /\b(experience[ds]?|career|professional(?:ly)?|industry|tenure|working|worked|hands-on)\b/i;
const CONTEXT_CHARS = 40;
// The summary shapes that state a tenure with no career word: "Backend engineer with 8 years",
// "Data engineer, eight years across …". The role noun is what tells them from "a codebase with
// 20 years in production".
const ROLE_LEAD_IN = /\b(?:engineer|developer|architect|manager|lead|scientist|analyst|designer|consultant|specialist|programmer|administrator|devops|sre|professional)s?\s*(?:,|with)\s+(?:over\s+|more than\s+|nearly\s+|almost\s+)?$/i;
// Above this a number of years is about something else, and reading it as a tenure is a misparse.
const MAX_TENURE = 60;
// Year numbers bound the true span from below by up to a year: "2018 – 2021" may be 47 months.
const SPAN_SLACK_YEARS = 1;
const PRESENT_RE = /\b(present|current(?:ly)?|now|today|ongoing)\b/i;
// A tenure stated in a way no number can be read from; the check then says nothing.
const UNREADABLE_TENURE_RE = /\b(decades?|over a decade|many years|several years)\b/gi;

const yearsValue = (raw) => (/^\d+$/.test(raw) ? Number(raw) : SPELLED[raw.toLowerCase()]);

/**
 * Whether `text` states a tenure in words no number can be read from. The phrase has to sit in
 * career wording, as a claimed "N years" does: "Indexed decades of archived documents" is not a
 * tenure, and must not switch the check off for the whole resume.
 */
function statesUnreadableTenure(text) {
  for (const m of text.matchAll(UNREADABLE_TENURE_RE)) {
    const around = text.slice(Math.max(0, m.index - CONTEXT_CHARS), m.index + m[0].length + CONTEXT_CHARS);
    if (EXPERIENCE_CONTEXT.test(around) || ROLE_LEAD_IN.test(text.slice(0, m.index))) return true;
  }
  return false;
}

/** The tenures `text` claims for the candidate: every "N years" with career wording within reach. */
export function tenureClaims(text) {
  const line = String(text || '');
  const claims = [];
  for (const m of line.matchAll(YEARS_RE)) {
    const years = yearsValue(m[1]);
    if (!years || years > MAX_TENURE) continue;
    const around = line.slice(Math.max(0, m.index - CONTEXT_CHARS), m.index + m[0].length + CONTEXT_CHARS);
    if (EXPERIENCE_CONTEXT.test(around) || ROLE_LEAD_IN.test(line.slice(0, m.index))) claims.push({ years, text: m[0] });
  }
  return claims;
}

/**
 * The most years of experience the source resume supports: what it states, or the span its
 * dates cover plus a year's slack, whichever is more. Null when neither can be read, and then
 * no claim is judged: unknown is not zero.
 */
export function supportedYears(form, { now = new Date() } = {}) {
  const text = [form?.summary, form?.title, ...(form?.experience || []).flatMap((e) => [e.period, ...(e.achievements || [])])].filter(Boolean).join('\n');
  if (statesUnreadableTenure(text)) return null;
  let stated = 0;
  for (const m of text.matchAll(YEARS_RE)) stated = Math.max(stated, yearsValue(m[1]) || 0);

  const periods = [...(form?.experience || []), ...(form?.projects || [])].map((e) => String(e?.period || ''));
  const thisYear = now.getFullYear();
  const years = periods.flatMap((p) => [...p.matchAll(/\b(19[5-9]\d|20\d\d)\b/g)].map((m) => Number(m[1]))).filter((y) => y <= thisYear + 1);
  let span = 0;
  if (years.length) {
    const latest = periods.some((p) => PRESENT_RE.test(p)) ? thisYear : Math.max(...years);
    span = latest - Math.min(...years) + SPAN_SLACK_YEARS;
  }
  const supported = Math.max(stated, span);
  return supported > 0 ? supported : null;
}

/** The tenure claims in `text` above what the source supports; none when support is unknown. */
export function inflatedTenure(text, supported) {
  if (supported == null) return [];
  return tenureClaims(text).filter((c) => c.years > supported);
}
