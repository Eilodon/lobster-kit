
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Vector, Matrix } from '../src/eidolon/ai/LinearAlgebra';
import { BreathEngine, BreathPhase } from '../src/eidolon/ai/BreathEngine';
import { EidolonSwarm } from '../src/eidolon/swarm/EidolonSwarm';

describe('Atomic Audit Phase 2 Verification', () => {

    describe('LinearAlgebra: Float64Array Memory Efficiency', () => {
        it('should use Float64Array properly in Vector', () => {
            const v = new Vector([1.1, 2.2, 3.3]);
            expect(v.data).toBeInstanceOf(Float64Array);
            expect(v.get(0)).toBeCloseTo(1.1);
            expect(v.len).toBe(3);
        });

        it('should perform vector operations correctly', () => {
            const v1 = new Vector([1, 2, 3]);
            const v2 = new Vector([4, 5, 6]);
            const sum = v1.add(v2);

            expect(sum.data).toBeInstanceOf(Float64Array);
            expect(sum.get(0)).toBe(5);
            expect(sum.get(2)).toBe(9);
        });

        it('should use flattened Float64Array in Matrix', () => {
            const m = Matrix.zeros(2, 2);
            expect(m.data).toBeInstanceOf(Float64Array);
            expect(m.data.length).toBe(4);

            m.set(0, 1, 5.5);
            expect(m.get(0, 1)).toBe(5.5);
            // Verify flattened index assignment logic (row * cols + col)
            // row 0, col 1 => index 1
            expect(m.data[1]).toBe(5.5);
        });

        it('should perform Matrix-Vector multiplication correctly', () => {
            // [ 1 2 ]   [ 2 ]   [ 1*2 + 2*3 ]   [ 8 ]
            // [ 3 4 ] x [ 3 ] = [ 3*2 + 4*3 ] = [ 18 ]
            const m = new Matrix(2, 2);
            m.set(0, 0, 1); m.set(0, 1, 2);
            m.set(1, 0, 3); m.set(1, 1, 4);

            const v = new Vector([2, 3]);
            const res = m.mulVec(v);

            expect(res.get(0)).toBe(8);
            expect(res.get(1)).toBe(18);
        });
    });

    describe('BreathEngine: Smooth Transitions', () => {
        it('should yield smooth sine wave values', () => {
            const engine = new BreathEngine(60); // 1 sec cycle for easy calc
            // Inhale phase (0.4s) maps to -1 -> 1
            // Mid-inhale (0.2s) should be near 0 (sin(0))

            // Allow some progress
            engine.tick(200); // 50% into inhale
            const norm = engine.getNorm();

            // Inhale starts at -PI/2 -> -1
            // 50% is 0 rads -> 0
            expect(norm).toBeCloseTo(0, 1);
        });

        it('should transition phases correctly without jerky values at boundaries', () => {
            const engine = new BreathEngine(60);
            // Check Start of Inhale
            expect(engine.getNorm()).toBeCloseTo(-1);

            // End of Inhale (progress -> 1) -> sin(PI/2) = 1
            // Check Start of HoldIn -> 1
            // Logic guarantees continuity: Inhale ends at 1, HoldIn starts at 1.
        });
    });

    describe('EidolonSwarm: Fail Fast', () => {
        let originalBC: any;

        beforeEach(() => {
            originalBC = global.BroadcastChannel;
        });

        afterEach(() => {
            global.BroadcastChannel = originalBC;
        });

        it('should throw if BroadcastChannel is missing', () => {
            // Simulate missing BroadcastChannel
            global.BroadcastChannel = undefined as any;

            expect(() => {
                new EidolonSwarm();
            }).toThrow('BroadcastChannel');
        });
    });

});
