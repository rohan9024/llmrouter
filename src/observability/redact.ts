const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
  [/x-api-key['":\s=]+[A-Za-z0-9._-]{8,}/gi, 'x-api-key=[REDACTED]'],
  [/x-goog-api-key['":\s=]+[A-Za-z0-9._-]{8,}/gi, 'x-goog-api-key=[REDACTED]'],
  [/\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]'],
  [/\bgsk_[A-Za-z0-9_-]{12,}/g, 'gsk_[REDACTED]'],
  [/\bAIza[0-9A-Za-z_-]{16,}/g, 'AIza[REDACTED]'],
  [/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[REDACTED]']
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === 'authorization' ||
      lower === 'x-api-key' ||
      lower === 'x-goog-api-key' ||
      lower.includes('secret') ||
      lower.includes('token')
    ) {
      clean[key] = '[REDACTED]';
    } else {
      clean[key] = redactSecrets(val);
    }
  }
  return clean;
}
