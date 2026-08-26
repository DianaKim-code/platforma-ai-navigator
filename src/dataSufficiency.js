const PLACEHOLDER_VALUES = new Set([
  'другое',
  'мне трудно определить',
  'пока трудно определить',
  'пока сложно определить',
  'пока не могу выбрать',
  'пока не вижу опоры',
  'пока не понимаю',
  'пока не знаю',
]);

export function isMeaningfulDataValue(value) {
  const normalized = String(value || '').trim().toLocaleLowerCase('ru');
  return Boolean(normalized) && !PLACEHOLDER_VALUES.has(normalized);
}

function meaningfulArrayLength(values) {
  return Array.isArray(values) ? values.filter(isMeaningfulDataValue).length : 0;
}

export function hasSufficientData(answers = {}) {
  const signals = [
    meaningfulArrayLength(answers.domain),
    isMeaningfulDataValue(answers.barrier),
    isMeaningfulDataValue(answers.duration),
    meaningfulArrayLength(answers.lifeImpact),
    isMeaningfulDataValue(answers.desiredResult),
    meaningfulArrayLength(answers.resource),
  ].filter(Boolean).length;
  const hasDirection = meaningfulArrayLength(answers.domain)
    || isMeaningfulDataValue(answers.desiredResult)
    || isMeaningfulDataValue(answers.barrier);
  return signals >= 3 && Boolean(hasDirection);
}
