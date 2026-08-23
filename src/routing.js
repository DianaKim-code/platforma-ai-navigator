function includes(value, fragment) {
  return String(value || '').toLocaleLowerCase('ru').includes(fragment);
}

export function resolveNavigatorRoute(answers = {}) {
  if (answers.resourceLevel === 'Сейчас сил почти нет') return 'R2';
  if (includes(answers.barrier, 'другого человека') || includes(answers.influence, 'другого человека')) return 'R3';
  if ((answers.triedBefore || []).length >= 2 && answers.clarity === 'priority_defined') return 'R4';
  if (answers.clarity === 'priority_unclear' || includes(answers.barrier, 'с чего начать') || includes(answers.barrier, 'слишком много вариантов')) return 'R1';
  return 'R4';
}
