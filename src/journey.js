export const JOURNEY_KEY = 'platformaNavigatorJourney';
export const LEGACY_SESSION_KEY = 'platformaSessionId';

function defaultId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `navigator_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function readJourney(storage) {
  try {
    const value = JSON.parse(storage?.getItem(JOURNEY_KEY) || 'null');
    return value && typeof value.sessionId === 'string' && value.sessionId
      ? value
      : null;
  } catch {
    return null;
  }
}

export function getJourneyContext({
  storage = globalThis.sessionStorage,
  createId = defaultId,
  now = () => new Date().toISOString(),
} = {}) {
  const existing = readJourney(storage);
  if (existing) return existing;

  let legacyId = '';
  try {
    legacyId = storage?.getItem(LEGACY_SESSION_KEY) || '';
  } catch {}
  const journey = {
    sessionId: legacyId || createId(),
    startedAt: now(),
  };
  try {
    storage?.setItem(JOURNEY_KEY, JSON.stringify(journey));
    storage?.setItem(LEGACY_SESSION_KEY, journey.sessionId);
  } catch {}
  return journey;
}

export function clearJourneyContext(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(JOURNEY_KEY);
    storage?.removeItem(LEGACY_SESSION_KEY);
  } catch {}
}

