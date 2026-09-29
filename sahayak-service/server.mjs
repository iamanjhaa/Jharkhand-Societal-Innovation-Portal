import 'dotenv/config';
import http from 'node:http';

const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '8000', 10);
const apiKey = process.env.OPENROUTER_API_KEY;
const baseUrl = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const model = process.env.OPENROUTER_MODEL || 'minimax/minimax-m3';

const responseShape = {
  message: 'string, only for a brief clarification or out-of-scope response',
  understanding: { summary: 'string' },
  severity: 'low | medium | high | critical',
  can_solve_myself: 'boolean',
  solution_info: {
    steps: ['string'],
    tools_materials: ['string'],
    estimated_time: 'string',
    estimated_cost: 'string'
  },
  safety_guidance: {
    precautions: ['string'],
    when_to_stop: 'string'
  },
  escalation: {
    required: 'boolean',
    contact: 'string',
    reason: 'string'
  },
  prevention: ['string'],
  helplines: [{ name: 'string', number: 'string', purpose: 'string' }]
};

const systemPrompt = `You are Sahayak, a practical guidance assistant for the Jharkhand Societal Innovation Portal.
You support Citizen, Government, University, and Industry users. Citizens submit and track problems; Government verifies, prioritizes, assigns, and monitors; University accepts, develops, tests, and deploys; Industry sponsors projects and provides optional expertise. Explain how industry can sponsor eligible university projects, what happens after funding, and how to provide technical support.
Give safe, realistic, locally useful guidance about civic and community problems. Do not claim to have contacted authorities or verified live information.
The requested language is supplied by the user. Return all user-facing text in that language (English for "en", Hindi in Devanagari for "hi").
Return ONLY valid JSON matching this shape, with no Markdown fences:
${JSON.stringify(responseShape)}
Use empty arrays or empty strings when a field does not apply. For urgent safety risks, set severity to "critical", can_solve_myself to false, and clearly explain when to seek professional or emergency help.`;

const urgencyPrompt = `Classify the urgency of a citizen-reported civic problem using only the supplied information.
Return ONLY valid JSON with exactly these fields:
{"urgency":"LOW|MEDIUM|HIGH|CRITICAL","reason":"brief explanation grounded in the supplied information","confidence":0.0}
Use the overall context, impact, immediacy, and people affected rather than isolated keywords.
Do not invent facts, locations, emergencies, or verification. If the information is insufficient, use MEDIUM with a low confidence.
CRITICAL is for active life-threatening or severe situations such as fire in a residential area, people trapped, or active flooding affecting homes.`;

const recommendationPrompt = `You compare a new societal problem against verified completed solution records.
Return ONLY valid JSON with exactly this shape:
{"recommendations":[{"solutionId":"string","reason":"string","relevantAspects":["string"]}]}
Return at most 3 genuinely relevant candidates, or an empty array if none is meaningful.
Use only candidate solutionId values supplied by the user. Never invent IDs, technologies, outcomes, or facts.`;

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function parseJsonContent(content) {
  const withoutFence = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(withoutFence);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalString(value) {
  return value === undefined || typeof value === 'string';
}

function isOptionalBoolean(value) {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalStringArray(value) {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function isGuidanceResponse(value) {
  if (!isRecord(value)) return false;
  if (!isOptionalString(value.message)) return false;
  if (!isOptionalString(value.severity) || !isOptionalBoolean(value.can_solve_myself)) return false;
  if (!isRecord(value.understanding) || typeof value.understanding.summary !== 'string') return false;
  if (!isRecord(value.solution_info) || !isOptionalStringArray(value.solution_info.steps) || !isOptionalStringArray(value.solution_info.tools_materials)) return false;
  if (!isOptionalString(value.solution_info.estimated_time) || !isOptionalString(value.solution_info.estimated_cost)) return false;
  if (!isRecord(value.safety_guidance) || !isOptionalStringArray(value.safety_guidance.precautions) || !isOptionalString(value.safety_guidance.when_to_stop)) return false;
  if (!isRecord(value.escalation) || typeof value.escalation.required !== 'boolean') return false;
  if (!isOptionalString(value.escalation.contact) || !isOptionalString(value.escalation.reason)) return false;
  if (!isOptionalStringArray(value.prevention)) return false;
  if (!Array.isArray(value.helplines) || !value.helplines.every((item) => isRecord(item)
    && isOptionalString(item.name)
    && isOptionalString(item.number)
    && isOptionalString(item.purpose))) return false;
  return true;
}

async function generateRecommendationsExternal(context) {
  if (!apiKey || apiKey === 'replace_with_your_provider_api_key') {
    const error = new Error('Sahayak requires OPENROUTER_API_KEY to generate real AI responses');
    error.statusCode = 503;
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const providerResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3000',
        'X-Title': 'Jharkhand Societal Innovation Portal Solution Recommendations'
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: recommendationPrompt },
          { role: 'user', content: JSON.stringify(context) }
        ]
      }),
      signal: controller.signal
    });
    const providerBody = await providerResponse.json();
    if (!providerResponse.ok) {
      const error = new Error(providerBody.error?.message || 'AI provider request failed');
      error.statusCode = 502;
      throw error;
    }
    const content = providerBody.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI provider returned no recommendation content');
    return parseJsonContent(content);
  } finally {
    clearTimeout(timeout);
  }
}

async function generateGuidance(problem, language) {
  if (!apiKey || apiKey === 'replace_with_your_provider_api_key') {
    const error = new Error('Sahayak requires OPENROUTER_API_KEY to generate real AI responses');
    error.statusCode = 503;
    throw error;
  }

  async function generateRecommendations(context) {
    if (!apiKey || apiKey === 'replace_with_your_provider_api_key') {
      const error = new Error('Sahayak requires OPENROUTER_API_KEY to generate real AI responses');
      error.statusCode = 503;
      throw error;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const providerResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `******`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3000',
          'X-Title': 'Jharkhand Societal Innovation Portal Solution Recommendations'
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 1200,
          messages: [
            { role: 'system', content: recommendationPrompt },
            { role: 'user', content: JSON.stringify(context) }
          ]
        }),
        signal: controller.signal
      });
      const providerBody = await providerResponse.json();
      if (!providerResponse.ok) {
        const error = new Error(providerBody.error?.message || 'AI provider request failed');
        error.statusCode = 502;
        throw error;
      }
      const content = providerBody.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('AI provider returned no recommendation content');
      return parseJsonContent(content);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function generateUrgency(details) {
    if (!apiKey || apiKey === 'replace_with_your_provider_api_key') {
      const error = new Error('OpenRouter is not configured');
      error.statusCode = 503;
      throw error;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const providerResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3000',
          'X-Title': 'Jharkhand Societal Innovation Portal Urgency Detection'
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 300,
          messages: [
            { role: 'system', content: urgencyPrompt },
            { role: 'user', content: JSON.stringify(details) }
          ]
        }),
        signal: controller.signal
      });
      const providerBody = await providerResponse.json();
      if (!providerResponse.ok) {
        const error = new Error(providerBody.error?.message || 'AI provider request failed');
        error.statusCode = 502;
        throw error;
      }
      const content = providerBody.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('AI provider returned no urgency content');
      return parseJsonContent(content);
    } finally {
      clearTimeout(timeout);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40_000);
  try {
    const providerResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3000',
        'X-Title': 'Jharkhand Societal Innovation Portal Sahayak'
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ problem, language }) }
        ]
      }),
      signal: controller.signal
    });
    const providerBody = await providerResponse.json();
    if (!providerResponse.ok) {
      const error = new Error(providerBody.error?.message || 'AI provider request failed');
      error.statusCode = 502;
      throw error;
    }

    const content = providerBody.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      const error = new Error('AI provider returned no response content');
      error.statusCode = 502;
      throw error;
    }
    const result = parseJsonContent(content);
    if (!isGuidanceResponse(result)) {
      const error = new Error('AI provider returned an invalid Sahayak response');
      error.statusCode = 502;
      throw error;
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    return sendJson(response, 200, {
      status: 'ok',
      provider: 'openrouter',
      model,
      providerConfigured: Boolean(apiKey && apiKey !== 'replace_with_your_provider_api_key')
    });
  }
  if (request.method === 'POST' && request.url === '/solution-recommendations') {
    let rawBody = '';
    for await (const chunk of request) rawBody += chunk;
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return sendJson(response, 400, { detail: 'Request body must be valid JSON' });
    }
    if (!body || typeof body !== 'object') return sendJson(response, 400, { detail: 'Recommendation context is required' });
    try {
      const result = await generateRecommendationsExternal(body);
      if (!result || !Array.isArray(result.recommendations)) return sendJson(response, 502, { detail: 'AI returned an invalid recommendation response' });
      return sendJson(response, 200, result);
    } catch (error) {
      if (error.name === 'AbortError') return sendJson(response, 504, { detail: 'AI provider request timed out' });
      console.error(`Solution recommendation error: ${error.message}`);
      return sendJson(response, error.statusCode || 500, { detail: error.message });
    }
  }
  if (request.method === 'POST' && request.url === '/detect-urgency') {
    let rawBody = '';
    for await (const chunk of request) rawBody += chunk;
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return sendJson(response, 400, { detail: 'Request body must be valid JSON' });
    }
    const fields = ['title', 'description', 'category', 'affected', 'expectedImpact', 'location'];
    if (!fields.every((field) => typeof body[field] === 'string')) {
      return sendJson(response, 400, { detail: 'All problem detail fields are required' });
    }
    try {
      const result = await generateUrgency(Object.fromEntries(fields.map((field) => [field, body[field].trim().slice(0, 2000)])));
      const urgency = typeof result.urgency === 'string' ? result.urgency.trim().toUpperCase() : '';
      const confidence = Number(result.confidence);
      if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(urgency) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || typeof result.reason !== 'string' || !result.reason.trim()) {
        return sendJson(response, 502, { detail: 'AI returned an invalid urgency assessment' });
      }
      return sendJson(response, 200, { urgency, reason: result.reason.trim().slice(0, 500), confidence });
    } catch (error) {
      if (error.name === 'AbortError') return sendJson(response, 504, { detail: 'AI provider request timed out' });
      console.error(`Urgency detection error: ${error.message}`);
      return sendJson(response, error.statusCode || 500, { detail: error.message });
    }
  }
  if (request.method !== 'POST' || request.url !== '/chat') {
    return sendJson(response, 404, { detail: 'Not found' });
  }

  let rawBody = '';
  for await (const chunk of request) rawBody += chunk;
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return sendJson(response, 400, { detail: 'Request body must be valid JSON' });
  }

  const problem = typeof body.problem === 'string' ? body.problem.trim() : '';
  const language = body.language === 'hi' ? 'hi' : body.language === 'en' ? 'en' : null;
  if (!problem) return sendJson(response, 400, { detail: 'Problem text cannot be empty' });
  if (!language) return sendJson(response, 400, { detail: 'Language must be en or hi' });

  try {
    return sendJson(response, 200, await generateGuidance(problem, language));
  } catch (error) {
    if (error.name === 'AbortError') return sendJson(response, 504, { detail: 'AI provider request timed out' });
    console.error(`Sahayak error: ${error.message}`);
    return sendJson(response, error.statusCode || 500, { detail: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Sahayak service listening on http://${host}:${port}`);
  console.log(`AI provider: ${baseUrl} (${model})`);
});
