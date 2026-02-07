import { ClobClient } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import * as dotenv from 'dotenv';

dotenv.config();

export class AllowanceManager {
    private client: ClobClient;
    private wallet: Wallet;

    constructor(privateKey?: string, host?: string, chainId?: number) {
        const key = privateKey || process.env.PRIVATE_KEY;
        const apiHost = host || process.env.CLOB_API_URL || 'https://clob.polymarket.com';
        const chain = chainId || parseInt(process.env.POLYGON_CHAIN_ID || '137');

        if (!key) {
            throw new Error('Private key not provided');
        }

        this.wallet = new Wallet(key);
        this.client = new ClobClient(apiHost, chain, this.wallet);
    }

    async checkAllowance(): Promise<string> {
        try {
            console.log(`Wallet: ${this.wallet.address}`);
            console.log('Note: Allowance check requires RPC. Use Polymarket UI to check/set allowances.');
            return 'Allowance check requires RPC setup';
        } catch (error) {
            console.error('Error checking allowance:', error);
            throw error;
        }
    }

    async setAllowance(amount: string): Promise<any> {
        try {
            console.log(`Setting allowance to ${amount} USDC...`);
            console.log('Note: Allowance set requires RPC. Use Polymarket UI if needed.');
            return 'Allowance setting requires RPC setup';
        } catch (error) {
            console.error('Error setting allowance:', error);
            throw error;
        }
    }

    async approveMaxAllowance(): Promise<any> {
        return await this.setAllowance('Unlimited');
    }

    async isAllowanceSufficient(requiredAmount: number): Promise<boolean> {
        try {
            const allowance = await this.checkAllowance();
            const allowanceNum = parseFloat(allowance);
            return allowanceNum >= requiredAmount;
        } catch (error) {
            return false;
        }
    }

    async ensureAllowance(minAmount: number = 1000): Promise<void> {
        const isSufficient = await this.isAllowanceSufficient(minAmount);
        
        if (!isSufficient) {
            console.log(`Allowance insufficient. Setting to ${minAmount} USDC...`);
            await this.setAllowance(minAmount.toString());
        } else {
            console.log('Allowance sufficient.');
        }
    }
}

if (require.main === module) {
    (async () => {
        try {
            const manager = new AllowanceManager();

            await manager.checkAllowance();

        } catch (error) {
            console.error('Error:', error);
            process.exit(1);
        }
    })();
}

