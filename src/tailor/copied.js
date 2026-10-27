import { contentWords, overlap, stems } from './text.js';

// A line that answers a requirement with the requirement's own words and nothing of the role's
// — "Participated in Agile teams and Software Development Lifecycle practices to iterate over
// design and development cycles" for "Agile experience", "worked in a medium-sized engineering
// organization" for "experience in medium- to large-sized engineering organizations" — is the
// posting paraphrased, not experience. Experience names the thing: the product, pipeline,
// client or system the role's other bullets name, and what was done with it. So a new line
// that shares half or more of a requirement's content words must also carry a content word of
// the role's own bullets that is not the requirement's and not a word every resume uses
// (ECHO_GENERIC, as the 4-character stems contentWords gives). A rewrite is judged on what it
// added to its bullet (`before`): ECHO_FRESH_WORDS or more new words, ECHO_FRESH_SHARE of them
// the requirement's, and none of them the role's own, is the requirement glued on.
const ECHO_SHARE = 0.5;
const ECHO_MIN_WORDS = 2;
const ECHO_FRESH_WORDS = 3;
const ECHO_FRESH_SHARE = 0.6;
const ECHO_GENERIC = new Set(
  ['desi', 'deve', 'buil', 'syst', 'serv', 'appl', 'solu', 'envi', 'requ', 'prac', 'proc', 'work', 'deli', 'supp', 'impl', 'mana', 'expe', 'proj', 'prod', 'feat', 'tool', 'code', 'soft', 'engi', 'plat', 'impr', 'crea', 'ensu', 'prov', 'main', 'acro', 'mult', 'vari', 'stro', 'know', 'abil', 'comf', 'lead', 'coll', 'part', 'cont', 'help', 'oper', 'perf', 'rele', 'qual', 'test', 'revi', 'cust', 'busi', 'stak', 'func', 'cros', 'comp', 'tech', 'meth', 'appr', 'best', 'effe', 'high', 'comm', 'clea', 'scal', 'reli', 'secu', 'modu', 'inte', 'exis', 'orga', 'size', 'medi', 'larg', 'smal', 'inde', 'owne', 'full', 'cycl', 'life', 'iter', 'plan', 'ship', 'defi', 'esta', 'driv', 'guid', 'need', 'goal', 'user', 'clie']
);

/**
 * The requirement `text` paraphrases without the role's own work, or null. `requirements` are
 * the job's, `roleText` the bullets of the role the line is written into, as the resume had
 * them: what a real line about that role would name.
 */
export function echoesRequirement(text, requirements = [], roleText = '', { before = '', terms = [] } = {}) {
  // The job's own terms are the words the line was asked to use: they count on neither side, or a
  // line about the role's Redis and SSE work that names "asynchronous workflows", "concurrency" and
  // "fault tolerance" reads as the requirement that lists them.
  const line = contentWords(withoutTerms(text, terms, ' ', 1));
  const role = contentWords(roleText);
  const earlier = contentWords(withoutTerms(before, terms, ' ', 1));
  // What the line brings: all of it for a new bullet, the new words for a rewrite.
  const fresh = [...line].filter((w) => !earlier.has(w));
  const anchored = (ws, req) => ws.some((w) => !req.has(w) && !ECHO_GENERIC.has(w) && role.has(w));
  for (const r of requirements) {
    const reqText = typeof r === 'string' ? r : r?.text;
    const req = contentWords(withoutTerms(reqText || '', terms, ' ', 1));
    if (req.size < ECHO_MIN_WORDS) continue;
    if (!before) {
      let shared = 0;
      for (const w of req) if (line.has(w)) shared += 1;
      if (shared / req.size >= ECHO_SHARE && !anchored([...line], req)) return reqText;
    } else if (fresh.length >= ECHO_FRESH_WORDS) {
      const ofReq = fresh.filter((w) => req.has(w)).length;
      if (ofReq / fresh.length >= ECHO_FRESH_SHARE && !anchored(fresh, req)) return reqText;
    }
  }
  return null;
}

// Four words of a requirement in a row, stems compared, is the requirement pasted rather than
// the candidate's work translated into its term; three of the four must be words of substance,
// so "experience with the design of" alone is not one. So is a line of about the requirement's
// length that shares most of its content words in any order ("taking ambiguous requirements
// through production without daily direction" for "taking a scoped project from an ambiguous
// starting point to production without needing daily direction"); a bullet twice as long that
// uses the requirement's terms around real work is the translation that was asked for.
const REQUIREMENT_RUN = 4;
const REQUIREMENT_RUN_SUBSTANCE = 3;
const REQUIREMENT_OVERLAP = 0.6;
const REQUIREMENT_LENGTH_RATIO = 1.5;
// The posting as a whole is looser: five words in a row, four of substance ("follow-the-sun
// model across three time zones"), so a line naming three tools the posting also names in a row
// is not a copy, and a phrase of the posting's own is.
const POSTING_RUN = 5;
const POSTING_RUN_SUBSTANCE = 4;

/** A run of `size` stems of `from`, `substance` of them full words, that `line` repeats in a row: the run's text, or null. */
function sharedRun(line, from, size, substance) {
  for (let i = 0; i + size <= from.length; i += 1) {
    const run = from.slice(i, i + size);
    if (run.filter((w) => w.full).length < substance) continue;
    for (let j = 0; j + size <= line.length; j += 1) {
      if (run.every((w, k) => w.stem === line[j + k].stem)) return run.map((w) => w.stem).join(' ');
    }
  }
  return null;
}

/**
 * The posting's requirement a line repeats (REQUIREMENT_RUN words of it in a row), or, given the
 * posting (`description`), the phrase of it the line repeats (POSTING_RUN words in a row); null
 * when the line is the candidate's own.
 */
export function copiedRequirement(text, requirements = [], description = '', { terms = [] } = {}) {
  // The job's own terms (`terms`: "prompt injection", "unsafe tool execution") are the words a line
  // is asked to use: each is one word here, a different one on each side, so naming two of them
  // in a row is not a run of the posting. Before, "Blocked prompt injection and unsafe tool
  // execution…" was refused as a copy of "…including prompt injection, unsafe tool execution and…".
  const own = (s) => withoutTerms(s, terms, 'qxline');
  const theirs = (s) => withoutTerms(s, terms, 'zxpost');
  const lineText = own(text);
  const line = stems(lineText);
  for (const r of requirements) {
    const reqText = typeof r === 'string' ? r : r?.text;
    const req = theirs(reqText);
    const aboutAsLong = contentWords(lineText).size <= contentWords(req).size * REQUIREMENT_LENGTH_RATIO;
    if (aboutAsLong && overlap(req, lineText) >= REQUIREMENT_OVERLAP) return reqText;
    if (sharedRun(line, stems(req), REQUIREMENT_RUN, REQUIREMENT_RUN_SUBSTANCE)) return typeof r === 'string' ? r : r.text;
  }
  if (description) {
    const run = sharedRun(line, stems(theirs(description)), POSTING_RUN, POSTING_RUN_SUBSTANCE);
    if (run) return run;
  }
  return null;
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `text` with every one of `terms` of `minWords` words or more replaced by `word` (a space removes them). */
function withoutTerms(text, terms, word, minWords = 2) {
  let out = String(text || '');
  for (const term of terms || []) {
    if (typeof term !== 'string' || !term.trim() || term.trim().split(/\s+/).length < minWords) continue;
    const body = term.trim().split(/[-_\s]+/).map(escapeRegex).join('[-_\\s]+');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu'), ` ${word} `);
  }
  return out;
}
