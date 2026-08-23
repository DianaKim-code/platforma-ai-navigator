import { SYSTEM_PROMPT, buildPrompt } from './prompts.js';
import { assertAnalysis } from './schema.js';
import { evaluateSafety } from '../../src/safety.js';
import { hasSufficientData } from '../../src/dataSufficiency.js';
import { selectPractice, validatePracticeId } from '../../src/practiceMap.js';
import { ProviderError } from './errors.js';

const PROVIDER_TIMEOUT_MS = 25_000;
const SAFE_UPSTREAM_CODE = /^[a-zA-Z0-9_.-]{1,100}$/u;
export const ORDINARY_DISCLAIMER = 'Это рабочее предположение, а не диагноз. Вы можете проверить его на своём опыте или обсудить с подходящим специалистом.';
export const INSUFFICIENT_DATA_DISCLAIMER = 'Это предварительное отражение по имеющимся ответам. Один уточняющий шаг поможет сделать результат точнее.';

const TECHNICAL_PROSE = /(?:пользовател\w*|клиент\w*|респондент\w*|субъект\w*|кейс\w*)/iu;
const ROUTE_CODE_IN_PROSE = /\bR[1-4]\b/u;
const UNSUPPORTED_CLINICAL_RULES = [
  { output: /тревог\w*/iu, input: /тревог\w*/iu },
  { output: /депресс\w*/iu, input: /депресс\w*/iu },
  { output: /симптом\w*/iu, input: /симптом\w*/iu },
  { output: /ухудшен\w*\s+состояни\w*/iu, input: /ухудшен\w*\s+состояни\w*/iu },
  { output: /психическ\w*\s+состояни\w*/iu, input: /психическ\w*\s+состояни\w*/iu },
  { output: /эмоциональн\w*\s+расстройств\w*/iu, input: /эмоциональн\w*\s+расстройств\w*/iu },
  { output: /травм\w*/iu, input: /травм\w*/iu },
  { output: /дискомфорт\w*/iu, input: /дискомфорт\w*/iu },
];

function answersText(answers) {
  return Object.values(answers)
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => typeof value === 'string')
    .join(' ');
}

function sentenceIsAllowed(sentence, sourceText) {
  if (TECHNICAL_PROSE.test(sentence) || ROUTE_CODE_IN_PROSE.test(sentence)) return false;
  return !UNSUPPORTED_CLINICAL_RULES.some(({ output, input }) => output.test(sentence) && !input.test(sourceText));
}

function sanitizeProse(value, sourceText, fallback = '') {
  const clean = String(value || '')
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => sentenceIsAllowed(sentence, sourceText))
    .join(' ')
    .trim();
  return clean || fallback;
}

function deterministicObservedFacts(answers) {
  const facts = [];
  if (answers.domain?.length) facts.push(`Вы указали сферу: ${answers.domain.join(', ')}.`);
  if (answers.barrier) facts.push(`Сейчас движение останавливается на шаге: ${answers.barrier}.`);
  if (answers.desiredResult) facts.push(`Желаемый результат: ${answers.desiredResult}.`);
  if (answers.resourceLevel && answers.resourceLevel !== 'Мне трудно определить') {
    facts.push(`Доступный ресурс: ${answers.resourceLevel}.`);
  }
  return facts.slice(0, 4);
}

function synthesisFallback(answers) {
  const topic = answers.desiredResult || answers.domain?.[0];
  if (topic && answers.barrier) {
    return `В теме «${topic}» направление уже обозначено, а ближайший шаг стоит соотнести с тем, что сейчас останавливает движение, и с доступным ресурсом.`;
  }
  return 'По вашим ответам уже можно выделить направление и подобрать следующий шаг с учётом доступного ресурса.';
}

export function createInsufficientDataResult(answers = {}) {
  const facts = deterministicObservedFacts(answers);
  const missing = [
    !answers.domain?.length && 'сфера',
    !answers.barrier && 'конкретный барьер',
    !answers.desiredResult && 'желаемый результат',
    (!answers.resource?.length && (!answers.resourceLevel || answers.resourceLevel === 'Мне трудно определить')) && 'доступный ресурс',
  ].filter(Boolean);
  const known = facts.length
    ? `Уже понятно: ${facts.slice(0, 2).join(' ')}`
    : 'Пока понятно только, что определить ситуацию однозначно трудно.';
  const gap = missing.length
    ? `Чтобы выбрать точку начала, пока не хватает: ${missing.join(', ')}.`
    : 'Чтобы выбрать точку начала, пока не хватает одного конкретного недавнего примера.';
  return {
    status: 'insufficient_data',
    route: null,
    title: 'Сначала уточним одну точку ситуации',
    reflection: `${known} ${gap} Один нейтральный пример поможет сделать следующий вывод точнее.`,
    observedFacts: facts,
    workingHypothesis: 'Данных для рабочей гипотезы пока недостаточно.',
    confidence: 'low',
    requestDraft: 'Какой один недавний эпизод лучше всего показывает, где изменение останавливается?',
    practiceId: null,
    practiceReason: '',
    nextStep: 'Выберите один недавний эпизод и коротко запишите: что вы хотели сделать, что произошло и что зависело от вас.',
    practice: null,
    humanSupport: {
      recommended: false,
      reason: 'При желании этот пример можно обсудить с подходящим специалистом.',
      urgency: 'optional',
    },
    disclaimer: INSUFFICIENT_DATA_DISCLAIMER,
  };
}

function lowResourcePractice(answers, route, practices) {
  const routedMicroPractices = practices.filter((practice) => (
    practice.level === 'Micro' && (!route || practice.routes.includes(route))
  ));
  const candidates = routedMicroPractices.length
    ? routedMicroPractices
    : practices.filter((practice) => practice.level === 'Micro');
  return selectPractice(candidates, {
    route,
    resource: answers.resourceLevel,
    pattern: answers.pattern,
    barrier: answers.barrier,
    need: answers.need,
  });
}

export function canonicalizeAnalysisResult(result, answers, practices) {
  const sourceText = answersText(answers);
  if (result.status !== 'ok') {
    return {
      ...result,
      route: null,
      practiceId: null,
      practiceReason: '',
      practice: null,
      disclaimer: INSUFFICIENT_DATA_DISCLAIMER,
    };
  }

  let practice = validatePracticeId(practices, result.practiceId);
  if (answers.resourceLevel === 'Сейчас сил почти нет' && practice?.level !== 'Micro') {
    practice = lowResourcePractice(answers, result.route, practices);
  }

  const observedFacts = result.observedFacts
    .map((fact) => sanitizeProse(fact, sourceText))
    .filter(Boolean);
  const canonicalPractice = practice ? {
    id: practice.id,
    level: practice.level,
    duration: practice.duration,
    text: practice.text,
    nextStep: practice.nextStep,
  } : null;

  return {
    ...result,
    title: sanitizeProse(result.title, sourceText, 'Предварительное отражение ситуации'),
    reflection: sanitizeProse(result.reflection, sourceText, synthesisFallback(answers)),
    observedFacts: observedFacts.length ? observedFacts : deterministicObservedFacts(answers),
    workingHypothesis: sanitizeProse(
      result.workingHypothesis,
      sourceText,
      'Рабочее предположение пока стоит проверить на вашем опыте.',
    ),
    requestDraft: sanitizeProse(
      result.requestDraft,
      sourceText,
      'Какой небольшой следующий шаг сейчас наиболее реалистичен?',
    ),
    practiceId: practice?.id || null,
    practiceReason: practice
      ? sanitizeProse(
        result.practiceReason,
        sourceText,
        'Практика выбрана с учётом ваших ответов и доступного ресурса.',
      )
      : '',
    nextStep: practice
      ? practice.nextStep
      : sanitizeProse(result.nextStep, sourceText, 'Выберите один небольшой проверяемый шаг.'),
    practice: canonicalPractice,
    humanSupport: {
      ...result.humanSupport,
      reason: sanitizeProse(
        result.humanSupport.reason,
        sourceText,
        'При желании результат можно обсудить с подходящим специалистом.',
      ),
    },
    disclaimer: ORDINARY_DISCLAIMER,
  };
}

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
  if (!hasSufficientData(answers)) return createInsufficientDataResult(answers);
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
      const validated = assertAnalysis(JSON.parse(content), practices);
      return assertAnalysis(canonicalizeAnalysisResult(validated, answers, practices), practices);
    } catch {
      throw new ProviderError('AI_INVALID_RESPONSE');
    }
  } finally {
    clearTimeout(timer);
  }
}

export { PROVIDER_TIMEOUT_MS };
