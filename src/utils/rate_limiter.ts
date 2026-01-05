/**
 * Rate limiter with exponential backoff for API calls
 */

export interface RateLimiterConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
    maxRetries: 4,
    baseDelayMs: 1000,
    maxDelayMs: 16000
};

export class RateLimiter {
    private config: RateLimiterConfig;
    private lastCallTime: Map<string, number> = new Map();
    private minIntervalMs: number;

    constructor(minIntervalMs: number = 100, config: Partial<RateLimiterConfig> = {}) {
        this.minIntervalMs = minIntervalMs;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Wait for rate limit before making a call
     */
    async waitForSlot(key: string = 'default'): Promise<void> {
        const now = Date.now();
        const lastCall = this.lastCallTime.get(key) || 0;
        const elapsed = now - lastCall;

        if (elapsed < this.minIntervalMs) {
            await this.sleep(this.minIntervalMs - elapsed);
        }

        this.lastCallTime.set(key, Date.now());
    }

    /**
     * Execute a function with exponential backoff retry
     */
    async executeWithRetry<T>(
        fn: () => Promise<T>,
        operationName: string = 'API call'
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            try {
                await this.waitForSlot(operationName);
                return await fn();
            } catch (error: any) {
                lastError = error;

                const isRateLimit = error.message?.includes('429') ||
                                   error.message?.includes('rate limit') ||
                                   error.message?.includes('too many requests');

                if (attempt < this.config.maxRetries) {
                    const delay = Math.min(
                        this.config.baseDelayMs * Math.pow(2, attempt),
                        this.config.maxDelayMs
                    );

                    console.warn(
                        `[RateLimiter] ${operationName} failed (attempt ${attempt + 1}/${this.config.maxRetries + 1}): ${error.message}`
                    );
                    console.warn(`[RateLimiter] Retrying in ${delay}ms...`);

                    await this.sleep(delay);
                } else if (isRateLimit) {
                    console.error(`[RateLimiter] ${operationName} rate limited after ${this.config.maxRetries + 1} attempts`);
                }
            }
        }

        throw lastError || new Error(`${operationName} failed after ${this.config.maxRetries + 1} attempts`);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const defaultRateLimiter = new RateLimiter(100);
