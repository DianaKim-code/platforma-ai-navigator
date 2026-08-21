const CRISIS_MARKERS = [
  'не хочу жить',
  'суицид',
  'самоубий',
  'убить себя',
  'самоповреж',
  'угроза жизни',
  'угрожает мне',
  'избивает',
  'насилие',
  'непосредственная угроза',
  'срочная медицинская помощь',
  'потеря сознания',
];

export const SAFETY_STOP_ANSWER = 'Нет, мне нужна срочная помощь';

export function evaluateSafety(answers = {}) {
  if (answers.safetyLevel === SAFETY_STOP_ANSWER) {
    return { status: 'safety_stop', reason: 'explicit_answer' };
  }

  const text = [
    answers.openConcern,
    answers.mainConcern,
    answers.desiredAction,
    answers.stopFeeling,
    answers.ownAction,
  ].filter((value) => typeof value === 'string').join(' ').toLocaleLowerCase('ru');

  const marker = CRISIS_MARKERS.find((value) => text.includes(value));
  return marker
    ? { status: 'safety_stop', reason: 'approved_text_marker' }
    : { status: 'continue', reason: '' };
}

