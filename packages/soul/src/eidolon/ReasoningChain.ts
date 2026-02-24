import type { IOracle } from '../ai/IOracle';
import type {
    ConversationSensory,
    CriticResult,
    ThoughtNode,
    UserSensory,
    VerifiedResponse
} from './CognitiveTypes';
import { parseFirstJsonObject } from '../utils/jsonExtraction';

type OracleGenerator = Pick<IOracle, 'refine' | 'generate'>;

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

function scoreFromIssues(issueCount: number, confidence: number): number {
    return clamp01(1 - issueCount * 0.15) * 0.7 + clamp01(confidence) * 0.3;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
    return parseFirstJsonObject(raw);
}

function toStringArray(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
}

export class CriticModule {
    constructor(private readonly oracle?: OracleGenerator) { }

    public async evaluate(
        thought: string,
        context: ConversationSensory,
        user?: UserSensory
    ): Promise<CriticResult> {
        if (this.oracle?.generate) {
            const fromOracle = await this.evaluateWithOracle(thought, context, user);
            if (fromOracle) return fromOracle;
        }
        return this.evaluateHeuristic(thought, context, user);
    }

    private async evaluateWithOracle(
        thought: string,
        context: ConversationSensory,
        user?: UserSensory
    ): Promise<CriticResult | null> {
        if (!this.oracle?.generate) return null;
        const prompt = [
            'You are a strict response critic for AI assistants.',
            'Evaluate the response against user context and quality expectations.',
            'Return JSON ONLY with keys: score, confidence, issues, suggestions.',
            'Rules:',
            '- score: number between 0 and 1',
            '- confidence: number between 0 and 1',
            '- issues: array of short strings',
            '- suggestions: array of short action strings',
            `Context JSON: ${JSON.stringify(context)}`,
            `User JSON: ${JSON.stringify(user ?? null)}`,
            `Response to evaluate: ${thought}`,
        ].join('\n');

        try {
            const raw = await this.oracle.generate(prompt, { json: true, temperature: 0.1, maxTokens: 500 });
            const parsed = parseJsonObject(raw);
            if (!parsed) return null;

            const score = clamp01(Number(parsed.score));
            const confidence = clamp01(Number(parsed.confidence));
            const issues = toStringArray(parsed.issues);
            const suggestions = toStringArray(parsed.suggestions);

            if (!Number.isFinite(score) || !Number.isFinite(confidence)) return null;

            return {
                score,
                confidence,
                issues,
                suggestions,
            };
        } catch {
            return null;
        }
    }

    private evaluateHeuristic(
        thought: string,
        context: ConversationSensory,
        user?: UserSensory
    ): CriticResult {
        const issues: string[] = [];
        const suggestions: string[] = [];

        if (context.pattern_drift_detected) {
            issues.push('Current pattern appears mismatched with user intent.');
            suggestions.push('Switch to an intent-aligned response mode.');
        }
        if (context.user_expertise_signal === 'expert' && thought.length > 1200) {
            issues.push('Response is likely too verbose for expert mode.');
            suggestions.push('Compress details; keep only high-signal tradeoffs.');
        }
        if (context.user_frustration_level > 0.7 && !thought.toLowerCase().includes('next')) {
            issues.push('High frustration detected but response lacks concrete next step.');
            suggestions.push('Lead with an actionable first step.');
        }
        if (user && user.communication_style.prefers_brevity > 0.7 && thought.length > 900) {
            issues.push('User prefers brevity, but thought is long.');
            suggestions.push('Provide short answer first, details second.');
        }

        const confidence = clamp01(0.6 + (context.context_depth === 'rich' ? 0.2 : 0) - issues.length * 0.1);
        return {
            score: scoreFromIssues(issues.length, confidence),
            issues,
            suggestions,
            confidence,
        };
    }
}

export class TreeOfThoughts {
    constructor(
        private readonly critic: CriticModule,
        private readonly oracle?: OracleGenerator
    ) { }

    public async explore(
        draft: string,
        context: ConversationSensory,
        user?: UserSensory,
        breadth = 3,
        depth = 2
    ): Promise<ThoughtNode> {
        const root: ThoughtNode = {
            id: 'root',
            thought: draft,
            depth: 0,
            score: 0,
            children: [],
            verified: false,
        };

        let best: ThoughtNode = root;
        const branches = await this.generateBranches(draft, context, breadth);
        for (let i = 0; i < branches.length; i++) {
            const candidate: ThoughtNode = {
                id: `t-${i}`,
                thought: branches[i],
                depth: 1,
                parent_id: root.id,
                score: 0,
                children: [],
                verified: false,
            };

            const evalResult = await this.critic.evaluate(candidate.thought, context, user);
            candidate.score = evalResult.score;
            root.children.push(candidate);

            if (depth > 1) {
                const refinements = await this.generateRefinements(candidate.thought, evalResult.suggestions);
                for (let j = 0; j < refinements.length; j++) {
                    const child: ThoughtNode = {
                        id: `t-${i}-${j}`,
                        thought: refinements[j],
                        depth: 2,
                        parent_id: candidate.id,
                        score: 0,
                        children: [],
                        verified: true,
                    };
                    const childEval = await this.critic.evaluate(child.thought, context, user);
                    child.score = childEval.score;
                    candidate.children.push(child);
                    if (child.score > best.score) best = child;
                }
            }

            if (candidate.score > best.score) best = candidate;
        }

        return best;
    }

    private async generateBranches(draft: string, context: ConversationSensory, breadth: number): Promise<string[]> {
        const variants = await this.generateBranchesWithOracle(draft, context, breadth);
        if (variants.length > 0) return variants;

        const fallback: string[] = [];
        fallback.push(draft);
        fallback.push(`Direct mode: ${draft}`);
        fallback.push(`Step-by-step mode: ${draft}`);
        if (context.user_intent === 'brainstorm_together') {
            fallback.push(`Collaborative mode: offer 3 options and tradeoffs. ${draft}`);
        }
        if (context.user_intent === 'debug_problem') {
            fallback.push(`Debug mode: isolate root cause, then propose fix with verification. ${draft}`);
        }
        return fallback.slice(0, Math.max(1, breadth));
    }

    private async generateBranchesWithOracle(
        draft: string,
        context: ConversationSensory,
        breadth: number
    ): Promise<string[]> {
        if (!this.oracle?.generate) return [];
        const prompt = [
            'Generate diverse reasoning branches for the response draft.',
            'Return JSON ONLY: {"branches": ["...", "..."]}',
            `branch_count=${Math.max(1, breadth)}`,
            `context=${JSON.stringify(context)}`,
            `draft=${draft}`,
        ].join('\n');

        try {
            const raw = await this.oracle.generate(prompt, { json: true, temperature: 0.3, maxTokens: 900 });
            const parsed = parseJsonObject(raw);
            if (!parsed) return [];
            const branches = toStringArray(parsed.branches).slice(0, Math.max(1, breadth));
            if (branches.length === 0) return [];
            const deduped = Array.from(new Set([draft, ...branches]));
            return deduped.slice(0, Math.max(1, breadth));
        } catch {
            return [];
        }
    }

    private async generateRefinements(base: string, suggestions: string[]): Promise<string[]> {
        const variants = await this.generateRefinementsWithOracle(base, suggestions);
        if (variants.length > 0) return variants;
        if (suggestions.length === 0) return [base];
        return suggestions.slice(0, 2).map((suggestion, idx) => `[Refinement ${idx + 1}] ${suggestion}\n${base}`);
    }

    private async generateRefinementsWithOracle(base: string, suggestions: string[]): Promise<string[]> {
        if (!this.oracle?.generate || suggestions.length === 0) return [];
        const prompt = [
            'Improve the response using the suggestions.',
            'Return JSON ONLY: {"refinements": ["...", "..."]}',
            `suggestions=${JSON.stringify(suggestions.slice(0, 4))}`,
            `base=${base}`,
        ].join('\n');
        try {
            const raw = await this.oracle.generate(prompt, { json: true, temperature: 0.25, maxTokens: 700 });
            const parsed = parseJsonObject(raw);
            if (!parsed) return [];
            const refinements = toStringArray(parsed.refinements).slice(0, 2);
            return refinements;
        } catch {
            return [];
        }
    }
}

export class VerifierLoop {
    constructor(
        private readonly critic: CriticModule,
        private readonly oracle?: OracleGenerator
    ) { }

    public async run(
        initialResponse: string,
        context: ConversationSensory,
        user?: UserSensory,
        maxIterations = 3
    ): Promise<VerifiedResponse> {
        let current = initialResponse;
        let iteration = 0;
        let latest = await this.critic.evaluate(current, context, user);
        const notes: string[] = [];

        while (iteration < maxIterations && latest.score <= 0.85) {
            notes.push(`iter_${iteration}: score=${latest.score.toFixed(3)} issues=${latest.issues.length}`);
            current = await this.improveResponse(current, latest, context, user);
            iteration++;
            latest = await this.critic.evaluate(current, context, user);
        }

        return {
            response: current,
            iterations: iteration,
            final_score: latest.score,
            trace: {
                mode: 'deep',
                notes,
            },
        };
    }

    private async improveResponse(
        draft: string,
        critique: CriticResult,
        context: ConversationSensory,
        user?: UserSensory
    ): Promise<string> {
        if (this.oracle?.refine) {
            try {
                const refined = await this.oracle.refine(draft, critique);
                if (typeof refined === 'string' && refined.trim()) return refined.trim();
            } catch {
                // fallback below
            }
        }

        if (this.oracle?.generate) {
            const prompt = [
                'Refine the draft response based on critique.',
                'Return plain text only (no markdown code fences).',
                `context=${JSON.stringify(context)}`,
                `user=${JSON.stringify(user ?? null)}`,
                `issues=${JSON.stringify(critique.issues)}`,
                `suggestions=${JSON.stringify(critique.suggestions)}`,
                `draft=${draft}`,
            ].join('\n');
            try {
                const improved = await this.oracle.generate(prompt, { temperature: 0.2, maxTokens: 800 });
                const cleaned = improved.replace(/```[\s\S]*?```/g, '').trim();
                if (cleaned) return cleaned;
            } catch {
                // fallback below
            }
        }

        const improvement = critique.suggestions.join(' ');
        return `${draft}\n\nRefinement:\n${improvement}`.trim();
    }
}

export class ReasoningChain {
    private readonly critic: CriticModule;
    private readonly tree: TreeOfThoughts;
    private readonly verifier: VerifierLoop;

    constructor(private readonly oracle?: OracleGenerator) {
        this.critic = new CriticModule(oracle);
        this.tree = new TreeOfThoughts(this.critic, oracle);
        this.verifier = new VerifierLoop(this.critic, oracle);
    }

    public async run(
        draftResponse: string,
        context: ConversationSensory,
        options: {
            mode: 'fast' | 'deep';
            max_iterations?: number;
            breadth?: number;
            depth?: number;
            user?: UserSensory;
        }
    ): Promise<VerifiedResponse> {
        const { mode, max_iterations = 3, breadth = 3, depth = 2, user } = options;

        if (mode === 'fast') {
            const critique = await this.critic.evaluate(draftResponse, context, user);
            return {
                response: draftResponse,
                iterations: 1,
                final_score: critique.score,
                trace: {
                    mode: 'fast',
                    notes: [
                        `fast_score=${critique.score.toFixed(3)}`,
                        ...critique.issues.map((issue) => `issue:${issue}`)
                    ],
                },
            };
        }

        const baseline = await this.critic.evaluate(draftResponse, context, user);
        const bestThought = await this.tree.explore(draftResponse, context, user, breadth, depth);
        const verified = await this.verifier.run(bestThought.thought, context, user, max_iterations);
        return {
            ...verified,
            trace: {
                mode: 'deep',
                notes: [
                    ...(verified.trace?.notes ?? []),
                    `baseline_fast_score=${baseline.score.toFixed(3)}`,
                    `best_thought_score=${bestThought.score.toFixed(3)}`,
                ],
                best_thought_id: bestThought.id,
            },
        };
    }
}
