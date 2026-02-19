import { EventEmitter } from 'events';
import { ActionType, DecisionLog } from '../EidolonTypes';
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
    TRADE_EXECUTED = 'TRADE_EXECUTED'
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

export class EidolonBus extends EventEmitter {
    private static instance: EidolonBus;
    private readonly ring: EventRingBuffer<EidolonEvent>;
    private droppedEvents = 0;

    private constructor() {
        super();
        this.setMaxListeners(20); // Allow multiple modules to listen
        this.ring = new EventRingBuffer<EidolonEvent>(1024, () => ({
            type: EidolonEventType.BLOCK_MINED,
            timestamp: 0,
            payload: undefined
        }));
    }

    public static getInstance(): EidolonBus {
        if (!EidolonBus.instance) {
            EidolonBus.instance = new EidolonBus();
        }
        return EidolonBus.instance;
    }

    public emitEvent(event: EidolonEvent): void {
        if (!this.ring.push(event)) {
            this.droppedEvents++;
            return;
        }
        this.ring.drain((queuedEvent) => {
            if (queuedEvent.type === EidolonEventType.TRAUMA || queuedEvent.type === EidolonEventType.OPPORTUNITY) {
                console.log(`⚡ EVENT [${queuedEvent.type}]:`, queuedEvent.payload);
            }
            this.emit(queuedEvent.type, queuedEvent);
        });
    }

    public subscribe(type: EidolonEventType, callback: (event: EidolonEvent) => void): () => void {
        this.on(type, callback);
        return () => this.off(type, callback);
    }

    public getDroppedEvents(): number {
        return this.droppedEvents + this.ring.getOverflowCount();
    }
}
