import { hasKeyword } from '../text/keywords.js';
import { cleanListItem } from '../resume/structuredResume.js';
import { claimsClearance, claimsCredential, inventsFact } from './claims.js';
import { borrowedBullet, losesDetail } from './detail.js';
import { newStackTerms } from './stack.js';
import { estimateClause, overstatedEstimate, sameFigure, withoutEstimate } from './estimates.js';
import { crossesPlatform, gluedTerm, tooManyTerms } from './terms.js';
import { lower, overlap, RELATED, SAME_WORDING, sameWording, termsIn, unique } from './text.js';

// ── Experience bullets ─────────────────────────────────────────────────────
//
// Each bullet the model writes names the bullet it came from, so the code can say exactly what
// changed and refuse a bullet that came from nowhere.

/**
 * True when a rewrite says what the original said in all but a word or two and brings in
 * nothing the job asks for. Such a rewrite is noise: the original stands, and the user is not
 * asked to review it.
 */
function cosmetic(before, after, protectedKeywords) {
  const surfaced = protectedKeywords.some((k) => hasKeyword(after, k) && !hasKeyword(before, k));
  return sameWording(before, after) >= SAME_WORDING && !surfaced;
}

/**
 * True when a rewrite drops something the job asks for that the original bullet showed. A
 * rewrite is there to make evidence plainer, not to trade a bullet naming Python and PostgreSQL
 * for a vaguer one; when it does, the original stands.
 */
export const losesEvidence = (before, after, protectedKeywords) => protectedKeywords.some((k) => hasKeyword(before, k) && !hasKeyword(after, k));

/** The model's bullets for one role as [{ text, from, estimate }], whatever shape they arrived in. */
export function writtenBullets(achievements) {
  if (!Array.isArray(achievements)) return [];
  return achievements
    .map((a) =>
      a && typeof a === 'object'
        ? { text: cleanListItem(a.text), from: Number.isInteger(a.from) ? a.from : null, estimate: typeof a.estimate === 'string' ? a.estimate.trim() : '' }
        : { text: cleanListItem(a), from: null, estimate: '' }
    )
    .filter((b) => b.text);
}

/**
 * One role's bullets checked against their sources. A bullet that cites a source and still
 * reads like it is a rewrite; one that cites a source it has nothing in common with is put back
 * as that source said it, and so is one that states a figure the resume never gave; one with
 * no source stays only when it carries a keyword the user confirmed — or, up to `newBullets`
 * a role (the mode's allowance, style.js), whenever it states no figure. `limits` are the
 * mode's caps on assumed terms a line and a role may take (terms.js tooManyTerms). A rewrite
 * that drops a figure or a name its source stated is put back as well (detail.js), and a line
 * that repeats a bullet of another role (`elsewhere`, beyond the job's terms `jobText`) is
 * refused. Returns the bullets to keep and what changed, for the user to review.
 */
export function traceBullets(
  sourceBullets,
  written,
  { confirmed, assumed = [], blocked = [], sources, protectedKeywords = [], newBullets = 0, limits = {}, estimates = { left: 0, list: [] }, elsewhere = [], jobText = '', sourceText = '' }
) {
  const kept = [];
  const changes = [];
  const used = new Set();
  const borrowed = (text) => Boolean(borrowedBullet(text, { ownText: sourceBullets.join('\n'), elsewhere, jobText }));
  // A language, cloud or container platform the resume never names (stack.js), whoever offered it.
  const newStack = (text, before = '') => newStackTerms(text, { before, sourceText, confirmed: [...confirmed, ...assumed] }).length > 0;
  // The assumed terms the role's kept lines carry so far: a line that brings more than a line
  // may, or takes the role past its cap (terms.js), reads as the posting pasted in, and is
  // refused as a rewrite is (the source bullet stands). So is a line that is the source bullet
  // with a term glued on as one more item of its list ("…, Redis, and instant payment networks").
  const roleTerms = new Set();
  const tooDense = (text, before = '') => tooManyTerms(text, assumed, { before, roleTerms, ...limits }) || (before && gluedTerm(before, text, assumed));
  const noteTerms = (text) => termsIn(text, assumed).forEach((k) => roleTerms.add(k));
  // A figure on two bullets in a row reads as a pattern: an estimate waits for a bullet without one beside it.
  const previousHasFigure = () => kept.length > 0 && estimates.list.some((e) => e.text === kept[kept.length - 1]);
  const mentionsConfirmed = (text) => confirmed.some((k) => hasKeyword(text, k));
  // An assumed keyword may get a line of its own too. The figure check still applies to it, and
  // the user is shown every such line to keep or remove.
  const mentionsAdded = (text) => mentionsConfirmed(text) || assumed.some((k) => hasKeyword(text, k));
  // A line for a requirement that names no keyword ("mentored engineers") stands as well, as
  // many a role as the mode allows (one, looking real first; any number, for the score). It is
  // listed as added so it can be taken out on its own; the figure check and the facts still apply to it.
  // A keyword the user switched off is never written in, in any mode: a line from nowhere that
  // names one is an invention whatever else it says.
  let fresh = 0;
  const mayStand = (text) => !blocked.some((k) => hasKeyword(text, k)) && (mentionsAdded(text) || fresh < newBullets);
  const added = (text) => {
    if (tooDense(text) || borrowed(text) || newStack(text)) return;
    if (!mentionsAdded(text)) fresh += 1;
    kept.push(text);
    noteTerms(text);
    changes.push({ kind: 'added', before: '', after: text });
  };

  for (const answer of written) {
    // The bullet without its estimate is what is traced; the estimate is judged on its own below.
    // A clause with no figure in it is not an estimate ("…, using Spark"): the bullet is traced whole.
    const stripped = /\d/.test(answer.estimate) ? withoutEstimate(answer.text, answer.estimate) : null;
    // An overstated estimate is taken out: the bullet stands without it.
    const plain = stripped && !overstatedEstimate(answer.estimate) ? stripped : null;
    const bullet = { ...answer, text: stripped || answer.text };
    let from = bullet.from !== null && sourceBullets[bullet.from] !== undefined ? bullet.from : null;
    // No usable citation: the source is the bullet it most resembles, if it resembles any. A
    // bullet written for a confirmed keyword has no source by design, and is not looked for one.
    if (from === null && !mentionsAdded(bullet.text)) {
      const best = sourceBullets.map((s, i) => [overlap(s, bullet.text), i]).sort((a, b) => b[0] - a[0])[0];
      if (best && best[0] >= RELATED) from = best[1];
    }
    if (from === null) {
      // From nowhere: an invention, unless a keyword allows it — and never a credential or a clearance.
      if (!mayStand(bullet.text) || inventsFact(bullet.text, sources) || claimsCredential(bullet.text) || claimsClearance(bullet.text)) continue;
      added(bullet.text);
      continue;
    }
    const before = sourceBullets[from];
    // The same source cited twice: a copy of it beside its rewrite would say the line twice, so
    // the copy goes, whichever came first; and a second rewrite of one bullet says the same work
    // twice in other words (two resumes listed the same dashboards bullet, once with Redux Toolkit
    // and once with Context API), so the first rewrite stands and the second is dropped.
    if (used.has(from)) {
      if (lower(before) === lower(bullet.text)) continue;
      const copy = kept.indexOf(before);
      if (copy < 0) continue;
      kept.splice(copy, 1);
    }
    used.add(from);
    // An estimate stands on a bullet whose source stated no figure, when the rest of the bullet is
    // a faithful rewrite of it; the clause's figure is the only one the resume need not state.
    const estimateStands =
      plain &&
      estimates.left > 0 &&
      // The same figure twice in the resume ("reducing query time by ~15%" under two employers) reads as made up, which it is.
      ![...estimates.list, ...(estimates.taken || [])].some((e) => sameFigure(e.clause, answer.estimate)) &&
      !previousHasFigure() &&
      !/\d/.test(before) &&
      !inventsFact(plain, sources) &&
      !losesEvidence(before, plain, protectedKeywords) &&
      !losesDetail(before, plain) &&
      !borrowed(plain) &&
      !newStack(plain, before) &&
      !tooDense(plain, before) &&
      !crossesPlatform(before, plain, assumed) &&
      !claimsClearance(plain) &&
      (lower(before) === lower(plain) || overlap(before, plain) >= RELATED);
    if (estimateStands) {
      estimates.left -= 1;
      estimates.list.push({ text: answer.text, plain, clause: estimateClause(answer.estimate) });
      kept.push(answer.text);
      noteTerms(answer.text);
      changes.push({ kind: 'rewritten', before, after: answer.text });
      continue;
    }
    // A line about the same work that says less of it is a worse rewrite; one about other work
    // drops nothing, since the bullet it cites stays beside it (below).
    const resembles = overlap(before, bullet.text) >= RELATED;
    const saysLess = losesDetail(before, bullet.text);
    const rejected =
      inventsFact(bullet.text, sources) ||
      cosmetic(before, bullet.text, protectedKeywords) ||
      losesEvidence(before, bullet.text, protectedKeywords) ||
      (resembles && saysLess) ||
      borrowed(bullet.text) ||
      newStack(bullet.text, before) ||
      tooDense(bullet.text, before) ||
      crossesPlatform(before, bullet.text, assumed) ||
      claimsClearance(bullet.text);
    if (lower(before) === lower(bullet.text) || rejected) kept.push(before);
    else if ((resembles || mentionsAdded(bullet.text)) && !saysLess) {
      kept.push(bullet.text);
      noteTerms(bullet.text);
      changes.push({ kind: 'rewritten', before, after: bullet.text });
    } else {
      // Cites a bullet it does not resemble: keep what the resume said. Within the mode's
      // allowance the line stays as well, as one more thing said about the role rather than a
      // rewrite of this one.
      kept.push(before);
      if (mayStand(bullet.text) && !inventsFact(bullet.text, sources) && !claimsCredential(bullet.text)) added(bullet.text);
    }
  }

  // A role never loses all its bullets to a rewrite.
  if (!kept.length) return { bullets: sourceBullets, changes: [] };
  sourceBullets.forEach((before, i) => {
    if (used.has(i)) return;
    // Evidence for something the job asks for is not the model's to cut — unless it was merged
    // into a bullet that is still there, in which case putting it back would say it twice.
    const speaksToJob = protectedKeywords.some((k) => hasKeyword(before, k));
    const merged = kept.some((b) => overlap(before, b) >= 0.5);
    if (speaksToJob && !merged) {
      // It goes in after the last kept line that speaks to the job, not after the ones that do not:
      // the most relevant bullets stay first.
      let at = kept.length;
      for (let k = kept.length - 1; k >= 0; k -= 1) {
        if (protectedKeywords.some((p) => hasKeyword(kept[k], p))) {
          at = k + 1;
          break;
        }
      }
      kept.splice(at, 0, before);
    } else changes.push({ kind: 'removed', before, after: '' });
  });
  return { bullets: unique(kept), changes };
}
