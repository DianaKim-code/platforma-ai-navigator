import { SYSTEM_PROMPT, buildPrompt } from './prompts.js';
import { assertAnalysis } from './schema.js';
import { evaluateSafety } from '../../src/safety.js';

function providerConfig(env = process.env) {
  return {
    apiKey: env.AI_API_KEY || '',
    model: env.AI_MODEL || '',
    baseUrl: env.AI_BASE_URL || 'https://api.openai.com/v1',
  };
}

export async function analyzeWithProvider(answers, practices, env = process.env) {
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
  if (!config.apiKey || !config.model) throw new Error('AI provider is not configured');
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
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
  });
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  const body = await response.json();
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('Provider returned no content');
  return assertAnalysis(JSON.parse(content), practices);
}
