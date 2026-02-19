import { createHash, createHmac, timingSafeEqual } from 'crypto';

type HashAlgorithm = 'sha256' | 'sha512';

// ─────────────────────────────────────────────
// BigInt-safe JSON replacer
// ─────────────────────────────────────────────

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

// ─────────────────────────────────────────────
// Normalize for canonical hashing
// ─────────────────────────────────────────────

function normalizeForHashing(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalizeForHashing);
  if (typeof value !== 'object') return value;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  const normalized: Record<string, unknown> = {};
  for (const [key, raw] of entries) {
    if (key === 'configIntegrity' && raw && typeof raw === 'object') {
      // Strip expectedHash from hash computation to avoid self-reference
      const rest = { ...(raw as Record<string, unknown>) };
      delete rest.expectedHash;
      if (Object.keys(rest).length > 0) {
        normalized[key] = normalizeForHashing(rest);
      }
      continue;
    }
    normalized[key] = normalizeForHashing(raw);
  }
  return normalized;
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export function computeConfigHash(config: unknown, algorithm: HashAlgorithm = 'sha256'): string {
  const canonical = JSON.stringify(normalizeForHashing(config), bigIntReplacer);
  return createHash(algorithm).update(canonical).digest('hex');
}

/**
 * Optional HMAC-based authenticity check.
 * Returns the HMAC-SHA256 tag for the canonical config.
 */
export function computeConfigHmac(config: unknown, secret: string): string {
  const canonical = JSON.stringify(normalizeForHashing(config), bigIntReplacer);
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * Verify config integrity (hash) and optional authenticity (HMAC).
 *
 * @param config     The config object to verify
 * @param sourceName Human-readable name for error messages
 * @param hmacSecret If provided, also verifies HMAC authenticity tag
 */
export function verifyConfigIntegrity(
  config: unknown,
  sourceName: string = 'Config',
  hmacSecret?: string,
): void {
  const typedConfig = (config && typeof config === 'object') ? config as Record<string, unknown> : {};
  const integrity = (typedConfig.configIntegrity && typeof typedConfig.configIntegrity === 'object')
    ? typedConfig.configIntegrity as Record<string, unknown>
    : undefined;
  if (!integrity?.expectedHash) return;

  const algorithm: HashAlgorithm = integrity.algorithm === 'sha512' ? 'sha512' : 'sha256';
  const actual = computeConfigHash(config, algorithm);
  const expected = String(integrity.expectedHash).toLowerCase();
  const strict = integrity.strict !== false;

  // Timing-safe comparison (prevents timing attacks)
  let hashMatch: boolean;
  try {
    hashMatch = timingSafeEqual(
      Buffer.from(actual, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    // Buffer length mismatch → definitely tampered
    hashMatch = false;
  }

  if (!hashMatch) {
    const message = `ATOMIC CONFIG CHECKSUM MISMATCH (${sourceName}): expected ${expected}, got ${actual}`;
    if (strict) throw new Error(message);
    console.warn(message);
    return;
  }

  // Optional HMAC authenticity check
  if (hmacSecret && integrity.expectedHmac) {
    const actualHmac = computeConfigHmac(config, hmacSecret);
    const expectedHmac = String(integrity.expectedHmac).toLowerCase();

    let hmacMatch: boolean;
    try {
      hmacMatch = timingSafeEqual(
        Buffer.from(actualHmac, 'hex'),
        Buffer.from(expectedHmac, 'hex'),
      );
    } catch {
      hmacMatch = false;
    }

    if (!hmacMatch) {
      const message = `ATOMIC CONFIG AUTHENTICITY FAIL (${sourceName}): HMAC mismatch`;
      if (strict) throw new Error(message);
      console.warn(message);
    }
  }
}
