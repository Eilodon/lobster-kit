/**
 * 💾 STORAGE PROVIDER INTERFACE
 * "The Memory Cortex"
 * 
 * Abstraction layer for agent state persistence.
 * Allows switching between Local FS (Dev) and BNB Greenfield (Prod).
 */

export interface IStorageProvider {
    /**
     * Initialize the connection (if needed)
     */
    init(): Promise<void>;

    /**
     * Save data to a key
     * @param key Filename or object key (e.g., 'emotional_core.json')
     * @param data JSON serializable data
     */
    save(key: string, data: any): Promise<void>;

    /**
     * Load data from a key
     * @param key Filename or object key
     * @returns Parsed JSON data or null if not found
     */
    load<T>(key: string): Promise<T | null>;

    /**
     * List available keys
     */
    list(): Promise<string[]>;

    /**
     * Append data to a log file (Write-Ahead Log)
     * @param key Filename or object key
     * @param data JSON serializable data to append
     */
    append(key: string, data: any): Promise<void>;

    /**
     * Read all entries from a log file
     * @param key Filename or object key
     * @param limit Optional limit of recent entries to return (0 = all)
     * @param offset Optional offset to skip items (from start or end depending on impl)
     */
    readLog(key: string, limit?: number, offset?: number): Promise<any[]>;
}
