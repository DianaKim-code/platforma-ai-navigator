export class HttpInputError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export class ProviderError extends Error {
  constructor(code, diagnostics = {}) {
    super(code);
    this.code = code;
    const allowedStages = new Set([
      'provider_body_json_parse_failed',
      'provider_content_missing',
      'provider_content_json_parse_failed',
      'schema_validation_failed',
      'practice_validation_failed',
    ]);
    const safeToken = (value) => typeof value === 'string' && /^[a-zA-Z0-9_. <>-]{1,100}$/u.test(value);
    const validationErrors = Array.isArray(diagnostics.validationErrors)
      ? diagnostics.validationErrors
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          ...(safeToken(item.code) ? { code: item.code } : {}),
          ...(safeToken(item.field) ? { field: item.field } : {}),
          ...(safeToken(item.expected) ? { expected: item.expected } : {}),
          ...(safeToken(item.actual) ? { actual: item.actual } : {}),
        }))
        .filter((item) => item.code && item.field && item.expected && item.actual)
      : [];
    this.diagnostics = Object.freeze({
      ...(Number.isInteger(diagnostics.upstreamStatus)
        ? { upstreamStatus: diagnostics.upstreamStatus }
        : {}),
      ...(typeof diagnostics.safeCategory === 'string'
        ? { safeCategory: diagnostics.safeCategory }
        : {}),
      ...(typeof diagnostics.upstreamCode === 'string'
        ? { upstreamCode: diagnostics.upstreamCode }
        : {}),
      ...(allowedStages.has(diagnostics.stage)
        ? { stage: diagnostics.stage }
        : {}),
      ...(validationErrors.length
        ? { validationErrors: Object.freeze(validationErrors.map(Object.freeze)) }
        : {}),
    });
  }
}
