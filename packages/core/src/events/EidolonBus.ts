import { EventEmitter } from 'events';
import { ActionType, DecisionLog } from '../types/EidolonTypes';
import { EventRingBuffer } from './EventRingBuffer';

/**
 * ⚡ EIDOLON NERVOUS SYSTEM
 * Central Event Bus for Reactive Architecture
 */

export enum EidolonEventType {
    BLOCK_MINED = 'BLOCK_MINED',
    PRICE_UPDATE = 'PRICE_UPDATE',
    OPPORTUNITY = 'OPPORTUNITY',   // Emitter: MarketStream
    TRAUMA = 'TRAUMA',
    TRADE_EXECUTED = 'TRADE_EXECUTED',
    WHALE_MOVEMENT = 'WHALE_MOVEMENT'
}

export interface EidolonEvent {
    type: EidolonEventType;
    timestamp: number;
    payload: unknown;
}

export interface BlockEvent extends EidolonEvent {
    type: EidolonEventType.BLOCK_MINED;
    payload: {
        blockNumber: bigint;
        hash: string;
        timestamp: bigint;
    };
}

export interface PriceEvent extends EidolonEvent {
    type: EidolonEventType.PRICE_UPDATE;
    payload: {
        symbol: string;
        price: number;
        change24h?: number;
        source: 'PYTH' | 'DEX' | 'BINANCE_WS';
    };
}

export interface TraumaEvent extends EidolonEvent {
    type: EidolonEventType.TRAUMA;
    payload: {
        reason: string;
        severity: number; // 0-100
        lossAmount?: number;
    };
}

export interface TradeExecutionOutcome {
    decisionId: number;
    profitLoss: number;
    capitalAtRisk: number;
    slippage: number;
    gasUsed: number;
    success: boolean;
}

export interface TradeExecutedEvent extends EidolonEvent {
    type: EidolonEventType.TRADE_EXECUTED;
    payload: {
        action: ActionType;
        decisionLog?: DecisionLog;
        txHash?: string;
        executionError?: string;
        outcome: TradeExecutionOutcome;
    };
}

export interface WhaleEvent extends EidolonEvent {
    type: EidolonEventType.WHALE_MOVEMENT;
    payload: {
        symbol: string;
        action: 'BUY' | 'SELL';
        amountUSD: number;
        price: number;
        txId?: number;
    };
}

export class EidolonBus extends EventEmitter {
    private static instance: EidolonBus;
    private readonly ring: EventRingBuffer<EidolonEvent>;
    private droppedEvents = 0;
    private isDraining = false;
    private pendingQueue: EidolonEvent[] = [];

    private constructor(config: { maxListeners?: number } = {}) {
        super();
        this.setMaxListeners(config.maxListeners || 50); // Default bumped to 50
        this.ring = new EventRingBuffer<EidolonEvent>(1024, () => ({
            type: EidolonEventType.BLOCK_MINED,
            timestamp: 0,
            payload: undefined
        }));
    }

    public static getInstance(config?: { maxListeners?: number }): EidolonBus {
        if (!EidolonBus.instance) {
            EidolonBus.instance = new EidolonBus(config);
        } else if (config) {
            // FIX: warn instead of silently ignoring config on subsequent calls
            console.warn('⚠️ [EidolonBus] getInstance() called with config but instance already exists. Config ignored — configure at bootstrap only.');
        }
        return EidolonBus.instance;
    }

    public emitEvent(event: EidolonEvent): void {
        // 🛡️ RE-ENTRANCY GUARD
        if (this.isDraining) {
            this.pendingQueue.push(event);
            return;
        }

        // Push to history ring (for KPI tracking only, not for drain)
        if (!this.ring.push(event)) {
            this.droppedEvents++;
        }

        this.isDraining = true;

        try {
            // Process current event
            this.processEvent(event);

            // Process any events triggered recursively
            while (this.pendingQueue.length > 0) {
                const next = this.pendingQueue.shift();
                if (next) {
                    if (!this.ring.push(next)) this.droppedEvents++;
                    this.processEvent(next);
                }
            }
        } finally {
            this.isDraining = false;
        }
    }

    private processEvent(event: EidolonEvent) {
        if (event.type === EidolonEventType.TRAUMA || event.type === EidolonEventType.OPPORTUNITY) {
            console.log(`⚡ EVENT [${event.type}]:`, event.payload);
        }
        this.emit(event.type, event);
    }

    public subscribe(type: EidolonEventType, callback: (event: EidolonEvent) => void): () => void {
        this.on(type, callback);
        return () => this.off(type, callback);
    }

    /**
     * Typed variant of `emitEvent` — accepts any event that extends `EidolonEvent`.
     * Domain-specific events can define their own payload shapes and use this
     * overload for full end-to-end type safety.
     *
     * @example
     * bus.emitTyped<MyCustomEvent>({ type: 'MY_EVENT', timestamp: Date.now(), payload: { value: 42 } });
     */
    public emitTyped<T extends EidolonEvent>(event: T): void {
        this.emitEvent(event);
    }

    /**
     * Typed variant of `subscribe` — callback receives the exact `T` event shape.
     *
     * @example
     * const unsub = bus.subscribeTyped<PriceEvent>(EidolonEventType.PRICE_UPDATE, (e) => {
     *     console.log(e.payload.symbol, e.payload.price);
     * });
     */
    public subscribeTyped<T extends EidolonEvent>(
        type: T['type'],
        callback: (event: T) => void
    ): () => void {
        const handler = (event: EidolonEvent) => callback(event as T);
        this.on(type, handler);
        return () => this.off(type, handler);
    }

    public getDroppedEvents(): number {
        return this.droppedEvents + this.ring.getOverflowCount();
    }
}
