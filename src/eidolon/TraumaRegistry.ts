import { createHash } from 'crypto';
import { IStorageProvider } from './memory/IStorageProvider';
import { WasmAdapter } from './WasmAdapter';

interface TraumaHit {
    sevEff: number;
    count: number;
    inhibitUntil: number;
    lastTimestamp: number;
    mode?: string;
    action?: string;
}

type RustTraumaRegistry = {
    record_trauma: (mode: number, action: string, severity: number, nowTsMs: bigint) => void;
    is_inhibited: (mode: number, action: string, nowTsMs: bigint) => boolean;
    get_remaining_ms?: (mode: number, action: string, nowTsMs: bigint) => bigint | number;
    heal: (mode: number, action: string) => void;
};

/**
 * 🛡️ TraumaRegistry: Immune Memory System
 *
 * Hybrid mode:
 * - TS map is canonical fallback and persistence source
 * - Rust registry (if available) is live accelerator/validator
 */
export class TraumaRegistry {
    private records = new Map<string, TraumaHit>();
    private readonly ALPHA = 0.3;
    private readonly MAX_SEVERITY = 5.0;
    private persistence: { storage: IStorageProvider; key: string } | null = null;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;
    private persistInFlight: Promise<void> | null = null;
    private readonly SAVE_DEBOUNCE_MS = 1500;
    private rustRegistry: RustTraumaRegistry | null = null;

    constructor() {
        this.initRustRegistry();
    }

    private parseBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
        if (!value) return defaultValue;
        const normalized = value.trim().toLowerCase();
        if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') return true;
        if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') return false;
        return defaultValue;
    }

    private stableBucket(seed: string): number {
        let hash = 2166136261 >>> 0;
        for (let i = 0; i < seed.length; i++) {
            hash ^= seed.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash % 100;
    }

    private resolveCanaryPercent(): number {
        const raw = process.env.EIDOLON_TRAUMA_RUST_CANARY_PCT ?? process.env.EIDOLON_RUST_CANARY_PCT;
        if (!raw) return 100;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return 100;
        return Math.min(100, Math.max(0, Math.floor(parsed)));
    }

    private shouldEnableRustRegistry(): boolean {
        const enabled = this.parseBooleanFlag(process.env.EIDOLON_TRAUMA_RUST, true);
        if (!enabled) return false;

        const canaryPct = this.resolveCanaryPercent();
        if (canaryPct >= 100) return true;
        if (canaryPct <= 0) return false;

        const canaryKey = process.env.EIDOLON_CANARY_KEY
            || process.env.HOSTNAME
            || process.env.USER
            || 'default';
        const bucket = this.stableBucket(`${canaryKey}:trauma`);
        return bucket < canaryPct;
    }

    private initRustRegistry(): void {
        if (!this.shouldEnableRustRegistry()) {
            this.rustRegistry = null;
            return;
        }
        try {
            const adapter = WasmAdapter.getInstance() as unknown as { createTraumaRegistry?: () => unknown };
            if (typeof adapter.createTraumaRegistry !== 'function') {
                this.rustRegistry = null;
                return;
            }
            const maybe = adapter.createTraumaRegistry() as RustTraumaRegistry | null;
            if (
                maybe &&
                typeof maybe.record_trauma === 'function' &&
                typeof maybe.is_inhibited === 'function' &&
                typeof maybe.heal === 'function'
            ) {
                this.rustRegistry = maybe;
            }
        } catch {
            this.rustRegistry = null;
        }
    }

    public isUsingRust(): boolean {
        return this.rustRegistry !== null;
    }

    private toModeCode(mode: string): number {
        const normalized = mode.toUpperCase();
        const known: Record<string, number> = {
            ZEN: 0,
            STALKING: 1,
            BERSERK: 2,
            ARBITRAGE: 3,
            LIQUIDATION: 4,
            SNIPE: 5,
            EMERGENCY: 6
        };
        if (known[normalized] !== undefined) return known[normalized];

        let hash = 0;
        for (const ch of normalized) {
            hash = ((hash * 31) + ch.charCodeAt(0)) & 0xff;
        }
        return hash;
    }

    public async initPersistence(
        storage: IStorageProvider,
        key: string = 'eidolon_trauma_registry.json'
    ): Promise<void> {
        this.persistence = { storage, key };
        const saved = await storage.load<{
            records: Array<{ key: string; hit: TraumaHit }>;
            savedAt: number;
        }>(key);

        if (!saved?.records?.length) return;
        this.records.clear();
        for (const entry of saved.records) {
            if (!entry?.key || !entry?.hit) continue;
            this.records.set(entry.key, entry.hit);
        }
    }

    recordTrauma(mode: string, action: string, severity: number): void {
        const key = this.hashContext(mode, action);
        const existing = this.records.get(key);
        const now = Date.now();

        if (existing) {
            const newCount = existing.count + 1;
            const hours = Math.min(1 << (newCount - 1), 24);
            const inhibitDuration = hours * 3600 * 1000;
            const newSev = existing.sevEff * (1 - this.ALPHA) + severity * this.ALPHA;

            this.records.set(key, {
                sevEff: Math.min(newSev, this.MAX_SEVERITY),
                count: newCount,
                inhibitUntil: now + inhibitDuration,
                lastTimestamp: now,
                mode,
                action
            });

            console.warn(`🛡️ TRAUMA REINFORCED: [${mode}:${action}] blocked for ${hours}h. Severity: ${newSev.toFixed(2)}`);
        } else {
            const hours = 1;
            this.records.set(key, {
                sevEff: severity,
                count: 1,
                inhibitUntil: now + hours * 3600 * 1000,
                lastTimestamp: now,
                mode,
                action
            });

            console.warn(`🛡️ TRAUMA REGISTERED: [${mode}:${action}] blocked for ${hours}h.`);
        }

        this.schedulePersist();
        this.recordToRust(mode, action, severity, now);
    }

    isInhibited(mode: string, action: string): boolean {
        const now = Date.now();
        const nowBigInt = BigInt(now);
        const key = this.hashContext(mode, action);
        const hit = this.records.get(key);
        const tsInhibited = !!hit && now <= hit.inhibitUntil;

        let rustInhibited = false;
        if (this.rustRegistry) {
            try {
                rustInhibited = this.rustRegistry.is_inhibited(this.toModeCode(mode), action, nowBigInt);
            } catch {
                rustInhibited = false;
            }
        }

        return tsInhibited || rustInhibited;
    }

    getEffectiveSeverity(mode: string, action: string): number {
        const key = this.hashContext(mode, action);
        return this.records.get(key)?.sevEff ?? 0;
    }

    getRemainingInhibition(mode: string, action: string): number {
        const now = Date.now();
        const nowBigInt = BigInt(now);
        const key = this.hashContext(mode, action);
        const hit = this.records.get(key);
        const tsRemaining = hit ? Math.max(0, hit.inhibitUntil - now) : 0;

        let rustRemaining = 0;
        if (this.rustRegistry?.get_remaining_ms) {
            try {
                const raw = this.rustRegistry.get_remaining_ms(this.toModeCode(mode), action, nowBigInt);
                const remaining = typeof raw === 'bigint' ? Number(raw) : raw;
                rustRemaining = Math.max(0, Number.isFinite(remaining) ? remaining : 0);
            } catch {
                rustRemaining = 0;
            }
        }

        return Math.max(tsRemaining, rustRemaining);
    }

    heal(mode: string, action: string): void {
        const key = this.hashContext(mode, action);
        this.records.delete(key);
        this.schedulePersist();

        if (this.rustRegistry) {
            try {
                this.rustRegistry.heal(this.toModeCode(mode), action);
            } catch {
                // ignore rust heal failures
            }
        }
    }

    public async flush(): Promise<void> {
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        await this.persistNow();
    }

    private schedulePersist(): void {
        if (!this.persistence) return;
        if (this.persistTimer) return;

        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            void this.persistNow();
        }, this.SAVE_DEBOUNCE_MS);
    }

    private async persistNow(): Promise<void> {
        if (!this.persistence) return;
        if (this.persistInFlight) {
            await this.persistInFlight;
            return;
        }

        const payload = {
            savedAt: Date.now(),
            records: Array.from(this.records.entries()).map(([key, hit]) => ({ key, hit }))
        };

        this.persistInFlight = this.persistence.storage
            .save(this.persistence.key, payload)
            .catch((e) => {
                console.warn('Failed to persist trauma registry', e);
            })
            .finally(() => {
                this.persistInFlight = null;
            });

        await this.persistInFlight;
    }

    private hashContext(mode: string, action: string): string {
        return createHash('sha256')
            .update(mode)
            .update(action)
            .digest('hex');
    }

    private recordToRust(mode: string, action: string, severity: number, nowTs: number): void {
        if (!this.rustRegistry) return;
        try {
            this.rustRegistry.record_trauma(
                this.toModeCode(mode),
                action,
                severity,
                BigInt(nowTs)
            );
        } catch {
            // ignore rust write failures
        }
    }
}
