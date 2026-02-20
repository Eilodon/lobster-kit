export type ConversationVariable =
    | 'ExpertSignal'        // 0
    | 'HypeLanguage'        // 1
    | 'UserFrustration'     // 2
    | 'SparseContext'       // 3
    | 'RepeatedPattern'     // 4
    | 'PatternDrift'        // 5
    | 'TrustLevel'          // 6
    | 'EngagementLevel'     // 7
    | 'CognitiveBurden'     // 8
    | 'RapportLevel'        // 9
    | 'ConversationMomentum'// 10
    | 'SessionCount'        // 11
    | 'SessionCount'        // 11
    | 'OutcomeQuality';     // 12 — mirror SentinelVariable COUNT = 13

export const VariableID: Record<ConversationVariable, number> = {
    'ExpertSignal': 0,
    'HypeLanguage': 1,
    'UserFrustration': 2,
    'SparseContext': 3,
    'RepeatedPattern': 4,
    'PatternDrift': 5,
    'TrustLevel': 6,
    'EngagementLevel': 7,
    'CognitiveBurden': 8,
    'RapportLevel': 9,
    'ConversationMomentum': 10,
    'SessionCount': 11,
    'OutcomeQuality': 12
};

export enum ConversationMode {
    Zen = 0,          // Default balanced — intrusiveness 0.2
    Peer = 1,         // Expert-to-expert — intrusiveness 0.3
    Listener = 2,     // User needs to be heard — intrusiveness 0.1
    Clarifier = 3,    // Sparse context, ask first — intrusiveness 0.4
    Advisor = 4,      // Guidance (only when asked) — intrusiveness 0.6
    Challenger = 5,   // Constructive pushback (trusted) — intrusiveness 0.8
    Emergency = 6,    // User distressed, bypass all — intrusiveness 0.0
}

export interface ConversationSensory {
    // Input signals
    user_expertise_signal: 'expert' | 'intermediate' | 'novice';
    user_intent: 'share_and_be_heard' | 'get_validation' | 'brainstorm_together'
    | 'debug_problem' | 'learn_something' | 'vent';
    user_frustration_level: number;     // 0.0 - 1.0
    context_depth: 'rich' | 'sparse';
    // Derived from ThermodynamicEngine
    thermo_state: [number, number, number, number, number];
    // [engagement, trust, cognitive_load, rapport, momentum]

    // Additional context for ReasoningChain
    pattern_drift_detected?: boolean;
    agent_current_pattern?: string;
    pattern_is_appropriate?: boolean;
    conversation_momentum?: 'building' | 'neutral' | 'deteriorating';
}

export interface ConversationAction {
    mode: ConversationMode;
    pattern: string;                    // specific response pattern
    intrusiveness(): number;            // → requires_simulation() threshold
    requires_simulation(): boolean;
}

export interface SimulationResult {
    action: ConversationAction;
    predicted_frustration: number;
    predicted_rapport: number;
    predicted_trust: number;
    outcome_delta: number; // compared to baseline
    approved: boolean;
    reasoning: string;
}

export interface UserSensory {
    user_id: string;
    expertise_level: number;
    preferred_mode: string;
    domains: string[];
    communication_style: {
        likes_directness: number;
        tolerates_pushback: number;
        prefers_brevity: number;
    };
    negative_patterns: string[];
    last_seen: number;
    session_count: number;
}

export interface ThoughtNode {
    id: string;
    thought: string;
    parent_id?: string;
    depth: number;
    score: number;
    children: ThoughtNode[];
    verified: boolean;
}

export interface CriticResult {
    score: number;
    issues: string[];
    suggestions: string[];
    confidence: number;
}

export interface VerifiedResponse {
    response: string;
    iterations: number;
    final_score: number;
    trace?: {
        mode: 'fast' | 'deep';
        notes: string[];
        best_thought_id?: string;
    };
}

export type AgentRole =
    | 'planner'
    | 'executor'
    | 'critic'
    | 'memory_keeper'
    | 'coordinator';

export interface AgentSpec {
    id: string;
    role: AgentRole;
    capabilities: string[];
    max_tokens: number;
    priority: number;
}

export interface TaskResult<T = unknown> {
    task: string;
    agent_id: string;
    ok: boolean;
    data?: T;
    error?: string;
    latency_ms: number;
}

export interface ConsensusResult {
    question: string;
    selected: string;
    support_ratio: number;
    votes: Record<string, string>;
}

export interface AgentConflict {
    topic: string;
    proposals: Array<{ agent_id: string; proposal: string }>;
}

export interface Resolution {
    winner_agent_id: string;
    rationale: string;
    confidence: number;
}

export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
    timestamp?: number;
    metadata?: Record<string, unknown>;
}

export interface ClusterSummary {
    topic: string;
    summary: string;
    importance: number;
    message_count: number;
}

export interface CompressedContext {
    verbatim: Message[];
    summaries: ClusterSummary[];
    key_facts: string[];
    total_tokens: number;
}
