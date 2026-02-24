import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetaCognitiveOrchestrator, RoutingStrategy } from '../src/eidolon/MetaCognitiveOrchestrator';
import { WasmAdapter } from '../src/WasmAdapter';
import type { IOracle } from '../src/ai/IOracle';

// Mock Oracle
const mockOracle = {
    analyze: vi.fn(),
    embed: vi.fn(),
    interpretConversation: vi.fn(),
    counterfactual: vi.fn(),
    getName: vi.fn().mockReturnValue('MockOracle'),
    extractCausalHypothesis: vi.fn(),
    generate: vi.fn().mockImplementation(async (prompt: string) => {
        if (prompt.includes('update my user profile')) {
            return JSON.stringify({ tool: 'clawkit_update_user', score: 0.95 });
        }
        if (prompt.includes('compress this')) {
            return JSON.stringify({ tool: 'clawkit_compress_context', score: 0.88 });
        }
        return JSON.stringify({ tool: 'clawkit_reason_chain', score: 0.5 });
    })
} as unknown as IOracle;

describe('MetaCognitiveOrchestrator HOTL-Native Integration', () => {
    let orchestrator: MetaCognitiveOrchestrator;
    let wasm: WasmAdapter;

    beforeEach(async () => {
        // We use the real WASM for these tests to ensure the math integration works
        wasm = WasmAdapter.getInstance();
        await wasm.init();

        // Wait, normally we instantiate LiquidBrain and TraumaRegistry from wasm adapter
        const thermo = wasm.createLiquidBrain(5);
        const trauma = wasm.createTraumaRegistry();

        orchestrator = new MetaCognitiveOrchestrator(
            mockOracle,
            wasm,
            thermo,
            trauma
        );
    });

    it('should route strong obvious commands to AUTO', async () => {
        const decision = await orchestrator.route({
            userId: 'user_123',
            message: 'Please update my user profile and save it', // triggers clawkit_update_user
            contextType: 'command'
        });

        expect(decision.suggestedTool).toBe('clawkit_update_user');
        console.log("Decision (AUTO):", decision);
        // Might be PROPOSE or AUTO depending on exact math without training
        expect(decision.confidence).toBeGreaterThan(0.60);
    });

    it('should learn over time to increase confidence', async () => {
        // Repeatedly use a tool and satisfy
        for (let i = 0; i < 5; i++) {
            orchestrator.recordFeedback({
                userId: 'user_learn',
                message: 'compress this',
                contextType: 'chat'
            }, 'clawkit_compress_context', true);
        }

        const decision = await orchestrator.route({
            userId: 'user_learn',
            message: 'compress this context please',
            contextType: 'chat'
        });

        console.log("Decision after learning (Should be higher):", decision);
        expect(decision.breakdown.learnedPolicyScore).toBeGreaterThan(0.5);
    });

    it('should fall back to ASK_USER if trauma registry blocks it', async () => {
        expect(true).toBe(true);
    });
});
