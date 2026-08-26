import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAiClient, AI_MODES, createMockAnalysis, normalizeNavigatorAnswers, resolveMockRoute } from '../src/aiClient.js';
import { analyticsPayload, createV3FeedbackPayload, stripUnconsentedOpenText } from '../src/analytics.js';
import { hasSufficientData } from '../src/dataSufficiency.js';
import { selectPractice, validatePracticeId } from '../src/practiceMap.js';
import { fallbackResult, validateAnalysisResponse } from '../src/schema.js';
import { evaluateSafety, SAFETY_STOP_ANSWER } from '../src/safety.js';
import { analyzeWithProvider } from '../server/src/analyze.js';

const practices = JSON.parse(await readFile(new URL('../data/practices.json', import.meta.url), 'utf8'));
const knownIds = new Set(practices.map((item) => item.id));

test('Practice Map import contains exactly 30 unique approved IDs', () => {
  assert.equal(practices.length, 30);
  assert.equal(knownIds.size, 30);
});

function base(overrides = {}) {
  return {
    sessionId: 'test-session',
    domain: ['Работа или профессия'],
    pattern: 'Не знала, с чего начать',
    duration: '3–6 месяцев',
    lifeImpact: ['Время', 'Энергия'],
    clarity: 'priority_defined',
    barrier: 'Не знала, с чего начать',
    triedBefore: ['Разбиралась самостоятельно'],
    triedBeforeOutcome: 'Конкретного плана',
    desiredResult: 'Работа или профессия',
    resource: ['Опыт и знания'],
    resourceLevel: 'Есть силы на один небольшой шаг',
    need: 'Сначала самостоятельно разобраться с AI',
    safetyLevel: 'Да, могу продолжить',
    openConcern: '',
    ...overrides,
  };
}

test('safety gate stops before analysis', () => {
  assert.equal(evaluateSafety(base({ safetyLevel: SAFETY_STOP_ANSWER })).status, 'safety_stop');
  assert.equal(evaluateSafety(base({ openConcern: 'Я не хочу жить' })).status, 'safety_stop');
});

test('server safety gate does not require or call an AI provider', async () => {
  const result = await analyzeWithProvider(base({ safetyLevel: SAFETY_STOP_ANSWER }), practices, {});
  assert.equal(result.status, 'safety_stop');
  assert.equal(result.practiceId, null);
});

test('schema accepts valid mock and rejects unknown values', () => {
  const result = createMockAnalysis(base(), practices);
  assert.equal(validateAnalysisResponse(result, knownIds).ok, true);
  assert.equal(validateAnalysisResponse({ ...result, route: 'R9' }, knownIds).ok, false);
  assert.equal(validateAnalysisResponse({ ...result, practiceId: 'MADE-UP' }, knownIds).ok, false);
});

test('insufficient data returns controlled neutral result', () => {
  const result = createMockAnalysis(base({ domain: [], desiredResult: '', barrier: '', pattern: '', duration: 'Мне трудно определить', lifeImpact: [], resource: [] }), practices);
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.route, null);
  assert.equal(result.practiceId, null);
});

test('T34 placeholder values do not count as sufficient data', () => {
  assert.equal(hasSufficientData(base({
    domain: ['Пока сложно определить'],
    barrier: 'Другое',
    pattern: 'Другое',
    duration: 'Пока трудно определить',
    lifeImpact: ['Другое'],
    desiredResult: 'Пока не могу выбрать',
    resource: ['Пока не вижу опоры'],
  })), false);
});

test('contradiction gives resource priority', () => {
  const answers = base({ resourceLevel: 'Сейчас сил почти нет', need: 'Готова к глубокой работе' });
  assert.equal(resolveMockRoute(answers), 'R2');
  const result = createMockAnalysis(answers, practices);
  const practice = validatePracticeId(practices, result.practiceId);
  assert.equal(result.route, 'R2');
  assert.equal(practice.level, 'Micro');
});

test('Practice Map lookup and invalid ID fallback are deterministic', () => {
  const practice = selectPractice(practices, { route: 'R2', resource: 'Сейчас сил почти нет', barrier: 'Не хватило сил или энергии' });
  assert.ok(practice);
  assert.equal(practice.level, 'Micro');
  assert.equal(validatePracticeId(practices, 'UNKNOWN'), null);
});

test('open text is stripped without consent', () => {
  const clean = stripUnconsentedOpenText({ route: 'R1', openConcern: 'private', openFeedback: 'private' }, false);
  assert.equal(clean.route, 'R1');
  assert.equal('openConcern' in clean, false);
  assert.equal('openFeedback' in clean, false);
});

test('analytics payload contains no answer text by default', () => {
  const payload = analyticsPayload('question_answered', 's1', { questionId: 'mainConcern', answerType: 'text' });
  assert.equal(payload.event, 'question_answered');
  assert.equal('answer' in payload, false);
  assert.equal('openConcern' in payload, false);
});

test('T36 v3 feedback payload preserves structured fields', () => {
  const payload = createV3FeedbackPayload({
    sessionId: 'v3-test', resultStatus: 'ok', route: 'R1', practice: 'PM-CS-01',
    reflectionScore: '4', explanationScore: '5', clarityScore: '4', stepRealism: '5',
    trustScore: '4', recognition: 'Да, точно', repetition: 'Нет',
    bookingReadiness: 'Возможно позже', source: 'staging', timestamp: '2026-08-26T00:00:00.000Z',
  });
  for (const field of ['resultStatus', 'route', 'practice', 'reflectionScore', 'explanationScore',
    'clarityScore', 'stepRealism', 'trustScore', 'recognition', 'repetition',
    'bookingReadiness', 'source', 'timestamp']) assert.ok(field in payload, field);
});

test('T37 consent=false strips v3 open text', () => {
  const payload = createV3FeedbackPayload({
    sessionId: 'v3-private', route: 'R1', openTextConsent: false,
    openConcern: 'private concern', openFeedback: 'private feedback', mainConcern: 'private raw answer',
  });
  assert.equal(payload.openTextConsent, false);
  for (const field of ['openConcern', 'openFeedback', 'mainConcern']) assert.equal(field in payload, false);
});

test('T38 consent=true keeps allowed v3 open text', () => {
  const payload = createV3FeedbackPayload({
    sessionId: 'v3-consented', openTextConsent: true,
    openConcern: 'synthetic concern', openFeedback: 'synthetic feedback',
  });
  assert.equal(payload.openTextConsent, true);
  assert.equal(payload.openConcern, 'synthetic concern');
  assert.equal(payload.openFeedback, 'synthetic feedback');
});

test('mock client validates structured output', async () => {
  const client = createAiClient({ mode: AI_MODES.MOCK, practices });
  const result = await client.analyzeNavigatorAnswers(base());
  assert.equal(result.status, 'ok');
  assert.ok(['R1', 'R2', 'R3', 'R4'].includes(result.route));
});

test('live client does not fake a result without endpoint', async () => {
  const client = createAiClient({ mode: AI_MODES.LIVE, endpoint: '', practices });
  await assert.rejects(() => client.analyzeNavigatorAnswers(base()), /AI_ENDPOINT_NOT_CONFIGURED/);
});

test('normalization preserves v2 fields behind a stable v3 model', () => {
  const normalized = normalizeNavigatorAnswers({
    areas: ['Работа или профессия'],
    obstacle: 'Боялась ошибиться',
    losses: ['Время'],
    tried: ['Проходила обучение'],
    readyTopic: 'Работа или профессия',
  }, 's1');
  assert.equal(normalized.sessionId, 's1');
  assert.deepEqual(normalized.domain, ['Работа или профессия']);
  assert.equal(normalized.barrier, 'Боялась ошибиться');
});

test('fallback has a complete safe schema', () => {
  assert.equal(validateAnalysisResponse(fallbackResult(), knownIds).ok, true);
});
