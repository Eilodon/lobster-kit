import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EidolonSwarm } from '../src/swarm/EidolonSwarm';

class MockBroadcastChannel {
    public static channels: Record<string, MockBroadcastChannel[]> = {};
    public onmessage: ((event: MessageEvent) => void) | null = null;

    constructor(public readonly name: string) {
        if (!MockBroadcastChannel.channels[name]) {
            MockBroadcastChannel.channels[name] = [];
        }
        MockBroadcastChannel.channels[name].push(this);
    }

    public postMessage(data: unknown): void {
        const peers = MockBroadcastChannel.channels[this.name] || [];
        for (const peer of peers) {
            if (peer === this) continue;
            peer.onmessage?.({ data } as MessageEvent);
        }
    }

    public close(): void {
        const peers = MockBroadcastChannel.channels[this.name] || [];
        const idx = peers.indexOf(this);
        if (idx >= 0) peers.splice(idx, 1);
    }
}

describe('EidolonSwarm auth regression', () => {
    const originalBroadcastChannel = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    const originalSecret = process.env.EIDOLON_SWARM_SECRET;
    const originalAllowFallback = process.env.EIDOLON_SWARM_ALLOW_TOKEN_FALLBACK;

    beforeEach(() => {
        MockBroadcastChannel.channels = {};
        (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = MockBroadcastChannel as unknown as typeof BroadcastChannel;
        process.env.EIDOLON_SWARM_SECRET = 'swarm-secret';
        delete process.env.EIDOLON_SWARM_ALLOW_TOKEN_FALLBACK;
    });

    afterEach(() => {
        (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = originalBroadcastChannel;
        if (originalSecret === undefined) delete process.env.EIDOLON_SWARM_SECRET;
        else process.env.EIDOLON_SWARM_SECRET = originalSecret;
        if (originalAllowFallback === undefined) delete process.env.EIDOLON_SWARM_ALLOW_TOKEN_FALLBACK;
        else process.env.EIDOLON_SWARM_ALLOW_TOKEN_FALLBACK = originalAllowFallback;
    });

    it('should fail closed when signature generation fails (no token leak fallback)', () => {
        const swarm = new EidolonSwarm('AGENT_A');
        const postSpy = vi.spyOn((swarm as any).channel, 'postMessage');
        postSpy.mockClear();

        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        (swarm as any).broadcast({
            sourceAgentId: 'AGENT_A',
            type: 'GOSSIP',
            payload: cyclic,
            timestamp: Date.now()
        });

        expect(postSpy).not.toHaveBeenCalled();
        swarm.close();
    });

    it('should reject __eidolonToken envelopes by default', () => {
        const swarm = new EidolonSwarm('AGENT_A');
        const decoded = (swarm as any).validateDecodedMessage(
            'peer-x',
            'GOSSIP',
            Date.now(),
            { __eidolonToken: 'swarm-secret', data: { hello: 'world' } }
        );

        expect(decoded).toBeNull();
        swarm.close();
    });
});
