/**
 * 🧠 MEMORY HUB — The State / Persistence Interface
 *
 * Responsible for maintaining agent state: adapter registry, persistent
 * key-value store, episodic memory, etc.
 *
 * Any module that needs to *remember* or *recall* state should depend
 * on IMemoryHub, not the full IEidolon.
 */

export interface IMemoryHub {
    /**
     * Persist a value under a namespaced key.
     * Implementations may write to sqlite, filesystem, or in-memory store.
     *
     * @param key   - Namespaced key, e.g. `'eidolon:learned_weights'`.
     * @param value - Any JSON-serializable value.
     */
    remember?(key: string, value: unknown): Promise<void>;

    /**
     * Retrieve a previously persisted value.
     *
     * @param key - The same key used with `remember`.
     * @returns The stored value, or `undefined` if not found.
     */
    recall?(key: string): Promise<unknown>;

    /**
     * Optional: delete a stored value.
     */
    forget?(key: string): Promise<void>;
}
