const PERSISTED_ANSWER_FIELDS = Object.freeze([
  'areas',
  'duration',
  'obstacle',
  'influence',
  'losses',
  'risk',
  'supports',
  'resourceLevel',
  'tried',
  'missing',
  'helpClarity',
  'preferredFormat',
  'trustFactors',
  'safetyLevel',
]);

const CLOSED_EMPTY_TOPIC = 'Пока не могу выбрать';

function cloneStructuredValue(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  return typeof value === 'string' ? value : undefined;
}

export function sanitizePersistedAnswers(answers = {}) {
  const snapshot = {};
  PERSISTED_ANSWER_FIELDS.forEach((field) => {
    const value = cloneStructuredValue(answers[field]);
    if (value !== undefined) snapshot[field] = value;
  });

  const closedTopics = new Set([
    ...(Array.isArray(answers.areas) ? answers.areas : []),
    CLOSED_EMPTY_TOPIC,
  ]);
  for (const field of ['priority', 'readyTopic']) {
    if (typeof answers[field] === 'string' && closedTopics.has(answers[field])) {
      snapshot[field] = answers[field];
    }
  }

  return snapshot;
}

export function createPersistedNavigatorState(answers = {}, resultData = null) {
  return {
    answers: sanitizePersistedAnswers(answers),
    resultData,
  };
}
