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
