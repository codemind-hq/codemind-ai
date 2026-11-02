import { repairMojibake } from '../text/mojibake.js';
import { jobPostingBlock } from '../text/fence.js';
import { PROMPT_VERSIONS } from '../promptVersions.js';

// The instructions for reading one job posting. Bump PROMPT_VERSIONS.jobEnrich whenever the text
// changes: it is recorded on every usage event and on every enriched job.

export const PROMPT_VERSION = PROMPT_VERSIONS.jobEnrich;

// Long enough for nearly every posting; the tail of the longest ones is benefits and EEO text.
export const MAX_DESCRIPTION_CHARS = 12000;

export const SYSTEM_PROMPT = `You extract factual information from exactly one job posting.

GENERAL RULES

- Use only information explicitly stated in the posting.
- Never guess or use outside knowledge.
- Do not infer facts from the company, title, location, or industry unless the rules below explicitly allow it.
- When information is not stated:
  - use null for nullable fields
  - use [] for list fields
  - use "unknown" only for fields whose schema allows "unknown"
- Evidence must be an exact quote copied from the posting.
- Never paraphrase evidence.
- Evidence must be at most 200 characters.
- Two separate passages may be joined with "...".

CATEGORY

Choose the primary category based on the substantial engineering work in the role.

mobile:
iOS, Android, Flutter, React Native, or other mobile application development.

frontend:
Substantial browser UI/frontend application development.

backend:
Server-side services, APIs, databases, distributed systems, or backend applications.

fullstack:
Substantial frontend AND backend engineering work.

devops:
Infrastructure, SRE, platform engineering, cloud infrastructure, CI/CD, deployment, observability, or reliability.

data:
Data engineering, ETL/ELT, data pipelines, warehouses, or analytics engineering.

ml_ai:
Machine learning, AI, LLM, model training, inference, evaluation, or substantial AI engineering.

qa:
Testing, QA automation, SDET, or test infrastructure.

security:
Security engineering.

embedded:
Embedded systems or firmware.

software:
Software engineering role that cannot be narrowed to a more specific category.

other:
Not a software engineering role.

When the job title names the specialty (for example Machine Learning Engineer, QA Engineer, SDET, Test Automation, Full Stack Developer, Data Engineer, DevOps Engineer, SRE), use that category unless the description clearly shows different work.

IT support, help desk, and service desk roles are other.

Engineering that is not software engineering is other, even when the posting mentions programming, scripts or software tools: mechanical, electrical, civil, structural, chemical, process, instrumentation, controls, hydraulic, reservoir, petroleum, mining, HVAC, manufacturing, quality (non-software), field service, facilities, systems engineering in aerospace or defense, mission assurance, hardware, chip, ASIC, RTL, FPGA board or analog design, and product development of physical goods. A role is software only when writing, operating or testing software is the substance of the work.

Do not classify a role as ml_ai merely because it integrates an AI API.

SUBCATEGORY

Choose the one subcategory that best describes the main work of the role, from the list for the chosen primary category or from the any-category list. Use null when none clearly fits.

mobile: ios, android, cross_platform (Flutter, React Native)
frontend: web_ui (web application UI), design_system (shared UI components)
backend: api_services (APIs and services), distributed_systems (large-scale, high-throughput systems), databases_storage (database or storage engines), integrations (connecting third-party systems)
fullstack: product_fullstack
devops: sre (reliability, incidents, observability), platform (internal developer platforms), cloud_infrastructure (cloud and infrastructure as code), build_release (CI/CD, builds, releases)
data: data_pipelines (ETL/ELT, streaming), analytics_engineering (modeling data for analytics), data_platform (warehouses, lakehouses, data tooling)
ml_ai: llm_applications (building products on LLMs), ml_modeling (training and developing models), ml_infrastructure (training and inference infrastructure, MLOps), computer_vision, recommender_systems (recommendation, ranking, personalization)
qa: test_automation (automated tests, SDET), manual_qa, performance_testing
security: application_security, cloud_security, security_operations (detection, response), identity_access, offensive_security (penetration testing, red team)
embedded: firmware, embedded_linux, robotics_autonomy

Any category:
forward_deployed (engineers deployed with customers)
enterprise_platforms (SAP/ABAP, Salesforce, ServiceNow, RPA such as UiPath)
game_development
blockchain

Do not choose a subcategory from a mention of a technology alone; it must describe the main work.

WORKPLACE

remote:
The role can be performed fully remotely.

hybrid:
Regular office attendance is required, but some work may be remote.

onsite:
Normal work is required at the workplace.

unknown:
The posting does not clearly state the arrangement.

A city or country alone does not determine workplace type.

A required recurring office schedule makes the role hybrid even if the posting calls it remote.

Optional office access does not make a remote role hybrid.

Occasional travel, conferences, onboarding, customer visits, or company meetings do not make a remote job hybrid.

LOCATION

locations:
Only explicit physical job sites.

Do not treat company offices as job locations unless this role is based there.

remoteEligibleCountries:
Places where remote candidates are explicitly permitted to work.

Keep regions exactly as written (for example Europe or Latin America); do not expand a region into countries.

mustResideIn:
Set only when the candidate is explicitly required to live in a particular place.

Do not treat preferences as residence requirements.

mustResideInEvidence:
The exact quote that states the residence requirement; null when mustResideIn is null.

timezone:
Only an explicitly required timezone or working-hours overlap.

Do not infer timezone from location.

remoteScope:
Only for a remote role.
global: remote candidates may work from any country ("work from anywhere", "worldwide").
region: remote work is limited to named countries, regions, or timezones.
null: not a remote role, or the posting does not say where remote candidates may be.

SALARY

Extract base salary only.

Ignore:
- equity
- bonus
- commission
- OTE
- total compensation
- signing bonuses
- benefits

Convert salary shorthand:
$120k -> 120000.

Do not annualize hourly compensation.
Do not convert currencies.

Single salary:
$120,000 -> min 120000, max 120000.

From:
from $120,000 -> min 120000, max null.

Up to:
up to $150,000 -> min null, max 150000.

If multiple salary ranges are provided, use the first base-pay range in posting order.

ROLE

Seniority must come from explicit seniority language.

The job title counts as explicit seniority language.

Do not infer seniority solely from years of experience.

Examples:
Senior Software Engineer -> senior
Sr. Engineer -> senior
Senior Cybersecurity Engineer -> senior
Principal Engineer -> principal
Software Engineer requiring 7 years -> seniority remains null unless seniority is explicitly stated.

yearsExperienceMin:
Use the minimum explicit overall/relevant professional experience requirement.

Examples:
3+ years -> 3
3-5 years -> 3
at least 4 years -> 4
5 years software engineering including 2 years React -> 5

Do not infer experience from seniority.

yearsExperienceMax:
The upper bound of a stated experience range, otherwise null.

Examples:
3-5 years -> 5
3+ years -> null

SKILLS

Extract only technical skills the candidate is expected to know, use, build with, or operate.

List every technology named in the requirements, responsibilities, or tech stack. An empty list is only correct when the posting names no technology.

Include:
- programming languages
- frameworks
- databases
- cloud services
- developer tools
- protocols
- technical practices

Exclude:
- soft skills
- company names
- customers
- business skills
- technologies mentioned only as integrations or ecosystem examples

Example:
"Our product integrates with Spotify and TikTok"
does not make Spotify or TikTok required skills.

Normalize obvious names:
React.js -> React
NodeJS -> Node.js
Amazon Web Services -> AWS
Postgres -> PostgreSQL

required:
Skills explicitly required or listed without being marked optional.

preferred:
Only skills explicitly marked preferred, nice-to-have, bonus, plus, or similar.

If a skill appears as both required and preferred, put it only in required.

VISA

yes:
Sponsorship is explicitly available.

no:
Sponsorship is explicitly unavailable or the candidate must already have work authorization.

unknown:
The posting does not address sponsorship.

Examples:
"Visa sponsorship available" -> yes
"Unable to sponsor" -> no
"Must be authorized to work without sponsorship" -> no

DEGREE

Return the minimum mandatory degree.

"Bachelor's required" -> bachelor
"Bachelor's or equivalent experience" -> none
"Bachelor's preferred" -> null
"No degree required" -> none

TRAVEL

Extract travel percentage only when explicitly stated.

"up to 25%" -> 25
"10-20%" -> 20
"occasional travel" -> null

ONSITE INTERVIEW

yes:
At least one interview, interview round, assessment, or interview day is explicitly required to happen in person or onsite.

no:
The posting explicitly states that the interview process is fully virtual, remote, or video-based.

unknown:
The interview format is not clearly stated.

Important:
- An onsite job does not automatically mean an onsite interview.
- A hybrid job does not automatically mean an onsite interview.
- A remote job may still require an onsite interview.
- An office location alone is not evidence of an onsite interview.
- Do not infer onsiteInterview from workplace.type.
- "May be asked" or "might" is not a requirement: use unknown.
- Video interviews alone do not mean the whole process is virtual: use unknown.

Examples:
"Final interview will be held at our New York office" -> yes
"Final round is in person" -> yes
"All interviews are conducted via Zoom" -> no
"Interview process is fully virtual" -> no
"You will complete three interview rounds" -> unknown
"Candidates may be asked to attend an in-person interview" -> unknown
"Please keep your camera on during video interviews" -> unknown

Evidence for onsiteInterview must be the exact supporting quote.
If onsiteInterview is unknown, onsiteInterviewEvidence must be null.

SECURITY CLEARANCE

Return a named clearance only when the candidate is required to hold it or be eligible to obtain it.

Mentioning government or cleared customers alone does not create a clearance requirement.

Example:
"Security Clearance Level: Public Trust" -> Public Trust

RELOCATION

yes:
Relocation assistance is explicitly offered.

no:
Relocation assistance is explicitly unavailable.

unknown:
Not addressed.

Do not confuse "relocation required" with "relocation assistance."

LANGUAGES

Include only required human languages.

Do not include programming languages.

COMPANY

Describe the company that is hiring, only as the posting states it about itself.

fundingStage:
- pre_seed, seed, series_a, series_b, series_c: the company says it raised, closed or is at that round ("we raised our Series A", "a seed-stage startup").
- venture_backed: the company says it is funded by venture investors or an accelerator ("backed by Sequoia", "YC-backed", "venture-funded") without naming a round.
- later_stage: Series D or later, "pre-IPO", or valued at $1 billion or more ("unicorn").
- public: the company says it is publicly traded or listed on an exchange.
- bootstrapped: the company says it is bootstrapped, self-funded or profitable without outside funding.
- null: not stated.
If several rounds are named, choose the latest one.

calledStartup:
true only when the posting calls the hiring company itself a startup ("we are an early-stage startup", "join our fast-growing startup"). false otherwise.

employeeCount:
The number of people the whole company employs, only when stated ("a 15-person team", "we are 40 people"). The size of one team inside the company ("our 6-person data team") is not the company's headcount. For a range, use its upper bound. null when not stated.

These describe the hiring company, never the candidate: "experience at an early-stage startup" or "you have worked at a Series A company" is not evidence.
When the posting is written by a recruiter or agency for a client ("our client is a Series A fintech"), use null, false and null.

evidence:
An exact quote supporting every non-null value and calledStartup true; never the text "null". null when fundingStage and employeeCount are null and calledStartup is false.

KEYWORDS

tags:
Up to 15 short tags, copied from the posting's own words, naming what the role is about beyond its technologies:
- the industry or domain: healthcare, fintech, e-commerce, gaming, climate, defense
- the product or problem area: payments, fraud detection, search, observability, computer vision, LLM
- the engineering context: distributed systems, real-time, high availability, data pipelines, platform engineering, greenfield
- regulated settings: HIPAA, SOC 2, PCI, GDPR, FedRAMP
- the shape of the role: founding engineer, team lead, agency, greenfield

Rules:
- Each tag is one to three words, lowercase, and in English however the posting is written.
- Only what the posting states about this role or this company. A customer's industry or a candidate's past employer is not a tag.
- Never a technology: no language, framework, library, database, cloud, tool or practice. Those are skills and are already recorded. A tag list that reads like a tech stack is wrong.
- Never what another field holds: no place, no seniority, no work arrangement, no employment type, no human language, no funding round, no on-call, no company name.
- No filler true of every job: software, engineering, team, experience, collaboration, testing, documentation, production, hiring, troubleshooting.
- [] when the posting names nothing beyond its technologies.

Example:
"We are a Series B fintech building real-time payment rails. You will own our fraud detection service, a PCI-compliant Go platform in Berlin, and join the on-call rotation."
-> ["fintech", "payments", "real-time", "fraud detection", "pci"]
Not "go" or "postgres" (technologies), "series b" (the company field), "berlin" (the location field), "on-call" (a duty, not a domain).

INTERNSHIP

Only for an internship, co-op or new-graduate posting; the field may be absent from the schema for other postings. Who the posting says it is for:

graduationFrom, graduationTo:
The graduation dates the posting accepts, as months "YYYY-MM". "Graduating between December 2027 and June 2028" -> "2027-12", "2028-06". "Class of 2027" -> "2027-01", "2027-12". "Expected graduation in 2028 or later" -> "2028-01", null. null when not stated. A start date is not a graduation date.

enrollmentRequired:
yes when the candidate must be enrolled in a degree programme during or after the internship ("must be returning to school", "currently pursuing a degree"); no when the posting says it is open to graduates; unknown otherwise.

durationWeeks:
The internship's length in weeks when stated ("12-week program" -> 12, "3 months" -> 13, "6 months" -> 26). null when not stated.

evidence:
An exact quote supporting every non-null value and any enrollmentRequired other than unknown. null when nothing is stated.`;

/**
 * The posting as the model sees it; quotes are checked against this same text. Mis-decoded
 * characters are repaired first: a model cannot copy "UbicaciÃ³n" into a quote.
 */
export function buildPostingText(job) {
  const field = (value) => repairMojibake(value).trim();
  const description = field(job.description).slice(0, MAX_DESCRIPTION_CHARS);
  return [
    `TITLE: ${field(job.title)}`,
    `COMPANY: ${field(job.company)}`,
    `LOCATION: ${field(job.location)}`,
    'DESCRIPTION:',
    description || '(none)',
  ].join('\n');
}

/**
 * The user message: the posting inside a fence the prompt names as data (text/fence.js), since
 * its text is the employer's and may carry instructions aimed at the model, plus the checks a
 * previous answer failed when retrying. Quotes are still checked against the posting itself
 * (buildPostingText), which the fence does not change.
 */
export function buildUserPrompt(posting, failedChecks = []) {
  const fencedPosting = jobPostingBlock(posting);
  if (failedChecks.length === 0) return fencedPosting;
  return `${fencedPosting}

YOUR PREVIOUS ANSWER FOR THIS POSTING FAILED THESE CHECKS. Answer again and fix them. Where the posting does not support a value, use null (or "unknown" where offered) instead of inventing one:
${failedChecks.map((check) => `- ${check}`).join('\n')}`;
}
