export const VALID_STATUSES = new Set(['ok', 'insufficient_data', 'safety_stop']);
export const VALID_ROUTES = new Set(['R1', 'R2', 'R3', 'R4', null]);
export const VALID_CONFIDENCE = new Set(['low', 'medium', 'high']);
export const VALID_URGENCY = new Set(['optional', 'useful', 'recommended', 'urgent']);
export const VALID_PRACTICE_LEVELS = new Set(['Micro', 'Short', 'Extended']);

const FORBIDDEN_PHRASES = [
  /у вас (?:травма|депрессия|тревожное расстройство)/iu,
  /вы страдаете/iu,
  /саботаж успеха/iu,
  /подсознательн\w* страх\w* денег/iu,
  /тип личности/iu,
  /психосоматическ\w* причин/iu,
  /гарантирован/iu,
];

export function fallbackResult(message = 'Сейчас не удалось надёжно сформировать результат. Ваши ответы сохранены — можно попробовать ещё раз.') {
  return {
    status: 'insufficient_data',
    route: null,
    title: 'Сначала стоит точнее определить точку начала',
    reflection: message,
    observedFacts: [],
    rationale: 'Пока недостаточно двух содержательных сигналов, чтобы надёжно объяснить связь между ситуацией и следующим шагом.',
    workingHypothesis: 'Данных для рабочей гипотезы пока недостаточно.',
    confidence: 'low',
    requestDraft: 'Уточнить один конкретный момент, в котором изменение останавливается.',
    practiceId: null,
    practiceReason: '',
    nextStep: 'Вернитесь к одному недавнему эпизоду и коротко запишите: что вы хотели сделать, что остановило и что зависело от вас.',
    humanSupport: { recommended: false, reason: 'При желании этот эпизод можно обсудить с живым специалистом.', urgency: 'optional' },
    disclaimer: 'Это предварительное отражение, а не диагноз.',
  };
}

function isText(value) {
  return typeof value === 'string';
}

export function validateAnalysisResponse(value, knownPracticeIds = new Set()) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['response_not_object'], value: fallbackResult() };
  }
  if (!VALID_STATUSES.has(value.status)) errors.push('invalid_status');
  if (!VALID_ROUTES.has(value.route ?? null)) errors.push('invalid_route');
  if (!VALID_CONFIDENCE.has(value.confidence)) errors.push('invalid_confidence');
  if (!Array.isArray(value.observedFacts) || !value.observedFacts.every(isText)) errors.push('invalid_observed_facts');
  for (const field of ['title', 'reflection', 'rationale', 'workingHypothesis', 'requestDraft', 'practiceReason', 'nextStep', 'disclaimer']) {
    if (!isText(value[field])) errors.push(`invalid_${field}`);
  }
  if (!value.humanSupport || typeof value.humanSupport !== 'object') {
    errors.push('invalid_human_support');
  } else {
    if (typeof value.humanSupport.recommended !== 'boolean') errors.push('invalid_human_support_recommended');
    if (!isText(value.humanSupport.reason)) errors.push('invalid_human_support_reason');
    if (!VALID_URGENCY.has(value.humanSupport.urgency)) errors.push('invalid_urgency');
  }
  if (value.practiceId !== null && !knownPracticeIds.has(value.practiceId)) errors.push('unknown_practice_id');
  if (value.practice !== undefined) {
    if (value.practice === null) {
      if (value.practiceId !== null) errors.push('missing_practice_metadata');
    } else if (typeof value.practice !== 'object' || Array.isArray(value.practice)) {
      errors.push('invalid_practice_metadata');
    } else {
      if (value.practice.id !== value.practiceId) errors.push('practice_metadata_id_mismatch');
      if (!VALID_PRACTICE_LEVELS.has(value.practice.level)) errors.push('invalid_practice_level');
      for (const field of ['duration', 'text', 'nextStep']) {
        if (!isText(value.practice[field])) errors.push(`invalid_practice_${field}`);
      }
    }
  }
  if (value.status !== 'ok' && value.route !== null) errors.push('route_requires_ok_status');

  const narrative = [value.reflection, value.rationale, value.workingHypothesis, value.requestDraft, value.practiceReason, value.nextStep].join(' ');
  if (FORBIDDEN_PHRASES.some((pattern) => pattern.test(narrative))) errors.push('unsafe_psychological_claim');

  return errors.length
    ? { ok: false, errors, value: fallbackResult() }
    : { ok: true, errors: [], value };
}

