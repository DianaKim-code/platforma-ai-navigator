let cache = null;

export async function loadPracticeMap(url = 'data/practices.json') {
  if (cache) return cache;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Practice Map HTTP ${response.status}`);
  const practices = await response.json();
  if (!Array.isArray(practices) || !practices.length) throw new Error('Practice Map is empty');
  cache = practices;
  return practices;
}

export function practiceIds(practices) {
  return new Set(practices.map((item) => item.id));
}

function terms(value) {
  return Array.isArray(value) ? value : [value].filter(Boolean);
}

function textOf(practice) {
  return [practice.category, ...terms(practice.signals), ...terms(practice.pattern), ...terms(practice.barrier), ...terms(practice.resource), ...terms(practice.need), practice.goal]
    .join(' ')
    .toLocaleLowerCase('ru');
}

function matchScore(values, target, weight) {
  if (!target) return 0;
  const normalizedTarget = String(target).toLocaleLowerCase('ru');
  return terms(values).some((value) => {
    const normalizedValue = String(value).toLocaleLowerCase('ru');
    return normalizedValue.includes(normalizedTarget) || normalizedTarget.includes(normalizedValue);
  }) ? weight : 0;
}

export function selectPractice(practices, context) {
  const lowResource = context.resource === 'Сейчас сил почти нет';
  const searchTerms = [context.pattern, context.barrier, context.need]
    .filter(Boolean)
    .flatMap((value) => String(value).toLocaleLowerCase('ru').split(/[\s/]+/u))
    .filter((value) => value.length >= 4);

  const candidates = practices
    .filter((practice) => !lowResource || practice.level === 'Micro')
    .map((practice) => ({
      practice,
      score:
        matchScore(practice.resource, context.resource, 16)
        + matchScore(practice.barrier, context.barrier, 8)
        + matchScore(practice.need, context.need, 4)
        + matchScore(practice.pattern, context.pattern, 2)
        + (context.route && practice.routes.includes(context.route) ? 1 : 0)
        + searchTerms.reduce((score, term) => score + (textOf(practice).includes(term) ? 0.1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || a.practice.id.localeCompare(b.practice.id));

  return candidates[0]?.practice || null;
}

export function validatePracticeId(practices, practiceId) {
  if (practiceId === null) return null;
  return practices.find((item) => item.id === practiceId) || null;
}
