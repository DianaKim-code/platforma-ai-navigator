import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { analyzeWithProvider, createInsufficientDataResult } from '../src/analyze.js';
import { createRequestHandler } from '../src/app.js';
import { validateAnalysisResponse } from '../../src/schema.js';

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

function providerResult(result, onCall = () => {}) {
  return async () => {
    onCall();
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(result) } }] };
      },
    };
  };
}

function analyzeResult(answers, result, onCall = () => {}) {
  return analyzeWithProvider(
    answers,
    practices,
    { AI_API_KEY: 'test-secret', AI_MODEL: 'test-model' },
    providerResult(result, onCall),
    100,
  );
}

function userFacingProse(result) {
  return [
    result.title,
    result.reflection,
    ...(result.observedFacts || []),
    result.workingHypothesis,
    result.requestDraft,
    result.practiceReason,
    result.nextStep,
    result.practice?.text,
    result.practice?.nextStep,
    result.humanSupport?.reason,
    result.disclaimer,
  ].filter(Boolean).join(' ');
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

test('LIVE/T14 insufficient data bypasses provider', async () => {
  let providerCalls = 0;
  const analyze = (answers, map, env) => analyzeWithProvider(
    answers,
    map,
    env,
    providerResult(validResult(), () => { providerCalls += 1; }),
    100,
  );
  await withServer({ analyze, env: {} }, async (baseUrl) => {
    const response = await post(baseUrl, JSON.stringify(payload({
      domain: [],
      pattern: 'Пока трудно сказать',
      duration: 'Мне трудно определить',
      lifeImpact: [],
      barrier: '',
      desiredResult: '',
      resource: [],
      resourceLevel: 'Мне трудно определить',
    })));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(providerCalls, 0);
    assert.equal(result.status, 'insufficient_data');
    assert.equal(result.route, null);
    assert.equal(result.practiceId, null);
    assert.equal(validateAnalysisResponse(result, new Set(practices.map(({ id }) => id))).ok, true);
  });
});

test('T35 fully uncertain placeholders return HTTP 200 and bypass provider', async () => {
  let providerCalls = 0;
  const analyze = (answers, map, env) => analyzeWithProvider(
    answers,
    map,
    env,
    providerResult(validResult(), () => { providerCalls += 1; }),
    100,
  );
  await withServer({ analyze, env: {} }, async (baseUrl) => {
    const response = await post(baseUrl, JSON.stringify(payload({
      domain: ['Пока сложно определить'],
      pattern: 'Другое',
      duration: 'Пока трудно определить',
      lifeImpact: ['Другое'],
      barrier: 'Другое',
      desiredResult: 'Пока не могу выбрать',
      resource: ['Пока не вижу опоры'],
      resourceLevel: 'Пока трудно определить',
    })));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(providerCalls, 0);
    assert.equal(result.status, 'insufficient_data');
    assert.equal(result.route, null);
    assert.equal(result.practiceId, null);
    assert.equal(validateAnalysisResponse(result, new Set(practices.map(({ id }) => id))).ok, true);
  });
});

test('T15 Practice text comes from Practice Map', async () => {
  const answers = payload();
  const result = await analyzeResult(answers, validResult({
    nextStep: 'Чужая инструкция от provider на 90 минут.',
  }));
  const selected = practices.find(({ id }) => id === result.practiceId);
  assert.equal(result.practice.text, selected.text);
  assert.equal(result.practice.nextStep, selected.nextStep);
  assert.equal(result.nextStep, selected.nextStep);
  assert.doesNotMatch(userFacingProse(result), /90 минут/u);
});

test('T16 Practice duration comes from Practice Map', async () => {
  const answers = payload();
  const result = await analyzeResult(answers, validResult({
    nextStep: 'Выполняйте практику 30 минут.',
  }));
  const selected = practices.find(({ id }) => id === result.practiceId);
  assert.equal(result.practice.duration, selected.duration);
  assert.equal(result.practice.level, selected.level);
  assert.doesNotMatch(userFacingProse(result), /30 минут/u);
});

test('T17 Low resource cannot produce non-Micro practice', async () => {
  const answers = payload({
    resourceLevel: 'Сейчас сил почти нет',
    barrier: 'Не хватило сил или энергии',
    need: 'Готова к глубокой работе',
  });
  const result = await analyzeResult(answers, validResult({
    route: 'R2',
    practiceId: 'PM-CH-02',
    nextStep: 'Выполните расширенную практику.',
  }));
  assert.equal(result.route, 'R2');
  assert.equal(result.practice.level, 'Micro');
  assert.equal(result.practiceId, result.practice.id);
  assert.equal(result.nextStep, result.practice.nextStep);
});

test('T18 Unsupported clinical wording is sanitized', async () => {
  const answers = payload();
  const result = await analyzeResult(answers, validResult({
    reflection: 'Возможны симптомы и ухудшение состояния. По ответам уже видна точка начала.',
    humanSupport: {
      recommended: false,
      reason: 'При симптомах тревоги и депрессивных ощущениях обратитесь за помощью.',
      urgency: 'optional',
    },
    disclaimer: 'При ухудшении психического состояния обратитесь за лечением.',
  }));
  assert.doesNotMatch(
    userFacingProse(result),
    /тревог|депресс|симптом|ухудшен\w* состояния|психическ\w* состояния|травм/iu,
  );
});

test('T19 Technical wording «пользователь/клиент» does not reach user-facing fields', async () => {
  const answers = payload();
  const result = await analyzeResult(answers, validResult({
    workingHypothesis: 'Предположение: пользователь пока ищет первый шаг.',
    practiceReason: 'Практика подходит этому клиенту.',
    humanSupport: {
      recommended: false,
      reason: 'Клиент может обратиться к специалисту позже.',
      urgency: 'optional',
    },
  }));
  assert.doesNotMatch(userFacingProse(result), /пользовател|клиент|респондент|субъект|кейс/iu);
});

test('T20 Route codes do not appear in user-facing prose', async () => {
  const answers = payload();
  const result = await analyzeResult(answers, validResult({
    reflection: 'Маршрут R1 соответствует текущим ответам. По ответам уже видна точка начала.',
    practiceReason: 'Практика выбрана для R1.',
    nextStep: 'Следуйте маршруту R1.',
  }));
  assert.equal(result.route, 'R1');
  assert.doesNotMatch(userFacingProse(result), /\bR[1-4]\b/u);
});

test('T21 Practice does not promise a guaranteed outcome', async () => {
  const answers = payload();
  const result = await analyzeResult(answers, validResult({
    reflection: 'Эта практика восстановит ресурс и обязательно поможет.',
    workingHypothesis: 'Предположение: практика может вернуть энергию и привести к ясности.',
  }));
  assert.doesNotMatch(
    userFacingProse(result),
    /обязательно поможет|восстановит|вернёт|может вернуть|приведёт к ясности/iu,
  );
});

test('T22 Reflection does not add internal states absent from input', async () => {
  const answers = payload();
  const result = await analyzeResult(answers, validResult({
    reflection: 'Вы ощущаете напряжение и вам трудно собрать мысли.',
  }));
  assert.doesNotMatch(result.reflection, /напряжен|трудно собрать мысли/iu);
  assert.match(result.reflection, /по вашим ответам|в теме/iu);
});

test('T23 ObservedFacts contain only deterministic grounded information', async () => {
  const answers = payload();
  const result = await analyzeResult(answers, validResult({
    observedFacts: ['Вы испытываете скрытый страх.', 'Вы не можете собраться.'],
  }));
  assert.deepEqual(result.observedFacts, [
    'Вы указали сферу: Работа или профессия.',
    'Сейчас движение останавливается на шаге: Не знаю, с чего начать.',
    'Желаемый результат: Работа или профессия.',
    'Доступный ресурс: Есть силы на один небольшой шаг.',
  ]);
});

test('T24 Deterministic route cannot be overridden by provider response', async () => {
  const answers = payload();
  let providerRequest;
  const providerFetch = async (_url, options) => {
    providerRequest = JSON.parse(options.body);
    return providerResult(validResult({ route: 'R3' }))();
  };
  const result = await analyzeWithProvider(
    answers,
    practices,
    { AI_API_KEY: 'test-secret', AI_MODEL: 'test-model' },
    providerFetch,
    100,
  );
  assert.equal(providerRequest.temperature, 0.2);
  assert.equal('top_p' in providerRequest, false);
  assert.equal('seed' in providerRequest, false);
  assert.deepEqual(providerRequest.response_format, { type: 'json_object' });
  assert.equal(JSON.parse(providerRequest.messages[1].content).backendDecision.route, 'R1');
  assert.equal(result.route, 'R1');
  assert.equal(result.practice.id, result.practiceId);
  assert.ok(practices.find(({ id }) => id === result.practiceId).routes.includes('R1'));
});

test('Backend supplies ordinary human-support flags when provider omits them', async () => {
  const answers = payload();
  const providerHumanSupport = {
    reason: 'При желании результат можно обсудить с подходящим специалистом.',
  };
  const result = await analyzeResult(answers, validResult({ humanSupport: providerHumanSupport }));
  assert.deepEqual(result.humanSupport, {
    reason: providerHumanSupport.reason,
    recommended: false,
    urgency: 'optional',
  });
});

test('T26 status=ok adds an approved marker to an unmarked working hypothesis', async () => {
  const result = await analyzeResult(payload(), validResult({
    workingHypothesis: 'Сейчас полезнее перевести выбранное направление в один проверяемый шаг.',
  }));
  assert.equal(
    result.workingHypothesis,
    'Одна из рабочих гипотез — Сейчас полезнее перевести выбранное направление в один проверяемый шаг.',
  );
});

test('T27 an approved working-hypothesis marker is not duplicated', async () => {
  const hypothesis = 'Одна из рабочих гипотез — сейчас полезнее уточнить первый шаг.';
  const result = await analyzeResult(payload(), validResult({ workingHypothesis: hypothesis }));
  assert.equal(result.workingHypothesis, hypothesis);
  assert.equal((result.workingHypothesis.match(/Одна из рабочих гипотез/gu) || []).length, 1);

  const decorated = await analyzeResult(payload(), validResult({
    workingHypothesis: `✅ ${hypothesis}`,
  }));
  assert.equal(decorated.workingHypothesis, hypothesis);
  assert.equal((decorated.workingHypothesis.match(/Одна из рабочих гипотез/gu) || []).length, 1);
});

test('T28 insufficient_data keeps its deterministic neutral hypothesis', () => {
  const result = createInsufficientDataResult({});
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.workingHypothesis, 'Данных для рабочей гипотезы пока недостаточно.');
  assert.doesNotMatch(result.workingHypothesis, /^Одна из рабочих гипотез —/u);
});

test('T29 hypothesis enforcement does not change observedFacts', async () => {
  const answers = payload();
  const result = await analyzeResult(answers, validResult({
    observedFacts: ['Provider fact must not be used.'],
    workingHypothesis: 'Сейчас полезнее уточнить первый шаг.',
  }));
  assert.deepEqual(result.observedFacts, [
    'Вы указали сферу: Работа или профессия.',
    'Сейчас движение останавливается на шаге: Не знаю, с чего начать.',
    'Желаемый результат: Работа или профессия.',
    'Доступный ресурс: Есть силы на один небольшой шаг.',
  ]);
  assert.match(result.workingHypothesis, /^Одна из рабочих гипотез —/u);
});
