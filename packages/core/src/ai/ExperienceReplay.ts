
import { MarketState, ActionType } from '../types/EidolonTypes';
import { TradeOutcome } from '../ActiveLearning';

/**
 * 🌠 THE DREAMING ENGINE: Experience Replay Buffer
 * 
 * Stores past trading experiences (State, Action, Reward, NextState)
 * to allow off-policy learning (Dreaming) during low-volatility periods.
 * 
 * Reduces correlation between consecutive learning steps and improves
 * data efficiency.
 */

export interface TrainingExample {
    state: MarketState;
    action: ActionType;
    reward: number;
    nextState?: MarketState;
    outcome: TradeOutcome;
    timestamp: number;
}

export class ExperienceReplay {
    private buffer: TrainingExample[] = [];
    private readonly capacity: number;
    private writePtr = 0;

    constructor(capacity: number = 1000) {
        this.capacity = capacity;
        // Pre-allocate array to avoid resize overhead (though in JS it's dynamic, 
        // filling it with nulls or just letting it grow to cap is fine. 
        // We'll just push until full then overwrite).
    }

    /**
     * Add a new experience to the memory.
     * Overwrites oldest if full.
     */
    public add(example: TrainingExample): void {
        if (this.buffer.length < this.capacity) {
            this.buffer.push(example);
        } else {
            this.buffer[this.writePtr] = example;
            this.writePtr = (this.writePtr + 1) % this.capacity;
        }
    }

    /**
     * Sample a random batch of experiences for training.
     * @param size Batch size
     */
    public sample(size: number): TrainingExample[] {
        if (this.buffer.length === 0) return [];

        // If we request more than we have, return all shuffled
        const count = Math.min(size, this.buffer.length);
        const batch: TrainingExample[] = [];
        const indices = new Set<number>();

        while (indices.size < count) {
            const idx = Math.floor(Math.random() * this.buffer.length);
            if (!indices.has(idx)) {
                indices.add(idx);
                batch.push(this.buffer[idx]);
            }
        }

        return batch;
    }

    /**
     * Get current size of buffer
     */
    public size(): number {
        return this.buffer.length;
    }

    /**
     * Clear all memories
     */
    public clear(): void {
        this.buffer = [];
        this.writePtr = 0;
    }

    /**
     * Export memory for persistence
     */
    public export(): string {
        return JSON.stringify(this.buffer);
    }

    public import(data: string): void {
        try {
            const loaded = JSON.parse(data);
            if (Array.isArray(loaded)) {
                this.buffer = loaded.slice(0, this.capacity);
                this.writePtr = 0; // Reset ptr to 0, effective overwrite strategy involves simple circular
            }
        } catch (e) {
            console.error('Failed to import replay buffer', e);
        }
    }
}
