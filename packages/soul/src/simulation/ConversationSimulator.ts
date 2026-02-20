import { WasmAdapter, CausalGraph, Intervenable, ConversationDomainConfig } from '../WasmAdapter';
import { ConversationAction, SimulationResult, ConversationVariable } from '../eidolon/CognitiveTypes';
// Re-export from types
export { SimulationResult } from '../eidolon/CognitiveTypes';

export class ConversationSimulator {
    private adapter: WasmAdapter;

    constructor() {
        this.adapter = WasmAdapter.getInstance();
    }

    /**
     * "Dreams" the outcome of an action before executing it.
     * Uses the CausalGraph to predict the effect of the action on key metrics.
     */
    public async simulate(
        currentGraph: CausalGraph,
        action: ConversationAction,
        config: ConversationDomainConfig
    ): Promise<SimulationResult> {
        // 1. Clone the graph (Dream state)
        const dreamGraph = this.cloneGraph(currentGraph);
        const intervenable = this.adapter.createIntervenable();

        // 2. Identify variables
        // We map the string pattern to a numeric ID if needed, or use a generic 'Action' node.
        // For V3, we assume specific causal nodes for actions are mapped.
        // Simplified: We assume Node 0 = Action, Node 1 = UserFrustration, Node 2 = Rapport, Node 3 = Trust
        // In a real implementation, we'd use a proper mapping service.
        const ACTION_NODE = 0;
        const FRUSTRATION_NODE = 2; // e.g. UserFrustration
        const RAPPORT_NODE = 9;     // e.g. RapportLevel
        const TRUST_NODE = 6;       // e.g. TrustLevel

        // 3. Apply Intervention: do(Action = intrusiveness)
        // We use the action's intrusiveness as the "force" of the intervention
        const interventionValue = action.intrusiveness();

        // 4. Predict Outcomes (Counterfactual or Causal)
        // What is the effect on Frustration?
        const predFrustration = intervenable.do_intervention(
            dreamGraph,
            ACTION_NODE,
            interventionValue,
            FRUSTRATION_NODE
        );

        const predRapport = intervenable.do_intervention(
            dreamGraph,
            ACTION_NODE,
            interventionValue,
            RAPPORT_NODE
        );

        const predTrust = intervenable.do_intervention(
            dreamGraph,
            ACTION_NODE,
            interventionValue,
            TRUST_NODE
        );

        // 5. Calculate Delta (Outcome Quality)
        // Basic heuristic: Maximize Rapport & Trust, Minimize Frustration
        // Score = (Rapport + Trust) - (Frustration * 1.5)
        const score = (predRapport + predTrust) - (predFrustration * 1.5);

        // Baseline (no action or default state check) - optional for now
        // const baseline = ...

        // 6. Decision logic
        // If predicted frustration > tolerance, reject.
        const isSafe = predFrustration < (1.0 - config.intrusiveness_threshold); // If threshold is 0.3 (strict), max frust is 0.7
        const isUseful = score > 0.1; // Must have positive impact

        let reasoning = "";
        if (!isSafe) reasoning = `Predicted frustration ${predFrustration.toFixed(2)} exceeds safety limit.`;
        else if (!isUseful) reasoning = `Predicted score ${score.toFixed(2)} is too low.`;
        else reasoning = `Safe and useful. Score: ${score.toFixed(2)}`;

        return {
            action,
            predicted_frustration: predFrustration,
            predicted_rapport: predRapport,
            predicted_trust: predTrust,
            outcome_delta: score,
            approved: isSafe && isUseful,
            reasoning
        };
    }

    private cloneGraph(original: CausalGraph): CausalGraph {
        const clone = this.adapter.createCausalGraph();
        // Use WASM-bindgen serialization to clone state
        // This is expensive but accurate.
        // In V3 Rust, we could add a native clone() if perf is an issue.
        try {
            const dump = original.export_edges();
            clone.import_edges(dump);
        } catch (e) {
            console.error("Failed to clone CausalGraph:", e);
        }
        return clone;
    }
}
