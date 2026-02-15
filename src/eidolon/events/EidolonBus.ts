import { EventEmitter } from 'events';
import { MarketState } from '../EidolonTypes';

/**
 * ⚡ EIDOLON NERVOUS SYSTEM
 * Central Event Bus for Reactive Architecture
 */

export enum EidolonEventType {
    BLOCK_MINED = 'BLOCK_MINED',
    PRICE_UPDATE = 'PRICE_UPDATE',
    OPPORTUNITY = 'OPPORTUNITY',
    TRAUMA = 'TRAUMA',
    TRADE_EXECUTED = 'TRADE_EXECUTED'
}

export interface EidolonEvent {
    type: EidolonEventType;
    timestamp: number;
    payload: any;
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
        source: 'PYTH' | 'DEX';
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

export class EidolonBus extends EventEmitter {
    private static instance: EidolonBus;

    private constructor() {
        super();
        this.setMaxListeners(20); // Allow multiple modules to listen
    }

    public static getInstance(): EidolonBus {
        if (!EidolonBus.instance) {
            EidolonBus.instance = new EidolonBus();
        }
        return EidolonBus.instance;
    }

    public emitEvent(event: EidolonEvent): void {
        // Log high-priority events
        if (event.type === EidolonEventType.TRAUMA || event.type === EidolonEventType.OPPORTUNITY) {
            console.log(`⚡ EVENT [${event.type}]:`, event.payload);
        }
        this.emit(event.type, event);
    }

    public subscribe(type: EidolonEventType, callback: (event: any) => void): void {
        this.on(type, callback);
    }
}
