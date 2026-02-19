export interface DomainActionContext {
    actor?: string;
    traceId?: string;
    requestedAt?: number;
    metadata?: Record<string, unknown>;
}

export interface DomainActionDescriptor {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
}

export interface DomainAdapterMetadata {
    id: string;
    domain: string;
    version: string;
    description?: string;
    priority?: number;
    tags?: string[];
}

export interface IDomainAdapter {
    readonly metadata: DomainAdapterMetadata;
    listActions(): DomainActionDescriptor[];
    supports(action: string): boolean;
    execute<T = unknown>(
        action: string,
        params: Record<string, unknown>,
        context?: DomainActionContext
    ): Promise<T>;
}

export interface DomainAdapterRegistrationOptions {
    override?: boolean;
}

export interface DomainExecutionRequest {
    action: string;
    params?: Record<string, unknown>;
    adapterId?: string;
    domain?: string;
    context?: DomainActionContext;
}

export interface DomainExecutionResult<T = unknown> {
    adapterId: string;
    domain: string;
    action: string;
    data: T;
}
