/**
 * Bitcoin Price Oracle
 * Fetches real-time BTC prices and calculates up/down probabilities
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('BitcoinOracle');

export interface PricePoint {
    price: number;
    timestamp: number;
    source: string;
}

export interface OracleData {
    currentPrice: number;
    priceChange1m: number;
    priceChange5m: number;
    priceChange15m: number;
    momentum: number;
    volatility: number;
    probUp: number;
    probDown: number;
    confidence: number;
    timestamp: number;
    sources: string[];
}

interface ExchangeConfig {
    name: string;
    url: string;
    parser: (data: any) => number;
}

export class BitcoinOracle {
    private priceHistory: PricePoint[] = [];
    private maxHistorySize: number = 1000; // ~16 minutes at 1s intervals
    private currentPrice: number = 0;
    private updateInterval: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;

    // Configurable parameters
    private momentumWindow: number;
    private volatilityWindow: number;
    private updateFrequencyMs: number;
    private minConfidence: number;

    // Exchange configurations
    private exchanges: ExchangeConfig[] = [
        {
            name: 'binance',
            url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
            parser: (data) => parseFloat(data.price)
        },
        {
            name: 'coinbase',
            url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
            parser: (data) => parseFloat(data.data.amount)
        },
        {
            name: 'kraken',
            url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
            parser: (data) => parseFloat(data.result.XXBTZUSD.c[0])
        }
    ];

    private activeSources: Set<string> = new Set();

    constructor(config: {
        momentumWindow?: number;
        volatilityWindow?: number;
        updateFrequencyMs?: number;
        minConfidence?: number;
    } = {}) {
        this.momentumWindow = config.momentumWindow || 60; // 60 seconds
        this.volatilityWindow = config.volatilityWindow || 300; // 5 minutes
        this.updateFrequencyMs = config.updateFrequencyMs || 1000; // 1 second
        this.minConfidence = config.minConfidence || 0.3;
    }

    async start(): Promise<void> {
        if (this.isRunning) return;

        logger.info('Starting Bitcoin Oracle...');
        logger.info(`Momentum window: ${this.momentumWindow}s`);
        logger.info(`Volatility window: ${this.volatilityWindow}s`);
        logger.info(`Update frequency: ${this.updateFrequencyMs}ms`);

        this.isRunning = true;

        // Initial fetch
        await this.fetchPrices();

        // Start periodic updates
        this.updateInterval = setInterval(async () => {
            await this.fetchPrices();
        }, this.updateFrequencyMs);

        logger.info('Bitcoin Oracle started');
    }

    stop(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.isRunning = false;
        logger.info('Bitcoin Oracle stopped');
    }

    private async fetchPrices(): Promise<void> {
        const prices: PricePoint[] = [];
        const timestamp = Date.now();

        // Fetch from all exchanges in parallel
        const results = await Promise.allSettled(
            this.exchanges.map(async (exchange) => {
                try {
                    const response = await fetch(exchange.url, {
                        headers: { 'User-Agent': 'PolymarketBot/1.0' }
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const data = await response.json();
                    const price = exchange.parser(data);

                    if (price > 0) {
                        this.activeSources.add(exchange.name);
                        return { price, source: exchange.name };
                    }
                    throw new Error('Invalid price');
                } catch (error: any) {
                    this.activeSources.delete(exchange.name);
                    logger.debug(`Failed to fetch from ${exchange.name}: ${error.message}`);
                    return null;
                }
            })
        );

        // Collect successful prices
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
                prices.push({
                    price: result.value.price,
                    timestamp,
                    source: result.value.source
                });
            }
        }

        if (prices.length === 0) {
            logger.warn('Failed to fetch price from any exchange');
            return;
        }

        // Calculate median price (more robust than average)
        const sortedPrices = prices.map(p => p.price).sort((a, b) => a - b);
        const medianPrice = sortedPrices[Math.floor(sortedPrices.length / 2)];

        this.currentPrice = medianPrice;

        // Add to history
        this.priceHistory.push({
            price: medianPrice,
            timestamp,
            source: 'median'
        });

        // Trim history
        if (this.priceHistory.length > this.maxHistorySize) {
            this.priceHistory = this.priceHistory.slice(-this.maxHistorySize);
        }
    }

    /**
     * Calculate oracle data with up/down probabilities
     */
    getOracleData(): OracleData {
        const now = Date.now();

        if (this.priceHistory.length < 2) {
            return this.getDefaultData();
        }

        const current = this.currentPrice;

        // Get prices at different time intervals
        const price1mAgo = this.getPriceAtTime(now - 60000);
        const price5mAgo = this.getPriceAtTime(now - 300000);
        const price15mAgo = this.getPriceAtTime(now - 900000);

        // Calculate price changes
        const priceChange1m = price1mAgo > 0 ? (current - price1mAgo) / price1mAgo : 0;
        const priceChange5m = price5mAgo > 0 ? (current - price5mAgo) / price5mAgo : 0;
        const priceChange15m = price15mAgo > 0 ? (current - price15mAgo) / price15mAgo : 0;

        // Calculate momentum (weighted average of price changes)
        const momentum = this.calculateMomentum();

        // Calculate volatility
        const volatility = this.calculateVolatility();

        // Calculate probabilities
        const { probUp, probDown, confidence } = this.calculateProbabilities(momentum, volatility);

        return {
            currentPrice: current,
            priceChange1m,
            priceChange5m,
            priceChange15m,
            momentum,
            volatility,
            probUp,
            probDown,
            confidence,
            timestamp: now,
            sources: Array.from(this.activeSources)
        };
    }

    private getPriceAtTime(targetTime: number): number {
        // Find the closest price to the target time
        let closest: PricePoint | null = null;
        let minDiff = Infinity;

        for (const point of this.priceHistory) {
            const diff = Math.abs(point.timestamp - targetTime);
            if (diff < minDiff) {
                minDiff = diff;
                closest = point;
            }
        }

        // Only return if within 30 seconds of target
        if (closest && minDiff < 30000) {
            return closest.price;
        }

        return 0;
    }

    private calculateMomentum(): number {
        const windowMs = this.momentumWindow * 1000;
        const now = Date.now();
        const cutoff = now - windowMs;

        const recentPrices = this.priceHistory.filter(p => p.timestamp >= cutoff);

        if (recentPrices.length < 2) return 0;

        // Linear regression to find trend
        const n = recentPrices.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

        for (let i = 0; i < n; i++) {
            const x = i;
            const y = recentPrices[i].price;
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumX2 += x * x;
        }

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const avgPrice = sumY / n;

        // Normalize slope as percentage per second
        const momentumPerSec = (slope / avgPrice) * 1000;

        // Clamp to reasonable range (-1 to 1)
        return Math.max(-1, Math.min(1, momentumPerSec * 100));
    }

    private calculateVolatility(): number {
        const windowMs = this.volatilityWindow * 1000;
        const now = Date.now();
        const cutoff = now - windowMs;

        const recentPrices = this.priceHistory.filter(p => p.timestamp >= cutoff);

        if (recentPrices.length < 2) return 0;

        // Calculate returns
        const returns: number[] = [];
        for (let i = 1; i < recentPrices.length; i++) {
            const ret = (recentPrices[i].price - recentPrices[i - 1].price) / recentPrices[i - 1].price;
            returns.push(ret);
        }

        // Standard deviation of returns
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);

        // Annualized volatility (assuming 1-second intervals)
        return stdDev * Math.sqrt(3600) * 100; // Hourly volatility as percentage
    }

    private calculateProbabilities(momentum: number, volatility: number): {
        probUp: number;
        probDown: number;
        confidence: number;
    } {
        // Base probability from momentum
        // Momentum ranges from -1 to 1, we map to probability
        const momentumFactor = (momentum + 1) / 2; // 0 to 1

        // Volatility reduces confidence
        // Higher volatility = probabilities closer to 50%
        const volatilityFactor = Math.max(0, 1 - (volatility / 10)); // Dampen towards 0.5 as vol increases

        // Calculate probabilities
        let probUp = 0.5 + (momentumFactor - 0.5) * volatilityFactor;

        // Apply slight mean reversion at extremes
        if (probUp > 0.8) probUp = 0.8 + (probUp - 0.8) * 0.5;
        if (probUp < 0.2) probUp = 0.2 - (0.2 - probUp) * 0.5;

        // Clamp to valid range
        probUp = Math.max(0.05, Math.min(0.95, probUp));
        const probDown = 1 - probUp;

        // Confidence based on data quality and volatility
        const dataPoints = this.priceHistory.length;
        const dataConfidence = Math.min(dataPoints / 60, 1); // Full confidence after 60 points
        const sourceConfidence = Math.min(this.activeSources.size / 2, 1); // Full confidence with 2+ sources
        const volatilityConfidence = Math.max(0.3, 1 - volatility / 20);

        const confidence = dataConfidence * sourceConfidence * volatilityConfidence;

        return { probUp, probDown, confidence };
    }

    private getDefaultData(): OracleData {
        return {
            currentPrice: this.currentPrice,
            priceChange1m: 0,
            priceChange5m: 0,
            priceChange15m: 0,
            momentum: 0,
            volatility: 0,
            probUp: 0.5,
            probDown: 0.5,
            confidence: 0,
            timestamp: Date.now(),
            sources: []
        };
    }

    getCurrentPrice(): number {
        return this.currentPrice;
    }

    getHistoryLength(): number {
        return this.priceHistory.length;
    }

    isHealthy(): boolean {
        return this.isRunning &&
               this.activeSources.size > 0 &&
               this.priceHistory.length > 10 &&
               Date.now() - this.priceHistory[this.priceHistory.length - 1]?.timestamp < 5000;
    }
}
