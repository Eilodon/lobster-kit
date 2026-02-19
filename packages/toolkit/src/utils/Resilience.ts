/**
 * 🛡️ EIDOLON RESILIENCE UTILITY
 * "The Immune System"
 *
 * UPGRADES vs. original:
 * 1. Full-jitter: random(0, delay) → eliminates thundering herd
 * 2. Circuit Breaker (zero-dep state machine) → prevents cascade failure
 * 3. All logging routed through structured Logger
 * 4. totalTimeoutMs: caps total duration of all retry attempts
 */

import { Logger } from './Logger';

// ─────────────────────────────────────────────
// Retry
// ─────────────────────────────────────────────

export interface RetryConfig {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    /** If true, uses full-jitter: random(0, delay). Default: true */
    jitter: boolean;
    /** Cap on total wall-clock time across all attempts (ms). 0 = unlimited */
    totalTimeoutMs: number;
    /** Return false to abort retry immediately (e.g. for 4xx errors) */
    shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_CONFIG: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    jitter: true,
    totalTimeoutMs: 0,
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type RetryErrorLike = {
    message?: unknown;
    response?: {
        status?: unknown;
        headers?: Record<string, unknown>;
    };
};

function asRetryError(error: unknown): RetryErrorLike {
    return (typeof error === 'object' && error !== null) ? (error as RetryErrorLike) : {};
}

function getRetryErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    const err = asRetryError(error);
    return typeof err.message === 'string' ? err.message : String(error);
}

export async function withRetry<T>(
    fn: () => Promise<T>,
    config: Partial<RetryConfig> = {}
): Promise<T> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();
    let lastError: unknown = new Error('Retry attempts exhausted');

    for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
        // Check total timeout budget before each attempt
        if (cfg.totalTimeoutMs > 0 && Date.now() - startTime >= cfg.totalTimeoutMs) {
            Logger.warn('Retry budget exhausted (totalTimeoutMs)', {
                elapsed: Date.now() - startTime,
                totalTimeoutMs: cfg.totalTimeoutMs,
            });
            break;
        }

        try {
            return await fn();
        } catch (error: unknown) {
            lastError = error;
            const err = asRetryError(error);
            const message = getRetryErrorMessage(error);
            const status = typeof err.response?.status === 'number' ? err.response.status : null;

            if (attempt === cfg.maxAttempts) {
                Logger.error('Retry limit reached', { attempt, maxAttempts: cfg.maxAttempts, error: message });
                break;
            }

            // FIX L11: Skip 4xx (except 429 rate-limit)
            if (status !== null && status >= 400 && status < 500) {
                if (status === 429) {
                    const retryAfterRaw = err.response?.headers?.['retry-after'];
                    const retryAfter = parseInt(String(retryAfterRaw ?? '5'), 10);
                    Logger.warn('Rate limited (429)', { retryAfterSec: retryAfter });
                    await sleep(retryAfter * 1000);
                    continue;
                }
                throw error; // hard abort on 400/401/403/404
            }

            // FIX U4: Custom shouldRetry predicate
            if (cfg.shouldRetry && !cfg.shouldRetry(error)) {
                Logger.warn('Retry aborted by shouldRetry predicate', { error: message });
                throw error;
            }

            // Full-jitter backoff: random(0, min(maxDelay, base * 2^attempt))
            const cap = Math.min(cfg.maxDelay, cfg.baseDelay * Math.pow(2, attempt - 1));
            const delay = cfg.jitter ? Math.random() * cap : cap;

            Logger.warn('Attempt failed, retrying', {
                attempt,
                nextDelayMs: Math.round(delay),
                error: message,
            });
            await sleep(delay);
        }
    }

    if (lastError instanceof Error) {
        throw lastError;
    }
    throw new Error(String(lastError));
}

// ─────────────────────────────────────────────
// withTimeout (unchanged, kept for compatibility)
// ─────────────────────────────────────────────

export function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    errorMessage: string = 'Operation timed out'
): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(errorMessage));
        }, ms);
        if (timeoutId.unref) timeoutId.unref();
    });

    return Promise.race([
        promise.then(res => { clearTimeout(timeoutId); return res; })
            .catch(err => { clearTimeout(timeoutId); throw err; }),
        timeoutPromise,
    ]);
}

// ─────────────────────────────────────────────
// Circuit Breaker (zero-dep state machine)
// ─────────────────────────────────────────────

type CBState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
    /** % of failures to trip open. Default: 50 */
    failureThresholdPct: number;
    /** Minimum calls before CB evaluates. Default: 5 */
    minCalls: number;
    /** How long to stay OPEN before testing (ms). Default: 30_000 */
    resetTimeoutMs: number;
    /** Rolling window size (call count). Default: 10 */
    windowSize: number;
}

const CB_DEFAULTS: CircuitBreakerOptions = {
    failureThresholdPct: 50,
    minCalls: 5,
    resetTimeoutMs: 30_000,
    windowSize: 10,
};

export class CircuitBreaker {
    private state: CBState = 'CLOSED';
    private readonly window: boolean[] = []; // true = success, false = failure
    private openedAt = 0;
    private readonly opts: CircuitBreakerOptions;
    private readonly name: string;

    constructor(name: string, opts: Partial<CircuitBreakerOptions> = {}) {
        this.name = name;
        this.opts = { ...CB_DEFAULTS, ...opts };
    }

    get currentState(): CBState {
        return this.state;
    }

    async fire<T>(fn: () => Promise<T>): Promise<T> {
        this._maybeHalfOpen();

        if (this.state === 'OPEN') {
            throw new Error(`[CircuitBreaker:${this.name}] Circuit is OPEN – request rejected`);
        }

        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (err) {
            this._onFailure();
            throw err;
        }
    }

    private _maybeHalfOpen(): void {
        if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.opts.resetTimeoutMs) {
            this.state = 'HALF_OPEN';
            Logger.info(`CircuitBreaker HALF_OPEN`, { name: this.name });
        }
    }

    private _onSuccess(): void {
        if (this.state === 'HALF_OPEN') {
            this.state = 'CLOSED';
            this.window.length = 0;
            Logger.info(`CircuitBreaker CLOSED (recovered)`, { name: this.name });
        }
        this._record(true);
    }

    private _onFailure(): void {
        this._record(false);
        if (this.state === 'HALF_OPEN') {
            // Probe failed → stay open, reset timer
            this.state = 'OPEN';
            this.openedAt = Date.now();
            Logger.warn(`CircuitBreaker re-OPENED after probe failure`, { name: this.name });
            return;
        }
        this._evaluate();
    }

    private _record(success: boolean): void {
        this.window.push(success);
        if (this.window.length > this.opts.windowSize) {
            this.window.shift();
        }
    }

    private _evaluate(): void {
        if (this.state !== 'CLOSED') return;
        if (this.window.length < this.opts.minCalls) return;

        const failures = this.window.filter(v => !v).length;
        const pct = (failures / this.window.length) * 100;

        if (pct >= this.opts.failureThresholdPct) {
            this.state = 'OPEN';
            this.openedAt = Date.now();
            Logger.error(`CircuitBreaker OPEN`, {
                name: this.name,
                failurePct: pct.toFixed(1),
                window: this.window.length,
            });
        }
    }
}
