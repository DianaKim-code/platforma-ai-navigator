export function hasSufficientData(answers = {}) {
  const signals = [
    answers.domain?.length,
    answers.barrier,
    answers.duration && answers.duration !== 'Мне трудно определить',
    answers.lifeImpact?.length,
    answers.desiredResult,
    answers.resource?.length,
  ].filter(Boolean).length;
  return signals >= 3 && Boolean(answers.domain?.length || answers.desiredResult || answers.barrier);
}
