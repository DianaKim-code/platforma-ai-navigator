import { HttpInputError } from './errors.js';

const STRING_FIELDS = new Map([
  ['sessionId', 128],
  ['pattern', 500],
  ['duration', 120],
  ['clarity', 120],
  ['barrier', 500],
  ['triedBeforeOutcome', 500],
  ['desiredResult', 500],
  ['resourceLevel', 120],
  ['need', 500],
  ['safetyLevel', 160],
  ['openConcern', 1_000],
  ['desiredAction', 1_000],
  ['stopFeeling', 1_000],
  ['influence', 500],
  ['ownAction', 1_000],
  ['risk', 500],
]);

const ARRAY_FIELDS = new Set(['domain', 'lifeImpact', 'triedBefore', 'resource']);

function validString(value, limit) {
  return typeof value === 'string' && value.length <= limit;
}

function validStringArray(value) {
  return Array.isArray(value)
    && value.length <= 20
    && value.every((item) => typeof item === 'string' && item.length <= 500);
}

export function validateNavigatorPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpInputError('INVALID_PAYLOAD', 400);
  }
  if (!validString(value.sessionId, STRING_FIELDS.get('sessionId')) || !value.sessionId.trim()) {
    throw new HttpInputError('INVALID_PAYLOAD', 400);
  }
  if (!validString(value.safetyLevel, STRING_FIELDS.get('safetyLevel'))) {
    throw new HttpInputError('INVALID_PAYLOAD', 400);
  }

  const clean = {};
  for (const [field, limit] of STRING_FIELDS) {
    if (value[field] === undefined) continue;
    if (!validString(value[field], limit)) throw new HttpInputError('INVALID_PAYLOAD', 400);
    clean[field] = value[field];
  }
  for (const field of ARRAY_FIELDS) {
    if (value[field] === undefined) continue;
    if (!validStringArray(value[field])) throw new HttpInputError('INVALID_PAYLOAD', 400);
    clean[field] = [...value[field]];
  }
  return clean;
}
