
import { EventEmitter } from 'events';
import { EidolonBus, EidolonEventType } from '../events/EidolonBus';

// Assuming EidolonBus needs to export these or we define them
// For now, let's assume simple string types or redefine if needed, 
// but better to import if possible.

export interface SwarmMessage {
    sourceAgentId: string;
    type: 'DISCOVERY' | 'GOSSIP' | 'DANGER';
    payload: any;
    timestamp: number;
}

/**
 * 🐝 EIDOLON SWARM (The Hive)
 * 
 * "One mind, many bodies."
 * Enables P2P communication between agent instances.
 * V1: Uses BroadcastChannel (Local Inter-Process Communication).
 * V2: Will use Libp2p/GunDB for distributed mesh.
 */
export class EidolonSwarm extends EventEmitter {
    private channel: BroadcastChannel;
    private agentId: string;
    private bus: EidolonBus;
    private peers: Set<string> = new Set();

    constructor(agentId: string = `AGENT_${Math.floor(Math.random() * 10000)}`) {
        super();
        this.agentId = agentId;
        this.bus = EidolonBus.getInstance();

        // FIX Bug #13: Node < 18 Compatibility
        if (typeof BroadcastChannel !== 'undefined') {
            this.channel = new BroadcastChannel('eidolon-hive-v1');
            this.setupIncoming();
        } else {
            console.warn('⚠️ BroadcastChannel not available (Node < 18?). Swarm P2P disabled.');
            // Dummy channel to prevent crash on method calls? 
            // Better to make channel optional or mock it.
            this.channel = {
                postMessage: () => { },
                onmessage: null,
                close: () => { }
            } as any;
        }

        // Listen for internal events to broadcast
        this.setupOutgoing();

        // Listen for external events from the swarm
        // this.setupIncoming(); // Moved inside check

        // Announce presence
        if (typeof BroadcastChannel !== 'undefined') {
            this.broadcast({
                sourceAgentId: this.agentId,
                type: 'DISCOVERY',
                payload: { status: 'ONLINE', strategy: 'CLAW_V1' },
                timestamp: Date.now()
            });
        }

        console.log(`🐝 SWARM: Agent ${this.agentId} joined the Hive.`);
    }

    private setupOutgoing() {
        // High Priority Events to Gossip
        this.bus.subscribe(EidolonEventType.OPPORTUNITY, (event: any) => {
            this.broadcast({
                sourceAgentId: this.agentId,
                type: 'GOSSIP',
                payload: event,
                timestamp: Date.now()
            });
        });

        this.bus.subscribe(EidolonEventType.TRAUMA, (event: any) => {
            this.broadcast({
                sourceAgentId: this.agentId,
                type: 'DANGER',
                payload: event,
                timestamp: Date.now()
            });
        });
    }

    private setupIncoming() {
        this.channel.onmessage = (event: MessageEvent) => {
            const msg = event.data as SwarmMessage;

            // Ignore self
            if (msg.sourceAgentId === this.agentId) return;

            this.handleMessage(msg);
        };
    }

    private handleMessage(msg: SwarmMessage) {
        switch (msg.type) {
            case 'DISCOVERY':
                if (!this.peers.has(msg.sourceAgentId)) {
                    this.peers.add(msg.sourceAgentId);
                    console.log(`🐝 SWARM: New Peer Discovered: ${msg.sourceAgentId}`);
                }
                break;

            case 'GOSSIP':
                // Received an Opportunity from another agent
                console.log(`🐝 SWARM: Received INTEL from ${msg.sourceAgentId}`, msg.payload);
                // In V2: Validate before blindly trusting
                // Emit to local bus as an EXTERNAL signal?
                break;

            case 'DANGER':
                console.warn(`🐝 SWARM: DANGER SIGNAL from ${msg.sourceAgentId}`, msg.payload);
                // Trigger local reflex?
                // Re-emit trauma locally so EmotionalCore reacts
                this.bus.emitEvent({
                    type: EidolonEventType.TRAUMA,
                    timestamp: Date.now(),
                    payload: { ...msg.payload, source: `SWARM:${msg.sourceAgentId}` }
                });
                break;
        }
    }

    private broadcast(msg: SwarmMessage) {
        this.channel.postMessage(msg);
    }

    public close() {
        this.channel.close();
    }
}
