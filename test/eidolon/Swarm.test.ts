import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EidolonSwarm } from '../../src/eidolon/swarm/EidolonSwarm';
import { EidolonBus, EidolonEventType } from '../../src/eidolon/events/EidolonBus';

// Mock BroadcastChannel if strictly necessary, but let's try to use the real one if available or a simple mock implementation

// Simple Mock for BroadcastChannel if not present
if (typeof BroadcastChannel === 'undefined') {
    global.BroadcastChannel = class MockBroadcastChannel {
        name: string;
        onmessage: (event: any) => void = () => { };
        static channels: Record<string, MockBroadcastChannel[]> = {};

        constructor(name: string) {
            this.name = name;
            if (!MockBroadcastChannel.channels[name]) {
                MockBroadcastChannel.channels[name] = [];
            }
            MockBroadcastChannel.channels[name].push(this);
        }

        postMessage(data: any) {
            const peers = MockBroadcastChannel.channels[this.name];
            peers.forEach(peer => {
                if (peer !== this && peer.onmessage) {
                    peer.onmessage({ data } as any);
                }
            });
        }

        close() {
            const peers = MockBroadcastChannel.channels[this.name];
            const idx = peers.indexOf(this);
            if (idx > -1) peers.splice(idx, 1);
        }
    } as any;
}

describe('EidolonSwarm (The Hive)', () => {
    let agentA: EidolonSwarm;
    let agentB: EidolonSwarm;

    beforeEach(() => {
        // Reset singleton bus for isolation if needed, but Swarm uses specific bus instances?
        // Actually Swarm uses the singleton EidolonBus. This might be tricky for testing two agents in same process
        // because they share the same Bus singleton.
        // Wait, if they share the same BUS, they will both hear the same local events.
        // But Swarm is about communicating BETWEEN processes usually.
        // In this test, we are simulating two agents.
        // If they share the Singleton Bus, then Agent A emitting to Bus means Agent B also "hears" it from the Bus if subscribed?
        // No, Agent A subscribes to Bus. If Bus emits, Agent A broadcast to Channel. 
        // Agent B listens to Channel.

        // ISSUE: Singleton Bus means we can't easily simulate "Local Bus A" and "Local Bus B" in the same process 
        // without refactoring EidolonBus to not be a strict singleton or allowing dependency injection.

        // For this test, we want to verify the CHANNEL communication.
        // We can manually trigger the broadcast or mock the bus.

    });

    it('should broadcast messages between agents via Channel', async () => {
        // We can instantiate Swarm classes.
        // Since we can't easily separate the Bus singleton in one process,
        // we will verify that calling 'broadcast' on A reaches B's 'onmessage'.

        agentA = new EidolonSwarm('AGENT_A');
        agentB = new EidolonSwarm('AGENT_B');

        const messageReceived = new Promise<any>(resolve => {
            // Spy on Agent B's handleMessage (private, so we might need to spy on 'onmessage' or check logic)
            // Or better, Agent B emits to the Bus upon receiving DANGER. 
            // We can spy on the Bus? No, Bus is shared.

            // Let's modify Agent B to allow us to check received messages or expose a public method for testing?
            // Or just listen to the channel directly to verify A sent it?

            // Let's rely on the fact that B logs to console or check side effects?
            // Actually, we can spy on console.log or warn.

            // Better: Spy on agentB['handleMessage'] using checking 'any' cast
            const originalHandle = (agentB as any).handleMessage.bind(agentB);
            (agentB as any).handleMessage = (msg: any) => {
                originalHandle(msg);
                resolve(msg);
            };
        });

        // Trigger A to broadcast
        (agentA as any).broadcast({
            sourceAgentId: 'AGENT_A',
            type: 'GOSSIP',
            payload: { data: 'Secret Intel' },
            timestamp: Date.now()
        });

        const msg = await messageReceived;
        expect(msg.sourceAgentId).toBe('AGENT_A');
        expect(msg.payload.data).toBe('Secret Intel');

        agentA.close();
        agentB.close();
    });
});
