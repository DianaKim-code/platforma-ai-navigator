import { evaluateSafety } from './safety.js';
import { fallbackResult, validateAnalysisResponse } from './schema.js';
import { practiceIds, selectPractice } from './practiceMap.js';

export const AI_MODES = Object.freeze({ MOCK: 'mock', LIVE: 'live' });

function includes(value, fragment) {
  return String(value || '').toLocaleLowerCase('ru').includes(fragment);
}

export function normalizeNavigatorAnswers(raw = {}, sessionId = '') {
  const domains = Array.isArray(raw.areas) ? raw.areas.filter((item) => item !== 'Пока сложно определить') : [];
  const priority = raw.readyTopic && raw.readyTopic !== 'Пока не могу выбрать'
    ? raw.readyTopic
    : raw.priority && raw.priority !== 'Пока не могу выбрать' ? raw.priority : '';
  const tried = Array.isArray(raw.tried) ? raw.tried : [];
  return {
    sessionId,
    domain: domains,
    pattern: raw.obstacle || '',
    duration: raw.duration || '',
    lifeImpact: Array.isArray(raw.losses) ? raw.losses : [],
    clarity: priority ? 'priority_defined' : 'priority_unclear',
    barrier: raw.obstacle || '',
    triedBefore: tried,
    triedBeforeOutcome: raw.missing || '',
    desiredResult: priority,
    resource: Array.isArray(raw.supports) ? raw.supports : [],
    resourceLevel: raw.resourceLevel || inferResourceLevel(raw),
    need: raw.preferredFormat || '',
    safetyLevel: raw.safetyLevel || '',
    openConcern: raw.mainConcern || '',
    desiredAction: raw.desiredAction || '',
    stopFeeling: raw.stopFeeling || '',
    influence: raw.influence || '',
    ownAction: raw.ownAction || '',
    risk: raw.risk || '',
  };
}

export function inferResourceLevel(raw = {}) {
  if (raw.obstacle === 'Не хватило сил или энергии' || (raw.supports || []).includes('Пока не вижу опоры')) return 'Сейчас сил почти нет';
  if ((raw.supports || []).length >= 2) return 'Есть ресурс для небольших действий';
  return 'Ресурс пока неясен';
}

export function resolveMockRoute(answers) {
  if (answers.resourceLevel === 'Сейчас сил почти нет') return 'R2';
  if (includes(answers.barrier, 'другого человека') || includes(answers.influence, 'другого человека')) return 'R3';
  if ((answers.triedBefore || []).length >= 2 && answers.clarity === 'priority_defined') return 'R4';
  if (answers.clarity === 'priority_unclear' || includes(answers.barrier, 'с чего начать') || includes(answers.barrier, 'слишком много вариантов')) return 'R1';
  return 'R4';
}

export function hasSufficientData(answers) {
  const signals = [
    answers.domain?.length,
    answers.barrier,
    answers.duration && answers.duration !== 'Мне трудно определить',
    answers.lifeImpact?.length,
    answers.desiredResult,
    answers.resource?.length,
  ].filter(Boolean).length;
  return signals >= 3 && (answers.domain?.length || answers.desiredResult || answers.barrier);
}

function factList(answers) {
  const facts = [];
  if (answers.domain?.length) facts.push(`Вы отметили сферу: ${answers.domain.join(', ')}.`);
  if (answers.barrier) facts.push(`В момент остановки вы выбрали: ${answers.barrier}.`);
  if (answers.duration) facts.push(`Ситуация продолжается: ${answers.duration.toLocaleLowerCase('ru')}.`);
  if (answers.resourceLevel) facts.push(`Доступный ресурс: ${answers.resourceLevel.toLocaleLowerCase('ru')}.`);
  return facts.slice(0, 4);
}

function hypothesisFor(route, answers) {
  if (route === 'R2') return 'Одна из рабочих гипотез — сейчас на первый план может выходить ограниченный ресурс, поэтому полезнее уменьшить нагрузку, а не требовать от себя большого рывка.';
  if (route === 'R3') return 'Одна из рабочих гипотез — движение останавливается там, где собственное решение соприкасается с решением другого человека или высокой ценой ошибки.';
  if (route === 'R1') return includes(answers.barrier, 'вариантов')
    ? 'Одна из рабочих гипотез — идей уже достаточно, а движение удерживает отсутствие критерия, по которому можно временно выбрать одно направление.'
    : 'Одна из рабочих гипотез — сейчас важнее прояснить одну точку начала, чем строить полный маршрут изменений.';
  return 'Одна из рабочих гипотез — направление уже достаточно понятно, а основной задачей становится перевод намерения в небольшой проверяемый шаг.';
}

function nextStepFor(answers, practice) {
  if (includes(answers.barrier, 'ошибиться') || includes(answers.risk, 'ошибка')) {
    return 'Выберите один обратимый шаг, который можно проверить без крупной ставки, и заранее определите условие остановки.';
  }
  if (includes(answers.barrier, 'слишком много вариантов')) {
    return 'Сравните варианты по одному критерию и выберите направление для короткого теста, не принимая окончательного решения.';
  }
  return practice?.nextStep || 'Определите одно действие, которое можно безопасно проверить в ближайшие 24 часа.';
}

export function createMockAnalysis(answers, practices) {
  const safety = evaluateSafety(answers);
  if (safety.status === 'safety_stop') {
    return {
      ...fallbackResult(),
      status: 'safety_stop',
      route: null,
      title: 'Сейчас важнее срочная живая поддержка',
      reflection: '',
      observedFacts: [],
      workingHypothesis: '',
      requestDraft: '',
      practiceId: null,
      practiceReason: '',
      nextStep: '',
      humanSupport: { recommended: true, reason: 'Обратитесь в экстренную службу вашего региона или к человеку, которому доверяете.', urgency: 'urgent' },
    };
  }
  if (!hasSufficientData(answers)) return fallbackResult('По вашим ответам уже видно, что необходимость перемен ощущается, но данных пока недостаточно, чтобы уверенно выбрать одну точку начала.');

  const route = resolveMockRoute(answers);
  const practice = selectPractice(practices, {
    route,
    resource: answers.resourceLevel,
    pattern: answers.pattern,
    barrier: answers.barrier,
    need: answers.need,
  });
  const topic = answers.desiredResult || answers.domain?.[0] || 'выбранная ситуация';
  const facts = factList(answers);
  return {
    status: 'ok',
    route,
    title: 'Точка начала, которая сейчас выглядит реалистичной',
    reflection: `В теме «${topic}» необходимость перемен уже заметна. По сочетанию ответов полезнее выбрать один следующий уровень действия, не пытаясь решить всю ситуацию сразу.`,
    observedFacts: facts,
    workingHypothesis: hypothesisFor(route, answers),
    confidence: facts.length >= 3 ? 'medium' : 'low',
    requestDraft: `Как я могу продвинуться в теме «${topic}», учитывая текущий ресурс и то, что меня останавливает?`,
    practiceId: practice?.id || null,
    practiceReason: practice ? `Практика выбрана по сочетанию ресурса, барьера и маршрута ${route}.` : '',
    nextStep: nextStepFor(answers, practice),
    humanSupport: {
      recommended: answers.need?.includes('живым специалистом') || false,
      reason: 'Живой специалист может быть полезен, если самостоятельный шаг снова остановится или потребуется совместно проверить рабочую гипотезу.',
      urgency: 'useful',
    },
    disclaimer: 'Это рабочее предположение, а не диагноз. Проверьте его на собственном опыте.',
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createAiClient({ mode, endpoint = '', practices, timeoutMs = 15000, onValidationError = () => {} }) {
  const knownIds = practiceIds(practices);
  async function analyzeNavigatorAnswers(payload) {
    const safety = evaluateSafety(payload);
    if (safety.status === 'safety_stop') return createMockAnalysis(payload, practices);

    let raw;
    if (mode === AI_MODES.MOCK) {
      raw = createMockAnalysis(payload, practices);
    } else {
      if (!endpoint) throw new Error('AI_ENDPOINT_NOT_CONFIGURED');
      let response;
      try {
        response = await fetchWithTimeout(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }, timeoutMs);
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('AI_TIMEOUT');
        throw new Error(globalThis.navigator?.onLine === false ? 'AI_OFFLINE' : 'AI_NETWORK_ERROR');
      }
      if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);
      try {
        raw = await response.json();
      } catch (error) {
        throw new Error('AI_INVALID_JSON');
      }
    }

    let validation = validateAnalysisResponse(raw, knownIds);
    if (!validation.ok && validation.errors.length === 1 && validation.errors[0] === 'unknown_practice_id') {
      onValidationError({ type: 'unknown_practice_id', practiceId: raw.practiceId });
      raw = {
        ...raw,
        practiceId: null,
        practiceReason: '',
        nextStep: 'Выберите одно небольшое обратимое действие, которое безопасно проверить в ближайшие 24 часа.',
      };
      validation = validateAnalysisResponse(raw, knownIds);
    }
    if (!validation.ok) {
      const error = new Error(`AI_INVALID_RESPONSE:${validation.errors.join(',')}`);
      error.validationErrors = validation.errors;
      throw error;
    }
    return validation.value;
  }
  return { analyzeNavigatorAnswers, mode };
}
