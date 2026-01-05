/**
 * PnL (Profit and Loss) Tracker for trading statistics
 */

import { createLogger } from './logger';

const logger = createLogger('PnLTracker');

export interface TradeResult {
    tradeId: string;
    tokenType: string;
    entryPrice: number;
    exitPrice: number;
    shares: number;
    pnl: number;
    pnlPercent: number;
    exitReason: 'take_profit' | 'stop_loss' | 'manual' | 'timeout';
    entryTime: Date;
    exitTime: Date;
    holdingTimeMs: number;
}

export interface TradingStats {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnL: number;
    averagePnL: number;
    averageWin: number;
    averageLoss: number;
    profitFactor: number;
    maxDrawdown: number;
    bestTrade: number;
    worstTrade: number;
    averageHoldingTimeMs: number;
}

export class PnLTracker {
    private trades: TradeResult[] = [];
    private runningPnL: number = 0;
    private peakPnL: number = 0;
    private maxDrawdown: number = 0;

    recordTrade(result: TradeResult): void {
        this.trades.push(result);
        this.runningPnL += result.pnl;

        // Track peak and drawdown
        if (this.runningPnL > this.peakPnL) {
            this.peakPnL = this.runningPnL;
        }
        const currentDrawdown = this.peakPnL - this.runningPnL;
        if (currentDrawdown > this.maxDrawdown) {
            this.maxDrawdown = currentDrawdown;
        }

        logger.info(`Trade recorded: ${result.exitReason} | PnL: $${result.pnl.toFixed(4)} (${result.pnlPercent.toFixed(2)}%)`);
        logger.info(`Running PnL: $${this.runningPnL.toFixed(4)} | Max Drawdown: $${this.maxDrawdown.toFixed(4)}`);
    }

    getStats(): TradingStats {
        if (this.trades.length === 0) {
            return {
                totalTrades: 0,
                winningTrades: 0,
                losingTrades: 0,
                winRate: 0,
                totalPnL: 0,
                averagePnL: 0,
                averageWin: 0,
                averageLoss: 0,
                profitFactor: 0,
                maxDrawdown: 0,
                bestTrade: 0,
                worstTrade: 0,
                averageHoldingTimeMs: 0
            };
        }

        const winningTrades = this.trades.filter(t => t.pnl > 0);
        const losingTrades = this.trades.filter(t => t.pnl <= 0);

        const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
        const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

        const pnls = this.trades.map(t => t.pnl);
        const holdingTimes = this.trades.map(t => t.holdingTimeMs);

        return {
            totalTrades: this.trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate: (winningTrades.length / this.trades.length) * 100,
            totalPnL: this.runningPnL,
            averagePnL: this.runningPnL / this.trades.length,
            averageWin: winningTrades.length > 0 ? totalWins / winningTrades.length : 0,
            averageLoss: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
            profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
            maxDrawdown: this.maxDrawdown,
            bestTrade: Math.max(...pnls),
            worstTrade: Math.min(...pnls),
            averageHoldingTimeMs: holdingTimes.reduce((a, b) => a + b, 0) / holdingTimes.length
        };
    }

    displayStats(): void {
        const stats = this.getStats();

        logger.info('='.repeat(60));
        logger.info('TRADING STATISTICS');
        logger.info('='.repeat(60));
        logger.info(`Total Trades: ${stats.totalTrades}`);
        logger.info(`Win Rate: ${stats.winRate.toFixed(1)}% (${stats.winningTrades}W / ${stats.losingTrades}L)`);
        logger.info(`Total PnL: $${stats.totalPnL.toFixed(4)}`);
        logger.info(`Average PnL: $${stats.averagePnL.toFixed(4)}`);
        logger.info(`Average Win: $${stats.averageWin.toFixed(4)}`);
        logger.info(`Average Loss: $${stats.averageLoss.toFixed(4)}`);
        logger.info(`Profit Factor: ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}`);
        logger.info(`Max Drawdown: $${stats.maxDrawdown.toFixed(4)}`);
        logger.info(`Best Trade: $${stats.bestTrade.toFixed(4)}`);
        logger.info(`Worst Trade: $${stats.worstTrade.toFixed(4)}`);
        logger.info(`Avg Holding Time: ${(stats.averageHoldingTimeMs / 1000).toFixed(1)}s`);
        logger.info('='.repeat(60));
    }

    getRecentTrades(count: number = 10): TradeResult[] {
        return this.trades.slice(-count);
    }

    getTotalPnL(): number {
        return this.runningPnL;
    }

    getTradeCount(): number {
        return this.trades.length;
    }
}
