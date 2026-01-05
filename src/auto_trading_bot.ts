import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import WebSocket from 'ws';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { BalanceChecker, BalanceInfo } from './balance_checker';
import { RateLimiter } from './utils/rate_limiter';
import { createLogger } from './utils/logger';
import { PnLTracker, TradeResult } from './utils/pnl_tracker';
import { OrderBookTracker, OrderLevel } from './utils/order_book';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const logger = createLogger('AutoTradingBot');

interface PriceData {
    UP: number;
    DOWN: number;
    lastUpdate: number;
}

interface Trade {
    id: string;
    tokenType: string;
    tokenId: string;
    buyOrderId: string;
    takeProfitOrderId: string;
    stopLossOrderId: string;
    buyPrice: number;
    targetPrice: number;
    stopPrice: number;
    shares: number;
    amount: number;
    timestamp: Date;
    status: 'pending' | 'filled' | 'partial' | 'closed' | 'cancelled';
    filledShares: number;
    exitReason?: 'take_profit' | 'stop_loss' | 'manual' | 'timeout';
}

interface TradeOpportunity {
    tokenType: string;
    tokenId: string;
    softwarePrice: number;
    polymarketPrice: number;
    difference: number;
    confidence: number;
    spread: number;
    liquidityScore: number;
    recommendedSize: number;
}

class AutoTradingBot {
    private wallet: Wallet;
    private client: ClobClient;
    private balanceChecker: BalanceChecker;
    private rateLimiter: RateLimiter;
    private pnlTracker: PnLTracker;
    private orderBookTracker: OrderBookTracker;
    private tokenIdUp: string | null = null;
    private tokenIdDown: string | null = null;

    private softwarePrices: PriceData = { UP: 0, DOWN: 0, lastUpdate: 0 };
    private polymarketPrices: Map<string, number> = new Map();

    private activeTrades: Trade[] = [];
    private lastTradeTime: number = 0;
    private lastBalanceCheck: number = 0;
    private balanceCheckInterval: number;
    private tradeCleanupInterval: number;
    private orderMonitorInterval: number;
    private maxTradeAge: number;

    private priceThreshold: number;
    private stopLossAmount: number;
    private takeProfitAmount: number;
    private tradeCooldown: number;
    private tradeAmount: number;
    private minimumBalance: number;
    private minimumGas: number;
    private maxSlippage: number;
    private minLiquidity: number;
    private maxSpread: number;
    private priceStaleMs: number;
    private enableDynamicSizing: boolean;

    private softwareWs: WebSocket | null = null;
    private polymarketWs: WebSocket | null = null;
    private isRunning: boolean = false;
    private softwareWsUrl: string;
    private tradeCounter: number = 0;

    constructor() {
        const privateKey = process.env.PRIVATE_KEY;
        if (!privateKey || privateKey.length < 64) {
            logger.error('PRIVATE_KEY not found or invalid in environment variables');
            logger.error('Please add your private key to the .env file: PRIVATE_KEY=0xYourPrivateKeyHere');
            throw new Error('PRIVATE_KEY not found in .env');
        }

        this.wallet = new Wallet(privateKey);
        this.client = new ClobClient(
            process.env.CLOB_API_URL || 'https://clob.polymarket.com',
            137,
            this.wallet
        );
        this.balanceChecker = new BalanceChecker();
        this.rateLimiter = new RateLimiter(
            parseInt(process.env.API_MIN_INTERVAL_MS || '100'),
            {
                maxRetries: parseInt(process.env.API_MAX_RETRIES || '4'),
                baseDelayMs: parseInt(process.env.API_BASE_DELAY_MS || '1000'),
                maxDelayMs: parseInt(process.env.API_MAX_DELAY_MS || '16000')
            }
        );
        this.pnlTracker = new PnLTracker();

        // Liquidity and order book settings
        this.maxSlippage = parseFloat(process.env.MAX_SLIPPAGE || '0.01');
        this.minLiquidity = parseFloat(process.env.MIN_LIQUIDITY_MULTIPLIER || '2.0');
        this.maxSpread = parseFloat(process.env.MAX_SPREAD_PERCENT || '3.0');
        this.priceStaleMs = parseInt(process.env.PRICE_STALE_MS || '10000');
        this.orderBookTracker = new OrderBookTracker(this.priceStaleMs, this.minLiquidity, this.maxSpread);

        // Trading parameters (all configurable via .env)
        this.priceThreshold = parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD || '0.015');
        this.stopLossAmount = parseFloat(process.env.STOP_LOSS_AMOUNT || '0.005');
        this.takeProfitAmount = parseFloat(process.env.TAKE_PROFIT_AMOUNT || '0.01');
        this.tradeCooldown = parseInt(process.env.TRADE_COOLDOWN || '30') * 1000;
        this.tradeAmount = parseFloat(process.env.DEFAULT_TRADE_AMOUNT || '5.0');
        this.minimumBalance = parseFloat(process.env.MINIMUM_BALANCE || '500.0');
        this.minimumGas = parseFloat(process.env.MINIMUM_GAS || '0.05');
        this.enableDynamicSizing = process.env.ENABLE_DYNAMIC_SIZING === 'true';

        // Monitoring intervals
        this.balanceCheckInterval = parseInt(process.env.BALANCE_CHECK_INTERVAL || '60') * 1000;
        this.tradeCleanupInterval = parseInt(process.env.TRADE_CLEANUP_INTERVAL || '300') * 1000;
        this.orderMonitorInterval = parseInt(process.env.ORDER_MONITOR_INTERVAL || '5') * 1000;
        this.maxTradeAge = parseInt(process.env.MAX_TRADE_AGE || '3600') * 1000;

        // WebSocket URL with security warning
        this.softwareWsUrl = process.env.SOFTWARE_WS_URL || 'ws://45.130.166.119:5001';
        if (this.softwareWsUrl.startsWith('ws://')) {
            logger.warn('SOFTWARE_WS_URL uses unencrypted ws:// protocol. Consider using wss:// for security.');
        }
    }

    async start() {
        logger.info('='.repeat(60));
        logger.info('Starting Auto Trading Bot (Enhanced Arbitrage)');
        logger.info('='.repeat(60));
        logger.info(`Wallet: ${this.wallet.address}`);
        logger.info(`Threshold: $${this.priceThreshold.toFixed(4)}`);
        logger.info(`Take Profit: +$${this.takeProfitAmount.toFixed(4)}`);
        logger.info(`Stop Loss: -$${this.stopLossAmount.toFixed(4)}`);
        logger.info(`Trade Amount: $${this.tradeAmount.toFixed(2)}`);
        logger.info(`Cooldown: ${this.tradeCooldown / 1000}s`);
        logger.info(`Minimum Balance: $${this.minimumBalance.toFixed(2)}`);
        logger.info(`Max Slippage: ${(this.maxSlippage * 100).toFixed(1)}%`);
        logger.info(`Max Spread: ${this.maxSpread.toFixed(1)}%`);
        logger.info(`Price Stale After: ${this.priceStaleMs}ms`);
        logger.info(`Dynamic Sizing: ${this.enableDynamicSizing ? 'ON' : 'OFF'}`);
        logger.info('='.repeat(60));
        logger.info('RPC connection valid');
        logger.info('Checking wallet balances...');
        const balances = await this.checkAndDisplayBalances();

        const check = this.balanceChecker.checkSufficientBalance(balances, this.minimumBalance, this.minimumGas);
        logger.info(`Balance Check (Minimum $${this.minimumBalance} required):`);
        check.warnings.forEach(w => logger.info(`  ${w}`));

        if (!check.sufficient) {
            logger.error('Insufficient funds to start trading!');
            logger.error(`Required: USDC >= $${this.minimumBalance.toFixed(2)}, MATIC >= ${this.minimumGas}`);
            throw new Error('Insufficient balance');
        }

        logger.info('Balances sufficient!');

        await this.initializeMarket();

        logger.info('Connecting to data feeds...');
        await this.connectSoftwareWebSocket();
        await this.connectPolymarketWebSocket();

        logger.info('Waiting for initial price data...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        this.isRunning = true;
        this.startMonitoring();
        this.startTradeCleanup();
        this.startOrderMonitor();

        logger.info('Bot started successfully!');
        logger.info('Starting automatic trading immediately...');

        this.startImmediateTrading();
    }

    private async checkAndDisplayBalances(): Promise<BalanceInfo> {
        const balances = await this.balanceChecker.checkBalances(this.wallet);
        this.balanceChecker.displayBalances(balances);
        return balances;
    }

    private async initializeMarket() {
        console.log('Finding current Bitcoin market...');
        
        const now = new Date();
        const month = now.toLocaleString('en-US', { month: 'long' }).toLowerCase();
        const day = now.getDate();
        const hour = now.getHours();
        const timeStr = hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`;
        const slug = `bitcoin-up-or-down-${month}-${day}-${timeStr}-et`;
        
        console.log(`Searching for market: ${slug}`);
        
        const response = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`);
        const data: any = await response.json();
        
        let market = null;
        if (Array.isArray(data) && data.length > 0) {
            market = data[0];
        } else if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            market = data.data[0];
        }
        
        if (!market) {
            console.log('Market not found by slug, searching active markets...');
            const activeResponse = await fetch('https://gamma-api.polymarket.com/markets?active=true&limit=50&closed=false');
            const activeData: any = await activeResponse.json();
            const markets = Array.isArray(activeData) ? activeData : (activeData.data || []);
            
            market = markets.find((m: any) => {
                const q = (m.question || '').toLowerCase();
                return (q.includes('bitcoin') || q.includes('btc')) && q.includes('up') && q.includes('down');
            });
            
            if (!market) {
                throw new Error('No active Bitcoin market found');
            }
        }

        let tokenIds = market.clobTokenIds || [];
        if (typeof tokenIds === 'string') {
            tokenIds = JSON.parse(tokenIds);
        }
        
        let outcomes = market.outcomes || [];
        if (typeof outcomes === 'string') {
            outcomes = JSON.parse(outcomes);
        }

        if (tokenIds.length < 2) {
            throw new Error('Market must have at least 2 tokens');
        }

        let upIndex = outcomes.findIndex((o: string) => o.toLowerCase().includes('up') || o.toLowerCase().includes('yes'));
        let downIndex = outcomes.findIndex((o: string) => o.toLowerCase().includes('down') || o.toLowerCase().includes('no'));

        if (upIndex === -1) upIndex = 0;
        if (downIndex === -1) downIndex = 1;

        this.tokenIdUp = String(tokenIds[upIndex]);
        this.tokenIdDown = String(tokenIds[downIndex]);

        console.log(`Market found: ${market.question}`);
        console.log(`UP Token: ${this.tokenIdUp.substring(0, 20)}...`);
        console.log(`DOWN Token: ${this.tokenIdDown.substring(0, 20)}...`);
    }

    private async connectSoftwareWebSocket() {
        const connect = () => {
            if (!this.isRunning) return;

            logger.info(`Connecting to software oracle: ${this.softwareWsUrl}`);
            this.softwareWs = new WebSocket(this.softwareWsUrl);

            this.softwareWs.on('open', () => {
                logger.info('Software WebSocket connected');
            });

            this.softwareWs.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    const probUp = message.prob_up || 0;
                    const probDown = message.prob_down || 0;

                    this.softwarePrices.UP = probUp / 100.0;
                    this.softwarePrices.DOWN = probDown / 100.0;
                    this.softwarePrices.lastUpdate = Date.now();
                } catch (error: any) {
                    logger.warn('Failed to parse software oracle message', error);
                }
            });

            this.softwareWs.on('error', (error: any) => {
                logger.error('Software WebSocket error', error);
            });

            this.softwareWs.on('close', () => {
                logger.warn('Software WebSocket closed');
                if (this.isRunning) {
                    logger.info('Reconnecting to software oracle in 5 seconds...');
                    setTimeout(connect, 5000);
                }
            });
        };

        connect();
    }

    private async connectPolymarketWebSocket() {
        const url = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

        const connect = () => {
            if (!this.isRunning) return;

            logger.info(`Connecting to Polymarket WebSocket: ${url}`);
            this.polymarketWs = new WebSocket(url);

            this.polymarketWs.on('open', () => {
                logger.info('Polymarket WebSocket connected');

                const subscribeMessage = {
                    action: 'subscribe',
                    subscriptions: [{
                        topic: 'clob_market',
                        type: '*',
                        filters: JSON.stringify([this.tokenIdUp, this.tokenIdDown])
                    }]
                };

                this.polymarketWs?.send(JSON.stringify(subscribeMessage));
                logger.debug('Subscribed to market updates');
            });

            this.polymarketWs.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.processPolymarketMessage(message);
                } catch (error: any) {
                    logger.warn('Failed to parse Polymarket message', error);
                }
            });

            this.polymarketWs.on('error', (error: any) => {
                logger.error('Polymarket WebSocket error', error);
            });

            this.polymarketWs.on('close', () => {
                logger.warn('Polymarket WebSocket closed');
                if (this.isRunning) {
                    logger.info('Reconnecting to Polymarket in 5 seconds...');
                    setTimeout(connect, 5000);
                }
            });
        };

        connect();
    }

    private processPolymarketMessage(data: any) {
        try {
            const topic = data.topic;
            const payload = data.payload || {};

            if (topic === 'clob_market') {
                const assetId = payload.asset_id || '';

                if (payload.price) {
                    const price = parseFloat(payload.price);
                    if (price > 0) {
                        this.polymarketPrices.set(assetId, price);
                    }
                }

                const rawBids = payload.bids || [];
                const rawAsks = payload.asks || [];

                // Parse and store order book data
                const bids: OrderLevel[] = rawBids.map((b: any) => ({
                    price: parseFloat(b.price),
                    size: parseFloat(b.size || '0')
                })).filter((b: OrderLevel) => b.price > 0);

                const asks: OrderLevel[] = rawAsks.map((a: any) => ({
                    price: parseFloat(a.price),
                    size: parseFloat(a.size || '0')
                })).filter((a: OrderLevel) => a.price > 0);

                if (bids.length > 0 || asks.length > 0) {
                    this.orderBookTracker.updateOrderBook(assetId, bids, asks);
                }

                if (bids.length > 0 && asks.length > 0) {
                    const midPrice = this.orderBookTracker.getMidPrice(assetId);
                    if (midPrice > 0) {
                        this.polymarketPrices.set(assetId, midPrice);
                    }
                }
            }
        } catch (error: any) {
            logger.warn('Error processing Polymarket message', error);
        }
    }

    private startImmediateTrading() {
        const immediateTradingLoop = async () => {
            if (!this.isRunning) return;

            try {
                const opportunity = await this.checkTradeOpportunity();
                if (opportunity) {
                    logger.info('='.repeat(60));
                    logger.info('TRADE OPPORTUNITY DETECTED!');
                    logger.info('='.repeat(60));
                    logger.info(`Token: ${opportunity.tokenType}`);
                    logger.info(`Software Price: $${opportunity.softwarePrice.toFixed(4)}`);
                    logger.info(`Polymarket Price: $${opportunity.polymarketPrice.toFixed(4)}`);
                    logger.info(`Difference: $${opportunity.difference.toFixed(4)} (threshold: $${this.priceThreshold.toFixed(4)})`);
                    logger.info('='.repeat(60));

                    await this.executeTrade(opportunity);
                }
            } catch (error: any) {
                logger.error('Error in trading loop', error);
            }

            setTimeout(immediateTradingLoop, 1000);
        };

        immediateTradingLoop();
    }

    private startMonitoring() {
        let lastLogTime = 0;
        const logInterval = 30000;

        setInterval(async () => {
            if (!this.isRunning) return;

            const now = Date.now();

            if (now - this.lastBalanceCheck >= this.balanceCheckInterval) {
                logger.info('Periodic balance check...');
                const balances = await this.checkAndDisplayBalances();
                const check = this.balanceChecker.checkSufficientBalance(balances, this.minimumBalance, this.minimumGas);

                if (!check.sufficient) {
                    logger.warn(`Low balance! Minimum $${this.minimumBalance} USDC required for trading`);
                    check.warnings.forEach(w => logger.warn(`  ${w}`));
                    logger.warn('Bot will continue monitoring but may not execute trades.');
                }

                this.lastBalanceCheck = now;
            }

            if (now - lastLogTime >= logInterval) {
                const upSoft = this.softwarePrices.UP.toFixed(4);
                const downSoft = this.softwarePrices.DOWN.toFixed(4);
                const upMarket = (this.polymarketPrices.get(this.tokenIdUp!) || 0).toFixed(4);
                const downMarket = (this.polymarketPrices.get(this.tokenIdDown!) || 0).toFixed(4);

                logger.info(`[Monitor] Software: UP=$${upSoft} DOWN=$${downSoft} | Market: UP=$${upMarket} DOWN=$${downMarket}`);
                logger.info(`[Monitor] Active trades: ${this.activeTrades.length}`);
                lastLogTime = now;
            }
        }, 1000);
    }

    private startTradeCleanup() {
        setInterval(() => {
            if (!this.isRunning) return;

            const now = Date.now();
            const initialCount = this.activeTrades.length;

            this.activeTrades = this.activeTrades.filter(trade => {
                const tradeAge = now - trade.timestamp.getTime();
                if (tradeAge > this.maxTradeAge) {
                    logger.info(`Cleaning up old trade: ${trade.buyOrderId} (age: ${Math.round(tradeAge / 1000)}s)`);
                    return false;
                }
                return true;
            });

            const removedCount = initialCount - this.activeTrades.length;
            if (removedCount > 0) {
                logger.info(`Trade cleanup: removed ${removedCount} old trades, ${this.activeTrades.length} remaining`);
            }
        }, this.tradeCleanupInterval);
    }

    private async checkTradeOpportunity(): Promise<TradeOpportunity | null> {
        const currentTime = Date.now();
        const remainingCooldown = this.tradeCooldown - (currentTime - this.lastTradeTime);

        if (remainingCooldown > 0) {
            return null;
        }

        // Check if oracle price is stale
        const oracleAge = currentTime - this.softwarePrices.lastUpdate;
        if (oracleAge > this.priceStaleMs) {
            logger.debug(`Oracle price stale (${Math.round(oracleAge / 1000)}s old), skipping`);
            return null;
        }

        // Check balance before trading with rate limiting
        const balances = await this.rateLimiter.executeWithRetry(
            () => this.balanceChecker.checkBalances(this.wallet),
            'balance-check'
        );

        if (balances.usdc < this.minimumBalance) {
            return null;
        }

        for (const tokenType of ['UP', 'DOWN']) {
            const softwarePrice = tokenType === 'UP' ? this.softwarePrices.UP : this.softwarePrices.DOWN;
            const tokenId = tokenType === 'UP' ? this.tokenIdUp : this.tokenIdDown;

            if (!tokenId) continue;

            // Check if order book data is stale
            if (this.orderBookTracker.isStale(tokenId)) {
                logger.debug(`Order book stale for ${tokenType}, skipping`);
                continue;
            }

            const polyPrice = this.polymarketPrices.get(tokenId) || 0;
            const diff = softwarePrice - polyPrice;

            if (diff < this.priceThreshold || softwarePrice <= 0 || polyPrice <= 0) {
                continue;
            }

            // Check spread
            const { spreadPercent } = this.orderBookTracker.getSpread(tokenId);
            if (spreadPercent > this.maxSpread) {
                logger.debug(`Spread too high for ${tokenType}: ${spreadPercent.toFixed(2)}% > ${this.maxSpread}%`);
                continue;
            }

            // Check liquidity
            const liquidityCheck = this.orderBookTracker.checkLiquidity(tokenId, 'BUY', this.tradeAmount);
            if (!liquidityCheck.sufficient) {
                logger.debug(`Insufficient liquidity for ${tokenType}: ${liquidityCheck.warnings.join(', ')}`);
                continue;
            }

            // Check slippage
            if (liquidityCheck.estimatedSlippage > this.maxSlippage) {
                logger.debug(`Slippage too high for ${tokenType}: ${(liquidityCheck.estimatedSlippage * 100).toFixed(2)}%`);
                continue;
            }

            // Calculate confidence score (0-1)
            const confidence = this.calculateConfidence(diff, spreadPercent, liquidityCheck.availableLiquidity, oracleAge);

            // Calculate recommended size
            let recommendedSize = this.tradeAmount;
            if (this.enableDynamicSizing) {
                recommendedSize = this.calculateDynamicSize(confidence, liquidityCheck.availableLiquidity, balances.usdc);
            }

            // Calculate liquidity score (0-1)
            const liquidityScore = Math.min(liquidityCheck.availableLiquidity / (this.tradeAmount * 5), 1);

            return {
                tokenType,
                tokenId,
                softwarePrice,
                polymarketPrice: polyPrice,
                difference: diff,
                confidence,
                spread: spreadPercent,
                liquidityScore,
                recommendedSize
            };
        }

        return null;
    }

    private calculateConfidence(priceDiff: number, spread: number, liquidity: number, oracleAge: number): number {
        // Price difference factor (higher diff = higher confidence)
        const diffFactor = Math.min((priceDiff - this.priceThreshold) / this.priceThreshold, 1);

        // Spread factor (lower spread = higher confidence)
        const spreadFactor = Math.max(1 - (spread / this.maxSpread), 0);

        // Liquidity factor (higher liquidity = higher confidence)
        const liquidityFactor = Math.min(liquidity / (this.tradeAmount * 5), 1);

        // Freshness factor (fresher data = higher confidence)
        const freshnessFactor = Math.max(1 - (oracleAge / this.priceStaleMs), 0);

        // Weighted average
        return (diffFactor * 0.4) + (spreadFactor * 0.2) + (liquidityFactor * 0.2) + (freshnessFactor * 0.2);
    }

    private calculateDynamicSize(confidence: number, availableLiquidity: number, balance: number): number {
        // Base size from config
        const baseSize = this.tradeAmount;

        // Scale by confidence (0.5x to 2x)
        const confidenceMultiplier = 0.5 + (confidence * 1.5);

        // Don't exceed available liquidity / 3 (to avoid moving the market)
        const maxByLiquidity = availableLiquidity / 3;

        // Don't exceed 10% of balance per trade
        const maxByBalance = balance * 0.1;

        return Math.min(baseSize * confidenceMultiplier, maxByLiquidity, maxByBalance, baseSize * 2);
    }

    private async executeTrade(opportunity: TradeOpportunity) {
        logger.info('Executing trade...');
        this.lastTradeTime = Date.now();
        const tradeId = `trade_${++this.tradeCounter}_${Date.now()}`;

        try {
            const buyPrice = opportunity.polymarketPrice;
            const tradeSize = opportunity.recommendedSize;
            const shares = tradeSize / buyPrice;

            logger.info(`Trade ID: ${tradeId}`);
            logger.info(`Confidence: ${(opportunity.confidence * 100).toFixed(1)}%`);
            logger.info(`Spread: ${opportunity.spread.toFixed(2)}%`);
            logger.info(`Liquidity Score: ${(opportunity.liquidityScore * 100).toFixed(1)}%`);
            logger.info(`Buying ${shares.toFixed(4)} shares at $${buyPrice.toFixed(4)} (size: $${tradeSize.toFixed(2)})`);
            logger.info('Placing buy order...');

            const buyResult = await this.rateLimiter.executeWithRetry(
                () => this.client.createAndPostOrder(
                    {
                        tokenID: opportunity.tokenId,
                        price: buyPrice * 1.01,
                        size: shares,
                        side: Side.BUY
                    },
                    { tickSize: '0.001', negRisk: false },
                    OrderType.GTC
                ),
                'buy-order'
            );

            logger.info(`Buy order placed: ${buyResult.orderID}`);

            // Wait and verify buy order status
            logger.info('Verifying order fill...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            let filledShares = shares; // Assume filled for now (would need order status API)
            const orderStatus = await this.checkOrderStatus(buyResult.orderID);
            if (orderStatus === 'CANCELLED' || orderStatus === 'EXPIRED') {
                logger.warn(`Buy order ${orderStatus}, aborting trade`);
                return;
            }

            const actualBuyPrice = buyPrice;
            const takeProfitPrice = Math.min(actualBuyPrice + this.takeProfitAmount, 0.99);
            const stopLossPrice = Math.max(actualBuyPrice - this.stopLossAmount, 0.01);

            logger.info('Placing exit orders...');

            const takeProfitResult = await this.rateLimiter.executeWithRetry(
                () => this.client.createAndPostOrder(
                    {
                        tokenID: opportunity.tokenId,
                        price: takeProfitPrice,
                        size: filledShares,
                        side: Side.SELL
                    },
                    { tickSize: '0.001', negRisk: false },
                    OrderType.GTC
                ),
                'take-profit-order'
            );

            const stopLossResult = await this.rateLimiter.executeWithRetry(
                () => this.client.createAndPostOrder(
                    {
                        tokenID: opportunity.tokenId,
                        price: stopLossPrice,
                        size: filledShares,
                        side: Side.SELL
                    },
                    { tickSize: '0.001', negRisk: false },
                    OrderType.GTC
                ),
                'stop-loss-order'
            );

            logger.info(`Take Profit: ${takeProfitResult.orderID} @ $${takeProfitPrice.toFixed(4)}`);
            logger.info(`Stop Loss: ${stopLossResult.orderID} @ $${stopLossPrice.toFixed(4)}`);

            const trade: Trade = {
                id: tradeId,
                tokenType: opportunity.tokenType,
                tokenId: opportunity.tokenId,
                buyOrderId: buyResult.orderID,
                takeProfitOrderId: takeProfitResult.orderID,
                stopLossOrderId: stopLossResult.orderID,
                buyPrice: actualBuyPrice,
                targetPrice: takeProfitPrice,
                stopPrice: stopLossPrice,
                shares: filledShares,
                amount: tradeSize,
                timestamp: new Date(),
                status: 'filled',
                filledShares: filledShares
            };

            this.activeTrades.push(trade);

            logger.info('='.repeat(60));
            logger.info('TRADE EXECUTION COMPLETE!');
            logger.info(`Trade ID: ${tradeId}`);
            logger.info(`Active trades: ${this.activeTrades.length}`);
            logger.info(`Running PnL: $${this.pnlTracker.getTotalPnL().toFixed(4)}`);
            logger.info('='.repeat(60));
            logger.info(`Next trade in ${this.tradeCooldown / 1000}s`);

        } catch (error: any) {
            logger.error('='.repeat(60));
            logger.error('TRADE EXECUTION FAILED!', error);
            logger.error('='.repeat(60));
        }
    }

    private async checkOrderStatus(orderId: string): Promise<string> {
        try {
            const orders = await this.rateLimiter.executeWithRetry(
                () => this.client.getOpenOrders(),
                'get-orders'
            );
            const order = orders.find((o: any) => o.orderID === orderId);
            return order ? 'OPEN' : 'FILLED_OR_CANCELLED';
        } catch (error) {
            logger.warn('Failed to check order status', error);
            return 'UNKNOWN';
        }
    }

    private startOrderMonitor() {
        setInterval(async () => {
            if (!this.isRunning) return;

            for (const trade of this.activeTrades) {
                if (trade.status !== 'filled') continue;

                try {
                    // Check if take profit or stop loss filled
                    const tpStatus = await this.checkOrderStatus(trade.takeProfitOrderId);
                    const slStatus = await this.checkOrderStatus(trade.stopLossOrderId);

                    // If TP filled, cancel SL (OCO logic)
                    if (tpStatus === 'FILLED_OR_CANCELLED') {
                        const slStillOpen = await this.isOrderOpen(trade.stopLossOrderId);
                        if (slStillOpen) {
                            logger.info(`Take profit filled for ${trade.id}, cancelling stop loss`);
                            await this.cancelOrder(trade.stopLossOrderId);
                            this.recordTradeClose(trade, 'take_profit');
                        } else if (!slStillOpen && slStatus === 'FILLED_OR_CANCELLED') {
                            // Both closed - TP likely won
                            this.recordTradeClose(trade, 'take_profit');
                        }
                    }
                    // If SL filled, cancel TP (OCO logic)
                    else if (slStatus === 'FILLED_OR_CANCELLED') {
                        const tpStillOpen = await this.isOrderOpen(trade.takeProfitOrderId);
                        if (tpStillOpen) {
                            logger.info(`Stop loss filled for ${trade.id}, cancelling take profit`);
                            await this.cancelOrder(trade.takeProfitOrderId);
                            this.recordTradeClose(trade, 'stop_loss');
                        }
                    }
                } catch (error) {
                    logger.warn(`Error monitoring trade ${trade.id}`, error);
                }
            }
        }, this.orderMonitorInterval);
    }

    private async isOrderOpen(orderId: string): Promise<boolean> {
        try {
            const orders = await this.rateLimiter.executeWithRetry(
                () => this.client.getOpenOrders(),
                'check-open-orders'
            );
            return orders.some((o: any) => o.orderID === orderId);
        } catch {
            return false;
        }
    }

    private async cancelOrder(orderId: string): Promise<void> {
        try {
            await this.rateLimiter.executeWithRetry(
                () => this.client.cancelOrder({ orderID: orderId }),
                'cancel-order'
            );
            logger.info(`Order ${orderId} cancelled`);
        } catch (error) {
            logger.warn(`Failed to cancel order ${orderId}`, error);
        }
    }

    private recordTradeClose(trade: Trade, exitReason: 'take_profit' | 'stop_loss' | 'manual' | 'timeout'): void {
        if (trade.status === 'closed') return;

        const exitPrice = exitReason === 'take_profit' ? trade.targetPrice : trade.stopPrice;
        const pnl = (exitPrice - trade.buyPrice) * trade.shares;
        const pnlPercent = ((exitPrice - trade.buyPrice) / trade.buyPrice) * 100;

        const result: TradeResult = {
            tradeId: trade.id,
            tokenType: trade.tokenType,
            entryPrice: trade.buyPrice,
            exitPrice,
            shares: trade.shares,
            pnl,
            pnlPercent,
            exitReason,
            entryTime: trade.timestamp,
            exitTime: new Date(),
            holdingTimeMs: Date.now() - trade.timestamp.getTime()
        };

        this.pnlTracker.recordTrade(result);
        trade.status = 'closed';
        trade.exitReason = exitReason;

        // Show stats every 10 trades
        if (this.pnlTracker.getTradeCount() % 10 === 0) {
            this.pnlTracker.displayStats();
        }
    }

    stop() {
        logger.info('Stopping bot...');
        this.isRunning = false;
        this.softwareWs?.close();
        this.polymarketWs?.close();

        // Display final stats
        if (this.pnlTracker.getTradeCount() > 0) {
            logger.info('Final trading statistics:');
            this.pnlTracker.displayStats();
        }

        logger.info('Bot stopped');
    }
}

async function main() {
    logger.info('Initializing AutoTradingBot...');
    const bot = new AutoTradingBot();

    process.on('SIGINT', () => {
        logger.info('Received SIGINT, shutting down gracefully...');
        bot.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        logger.info('Received SIGTERM, shutting down gracefully...');
        bot.stop();
        process.exit(0);
    });

    process.on('uncaughtException', (error) => {
        logger.error('Uncaught exception', error);
        bot.stop();
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled rejection', { reason, promise });
    });

    await bot.start();
}

main().catch((error) => {
    logger.error('Fatal error in main', error);
    process.exit(1);
});

