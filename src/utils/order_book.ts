/**
 * Order book tracking with liquidity analysis
 */

import { createLogger } from './logger';

const logger = createLogger('OrderBook');

export interface OrderLevel {
    price: number;
    size: number;
}

export interface OrderBookData {
    tokenId: string;
    bids: OrderLevel[];
    asks: OrderLevel[];
    lastUpdate: number;
    midPrice: number;
    spread: number;
    spreadPercent: number;
}

export interface LiquidityCheck {
    sufficient: boolean;
    availableLiquidity: number;
    requiredLiquidity: number;
    estimatedSlippage: number;
    effectivePrice: number;
    warnings: string[];
}

export class OrderBookTracker {
    private orderBooks: Map<string, OrderBookData> = new Map();
    private maxStaleMs: number;
    private minLiquidityMultiplier: number;
    private maxSpreadPercent: number;

    constructor(
        maxStaleMs: number = 10000,
        minLiquidityMultiplier: number = 2.0,
        maxSpreadPercent: number = 5.0
    ) {
        this.maxStaleMs = maxStaleMs;
        this.minLiquidityMultiplier = minLiquidityMultiplier;
        this.maxSpreadPercent = maxSpreadPercent;
    }

    updateOrderBook(tokenId: string, bids: OrderLevel[], asks: OrderLevel[]): void {
        const bestBid = bids.length > 0 ? bids[0].price : 0;
        const bestAsk = asks.length > 0 ? asks[0].price : 0;
        const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
        const spread = bestAsk - bestBid;
        const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

        this.orderBooks.set(tokenId, {
            tokenId,
            bids,
            asks,
            lastUpdate: Date.now(),
            midPrice,
            spread,
            spreadPercent
        });
    }

    getOrderBook(tokenId: string): OrderBookData | null {
        return this.orderBooks.get(tokenId) || null;
    }

    getMidPrice(tokenId: string): number {
        const book = this.orderBooks.get(tokenId);
        return book?.midPrice || 0;
    }

    getSpread(tokenId: string): { spread: number; spreadPercent: number } {
        const book = this.orderBooks.get(tokenId);
        return {
            spread: book?.spread || 0,
            spreadPercent: book?.spreadPercent || 0
        };
    }

    isStale(tokenId: string): boolean {
        const book = this.orderBooks.get(tokenId);
        if (!book) return true;
        return Date.now() - book.lastUpdate > this.maxStaleMs;
    }

    getLastUpdateAge(tokenId: string): number {
        const book = this.orderBooks.get(tokenId);
        if (!book) return Infinity;
        return Date.now() - book.lastUpdate;
    }

    /**
     * Check if there's sufficient liquidity for a trade
     */
    checkLiquidity(tokenId: string, side: 'BUY' | 'SELL', amount: number): LiquidityCheck {
        const book = this.orderBooks.get(tokenId);
        const warnings: string[] = [];

        if (!book) {
            return {
                sufficient: false,
                availableLiquidity: 0,
                requiredLiquidity: amount,
                estimatedSlippage: 1,
                effectivePrice: 0,
                warnings: ['No order book data available']
            };
        }

        // Check staleness
        if (this.isStale(tokenId)) {
            warnings.push(`Order book data is stale (${Math.round(this.getLastUpdateAge(tokenId) / 1000)}s old)`);
        }

        // Check spread
        if (book.spreadPercent > this.maxSpreadPercent) {
            warnings.push(`High spread: ${book.spreadPercent.toFixed(2)}% (max: ${this.maxSpreadPercent}%)`);
        }

        const levels = side === 'BUY' ? book.asks : book.bids;

        if (levels.length === 0) {
            return {
                sufficient: false,
                availableLiquidity: 0,
                requiredLiquidity: amount,
                estimatedSlippage: 1,
                effectivePrice: 0,
                warnings: [...warnings, `No ${side === 'BUY' ? 'asks' : 'bids'} available`]
            };
        }

        // Calculate available liquidity and effective price
        let totalLiquidity = 0;
        let weightedPriceSum = 0;
        let remainingAmount = amount;

        for (const level of levels) {
            const levelValue = level.price * level.size;
            totalLiquidity += levelValue;

            if (remainingAmount > 0) {
                const fillAmount = Math.min(remainingAmount, levelValue);
                weightedPriceSum += level.price * fillAmount;
                remainingAmount -= fillAmount;
            }
        }

        const effectivePrice = amount > 0 ? weightedPriceSum / (amount - Math.max(0, remainingAmount)) : levels[0].price;
        const bestPrice = levels[0].price;
        const estimatedSlippage = bestPrice > 0 ? Math.abs(effectivePrice - bestPrice) / bestPrice : 0;

        // Check if liquidity is sufficient
        const requiredLiquidity = amount * this.minLiquidityMultiplier;
        const sufficient = totalLiquidity >= requiredLiquidity && remainingAmount <= 0;

        if (!sufficient) {
            if (totalLiquidity < requiredLiquidity) {
                warnings.push(`Low liquidity: $${totalLiquidity.toFixed(2)} available, need $${requiredLiquidity.toFixed(2)}`);
            }
            if (remainingAmount > 0) {
                warnings.push(`Cannot fill order: $${remainingAmount.toFixed(2)} would remain unfilled`);
            }
        }

        if (estimatedSlippage > 0.01) {
            warnings.push(`High estimated slippage: ${(estimatedSlippage * 100).toFixed(2)}%`);
        }

        return {
            sufficient,
            availableLiquidity: totalLiquidity,
            requiredLiquidity,
            estimatedSlippage,
            effectivePrice,
            warnings
        };
    }

    /**
     * Calculate optimal trade size based on liquidity
     */
    calculateOptimalSize(tokenId: string, side: 'BUY' | 'SELL', maxAmount: number, maxSlippage: number = 0.01): number {
        const book = this.orderBooks.get(tokenId);
        if (!book) return 0;

        const levels = side === 'BUY' ? book.asks : book.bids;
        if (levels.length === 0) return 0;

        const bestPrice = levels[0].price;
        let optimalAmount = 0;
        let weightedPriceSum = 0;

        for (const level of levels) {
            const levelValue = level.price * level.size;
            const newAmount = optimalAmount + levelValue;
            const newWeightedSum = weightedPriceSum + level.price * levelValue;
            const newEffectivePrice = newWeightedSum / newAmount;
            const slippage = Math.abs(newEffectivePrice - bestPrice) / bestPrice;

            if (slippage > maxSlippage || newAmount > maxAmount) {
                break;
            }

            optimalAmount = newAmount;
            weightedPriceSum = newWeightedSum;
        }

        return Math.min(optimalAmount, maxAmount);
    }
}
