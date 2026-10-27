// What counts in a job's field, for the tailoring prompts (tailor/prompts/, tailor/gap.js): the figures that mean
// something there, with their units, so an estimated figure is one of them and not a guess; the
// duties a resume in the field is expected to show, so the gap pass writes a line for cost or
// on-call rather than skipping them; the field's terms for everyday work, so a bullet is
// translated rather than pasted; and the claims not to make without evidence. Keyed by the job's
// category (jobs/titles/category.js) with a line more for its enrichment subcategory; a job with
// no category, or one the notes do not know, gets the general note. Prompt text, so it is
// versioned with the prompt and not set in Admin.

const NOTES = {
  devops: {
    label: 'DevOps / SRE',
    measures: 'deployment frequency, lead time for changes, change failure rate, mean time to recovery, SLO attainment, error-budget burn, p95 latency, availability, cloud spend, time to provision',
    duties: 'on-call and incident response with postmortem actions, infrastructure as code and its share of the estate, CI/CD pipeline ownership, monitoring and alerting against targets, capacity and autoscaling, cost control, backup and recovery',
    terms: '"deploys" → "CI/CD pipeline"; "set up servers" → "provisioned infrastructure as code"; "fixed production bugs" → "incident response and postmortems"; "monitoring" → "observability: metrics, logs, traces"; "scripts" → "automation"',
    avoid: 'certifications (CKA, AWS Solutions Architect), cluster, node or region counts, "at scale" without a figure, a cloud the resume never names',
    sub: {
      cloud_infrastructure: 'cloud infrastructure roles in particular: networking (VPCs, load balancers), IAM and secrets, Terraform modules, multi-account or multi-region setups.',
      sre: 'site reliability roles in particular: SLOs and error budgets, on-call rotation and incident command, toil reduction, capacity planning, reliability reviews.',
      platform: 'platform roles in particular: internal developer platform, golden paths and templates, developer self-service, adoption by other teams.',
      build_release: 'build and release roles in particular: build times, release trains and cadence, artifact and dependency management, flaky-build rate.',
    },
  },
  backend: {
    label: 'Backend',
    measures: 'p95/p99 latency, requests per second, error rate, uptime, queue lag, database query time, cost per request, time to ship a feature',
    duties: 'API design and versioning, data modelling, caching and async processing, testing and code review, on-call for the services owned, performance work, migrations',
    terms: '"made it faster" → "cut p95 latency"; "handles a lot of traffic" → "requests per second"; "background job" → "asynchronous processing"; "wrote endpoints" → "designed and owned APIs"',
    avoid: 'user or request counts the resume never states, a database or language it never names, "microservices" for a monolith',
    sub: {
      api_services: 'API and services roles in particular: contract design, authentication, rate limiting, versioning, client SDKs.',
      distributed_systems: 'distributed systems roles in particular: consistency and partitioning, message queues and streams, idempotency, fault tolerance, backpressure.',
      enterprise_platforms: 'enterprise platform roles in particular: integrations with ERP/CRM, batch processing, compliance and audit trails, multi-tenant configuration.',
      integrations: 'integration roles in particular: third-party APIs, webhooks, data mapping, retries and reconciliation, partner onboarding.',
      databases_storage: 'database and storage roles in particular: schema design, indexing and query plans, replication and backups, migrations without downtime.',
    },
  },
  frontend: {
    label: 'Frontend',
    measures: 'Largest Contentful Paint, Time to Interactive, bundle size, Lighthouse score, client error rate, conversion or completion rate, accessibility issues fixed, build time',
    duties: 'component and design-system work, state management, accessibility, performance budgets, cross-browser and responsive layouts, testing (unit, integration, visual), working with design',
    terms: '"made pages faster" → "cut LCP"; "reusable parts" → "component library"; "worked with designers" → "implemented designs from Figma"; "mobile friendly" → "responsive"',
    avoid: 'traffic or user figures the resume never states, a framework it never names, "pixel-perfect" without the design tool named',
    sub: { web_ui: 'web UI roles in particular: design systems, accessibility (WCAG), rendering strategy (SSR, SSG), analytics instrumentation.' },
  },
  fullstack: {
    label: 'Full Stack',
    measures: 'feature lead time, release cadence, p95 latency, error rate, conversion or activation rate, test coverage, uptime',
    duties: 'owning features end to end from UI to API to data, deployment and monitoring of what was shipped, testing at every layer, working with product and design',
    terms: '"did everything" → "owned the feature from UI through API and data"; "shipped often" → "release cadence"; "kept it running" → "monitored and supported in production"',
    avoid: 'claiming depth in a layer the resume never shows, user counts it never states',
    sub: { product_fullstack: 'product-facing roles in particular: experimentation (A/B tests), analytics events, onboarding and activation flows, iteration with product.' },
  },
  data: {
    label: 'Data Engineering',
    measures: 'pipeline runtime, data freshness or latency, rows or TB processed, data-quality incidents, failed-run rate, cost per TB or per run, query time, time to deliver a dataset',
    duties: 'pipeline design and orchestration, data modelling and warehousing, data quality checks and monitoring, backfills and migrations, cost control, serving analysts and ML',
    terms: '"moved data" → "built ELT/ETL pipelines"; "cleaned data" → "data quality checks"; "scheduled jobs" → "orchestrated with (the tool named)"; "big tables" → "TB-scale"',
    avoid: 'data volumes the resume never states, a warehouse or orchestrator it never names, "real-time" for batch work',
    sub: {
      data_pipelines: 'pipeline roles in particular: orchestration (DAGs), incremental loads, idempotent backfills, schema evolution, SLAs on freshness.',
      analytics_engineering: 'analytics engineering roles in particular: dbt-style modelling, metrics layers, tests on models, documentation, BI enablement.',
      data_platform: 'data platform roles in particular: lakehouse or warehouse architecture, access control and governance, cost allocation, platform adoption.',
    },
  },
  ml_ai: {
    label: 'ML / AI',
    measures: 'model metric lift (AUC, F1, precision/recall, RMSE), offline-to-online gap, inference latency, throughput, training time and cost, token cost, evaluation-set scores, drift incidents',
    duties: 'problem framing and data preparation, training and evaluation with a held-out set, serving and monitoring in production, experiment tracking, iteration with product on quality, latency and cost',
    terms: '"used AI" → the method named (fine-tuning, RAG, embeddings); "made the model better" → "lifted (metric) by"; "put it live" → "served in production with monitoring"',
    avoid: 'papers, benchmarks or model names the resume never cites, metric figures it never states, "state of the art"',
    sub: {
      llm_applications: 'LLM application roles in particular: prompt and retrieval design, evaluation harnesses, guardrails, token cost and latency, tool calling.',
      ml_infrastructure: 'ML infrastructure roles in particular: feature stores, training pipelines, model registry and serving, GPU utilisation, reproducibility.',
      ml_modeling: 'modelling roles in particular: feature engineering, validation strategy, error analysis, calibration, offline evaluation design.',
    },
  },
  qa: {
    label: 'QA / Test',
    measures: 'test coverage, automated test count and runtime, flaky-test rate, escaped defects, defects found per release, regression cycle time, release confidence',
    duties: 'test strategy and planning, automation frameworks, CI integration, regression suites, exploratory testing, defect triage with developers, release sign-off',
    terms: '"tested features" → "designed test plans and automated regression"; "found bugs" → "defects found before release"; "ran tests" → "regression suite in CI"',
    avoid: 'a framework or tool the resume never names, coverage figures it never states',
    sub: {
      test_automation: 'automation roles in particular: framework design, parallel runs, test data management, CI gating, flake reduction.',
      manual_qa: 'manual QA roles in particular: test case design, exploratory sessions, acceptance criteria, device and browser matrices, defect reports.',
    },
  },
  security: {
    label: 'Security',
    measures: 'vulnerabilities found and closed, time to remediate by severity, audit findings, phishing or incident rates, coverage of controls, false-positive rate',
    duties: 'threat modelling and code review, vulnerability management, incident response, identity and access controls, compliance evidence, secure-by-default tooling for engineers',
    terms: '"checked for security holes" → "vulnerability assessment and remediation"; "handled a breach" → "incident response"; "set permissions" → "least-privilege access controls"',
    avoid: 'certifications (CISSP, OSCP) or frameworks (SOC 2, ISO 27001) the resume never names, incident counts it never states',
    sub: {
      application_security: 'application security roles in particular: SAST/DAST, dependency scanning, secure code review, developer training, security champions.',
      security_operations: 'security operations roles in particular: detection rules, SIEM, alert triage, incident playbooks, mean time to detect and respond.',
      cloud_security: 'cloud security roles in particular: IAM policies, network controls, posture management, secrets, policy as code.',
      identity_access: 'identity roles in particular: SSO and MFA, role design, provisioning and deprovisioning, access reviews.',
    },
  },
  mobile: {
    label: 'Mobile',
    measures: 'crash-free rate, app start time, app size, frame drops, store rating, release cadence, adoption of a feature, installs',
    duties: 'feature work across UI and networking, offline and sync behaviour, performance and battery, release and store submission, crash and analytics monitoring, device and OS-version testing',
    terms: '"made the app smoother" → "cut frame drops / start time"; "released versions" → "shipped releases to the store on a cadence"; "handled no network" → "offline-first sync"',
    avoid: 'install or rating figures the resume never states, a platform it never names',
    sub: {
      ios: 'iOS roles in particular: Swift/SwiftUI/UIKit, App Store review, TestFlight, background modes, push notifications.',
      android: 'Android roles in particular: Kotlin, Jetpack, Play Console, device fragmentation, background work limits.',
      cross_platform: 'cross-platform roles in particular: shared code share, native bridges, platform parity, build pipelines for both stores.',
    },
  },
  embedded: {
    label: 'Embedded',
    measures: 'boot time, memory and flash footprint, power draw, interrupt latency, throughput on the bus, field failure rate, test coverage on hardware, time to bring up a board',
    duties: 'bring-up of boards and peripherals, driver and firmware work, real-time constraints, debugging with hardware tools, over-the-air updates, safety or certification evidence',
    terms: '"got the hardware working" → "board bring-up and driver development"; "made it use less power" → "cut power draw"; "updated devices" → "over-the-air updates"',
    avoid: 'standards (ISO 26262, IEC 62304) or chips the resume never names, unit counts shipped it never states',
    sub: {
      firmware: 'firmware roles in particular: RTOS, bare-metal drivers, bootloaders, peripheral protocols (SPI, I2C, CAN), memory constraints.',
      embedded_linux: 'embedded Linux roles in particular: Yocto/Buildroot, kernel configuration and drivers, device trees, boot time, secure boot.',
    },
  },
};

const GENERAL = {
  label: 'Software engineering',
  measures: 'p95 latency, error rate, uptime, release cadence or lead time, incidents, test coverage, time saved, cost saved, adoption or completion rate',
  duties: 'designing and shipping features, testing and code review, deployment and monitoring of what was shipped, supporting it in production, working with product and other engineers',
  terms: '"made it faster" → "cut p95 latency"; "fixed production bugs" → "incident response"; "deploys" → "CI/CD pipeline"; "worked with the team" → the teams named and what was delivered',
  avoid: 'figures, tools, certifications or customers the resume never states',
  sub: {},
};

/** The note for a job's field as a prompt section, by its category and subcategory; the general note for the rest. */
export function fieldNotesFor(job) {
  const note = NOTES[String(job?.category || '').trim()] || GENERAL;
  const sub = note.sub[String(job?.subcategory || '').trim()];
  return [
    `FIELD_NOTES (${note.label}):`,
    `- Measures that count here, with their units: ${note.measures}. An estimated figure is one of these.`,
    `- Duties a resume in this field is expected to show: ${note.duties}.`,
    `- Say it in the field's terms: ${note.terms}.`,
    `- Not without evidence in RESUME: ${note.avoid}.`,
    sub ? `- In ${sub}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The categories the notes know, for tests and the admin view. */
export const FIELD_NOTE_CATEGORIES = Object.keys(NOTES);
