const DEFAULT_ANALYTICS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxWlWcNAVqCeSRBZYefApC-p2H9JP6CFFzdaAMcaXUSFA9zFebGWSkTAmaDzKkEmSY0/exec';
const FEEDBACK_TIMEOUT_MS = 12_000;
const EVENTS = new Set(['feedback_submitted', 'profile_opened', 'whatsapp_clicked']);
const OPEN_TEXT_FIELDS = new Set([
  'openConcern', 'openFeedback', 'mainConcern', 'desiredAction', 'stopFeeling', 'ownAction',
]);
const ALLOWED_FIELDS = new Set([
  'sessionId', 'event', 'schemaVersion', 'startedAt', 'completedAt', 'status', 'resultStatus',
  'mainSituation', 'duration', 'lifeImpact', 'triedBefore', 'desiredResult', 'currentNeed',
  'resourceLevel', 'safetyLevel', 'route', 'practice', 'reflectionScore', 'explanationScore',
  'clarityScore', 'stepRealism', 'trustScore', 'recognition', 'repetition', 'bookingReadiness',
  'bookingClicked', 'consent', 'source', 'timestamp', 'testEvent', 'openTextConsent',
  'openConcern', 'openFeedback', 'specialistId', 'page', 'profileOpened', 'whatsappClicked',
]);

export class FeedbackError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function sanitizeFeedbackPayload(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new FeedbackError('INVALID_FEEDBACK_PAYLOAD', 400);
  }
  const sessionId = String(input.sessionId || '').trim();
  const event = String(input.event || '').trim();
  if (!sessionId || sessionId.length > 128 || !EVENTS.has(event)) {
    throw new FeedbackError('INVALID_FEEDBACK_PAYLOAD', 400);
  }
  const clean = Object.fromEntries(
    Object.entries(input).filter(([field]) => ALLOWED_FIELDS.has(field)),
  );
  Object.assign(clean, { sessionId, event, schemaVersion: 'v3' });
  const consent = clean.openTextConsent === true;
  clean.openTextConsent = consent;
  if (!consent) OPEN_TEXT_FIELDS.forEach((field) => delete clean[field]);
  return clean;
}

export function createFeedbackProcessor({
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = FEEDBACK_TIMEOUT_MS,
} = {}) {
  const endpoint = env.ANALYTICS_ENDPOINT || DEFAULT_ANALYTICS_ENDPOINT;
  return async function processFeedback(input) {
    const payload = sanitizeFeedbackPayload(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (error) {
        throw new FeedbackError(error?.name === 'AbortError'
          ? 'FEEDBACK_TIMEOUT'
          : 'FEEDBACK_UPSTREAM_UNAVAILABLE');
      }
      if (!response.ok) throw new FeedbackError('FEEDBACK_UPSTREAM_UNAVAILABLE');
      let result;
      try {
        result = await response.json();
      } catch {
        throw new FeedbackError('FEEDBACK_INVALID_RESPONSE');
      }
      if (result?.success !== true) throw new FeedbackError('FEEDBACK_NOT_STORED');
      return { ok: true };
    } finally {
      clearTimeout(timer);
    }
  };
}

export { FEEDBACK_TIMEOUT_MS };
