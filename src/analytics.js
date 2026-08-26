const OPEN_TEXT_FIELDS = new Set(['openConcern', 'openFeedback', 'mainConcern', 'desiredAction', 'stopFeeling', 'ownAction']);

export function stripUnconsentedOpenText(payload, consent) {
  const clean = { ...payload };
  if (!consent) OPEN_TEXT_FIELDS.forEach((field) => delete clean[field]);
  return clean;
}

export function analyticsPayload(event, sessionId, meta = {}) {
  const cleanMeta = stripUnconsentedOpenText(meta, Boolean(meta.openTextConsent));
  delete cleanMeta.openTextConsent;
  return {
    sessionId,
    status: event,
    event,
    page: 'navigator',
    timestamp: new Date().toISOString(),
    source: 'navigator_mvp_v3_beta',
    ...cleanMeta,
  };
}

export function createV3FeedbackPayload(input = {}) {
  const {
    openTextConsent = false,
    openConcern = '',
    openFeedback = '',
    ...structured
  } = input;
  const payload = {
    ...structured,
    status: structured.status || 'завершено',
    event: structured.event || 'feedback_submitted',
    timestamp: structured.timestamp || new Date().toISOString(),
    openTextConsent: Boolean(openTextConsent),
  };
  if (openTextConsent) {
    payload.openConcern = openConcern;
    payload.openFeedback = openFeedback;
  }
  return stripUnconsentedOpenText(payload, openTextConsent);
}

export function createAnalytics({ endpoint, sessionId, local = false, sink = [] }) {
  async function send(event, meta = {}) {
    const payload = analyticsPayload(event, sessionId, meta);
    if (local) {
      sink.push(payload);
      return { preview: true, payload };
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      mode: 'no-cors',
      keepalive: true,
    });
    return { preview: false, response };
  }
  return { send, sink };
}

