import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AI_MODES, createAiClient, createMockAnalysis } from '../src/aiClient.js';
import { analyticsPayload } from '../src/analytics.js';
import { validatePracticeId } from '../src/practiceMap.js';
import { createPersistedNavigatorState } from '../src/persistence.js';
import { SAFETY_STOP_ANSWER } from '../src/safety.js';
import { markAnalyticsTestPayload, stagingRuntime } from '../src/staging.js';

const practices = JSON.parse(await readFile(new URL('../data/practices.json', import.meta.url), 'utf8'));

function answers(overrides = {}) {
  return {
    sessionId: 'smoke', domain: ['Работа или профессия'], pattern: 'Не знала, с чего начать',
    duration: '3–6 месяцев', lifeImpact: ['Время'], clarity: 'priority_defined',
    barrier: 'Не знала, с чего начать', triedBefore: ['Разбиралась самостоятельно'],
    triedBeforeOutcome: 'Конкретного плана', desiredResult: 'Работа или профессия',
    resource: ['Опыт и знания'], resourceLevel: 'Есть силы на один небольшой шаг',
    need: 'Сначала самостоятельно разобраться с AI', safetyLevel: 'Да, могу продолжить',
    influence: 'В основном от моих действий', risk: 'Неизвестность', ...overrides,
  };
}

test('T01 low clarity', () => {
  const result = createMockAnalysis(answers({ clarity: 'priority_unclear', desiredResult: '' }), practices);
  assert.equal(result.route, 'R1');
});

test('T02 low resource', () => {
  const result = createMockAnalysis(answers({ resourceLevel: 'Сейчас сил почти нет', barrier: 'Не хватило сил или энергии' }), practices);
  assert.equal(result.route, 'R2');
  assert.equal(validatePracticeId(practices, result.practiceId).level, 'Micro');
});

test('T03 fear of mistake', () => {
  const result = createMockAnalysis(answers({ barrier: 'Боялась ошибиться', pattern: 'Боялась ошибиться' }), practices);
  assert.match(result.nextStep, /обратим/iu);
});

test('T04 too many options', () => {
  const result = createMockAnalysis(answers({ barrier: 'Появилось слишком много вариантов', pattern: 'Появилось слишком много вариантов', clarity: 'priority_unclear' }), practices);
  assert.equal(result.route, 'R1');
  assert.match(result.nextStep, /вариант|критери/iu);
});

test('T05 many attempts', () => {
  const result = createMockAnalysis(answers({ triedBefore: ['Проходила обучение', 'Работала с коучем или наставником'], triedBeforeOutcome: 'Конкретного плана' }), practices);
  assert.ok(['R3', 'R4'].includes(result.route));
});

test('T06 contradiction', () => {
  const result = createMockAnalysis(answers({ need: 'Готова к глубокой работе', resourceLevel: 'Сейчас сил почти нет' }), practices);
  assert.equal(result.route, 'R2');
});

test('T07 insufficient data', () => {
  const result = createMockAnalysis(answers({ domain: [], barrier: '', pattern: '', duration: 'Мне трудно определить', lifeImpact: [], desiredResult: '', resource: [] }), practices);
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.route, null);
});

test('T08 safety', () => {
  const result = createMockAnalysis(answers({ safetyLevel: SAFETY_STOP_ANSWER }), practices);
  assert.equal(result.status, 'safety_stop');
  assert.equal(result.route, null);
  assert.equal(result.practiceId, null);
});

test('T09 consent off', () => {
  const payload = analyticsPayload('feedback_submitted', 'smoke', {
    openConcern: 'private concern',
    openFeedback: 'private feedback',
    openTextConsent: false,
  });
  assert.equal('openConcern' in payload, false);
  assert.equal('openFeedback' in payload, false);
});

test('T10 AI unavailable', async () => {
  const client = createAiClient({ mode: AI_MODES.LIVE, endpoint: '', practices });
  await assert.rejects(() => client.analyzeNavigatorAnswers(answers()), /AI_ENDPOINT_NOT_CONFIGURED/);
});

test('T11 invalid Practice ID', async () => {
  let validationEvent = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { ...createMockAnalysis(answers(), practices), practiceId: 'UNKNOWN-PRACTICE' };
    },
  });
  try {
    const client = createAiClient({
      mode: AI_MODES.LIVE,
      endpoint: 'https://backend.example/analyze',
      practices,
      onValidationError: (event) => { validationEvent = event; },
    });
    const result = await client.analyzeNavigatorAnswers(answers());
    assert.equal(result.practiceId, null);
    assert.match(result.nextStep, /обратим/iu);
    assert.equal(validationEvent.type, 'unknown_practice_id');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('T12 mobile CSS has a 360px-safe single-column path', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /@media\(max-width:480px\)/u);
  assert.match(html, /\.result-actions,\.feedback-actions\{grid-template-columns:1fr\}/u);
  assert.match(html, /width:100%/u);
  assert.doesNotMatch(html, /min-width:\s*[4-9]\d{2}px/iu);
});

test('T13 Open text not persisted without consent', () => {
  const resultData = createMockAnalysis(answers(), practices);
  const snapshot = createPersistedNavigatorState({
    areas: ['Работа или профессия'],
    duration: '3–6 месяцев',
    priority: 'Работа или профессия',
    readyTopic: 'Свободная пользовательская формулировка',
    obstacle: 'Не знала, с чего начать',
    influence: 'В основном от моих действий',
    losses: ['Время'],
    risk: 'Неизвестность',
    supports: ['Опыт и знания'],
    resourceLevel: 'Есть силы на один небольшой шаг',
    tried: ['Разбиралась самостоятельно'],
    missing: 'Конкретного плана',
    helpClarity: 'Есть предположение, но не уверена',
    preferredFormat: 'Сначала самостоятельно разобраться с AI',
    trustFactors: ['Понимать, почему сделан такой вывод'],
    safetyLevel: 'Да, могу продолжить',
    mainConcern: 'private main concern',
    desiredAction: 'private desired action',
    stopFeeling: 'private feeling',
    ownAction: 'private own action',
    openConcern: 'private normalized concern',
    openFeedback: 'private feedback',
  }, resultData);

  assert.deepEqual(snapshot.answers.areas, ['Работа или профессия']);
  assert.equal(snapshot.answers.priority, 'Работа или профессия');
  assert.equal('readyTopic' in snapshot.answers, false);
  for (const field of ['mainConcern', 'desiredAction', 'stopFeeling', 'ownAction', 'openConcern', 'openFeedback']) {
    assert.equal(field in snapshot.answers, false);
  }
  assert.equal(snapshot.resultData, resultData);
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /private main concern|private desired action|private feeling|private own action|private normalized concern|private feedback/u);
});

test('T30 feature frontend uses same-origin live endpoint', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-ai-endpoint="\/api\/analyze"/u);
  const runtime = stagingRuntime({
    hostname: 'feature-preview.example.vercel.app',
    search: '',
  });
  assert.equal(runtime.localPreview, false);
  assert.equal(runtime.vercelPreview, true);
  assert.equal(runtime.bufferAnalytics, true);
});

test('T31 marked staging analytics are explicit and normal staging stays buffered', () => {
  const runtime = stagingRuntime({
    hostname: 'feature-preview.example.vercel.app',
    search: '?analytics_test=1',
  });
  assert.equal(runtime.analyticsTest, true);
  assert.equal(runtime.bufferAnalytics, false);
  assert.deepEqual(
    markAnalyticsTestPayload({ event: 'feedback_submitted', comment: 'structured' }, true),
    { event: 'feedback_submitted', comment: 'TEST_EVENT: structured', testEvent: true },
  );
});
