/**
 * 🛡️ RESILIENCE UTILITY
 * "The Immune System"
 * 
 * Provides robust retry mechanisms for external API calls.
 * Prevents the agent from dying due to transient network failures.
 */

export interface RetryConfig {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    jitter: boolean;
}

const DEFAULT_CONFIG: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 10000, // 10 seconds
    jitter: true
};

/**
 * Wait for a specified duration
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Execute a function with exponential backoff retry.
 * @param fn The async function to execute
 * @param config Optional configuration override
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    config: Partial<RetryConfig> = {}
): Promise<T> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    let lastError: any;

    for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            // Don't retry if it's a critical error (optional logic can be added here)
            // For now, we retry on everything.

            if (attempt === finalConfig.maxAttempts) {
                console.error(`❌ Retry limit reached (${attempt}/${finalConfig.maxAttempts}). Fail.`);
                break;
            }

            // Calculate delay with exponential backoff
            let delay = Math.min(
                finalConfig.maxDelay,
                finalConfig.baseDelay * Math.pow(2, attempt - 1)
            );

            // Add jitter to prevent thundering herd
            if (finalConfig.jitter) {
                delay = delay * (0.8 + Math.random() * 0.4); // +/- 20%
            }

            console.warn(`⚠️ Attempt ${attempt} failed. Retrying in ${Math.round(delay)}ms... (Error: ${error.message})`);
            await sleep(delay);
        }
    }

    throw lastError;
}
