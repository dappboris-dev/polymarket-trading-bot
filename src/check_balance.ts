import { BalanceChecker } from './balance_checker';
import { Wallet } from '@ethersproject/wallet';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('Polymarket Balance Checker\n');

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.log('PRIVATE_KEY not set in .env');
        console.log('Add PRIVATE_KEY=0x... to .env to run balance check.\n');
        return;
    }

    try {
        const wallet = new Wallet(privateKey);
        const checker = new BalanceChecker();

        console.log('Checking balances...\n');
        const balances = await checker.checkBalances(wallet);
        
        checker.displayBalances(balances);
        
        console.log('\nTrading readiness:');
        console.log('='.repeat(60));
        
        const tradeAmount = parseFloat(process.env.DEFAULT_TRADE_AMOUNT || '500.0');
        const check = checker.checkSufficientBalance(balances, tradeAmount, 0.05);
        
        check.warnings.forEach(w => console.log(`  ${w}`));
        
        if (!check.sufficient) {
            console.log('\nInsufficient funds for trading.');
            console.log('Steps:');
            console.log('  1. Get USDC on Polygon network (Chain ID: 137)');
            console.log('     Contract: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174');
            console.log(`  2. Send at least $${tradeAmount.toFixed(2)} USDC to: ${balances.address}`);
            console.log('  3. Get some MATIC for gas (at least 0.05 MATIC)');
            console.log('  4. Run this script again to verify\n');
        } else {
            console.log('\nReady to trade.');
            console.log(`  Max trade size: $${balances.usdc.toFixed(2)}`);
            console.log(`  MATIC covers ~${Math.floor(balances.matic * 100)} txs\n`);
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

main().catch(console.error);

