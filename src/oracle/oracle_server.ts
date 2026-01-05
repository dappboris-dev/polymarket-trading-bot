/**
 * Oracle WebSocket Server
 * Broadcasts Bitcoin probability data to connected clients
 */

import WebSocket, { WebSocketServer } from 'ws';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { BitcoinOracle, OracleData } from './bitcoin_oracle';
import { createLogger } from '../utils/logger';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const logger = createLogger('OracleServer');

interface ClientConnection {
    ws: WebSocket;
    id: string;
    connectedAt: Date;
}

export class OracleServer {
    private wss: WebSocketServer | null = null;
    private oracle: BitcoinOracle;
    private clients: Map<string, ClientConnection> = new Map();
    private broadcastInterval: NodeJS.Timeout | null = null;
    private port: number;
    private broadcastFrequencyMs: number;
    private clientIdCounter: number = 0;

    constructor(config: {
        port?: number;
        broadcastFrequencyMs?: number;
        momentumWindow?: number;
        volatilityWindow?: number;
    } = {}) {
        this.port = config.port || parseInt(process.env.ORACLE_PORT || '5001');
        this.broadcastFrequencyMs = config.broadcastFrequencyMs || 1000;

        this.oracle = new BitcoinOracle({
            momentumWindow: config.momentumWindow || 60,
            volatilityWindow: config.volatilityWindow || 300,
            updateFrequencyMs: 1000
        });
    }

    async start(): Promise<void> {
        logger.info(`Starting Oracle Server on port ${this.port}...`);

        // Start the oracle first
        await this.oracle.start();

        // Wait for initial data
        logger.info('Waiting for initial price data...');
        await this.waitForData(10000);

        // Create WebSocket server
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on('connection', (ws, req) => {
            const clientId = `client_${++this.clientIdCounter}`;
            const clientIp = req.socket.remoteAddress || 'unknown';

            logger.info(`New client connected: ${clientId} from ${clientIp}`);

            this.clients.set(clientId, {
                ws,
                id: clientId,
                connectedAt: new Date()
            });

            // Send initial data
            this.sendToClient(clientId, this.oracle.getOracleData());

            ws.on('close', () => {
                logger.info(`Client disconnected: ${clientId}`);
                this.clients.delete(clientId);
            });

            ws.on('error', (error) => {
                logger.warn(`Client error (${clientId}):`, error);
                this.clients.delete(clientId);
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleClientMessage(clientId, message);
                } catch {
                    // Ignore invalid messages
                }
            });
        });

        this.wss.on('error', (error) => {
            logger.error('WebSocket server error:', error);
        });

        // Start broadcasting
        this.broadcastInterval = setInterval(() => {
            this.broadcast();
        }, this.broadcastFrequencyMs);

        logger.info(`Oracle Server started on ws://localhost:${this.port}`);
        logger.info(`Connected exchanges: ${this.oracle.getOracleData().sources.join(', ') || 'none yet'}`);
    }

    private async waitForData(timeoutMs: number): Promise<void> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            if (this.oracle.getHistoryLength() >= 5) {
                logger.info(`Got ${this.oracle.getHistoryLength()} price points`);
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        logger.warn('Timeout waiting for initial data, starting anyway');
    }

    private handleClientMessage(clientId: string, message: any): void {
        if (message.type === 'ping') {
            this.sendToClient(clientId, { type: 'pong', timestamp: Date.now() });
        } else if (message.type === 'subscribe') {
            logger.debug(`Client ${clientId} subscribed`);
        } else if (message.type === 'get_status') {
            this.sendToClient(clientId, {
                type: 'status',
                healthy: this.oracle.isHealthy(),
                clients: this.clients.size,
                historyLength: this.oracle.getHistoryLength()
            });
        }
    }

    private sendToClient(clientId: string, data: any): void {
        const client = this.clients.get(clientId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify(data));
            } catch (error) {
                logger.warn(`Failed to send to ${clientId}:`, error);
            }
        }
    }

    private broadcast(): void {
        if (this.clients.size === 0) return;

        const oracleData = this.oracle.getOracleData();

        // Format message compatible with existing bot format
        const message = {
            type: 'oracle_update',
            prob_up: oracleData.probUp * 100,
            prob_down: oracleData.probDown * 100,
            price: oracleData.currentPrice,
            momentum: oracleData.momentum,
            volatility: oracleData.volatility,
            confidence: oracleData.confidence,
            change_1m: oracleData.priceChange1m * 100,
            change_5m: oracleData.priceChange5m * 100,
            change_15m: oracleData.priceChange15m * 100,
            sources: oracleData.sources,
            timestamp: oracleData.timestamp
        };

        const messageStr = JSON.stringify(message);

        for (const [clientId, client] of this.clients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                try {
                    client.ws.send(messageStr);
                } catch (error) {
                    logger.warn(`Failed to broadcast to ${clientId}`);
                    this.clients.delete(clientId);
                }
            } else {
                this.clients.delete(clientId);
            }
        }
    }

    stop(): void {
        logger.info('Stopping Oracle Server...');

        if (this.broadcastInterval) {
            clearInterval(this.broadcastInterval);
            this.broadcastInterval = null;
        }

        // Close all client connections
        for (const [, client] of this.clients) {
            try {
                client.ws.close(1000, 'Server shutting down');
            } catch {
                // Ignore
            }
        }
        this.clients.clear();

        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }

        this.oracle.stop();

        logger.info('Oracle Server stopped');
    }

    getStatus(): {
        running: boolean;
        healthy: boolean;
        clients: number;
        currentPrice: number;
        probUp: number;
        probDown: number;
    } {
        const data = this.oracle.getOracleData();
        return {
            running: this.wss !== null,
            healthy: this.oracle.isHealthy(),
            clients: this.clients.size,
            currentPrice: data.currentPrice,
            probUp: data.probUp,
            probDown: data.probDown
        };
    }
}

// CLI entry point
async function main() {
    const server = new OracleServer({
        port: parseInt(process.env.ORACLE_PORT || '5001'),
        broadcastFrequencyMs: parseInt(process.env.ORACLE_BROADCAST_MS || '1000'),
        momentumWindow: parseInt(process.env.ORACLE_MOMENTUM_WINDOW || '60'),
        volatilityWindow: parseInt(process.env.ORACLE_VOLATILITY_WINDOW || '300')
    });

    process.on('SIGINT', () => {
        logger.info('Received SIGINT, shutting down...');
        server.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        logger.info('Received SIGTERM, shutting down...');
        server.stop();
        process.exit(0);
    });

    await server.start();

    // Log status periodically
    setInterval(() => {
        const status = server.getStatus();
        logger.info(
            `[Status] Price: $${status.currentPrice.toFixed(2)} | ` +
            `Up: ${(status.probUp * 100).toFixed(1)}% | ` +
            `Down: ${(status.probDown * 100).toFixed(1)}% | ` +
            `Clients: ${status.clients} | ` +
            `Healthy: ${status.healthy}`
        );
    }, 30000);
}

// Run if executed directly
if (require.main === module) {
    main().catch((error) => {
        logger.error('Fatal error:', error);
        process.exit(1);
    });
}

export default OracleServer;
