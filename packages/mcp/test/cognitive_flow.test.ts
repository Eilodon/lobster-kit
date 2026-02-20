
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    ClawkitSenseIntentTool,
    ClawkitReasonChainTool,
    ClawkitCheckPatternTool,
    CognitiveToolDeps,
    ClawkitRecordOutcomeTool,
    ClawkitCommitPatternTool,
} from '../src/tools/cognitive-tools';
import { CognitiveArbiter, EidolonGuard, EmotionalCore } from '@clawkit/soul';
import { WasmAdapter } from '@clawkit/soul/src/WasmAdapter';

// Mock Oracle only
const mockOracle = {
    generate: vi.fn(),
    embed: vi.fn().mockResolvedValue([0.42, 0.18, 0.05]),
    interpretConversation: vi.fn().mockResolvedValue({
        user_expertise_signal: 'intermediate',
        user_intent: 'brainstorm_together',
        user_frustration_level: 0.1,
        context_depth: 'rich'
    })
};

const mockPerformance = {
    record: vi.fn()
};

const mockStorage = {
    appendReasoningTrace: vi.fn(),
    upsertMemoryEntry: vi.fn(),
    loadUserProfile: vi.fn(),
    saveUserProfile: vi.fn()
};

const mockMemoryGraph = {
    addNode: vi.fn()
};

// Mock Helper for WASM (if needed)
const mockWasmInstance = {
    createConversationConfig: () => ({ intrusiveness_threshold: 0.3 }),
    createCausalGraph: () => ({
        get_edge: () => ({ probability: 0.92, successes: 45, failures: 5 }), // Mocked Causal Graph Logic (WASM placeholder)
        learn: vi.fn()
    })
};


describe('Cognitive Flow Integration (Real Arbiter Logic)', () => {

    // Setup Environment
    // REAL Emotional Core Logic (via Guard mock wrapper for simplicity, or real guard?)
    // Let's use a real Guard BUT mock its internal "soul" to control state deterministically
    // Or simpler: Mock Guard but return REAL EmotionalState object structure
    const mockGuard = {
        getEmotionalState: () => ({
            glucose: 80,
            dopamine: 60,
            cortisol: 10,
            arousal: 0.6,
            valence: 0.7,
            attention: 0.8,
            rhythm: 0.5,
            momentum: 0.4,
            volatility: 0.1,
            lastUpdate: Date.now()
        }),
    } as unknown as EidolonGuard;

    const mockTraumaRegistry = {
        isInhibited: () => false,
        getRemainingInhibition: () => 0n,
        recordTrauma: vi.fn(),
        heal: vi.fn()
    };

    // Instantiate REAL Arbiter with Injected Mock Adapter
    const arbiter = new CognitiveArbiter(mockOracle as any, mockGuard, 'peer', mockWasmInstance as any);

    // We DO NOT mock arbiter.sense() or arbiter.checkPattern() anymore!
    // We test the ACTUAL method logic.

    const mockReasoningChain = {
        run: async (draft: string) => ({
            response: `Refined: ${draft}`,
            final_score: 0.95,
            iterations: 2,
            trace: { notes: ['good start', 'improved clarity'] }
        })
    };

    const deps = {
        arbiter,
        traumaRegistry: mockTraumaRegistry,
        reasoningChain: mockReasoningChain,
        store: mockStorage,
        memoryGraph: mockMemoryGraph,
        toolPerformance: mockPerformance,
        embeddingOracle: mockOracle,
        flags: { reasonChainEnabled: true }
    } as unknown as CognitiveToolDeps;

    const senseTool = new ClawkitSenseIntentTool(deps);
    const reasonTool = new ClawkitReasonChainTool(deps);
    const checkPatternTool = new ClawkitCheckPatternTool(deps);
    const outcomeTool = new ClawkitRecordOutcomeTool(deps);
    const commitTool = new ClawkitCommitPatternTool(deps);

    it('simulates a full cognitive conversation cycle with REAL Arbiter logic', async () => {
        console.log('--- STARTING REAL COGNITIVE FLOW ---');

        // 1. SENSE
        const userMessage = "I'm thinking of creating a new bonding curve strategy.";

        // This calls senseTool -> arbiter.sense()
        // arbiter.sense() calls guard.getEmotionalState() AND oracle.interpretConversation()
        // It then maps EmotionalState to thermo_state
        const senseResult = await senseTool.execute({
            messages: [{ role: 'user', content: userMessage }],
            current_pattern: 'default'
        });

        expect(senseResult.isError).toBeFalsy();
        const sensory = (senseResult.structuredContent as any).sensory;

        // Verify mapping logic in CognitiveArbiter.sense()
        // MockGuard returns attention: 0.8
        // Arbiter maps Attention -> Engagement (Index 0 of thermo_state)
        expect(sensory.thermo_state[0]).toBe(0.8);
        expect(sensory.user_intent).toBe('brainstorm_together'); // From MockOracle

        // 2. REASON (Mocked Chain for now, focusing on tool flow)
        const draftResponse = "Bonding curves are risky using Bancor formula.";
        const reasonResult = await reasonTool.execute({
            draft_response: draftResponse,
            context: sensory,
            mode: 'deep'
        });
        const verified = (reasonResult.structuredContent as any).verified;
        expect(verified.final_score).toBe(0.95);

        // 3. CHECK PATTERN
        // This calls checkPatternTool -> arbiter.checkPattern()
        // arbiter.checkPattern() calls WasmAdapter -> CausalGraph (Mocked WASM but real Arbiter logic)
        const proposedPattern = 'HypeLanguage->TrustLevel';
        const checkResult = await checkPatternTool.execute({
            patterns: [proposedPattern],
            mode: 'ZEN'
        });

        const causalCheck = (checkResult.structuredContent as any).causal_checks[0];
        // Expect arbiter to check validity
        // Our MockWasmAdapter returns probability 0.92
        expect(causalCheck.valid).toBe(true);
        expect(causalCheck.probability).toBe(0.92);

        // 4. OUTCOME
        await outcomeTool.execute({
            pattern: proposedPattern,
            outcome: 'success',
            severity: 0.8
        });
        expect(mockPerformance.record).toHaveBeenCalled();

        console.log('--- REAL FLOW VERIFIED ---');
    });

    it('commits pattern memories with non-zero embeddings', async () => {
        await commitTool.execute({
            chosen_pattern: 'TestPattern',
            reasoning: 'Use concise summary with explicit rollback step.',
            importance: 0.7,
        });

        expect(mockStorage.upsertMemoryEntry).toHaveBeenCalled();
        const savedEntry = mockStorage.upsertMemoryEntry.mock.calls.at(-1)?.[0];
        expect(Array.isArray(savedEntry?.embedding)).toBe(true);
        expect(savedEntry.embedding.some((value: number) => value !== 0)).toBe(true);
        expect(mockMemoryGraph.addNode).toHaveBeenCalled();
    });
});
