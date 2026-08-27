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
  endpoint,
  runtime = {},
  sink = [],
  fetchImpl = globalThis.fetch,
}) {
  return async function send(payload = {}) {
    const isPreviewFeedback = Boolean(
      runtime.vercelPreview && payload.event === 'feedback_submitted',
    );
    const outgoing = markAnalyticsTestPayload(
      payload,
      Boolean(runtime.analyticsTest || isPreviewFeedback),
    );

    if (runtime.bufferAnalytics && !isPreviewFeedback) {
      sink.push(outgoing);
      return { preview: true, payload: outgoing };
    }

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(outgoing),
      mode: 'no-cors',
      keepalive: true,
    });
    return { preview: false, payload: outgoing, response };
  };
}
