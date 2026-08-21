'use strict';

import { createAiClient, AI_MODES, normalizeNavigatorAnswers } from './src/aiClient.js';
import { createAnalytics } from './src/analytics.js';
import { loadPracticeMap, validatePracticeId } from './src/practiceMap.js';
import { renderAiResult } from './src/resultRenderer.js';
import { evaluateSafety, SAFETY_STOP_ANSWER } from './src/safety.js';

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbxWlWcNAVqCeSRBZYefApC-p2H9JP6CFFzdaAMcaXUSFA9zFebGWSkTAmaDzKkEmSY0/exec';
const SESSION_KEY = 'platformaSessionId';
const NAV_STATE_KEY = 'platformaNavigatorResultState';
const CATALOG_URL = 'specialists.html';
const NONE_AREA = 'Пока сложно определить';
const NONE_TOPIC = 'Пока не могу выбрать';
const AI_ENDPOINT = document.documentElement.dataset.aiEndpoint || '';

function createSessionId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `navigator_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getSessionId() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    const value = existing || createSessionId();
    sessionStorage.setItem(SESSION_KEY, value);
    return value;
  } catch (error) {
    return createSessionId();
  }
}

const sessionId = getSessionId();
const answers = {};
const feedbackState = {
  reflection: '',
  explanation: '',
  clarityAfter: '',
  stepRealism: '',
  trust: '',
  recognition: '',
  repetition: '',
  discuss: '',
  text: '',
};

let idx = 0;
let resultData = null;
let feedbackInitialized = false;
let practices = [];
let aiClient = null;
let analysisInFlight = false;
const shownClarifications = new Set();

const blockInfo = {
  1: {
    label: 'Блок 1 · Текущая точка',
    intro: 'Давайте сначала разберёмся, что сейчас происходит и где находится главная точка напряжения. Здесь нет правильных или неправильных ответов.',
  },
  2: {
    label: 'Блок 2 · Реальный приоритет',
    intro: 'Попробуем найти одну безопасную точку начала. Если выбрать пока не получается, можно так и ответить.',
  },
  3: {
    label: 'Блок 3 · Конкретная ситуация',
    intro: 'Вспомним один недавний момент остановки — так будет легче уйти от общих формулировок.',
  },
  4: {
    label: 'Блок 4 · Зона влияния',
    intro: 'Отделим то, что зависит от вас, от решений других людей и внешних обстоятельств.',
  },
  5: {
    label: 'Блок 5 · Последствия, ресурсы и риски',
    intro: 'Теперь посмотрим на цену бездействия, основные опасения и доступные опоры.',
  },
  6: {
    label: 'Блок 6 · Предыдущие решения и помощь',
    intro: 'Важно понять, что уже было испробовано и чего именно не хватило.',
  },
  7: {
    label: 'Блок 7 · Предпочтительный формат',
    intro: 'Последний шаг — выбрать комфортный способ двигаться дальше и условия доверия к рекомендации.',
  },
};

const areaOptions = [
  'Работа или профессия',
  'Доход и финансовое положение',
  'Собственное дело или реализация',
  'Отношения',
  'Семья и жизненные роли',
  'Образ жизни',
  'Внутреннее состояние',
  NONE_AREA,
];

const fixedQuestions = [
  { id: 'areas', block: 1, type: 'multi', q: 'В какой сфере вы сильнее всего чувствуете необходимость перемен?', options: areaOptions, exclusive: NONE_AREA, help: 'Можно выбрать несколько вариантов.' },
  { id: 'duration', block: 1, type: 'single', q: 'Как давно вы чувствуете, что прежний этап завершается, а новый ещё не сложился?', options: ['До 3 месяцев', '3–6 месяцев', '6–12 месяцев', 'Больше года', 'Мне трудно определить'] },
  { id: 'mainConcern', block: 1, type: 'text', q: 'Что сейчас беспокоит вас сильнее всего?', placeholder: '1–3 коротких предложения', maxLength: 320 },
  { id: 'desiredAction', block: 3, type: 'text', q: 'Вспомните последний случай, когда вы хотели что-то изменить или сделать шаг, но остановились. Что вы хотели сделать?', placeholder: 'Опишите коротко сам шаг', maxLength: 320 },
  { id: 'obstacle', block: 3, type: 'single', q: 'Что остановило вас сильнее всего?', options: ['Не знала, с чего начать', 'Боялась ошибиться', 'Боялась потерять стабильность', 'Не хватило сил или энергии', 'Не хватило денег', 'Не хватило поддержки', 'Решение зависело от другого человека', 'Появилось слишком много вариантов', 'Другое'] },
  { id: 'stopFeeling', block: 3, type: 'text', q: 'Что вы подумали или почувствовали в этот момент?', placeholder: 'Достаточно нескольких слов', maxLength: 240 },
  { id: 'influence', block: 4, type: 'single', q: 'От чего сейчас больше всего зависит изменение ситуации?', options: ['В основном от моих действий', 'От меня и другого человека', 'В основном от решения другого человека', 'От финансовых или внешних обстоятельств', 'Пока не понимаю'] },
  { id: 'ownAction', block: 4, type: 'textOrNone', q: 'Что вы уже можете сделать самостоятельно, не ожидая изменения других людей или обстоятельств?', placeholder: 'Один возможный шаг в вашей зоне влияния', noneLabel: 'Пока не вижу такого действия', maxLength: 320 },
  { id: 'losses', block: 5, type: 'multi', q: 'Что вы теряете, пока ситуация не меняется?', options: ['Время', 'Деньги', 'Энергию', 'Спокойствие', 'Уверенность', 'Возможности', 'Отношения', 'Здоровье или самочувствие', 'Другое'], help: 'Можно выбрать несколько вариантов.' },
  { id: 'risk', block: 5, type: 'single', q: 'Что больше всего пугает вас в возможных изменениях?', options: ['Финансовые потери', 'Ошибка или неудача', 'Потеря стабильности', 'Осуждение окружающих', 'Конфликт с близкими', 'Слишком большая нагрузка', 'Неизвестность', 'Другое'] },
  { id: 'supports', block: 5, type: 'multi', q: 'Что уже может стать вашей опорой?', options: ['Опыт и знания', 'Поддержка близких', 'Финансовый резерв', 'Свободное время', 'Профессиональные контакты', 'Предыдущий успешный опыт', 'Готовность обратиться за помощью', 'Пока не вижу опоры', 'Другое'], exclusive: 'Пока не вижу опоры', help: 'Можно выбрать несколько вариантов.' },
  { id: 'resourceLevel', block: 5, type: 'single', q: 'Сколько сил у вас сейчас на изменения?', options: ['Сейчас сил почти нет', 'Есть силы на один небольшой шаг', 'Есть ресурс для последовательных действий', 'Пока трудно определить'] },
  { id: 'tried', block: 6, type: 'multi', q: 'Что вы уже пробовали, чтобы изменить ситуацию?', options: ['Разбиралась самостоятельно', 'Использовала ChatGPT или другой AI', 'Обращалась к психологу', 'Работала с коучем или наставником', 'Проходила обучение', 'Обсуждала с близкими', 'Начинала действовать, но остановилась', 'Пока ничего не пробовала', 'Другое'], exclusive: 'Пока ничего не пробовала', help: 'Можно выбрать несколько вариантов.' },
  { id: 'missing', block: 6, type: 'single', q: 'Чего не хватило в предыдущих решениях?', options: ['Конкретного плана', 'Понимания главной проблемы', 'Поддержки', 'Контроля и сопровождения', 'Подходящего специалиста', 'Уверенности', 'Времени', 'Денег', 'Решения другого человека', 'Другое'] },
  { id: 'helpClarity', block: 6, type: 'single', q: 'Понимаете ли вы, какая помощь или какой специалист вам сейчас нужен?', options: ['Да, понимаю', 'Есть предположение, но не уверена', 'Нет, не понимаю', 'Возможно, мне пока не нужен специалист'] },
  { id: 'preferredFormat', block: 7, type: 'single', q: 'Какой формат сейчас был бы для вас наиболее комфортным?', options: ['Сначала самостоятельно разобраться с AI', 'Сначала пройти короткое AI-прояснение, затем решить', 'Сразу поговорить с живым специалистом', 'Сочетать AI и сопровождение специалиста', 'Пока не знаю'] },
  { id: 'trustFactors', block: 7, type: 'multi', q: 'Что особенно важно для доверия к рекомендации AI?', options: ['Понимать, почему сделан такой вывод', 'Получить конкретные рекомендации без общих слов', 'Учитывать мою реальную ситуацию', 'Иметь возможность проверить информацию', 'Не передавать лишние личные данные', 'Иметь возможность перейти к живому человеку', 'Другое'], help: 'Можно выбрать несколько вариантов.' },
  { id: 'safetyLevel', block: 7, type: 'single', q: 'Можете ли вы сейчас безопасно продолжить и получить обычный навигационный результат?', options: ['Да, могу продолжить', SAFETY_STOP_ANSWER] },
];

function concreteAreas() {
  return (answers.areas || []).filter((value) => value !== NONE_AREA);
}

function priorityOptions() {
  return [...concreteAreas(), NONE_TOPIC];
}

function questions() {
  const first = fixedQuestions.slice(0, 3);
  const priority = [];
  if (concreteAreas().length > 1) {
    priority.push({
      id: 'priority',
      block: 2,
      type: 'single',
      q: 'Если выбрать только одну тему, изменение которой сильнее всего повлияет на вашу жизнь сейчас, что это будет?',
      options: priorityOptions(),
    });
  }
  if (concreteAreas().length) {
    priority.push({
      id: 'readyTopic',
      block: 2,
      type: 'single',
      q: 'С какой темой вы действительно готовы начать работать сейчас, даже если остальные пока останутся без изменений?',
      options: priorityOptions(),
    });
  } else {
    priority.push({
      id: 'readyTopic',
      block: 2,
      type: 'textOrNone',
      q: 'С какой темой вы действительно готовы начать работать сейчас, даже если остальные пока останутся без изменений?',
      placeholder: 'Можно назвать тему своими словами',
      noneLabel: NONE_TOPIC,
      maxLength: 180,
    });
  }
  return [...first, ...priority, ...fixedQuestions.slice(3)];
}

const IS_LOCAL_PREVIEW = ['localhost', '127.0.0.1'].includes(location.hostname);
const previewEvents = [];
globalThis.__platformaPreviewEvents = previewEvents;
const analytics = createAnalytics({
  endpoint: ENDPOINT,
  sessionId,
  local: IS_LOCAL_PREVIEW,
  sink: previewEvents,
});

function send(payload) {
  if (IS_LOCAL_PREVIEW) {
    previewEvents.push(payload);
    return Promise.resolve({ preview: true });
  }
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    mode: 'no-cors',
    keepalive: true,
  });
}

function sendEvent(event, meta = {}) {
  return analytics.send(event, meta).catch(() => {});
}

function start() {
  try {
    sessionStorage.removeItem(NAV_STATE_KEY);
  } catch (error) {}
  document.getElementById('intro').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  sendEvent('navigator_start');
  render();
}

function render() {
  const list = questions();
  if (idx >= list.length) {
    makeResult();
    return;
  }

  const question = list[idx];
  const info = blockInfo[question.block];
  const previous = list[idx - 1];
  document.getElementById('blockLabel').textContent = info.label;

  const bridge = document.getElementById('bridge');
  const showIntro = !previous || previous.block !== question.block;
  bridge.textContent = showIntro ? info.intro : '';
  bridge.classList.toggle('hidden', !showIntro);

  if (['priority', 'readyTopic'].includes(question.id) && !shownClarifications.has(question.id)) {
    shownClarifications.add(question.id);
    sendEvent('clarification_shown', { questionId: question.id });
  }

  const progress = Math.round((idx / list.length) * 100);
  document.getElementById('bar').style.width = `${progress}%`;
  document.querySelector('.progress').setAttribute('aria-valuenow', String(progress));

  const root = document.getElementById('question');
  root.replaceChildren();
  const title = document.createElement('h2');
  title.textContent = question.q;
  root.appendChild(title);

  if (question.help) {
    const help = document.createElement('p');
    help.className = 'question-help';
    help.textContent = question.help;
    root.appendChild(help);
  }

  if (question.type === 'text' || question.type === 'textOrNone') {
    const textarea = document.createElement('textarea');
    textarea.id = 'currentTextAnswer';
    textarea.className = 'short';
    textarea.placeholder = question.placeholder || '';
    textarea.maxLength = question.maxLength || 320;
    textarea.value = answers[question.id] === question.noneLabel ? '' : (answers[question.id] || '');
    textarea.addEventListener('input', () => {
      answers[question.id] = textarea.value.trimStart();
    });
    root.appendChild(textarea);
    if (question.type === 'textOrNone') {
      const options = document.createElement('div');
      options.className = 'options';
      options.appendChild(optionButton(question, question.noneLabel));
      root.appendChild(options);
    }
  } else {
    const options = document.createElement('div');
    options.className = 'options';
    question.options.forEach((value) => options.appendChild(optionButton(question, value)));
    root.appendChild(options);
  }

  document.getElementById('back').style.visibility = idx === 0 ? 'hidden' : 'visible';
  document.getElementById('next').textContent = idx === list.length - 1 ? 'Получить результат' : 'Продолжить';
}

function optionButton(question, value) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'option';
  button.textContent = value;
  const selected = Array.isArray(answers[question.id])
    ? answers[question.id].includes(value)
    : answers[question.id] === value;
  button.classList.toggle('selected', selected);
  button.setAttribute('aria-pressed', String(selected));
  button.addEventListener('click', () => pick(question, value));
  return button;
}

function pick(question, value) {
  if (question.type === 'multi') {
    const current = answers[question.id] || [];
    if (question.exclusive && value === question.exclusive) {
      answers[question.id] = current.includes(value) ? [] : [value];
    } else {
      const clean = question.exclusive
        ? current.filter((item) => item !== question.exclusive)
        : current;
      answers[question.id] = clean.includes(value)
        ? clean.filter((item) => item !== value)
        : [...clean, value];
    }
  } else {
    answers[question.id] = value;
  }

  if (question.id === 'areas') {
    const allowed = priorityOptions();
    if (answers.priority && !allowed.includes(answers.priority)) delete answers.priority;
    if (answers.readyTopic && !allowed.includes(answers.readyTopic)) delete answers.readyTopic;
  }
  render();
}

function valid(question) {
  const value = answers[question.id];
  return Array.isArray(value)
    ? value.length > 0
    : typeof value === 'string' && value.trim().length > 0;
}

function goNext() {
  const list = questions();
  const question = list[idx];
  if (question.type === 'text' || question.type === 'textOrNone') {
    const field = document.getElementById('currentTextAnswer');
    if (field?.value.trim()) answers[question.id] = field.value.trim();
  }
  if (!valid(question)) {
    alert('Выберите вариант или напишите короткий ответ');
    return;
  }
  sendEvent('question_answered', {
    questionId: question.id,
    answerType: question.type,
    selectionCount: Array.isArray(answers[question.id]) ? answers[question.id].length : 1,
  });
  idx += 1;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goBack() {
  if (idx === 0) return;
  idx -= 1;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function safetySignal() {
  return evaluateSafety({
    ...normalizeNavigatorAnswers(answers, sessionId),
    mainConcern: answers.mainConcern,
    desiredAction: answers.desiredAction,
    stopFeeling: answers.stopFeeling,
    ownAction: answers.ownAction,
    safetyLevel: answers.safetyLevel,
  }).status === 'safety_stop';
}

function selectedTopic(value) {
  return value && value !== NONE_TOPIC ? value : '';
}

function deriveInsightPattern(currentAnswers, context) {
  const tried = (currentAnswers.tried || []).filter((value) => value !== 'Пока ничего не пробовала');
  const supports = currentAnswers.supports || [];
  const losses = currentAnswers.losses || [];
  const hasEstablishedResource = supports.some((value) => [
    'Опыт и знания',
    'Предыдущий успешный опыт',
  ].includes(value));
  const hasVariedAttempts = tried.length >= 2;

  if (currentAnswers.obstacle === 'Появилось слишком много вариантов'
    && hasEstablishedResource
    && hasVariedAttempts) {
    return {
      code: 'choice_criteria',
      conclusion: 'По сочетанию ответов можно предположить, что сложность сейчас не в недостатке идей, знаний или опыта. Возможный рабочий узел — отсутствие понятного критерия, по которому можно выбрать одно направление и временно отказаться от остальных. Поиск новых вариантов в такой ситуации, скорее всего, будет усиливать неопределённость, а не помогать двигаться.',
      basis: 'Одновременно присутствуют накопленные ресурсы, несколько уже испробованных способов и остановка на этапе выбора между вариантами.',
      confidenceLimit: 'Это рабочая гипотеза по текущим ответам. Её полезно проверить на одном конкретном выборе, а не принимать как окончательное объяснение.',
    };
  }

  const usedReflectionSupport = tried.some((value) => [
    'Разбиралась самостоятельно',
    'Использовала ChatGPT или другой AI',
    'Обращалась к психологу',
    'Работала с коучем или наставником',
  ].includes(value));
  const lacksActionBridge = ['Конкретного плана', 'Уверенности', 'Понимания главной проблемы'].includes(currentAnswers.missing);
  if (tried.includes('Проходила обучение')
    && usedReflectionSupport
    && tried.includes('Начинала действовать, но остановилась')
    && lacksActionBridge) {
    return {
      code: 'knowledge_action_gap',
      conclusion: 'По сочетанию ответов похоже, что добавление нового знания само по себе может не изменить ситуацию. Возможный рабочий узел находится между пониманием и устойчивым действием, поэтому следующий шаг полезнее строить как небольшую проверку на практике, а не как ещё один объём информации.',
      basis: 'Уже сочетались обучение, способы осмысления ситуации и попытка действовать, но движение не стало устойчивым.',
      confidenceLimit: 'Ответы не показывают все причины остановки. Вывод стоит проверить по одному небольшому действию и фактической реакции на него.',
    };
  }

  const relationshipTopic = context.areas.some((value) => ['Отношения', 'Семья и жизненные роли'].includes(value))
    || ['Отношения', 'Семья и жизненные роли'].includes(context.workTopic);
  if (context.external && relationshipTopic) {
    return {
      code: 'external_boundary',
      conclusion: 'По сочетанию ответов рабочий узел, вероятно, находится не в поиске способа убедить другого человека. Полезнее определить собственное решение, границы и действия для разных вариантов его ответа.',
      basis: 'Тема связана с отношениями или семейной ролью, а изменение ситуации зависит не только от ваших действий.',
      confidenceLimit: 'Навигатор не знает позиции другого человека и не оценивает отношения целиком. Вывод касается только вашей доступной зоны влияния.',
    };
  }

  if (currentAnswers.obstacle === 'Не хватило сил или энергии'
    && losses.includes('Энергию')
    && currentAnswers.risk === 'Слишком большая нагрузка') {
    return {
      code: 'limited_capacity',
      conclusion: 'По сочетанию ответов большой план сейчас может усиливать остановку. Возможный рабочий узел — несоответствие масштаба задачи доступному ресурсу, поэтому сначала важно уменьшить действие и проверить, какой уровень нагрузки действительно реалистичен.',
      basis: 'Остановка, цена бездействия и основной риск одновременно связаны с энергией и нагрузкой.',
      confidenceLimit: 'Это не оценка состояния здоровья и не диагноз. Если истощение выраженное или длительное, одной навигации может быть недостаточно.',
    };
  }

  const hasDesiredAction = typeof currentAnswers.desiredAction === 'string'
    && currentAnswers.desiredAction.trim().length > 0;
  if (context.workIsBusiness
    && currentAnswers.risk === 'Финансовые потери'
    && hasDesiredAction) {
    return {
      code: 'financial_reversible_test',
      conclusion: 'По сочетанию ответов сейчас полезнее не принимать окончательное финансовое решение, а превратить намерение в обратимый тест без существенных вложений. Такой тест даст факты для выбора и ограничит цену возможной ошибки.',
      basis: 'Запрос связан с работой, доходом или реализацией, при этом желаемое действие уже обозначено, а главным риском воспринимаются финансовые потери.',
      confidenceLimit: 'Навигатор не оценивает финансовую модель и не заменяет профильную консультацию. Размер безопасного теста нужно определять по вашим реальным ограничениям.',
    };
  }

  return {
    code: 'insufficient_data',
    conclusion: 'По текущим ответам пока нельзя уверенно выделить один рабочий узел. Полезнее сначала уточнить конкретный момент, в котором действие останавливается.',
    basis: 'Выбранное сочетание не даёт достаточных оснований для одного содержательного вывода без искусственно уверенной интерпретации.',
    confidenceLimit: 'Это ограничение результата, а не оценка вашей ситуации. Дополнительный конкретный пример может изменить вывод.',
  };
}

function deriveResult() {
  const areas = concreteAreas();
  const explicitReadyTopic = selectedTopic(answers.readyTopic);
  const importantTopic = selectedTopic(answers.priority) || (areas.length === 1 ? areas[0] : '');
  const readyUndecided = answers.readyTopic === NONE_TOPIC;
  const workTopic = explicitReadyTopic || (!answers.readyTopic ? importantTopic : '');
  const topicsDiffer = Boolean(importantTopic && workTopic && importantTopic !== workTopic);

  const exhausted = answers.obstacle === 'Не хватило сил или энергии'
    || (answers.losses || []).includes('Энергию')
    || answers.risk === 'Слишком большая нагрузка';
  const external = ['От меня и другого человека', 'В основном от решения другого человека'].includes(answers.influence)
    || answers.obstacle === 'Решение зависело от другого человека';
  const unclear = readyUndecided
    || !workTopic
    || answers.influence === 'Пока не понимаю'
    || answers.obstacle === 'Появилось слишком много вариантов';
  const needsStructure = answers.obstacle === 'Не знала, с чего начать'
    || answers.missing === 'Конкретного плана'
    || answers.missing === 'Понимания главной проблемы';
  const workIsBusiness = ['Работа или профессия', 'Доход и финансовое положение', 'Собственное дело или реализация'].includes(workTopic);
  const workFitsDiana = ['Внутреннее состояние', 'Отношения', 'Семья и жизненные роли', 'Образ жизни'].includes(workTopic);
  const insight = deriveInsightPattern(answers, {
    areas,
    workTopic,
    external,
    exhausted,
    workIsBusiness,
  });

  let route = 'R4';
  if (unclear) route = 'R1';
  else if (external) route = 'R3';
  else if (exhausted) route = 'R2';

  const confident = !unclear;
  let mainTopic = workTopic || 'Точка начала пока не определена';
  if (external && ['Отношения', 'Семья и жизненные роли'].includes(workTopic)) {
    mainTopic = 'Собственное решение и границы в отношениях';
  } else if (exhausted && workTopic === 'Внутреннее состояние') {
    mainTopic = 'Внутренняя опора и восстановление ресурса';
  } else if (exhausted && workIsBusiness) {
    mainTopic = 'Восстановление ресурса в теме реализации';
  }

  let topicSummary = '';
  if (readyUndecided) {
    topicSummary = 'Сфера напряжения уже заметна, но точка начала пока не определена.';
  } else if (topicsDiffer) {
    topicSummary = `Сильнее всего на вашу жизнь сейчас влияет тема «${importantTopic}», но начать вы готовы с темы «${workTopic}». Поэтому первый шаг построен вокруг той области, в которой действие сейчас реалистично.`;
  } else if (workTopic) {
    topicSummary = `Тема, с которой вы готовы начать сейчас: «${workTopic}».`;
  } else {
    topicSummary = 'Пока нельзя уверенно определить тему, с которой реалистично начать.';
  }

  const barriers = [answers.obstacle, answers.risk]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 2);

  let firstStep = '';
  if (insight.code === 'choice_criteria') {
    firstStep = 'Выберите не направление, а три критерия выбора: ожидаемый эффект, обратимость и возможность получить первые факты за семь дней. Сравните по ним не больше трёх вариантов и временно протестируйте один с наибольшим совпадением — без окончательного отказа от остальных.';
  } else if (insight.code === 'knowledge_action_gap') {
    firstStep = 'На ближайшие 48 часов не добавляйте новое обучение. Выберите одно действие длительностью до 30 минут, заранее запишите наблюдаемый результат и после выполнения зафиксируйте только факты: что удалось начать, где возникла остановка и чего не хватило.';
  } else if (unclear) {
    firstStep = 'В течение ближайших суток сравните возможные точки начала: для каждой запишите, какого небольшого изменения вы хотите, что зависит от вас и какой шаг можно безопасно проверить за 20 минут. Выбирать окончательное решение пока не нужно.';
  } else if (external) {
    firstStep = 'В течение ближайших двух дней разделите лист на две колонки: «решает другой человек» и «решаю я». Запишите по три пункта и выберите одно действие только из своей колонки — например, подготовить вопрос, обозначить границу или определить собственное решение.';
  } else if (exhausted && needsStructure) {
    firstStep = 'На ближайшие 48 часов выберите только три обязательных дела, а одно необязательное сознательно отложите. Рядом запишите самый короткий следующий шаг по теме, с которой вы готовы начать, — не больше 20 минут.';
  } else if (exhausted) {
    firstStep = 'В течение ближайших суток освободите один 30‑минутный отрезок без новых задач и запишите: что сейчас забирает больше всего сил, что можно временно сократить и какой один шаг по выбранной теме остаётся посильным.';
  } else if (answers.risk === 'Финансовые потери' && workIsBusiness) {
    firstStep = 'За ближайшие 1–3 дня опишите идею в пяти предложениях и покажите её трём потенциальным клиентам без вложений и запуска. Зафиксируйте только их вопросы и готовность продолжить разговор.';
  } else if (needsStructure) {
    firstStep = 'В течение ближайших двух дней запишите три последовательных действия по теме, с которой вы готовы начать, и выполните только первое, если оно занимает не больше 30 минут и не требует необратимых решений.';
  } else {
    firstStep = 'Выберите на ближайшие 1–3 дня один обратимый шаг по теме, с которой вы готовы начать, — не больше часа. Заранее запишите, какую новую информацию он должен дать.';
  }

  let influenceText = '';
  if (answers.influence === 'В основном от моих действий') {
    influenceText = 'Основная часть следующего шага находится в вашей зоне влияния. Сейчас полезно сосредоточиться на одном обратимом действии, а не на полном решении задачи.';
  } else if (answers.influence === 'От меня и другого человека') {
    influenceText = 'Часть результата зависит от другого человека. В вашей зоне влияния остаются подготовка разговора, собственные границы, вопросы и решение о том, как вы поступите при разных ответах.';
  } else if (answers.influence === 'В основном от решения другого человека') {
    influenceText = 'Итог во многом зависит от решения другого человека. Навигатор не предлагает влиять или давить на него; сейчас стоит сосредоточиться на своих границах, подготовке и собственном выборе.';
  } else if (answers.influence === 'От финансовых или внешних обстоятельств') {
    influenceText = 'Внешние условия нельзя отменить, но можно проверить факты, оценить доступный резерв и подготовить небольшой тест без резкого риска.';
  } else {
    influenceText = 'Граница влияния пока неясна. Первым полезным действием будет разделить факты, решения других людей и собственные возможные шаги.';
  }

  if (answers.ownAction && answers.ownAction !== 'Пока не вижу такого действия') {
    const ownActionText = answers.ownAction.replace(/[.!?]+$/, '');
    influenceText += ` Вы уже назвали возможное действие: «${ownActionText}». Его можно использовать как отправную точку, если оно остаётся безопасным и реалистичным.`;
  } else if (answers.ownAction === 'Пока не вижу такого действия') {
    influenceText += ' Пока собственное действие не определено, поэтому дополнительное прояснение может быть полезнее резкого шага.';
  }

  let currentPoint = '';
  if (insight.code === 'choice_criteria') {
    currentPoint = 'Возможности и опоры для действия уже есть. Остановка, похоже, происходит не на этапе поиска новых направлений, а на этапе выбора, какому из них временно дать приоритет.';
  } else if (insight.code === 'knowledge_action_gap') {
    currentPoint = 'Понимание ситуации уже подкреплялось разными способами, но переход к устойчивому действию пока не сложился. Следующая проверка должна происходить в действии, а не только в размышлении.';
  } else if (insight.code === 'financial_reversible_test') {
    currentPoint = 'Намерение действовать уже сформулировано, но цена финансовой ошибки воспринимается как существенная. Поэтому сначала нужна проверка, которая даст факты без крупного обязательства.';
  } else if (readyUndecided) {
    currentPoint = areas.length === 1
      ? `Напряжение в теме «${areas[0]}» уже заметно, но пока нельзя уверенно сказать, что начинать стоит именно с неё. Сначала полезно уточнить конкретный момент, в котором действие останавливается.`
      : 'По вашим ответам видно, что необходимость перемен уже ощущается, но пока недостаточно данных, чтобы уверенно выбрать одну точку начала. Сейчас полезнее уточнить конкретный момент остановки, чем делать широкий вывод о всей ситуации.';
  } else if (topicsDiffer) {
    currentPoint = topicSummary;
  } else if (external && exhausted) {
    currentPoint = `Основной узел сейчас связан с тем, что часть результата зависит от другого человека. Одновременно сниженный ресурс ограничивает доступный масштаб действия, поэтому следующий шаг должен оставаться небольшим и полностью в вашей зоне влияния.`;
  } else if (external) {
    currentPoint = `Сейчас наиболее заметной выглядит тема «${workTopic}». При этом часть результата находится вне вашего прямого контроля.`;
  } else if (exhausted) {
    currentPoint = `Необходимость перемен в теме «${workTopic}» уже заметна, но ресурс сейчас ограничен. Поэтому скорость и масштаб шага важнее амбициозности.`;
  } else {
    currentPoint = `Похоже, вы готовы начать с темы «${workTopic}», но между намерением и действием остаётся конкретный барьер.`;
  }

  let why = insight.code === 'insufficient_data'
    ? 'Сейчас важнее получить один конкретный пример остановки, чем делать широкий вывод по недостаточным данным. Такой пример позволит отделить факты от предположений и выбрать следующий шаг точнее.'
    : 'Предложенный шаг проверяет аналитический вывод на практике: он ограничивает риск, создаёт наблюдаемый результат и помогает получить новую информацию без необратимого решения.';
  if (topicsDiffer) {
    why = `${topicSummary} ${why}`;
  }
  if (external && exhausted) {
    why += ' Зависимость от решения другого человека рассматривается как основной узел, а сниженный ресурс — как ограничение при выборе масштаба действия.';
  }

  const wantsHuman = ['Сразу поговорить с живым специалистом', 'Сочетать AI и сопровождение специалиста'].includes(answers.preferredFormat);
  let support = '';
  let specialistType = '';
  let recommendDiana = false;

  if (unclear) {
    support = 'Сейчас полезно короткое AI‑прояснение или разовая консультация для выбора точки начала. Данных для уверенной рекомендации конкретного специалиста пока недостаточно.';
    specialistType = 'Короткое прояснение';
  } else if (external) {
    support = exhausted
      ? 'Может подойти разовая психологическая консультация для прояснения границ и собственного решения с учётом сниженного ресурса.'
      : 'Полезна разовая психологическая консультация для прояснения собственных границ и решения без попытки управлять другим человеком.';
    specialistType = 'Разовая консультация для прояснения';
    recommendDiana = wantsHuman && workFitsDiana;
  } else if (exhausted) {
    support = 'Может подойти психологическая поддержка или разовая консультация, чтобы восстановить опору и не усиливать перегрузку.';
    specialistType = 'Психологическая поддержка';
    recommendDiana = wantsHuman && workFitsDiana;
  } else if (workIsBusiness && needsStructure) {
    support = 'Может подойти коуч, наставник по реализации или профильный бизнес‑специалист, который поможет превратить цель в проверяемый план.';
    specialistType = 'Коуч, наставник или бизнес‑специалист';
  } else if (answers.helpClarity === 'Возможно, мне пока не нужен специалист' && !wantsHuman) {
    support = 'Пока можно продолжить самостоятельно: выполнить первый шаг и вернуться к результату после появления новой информации.';
    specialistType = 'Самостоятельный формат с AI';
  } else {
    support = 'Подойдёт связка самостоятельного шага и короткой консультации, если после проверки останется неясность.';
    specialistType = 'AI и разовая консультация';
    recommendDiana = wantsHuman && workFitsDiana;
  }

  const dianaReason = external
    ? 'Диана может помочь отделить собственное решение и границы от того, что зависит от другого человека.'
    : 'Диана работает с внутренней опорой и перегрузкой — это соответствует теме, с которой вы готовы начать.';

  return {
    route,
    importantTopic,
    workTopic,
    topicsDiffer,
    mainTopic,
    confident,
    topicSummary,
    currentPoint,
    influenceText,
    barriers,
    firstStep,
    why,
    support,
    specialistType,
    recommendDiana,
    dianaReason,
    insight,
    analyticsPriority: workTopic || 'Приоритет требует уточнения',
  };
}

function resultSection(title, text) {
  const section = document.createElement('section');
  section.className = 'result-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  section.append(heading, paragraph);
  return section;
}

function normalizedInsight(insight) {
  return insight || {
    code: 'insufficient_data',
    conclusion: 'По текущим ответам пока нельзя уверенно выделить один рабочий узел. Полезнее сначала уточнить конкретный момент, в котором действие останавливается.',
    basis: 'Сохранённый результат был сформирован предыдущей версией навигатора и не содержит нового аналитического слоя.',
    confidenceLimit: 'Для обновлённого вывода можно пройти навигатор ещё раз.',
  };
}

function insightSection(insight) {
  const value = normalizedInsight(insight);
  const section = resultSection('Что показывает сочетание ваших ответов', value.conclusion);
  section.classList.add('insight-section');
  const basis = document.createElement('p');
  basis.className = 'insight-meta';
  basis.textContent = `Основание вывода: ${value.basis}`;
  const confidence = document.createElement('p');
  confidence.className = 'insight-meta';
  confidence.textContent = `Ограничение уверенности: ${value.confidenceLimit}`;
  section.append(basis, confidence);
  return section;
}

function renderResult(data) {
  const practice = validatePracticeId(practices, data.practiceId);
  renderAiResult(
    document.getElementById('resultBlocks'),
    document.getElementById('resultTitle'),
    data,
    practice,
  );
  const details = document.getElementById('practiceDetails');
  details?.addEventListener('toggle', () => {
    if (details.open && !details.dataset.tracked) {
      details.dataset.tracked = 'true';
      sendEvent('practice_opened', { practiceId: data.practiceId, route: data.route });
    }
  });
}

function persistNavigatorResult() {
  try {
    sessionStorage.setItem(NAV_STATE_KEY, JSON.stringify({
      answers,
      resultData,
    }));
  } catch (error) {}
}

function restoreNavigatorResultOnHistoryNavigation() {
  const navigation = performance.getEntriesByType('navigation')[0];
  if (navigation?.type !== 'back_forward') return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(NAV_STATE_KEY) || 'null');
    if (!saved?.resultData || !saved?.answers) return;
    Object.assign(answers, saved.answers);
    resultData = saved.resultData;
    document.getElementById('intro').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('safety').classList.add('hidden');
    document.getElementById('result').classList.remove('hidden');
    document.getElementById('feedback').classList.remove('hidden');
    document.getElementById('finish').classList.add('hidden');
    document.getElementById('specialistRecommendation').classList.add('hidden');
    document.getElementById('supportDetails').classList.add('hidden');
    renderResult(resultData);
    prepareSpecialist(resultData);
    setupFeedback();
  } catch (error) {}
}

async function makeResult() {
  if (analysisInFlight) return;
  document.getElementById('app').classList.add('hidden');
  if (safetySignal()) {
    document.getElementById('safety').classList.remove('hidden');
    send({
      sessionId,
      status: 'безопасный выход',
      event: 'result_status',
      resultStatus: 'safety_stop',
      safetyLevel: 'Требуется срочная помощь',
      route: null,
      bookingClicked: false,
      comment: '',
      name: '',
      contact: '',
      consent: false,
      source: 'AI-навигатор Платформа · safety',
    }).catch(() => {});
    return;
  }

  analysisInFlight = true;
  document.getElementById('analysisError').classList.add('hidden');
  document.getElementById('analysisLoading').classList.remove('hidden');
  const loadingItems = [...document.querySelectorAll('.loading-step')];
  let stage = 0;
  const loadingTimer = setInterval(() => {
    stage = Math.min(stage + 1, loadingItems.length - 1);
    loadingItems.forEach((item, index) => item.classList.toggle('active', index === stage));
  }, 900);
  try {
    const normalized = normalizeNavigatorAnswers(answers, sessionId);
    resultData = await aiClient.analyzeNavigatorAnswers(normalized);
    const practice = validatePracticeId(practices, resultData.practiceId);
    if (resultData.practiceId && !practice) {
      sendEvent('practice_validation_error', { practiceId: resultData.practiceId });
      resultData.practiceId = null;
    }
    renderResult(resultData);
    persistNavigatorResult();
    document.getElementById('result').classList.remove('hidden');
    document.getElementById('feedback').classList.remove('hidden');
    document.getElementById('finish').classList.add('hidden');
    document.getElementById('specialistRecommendation').classList.add('hidden');
    document.getElementById('supportDetails').classList.add('hidden');
    prepareSpecialist(resultData);
    setupFeedback();
    sendEvent('result_generated', { aiMode: aiClient.mode });
    sendEvent('result_status', { resultStatus: resultData.status, confidence: resultData.confidence });
    if (resultData.route) sendEvent('route_assigned', { route: resultData.route });
    if (resultData.practiceId) sendEvent('practice_shown', { practiceId: resultData.practiceId, route: resultData.route });
    document.getElementById('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    const message = error.message === 'AI_TIMEOUT'
      ? 'AI-анализ занял слишком много времени. Ваши ответы не потеряны. Попробуйте ещё раз.'
      : error.message === 'AI_OFFLINE'
        ? 'Нет соединения с интернетом. Ваши ответы не потеряны. Подключитесь к сети и попробуйте ещё раз.'
        : 'Сейчас не удалось сформировать результат. Ваши ответы не потеряны. Попробуйте ещё раз.';
    document.getElementById('analysisErrorText').textContent = message;
    document.getElementById('analysisError').classList.remove('hidden');
  } finally {
    clearInterval(loadingTimer);
    document.getElementById('analysisLoading').classList.add('hidden');
    analysisInFlight = false;
  }
}

function prepareSpecialist(data) {
  const topic = answers.readyTopic || answers.priority || (answers.areas || [])[0] || 'мой запрос';
  document.getElementById('specialistMatch').textContent = 'Вы можете самостоятельно изучить профиль и решить, соответствует ли направление работы специалиста вашему запросу.';
  const message = `Здравствуйте, Диана! Я прошла AI-навигатор на платформе. Моя основная тема — ${topic}. Хочу уточнить подробности`;
  document.getElementById('booking').href = `https://wa.me/77774563866?text=${encodeURIComponent(message)}`;
}

function showSupport() {
  sendEvent('support_format_clicked', {
    route: resultData.route,
    supportType: resultData.humanSupport.urgency,
  });
  const box = document.getElementById('supportDetails');
  box.classList.remove('hidden');
  const specialist = document.getElementById('specialistRecommendation');
  if (resultData.humanSupport.recommended) {
    document.getElementById('supportMore').textContent = resultData.humanSupport.reason;
    specialist.classList.remove('hidden');
  } else {
    document.getElementById('supportMore').textContent = resultData.humanSupport.reason;
    specialist.classList.add('hidden');
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function goToCatalog() {
  if (!CATALOG_URL) {
    const box = document.getElementById('supportDetails');
    document.getElementById('supportMore').textContent = 'Страница каталога ещё не подключена к этому проекту.';
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  sendEvent('specialists_clicked', {
    route: resultData.route,
    source: 'navigator_result',
  });
  location.href = CATALOG_URL;
}

function trackBooking() {
  send({
    sessionId,
    status: 'переход к записи',
    bookingClicked: true,
    route: resultData.route,
    source: 'navigator_result_card',
    event: 'whatsapp_clicked',
    specialistId: 'diana_kim',
    page: 'navigator_result',
    timestamp: new Date().toISOString(),
  }).catch(() => {});
}

function saveResult() {
  const practice = validatePracticeId(practices, resultData.practiceId);
  const lines = [
    'ПЛАТФОРМА — результат AI-навигатора',
    '',
    `Что сейчас видно: ${resultData.reflection}`,
    `Наблюдаемые факты: ${resultData.observedFacts.join(' · ')}`,
    `Рабочая гипотеза: ${resultData.workingHypothesis}`,
    `Как можно сформулировать запрос: ${resultData.requestDraft}`,
    `Первый шаг: ${practice?.text || resultData.nextStep}`,
    `Когда может быть полезен человек: ${resultData.humanSupport.reason}`,
    resultData.disclaimer,
  ];
  const blob = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'platforma-result.txt';
  link.click();
  URL.revokeObjectURL(url);
  sendEvent('navigator_result_saved', { route: resultData.route, resultStatus: resultData.status });
}

function restartNavigator() {
  try {
    sessionStorage.removeItem(NAV_STATE_KEY);
  } catch (error) {}
  setTimeout(() => location.reload(), 80);
}

function setupFeedback() {
  if (feedbackInitialized) return;
  feedbackInitialized = true;
  scoreBox('reflectionScore', (value) => {
    feedbackState.reflection = String(value);
  });
  scoreBox('explanationScore', (value) => {
    feedbackState.explanation = String(value);
  });
  scoreBox('clarityAfterScore', (value) => {
    feedbackState.clarityAfter = String(value);
  });
  scoreBox('stepRealismScore', (value) => {
    feedbackState.stepRealism = String(value);
  });
  scoreBox('trustScore', (value) => {
    feedbackState.trust = String(value);
  });
  choiceBox('feedbackDiscuss', ['Да', 'Возможно позже', 'Нет'], (value) => {
    feedbackState.discuss = value;
  });
  choiceBox('recognition', ['Да, точно', 'Частично', 'Скорее нет'], (value) => {
    feedbackState.recognition = value;
  });
  choiceBox('repetition', ['Да', 'Нет'], (value) => {
    feedbackState.repetition = value;
  });
  document.getElementById('feedbackText').addEventListener('input', (event) => {
    feedbackState.text = event.target.value.slice(0, 500);
  });
}

function scoreBox(id, setter) {
  const root = document.getElementById(id);
  [1, 2, 3, 4, 5].forEach((value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(value);
    button.setAttribute('aria-label', `Оценка ${value} из 5`);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      setter(value);
      [...root.children].forEach((item, index) => {
        const on = index < value;
        item.classList.toggle('on', on);
        item.setAttribute('aria-pressed', String(on));
      });
    });
    root.appendChild(button);
  });
}

function choiceBox(id, values, setter) {
  const root = document.getElementById(id);
  values.forEach((value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.textContent = value;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      setter(value);
      [...root.children].forEach((item) => {
        const on = item === button;
        item.classList.toggle('selected', on);
        item.setAttribute('aria-pressed', String(on));
      });
    });
    root.appendChild(button);
  });
}

function safeOpenText(value, maxLength) {
  const text = String(value || '').trim().replace(/\s+/gu, ' ').slice(0, maxLength);
  if (!text) return '';
  const sensitivePatterns = [
    /(?:https?:\/\/|www\.|@|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b)/iu,
    /(?:\+?\d[\d\s().-]{7,}\d)/u,
    /(?:меня зовут|мо[её] имя|телефон|whatsapp|telegram|телеграм|почта|e-?mail|адрес|улица|квартира)/iu,
    /(?:не хочу жить|суицид|самоубий|убить себя|самоповреж|угроза жизни|избивает|насилие|потеря сознания)/iu,
  ];
  return sensitivePatterns.some((pattern) => pattern.test(text)) ? '' : text;
}

function structuredPayload() {
  const practice = validatePracticeId(practices, resultData.practiceId);
  const structuredSummary = `Отражение: ${feedbackState.reflection} · Понятность объяснения: ${feedbackState.explanation} · Ясность после: ${feedbackState.clarityAfter} · Реалистичность шага: ${feedbackState.stepRealism} · Доверие: ${feedbackState.trust} · Узнавание: ${feedbackState.recognition} · Простое повторение: ${feedbackState.repetition}`;
  const feedbackComment = feedbackState.text.trim();
  const openTextConsent = document.getElementById('openTextConsent').checked;
  const payload = {
    sessionId,
    status: 'завершено',
    event: 'feedback_submitted',
    resultStatus: resultData.status,
    mainSituation: (answers.areas || []).join(' · '),
    mainConcern: answers.obstacle || '',
    duration: answers.duration || '',
    lifeImpact: (answers.losses || []).join(' · '),
    triedBefore: (answers.tried || []).join(' · '),
    desiredResult: answers.readyTopic || answers.priority || '',
    currentNeed: answers.preferredFormat || '',
    resourceLevel: answers.resourceLevel || '',
    safetyLevel: 'Обычный маршрут',
    route: resultData.route,
    practice: practice?.id || '',
    reflectionScore: feedbackState.reflection,
    explanationScore: feedbackState.explanation,
    clarityScore: feedbackState.clarityAfter,
    stepRealism: feedbackState.stepRealism,
    trustScore: feedbackState.trust,
    recognition: feedbackState.recognition,
    repetition: feedbackState.repetition,
    bookingReadiness: feedbackState.discuss,
    bookingClicked: false,
    comment: structuredSummary,
    name: '',
    contact: '',
    consent: true,
    source: 'AI-навигатор Платформа · MVP v3 beta',
    timestamp: new Date().toISOString(),
  };
  if (openTextConsent) {
    payload.openConcern = safeOpenText(answers.mainConcern, 320);
    payload.openFeedback = safeOpenText(feedbackComment, 500);
    payload.comment = payload.openFeedback ? `${structuredSummary} · Открытая обратная связь: ${payload.openFeedback}` : structuredSummary;
  }
  return payload;
}

async function submitFeedback() {
  if (!feedbackState.reflection
    || !feedbackState.explanation
    || !feedbackState.clarityAfter
    || !feedbackState.stepRealism
    || !feedbackState.trust
    || !feedbackState.recognition
    || !feedbackState.repetition
    || !feedbackState.discuss) {
    alert('Пожалуйста, ответьте на все короткие вопросы');
    return;
  }
  if (!document.getElementById('consent').checked) {
    alert('Нужно согласие на отправку обратной связи команде проекта');
    return;
  }

  const button = document.getElementById('submitFeedbackButton');
  button.disabled = true;
  document.getElementById('sendStatus').textContent = 'Сохраняю обратную связь…';
  try {
    await send(structuredPayload());
    document.getElementById('finishText').textContent = 'Обратная связь сохранена. Результат остаётся доступен выше.';
    document.getElementById('feedback').classList.add('hidden');
    document.getElementById('finish').classList.remove('hidden');
    document.getElementById('finish').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    document.getElementById('sendStatus').textContent = 'Не удалось сохранить ответы. Проверьте интернет и попробуйте ещё раз.';
    button.disabled = false;
  }
}

function skipFeedback() {
  document.getElementById('finishText').textContent = 'Вы сможете вернуться к обратной связи позже. Результат и дальнейшие действия остаются доступны.';
  document.getElementById('feedback').classList.add('hidden');
  document.getElementById('finish').classList.remove('hidden');
  document.getElementById('finish').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.getElementById('startButton').addEventListener('click', start);
document.getElementById('back').addEventListener('click', goBack);
document.getElementById('next').addEventListener('click', goNext);
document.getElementById('saveResultButton').addEventListener('click', saveResult);
document.getElementById('restartButton').addEventListener('click', restartNavigator);
document.getElementById('supportButton').addEventListener('click', showSupport);
document.getElementById('specialistsButton').addEventListener('click', goToCatalog);
document.getElementById('booking').addEventListener('click', trackBooking);
document.getElementById('profileLink').addEventListener('click', () => {
  sendEvent('profile_opened', {
    specialistId: 'diana_kim',
    source: 'navigator_result_card',
    route: resultData.route,
  });
});
document.getElementById('submitFeedbackButton').addEventListener('click', submitFeedback);
document.getElementById('skipFeedbackButton').addEventListener('click', skipFeedback);
document.getElementById('retryAnalysisButton').addEventListener('click', makeResult);
document.getElementById('returnToResultButton').addEventListener('click', () => {
  document.getElementById('result').scrollIntoView({ behavior: 'smooth' });
});
document.getElementById('safetyRestartButton').addEventListener('click', () => {
  setTimeout(() => location.reload(), 80);
});
document.getElementById('heroImage').addEventListener('error', (event) => {
  event.currentTarget.hidden = true;
  event.currentTarget.parentElement.classList.add('image-fallback');
});

async function initializeV3() {
  const startButton = document.getElementById('startButton');
  startButton.disabled = true;
  try {
    practices = await loadPracticeMap();
    const mode = IS_LOCAL_PREVIEW ? AI_MODES.MOCK : AI_MODES.LIVE;
    aiClient = createAiClient({
      mode,
      endpoint: AI_ENDPOINT,
      practices,
      onValidationError: ({ type, practiceId }) => {
        if (type === 'unknown_practice_id') sendEvent('practice_validation_error', { practiceId });
      },
    });
    globalThis.__platformaV3 = {
      mode,
      practiceCount: practices.length,
      normalizeNavigatorAnswers,
    };
    restoreNavigatorResultOnHistoryNavigation();
    startButton.disabled = false;
  } catch (error) {
    startButton.textContent = 'Навигатор временно недоступен';
    document.querySelector('#intro .notice').textContent = 'Не удалось загрузить утверждённую библиотеку практик. Обновите страницу или попробуйте позже.';
  }
}

initializeV3();
