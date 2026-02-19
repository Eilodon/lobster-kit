import {
    DomainActionDescriptor,
    DomainAdapterMetadata,
    DomainAdapterRegistrationOptions,
    DomainExecutionRequest,
    DomainExecutionResult,
    IDomainAdapter,
} from './types';

export class DomainAdapterRegistry {
    private readonly adaptersById = new Map<string, IDomainAdapter>();
    private readonly adaptersByDomain = new Map<string, IDomainAdapter[]>();

    public register(adapter: IDomainAdapter, options: DomainAdapterRegistrationOptions = {}): void {
        const adapterId = adapter.metadata.id;
        const existing = this.adaptersById.get(adapterId);

        if (existing && !options.override) {
            throw new Error(`Adapter "${adapterId}" already registered.`);
        }

        if (existing) {
            this.removeFromDomainIndex(existing);
        }

        this.adaptersById.set(adapterId, adapter);
        this.addToDomainIndex(adapter);
    }

    public unregister(adapterId: string): void {
        const existing = this.adaptersById.get(adapterId);
        if (!existing) return;

        this.adaptersById.delete(adapterId);
        this.removeFromDomainIndex(existing);
    }

    public has(adapterId: string): boolean {
        return this.adaptersById.has(adapterId);
    }

    public get(adapterId: string): IDomainAdapter | undefined {
        return this.adaptersById.get(adapterId);
    }

    public listAdapters(): DomainAdapterMetadata[] {
        return Array.from(this.adaptersById.values())
            .map((adapter) => adapter.metadata)
            .sort((a, b) => a.domain.localeCompare(b.domain) || a.id.localeCompare(b.id));
    }

    public listActions(domain?: string): Array<{ adapterId: string; domain: string; actions: DomainActionDescriptor[] }> {
        const adapters = domain
            ? [...(this.adaptersByDomain.get(domain) ?? [])]
            : Array.from(this.adaptersById.values());

        return adapters.map((adapter) => ({
            adapterId: adapter.metadata.id,
            domain: adapter.metadata.domain,
            actions: adapter.listActions(),
        }));
    }

    public async execute<T = unknown>(request: DomainExecutionRequest): Promise<DomainExecutionResult<T>> {
        const adapter = this.resolveAdapter(request);
        if (!adapter.supports(request.action)) {
            throw new Error(`Adapter "${adapter.metadata.id}" does not support action "${request.action}".`);
        }

        const payload = request.params ?? {};
        const data = await adapter.execute<T>(request.action, payload, request.context);

        return {
            adapterId: adapter.metadata.id,
            domain: adapter.metadata.domain,
            action: request.action,
            data,
        };
    }

    private resolveAdapter(request: DomainExecutionRequest): IDomainAdapter {
        if (request.adapterId) {
            const byId = this.adaptersById.get(request.adapterId);
            if (!byId) {
                throw new Error(`Adapter "${request.adapterId}" is not registered.`);
            }
            return byId;
        }

        if (request.domain) {
            const byDomain = this.adaptersByDomain.get(request.domain);
            if (!byDomain || byDomain.length === 0) {
                throw new Error(`No adapter registered for domain "${request.domain}".`);
            }
            const match = byDomain.find((adapter) => adapter.supports(request.action));
            if (!match) {
                throw new Error(`No adapter in domain "${request.domain}" supports action "${request.action}".`);
            }
            return match;
        }

        const match = Array.from(this.adaptersById.values()).find((adapter) => adapter.supports(request.action));
        if (!match) {
            throw new Error(`No adapter registered for action "${request.action}".`);
        }
        return match;
    }

    private addToDomainIndex(adapter: IDomainAdapter): void {
        const domain = adapter.metadata.domain;
        const list = [...(this.adaptersByDomain.get(domain) ?? []), adapter];
        list.sort((a, b) => this.priorityOf(b) - this.priorityOf(a));
        this.adaptersByDomain.set(domain, list);
    }

    private removeFromDomainIndex(adapter: IDomainAdapter): void {
        const domain = adapter.metadata.domain;
        const current = this.adaptersByDomain.get(domain) ?? [];
        const next = current.filter((entry) => entry.metadata.id !== adapter.metadata.id);
        if (next.length === 0) {
            this.adaptersByDomain.delete(domain);
            return;
        }
        this.adaptersByDomain.set(domain, next);
    }

    private priorityOf(adapter: IDomainAdapter): number {
        return adapter.metadata.priority ?? 100;
    }
}
