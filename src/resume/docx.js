import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
  convertInchesToTwip,
} from 'docx';
import { resumeTemplate } from './templates.js';
import { skillLines, skillsHeading } from './structuredResume.js';

// A résumé → a small document model → a .docx in one of the templates.
//
// Tailoring writes a résumé form, and the model is built straight from it (formResumeModel).
// Applications tailored before that hold plain text instead, which is parsed (name and title
// first, then standard sections with entries and bullets). The parse takes the contact details
// from the saved résumé form when there is one: those are the user's own values, not a rewrite
// of them, and the text extracted from a two-column PDF often carries stray labels ("Details",
// "Links") that must not end up in the document.

// ── text → model ──────────────────────────────────────────────────────────────

const SECTION_NAMES = new Set([
  'summary', 'professional summary', 'profile', 'professional profile', 'objective', 'about', 'about me',
  'experience', 'work experience', 'professional experience', 'employment', 'employment history', 'work history',
  'education', 'skills', 'technical skills', 'core competencies', 'key skills', 'skills & tools', 'tools',
  'projects', 'selected projects', 'certifications', 'certificates', 'licenses', 'licenses & certifications',
  'awards', 'honors', 'achievements', 'awards & achievements', 'publications', 'languages',
  'volunteer', 'volunteering', 'volunteer experience', 'interests', 'additional information', 'references',
]);
const ENTRY_SECTIONS = /experience|employment|history|education|projects|volunteer|certif|licen/i;
const BULLET_RE = /^[-•*–·▪▸►]\s+/;
const DATE_RE = /\b((19|20)\d{2}|present|current|now|ongoing)\b/i;
const CONTACT_RE = /@|\+?\d[\d\s().-]{6,}\d|linkedin\.|github\.|https?:\/\/|www\./i;
const LABEL_LINE_RE = /^(details|contact|links|profile|personal|address)$/i;
const LABELLED_RE = /^([A-Za-z][\w &/+.-]{1,32}):\s+(.+)$/;

const headingText = (line) => line.replace(/^#{1,3}\s*/, '').replace(/[:\s]+$/, '').trim();
const isHeading = (line) => {
  const t = headingText(line);
  return t.length > 0 && t.length <= 50 && (/^#{1,3}\s/.test(line) || SECTION_NAMES.has(t.toLowerCase()));
};
// A short line that is mostly a date or a date range: "OCT 2019 — PRESENT", "2018 – 2021".
const isDateLine = (line) => DATE_RE.test(line) && line.length <= 40 && !/[.;]$/.test(line) && line.split(/\s+/).length <= 7;

// "Senior Engineer, Acme" / "… at Acme" / "… — Acme" / "… · Acme" → [title, org]. The middle
// dot is how this renderer writes an entry itself, so its own output parses back.
function splitEntryTitle(line) {
  const m = line.match(/^(.{2,}?)(?:,\s+|\s+(?:at|@)\s+|\s+[—–|·]\s+)(.+)$/);
  return m ? [m[1].trim(), m[2].trim()] : [line, ''];
}

// A date or date range at the end of a line: "Jan 2019 – Present", "2019 — 2021", "2020".
const MONTH = '(?:[A-Za-z]{3,9}\\.?\\s+)?';
const YEAR = '(?:19|20)\\d{2}';
const OPEN_END = '(?:present|current|now|ongoing)';
const TRAILING_DATES_RE = new RegExp(`^(.+?)\\s+[—–|]\\s+(${MONTH}${YEAR}(?:\\s*[—–-]\\s*(?:${MONTH}${YEAR}|${OPEN_END}))?)\\s*$`, 'i');

/** A line whose dates sit at the end, "Title | Company | 2019 — 2021" → [head, dates]. */
function splitTrailingDates(line) {
  const m = line.match(TRAILING_DATES_RE);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

function toBlocks(lines, entrySection) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i += 1;
      continue;
    }
    if (BULLET_RE.test(line)) {
      const items = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(lines[i].replace(BULLET_RE, '').trim());
        i += 1;
      }
      blocks.push({ type: 'bullets', items });
      continue;
    }
    const next = lines[i + 1] || '';
    if (entrySection && next && !BULLET_RE.test(next) && isDateLine(next) && !isDateLine(line)) {
      const [title, org] = splitEntryTitle(line);
      blocks.push({ type: 'entry', title, org, dates: next });
      i += 2;
      continue;
    }
    const trailing = entrySection ? splitTrailingDates(line) : null;
    if (trailing) {
      const [title, org] = splitEntryTitle(trailing[0]);
      blocks.push({ type: 'entry', title, org, dates: trailing[1] });
      i += 1;
      continue;
    }
    blocks.push({ type: 'paragraph', text: line });
    i += 1;
  }
  return blocks;
}

/** Contact details: the saved form's own values when there is one, else what the text carries. */
function contactFrom(form, headerLines) {
  if (form) {
    return [form.email, form.phone, form.location, form.linkedin, form.github, form.portfolio].map((v) => (v || '').trim()).filter(Boolean);
  }
  return headerLines
    .filter((l) => CONTACT_RE.test(l))
    .flatMap((l) => l.split(/\s*[|·•]\s*/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse tailored résumé text into { name, title, contact, sections }. `form` is the saved
 * structured résumé the tailoring started from; its name and contact details win over the
 * text's, its title does not (the tailoring may have adjusted the headline to the job).
 */
export function parseTailoredResume(text, form = null) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim());
  const headerLines = [];
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (isHeading(line)) {
      current = { heading: headingText(line), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else if (line) {
      headerLines.push(line);
    }
  }

  // The form's own text header is "Name — Title", which the tailoring often keeps. With a form
  // the name is the form's; without one, a first line in that shape is split the same way.
  const firstSplit = (headerLines[0] || '').match(/^(.+?)\s+[—–|]\s+(.+)$/);
  const formName = (form?.name || '').trim();
  const name = formName || (firstSplit ? firstSplit[1].trim() : headerLines[0] || '');
  const namePrefix = name ? new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:[—–|,-]|\\bat\\b)\\s*`, 'i') : null;
  // The headline is the first remaining header line that is not contact details or a label.
  const candidates = headerLines
    .map((l) => (namePrefix ? l.replace(namePrefix, '').trim() : l))
    .filter((l) => l && l.toLowerCase() !== name.toLowerCase() && !CONTACT_RE.test(l) && !LABEL_LINE_RE.test(l) && l.length <= 80);
  const title = candidates[0] || (form?.title || '').trim();

  return {
    name,
    title,
    contact: contactFrom(form, headerLines),
    sections: sections.map((s) => ({ heading: s.heading, blocks: toBlocks(s.lines, ENTRY_SECTIONS.test(s.heading)) })),
  };
}

// ── form → model ──────────────────────────────────────────────────────────────

/** { label } for a skills line that starts with its category; {} for any other. */
function skillLabel(form, line) {
  const group = (form.skillGroups || []).find((g) => g.category && line.startsWith(`${g.category}: `));
  return group ? { label: group.category } : {};
}

const bulletBlock = (items) => (items?.length ? [{ type: 'bullets', items }] : []);

/**
 * The document model of a resume form: what tailoring writes and the resume editor saves. No
 * parsing and no guessing — every entry is already a title, an organisation and dates.
 */
export function formResumeModel(form) {
  const f = form || {};
  const sections = [];
  const add = (heading, blocks) => {
    if (blocks.length) sections.push({ heading, blocks });
  };
  // An entry leads with whichever of its two names it has.
  const entry = (title, org, dates) => ({ type: 'entry', title: title || org || '', org: title ? org || '' : '', dates: dates || '' });

  add('Summary', f.summary ? [{ type: 'paragraph', text: f.summary }] : []);
  // Skills by category are one "Category: a, b" line each, the category in bold.
  add(skillsHeading(f), skillLines(f).map((text) => ({ type: 'paragraph', text, ...skillLabel(f, text) })));
  add('Experience', (f.experience || []).flatMap((e) => [entry(e.title, e.company, e.period), ...bulletBlock(e.achievements)]));
  add(
    'Projects',
    (f.projects || []).flatMap((p) => [
      entry(p.name, p.role, p.period),
      ...(p.link ? [{ type: 'paragraph', text: p.link }] : []),
      ...bulletBlock(p.highlights),
    ])
  );
  add('Education', (f.education || []).map((e) => entry(e.degree, [e.school, e.location].filter(Boolean).join(', '), e.year)));
  add('Certifications', (f.certifications || []).map((c) => entry(c.name, c.issuer, c.year)));
  add('Achievements', bulletBlock(f.achievements));
  add('Languages', f.languages?.length ? [{ type: 'paragraph', text: f.languages.join(', ') }] : []);
  for (const other of f.otherSections || []) {
    add(other.title || 'Additional', toBlocks(String(other.content || '').split('\n').map((l) => l.trim()), false));
  }

  return { name: f.name || '', title: f.title || '', contact: contactFrom(f, []), sections };
}

// ── model → pages ─────────────────────────────────────────────────────────────

// Average glyph width as a share of the font size; enough to tell one page from two.
const GLYPH_WIDTH = { Georgia: 0.5, Calibri: 0.45, Arial: 0.48 };
const LINE_HEIGHT = 1.17;
const TWIPS = 20;

// A bold title runs wider than body text of the same size.
const BOLD_WIDTH = 1.12;
const textWidth = (text, size, glyph, bold = false) => String(text || '').length * size * glyph * 1.04 * (bold ? BOLD_WIDTH : 1);
// The page the docx library sets by default: A4, 11906 by 16838 twips (8.27 by 11.69 inches).
const PAGE_INCHES = { width: 11906 / 1440, height: 16838 / 1440 };
const pageWidth = (t) => (PAGE_INCHES.width - 2 * t.margins) * 72;
// Room kept between an entry's title and its dates, in points.
const DATES_GAP = 18;

/**
 * True when an entry's dates fit on its title line, right-aligned after the title and its
 * organisation. "Founder and Lead AI Engineer, Music Intelligence Platform · HarmoniqHub" left no
 * room for "Dec 2024 - Present": the right tab had nowhere to go and Word set the dates against
 * the name ("HarmoniqHubDec 2024 - Present"). Such dates go on a line of their own.
 */
function datesFit({ title, org, dates }, t) {
  const glyph = GLYPH_WIDTH[t.fonts.body] || 0.5;
  const line = textWidth(title, t.sizes.body, glyph, true) + (org ? textWidth(`  ·  ${org}`, t.sizes.body, glyph) : 0);
  return line + textWidth(dates, t.sizes.small, glyph) + DATES_GAP <= pageWidth(t);
}

/**
 * True when every dated entry of a section fits its dates beside its title (datesFit). A section
 * sets them one way: Fast Enterprises' dates at the margin between two roles whose dates sat on a
 * line of their own read as a layout gone wrong.
 */
const sectionDatesFit = (section, t) => (section.blocks || []).every((b) => b.type !== 'entry' || !b.dates || datesFit(b, t));

/** How many pages a document model fills in a template (the template itself, not its id), unrounded. */
function pagesIn(model, t) {
  const width = pageWidth(t);
  const pageHeight = (PAGE_INCHES.height - 2 * t.margins) * 72;
  const glyph = GLYPH_WIDTH[t.fonts.body] || 0.5;
  const lines = (text, size, indent = 0) => Math.max(1, Math.ceil(textWidth(text, size, glyph) / (width - indent)));
  const block = (text, size, after, indent) => lines(text, size, indent) * size * LINE_HEIGHT + after / TWIPS;

  let height = 0;
  if (model.name) height += block(model.name, t.sizes.name, 40);
  if (model.title) height += block(model.title, t.sizes.title, 40);
  if (model.contact?.length) height += block(model.contact.join(t.header.separator), t.sizes.small, t.spacing.paragraph);
  for (const section of model.sections || []) {
    height += t.sizes.heading * LINE_HEIGHT + (t.spacing.sectionBefore + t.spacing.sectionAfter) / TWIPS;
    const inline = sectionDatesFit(section, t);
    for (const b of section.blocks || []) {
      if (b.type === 'entry') {
        const titleLines = Math.max(1, Math.ceil((textWidth(b.title, t.sizes.body, glyph, true) + (b.org ? textWidth(`  ·  ${b.org}`, t.sizes.body, glyph) : 0)) / width));
        const dateLine = b.dates && !inline ? t.sizes.small * LINE_HEIGHT : 0;
        height += titleLines * t.sizes.body * LINE_HEIGHT + dateLine + (t.spacing.entryBefore + t.spacing.bullet) / TWIPS;
      } else if (b.type === 'bullets') for (const item of b.items) height += block(item, t.sizes.body, t.spacing.bullet, 18);
      else height += block(b.text, t.sizes.body, t.spacing.paragraph);
    }
  }
  return (height / pageHeight) * MEASURED;
}
// What Word made of the same documents: six renders of two resumes in the three templates
// (2026-10-27, A4) filled 0.91 to 0.97 of what the character counts say.
const MEASURED = 0.93;

// A last page this little filled is a few lines spilled over: the document is set a little
// tighter, a step at a time, until it ends a page sooner. A page and a half stays as it is —
// squeezing that much reads as cramped.
const SPARSE_LAST_PAGE = 0.4;
// The estimate missed Word by up to 0.13 of a page once spacing was tightened (a resume estimated
// at 1.9 pages ran to 2.03): a fitted layout must come in this far under the page.
const FIT_MARGIN = 0.15;
const scaleSpacing = (spacing, by) => Object.fromEntries(Object.entries(spacing).map(([k, v]) => [k, Math.round(v * by)]));
const smaller = (sizes, by, keys) => ({ ...sizes, ...Object.fromEntries(keys.map((k) => [k, sizes[k] - by])) });
const FIT_STEPS = [
  (t) => ({ ...t, spacing: scaleSpacing(t.spacing, 0.7) }),
  (t) => ({ ...t, sizes: smaller(t.sizes, 0.5, ['body', 'small', 'heading']) }),
  (t) => ({ ...t, margins: Math.max(0.5, t.margins - 0.15) }),
  (t) => ({ ...t, sizes: smaller(t.sizes, 0.5, ['body']) }),
];

/**
 * The template a document model is rendered in: `templateId`'s own, or, when that leaves a last
 * page nearly empty (two pages and three lines), the same layout set tighter so it ends a page
 * sooner. The look stays the template's: only spacing, then type size, then margins give.
 */
export function fittedTemplate(model, templateId) {
  const t = resumeTemplate(templateId);
  const pages = pagesIn(model, t);
  const whole = Math.floor(pages);
  if (whole < 1 || pages - whole === 0 || pages - whole > SPARSE_LAST_PAGE) return t;
  let fitted = t;
  for (const step of FIT_STEPS) {
    fitted = step(fitted);
    if (pagesIn(model, fitted) <= whole - FIT_MARGIN) return fitted;
  }
  return t;
}

/**
 * Roughly how many pages a document model fills in a template as it is rendered (fittedTemplate),
 * to one decimal. An estimate from character counts, not a layout: good for "this runs onto a
 * second page", not for where the break falls.
 */
export function estimatePages(model, templateId) {
  return Math.max(0.1, Math.round(renderedPages(model, templateId) * 10) / 10);
}

/** estimatePages unrounded: the pages a model fills as rendered, for code that budgets them (tailor/pages.js). */
export const renderedPages = (model, templateId) => pagesIn(model, fittedTemplate(model, templateId));

// ── model → docx ──────────────────────────────────────────────────────────────

const pt = (n) => Math.round(n * 2); // docx sizes are half-points

function headingParagraph(text, t) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: t.spacing.sectionBefore, after: t.spacing.sectionAfter },
    border: t.heading.rule ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: t.colors.rule, space: 2 } } : undefined,
    children: [
      new TextRun({
        text,
        bold: true,
        allCaps: t.heading.uppercase,
        characterSpacing: t.heading.letterSpacing || undefined,
        font: t.fonts.heading,
        size: pt(t.sizes.heading),
        color: t.colors.heading,
      }),
    ],
  });
}

function entryParagraph(entry, t, inline = datesFit(entry, t)) {
  const { title, org, dates } = entry;
  const children = [new TextRun({ text: title, bold: true })];
  if (org) children.push(new TextRun({ text: `  ·  ${org}` }));
  // Right-aligned at the margin when every entry of the section fits them beside its title, else on
  // the next line (sectionDatesFit): one way for the whole section.
  if (dates) {
    const style = { color: t.colors.muted, size: pt(t.sizes.small) };
    children.push(inline ? new TextRun({ text: `\t${dates}`, ...style }) : new TextRun({ text: dates, break: 1, ...style }));
  }
  return new Paragraph({
    keepNext: true,
    spacing: { before: t.spacing.entryBefore, after: t.spacing.bullet },
    // At the text's right edge for the template's margins (TabStopPosition.MAX is the edge for 1-inch margins only).
    tabStops: [{ type: TabStopType.RIGHT, position: Math.round(pageWidth(t) * TWIPS) }],
    children,
  });
}

/** "Languages: Python, SQL" gets a bold label; anything else is plain text. */
function bulletRuns(text) {
  const m = text.match(LABELLED_RE);
  return m ? [new TextRun({ text: `${m[1]}: `, bold: true }), new TextRun(m[2])] : [new TextRun(text)];
}

/** A paragraph's text, its label (a skill category) in bold. */
function paragraphRuns(block) {
  if (!block.label) return [new TextRun(block.text)];
  return [new TextRun({ text: `${block.label}: `, bold: true }), new TextRun(block.text.slice(block.label.length + 2))];
}

/** The document for a parsed résumé in one template, fitted to its pages (fittedTemplate). Pure: nothing is written anywhere. */
export function buildResumeDocx(model, templateId) {
  const t = fittedTemplate(model, templateId);
  const children = [];

  if (model.name) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 40 },
        children: [new TextRun({ text: model.name, bold: true, font: t.fonts.heading, size: pt(t.sizes.name), color: t.colors.name })],
      })
    );
  }
  if (model.title) {
    children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: model.title, size: pt(t.sizes.title), color: t.colors.muted })] }));
  }
  if (model.contact.length) {
    children.push(
      new Paragraph({
        spacing: { after: t.spacing.paragraph },
        children: [new TextRun({ text: model.contact.join(t.header.separator), size: pt(t.sizes.small), color: t.colors.muted })],
      })
    );
  }

  for (const section of model.sections) {
    children.push(headingParagraph(section.heading, t));
    const inline = sectionDatesFit(section, t);
    for (const block of section.blocks) {
      if (block.type === 'entry') children.push(entryParagraph(block, t, inline));
      else if (block.type === 'bullets') {
        for (const item of block.items) children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: t.spacing.bullet }, children: bulletRuns(item) }));
      } else children.push(new Paragraph({ spacing: { after: t.spacing.paragraph }, children: paragraphRuns(block) }));
    }
  }
  if (children.length === 0) children.push(new Paragraph({ children: [new TextRun('')] }));

  const margin = convertInchesToTwip(t.margins);
  return new Document({
    creator: 'CodeMind Jobs',
    title: model.name ? `${model.name} — resume` : 'Resume',
    styles: {
      default: { document: { run: { font: t.fonts.body, size: pt(t.sizes.body), color: t.colors.text } } },
    },
    sections: [{ properties: { page: { margin: { top: margin, right: margin, bottom: margin, left: margin } } }, children }],
  });
}

/** A document model (formResumeModel, or parseTailoredResume for text) as .docx bytes in a template. */
export function renderResumeDocx({ model, template }) {
  return Packer.toBuffer(buildResumeDocx(model, template));
}

// ── cover letter ──────────────────────────────────────────────────────────────

/**
 * A cover letter as written: a blank line starts a paragraph, a single line break stays a line
 * break (an address block, "Best regards," over the name). Set in the body font, size and margins
 * of the résumé's template, so the two read as one application.
 */
export function buildCoverLetterDocx(text, templateId) {
  const t = resumeTemplate(templateId);
  const paragraphs = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((line) => line.trimEnd()))
    .filter((lines) => lines.some((line) => line.trim()));
  const children = paragraphs.map(
    (lines) =>
      new Paragraph({
        spacing: { after: Math.round(t.sizes.body * TWIPS) }, // one blank line between paragraphs
        children: lines.map((line, i) => new TextRun({ text: line, break: i ? 1 : 0 })),
      })
  );
  if (children.length === 0) children.push(new Paragraph({ children: [new TextRun('')] }));

  const margin = convertInchesToTwip(Math.max(t.margins, 1));
  return new Document({
    creator: 'CodeMind Jobs',
    title: 'Cover letter',
    styles: {
      default: { document: { run: { font: t.fonts.body, size: pt(t.sizes.body), color: t.colors.text } } },
    },
    sections: [{ properties: { page: { margin: { top: margin, right: margin, bottom: margin, left: margin } } }, children }],
  });
}

/** A cover letter's text as .docx bytes. */
export function renderCoverLetterDocx({ text, template }) {
  return Packer.toBuffer(buildCoverLetterDocx(text, template));
}
