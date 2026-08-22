export class HttpInputError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export class ProviderError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
