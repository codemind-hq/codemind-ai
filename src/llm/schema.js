// OpenAI Structured Outputs (strict JSON schema): the pieces every response format is built
// from. Strict mode needs every property listed in `required` and `additionalProperties: false`
// on every object. Each feature keeps its own formats beside its prompts (score/schema.js,
// tailor/schema.js, parse/schema.js, interview/schema.js).

export const str = { type: 'string' };
export const strList = { type: 'array', items: str };
export const boundedList = (maxItems) => ({ type: 'array', maxItems, items: str });
export const oneOf = (values) => ({ type: 'string', enum: values });

export function object(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export const strictFormat = (name, schema) => ({ type: 'json_schema', json_schema: { name, strict: true, schema } });

// The entries of the structured resume form (resume/structuredResume.js), as the parse and
// tailor formats both describe them.
export const experienceEntry = object({ company: str, title: str, period: str, city: str, state: str, achievements: strList });
export const projectEntry = object({ name: str, role: str, period: str, link: str, highlights: strList });
export const otherSection = object({ title: str, content: str });
export const skillGroup = object({ category: str, items: strList });
