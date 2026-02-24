import type { IOracle } from '../ai/IOracle';
import type {
    AgentConflict,
    AgentRole,
    AgentSpec,
    ConsensusResult,
    Resolution,
    TaskResult
} from '../eidolon/CognitiveTypes';
import { parseFirstJsonObject } from '../utils/jsonExtraction';

type OracleGenerator = Pick<IOracle, 'generate'>;

let agentCounter = 0;

function nextAgentId(prefix: string): string {
    const id = agentCounter++;
    return `${prefix}-${Date.now()}-${id}`;
}

function parseObject(raw: string): Record<string, unknown> | null {
    return parseFirstJsonObject(raw);
}

export class SwarmOrchestrator {
    private readonly agents = new Map<string, AgentSpec>();

    constructor(private readonly oracle?: OracleGenerator) { }

    public async spawnAgent(role: AgentRole, task: string): Promise<string> {
        const capabilities = this.capabilitiesFor(role, task);
        const id = nextAgentId(role);
        this.agents.set(id, {
            id,
            role,
            capabilities,
            max_tokens: role === 'planner' ? 1200 : 800,
            priority: role === 'coordinator' ? 100 : 50,
        });
        return id;
    }

    public async electLeader(task: string): Promise<string> {
        const candidates = Array.from(this.agents.values());
        if (candidates.length === 0) {
            return this.spawnAgent('coordinator', task);
        }
        const sorted = candidates.sort((a, b) => (b.priority - a.priority) || (b.capabilities.length - a.capabilities.length));
        return sorted[0].id;
    }

    public async delegate(task: string, toAgent: string, timeoutMs: number): Promise<TaskResult> {
        const started = Date.now();
        const agent = this.agents.get(toAgent);
        if (!agent) {
            return {
                task,
                agent_id: toAgent,
                ok: false,
                error: `Agent ${toAgent} not found`,
                latency_ms: Date.now() - started,
            };
        }

        const boundedTimeout = Math.max(1, timeoutMs);
        const timeoutError = `Delegate timeout after ${boundedTimeout}ms`;

        try {
            if (this.oracle?.generate) {
                const delegated = await Promise.race([
                    this.delegateWithOracle(task, agent),
                    new Promise<TaskResult>((_, reject) => {
                        setTimeout(() => reject(new Error(timeoutError)), boundedTimeout);
                    }),
                ]);
                return {
                    ...delegated,
                    latency_ms: Date.now() - started,
                };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                task,
                agent_id: toAgent,
                ok: false,
                error: message,
                latency_ms: Date.now() - started,
            };
        }

        const simulatedLatency = this.estimateLatency(task, boundedTimeout);
        try {
            const data = await Promise.race([
                this.simulateWork(task, agent, simulatedLatency),
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error(timeoutError)), boundedTimeout);
                }),
            ]);

            return {
                task,
                agent_id: toAgent,
                ok: true,
                data,
                latency_ms: Date.now() - started,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                task,
                agent_id: toAgent,
                ok: false,
                error: message,
                latency_ms: Date.now() - started,
            };
        }
    }

    public async consensus(question: string, agents: string[], threshold = 0.6): Promise<ConsensusResult> {
        const options = ['approve', 'reject', 'revise'];
        const votes: Record<string, string> = {};
        for (let i = 0; i < agents.length; i++) {
            const option = options[i % options.length];
            votes[agents[i]] = option;
        }

        const tally = new Map<string, number>();
        for (const choice of Object.values(votes)) {
            tally.set(choice, (tally.get(choice) ?? 0) + 1);
        }

        const fallbackWinner = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0] ?? ['revise', 0];
        const fallbackSupportRatio = agents.length === 0 ? 0 : fallbackWinner[1] / agents.length;
        const fallbackSelected = fallbackSupportRatio >= threshold ? fallbackWinner[0] : 'revise';

        if (this.oracle?.generate && agents.length > 0) {
            const withOracle = await this.consensusWithOracle(question, votes, options, threshold);
            if (withOracle) {
                return {
                    question,
                    selected: withOracle.selected,
                    support_ratio: withOracle.support_ratio,
                    votes,
                };
            }
        }

        return {
            question,
            selected: fallbackSelected,
            support_ratio: fallbackSupportRatio,
            votes,
        };
    }

    public async resolveConflict(conflict: AgentConflict): Promise<Resolution> {
        if (this.oracle?.generate && conflict.proposals.length > 0) {
            const resolved = await this.resolveConflictWithOracle(conflict);
            if (resolved) return resolved;
        }
        const winner = conflict.proposals[0] ?? { agent_id: 'none', proposal: 'No proposal' };
        return {
            winner_agent_id: winner.agent_id,
            rationale: `Selected first valid proposal for topic "${conflict.topic}".`,
            confidence: conflict.proposals.length > 1 ? 0.65 : 0.8,
        };
    }

    public listAgents(): AgentSpec[] {
        return Array.from(this.agents.values());
    }

    private async delegateWithOracle(task: string, agent: AgentSpec): Promise<TaskResult> {
        if (!this.oracle?.generate) {
            return {
                task,
                agent_id: agent.id,
                ok: false,
                error: 'Oracle generation unavailable',
                latency_ms: 0,
            };
        }

        const prompt = [
            `You are an autonomous sub-agent with role=${agent.role}.`,
            'Solve the delegated task using role-specific behavior.',
            'Return JSON ONLY with: {"ok": boolean, "data": object, "error": string}',
            `task=${task}`,
            `capabilities=${JSON.stringify(agent.capabilities)}`,
            `max_tokens=${agent.max_tokens}`,
        ].join('\n');

        try {
            const raw = await this.oracle.generate(prompt, { json: true, temperature: 0.2, maxTokens: 800 });
            const parsed = parseObject(raw);
            if (!parsed) throw new Error('Invalid oracle delegation payload.');

            const ok = Boolean(parsed.ok);
            const data = parsed.data && typeof parsed.data === 'object'
                ? parsed.data as Record<string, unknown>
                : {
                    role: agent.role,
                    note: String(parsed.data ?? ''),
                };

            return {
                task,
                agent_id: agent.id,
                ok,
                data: ok ? data : undefined,
                error: ok ? undefined : String(parsed.error ?? 'Delegation rejected by oracle.'),
                latency_ms: 0,
            };
        } catch {
            const fallbackData = await this.simulateWork(task, agent, 25);
            return {
                task,
                agent_id: agent.id,
                ok: true,
                data: {
                    ...fallbackData,
                    fallback: 'oracle_unavailable',
                },
                latency_ms: 0,
            };
        }
    }

    private async consensusWithOracle(
        question: string,
        votes: Record<string, string>,
        options: string[],
        threshold: number
    ): Promise<{ selected: string; support_ratio: number } | null> {
        if (!this.oracle?.generate) return null;

        const prompt = [
            'You are a coordinator resolving multi-agent votes.',
            'Return JSON ONLY with: {"selected": string, "support_ratio": number}',
            `question=${question}`,
            `votes=${JSON.stringify(votes)}`,
            `options=${JSON.stringify(options)}`,
            `minimum_threshold=${threshold}`,
        ].join('\n');

        try {
            const raw = await this.oracle.generate(prompt, { json: true, temperature: 0.1, maxTokens: 280 });
            const parsed = parseObject(raw);
            if (!parsed) return null;

            const selected = String(parsed.selected ?? 'revise');
            const supportRatio = Math.max(0, Math.min(1, Number(parsed.support_ratio)));
            if (!options.includes(selected)) return null;
            if (!Number.isFinite(supportRatio)) return null;
            return { selected, support_ratio: supportRatio };
        } catch {
            return null;
        }
    }

    private async resolveConflictWithOracle(conflict: AgentConflict): Promise<Resolution | null> {
        if (!this.oracle?.generate) return null;
        const prompt = [
            'Resolve an agent conflict and select one proposal.',
            'Return JSON ONLY with: {"winner_agent_id": string, "rationale": string, "confidence": number}',
            `topic=${conflict.topic}`,
            `proposals=${JSON.stringify(conflict.proposals)}`,
        ].join('\n');

        try {
            const raw = await this.oracle.generate(prompt, { json: true, temperature: 0.1, maxTokens: 500 });
            const parsed = parseObject(raw);
            if (!parsed) return null;
            const winner = String(parsed.winner_agent_id ?? '');
            const rationale = String(parsed.rationale ?? '').trim();
            const confidence = Math.max(0, Math.min(1, Number(parsed.confidence)));
            if (!winner || !rationale || !Number.isFinite(confidence)) return null;
            return {
                winner_agent_id: winner,
                rationale,
                confidence,
            };
        } catch {
            return null;
        }
    }

    private estimateLatency(task: string, timeoutMs: number): number {
        const lowered = task.toLowerCase();
        let base = Math.min(Math.max(timeoutMs / 8, 20), 400);
        if (lowered.includes('consensus')) base += 60;
        if (lowered.includes('deep')) base += 80;
        if (lowered.includes('urgent')) base = Math.min(base, 80);
        return Math.floor(base);
    }

    private async simulateWork(task: string, agent: AgentSpec, latencyMs: number): Promise<Record<string, unknown>> {
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
        const lowered = task.toLowerCase();
        if (lowered.includes('force_fail') || lowered.includes('inject_failure')) {
            throw new Error('Injected failure for orchestration resilience test.');
        }
        return {
            role: agent.role,
            capability_used: agent.capabilities[0] ?? 'generic',
            note: `Task delegated to ${agent.role}`,
        };
    }

    private capabilitiesFor(role: AgentRole, task: string): string[] {
        const base = ['eidolon_memory_query', 'eidolon_reason_chain'];
        if (role === 'planner') return ['eidolon_compress_context', ...base];
        if (role === 'executor') return ['eidolon_commit_pattern', 'eidolon_record_outcome', ...base];
        if (role === 'critic') return ['eidolon_reason_chain', 'eidolon_tool_recommend'];
        if (role === 'memory_keeper') return ['eidolon_recall_user', 'eidolon_update_user', ...base];
        if (task.toLowerCase().includes('consensus')) return ['eidolon_orchestrate', ...base];
        return ['eidolon_orchestrate', ...base];
    }
}
