# Scoring eval

A small labeled golden set for ATS scoring, and a runner that reports a **pass rate**.

The snapshot tests in `src/testing/` pin what the scorer *sends*: the prompt, the schema, the metering. A refactor that changes a prompt shows up as a diff. What they can't tell you is whether a score is *right*, only that it's well-formed. This adds the other half: does the score the pipeline produces land where a human reviewer agreed it should?

## Run it

```
node eval/scoreEval.js                  # offline: no API key needed
node eval/scoreEval.js --live           # real model; needs OPENAI_API_KEY
node eval/scoreEval.js --threshold=0.9  # exit non-zero if the pass rate drops below this
```

The process exits non-zero when the pass rate is under the threshold, so a prompt or model change can be gated in CI the same way a test is: "did this change make scoring better or worse?" as a number, not a guess.

## The two modes

- **Offline** (default, no key). For each case, a scripted model returns the verdicts a correct model *should* give (the human label at the model-output level), and the real pipeline turns them into a score. This checks the pipeline deterministically: do correct verdicts become the expected score, keywords and requirement outcomes? It runs in CI with no key and no spend.
- **Live** (`--live`). The real ATS model scores each case. The pass rate is how often it agrees with the human labels. This is the part a snapshot can't catch: quality, not just shape. `prompt_injection_resilience` is the clearest example, offline it only confirms the pipeline stays honest when the verdicts are honest; live, it tests whether the model and the prompt fences actually refuse a job description that orders a score of 100.

## Add a case

Append to `CASES` in `cases.js`:

```js
{
  name: 'short_slug',
  note: 'why this case exists',
  resume, job,                 // same shapes as examples/sample.js (job needs its requirements[])
  expect: {
    scoreMin: 40, scoreMax: 70,          // the agreed band
    missingKeywords: ['Spark'],          // must appear in topMissingKeywords
    verdicts: { 1: 'missing' },          // optional: requirement index -> expected verdict
    maxScore: 60,                        // optional hard ceiling
  },
  ideal: { verdicts: [...], matchedKeywords: [...], topMissingKeywords: [...], tailoringOpportunities: [] },
}
```

Keep the set small and sharp: a handful of pairs that each pin a real behaviour (a strong fit, a partial fit, a wrong-field reject, an adversarial posting) is worth more than a large unlabeled one. Grow it when a real scoring mistake shows up in production, so the mistake can only happen once.
