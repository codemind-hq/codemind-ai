// How far tailoring goes for the score. The user picks (client lib/tailorStyle.js), and a
// request that names no style gets the balanced one. The three run the same pipeline — a
// rewrite steered by the scorer's verdicts, new terms and new bullets allowed, then gap passes
// until the score reaches the mode's target — and differ in how far they lean towards the
// score or towards a line a reader would believe:
//   ats        the score first: aims above 95, writes in what an open verdict needs whether or
//              not the resume's work makes it plausible, within the widest caps.
//   balanced   the default: aims above 90, writes in what the resume's own stack makes
//              plausible and leaves the rest open.
//   realistic  looks real first: aims above 80, writes in only a term the resume's own lines
//              nearly name already, one new bullet a role at most.
// None invents an employer, a title, a date, a degree or a figure, and everything any of them
// adds is listed for the user to remove.
// A fourth mode is never picked: 'generate' is "Write a new resume for this job" (jobRoutes
// generate, Smart Apply's generate task). It writes the resume afresh for the job rather than
// editing the old one's lines, aims above 90 in lines a reader believes, and reaches as far as
// the score-first mode for a term the resume's field makes plausible without forcing in the rest.
export const TAILOR_STYLES = ['ats', 'balanced', 'realistic'];
export const GENERATE_STYLE = 'generate';
export const DEFAULT_TAILOR_STYLE = 'balanced';
export const tailorStyle = (value) => (TAILOR_STYLES.includes(value) || value === GENERATE_STYLE ? value : DEFAULT_TAILOR_STYLE);

/**
 * The knobs of each mode. `target` is the score the gap passes stop at and `gapPasses` how many
 * at most, `flatPasses` how many passes that do not raise the score are tolerated before the
 * passes stop; `maxAssumedTerms`, `maxTermsPerLine` and `maxTermsPerRole` cap what is written in
 * on assumption (terms.js); `maxEstimates` the estimated figures (estimates.js);
 * `newBulletsPerRole` the lines from no source bullet a role may gain (bullets.js);
 * `forceAssumed` whether an open verdict is written in without the resume's work making it
 * plausible; `preferredGaps` whether a nice-to-have counts as a gap to write for; and
 * `summarySentences` the summary's length (prompt.js, repair.js).
 */
export const TAILOR_MODES = {
  ats: {
    target: 95,
    gapPasses: 4,
    flatPasses: 1,
    maxAssumedTerms: 12,
    maxTermsPerLine: 3,
    maxTermsPerRole: 10,
    maxEstimates: 6,
    newBulletsPerRole: Infinity,
    forceAssumed: true,
    preferredGaps: true,
    summarySentences: [4, 5],
  },
  balanced: {
    target: 90,
    gapPasses: 3,
    flatPasses: 1,
    maxAssumedTerms: 8,
    maxTermsPerLine: 2,
    maxTermsPerRole: 8,
    maxEstimates: 5,
    newBulletsPerRole: Infinity,
    forceAssumed: false,
    preferredGaps: false,
    summarySentences: [3, 4],
  },
  realistic: {
    target: 80,
    gapPasses: 2,
    flatPasses: 0,
    maxAssumedTerms: 4,
    maxTermsPerLine: 1,
    maxTermsPerRole: 4,
    maxEstimates: 4,
    newBulletsPerRole: 1,
    forceAssumed: false,
    preferredGaps: false,
    summarySentences: [3, 4],
  },
  generate: {
    target: 90,
    gapPasses: 3,
    flatPasses: 1,
    maxAssumedTerms: 10,
    maxTermsPerLine: 2,
    maxTermsPerRole: 8,
    maxEstimates: 5,
    newBulletsPerRole: Infinity,
    forceAssumed: false,
    preferredGaps: false,
    summarySentences: [3, 4],
  },
};
export const tailorMode = (style) => TAILOR_MODES[tailorStyle(style)];

/**
 * What makes a term the resume lacks plausible to write in, in each mode's words: the bar the
 * tailoring prompt and the gap pass hold an assumed term to (prompt.js keywordRules, gap.js).
 */
export const PLAUSIBLE_BY_STYLE = {
  ats: 'Plausible means a tool anyone doing the work the resume describes, in its field, could have used: a tool inside a stack RESUME shows, or the standard tool of a kind of work a bullet describes, even when RESUME names none of that kind. Only a programming language, framework family, cloud or field RESUME shows no sign of is left out (Java and Spring for a Python and Node.js engineer; Go; Google Cloud for someone who only names AWS): adding those would be inventing a career.',
  balanced:
    'Plausible means a tool that lives inside a stack RESUME already shows — Express for someone building Node.js backends; Jest or Cypress for someone shipping React; Apollo Server for someone working with GraphQL and Node.js; an ORM or query builder for someone writing Node.js services on PostgreSQL; Kubernetes for someone who containerizes and deploys services with Docker on a cloud. When the job offers alternatives ("an ORM such as Prisma, TypeORM or Knex"), add one, at most two: nobody lists them all.\nLeave out what belongs to a programming language, framework family, cloud or field RESUME shows no sign of (Java and Spring for a Python and Node.js engineer; Go; Google Cloud for someone who only names AWS): adding those would be inventing a career.',
  generate:
    'Plausible means a tool anyone doing the work the resume describes, in its field, could have used: a tool inside a stack RESUME shows, or the standard tool of a kind of work a bullet describes, even when RESUME names none of that kind. When the job offers alternatives ("an ORM such as Prisma, TypeORM or Knex"), add one, at most two: nobody lists them all.\nLeave out what belongs to a programming language, framework family, cloud or field RESUME shows no sign of (Java and Spring for a Python and Node.js engineer; Go; Google Cloud for someone who only names AWS): adding those would be inventing a career.',
  realistic:
    "Plausible means a term one of RESUME's own bullets nearly names already: the thing a bullet describes doing under another name (\"REST APIs\" for a bullet about building HTTP endpoints; \"CI/CD\" for one about automating deploys), or the one standard tool of exactly the work a bullet describes (Docker for a bullet that containerizes a service). A tool that merely belongs to the same stack is not enough here: when no bullet comes that close, leave the term out and name it in suggestions instead.\nLeave out anything of a programming language, framework family, cloud or field RESUME shows no sign of.",
};
