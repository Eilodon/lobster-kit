
import { EventEmitter } from 'events';
import { createHmac, timingSafeEqual } from 'crypto';
import { EidolonBus, EidolonEventType } from '@clawkit/core';
import { DirtyMask, DirtyTracker } from '@clawkit/core';

// Assuming EidolonBus needs to export these or we define them
// For now, let's assume simple string types or redefine if needed, 
// but better to import if possible.

export interface SwarmMessage {
    sourceAgentId: string;
    type: 'DISCOVERY' | 'GOSSIP' | 'DANGER';
    payload: unknown;
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

interface SwarmDangerPayload {
    severity: number;
    reason?: string;
    mode?: string;
    action?: string;
}

interface SwarmWireEnvelope {
    __eidolonSig?: string;
    __eidolonToken?: string;
    data: unknown;
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
    private unsubs: Array<() => void> = [];
    private closed = false;
    private messageCount = 0;

    private readonly dangerRateLimit = new Map<string, number>();
    private readonly DANGER_COOLDOWN_MS = 30_000;
    private readonly MAX_EXTERNAL_TRAUMA_SEVERITY = 50;
    private readonly STALE_PEER_TTL_MS = 5 * 60_000;
    private readonly PRUNE_EVERY_MESSAGES = 1_000;
    private readonly MAX_SOURCE_LEN = 128;
    private readonly MAX_PAYLOAD_BYTES = 64 * 1024;
    private readonly swarmSecret = typeof process !== 'undefined'
        ? (process.env.EIDOLON_SWARM_SECRET ?? '').trim()
        : '';
    private readonly authEnabled = this.swarmSecret.length > 0;
    private readonly allowTokenFallback = typeof process !== 'undefined'
        ? process.env.EIDOLON_SWARM_ALLOW_TOKEN_FALLBACK === '1'
        : false;
    private warnedInsecureMode = false;

    constructor(agentId: string = `AGENT_${Math.floor(Math.random() * 10000)}`) {
        super();
        this.agentId = agentId;
        this.bus = EidolonBus.getInstance();

        // FIX Bug #13: Strict BroadcastChannel check
        if (typeof BroadcastChannel !== 'undefined') {
            this.channel = new BroadcastChannel('eidolon-hive-v1');
            this.setupIncoming();
        } else {
            // Fail Fast: Do not mask missing functionality
            throw new Error('EidolonSwarm requires BroadcastChannel. Please use Node.js 18+ or a polyfill.');
        }

        // Listen for internal events to broadcast
        this.setupOutgoing();

        // Listen for external events from the swarm
        // this.setupIncoming(); // Moved inside check

        // Announce presence
        this.broadcastDiscovery();

        // console.log(`🐝 SWARM: Agent ${this.agentId} joined the Hive.`);
    }

    private setupOutgoing() {
        // High Priority Events to Gossip
        const unsubOpportunity = this.bus.subscribe(EidolonEventType.OPPORTUNITY, (event) => {
            if (this.closed) return;
            const payload = (event && typeof event === 'object' && 'payload' in event)
                ? (event as { payload?: unknown }).payload
                : event;
            this.broadcast({
                sourceAgentId: this.agentId,
                type: 'GOSSIP',
                payload,
                timestamp: Date.now()
            });
        });

        const unsubTrauma = this.bus.subscribe(EidolonEventType.TRAUMA, (event) => {
            if (this.closed) return;
            const payload = (event && typeof event === 'object' && 'payload' in event)
                ? (event as { payload?: unknown }).payload
                : event;
            const source = (payload && typeof payload === 'object' && 'source' in payload)
                ? (payload as { source?: unknown }).source
                : undefined;
            if (typeof source === 'string' && source.startsWith('SWARM:')) {
                return;
            }
            this.broadcast({
                sourceAgentId: this.agentId,
                type: 'DANGER',
                payload,
                timestamp: Date.now()
            });
        });
        this.unsubs.push(unsubOpportunity, unsubTrauma);
    }

    private setupIncoming() {
        this.channel.onmessage = (event: MessageEvent) => {
            if (this.closed) return;
            const msg = this.unpackMessage(event.data);
            if (!msg) return;

            // Ignore self
            if (msg.sourceAgentId === this.agentId) return;

            this.handleMessage(msg);
        };
    }

    private handleMessage(msg: SwarmMessage) {
        const now = Date.now();
        this.touchPeer(msg.sourceAgentId, now);
        if (++this.messageCount % this.PRUNE_EVERY_MESSAGES === 0) {
            this.pruneStaleHandles(now);
        }

        if (msg.type !== 'DISCOVERY' && !this.peers.has(msg.sourceAgentId)) {
            return;
        }

        switch (msg.type) {
            case 'DISCOVERY':
                if (!this.peers.has(msg.sourceAgentId)) {
                    this.peers.add(msg.sourceAgentId);
                    this.dirtyTracker.markDirty(msg.sourceAgentId, DirtyMask.PEER_DISCOVERY);
                    this.broadcastDiscovery();
                }
                break;

            case 'GOSSIP':
                // Received an Opportunity from another agent
                // console.log(`🐝 SWARM: Received INTEL from ${msg.sourceAgentId}`, msg.payload);
                // In V2: Validate before blindly trusting
                // Emit to local bus as an EXTERNAL signal?
                this.dirtyTracker.markDirty(msg.sourceAgentId, DirtyMask.GOSSIP);
                break;

            case 'DANGER': {
                const danger = this.parseDangerPayload(msg.payload);
                if (!danger) {
                    console.warn(`⚠️ SWARM: Invalid DANGER payload from ${msg.sourceAgentId}`);
                    break;
                }
                const lastDanger = this.dangerRateLimit.get(msg.sourceAgentId) ?? 0;
                if (now - lastDanger < this.DANGER_COOLDOWN_MS) {
                    console.warn(`⚠️ SWARM: Rate-limited DANGER from ${msg.sourceAgentId}`);
                    break;
                }
                this.dangerRateLimit.set(msg.sourceAgentId, now);
                this.dirtyTracker.markDirty(msg.sourceAgentId, DirtyMask.DANGER);
                this.bus.emitEvent({
                    type: EidolonEventType.TRAUMA,
                    timestamp: now,
                    payload: {
                        ...danger,
                        severity: Math.min(danger.severity, this.MAX_EXTERNAL_TRAUMA_SEVERITY),
                        source: `SWARM:${msg.sourceAgentId}`
                    }
                });
                break;
            }
        }
    }

    private broadcastDiscovery(): void {
        this.broadcast({
            sourceAgentId: this.agentId,
            type: 'DISCOVERY',
            payload: { status: 'ONLINE', strategy: 'CLAW_V1' },
            timestamp: Date.now()
        });
    }

    private broadcast(msg: SwarmMessage) {
        if (this.closed) return;
        const safeMessage = this.normalizeOutgoingMessage(msg);
        if (!safeMessage) return;

        const baselineBytes = this.estimateMessageBytes(safeMessage);
        const packed = this.packMessage(safeMessage);
        if (!packed) return;
        const optimizedBytes = packed instanceof Uint8Array
            ? packed.byteLength
            : this.estimateMessageBytes(packed);

        this.bandwidthBaselineBytes += baselineBytes;
        this.bandwidthOptimizedBytes += optimizedBytes;
        this.bandwidthSamples += 1;

        try {
            this.channel.postMessage(packed);
        } catch (error) {
            if (!this.closed) {
                console.warn('⚠️ SWARM: Broadcast failed', error);
            }
        }
    }

    public close() {
        if (this.closed) return;
        this.closed = true;

        for (const unsub of this.unsubs) {
            try {
                unsub();
            } catch {
                // no-op
            }
        }
        this.unsubs = [];

        this.channel.onmessage = null;
        this.channel.close();

        this.peers.clear();
        this.peerHandles.clear();
        this.dangerRateLimit.clear();
        this.bufferPool.length = 0;
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

    private pruneStaleHandles(nowMs: number): void {
        for (const [peerId, handle] of this.peerHandles.entries()) {
            if (nowMs - handle.lastSeenAt <= this.STALE_PEER_TTL_MS) continue;
            this.peerHandles.delete(peerId);
            this.peers.delete(peerId);
            this.dirtyTracker.clear(peerId);
            this.dangerRateLimit.delete(peerId);
        }
    }

    private estimateMessageBytes(msg: unknown): number {
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

    private normalizeTimestamp(ts: unknown): number {
        if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < 0) {
            return Date.now();
        }
        const floored = Math.floor(ts);
        return Math.min(floored, Number.MAX_SAFE_INTEGER);
    }

    private isValidType(type: unknown): type is SwarmMessage['type'] {
        return type === 'DISCOVERY' || type === 'GOSSIP' || type === 'DANGER';
    }

    private normalizeOutgoingMessage(msg: SwarmMessage): SwarmMessage | null {
        const sourceAgentId = typeof msg.sourceAgentId === 'string' && msg.sourceAgentId.length > 0
            ? msg.sourceAgentId.slice(0, this.MAX_SOURCE_LEN)
            : this.agentId;
        if (!this.isValidType(msg.type)) return null;
        const timestamp = this.normalizeTimestamp(msg.timestamp);
        if (!this.warnedInsecureMode && !this.authEnabled) {
            this.warnedInsecureMode = true;
            console.warn('⚠️ SWARM: EIDOLON_SWARM_SECRET missing. Messages are unauthenticated.');
        }
        return {
            sourceAgentId,
            type: msg.type,
            payload: msg.payload,
            timestamp
        };
    }

    private canonicalizeForAuth(type: SwarmMessage['type'], sourceAgentId: string, timestamp: number, payload: unknown): string {
        return `${type}\n${sourceAgentId}\n${timestamp}\n${JSON.stringify(payload)}`;
    }

    private createSignature(type: SwarmMessage['type'], sourceAgentId: string, timestamp: number, payload: unknown): string | null {
        if (!this.authEnabled) return null;
        try {
            const canonical = this.canonicalizeForAuth(type, sourceAgentId, timestamp, payload);
            return createHmac('sha256', this.swarmSecret).update(canonical).digest('hex');
        } catch {
            return null;
        }
    }

    private signaturesMatch(expected: string, actual: string): boolean {
        if (expected.length !== actual.length) return false;
        if (!/^[0-9a-f]+$/i.test(expected) || !/^[0-9a-f]+$/i.test(actual)) return false;
        try {
            return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
        } catch {
            return false;
        }
    }

    private buildWirePayload(msg: SwarmMessage): unknown | null {
        if (!this.authEnabled) {
            return msg.payload;
        }
        const sig = this.createSignature(msg.type, msg.sourceAgentId, msg.timestamp, msg.payload);
        if (sig) {
            return { __eidolonSig: sig, data: msg.payload } satisfies SwarmWireEnvelope;
        }
        return null;
    }

    private unwrapWirePayload(type: SwarmMessage['type'], sourceAgentId: string, timestamp: number, rawPayload: unknown): unknown | undefined {
        if (!this.authEnabled) {
            if (rawPayload && typeof rawPayload === 'object' && 'data' in (rawPayload as Record<string, unknown>)) {
                const env = rawPayload as SwarmWireEnvelope;
                if ('__eidolonSig' in env || '__eidolonToken' in env) {
                    return env.data;
                }
            }
            return rawPayload;
        }

        if (!rawPayload || typeof rawPayload !== 'object' || !('data' in (rawPayload as Record<string, unknown>))) {
            return undefined;
        }

        const env = rawPayload as SwarmWireEnvelope;
        const data = env.data;
        if (typeof env.__eidolonSig === 'string') {
            const expected = this.createSignature(type, sourceAgentId, timestamp, data);
            if (!expected) return undefined;
            return this.signaturesMatch(expected, env.__eidolonSig) ? data : undefined;
        }

        if (this.allowTokenFallback && typeof env.__eidolonToken === 'string') {
            return env.__eidolonToken === this.swarmSecret ? data : undefined;
        }

        return undefined;
    }

    private parseDangerPayload(payload: unknown): SwarmDangerPayload | null {
        if (!payload || typeof payload !== 'object') return null;
        const outer = payload as Record<string, unknown>;
        const nested = (outer.payload && typeof outer.payload === 'object')
            ? outer.payload as Record<string, unknown>
            : outer;
        const severity = nested.severity;
        if (typeof severity !== 'number' || !Number.isFinite(severity) || severity < 0) {
            return null;
        }

        const normalizeText = (value: unknown): string | undefined => {
            if (typeof value !== 'string') return undefined;
            const trimmed = value.trim();
            if (!trimmed) return undefined;
            return trimmed.slice(0, 160);
        };

        return {
            severity,
            reason: normalizeText(nested.reason),
            mode: normalizeText(nested.mode),
            action: normalizeText(nested.action)
        };
    }

    private validateDecodedMessage(
        sourceAgentId: unknown,
        type: unknown,
        timestamp: unknown,
        payload: unknown
    ): SwarmMessage | null {
        if (typeof sourceAgentId !== 'string' || sourceAgentId.length === 0 || sourceAgentId.length > this.MAX_SOURCE_LEN) {
            return null;
        }
        if (!this.isValidType(type)) return null;
        const normalizedTs = this.normalizeTimestamp(timestamp);
        const unwrappedPayload = this.unwrapWirePayload(type, sourceAgentId, normalizedTs, payload);
        if (unwrappedPayload === undefined) return null;
        const payloadBytes = this.estimateMessageBytes(unwrappedPayload);
        if (payloadBytes > this.MAX_PAYLOAD_BYTES) return null;
        return {
            sourceAgentId,
            type,
            payload: unwrappedPayload,
            timestamp: normalizedTs
        };
    }

    private packMessage(msg: SwarmMessage): SwarmMessage | Uint8Array | null {
        try {
            const wirePayload = this.buildWirePayload(msg);
            if (wirePayload === null) return null;
            const sourceBytes = this.encoder.encode(msg.sourceAgentId);
            const payloadBytes = this.encoder.encode(JSON.stringify(wirePayload));
            if (sourceBytes.byteLength > this.MAX_SOURCE_LEN || payloadBytes.byteLength > this.MAX_PAYLOAD_BYTES) {
                return null;
            }
            const headerSize = 1 + 1 + 8 + 2 + 4;
            const total = headerSize + sourceBytes.byteLength + payloadBytes.byteLength;
            const buf = this.acquireBuffer(total);
            const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

            view.setUint8(0, 1); // version
            view.setUint8(1, this.encodeType(msg.type));
            const safeTs = this.normalizeTimestamp(msg.timestamp);
            view.setBigUint64(2, BigInt(safeTs), true);
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
            return null;
        }
    }

    private unpackMessage(raw: unknown): SwarmMessage | null {
        if (raw && typeof raw === 'object' && 'type' in (raw as Record<string, unknown>) && 'sourceAgentId' in (raw as Record<string, unknown>)) {
            const msg = raw as Record<string, unknown>;
            return this.validateDecodedMessage(msg.sourceAgentId, msg.type, msg.timestamp, msg.payload);
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

            const rawTimestamp = view.getBigUint64(2, true);
            const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
            const timestamp = Number(rawTimestamp > maxSafe ? maxSafe : rawTimestamp);
            const sourceLen = view.getUint16(10, true);
            const payloadLen = view.getUint32(12, true);
            const headerSize = 1 + 1 + 8 + 2 + 4;
            const total = headerSize + sourceLen + payloadLen;
            if (total > bytes.byteLength) return null;

            const sourceAgentId = this.decoder.decode(bytes.subarray(headerSize, headerSize + sourceLen));
            const payloadRaw = this.decoder.decode(bytes.subarray(headerSize + sourceLen, total));
            const payload = JSON.parse(payloadRaw);
            return this.validateDecodedMessage(sourceAgentId, type, timestamp, payload);
        } catch {
            return null;
        }
    }
}
