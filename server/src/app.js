import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { analyzeWithProvider } from './analyze.js';
import { HttpInputError, ProviderError } from './errors.js';
import { validateNavigatorPayload } from './requestValidation.js';

const BODY_LIMIT_BYTES = 50 * 1024;
const DEFAULT_PRODUCTION_ORIGIN = 'https://dianakim-code.github.io';
const LOCAL_ORIGINS = ['http://127.0.0.1:8000', 'http://localhost:8000'];
const practicesUrl = new URL('../../data/practices.json', import.meta.url);

export function allowedOrigins(env) {
  return new Set([
    DEFAULT_PRODUCTION_ORIGIN,
    env.ALLOWED_ORIGIN,
    ...LOCAL_ORIGINS,
  ].filter(Boolean));
}

function json(response, status, body, { origin = '', requestId = '' } = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(requestId ? { 'X-Request-Id': requestId } : {}),
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const contentType = String(request.headers['content-type'] || '').toLocaleLowerCase('en');
  if (!contentType.startsWith('application/json')) throw new HttpInputError('UNSUPPORTED_MEDIA_TYPE', 415);

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) throw new HttpInputError('PAYLOAD_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpInputError('INVALID_JSON', 400);
  }
}

export function safeError(error) {
  if (error instanceof HttpInputError) return { status: error.status, code: error.code };
  if (error instanceof ProviderError) {
    if (error.code === 'AI_TIMEOUT') return { status: 504, code: 'AI_TIMEOUT' };
    if (error.code === 'AI_NOT_CONFIGURED') return { status: 503, code: 'AI_NOT_CONFIGURED' };
    if (error.code === 'AI_INVALID_RESPONSE') return { status: 502, code: 'AI_INVALID_RESPONSE' };
    return { status: 502, code: 'AI_PROVIDER_ERROR' };
  }
  return { status: 502, code: 'AI_PROVIDER_ERROR' };
}

export function createAnalyzeProcessor({
  env = process.env,
  analyze = analyzeWithProvider,
  loadPractices = async () => JSON.parse(await readFile(practicesUrl, 'utf8')),
} = {}) {
  return async function processAnalyze(payload) {
    const answers = validateNavigatorPayload(payload);
    const practices = await loadPractices();
    return analyze(answers, practices, env);
  };
}

export function createRequestHandler({
  env = process.env,
  analyze = analyzeWithProvider,
  loadPractices = async () => JSON.parse(await readFile(practicesUrl, 'utf8')),
  createRequestId = randomUUID,
} = {}) {
  const origins = allowedOrigins(env);
  const processAnalyze = createAnalyzeProcessor({ env, analyze, loadPractices });

  return async function requestHandler(request, response) {
    const requestId = createRequestId();
    const origin = request.headers.origin || '';

    if (request.method === 'GET' && request.url === '/health') {
      return json(response, 200, { status: 'ok', service: 'platforma-ai-navigator-v3' }, { requestId });
    }
    if (origin && !origins.has(origin)) {
      return json(response, 403, { error: 'ORIGIN_NOT_ALLOWED' }, { requestId });
    }
    if (request.method === 'OPTIONS' && request.url === '/analyze') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Request-Id': requestId,
        Vary: 'Origin',
      });
      return response.end();
    }
    if (request.method !== 'POST' || request.url !== '/analyze') {
      return json(response, 404, { error: 'NOT_FOUND' }, { origin, requestId });
    }

    try {
      const result = await processAnalyze(await readJson(request));
      return json(response, 200, result, { origin, requestId });
    } catch (error) {
      const safe = safeError(error);
      return json(response, safe.status, { error: safe.code }, { origin, requestId });
    }
  };
}

export { BODY_LIMIT_BYTES };
