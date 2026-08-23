import { SYSTEM_PROMPT, buildPrompt } from './prompts.js';
import { assertAnalysis } from './schema.js';
import { evaluateSafety } from '../../src/safety.js';
import { ProviderError } from './errors.js';

const PROVIDER_TIMEOUT_MS = 25_000;
const SAFE_UPSTREAM_CODE = /^[a-zA-Z0-9_.-]{1,100}$/u;

export function classifyProviderHttpStatus(status) {
  if (status === 401 || status === 403) return 'AI_AUTH_ERROR';
  if (status === 429) return 'AI_QUOTA_OR_RATE_LIMIT';
  if (status === 404) return 'AI_MODEL_OR_ENDPOINT_NOT_FOUND';
  if (status === 400 || status === 422) return 'AI_REQUEST_REJECTED';
  if (status >= 500 && status <= 599) return 'AI_PROVIDER_UNAVAILABLE';
  return 'AI_PROVIDER_ERROR';
}

async function safeUpstreamErrorCode(response) {
  if (typeof response?.json !== 'function') return '';
  try {
    const code = (await response.json())?.error?.code;
    return typeof code === 'string' && SAFE_UPSTREAM_CODE.test(code) ? code : '';
  } catch {
    return '';
  }
}

function providerConfig(env = process.env) {
  return {
    apiKey: env.AI_API_KEY || '',
    model: env.AI_MODEL || '',
    baseUrl: env.AI_BASE_URL || 'https://api.openai.com/v1',
  };
}

export async function analyzeWithProvider(
  answers,
  practices,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = PROVIDER_TIMEOUT_MS,
) {
  if (evaluateSafety(answers).status === 'safety_stop') {
    return {
      status: 'safety_stop', route: null, title: 'Сейчас важнее срочная живая поддержка',
      reflection: '', observedFacts: [], workingHypothesis: '', confidence: 'low', requestDraft: '',
      practiceId: null, practiceReason: '', nextStep: '',
      humanSupport: { recommended: true, reason: 'Обратитесь в экстренную службу вашего региона или к человеку, которому доверяете.', urgency: 'urgent' },
      disclaimer: 'Навигатор не является кризисной службой.',
    };
  }
  const config = providerConfig(env);
  if (!config.apiKey || !config.model) throw new ProviderError('AI_NOT_CONFIGURED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildPrompt(answers, practices) },
          ],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ProviderError(error.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR');
    }
    if (!response.ok) {
      const upstreamStatus = Number(response.status);
      throw new ProviderError('AI_PROVIDER_ERROR', {
        upstreamStatus,
        safeCategory: classifyProviderHttpStatus(upstreamStatus),
        upstreamCode: await safeUpstreamErrorCode(response),
      });
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new ProviderError('AI_INVALID_RESPONSE');
    }
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new ProviderError('AI_INVALID_RESPONSE');
    try {
      return assertAnalysis(JSON.parse(content), practices);
    } catch {
      throw new ProviderError('AI_INVALID_RESPONSE');
    }
  } finally {
    clearTimeout(timer);
  }
}

export { PROVIDER_TIMEOUT_MS };
