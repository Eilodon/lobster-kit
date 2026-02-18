import { createHash } from 'crypto';

type HashAlgorithm = 'sha256';

function normalizeForHashing(value: any): any {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(normalizeForHashing);
  }

  if (typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  const normalized: Record<string, any> = {};
  for (const [key, raw] of entries) {
    if (key === 'configIntegrity' && raw && typeof raw === 'object') {
      const { expectedHash: _ignoredExpectedHash, ...rest } = raw as Record<string, any>;
      if (Object.keys(rest).length > 0) {
        normalized[key] = normalizeForHashing(rest);
      }
      continue;
    }
    normalized[key] = normalizeForHashing(raw);
  }

  return normalized;
}

export function computeConfigHash(config: unknown, algorithm: HashAlgorithm = 'sha256'): string {
  const canonical = JSON.stringify(normalizeForHashing(config));
  return createHash(algorithm).update(canonical).digest('hex');
}

export function verifyConfigIntegrity(
  config: any,
  sourceName: string = 'Config'
): void {
  const integrity = config?.configIntegrity;
  if (!integrity?.expectedHash) return;

  const algorithm: HashAlgorithm = integrity.algorithm || 'sha256';
  const actual = computeConfigHash(config, algorithm);
  const expected = String(integrity.expectedHash).toLowerCase();
  const strict = integrity.strict !== false;

  if (actual !== expected) {
    const message = `ATOMIC CONFIG CHECKSUM MISMATCH (${sourceName}): expected ${expected}, got ${actual}`;
    if (strict) {
      throw new Error(message);
    }
    console.warn(message);
  }
}
