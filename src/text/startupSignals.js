// What a posting's text says about the company's funding, as patterns with no other dependency:
// the startup badge (startups.js) and enrichment's checks (enrich/validate.js) both read them.

/** A billion-dollar valuation ("valued at over $1 billion", "unicorn"): past what the badge means. */
export const BILLION_VALUATION = /\bunicorn\b|\bvalu(?:ed|ation) (?:at |of )?(?:over |more than |nearly |almost |about )?[$€£]?\s?\d+(?:\.\d+)?\s?(?:billion|bn|b)\b/i;

/** A recruiter describing the company it hires for: the funding is the client's, not the poster's. */
export const FOR_A_CLIENT = /\bour client\b|\bon behalf of (?:our|a|an) client\b|\bclient of ours\b/i;

/**
 * Venture funding as a company states it without naming its round: "venture-backed", "VC-funded",
 * "backed by Sequoia Capital" (a firm: Ventures, Capital, Partners, an accelerator, Y Combinator or
 * a famous name), "raised $12M", "our seed round", "a funding round", "YC W24". Not "investors",
 * "backed by" or "funded by" on their own: a bank is "backed by the strength of our investors",
 * a public company is "funded by" its revenue, and both were read as venture-backed startups.
 * Case matters where a name does: "backed by Bessemer Venture Partners", not "backed by our
 * partners".
 */
export const VENTURE_BACKED =
  /\b(?:[Vv]enture|VC|vc)[-\s](?:backed|funded|financed)\b|\b[Vv]enture[-\s][Cc]apital\b|\b(?:[Bb]acked|[Ff]unded|[Ff]inanced)\s+by\b[^.\n]{0,80}?(?:\b[A-Z][\w&.'-]*\s+(?:Ventures?|Capital|Partners)\b|\b(?:[Aa]ccelerator|[Aa]ngel [Ii]nvestors|Y ?Combinator|a16z|Sequoia|Andreessen|Accel|Benchmark|Greylock|Kleiner|Lightspeed|Tiger Global|Index|Bessemer|Founders Fund|Techstars)\b)|\b(?:[Rr]aised|[Cc]losed|[Ss]ecured)\s+(?:an?\s+|our\s+|over\s+|more than\s+|nearly\s+|a total of\s+)?(?:[$€£]\s?\d[\d.,]*\s*(?:million|billion|thousand|[MmBb]n?|[Kk])?|\d[\d.,]*\s*(?:million|billion|[MmBb]n?|[Kk]))\b|\b[Ff]unding [Rr]ound\b|\b[Ss]eed[-\s](?:[Rr]ound|[Ss]tage|[Ff]unded|[Ff]unding)\b|\b[Ss]eries\s+[A-C]\b(?![-\w])|\bYC\s?[SWFX]\d{2}\b|\bY ?Combinator\b/;
