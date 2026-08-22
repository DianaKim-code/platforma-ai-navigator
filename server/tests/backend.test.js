import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { analyzeWithProvider } from '../src/analyze.js';
import { createRequestHandler } from '../src/app.js';

const practices = JSON.parse(await readFile(new URL('../../data/practices.json', import.meta.url), 'utf8'));
const allowedOrigin = 'http://127.0.0.1:8000';

function payload(overrides = {}) {
  return {
    sessionId: 'backend-test',
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

function validResult(overrides = {}) {
  return {
    status: 'ok',
    route: 'R1',
    title: 'Точка начала',
    reflection: 'По ответам уже видна одна безопасная точка начала.',
    observedFacts: ['Вы выбрали сферу работы.', 'Вы отметили нехватку первого шага.'],
    workingHypothesis: 'Одна из рабочих гипотез — сейчас полезнее уточнить первый шаг.',
    confidence: 'medium',
    requestDraft: 'Как выбрать первый реалистичный шаг?',
    practiceId: 'PM-OP-02',
    practiceReason: 'Практика соответствует ресурсу и барьеру.',
    nextStep: 'Выбрать одно действие на ближайшие 10 минут.',
    humanSupport: { recommended: false, reason: 'Живой разбор может быть полезен позже.', urgency: 'optional' },
    disclaimer: 'Это рабочее предположение, а не диагноз.',
    ...overrides,
  };
}

async function withServer(options, run) {
  const server = createServer(createRequestHandler({
    loadPractices: async () => practices,
    createRequestId: () => 'request-test-id',
    ...options,
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function post(baseUrl, body, origin = allowedOrigin) {
  return fetch(`${baseUrl}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body,
  });
}

test('B01 health returns a minimal response and request ID', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'request-test-id');
    assert.deepEqual(await response.json(), { status: 'ok', service: 'platforma-ai-navigator-v3' });
  });
});

test('B02 normal request returns structured JSON', async () => {
  await withServer({ analyze: async () => validResult() }, async (baseUrl) => {
    const response = await post(baseUrl, JSON.stringify(payload()));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
    assert.deepEqual(await response.json(), validResult());
  });
});

test('B03 malformed, invalid and oversized bodies are rejected before provider', async () => {
  let calls = 0;
  await withServer({ analyze: async () => { calls += 1; return validResult(); } }, async (baseUrl) => {
    const malformed = await post(baseUrl, '{bad json');
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'INVALID_JSON' });

    const invalid = await post(baseUrl, JSON.stringify({ sessionId: '', safetyLevel: 42 }));
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: 'INVALID_PAYLOAD' });

    const oversized = await post(baseUrl, JSON.stringify(payload({ openConcern: 'x'.repeat(60_000) })));
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { error: 'PAYLOAD_TOO_LARGE' });
    assert.equal(calls, 0);
  });
});

test('B04 safety stop succeeds without provider configuration or call', async () => {
  let fetchCalls = 0;
  const analyze = (answers, map, env) => analyzeWithProvider(answers, map, env, async () => {
    fetchCalls += 1;
    throw new Error('provider must not be called');
  });
  await withServer({ analyze, env: {} }, async (baseUrl) => {
    const response = await post(baseUrl, JSON.stringify(payload({ safetyLevel: 'Нет, мне нужна срочная помощь' })));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'safety_stop');
    assert.equal(body.route, null);
    assert.equal(body.practiceId, null);
    assert.equal(fetchCalls, 0);
  });
});

test('B05 missing API key is sanitized without secret or stack trace', async () => {
  await withServer({ env: { AI_MODEL: 'test-model' } }, async (baseUrl) => {
    const response = await post(baseUrl, JSON.stringify(payload()));
    const text = await response.text();
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(text), { error: 'AI_NOT_CONFIGURED' });
    assert.doesNotMatch(text, /stack|AI_API_KEY|test-model/iu);
  });
});

test('B06 invalid origin is rejected without CORS permission', async () => {
  await withServer({ analyze: async () => validResult() }, async (baseUrl) => {
    const response = await post(baseUrl, JSON.stringify(payload()), 'https://untrusted.example');
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await response.json(), { error: 'ORIGIN_NOT_ALLOWED' });
  });
});

test('B07 unknown Practice ID becomes a safe invalid-response error', async () => {
  const providerFetch = async () => ({
    ok: true,
    async json() {
      return { choices: [{ message: { content: JSON.stringify(validResult({ practiceId: 'UNKNOWN' })) } }] };
    },
  });
  const analyze = (answers, map, env) => analyzeWithProvider(answers, map, env, providerFetch, 100);
  await withServer({ analyze, env: { AI_API_KEY: 'test-secret', AI_MODEL: 'test-model' } }, async (baseUrl) => {
    const response = await post(baseUrl, JSON.stringify(payload()));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'AI_INVALID_RESPONSE' });
  });
});

test('B08 provider timeout returns controlled 504', async () => {
  const providerFetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const analyze = (answers, map, env) => analyzeWithProvider(answers, map, env, providerFetch, 10);
  await withServer({ analyze, env: { AI_API_KEY: 'test-secret', AI_MODEL: 'test-model' } }, async (baseUrl) => {
    const response = await post(baseUrl, JSON.stringify(payload()));
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: 'AI_TIMEOUT' });
  });
});

test('provider HTTP failures are sanitized', async () => {
  const providerFetch = async () => ({ ok: false, status: 401 });
  const analyze = (answers, map, env) => analyzeWithProvider(answers, map, env, providerFetch, 100);
  await withServer({ analyze, env: { AI_API_KEY: 'private-test-secret', AI_MODEL: 'test-model' } }, async (baseUrl) => {
    const response = await post(baseUrl, JSON.stringify(payload()));
    const text = await response.text();
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(text), { error: 'AI_PROVIDER_ERROR' });
    assert.doesNotMatch(text, /private-test-secret|401|stack/iu);
  });
});
