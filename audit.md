CodeMind AI audit and improvement
Architecture
This repository is @codemind/ai, an ESM JavaScript package for Node >=22, with JSDoc public types. It contains no frontend, HTTP server, database, vector store, embeddings, or RAG pipeline. The surrounding application supplies configuration through createCodemind() (src/index.js, src/runtime.js).

Inputs enter feature functions for ATS scoring, tailoring, writing, resume parsing, and job enrichment. Features build prompts and response schemas, call src/llm/complete.js, then interpret or validate answers. Model prefixes route requests to OpenAI, Alibaba Model Studio (Qwen), or Ollama (gpt-oss), using the OpenAI SDK's chat completions protocol. Clients have provider timeouts and disable SDK retries; complete() bounds transient retries to three attempts. Feature fallbacks and enrichment feedback retries are separate. Usage and logging are injected callbacks; the package reads no environment variables itself. Batch enrichment uses the OpenAI Batch API.

ATS skill matches and weighted scores are computed in code. Requirement verdicts use model quotes checked against resume text, tenure caps, and source-versus-tailored evidence stabilization. Tailoring applies factual checks and repair/gap passes. Enrichment uses Zod and posting evidence checks. Tests use Node's test runner and fake LLM clients; prompt snapshots pin requests. ESLint is configured. jsconfig.json disables checkJs; there is no type-check script or TypeScript dependency.

Prioritized findings
Selected: unsupported ATS evidence earns partial credit. In src/ats/verdicts.js, checkedVerdicts() lowers an ungrounded met to weak. VERDICT_POINTS.weak is 0.5, and src/ats/breakdown.js uses that directly. The existing test explicitly expects this result for an invented payments quote. High confidence, direct score and tailoring impact, very small implementation risk.
Malformed output is incompletely checked at the shared boundary. src/llm/complete.js parses JSON but does not enforce response schemas. src/llm/request.js explicitly documents that Ollama does not enforce them. For example, src/ats/interpret.js calls .filter() on a truthy matchedKeywords value without checking that it is an array. This can cause a runtime error and a fallback call. A broader validation change requires careful compatibility review of existing cleanup behavior.
Unusable responses lose usage accounting. complete() extracts tokens inside its try block, but records failures outside it without those tokens. Empty or malformed responses therefore produce a failure event with zero cost even when the provider reported billable usage. High confidence; defer to keep this change focused on scoring accuracy.
Provider error logging can include upstream text. complete() records raw exception messages and logs the exception object; routing.js logs exception messages. These paths do not sanitize echoed user content. No actual secret disclosure was observed; the finding is the unsanitized path, not a proven leak.
Proposed change (recorded before implementation)
Problem: fabricated, empty, or invalid evidence can earn half of a requirement's score and appear as weak evidence to downstream tailoring.
Affected functions: checkedVerdicts() in src/ats/verdicts.js, scoreVersion() in src/ats/service.js, and ATS regression tests.
Root cause: a one-level downgrade treats unverifiable evidence as grounded partial evidence.
Solution: classify every non-missing verdict with an unverified quote as missing, using the existing quote matcher. The existing return path clears missing quotes. Add a grounding revision to scoreVersion() to invalidate previous cached scoring behavior while leaving prompt versions and instruction text unchanged. Downstream gap prompts receive the corrected verdicts.
Expected benefit: no requirement points from evidence absent from the resume. Grounded weak, skills-only evidence, normalized quotes, tenure caps, and stable prior evidence retain their existing behavior.
Trade-offs: a model paraphrase that fails the existing quote matcher now earns zero rather than half credit. Scores can decrease, and cache invalidation depends on the host respecting scoreVersion(). This checks quote presence, not whether a real quote semantically proves a requirement. No new model calls, providers, dependencies, or prompt changes are planned.
Implemented changes
File	Purpose
src/ats/verdicts.js	Reject unsupported evidence instead of granting half credit; remove the unused downgrade map and update the function documentation.
src/ats/service.js	Append /grounding.v2 to the score cache version. Public function parameters and result shapes are unchanged.
src/ats/score.test.js	Correct the existing fabricated-evidence expectation and verify the quote is cleared. The existing test remains in place.
src/ats/grounding.test.js	Add 19 deterministic tests for unsupported and malformed quotes, normalized valid evidence, partial credit, malformed verdict lists, empty resume text, prior evidence, the public scorer, and cache versioning.
src/testing/snapshots/pipeline.txt	Update three outcome scores and eleven downstream gap verdict lines. The scripted model quotes a source sentence that the rewrite removed; it previously earned partial credit. Prompt instruction text, schemas, model settings, call count, and generated resume bullets remain unchanged.
audi.md	Record architecture, findings, the preimplementation proposal, evidence, checks, and a proposed PR description.
Validation and measurements
All commands below ran from this repository unless another directory is specified. Logs were written outside the repository in /private/tmp. No paid or live LLM requests were made.

Exact validation command	Result
node --version / npm --version	Initial sandbox runtime: Node v24.16.0, npm 11.13.0.
npm ci --ignore-scripts --no-audit --no-fund	Failed: npm's exit handler was not called and its default cache/log directory was not writable. Dependencies were left partially installed.
npm test > /private/tmp/codemind-baseline-test.log 2>&1	Initial baseline attempt during incomplete installation: 284 passed, 3 test files failed to load missing dependencies. This is not a valid complete baseline.
node --test src/ats/score.test.js	Original ATS tests: 14/14 passed.
node --test src/ats/grounding.test.js > /private/tmp/codemind-grounding-before.log 2>&1	New regressions against original implementation: 8 passed, 11 failed, reproducing the issue and the old cache version.
node --test src/ats/*.test.js > /private/tmp/codemind-ats-after.log 2>&1	After the fix: 33/33 passed.
npm ci --ignore-scripts --no-audit --no-fund --cache /private/tmp/codemind-npm-cache	Successful retry with sandbox escalation: 171 packages installed from the existing lockfile. Dependency deprecation warnings were emitted.
npm test > /private/tmp/codemind-baseline-complete.log 2>&1	In /private/tmp/codemind-audit-baseline, a temporary copy with changed tracked files restored from git show HEAD:<path> and new files excluded: original suite 302/302 passed. Installed dependencies were shared by symlink. The working checkout was not reset.
npm test > /private/tmp/codemind-final-test.log 2>&1	First complete run and the retry after changing only outcome scores: 320 passed, 1 pipeline snapshot failed. The remaining diff was corrected downstream gap verdicts. After reviewing the complete snapshot update: 321/321 passed.
UPDATE_SNAPSHOTS=1 node --test --test-name-pattern='the tailoring pipeline' src/testing/prompts.test.js > /private/tmp/codemind-pipeline-update.log 2>&1	Regenerated only the affected pipeline snapshot, then reviewed all 14 changed lines: three scores and eleven gap verdicts. The selected test passed.
npm run lint > /private/tmp/codemind-final-lint.log 2>&1	Passed, exit 0, no lint warnings or errors.
node examples/offline.js > /private/tmp/codemind-final-offline.log 2>&1	Passed, exit 0; example score 50/100, one fake model request, metered usage.
node --test src/ats/grounding.test.js > /private/tmp/codemind-grounding-after.log 2>&1	Final targeted evaluation: 19/19 passed.
git diff --check	Passed.
git diff -- package.json package-lock.json	Empty; dependencies and lockfile unchanged.
git diff, git diff --stat, git diff --numstat, git status --short	Reviewed tracked changes and separately reviewed the two new files. Only the six files listed above are changed/added.
There is no repository type-check script. jsconfig.json has checkJs: false; no TypeScript type-check success is claimed. No new retries, timeouts, or API error paths were introduced, so new tests focus on evidence rejection and scoring compatibility rather than unrelated provider failures.

Deterministic evaluation dataset
The inputs and expected properties are encoded in src/ats/grounding.test.js. Scores below use one responsibility requirement and no other scored categories, so its category score is the entire score. They are synthetic examples, not aggregate production measurements.

Input	Original score	Fixed score	Expected property
met with invented payments quote	50	0	No points for fabricated evidence.
met with empty, whitespace-only, punctuation-only, null, numeric, or object quote (six cases)	50 each	0 each	Invalid evidence cannot create partial credit.
weak with those seven unverified quotes	0 each	0 each	Existing rejection remains intact.
Grounded met with normalized case, spacing, punctuation	100	100	Valid evidence retains full credit.
Grounded weak	50	50	Real partial evidence retains partial credit.
missing	0	0	Missing remains missing.
The public scorer's fabricated-evidence case completes with one fake model request and one successful usage event. The model API succeeded; the result is correctly grounded as missing. The fix adds no model requests. The complete original suite passed 302 tests; the final suite passed 321. No latency, token savings, live model accuracy, or production regression rate was measured.

Remaining risks and next work
Verbatim grounding cannot determine whether an authentic quote actually proves a requirement. Semantic mismatches remain possible.
Legitimate paraphrases rejected by the existing matcher now receive zero credit. This is deliberate: the prompt explicitly requires copied evidence. A future quality evaluation should examine real anonymized model answers for false negatives.
Host applications must treat scoreVersion() as an opaque version and recompute stale scores. Consumers parsing its previous two-segment format need review; no host application is present here. Persisted tailoring/scoring records outside this package are not migrated.
Retained grounded prior evidence can still preserve a prior score when a current model quote fails. This existing stabilization behavior is tested and unchanged.
The most valuable next changes are runtime validation of malformed ATS output and preservation of billable token usage on unusable model responses. Logging sanitization also deserves a focused follow-up. These were documented, not implemented.
Final review found no added secrets, local configuration, dependencies, lockfile changes, temporary debugging code, or broad refactoring. No commit, push, or PR was created.
Proposed PR
Title: Prevent unsupported resume evidence from earning ATS score credit

Problem: ATS scoring previously downgraded an invented or empty quote from met to weak, granting 50% of a requirement's points and exposing unsupported experience as weak evidence to tailoring.

Solution: Mark unverified requirement evidence as missing and clear its quote, while retaining grounded partial credit and prior evidence stabilization. Revise the score cache version to recompute old results. Update pipeline score and downstream gap verdict expectations without changing prompt instructions or model settings.

Tests: Original baseline 302/302; final suite 321/321; new regressions 19/19; ESLint and the offline example passed. Synthetic fabricated-evidence score changed from 50 to 0. No live API evaluation or TypeScript check was performed.

Impact: Scores decrease only where the prior checks allowed unverified evidence to contribute credit. Public signatures and result shapes are preserved; existing cache versions intentionally change. No additional model calls or dependencies.