import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeWithProvider, classifyProviderHttpStatus } from '../src/analyze.js';
import {
  createVercelAnalyzeHandler,
  createVercelHealthHandler,
} from '../src/vercelAdapter.js';

const practices = JSON.parse(await readFile(new URL('../../data/practices.json', import.meta.url), 'utf8'));
const allowedOrigin = 'http://127.0.0.1:8000';

function payload(overrides = {}) {
  return {
    sessionId: 'vercel-test',
    domain: ['Работа или профессия'],
    pattern: 'Не знаю, с чего начать',
    duration: '3–6 месяцев',
    lifeImpact: ['Время'],
    clarity: 'priority_defined',
    barrier: 'Не знаю, с чего начать',
    triedBefore: ['Разбиралась самостоятельно'],
    triedBeforeOutcome: 'Не хватило плана',
    desiredResult: 'Работа или профессия',
    resource: ['Опыт и знания'],
    resourceLevel: 'Есть силы на один небольшой шаг',
    need: 'Сначала самостоятельно разобраться с AI',
    safetyLevel: 'Да, могу продолжить',
    ...overrides,
  };
}

function validResult() {
  return {
    status: 'ok',
    route: 'R1',
    title: 'Точка начала',
    reflection: 'По ответам уже видна безопасная точка начала.',
    observedFacts: ['Вы выбрали сферу работы.', 'Вы отметили нехватку первого шага.'],
    workingHypothesis: 'Одна из рабочих гипотез — сейчас полезнее уточнить первый шаг.',
    confidence: 'medium',
    requestDraft: 'Как выбрать первый реалистичный шаг?',
    practiceId: 'PM-OP-02',
    practiceReason: 'Практика соответствует ресурсу и барьеру.',
    nextStep: 'Выбрать одно действие на ближайшие 10 минут.',
    humanSupport: { recommended: false, reason: 'Живой разбор может быть полезен позже.', urgency: 'optional' },
    disclaimer: 'Это рабочее предположение, а не диагноз.',
  };
}

class MockResponse {
  constructor() {
    this.statusCode = 200;
    this.headers = new Map();
    this.body = '';
  }

  setHeader(name, value) {
    this.headers.set(name.toLocaleLowerCase('en'), String(value));
  }

  getHeader(name) {
    return this.headers.get(name.toLocaleLowerCase('en')) ?? null;
  }

  end(body = '') {
    this.body = body;
    return this;
  }

  json() {
    return this.body ? JSON.parse(this.body) : null;
  }
}

function request(method, body, origin = allowedOrigin) {
  return {
    method,
    body,
    headers: {
      origin,
      'content-type': 'application/json',
      'content-length': body === undefined ? '0' : String(Buffer.byteLength(JSON.stringify(body))),
    },
  };
}

function analyzeHandler(options = {}) {
  return createVercelAnalyzeHandler({
    loadPractices: async () => practices,
    createRequestId: () => 'vercel-request-id',
    ...options,
  });
}

test('V01 GET /api/health', async () => {
  const response = new MockResponse();
  createVercelHealthHandler({ createRequestId: () => 'vercel-request-id' })(request('GET'), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.getHeader('x-request-id'), 'vercel-request-id');
  assert.deepEqual(response.json(), {
    status: 'ok',
    service: 'platforma-ai-navigator-v3',
    environment: 'staging',
  });
});

test('V02 POST /api/analyze', async () => {
  const response = new MockResponse();
  await analyzeHandler({ analyze: async () => validResult() })(request('POST', payload()), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.getHeader('access-control-allow-origin'), allowedOrigin);
  assert.deepEqual(response.json(), validResult());
});

test('V03 OPTIONS preflight', async () => {
  const response = new MockResponse();
  await analyzeHandler()(request('OPTIONS'), response);
  assert.equal(response.statusCode, 204);
  assert.equal(response.getHeader('access-control-allow-origin'), allowedOrigin);
  assert.equal(response.getHeader('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(response.getHeader('allow'), 'POST, OPTIONS');
});

test('V04 GET /api/analyze returns 405', async () => {
  const response = new MockResponse();
  await analyzeHandler()(request('GET'), response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.getHeader('allow'), 'POST, OPTIONS');
  assert.deepEqual(response.json(), { error: 'METHOD_NOT_ALLOWED' });
});

test('V05 invalid origin', async () => {
  const response = new MockResponse();
  await analyzeHandler()(request('POST', payload(), 'https://untrusted.example'), response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.getHeader('access-control-allow-origin'), null);
  assert.deepEqual(response.json(), { error: 'ORIGIN_NOT_ALLOWED' });
});

test('V06 safety stop does not call provider', async () => {
  let providerCalls = 0;
  const analyze = (answers, map, env) => analyzeWithProvider(answers, map, env, async () => {
    providerCalls += 1;
    throw new Error('provider must not be called');
  });
  const response = new MockResponse();
  await analyzeHandler({ analyze, env: {} })(request('POST', payload({
    safetyLevel: 'Нет, мне нужна срочная помощь',
  })), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'safety_stop');
  assert.equal(response.json().route, null);
  assert.equal(response.json().practiceId, null);
  assert.equal(providerCalls, 0);
});

test('V07 errors expose no secret or stack trace', async () => {
  const response = new MockResponse();
  await analyzeHandler({ env: { AI_MODEL: 'private-model-name' } })(request('POST', payload()), response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: 'AI_NOT_CONFIGURED' });
  assert.doesNotMatch(response.body, /stack|AI_API_KEY|private-model-name/iu);
});

test('V08 parsed oversized body preserves 50 KB limit', async () => {
  const response = new MockResponse();
  await analyzeHandler({ analyze: async () => validResult() })(request('POST', payload({
    openConcern: 'x'.repeat(60_000),
  })), response);
  assert.equal(response.statusCode, 413);
  assert.deepEqual(response.json(), { error: 'PAYLOAD_TOO_LARGE' });
});

test('V09 upstream status categories are deterministic', () => {
  const cases = [
    [401, 'AI_AUTH_ERROR'],
    [403, 'AI_AUTH_ERROR'],
    [429, 'AI_QUOTA_OR_RATE_LIMIT'],
    [404, 'AI_MODEL_OR_ENDPOINT_NOT_FOUND'],
    [400, 'AI_REQUEST_REJECTED'],
    [422, 'AI_REQUEST_REJECTED'],
    [500, 'AI_PROVIDER_UNAVAILABLE'],
    [503, 'AI_PROVIDER_UNAVAILABLE'],
    [418, 'AI_PROVIDER_ERROR'],
  ];
  for (const [status, category] of cases) {
    assert.equal(classifyProviderHttpStatus(status), category);
  }
});

test('V10 provider diagnostics expose only safe status, category and machine code', async () => {
  const secret = 'private-provider-secret';
  const rawMessage = 'raw upstream message must stay private';
  const providerFetch = async () => ({
    ok: false,
    status: 401,
    async json() {
      return {
        error: { code: 'invalid_api_key', message: rawMessage },
        authorization: 'Bearer private-authorization-header',
        prompt: 'private prompt content',
        requestPayload: payload({ openConcern: 'private synthetic input' }),
      };
    },
  });
  const analyze = (answers, map, env) => analyzeWithProvider(
    answers,
    map,
    env,
    providerFetch,
    100,
  );
  const warnings = [];
  const response = new MockResponse();
  await analyzeHandler({
    analyze,
    env: { AI_API_KEY: secret, AI_MODEL: 'test-model' },
    logger: { warn: (...args) => warnings.push(args) },
  })(request('POST', payload()), response);

  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { error: 'AI_PROVIDER_ERROR' });
  const diagnostic = JSON.stringify(warnings);
  assert.match(diagnostic, /401/u);
  assert.match(diagnostic, /AI_AUTH_ERROR/u);
  assert.match(diagnostic, /invalid_api_key/u);
  assert.doesNotMatch(
    diagnostic,
    /private-provider-secret|private-authorization-header|private prompt content|raw upstream message|private synthetic input|vercel-test|stack/iu,
  );
  assert.doesNotMatch(
    response.body,
    /private-provider-secret|raw upstream message|invalid_api_key|401|stack/iu,
  );
});
