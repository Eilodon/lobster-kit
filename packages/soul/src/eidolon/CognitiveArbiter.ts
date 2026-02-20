import { WasmAdapter, CausalGraph, ConversationDomainConfig } from '../WasmAdapter';
import { EidolonGuard } from './EidolonGuard';
import { EmotionalState } from './EmotionalCore';
import { IOracle } from '../ai/IOracle';
import { ConversationSimulator } from '../simulation/ConversationSimulator';
import { ConversationAction, ConversationSensory, ConversationMode, SimulationResult, VariableID } from './CognitiveTypes';
import { Logger } from '@clawkit/core';

export class CognitiveArbiter {
    private adapter: WasmAdapter;
    private simulator: ConversationSimulator;
    private config: ConversationDomainConfig;
    private graph: CausalGraph;

    constructor(
        private oracle: IOracle,
        private guard: EidolonGuard,
        modePreset: 'peer' | 'advisory' | 'discovery' = 'peer',
        adapter?: WasmAdapter
    ) {
        this.adapter = adapter || WasmAdapter.getInstance();
        this.simulator = new ConversationSimulator();
        this.config = this.adapter.createConversationConfig(modePreset);
        this.graph = this.adapter.createCausalGraph();
    }

    /**
     * The OODA Loop: Observe -> Orient -> Decide -> Act
     */
    public async process(
        userMessage: string,
        userProfile?: unknown
    ): Promise<{ action: ConversationAction; reasoning: string; simulation?: SimulationResult }> {
        // 1. OBSERVE (Sense)
        const sensory = await this.sense(userMessage, userProfile);

        // 2. ORIENT (Update State)
        // Here we would normally update the CausalGraph with new observations.
        // For Phase 2, we assume the graph is stateful or re-loaded.
        // e.g. this.graph.learn(NODE, VALUE);

        // 3. DECIDE (Propose Action)
        // This is a simplified decision update. In a full system, we might query the LLM 
        // for a set of candidate actions first, or use a heuristic.
        // For now, let's assume we derive a candidate mode from sensory data.
        const candidateAction = this.proposeAction(sensory);

        // 4. ACT (Gating Logic)
        const intrusiveness = candidateAction.intrusiveness();
        const threshold = this.config.intrusiveness_threshold; // e.g. 0.3

        if (intrusiveness > threshold || candidateAction.requires_simulation()) {
            Logger.info(`[CognitiveArbiter] High intrusiveness (${intrusiveness} > ${threshold}). Running simulation.`);
            const simResult = await this.simulator.simulate(this.graph, candidateAction, this.config);

            if (simResult.approved) {
                return {
                    action: candidateAction,
                    reasoning: `Simulation approved: ${simResult.reasoning}`,
                    simulation: simResult
                };
            } else {
                // Fallback to minimal intrusion (ZEN)
                Logger.warn(`[CognitiveArbiter] Action rejected by simulation. Fallback to ZEN.`);
                return {
                    action: {
                        mode: ConversationMode.Zen,
                        pattern: "I hear you.",
                        intrusiveness: () => 0.1,
                        requires_simulation: () => false
                    },
                    reasoning: `Simulation rejected: ${simResult.reasoning}. Fallback to safe mode.`,
                    simulation: simResult
                };
            }
        }

        // Fast path
        return {
            action: candidateAction,
            reasoning: `Fast path: Intrusiveness ${intrusiveness} <= ${threshold}`
        };
    }

    // --- Public API for MCP Tools ---

    public async sense(message: string, profile?: unknown): Promise<ConversationSensory> {
        // 1. Get thermodynamic state from Guard -> Soul -> EmotionalCore
        let emo: EmotionalState;
        try {
            emo = this.guard.getEmotionalState();
        } catch (e) {
            // Fallback if guard not initialized or mocked
            emo = {
                glucose: 100, dopamine: 50, cortisol: 0,
                arousal: 0.5, valence: 0.5, attention: 0.5,
                rhythm: 0.5, momentum: 0.0,
                volatility: 0.1, lastUpdate: Date.now()
            };
        }

        // Mapping EmotionalState to [engagement, trust, cognitive_load, rapport, momentum]
        // engagement -> attention
        // trust -> valence (positivity)
        // cognitive_load -> cortisol (stress)
        // rapport -> dopamine (reward/alignment)
        // momentum -> momentum
        const tState: [number, number, number, number, number] = [
            emo.attention,
            emo.valence,
            Math.min(1, emo.cortisol / 100),
            Math.min(1, emo.dopamine / 100),
            emo.momentum
        ];

        // 2. Oracle Interpretation (LLM)
        const interpreted = await this.oracle.interpretConversation(message, 0, profile) as Partial<ConversationSensory>;

        return {
            user_expertise_signal: interpreted.user_expertise_signal || 'novice',
            user_intent: interpreted.user_intent || 'vent',
            user_frustration_level: interpreted.user_frustration_level || 0.5,
            context_depth: interpreted.context_depth || 'sparse',
            thermo_state: tState
        };
    }

    public async simulateAction(
        actionPattern: string,
        mode: ConversationMode,
        intrusiveness: number
    ): Promise<SimulationResult> {
        const action: ConversationAction = {
            pattern: actionPattern,
            mode: mode,
            intrusiveness: () => intrusiveness,
            requires_simulation: () => true // Force simulation for manual tool checks
        };
        return this.simulator.simulate(this.graph, action, this.config);
    }

    public checkPattern(cause: string, effect: string): { valid: boolean; probability: number; samples: number; reasoning: string } {
        // Map strings to IDs
        // We'll try to match exact names from VariableID first, else hash or fallback.
        // For CLI/Tool usage, we expect exact enum keys or simplified names.

        const resolveId = (name: string): number | undefined => {
            const id = VariableID[name as keyof typeof VariableID];
            return id;
        };

        const causeId = resolveId(cause);
        const effectId = resolveId(effect);

        if (causeId === undefined || effectId === undefined) {
            return {
                valid: false,
                probability: 0,
                samples: 0,
                reasoning: `Invalid variable names: ${cause} -> ${effect}. Available: ${Object.keys(VariableID).join(', ')}`
            };
        }

        const edge = this.graph.get_edge(causeId, effectId);
        const samples = edge.successes + edge.failures;

        // Simple validity check: do we have enough data?
        const valid = samples > 5;

        return {
            valid,
            probability: edge.probability,
            samples,
            reasoning: `Edge ${cause}(${causeId}) -> ${effect}(${effectId}): p=${edge.probability.toFixed(2)} (n=${samples})`
        };
    }

    private proposeAction(sensory: ConversationSensory): ConversationAction {
        // Simple heuristic rules for Phase 2
        // IF frustration > 0.8 -> Emergency (Low intrusiveness)
        // IF expert + trust > 0.8 -> Challenger (High intrusiveness)
        // ELSE -> Peer (Medium)

        if (sensory.user_frustration_level > 0.8) {
            return {
                mode: ConversationMode.Emergency,
                pattern: "I'm listening. Let's fix this.",
                intrusiveness: () => 0.0,
                requires_simulation: () => false
            };
        }

        const trust = sensory.thermo_state[1]; // Index 1 = Trust
        if (sensory.user_expertise_signal === 'expert' && trust > 0.7) {
            return {
                mode: ConversationMode.Challenger,
                pattern: "Are you sure about that architecture?",
                intrusiveness: () => 0.8,
                requires_simulation: () => true
            };
        }

        if (sensory.user_intent === 'learn_something') {
            return {
                mode: ConversationMode.Advisor,
                pattern: "Here is a suggestion...",
                intrusiveness: () => 0.6,
                requires_simulation: () => true
            };
        }

        // Default
        return {
            mode: ConversationMode.Peer,
            pattern: "I see.",
            intrusiveness: () => 0.3,
            requires_simulation: () => false
        };
    }
}
