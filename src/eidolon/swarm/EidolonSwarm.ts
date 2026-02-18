
import { EventEmitter } from 'events';
import { EidolonBus, EidolonEventType } from '../events/EidolonBus';
import { DirtyMask, DirtyTracker } from './DirtyTracker';

// Assuming EidolonBus needs to export these or we define them
// For now, let's assume simple string types or redefine if needed, 
// but better to import if possible.

export interface SwarmMessage {
    sourceAgentId: string;
    type: 'DISCOVERY' | 'GOSSIP' | 'DANGER';
    payload: any;
    timestamp: number;
}

export interface PeerHandle {
    peerId: string;
    handleId: number;
    generation: number;
    lastSeenAt: number;
}

export interface SwarmBandwidthSnapshot {
    baselineBytes: number;
    optimizedBytes: number;
    reductionRatio: number;
    samples: number;
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
    private dirtyTracker: DirtyTracker = new DirtyTracker();
    private readonly peerHandles = new Map<string, PeerHandle>();
    private nextHandleId = 1;
    private readonly rejoinGraceMs = 30_000;

    private readonly encoder = new TextEncoder();
    private readonly decoder = new TextDecoder();
    private readonly pooledChunkSize = 4096;
    private readonly bufferPool: Uint8Array[] = [];
    private bandwidthBaselineBytes = 0;
    private bandwidthOptimizedBytes = 0;
    private bandwidthSamples = 0;

    constructor(agentId: string = `AGENT_${Math.floor(Math.random() * 10000)}`) {
        super();
        this.agentId = agentId;
        this.bus = EidolonBus.getInstance();

        // FIX Bug #13: Node < 18 Compatibility
        if (typeof BroadcastChannel !== 'undefined') {
            this.channel = new BroadcastChannel('eidolon-hive-v1');
            this.setupIncoming();
        } else {
            // console.warn('⚠️ BroadcastChannel not available (Node < 18?). Swarm P2P disabled.');
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

        // console.log(`🐝 SWARM: Agent ${this.agentId} joined the Hive.`);
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
            const msg = this.unpackMessage(event.data);
            if (!msg) return;

            // Ignore self
            if (msg.sourceAgentId === this.agentId) return;

            this.handleMessage(msg);
        };
    }

    private handleMessage(msg: SwarmMessage) {
        this.touchPeer(msg.sourceAgentId, msg.timestamp);
        switch (msg.type) {
            case 'DISCOVERY':
                if (!this.peers.has(msg.sourceAgentId)) {
                    this.peers.add(msg.sourceAgentId);
                    this.dirtyTracker.markDirty(msg.sourceAgentId, DirtyMask.PEER_DISCOVERY);
                    // console.log(`🐝 SWARM: New Peer Discovered: ${msg.sourceAgentId}`);
                }
                break;

            case 'GOSSIP':
                // Received an Opportunity from another agent
                // console.log(`🐝 SWARM: Received INTEL from ${msg.sourceAgentId}`, msg.payload);
                // In V2: Validate before blindly trusting
                // Emit to local bus as an EXTERNAL signal?
                this.dirtyTracker.markDirty(msg.sourceAgentId, DirtyMask.GOSSIP);
                break;

            case 'DANGER':
                console.warn(`🐝 SWARM: DANGER SIGNAL from ${msg.sourceAgentId}`, msg.payload);
                this.dirtyTracker.markDirty(msg.sourceAgentId, DirtyMask.DANGER);
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
        const baselineBytes = this.estimateMessageBytes(msg);
        const packed = this.packMessage(msg);
        const optimizedBytes = packed instanceof Uint8Array
            ? packed.byteLength
            : this.estimateMessageBytes(packed);

        this.bandwidthBaselineBytes += baselineBytes;
        this.bandwidthOptimizedBytes += optimizedBytes;
        this.bandwidthSamples += 1;

        this.channel.postMessage(packed);
    }

    public close() {
        this.channel.close();
    }

    public getDirtyPeers(mask?: DirtyMask): string[] {
        return this.dirtyTracker.getDirtyPeers(mask);
    }

    public clearPeerDirty(peerId: string): void {
        this.dirtyTracker.clear(peerId);
    }

    public getPeerHandles(): PeerHandle[] {
        return Array.from(this.peerHandles.values());
    }

    public getBandwidthSnapshot(): SwarmBandwidthSnapshot {
        const reductionRatio = this.bandwidthBaselineBytes > 0
            ? Math.max(0, Math.min(1, 1 - (this.bandwidthOptimizedBytes / this.bandwidthBaselineBytes)))
            : 0;
        return {
            baselineBytes: this.bandwidthBaselineBytes,
            optimizedBytes: this.bandwidthOptimizedBytes,
            reductionRatio,
            samples: this.bandwidthSamples
        };
    }

    private touchPeer(peerId: string, nowMs: number): void {
        const existing = this.peerHandles.get(peerId);
        if (!existing) {
            this.peerHandles.set(peerId, {
                peerId,
                handleId: this.nextHandleId++,
                generation: 1,
                lastSeenAt: nowMs
            });
            return;
        }

        const generation = (nowMs - existing.lastSeenAt) > this.rejoinGraceMs
            ? existing.generation + 1
            : existing.generation;
        this.peerHandles.set(peerId, {
            ...existing,
            generation,
            lastSeenAt: nowMs
        });
    }

    private estimateMessageBytes(msg: SwarmMessage): number {
        try {
            return this.encoder.encode(JSON.stringify(msg)).byteLength;
        } catch {
            return 0;
        }
    }

    private acquireBuffer(minSize: number): Uint8Array {
        if (minSize > this.pooledChunkSize) {
            return new Uint8Array(minSize);
        }
        const pooled = this.bufferPool.pop();
        return pooled ?? new Uint8Array(this.pooledChunkSize);
    }

    private releaseBuffer(buf: Uint8Array): void {
        if (buf.byteLength === this.pooledChunkSize && this.bufferPool.length < 32) {
            this.bufferPool.push(buf);
        }
    }

    private encodeType(type: SwarmMessage['type']): number {
        switch (type) {
            case 'DISCOVERY': return 0;
            case 'GOSSIP': return 1;
            case 'DANGER': return 2;
        }
    }

    private decodeType(code: number): SwarmMessage['type'] | null {
        if (code === 0) return 'DISCOVERY';
        if (code === 1) return 'GOSSIP';
        if (code === 2) return 'DANGER';
        return null;
    }

    private packMessage(msg: SwarmMessage): SwarmMessage | Uint8Array {
        try {
            const sourceBytes = this.encoder.encode(msg.sourceAgentId);
            const payloadBytes = this.encoder.encode(JSON.stringify(msg.payload));
            const headerSize = 1 + 1 + 8 + 2 + 4;
            const total = headerSize + sourceBytes.byteLength + payloadBytes.byteLength;
            const buf = this.acquireBuffer(total);
            const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

            view.setUint8(0, 1); // version
            view.setUint8(1, this.encodeType(msg.type));
            view.setBigUint64(2, BigInt(Math.max(0, Math.floor(msg.timestamp))), true);
            view.setUint16(10, sourceBytes.byteLength, true);
            view.setUint32(12, payloadBytes.byteLength, true);

            const sourceOffset = headerSize;
            const payloadOffset = sourceOffset + sourceBytes.byteLength;
            buf.set(sourceBytes, sourceOffset);
            buf.set(payloadBytes, payloadOffset);

            const packed = buf.slice(0, total);
            this.releaseBuffer(buf);
            return packed;
        } catch {
            return msg;
        }
    }

    private unpackMessage(raw: unknown): SwarmMessage | null {
        if (raw && typeof raw === 'object' && 'type' in (raw as any) && 'sourceAgentId' in (raw as any)) {
            return raw as SwarmMessage;
        }

        let bytes: Uint8Array | null = null;
        if (raw instanceof Uint8Array) {
            bytes = raw;
        } else if (raw instanceof ArrayBuffer) {
            bytes = new Uint8Array(raw);
        }
        if (!bytes || bytes.byteLength < 16) return null;

        try {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const version = view.getUint8(0);
            if (version !== 1) return null;

            const type = this.decodeType(view.getUint8(1));
            if (!type) return null;

            const timestamp = Number(view.getBigUint64(2, true));
            const sourceLen = view.getUint16(10, true);
            const payloadLen = view.getUint32(12, true);
            const headerSize = 1 + 1 + 8 + 2 + 4;
            const total = headerSize + sourceLen + payloadLen;
            if (total > bytes.byteLength) return null;

            const sourceAgentId = this.decoder.decode(bytes.subarray(headerSize, headerSize + sourceLen));
            const payloadRaw = this.decoder.decode(bytes.subarray(headerSize + sourceLen, total));
            const payload = JSON.parse(payloadRaw);
            return { sourceAgentId, type, payload, timestamp };
        } catch {
            return null;
        }
    }
}
