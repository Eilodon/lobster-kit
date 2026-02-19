/**
 * 🌐 CENTRAL EXTERNAL API GATEWAY
 *
 * Centralizes ALL outbound HTTP calls. Enforces:
 * - Per-domain token-bucket rate limiting
 * - Circuit breaker (fail-fast after N consecutive errors)
 * - Privacy mode: blocks external calls in 'strict' mode
 * - Automatic retry with exponential backoff
 *
 * Usage:
 *   import { getGateway } from './ApiGateway';
 *   const data = await getGateway(config).get(url);
 */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { ClawKitConfig } from '../types';

// ─── Rate Limiter (Token Bucket) ─────────────────────────────────────────────

interface TokenBucket {
    tokens: number;
    lastRefill: number;
}

const DOMAIN_LIMITS: Record<string, { rps: number; burst: number }> = {
    'api.coingecko.com': { rps: 2, burst: 4 },
    'api.binance.com': { rps: 5, burst: 10 },
    'api.gopluslabs.io': { rps: 5, burst: 10 },
    'farms-api.pancakeswap.com': { rps: 3, burst: 6 },
    'gateway.thegraph.com': { rps: 5, burst: 10 },
    'default': { rps: 10, burst: 20 },
};

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

const CIRCUIT_OPEN_DURATION_MS = 30_000; // 30s open window
const FAILURE_THRESHOLD = 5;             // open after 5 consecutive failures

interface CircuitState {
    failures: number;
    openUntil: number;
}

// ─── ExternalAPIGateway ───────────────────────────────────────────────────────

export class ExternalAPIGateway {
    private buckets = new Map<string, TokenBucket>();
    private circuits = new Map<string, CircuitState>();

    constructor(private config: ClawKitConfig) { }

    // ── Domain helpers ──────────────────────────────────────────────────────────

    private getDomain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return 'default';
        }
    }

    // ── Rate Limiting ───────────────────────────────────────────────────────────

    private async waitForToken(domain: string): Promise<void> {
        const limit = DOMAIN_LIMITS[domain] ?? DOMAIN_LIMITS['default'];
        const bucket = this.buckets.get(domain) ?? { tokens: limit.burst, lastRefill: Date.now() };

        const now = Date.now();
        const elapsed = (now - bucket.lastRefill) / 1000;
        bucket.tokens = Math.min(limit.burst, bucket.tokens + elapsed * limit.rps);
        bucket.lastRefill = now;

        if (bucket.tokens < 1) {
            const waitMs = ((1 - bucket.tokens) / limit.rps) * 1000;
            await new Promise(r => setTimeout(r, waitMs));
            bucket.tokens = 1;
        }

        bucket.tokens -= 1;
        this.buckets.set(domain, bucket);
    }

    // ── Circuit Breaker ─────────────────────────────────────────────────────────

    private isCircuitOpen(domain: string): boolean {
        const state = this.circuits.get(domain);
        if (!state) return false;
        if (Date.now() < state.openUntil) return true;
        // Half-open: reset for probe
        state.failures = 0;
        state.openUntil = 0;
        return false;
    }

    private recordSuccess(domain: string): void {
        const state = this.circuits.get(domain);
        if (state) state.failures = 0;
    }

    private recordFailure(domain: string): void {
        const state = this.circuits.get(domain) ?? { failures: 0, openUntil: 0 };
        state.failures += 1;
        if (state.failures >= FAILURE_THRESHOLD) {
            state.openUntil = Date.now() + CIRCUIT_OPEN_DURATION_MS;
            console.warn(`⚡ Circuit OPEN for ${domain} for ${CIRCUIT_OPEN_DURATION_MS / 1000}s`);
        }
        this.circuits.set(domain, state);
    }

    // ── Core Request ────────────────────────────────────────────────────────────

    async get<T = unknown>(url: string, axiosConfig?: AxiosRequestConfig): Promise<T> {
        // Privacy guard
        const isStrict = this.config.privacyMode === 'strict';
        if (isStrict) {
            throw new Error(`🔒 PRIVACY_BLOCKED: External call to ${url} blocked in 'strict' mode.`);
        }

        const domain = this.getDomain(url);

        // Circuit check
        if (this.isCircuitOpen(domain)) {
            throw new Error(`⚡ CIRCUIT_OPEN: ${domain} is temporarily unavailable.`);
        }

        // Rate limit
        await this.waitForToken(domain);

        // Execute with retry
        let lastError: Error | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res: AxiosResponse<T> = await axios.get<T>(url, {
                    timeout: 8000,
                    ...axiosConfig,
                });
                this.recordSuccess(domain);
                return res.data;
            } catch (err: unknown) {
                lastError = err instanceof Error ? err : new Error(String(err));
                const status = (typeof err === 'object' && err !== null && 'response' in err)
                    ? (err as { response?: { status?: number } }).response?.status
                    : undefined;

                // Don't retry client errors (400, 401, 403, 404)
                if (status && status >= 400 && status < 500 && status !== 429) {
                    this.recordFailure(domain);
                    throw lastError;
                }

                // Backoff: 500ms, 1000ms, 2000ms
                const backoff = 500 * Math.pow(2, attempt);
                console.warn(`⚠️ [Gateway] ${domain} attempt ${attempt + 1} failed, retrying in ${backoff}ms…`);
                await new Promise(r => setTimeout(r, backoff));
            }
        }

        this.recordFailure(domain);
        throw lastError ?? new Error(`Request to ${url} failed`);
    }

    async post<T = unknown>(url: string, body: unknown, axiosConfig?: AxiosRequestConfig): Promise<T> {
        const isStrict = this.config.privacyMode === 'strict';
        if (isStrict) {
            throw new Error(`🔒 PRIVACY_BLOCKED: External call to ${url} blocked in 'strict' mode.`);
        }

        const domain = this.getDomain(url);
        if (this.isCircuitOpen(domain)) {
            throw new Error(`⚡ CIRCUIT_OPEN: ${domain} is temporarily unavailable.`);
        }

        await this.waitForToken(domain);

        const res: AxiosResponse<T> = await axios.post<T>(url, body, {
            timeout: 8000,
            ...axiosConfig,
        });
        this.recordSuccess(domain);
        return res.data;
    }
}

// ─── Module-level singleton factory ──────────────────────────────────────────
// One gateway per config instance (shared across modules).

const gatewayCache = new WeakMap<ClawKitConfig, ExternalAPIGateway>();

export function getGateway(config: ClawKitConfig): ExternalAPIGateway {
    if (!gatewayCache.has(config)) {
        gatewayCache.set(config, new ExternalAPIGateway(config));
    }
    return gatewayCache.get(config)!;
}
