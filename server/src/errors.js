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
    });
  }
}
