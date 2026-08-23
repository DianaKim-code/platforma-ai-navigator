import { randomUUID } from 'node:crypto';
import {
  allowedOrigins,
  BODY_LIMIT_BYTES,
  createAnalyzeProcessor,
  safeError,
} from './app.js';
import { HttpInputError, ProviderError } from './errors.js';

function writeJson(response, status, body, { origin = '', requestId = '', allow = '' } = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (requestId) response.setHeader('X-Request-Id', requestId);
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  if (allow) response.setHeader('Allow', allow);
  response.end(JSON.stringify(body));
}

function contentLength(request) {
  const value = Number(request.headers?.['content-length']);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseVercelJsonBody(request) {
  const contentType = String(request.headers?.['content-type'] || '').toLocaleLowerCase('en');
  if (!contentType.startsWith('application/json')) throw new HttpInputError('UNSUPPORTED_MEDIA_TYPE', 415);
  if ((contentLength(request) ?? 0) > BODY_LIMIT_BYTES) throw new HttpInputError('PAYLOAD_TOO_LARGE', 413);

  const body = request.body;
  if (body === undefined || body === null) throw new HttpInputError('INVALID_JSON', 400);
  const serialized = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  if (serialized.byteLength > BODY_LIMIT_BYTES) throw new HttpInputError('PAYLOAD_TOO_LARGE', 413);

  if (typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  try {
    return JSON.parse(serialized.toString('utf8'));
  } catch {
    throw new HttpInputError('INVALID_JSON', 400);
  }
}

export function createVercelAnalyzeHandler({
  env = process.env,
  createRequestId = randomUUID,
  logger = console,
  ...processorOptions
} = {}) {
  const origins = allowedOrigins(env);
  const processAnalyze = createAnalyzeProcessor({ env, ...processorOptions });

  return async function vercelAnalyzeHandler(request, response) {
    const requestId = createRequestId();
    const origin = request.headers?.origin || '';

    if (origin && !origins.has(origin)) {
      return writeJson(response, 403, { error: 'ORIGIN_NOT_ALLOWED' }, { requestId });
    }
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('X-Request-Id', requestId);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Allow', 'POST, OPTIONS');
      return response.end();
    }
    if (request.method !== 'POST') {
      return writeJson(response, 405, { error: 'METHOD_NOT_ALLOWED' }, {
        origin,
        requestId,
        allow: 'POST, OPTIONS',
      });
    }

    try {
      const result = await processAnalyze(parseVercelJsonBody(request));
      return writeJson(response, 200, result, { origin, requestId });
    } catch (error) {
      if (error instanceof ProviderError && error.diagnostics.safeCategory) {
        logger.warn('AI_PROVIDER_DIAGNOSTIC', {
          requestId,
          upstreamStatus: error.diagnostics.upstreamStatus,
          category: error.diagnostics.safeCategory,
          ...(error.diagnostics.upstreamCode
            ? { upstreamCode: error.diagnostics.upstreamCode }
            : {}),
        });
      }
      if (error instanceof ProviderError && error.code === 'AI_INVALID_RESPONSE' && error.diagnostics.stage) {
        logger.warn('AI_INVALID_RESPONSE_DIAGNOSTIC', {
          requestId,
          stage: error.diagnostics.stage,
          ...(error.diagnostics.validationErrors
            ? { validationErrors: error.diagnostics.validationErrors }
            : {}),
        });
      }
      const safe = safeError(error);
      return writeJson(response, safe.status, { error: safe.code }, { origin, requestId });
    }
  };
}

export function createVercelHealthHandler({ createRequestId = randomUUID } = {}) {
  return function vercelHealthHandler(request, response) {
    const requestId = createRequestId();
    if (request.method !== 'GET') {
      return writeJson(response, 405, { error: 'METHOD_NOT_ALLOWED' }, {
        requestId,
        allow: 'GET',
      });
    }
    return writeJson(response, 200, {
      status: 'ok',
      service: 'platforma-ai-navigator-v3',
      environment: 'staging',
    }, { requestId });
  };
}
