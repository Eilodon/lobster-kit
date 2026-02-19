import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraumaRegistry } from '../src/eidolon/TraumaRegistry';

describe('TraumaRegistry TS-vs-Rust consistency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-17T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should keep inhibition decisions consistent with TS fallback path', () => {
    const hybrid = new TraumaRegistry();
    const tsOnly = new TraumaRegistry();

    // Force pure TS baseline.
    (tsOnly as any).rustRegistry = null;

    hybrid.recordTrauma('ZEN', 'BUY', 1.0);
    tsOnly.recordTrauma('ZEN', 'BUY', 1.0);

    expect(hybrid.isInhibited('ZEN', 'BUY')).toBe(tsOnly.isInhibited('ZEN', 'BUY'));

    const firstRemainingDelta = Math.abs(
      hybrid.getRemainingInhibition('ZEN', 'BUY') - tsOnly.getRemainingInhibition('ZEN', 'BUY')
    );
    expect(firstRemainingDelta).toBeLessThanOrEqual(10);

    vi.advanceTimersByTime(61 * 60 * 1000);

    hybrid.recordTrauma('ZEN', 'BUY', 1.5);
    tsOnly.recordTrauma('ZEN', 'BUY', 1.5);

    expect(hybrid.isInhibited('ZEN', 'BUY')).toBe(tsOnly.isInhibited('ZEN', 'BUY'));

    const secondRemainingDelta = Math.abs(
      hybrid.getRemainingInhibition('ZEN', 'BUY') - tsOnly.getRemainingInhibition('ZEN', 'BUY')
    );
    expect(secondRemainingDelta).toBeLessThanOrEqual(10);
  });

  it('should heal consistently across hybrid and TS-only paths', () => {
    const hybrid = new TraumaRegistry();
    const tsOnly = new TraumaRegistry();
    (tsOnly as any).rustRegistry = null;

    hybrid.recordTrauma('BERSERK', 'SELL', 2.0);
    tsOnly.recordTrauma('BERSERK', 'SELL', 2.0);

    expect(hybrid.isInhibited('BERSERK', 'SELL')).toBe(true);
    expect(tsOnly.isInhibited('BERSERK', 'SELL')).toBe(true);

    hybrid.heal('BERSERK', 'SELL');
    tsOnly.heal('BERSERK', 'SELL');

    expect(hybrid.isInhibited('BERSERK', 'SELL')).toBe(false);
    expect(tsOnly.isInhibited('BERSERK', 'SELL')).toBe(false);
    expect(hybrid.getEffectiveSeverity('BERSERK', 'SELL')).toBe(0);
    expect(tsOnly.getEffectiveSeverity('BERSERK', 'SELL')).toBe(0);
  });
});
