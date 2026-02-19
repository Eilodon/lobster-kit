export enum DirtyMask {
    NONE = 0,
    PEER_DISCOVERY = 1 << 0,
    GOSSIP = 1 << 1,
    DANGER = 1 << 2
}

/**
 * Standardized component-level dirtiness mask for swarm sync hot paths.
 * Legacy DirtyMask bits are preserved for backward compatibility.
 */
export enum DirtyComponentMask {
    NONE = DirtyMask.NONE,
    PEER_TOPOLOGY = DirtyMask.PEER_DISCOVERY,
    GOSSIP_STATE = DirtyMask.GOSSIP,
    RISK_ALERT = DirtyMask.DANGER,
    MARKET_STATE = 1 << 3,
    POSITION_STATE = 1 << 4,
    MEMORY_STATE = 1 << 5
}

export class DirtyTracker {
    private readonly dirty = new Map<string, number>();

    markDirty(peerId: string, mask: DirtyMask): void {
        const current = this.dirty.get(peerId) ?? DirtyMask.NONE;
        this.dirty.set(peerId, current | mask);
    }

    markComponentDirty(peerId: string, mask: DirtyComponentMask): void {
        const current = this.dirty.get(peerId) ?? DirtyMask.NONE;
        this.dirty.set(peerId, current | mask);
    }

    isDirty(peerId: string, mask?: DirtyMask): boolean {
        const value = this.dirty.get(peerId) ?? DirtyMask.NONE;
        if (mask === undefined) return value !== DirtyMask.NONE;
        return (value & mask) !== 0;
    }

    isComponentDirty(peerId: string, mask?: DirtyComponentMask): boolean {
        const value = this.dirty.get(peerId) ?? DirtyMask.NONE;
        if (mask === undefined) return value !== DirtyMask.NONE;
        return (value & mask) !== 0;
    }

    getDirtyPeers(mask?: DirtyMask | DirtyComponentMask): string[] {
        const out: string[] = [];
        for (const [peerId, value] of this.dirty.entries()) {
            if (mask === undefined) {
                if (value !== DirtyMask.NONE) out.push(peerId);
                continue;
            }
            if ((value & mask) !== 0) out.push(peerId);
        }
        return out;
    }

    getDirtyComponentPeers(mask?: DirtyComponentMask): string[] {
        return this.getDirtyPeers(mask);
    }

    clear(peerId: string): void {
        this.dirty.delete(peerId);
    }

    clearMask(peerId: string, mask: DirtyComponentMask): void {
        const current = this.dirty.get(peerId) ?? DirtyMask.NONE;
        const next = current & ~mask;
        if (next === DirtyMask.NONE) {
            this.dirty.delete(peerId);
            return;
        }
        this.dirty.set(peerId, next);
    }

    getMask(peerId: string): number {
        return this.dirty.get(peerId) ?? DirtyMask.NONE;
    }
}
