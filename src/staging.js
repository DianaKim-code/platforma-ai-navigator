export function stagingRuntime(locationLike = {}) {
  const hostname = String(locationLike.hostname || '').toLocaleLowerCase('en');
  const localPreview = ['localhost', '127.0.0.1'].includes(hostname);
  const vercelPreview = hostname.endsWith('.vercel.app');
  const analyticsTest = vercelPreview
    && new URLSearchParams(String(locationLike.search || '')).get('analytics_test') === '1';
  return {
    localPreview,
    vercelPreview,
    analyticsTest,
    bufferAnalytics: localPreview || (vercelPreview && !analyticsTest),
  };
}

export function markAnalyticsTestPayload(payload = {}, enabled = false, fallbackLabel = 'staging') {
  if (!enabled) return { ...payload };
  const label = payload.event || payload.status || fallbackLabel;
  return {
    ...payload,
    testEvent: true,
    comment: payload.comment ? `TEST_EVENT: ${payload.comment}` : `TEST_EVENT: ${label}`,
  };
}

export const FEEDBACK_SENT_MESSAGE = 'Обратная связь отправлена.';

export function createPreviewAwareSender({
  endpoint = '/api/feedback',
  runtime = {},
  sink = [],
  fetchImpl = globalThis.fetch,
}) {
  return async function send(payload = {}) {
    const isMeaningfulJourneyEvent = ['feedback_submitted', 'profile_opened', 'whatsapp_clicked']
      .includes(payload.event);
    const isPreviewJourneyEvent = Boolean(
      runtime.vercelPreview && isMeaningfulJourneyEvent,
    );
    const outgoing = markAnalyticsTestPayload(
      payload,
      Boolean(runtime.analyticsTest || isPreviewJourneyEvent),
    );

    if (runtime.bufferAnalytics && !isPreviewJourneyEvent) {
      sink.push(outgoing);
      return { preview: true, payload: outgoing };
    }

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outgoing),
      keepalive: true,
    });
    if (!response?.ok) throw new Error('FEEDBACK_REQUEST_FAILED');
    const confirmation = await response.json();
    if (confirmation?.ok !== true) throw new Error('FEEDBACK_NOT_CONFIRMED');
    return { preview: false, payload: outgoing, response, confirmation };
  };
}
