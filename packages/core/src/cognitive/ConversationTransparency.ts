import type { ConversationSensory, Message, UserSensory } from '../types/CognitiveTypes';

const EXPERT_SIGNALS = ['tradeoff', 'latency', 'throughput', 'schema', 'idempotent', 'rollback', 'benchmark'];
const NOVICE_SIGNALS = ['không biết', 'không hiểu', 'là gì', 'help me', 'newbie', 'beginner'];
const FRUSTRATION_SIGNALS = ['??', '!!!', 'bực', 'frustrat', 'why', 'wtf', 'sai', 'gấp'];

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

export class ConversationTransparency {
    public senseIntent(
        messages: Message[],
        currentPattern: string,
        user?: UserSensory
    ): ConversationSensory {
        const lastUserMessages = messages.filter((m) => m.role === 'user').slice(-5);
        const joined = lastUserMessages.map((m) => m.content.toLowerCase()).join(' ');
        const expertise = this.detectExpertise(joined, user);
        const intent = this.detectIntent(joined);
        const frustration = this.detectFrustration(joined);
        const contextDepth = this.detectContextDepth(messages);
        const patternAppropriate = this.isPatternAppropriate(currentPattern, intent, expertise);
        const momentum = this.detectMomentum(lastUserMessages);

        return {
            user_expertise_signal: expertise,
            user_intent: intent,
            agent_current_pattern: currentPattern,
            pattern_is_appropriate: patternAppropriate,
            pattern_drift_detected: !patternAppropriate,
            user_frustration_level: frustration,
            conversation_momentum: momentum,
            context_depth: contextDepth,
        };
    }

    private detectExpertise(joined: string, user?: UserSensory): ConversationSensory['user_expertise_signal'] {
        if (typeof user?.expertise_level === 'number') {
            if (user.expertise_level >= 0.7) return 'expert';
            if (user.expertise_level <= 0.35) return 'novice';
        }

        let expertHits = 0;
        let noviceHits = 0;
        for (const signal of EXPERT_SIGNALS) {
            if (joined.includes(signal)) expertHits++;
        }
        for (const signal of NOVICE_SIGNALS) {
            if (joined.includes(signal)) noviceHits++;
        }
        if (expertHits >= 2 && expertHits > noviceHits) return 'expert';
        if (noviceHits >= 1 && noviceHits >= expertHits) return 'novice';
        return 'intermediate';
    }

    private detectIntent(joined: string): ConversationSensory['user_intent'] {
        if (joined.includes('brainstorm') || joined.includes('cùng nghĩ') || joined.includes('ý tưởng')) {
            return 'brainstorm_together';
        }
        if (joined.includes('debug') || joined.includes('fix') || joined.includes('error') || joined.includes('bug')) {
            return 'debug_problem';
        }
        if (joined.includes('học') || joined.includes('explain') || joined.includes('learn')) {
            return 'learn_something';
        }
        if (joined.includes('đúng không') || joined.includes('confirm') || joined.includes('validate')) {
            return 'get_validation';
        }
        if (joined.includes('vent') || joined.includes('xả') || joined.includes('bực')) {
            return 'vent';
        }
        return 'share_and_be_heard';
    }

    private detectFrustration(joined: string): number {
        let hits = 0;
        for (const signal of FRUSTRATION_SIGNALS) {
            if (joined.includes(signal)) hits++;
        }
        const punctuationPressure = (joined.match(/[!?]/g)?.length ?? 0) / 20;
        return clamp01(hits * 0.15 + punctuationPressure);
    }

    private detectContextDepth(messages: Message[]): ConversationSensory['context_depth'] {
        if (messages.length >= 10) return 'rich';
        const avgLen = messages.length === 0
            ? 0
            : messages.reduce((acc, m) => acc + m.content.length, 0) / messages.length;
        return avgLen >= 180 ? 'rich' : 'sparse';
    }

    private detectMomentum(lastUserMessages: Message[]): ConversationSensory['conversation_momentum'] {
        if (lastUserMessages.length < 2) return 'neutral';
        const lengths = lastUserMessages.map((m) => m.content.length);
        const delta = lengths[lengths.length - 1] - lengths[0];
        if (delta > 50) return 'building';
        if (delta < -50) return 'deteriorating';
        return 'neutral';
    }

    private isPatternAppropriate(
        currentPattern: string,
        intent: ConversationSensory['user_intent'],
        expertise: ConversationSensory['user_expertise_signal']
    ): boolean {
        const normalizedPattern = currentPattern.toLowerCase();
        if (intent === 'brainstorm_together' && normalizedPattern.includes('instructional')) return false;
        if (intent === 'debug_problem' && normalizedPattern.includes('story')) return false;
        if (expertise === 'expert' && normalizedPattern.includes('over_explain')) return false;
        if (expertise === 'novice' && normalizedPattern.includes('ultra_brief')) return false;
        return true;
    }
}
