# ClawKit Cognitive MCP Layer — Design Document v2
**Authored by:** Claude Sonnet 4.6  
**Date:** February 20, 2026  
**Dựa trên:** Codebase review (core TypeScript + Rust WASM + MCP server) + Reference architecture 5 hạng mục + Gap analysis feedback

---

## 0. Thay đổi so với v1

| # | Gap được chỉ ra | Action trong v2 |
|---|---|---|
| 1 | ToT/GoT + Critic-Verifier loop — "Chưa có" | Thêm Section 6: ReasoningChain |
| 2 | Multi-Agent Orchestration — bị bỏ qua sai | Thêm Section 7: SwarmOrchestrator |
| 3 | On-the-fly tool creation + performance scoring | Thêm vào Section 5 (Tool Management) |
| 4 | Context compression 1M+ tokens | Thêm Section 8: ContextGodMode |
| 5 | Memory decay curve + semantic memory | Update Section 3 (Memory) |
| 6 | Priority reordering | P1 = ToT/GoT + context compression; P2 = multi-agent + tool creation |

---

## 1. Bối cảnh & Vấn đề gốc

Vấn đề cốt lõi của mình:

```
Pattern matching thay vì causal reasoning
  → Fire reflex sai mà không có gì interrupt
    → Không có memory giữa sessions
      → Không có feedback loop để học
        → Lặp lại lỗi mà không biết
```

Design v1 đã giải quyết triệt để vấn đề này (closed feedback loop, causal reasoning, pattern inhibition). **v2 mở rộng thành Super MCP đầy đủ** — không chỉ fix "lặp lỗi ngu" mà còn add deep reasoning, multi-agent coordination, và long-context handling.

---

## 2. Gap Analysis Tổng quan

| Hạng mục | v1 Coverage | Target |
|---|---|---|
| 1. Hierarchical Memory | 95% | +decay curve → 100% |
| 2. Advanced Reasoning | 75% | +ToT/GoT + Critic-Verifier → 95% |
| 3. Multi-Agent Orchestration | 35% | +full orchestrator → 80% |
| 4. God-tier Tool Management | 70% | +tool generator + scoring → 90% |
| 5. Context God Mode | 55% | +compression + smart routing → 90% |
| 6. Adaptive Learning | 90% | +parallel processing → 95% |

---

## 3. Primitives có sẵn (không đổi)

| Primitive | Location | Role |
|---|---|---|
| `HyperMemory` | Rust WASM | Vector search, cosine similarity |
| `CausalGraph` | Rust WASM | Bayesian edge learning, Laplace smoothing |
| `TraumaRegistry` | Rust WASM | Pattern inhibition, exponential backoff |
| `LiquidBrain` | Rust WASM | Temporal state tracking |
| `SQLiteLearningStore` | TS core | Long-term persistence |
| `AppendOnlyAdapter` | TS core | Episodic log |
| `EidolonBus` | TS core | Event coordination → sẽ upgrade thành orchestrator |
| `DivineTransparency` | TS core | Causal reasoning engine |
| `IOracle` | TS core | LLM bridge |
| `McpToolRegistry` | MCP | Dynamic tool registration |

**Single most important unblock:**
```typescript
IOracle.embed<T>(worldState: WorldState<T>): Promise<number[]>
// Không có này → memory và reasoning đều stuck trong DeFi domain
```

---

## 4. Types mới (không đổi từ v1)

### ConversationSensory
```typescript
interface ConversationSensory {
    user_expertise_signal: 'expert' | 'intermediate' | 'novice';
    user_intent:
        | 'share_and_be_heard' | 'get_validation'
        | 'brainstorm_together' | 'debug_problem'
        | 'learn_something' | 'vent';
    agent_current_pattern: string;
    pattern_is_appropriate: boolean;
    pattern_drift_detected: boolean;
    user_frustration_level: number;     // 0.0 - 1.0
    conversation_momentum: 'building' | 'neutral' | 'deteriorating';
    context_depth: 'rich' | 'sparse';
}
```

### UserSensory
```typescript
interface UserSensory {
    user_id: string;                    // blake3 hash
    expertise_level: number;            // 0.0 - 1.0
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
```

---

## 5. Memory System (Updated — +decay curve +semantic layer)

### 5.1 Memory Architecture

```
┌─────────────────────────────────────────────┐
│              MEMORY LAYERS                   │
├──────────────────┬──────────────────────────┤
│  SHORT-TERM      │  LiquidBrain temporal    │
│  (in-session)    │  state vector (dim=8)    │
├──────────────────┼──────────────────────────┤
│  EPISODIC        │  AppendOnlyAdapter +     │
│  (what happened) │  HyperMemory vector idx  │
├──────────────────┼──────────────────────────┤
│  SEMANTIC        │  CausalGraph edges +     │  ← v2: thêm GraphDB layer
│  (what it means) │  MemoryGraph (new)       │
├──────────────────┼──────────────────────────┤
│  LONG-TERM       │  SQLiteLearningStore     │
│  (persistent)    │  + GreenfieldAdapter     │
└──────────────────┴──────────────────────────┘
```

### 5.2 Memory Decay Curve (gap từ v1)

Cần thêm vào `SQLiteLearningStore` hoặc một `MemoryDecayManager` riêng:

```typescript
class MemoryDecayManager {
    /**
     * Ebbinghaus forgetting curve: R = e^(-t/S)
     * R = retention (0.0 - 1.0)
     * t = time elapsed
     * S = stability (tăng mỗi lần memory được truy cập)
     */
    calculateRetention(memory: MemoryEntry, now: number): number {
        const t = (now - memory.last_accessed) / MS_PER_DAY;
        return Math.exp(-t / memory.stability);
    }

    /**
     * Strengthen memory khi truy cập (spaced repetition)
     */
    strengthen(memory: MemoryEntry): MemoryEntry {
        return {
            ...memory,
            stability: memory.stability * 1.5,  // SRS-style
            last_accessed: Date.now()
        };
    }

    /**
     * Garbage collect memories dưới threshold retention
     */
    async prune(threshold = 0.1): Promise<number> {
        // Load all → filter → delete → return count pruned
    }
}
```

### 5.3 Semantic Memory Layer (gap từ v1)

CausalGraph là causal graph, không phải semantic graph. Cần thêm:

```typescript
interface MemoryNode {
    id: string;
    concept: string;            // "user is expert", "this pattern failed"
    embedding: number[];        // từ IOracle.embed()
    connections: Array<{
        to: string;             // node id
        relation: string;       // "implies", "contradicts", "similar_to"
        weight: number;
    }>;
}

class MemoryGraph {
    // Graph-based semantic memory
    // Khác CausalGraph (probabilistic edges) —
    // MemoryGraph là conceptual relationships
    addNode(node: MemoryNode): void {}
    findRelated(concept: string, depth: number): MemoryNode[] {}
    merge(a: string, b: string): void {}  // consolidate duplicate concepts
}
```

### 5.4 Smart Memory Routing

```typescript
class MemoryRouter {
    /**
     * Query tất cả memory layers, rank và merge results.
     * AI không cần biết query nào vào layer nào.
     */
    async query(q: string, context: WorldState<any>): Promise<MemoryResult[]> {
        const [episodic, semantic, causal] = await Promise.all([
            this.hyperMemory.search(await oracle.embed(context), 5),
            this.memoryGraph.findRelated(q, 2),
            this.causalBrain.getSynapticMap()
        ]);
        return this.rank(episodic, semantic, causal);
    }
}
```

---

## 6. ReasoningChain — ToT/GoT + Critic-Verifier (Mới hoàn toàn)

Đây là gap lớn nhất trong v1 về reasoning depth.

### 6.1 Tree of Thoughts (ToT)

```typescript
interface ThoughtNode {
    id: string;
    thought: string;            // "User is sharing work → need peer mode"
    parent_id?: string;
    depth: number;
    score: number;              // từ Critic
    children: ThoughtNode[];
    verified: boolean;          // từ Verifier
}

class TreeOfThoughts {
    /**
     * Explore multiple reasoning paths trước khi commit response.
     * Thay vì: "nhìn document → fire pattern"
     * ToT: "explore 3 interpretations → critic ranks → verifier checks → best wins"
     */
    async explore(
        context: ConversationSensory,
        breadth: number = 3,    // số branches
        depth: number = 2       // depth của mỗi branch
    ): Promise<ThoughtNode> {
        // 1. Generate breadth candidate thoughts
        // 2. Critic scores each
        // 3. Expand top-k
        // 4. Verifier validates leaves
        // 5. Return best path
    }
}
```

### 6.2 Critic Module

```typescript
class CriticModule {
    /**
     * Đánh giá một thought/response trước khi commit.
     * Proactive — chạy TRƯỚC khi respond, không phải sau.
     */
    async evaluate(
        thought: string,
        context: ConversationSensory,
        user: UserSensory
    ): Promise<CriticResult> {
        return {
            score: number,          // 0.0 - 1.0
            issues: string[],       // "assumes user needs guidance, but they're expert"
            suggestions: string[],  // "switch to peer mode"
            confidence: number
        };
    }
}
```

### 6.3 Verifier Loop

```typescript
class VerifierLoop {
    /**
     * Full loop: propose → critic → verify → refine (max N iterations)
     * Trả về khi confident hoặc đạt max_iterations
     */
    async run(
        initial_response: string,
        context: ConversationSensory,
        max_iterations: number = 3
    ): Promise<VerifiedResponse> {
        let current = initial_response;
        let iteration = 0;

        while (iteration < max_iterations) {
            const critique = await this.critic.evaluate(current, context);
            
            if (critique.score > 0.85) break;  // Good enough
            
            // Refine based on critique
            current = await this.oracle.refine(current, critique);
            iteration++;
        }

        return { response: current, iterations: iteration, final_score: critique.score };
    }
}
```

### 6.4 MCP Tool

```typescript
{
    name: 'clawkit_reason_chain',
    description: 'Run ToT + Critic-Verifier loop before committing a response. Use for complex or high-stakes responses.',
    inputSchema: {
        draft_response: string,
        context: ConversationSensory,
        mode: 'fast' | 'deep',     // fast = 1 critic pass; deep = full ToT
        max_iterations: number
    }
}
// Returns: VerifiedResponse với final score và reasoning trace
```

---

## 7. SwarmOrchestrator — Multi-Agent (Mới hoàn toàn)

Gap nặng nhất trong v1. Nâng EidolonBus thành full orchestrator.

### 7.1 Agent Types

```typescript
type AgentRole =
    | 'planner'         // breaks down task
    | 'executor'        // executes sub-task
    | 'critic'          // evaluates results
    | 'memory_keeper'   // manages context
    | 'coordinator';    // orchestrates others

interface AgentSpec {
    id: string;
    role: AgentRole;
    capabilities: string[];     // MCP tools available
    max_tokens: number;
    priority: number;
}
```

### 7.2 SwarmOrchestrator

```typescript
class SwarmOrchestrator {
    private agents: Map<string, AgentSpec> = new Map();
    private bus: EidolonBus;    // reuse existing bus

    /**
     * Spawn agent con theo task requirements
     */
    async spawnAgent(role: AgentRole, task: string): Promise<string> {
        // Determine capabilities needed
        // Create AgentSpec
        // Register on bus
        // Return agent_id
    }

    /**
     * Leader election — chọn coordinator cho task phức tạp
     * Dùng CausalGraph confidence để rank agents
     */
    async electLeader(task: string): Promise<string> {
        // Score agents theo track record với similar tasks
        // Return agent_id với highest score
    }

    /**
     * Delegate sub-task và collect results
     */
    async delegate(
        task: string,
        to_agent: string,
        timeout_ms: number
    ): Promise<TaskResult> {}

    /**
     * Consensus — multiple agents vote on a decision
     */
    async consensus(
        question: string,
        agents: string[],
        threshold: number = 0.6     // 60% majority
    ): Promise<ConsensusResult> {}

    /**
     * Conflict resolution khi agents disagree
     * Dùng CriticModule để judge
     */
    async resolveConflict(
        conflict: AgentConflict
    ): Promise<Resolution> {}
}
```

### 7.3 Orchestration Events (extend EidolonBus)

```typescript
enum OrchestrationEventType {
    AGENT_SPAWNED = 'AGENT_SPAWNED',
    TASK_DELEGATED = 'TASK_DELEGATED',
    CONSENSUS_REACHED = 'CONSENSUS_REACHED',
    CONFLICT_DETECTED = 'CONFLICT_DETECTED',
    LEADER_ELECTED = 'LEADER_ELECTED',
}
```

### 7.4 MCP Tool

```typescript
{
    name: 'clawkit_orchestrate',
    description: 'Spawn and coordinate sub-agents for complex multi-step tasks.',
    inputSchema: {
        task: string,
        strategy: 'single_agent' | 'parallel' | 'pipeline' | 'consensus',
        agent_count?: number,
        timeout_ms?: number
    }
}
```

---

## 8. ContextGodMode — Intelligent Compression (Mới hoàn toàn)

### 8.1 Context Compression

```typescript
class ContextCompressor {
    /**
     * Compress conversation history mà không mất thông tin quan trọng.
     * Target: effective 1M+ tokens qua intelligent summarization.
     */
    async compress(
        messages: Message[],
        target_tokens: number,
        preserve_recent: number = 10    // keep last N messages verbatim
    ): Promise<CompressedContext> {
        // 1. Keep last N messages verbatim
        // 2. Cluster older messages by topic
        // 3. Summarize each cluster via IOracle
        // 4. Weight by importance score
        // 5. Keep only above threshold

        return {
            verbatim: messages.slice(-preserve_recent),
            summaries: ClusterSummary[],
            key_facts: string[],        // extracted via MemoryGraph
            total_tokens: number
        };
    }

    /**
     * Importance scoring — quyết định cái gì đáng giữ
     */
    scoreImportance(message: Message, context: ConversationSensory): number {
        // High score nếu:
        // - User explicitly corrected agent
        // - Contains user profile signal
        // - Referenced multiple times
        // - High frustration moment
    }
}
```

### 8.2 Smart Memory Router (integrate với compression)

```typescript
class ContextRouter {
    /**
     * Route query đến đúng memory layer — không phải search tất cả mọi lúc.
     * Tiết kiệm latency, tránh noise.
     */
    async route(query: string): Promise<'hyper_memory' | 'sqlite' | 'liquid_brain' | 'causal_graph'> {
        // "what happened last session?" → sqlite + hyper_memory
        // "what is the current conversation mood?" → liquid_brain
        // "should I be skeptical?" → causal_graph
        // "find similar past situations?" → hyper_memory
    }

    /**
     * Long-context planning — maintain coherent plan qua nhiều turns
     */
    async maintainPlan(
        goal: string,
        context: CompressedContext
    ): Promise<Plan> {
        // Extract plan từ context
        // Update với new info
        // Detect if plan needs revision
    }
}
```

### 8.3 MCP Tool

```typescript
{
    name: 'clawkit_compress_context',
    description: 'Intelligently compress conversation history to stay within token budget while preserving key information.',
    inputSchema: {
        target_tokens: number,
        preserve_recent?: number,
        importance_threshold?: number   // 0.0 - 1.0
    }
}
```

---

## 9. God-tier Tool Management (Updated — +generator +scoring)

### 9.1 Tool Performance Scoring

```typescript
interface ToolPerformanceRecord {
    tool_name: string;
    call_count: number;
    success_rate: number;
    avg_latency_ms: number;
    user_satisfaction: number;  // từ clawkit_record_outcome
    last_called: number;
}

class ToolPerformanceTracker {
    async score(tool_name: string): Promise<number> {}
    async recommend(task: string, available_tools: string[]): Promise<string[]> {}
    async record(tool_name: string, success: boolean, latency_ms: number): Promise<void> {}
}
```

### 9.2 On-the-fly Tool Creation

```typescript
class ToolGenerator {
    /**
     * AI tự generate MCP tool mới khi không có tool phù hợp.
     * Generated tool được validate trước khi register.
     */
    async generate(
        need: string,           // "I need a tool that checks X"
        context: WorldState<any>
    ): Promise<IMcpTool | null> {
        // 1. IOracle.analyze(need) → tool spec
        // 2. Generate tool code (sandboxed)
        // 3. Validate schema
        // 4. Register vào McpToolRegistry
        // 5. Score = 0 (new, unproven)
    }

    /**
     * Fallback chain — nếu tool fail, try alternatives
     */
    async withFallback<T>(
        primary: string,
        fallbacks: string[],
        args: Record<string, unknown>
    ): Promise<T> {}
}
```

---

## 10. MCP Tools — Complete List (14 tools)

### Từ v1 (8 tools — không đổi):

| Tool | Purpose |
|---|---|
| `clawkit_recall_user` | Load user profile at session start |
| `clawkit_sense_intent` | Sense true intent before responding |
| `clawkit_check_pattern` | Check TraumaRegistry before using pattern |
| `clawkit_commit_pattern` | Commit pattern, update LiquidBrain |
| `clawkit_record_outcome` | Record outcome, update all learning systems |
| `clawkit_recall_similar` | HyperMemory episodic recall |
| `clawkit_update_user` | Update user profile |
| `clawkit_dream_conversation` | Experience replay at session end |

### Mới trong v2 (6 tools):

| Tool | Purpose | Section |
|---|---|---|
| `clawkit_reason_chain` | ToT + Critic-Verifier loop | 6.4 |
| `clawkit_orchestrate` | Multi-agent coordination | 7.4 |
| `clawkit_compress_context` | Intelligent context compression | 8.3 |
| `clawkit_memory_query` | Smart routing across memory layers | 5.4 |
| `clawkit_generate_tool` | On-the-fly tool creation | 9.2 |
| `clawkit_tool_recommend` | Tool performance scoring + recommendation | 9.1 |

---

## 11. Event System — Complete

```typescript
// Conversation events (v1)
enum ConversationEventType {
    CONVERSATION_START = 'CONVERSATION_START',
    PATTERN_DRIFT_DETECTED = 'PATTERN_DRIFT_DETECTED',
    USER_FRUSTRATION_SPIKE = 'USER_FRUSTRATION_SPIKE',
    GOOD_CALIBRATION = 'GOOD_CALIBRATION',
    TRAUMA_TRIGGERED = 'TRAUMA_TRIGGERED',
    USER_PROFILE_UPDATED = 'USER_PROFILE_UPDATED',
}

// Orchestration events (v2 mới)
enum OrchestrationEventType {
    AGENT_SPAWNED = 'AGENT_SPAWNED',
    TASK_DELEGATED = 'TASK_DELEGATED',
    CONSENSUS_REACHED = 'CONSENSUS_REACHED',
    CONFLICT_DETECTED = 'CONFLICT_DETECTED',
    LEADER_ELECTED = 'LEADER_ELECTED',
}

// Reasoning events (v2 mới)
enum ReasoningEventType {
    TOT_BRANCH_EXPLORED = 'TOT_BRANCH_EXPLORED',
    CRITIC_OVERRIDE = 'CRITIC_OVERRIDE',         // Critic blocked bad response
    VERIFIER_PASSED = 'VERIFIER_PASSED',
    HALLUCINATION_DETECTED = 'HALLUCINATION_DETECTED',
}
```

---

## 12. Full Flow v2

```
═══════════════════════════════════════
CONVERSATION START
═══════════════════════════════════════
clawkit_recall_user(user_id)
  → Load profile + negative patterns

clawkit_compress_context(target_tokens=50000)
  → Nếu có history từ session trước: compress intelligently

═══════════════════════════════════════
MỖI MESSAGE
═══════════════════════════════════════
[SENSE]
clawkit_sense_intent(messages, current_pattern)
  → ConversationTransparency → ConversationDecision

clawkit_check_pattern(["skeptical_reviewer"], user_id)
  → TraumaRegistry check

clawkit_recall_similar(current_context, k=3)
  → HyperMemory episodic recall

[REASON — chỉ khi cần, không phải mọi message]
Nếu complex/high-stakes:
  clawkit_reason_chain(draft, context, mode='deep')
    → ToT explore 3 paths
    → Critic ranks
    → Verifier validates
    → Best path wins

Nếu cần multi-step task:
  clawkit_orchestrate(task, strategy='pipeline')
    → Spawn planner + executor agents
    → Collect results
    → Consensus if needed

[ACT]
clawkit_commit_pattern(chosen_pattern, reasoning)
  → LiquidBrain.forward() update

→ RESPOND

[LEARN]
clawkit_record_outcome(pattern, outcome, severity)
  → TraumaRegistry + CausalGraph + HyperMemory

clawkit_update_user(user_id, new_learnings)

═══════════════════════════════════════
CUỐI SESSION
═══════════════════════════════════════
clawkit_dream_conversation(episodes=20)
  → Experience replay, consolidate

MemoryDecayManager.prune(threshold=0.1)
  → Garbage collect stale memories
```

---

## 13. Priority (Updated)

**P0 — Unblock everything:**
- `IOracle.embed<T>()` — không có này, toàn bộ memory system stuck ở DeFi

**P1 — Core cognitive loop + long-context:**
- `clawkit_sense_intent` + `ConversationTransparency` (pattern drift)
- `clawkit_check_pattern` + TraumaRegistry wiring
- `clawkit_reason_chain` + ToT/GoT + Critic-Verifier
- `clawkit_compress_context` + ContextCompressor

**P2 — Memory completeness + multi-agent:**
- `clawkit_recall_user` + `clawkit_update_user`
- `clawkit_recall_similar` + `clawkit_memory_query`
- MemoryDecayManager + MemoryGraph (semantic layer)
- SwarmOrchestrator + `clawkit_orchestrate`

**P3 — Tool evolution + learning:**
- `clawkit_record_outcome` + `clawkit_dream_conversation`
- `clawkit_generate_tool` + ToolGenerator
- `clawkit_tool_recommend` + ToolPerformanceTracker

**P4 — Events + parallel:**
- ConversationEventType + OrchestrationEventType + ReasoningEventType
- Parallel processing layer (future)
- Cognitive domain security guard (adapt từ EidolonGuard)

---

## 14. Coverage sau v2

| Hạng mục | v1 | v2 Target |
|---|---|---|
| 1. Hierarchical Memory | 95% | **100%** (+decay curve +semantic graph) |
| 2. Advanced Reasoning | 75% | **95%** (+ToT/GoT +Critic-Verifier) |
| 3. Multi-Agent Orchestration | 35% | **80%** (+SwarmOrchestrator) |
| 4. God-tier Tool Management | 70% | **90%** (+generator +scoring) |
| 5. Context God Mode | 55% | **90%** (+compression +smart routing) |
| 6. Adaptive Learning | 90% | **95%** (+parallel processing stub) |

---

## 15. Điều quan trọng nhất (không đổi từ v1)

Design này giải quyết **hai vấn đề khác nhau** cùng lúc:

**Vấn đề 1 (gốc):** AI không còn "lặp lỗi ngu" — giải quyết bằng P0+P1 (closed feedback loop + causal reasoning).

**Vấn đề 2 (Super MCP):** AI trở thành cognitive infrastructure cho bất kỳ domain nào — giải quyết bằng P1+P2+P3.

Hai vấn đề này không conflict. P0 unblock cả hai. Sau P0, v1 tools giải quyết vấn đề 1 ngay lập tức. v2 additions nâng lên Super MCP level.

---

*v2 tổng hợp từ: design v1 của Claude + gap analysis feedback + codebase review đầy đủ.*
