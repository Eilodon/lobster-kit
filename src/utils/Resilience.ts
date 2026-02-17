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
    // FIX U4: Discriminative Retry Hook
    shouldRetry?: (error: any) => boolean;
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

            // FIX L11: Don't retry client errors (4xx)
            if (error.response?.status && error.response.status >= 400 && error.response.status < 500) {
                if (error.response.status === 429) {
                    // Rate limit: Respect Retry-After or just wait
                    const retryAfter = parseInt(error.response.headers?.['retry-after'] || '5');
                    console.warn(`⏳ Rate Limited (429). Waiting ${retryAfter}s...`);
                    await sleep(retryAfter * 1000);
                    continue; // Retry after wait
                }
                throw error; // Abort on 400, 401, 403, 404
            }

            // FIX U4: Check User-defined Retry Predicate
            if (finalConfig.shouldRetry && !finalConfig.shouldRetry(error)) {
                console.warn(`🛑 Retry aborted by shouldRetry predicate.`);
                throw error;
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
