import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../src/utils/Logger';

describe('Logger', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        Logger.setCorrelationId(undefined);
    });

    it('handles circular structures without throwing', () => {
        const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const payload: Record<string, unknown> = { user: 'agent', password: 'top-secret' };
        payload.self = payload;

        expect(() => Logger.error('circular context', payload)).not.toThrow();
        expect(writeSpy).toHaveBeenCalled();

        const line = String(writeSpy.mock.calls.at(-1)?.[0] ?? '').trim();
        const record = JSON.parse(line) as Record<string, unknown>;

        expect(record.msg).toBe('circular context');
        expect(record.password).toBe('[REDACTED]');
        expect(record.self).toBe('[Circular]');
    });

    it('survives unserializable context members', () => {
        const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const ctx: Record<string, unknown> = {};

        Object.defineProperty(ctx, 'explosive', {
            enumerable: true,
            get() {
                throw new Error('getter exploded');
            },
        });

        expect(() => Logger.error('getter context', ctx)).not.toThrow();
        expect(writeSpy).toHaveBeenCalled();

        const line = String(writeSpy.mock.calls.at(-1)?.[0] ?? '').trim();
        const record = JSON.parse(line) as Record<string, unknown>;

        expect(record.msg).toBe('getter context');
    });
});
