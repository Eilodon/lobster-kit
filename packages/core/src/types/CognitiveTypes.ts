import type { WorldState } from './WorldState';

export interface ConversationSensory {
    user_expertise_signal: 'expert' | 'intermediate' | 'novice';
    user_intent:
    | 'share_and_be_heard'
    | 'get_validation'
    | 'brainstorm_together'
    | 'debug_problem'
    | 'learn_something'
    | 'vent';
    agent_current_pattern: string;
    pattern_is_appropriate: boolean;
    pattern_drift_detected: boolean;
    user_frustration_level: number;
    conversation_momentum: 'building' | 'neutral' | 'deteriorating';
    context_depth: 'rich' | 'sparse';
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

export interface MemoryEdge {
    to: string;
    relation: string;
    weight: number;
}

export interface MemoryNode {
    id: string;
    concept: string;
    embedding: number[];
    connections: MemoryEdge[];
    updated_at?: number;
}

export interface MemoryResult {
    id: string;
    source: 'episodic' | 'semantic' | 'causal';
    score: number;
    content: string;
    metadata?: Record<string, unknown>;
}

export interface MemoryEntry {
    id: string;
    content: string;
    embedding: number[];
    stability: number;
    last_accessed: number;
    created_at: number;
    importance: number;
    tags?: string[];
    source?: string;
}

export interface ToolPerformanceRecord {
    tool_name: string;
    call_count: number;
    error_count?: number;
    fallback_count?: number;
    success_rate: number;
    avg_latency_ms: number;
    latency_p50_ms?: number;
    latency_p95_ms?: number;
    fallback_rate?: number;
    user_satisfaction: number;
    last_called: number;
}

export interface GeneratedToolAuditRecord {
    tool_name: string;
    need: string;
    status: 'accepted' | 'rejected';
    reason: string;
    created_at: number;
    metadata?: Record<string, unknown>;
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

export interface MemoryQueryContext<T extends object = Record<string, unknown>> {
    query: string;
    worldState: WorldState<T>;
}

export interface ReasoningTraceRecord {
    id: string;
    created_at: number;
    mode: 'fast' | 'deep';
    final_score: number;
    iterations: number;
    trace: Record<string, unknown>;
}
