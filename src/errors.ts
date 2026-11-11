export interface ProviderErrorDetail {
  target: string;
  error: string;
  status?: number;
}

export class AllProvidersFailedError extends Error {
  public readonly errors: ProviderErrorDetail[];

  constructor(errors: ProviderErrorDetail[]) {
    const summary = errors
      .map((e) => `[${e.target}] (status: ${e.status ?? 'N/A'}) - ${e.error}`)
      .join('; ');
    super(`All configured LLM providers failed: ${summary}`);
    this.name = 'AllProvidersFailedError';
    this.errors = errors;
  }
}

export class ProviderRequestError extends Error {
  public readonly status?: number;
  public readonly isRetryable: boolean;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderRequestError';
    this.status = status;
    this.isRetryable = !status || status === 429 || status >= 500;
  }
}