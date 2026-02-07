import { CredentialGenerator } from './_gen_credential';
import { AllowanceManager } from './allowance';
import { BidAsker } from './bid_asker';
import { MarketOrderExecutor } from './market_order';
import { MarketFinder } from './market_finder';
import { BalanceChecker } from './balance_checker';
import { Wallet } from '@ethersproject/wallet';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

class PolymarketBot {
    private credentials?: CredentialGenerator;
    private allowanceManager?: AllowanceManager;
    private bidAsker: BidAsker;
    private orderExecutor?: MarketOrderExecutor;
    private marketFinder: MarketFinder;
    private balanceChecker?: BalanceChecker;
    private wallet?: Wallet;
    private hasPrivateKey: boolean;

    constructor() {
        console.log('Polymarket Trading Bot\n');
        
        this.hasPrivateKey = !!process.env.PRIVATE_KEY && process.env.PRIVATE_KEY !== 'your_private_key_here';

        if (this.hasPrivateKey) {
            console.log('Private key found. Full mode.\n');
            this.wallet = new Wallet(process.env.PRIVATE_KEY!);
            this.credentials = new CredentialGenerator();
            this.allowanceManager = new AllowanceManager();
            this.bidAsker = new BidAsker();
            this.orderExecutor = new MarketOrderExecutor();
            this.balanceChecker = new BalanceChecker();
        } else {
            console.log('No private key. Read-only mode.');
            console.log('Add PRIVATE_KEY to .env to enable trading.\n');
            this.bidAsker = new BidAsker();
        }
        
        this.marketFinder = new MarketFinder();
    }

    displayMenu(): void {
        console.log('\n' + '='.repeat(60));
        console.log(`Polymarket Trading Bot - Main Menu ${this.hasPrivateKey ? '' : '(READ-ONLY)'}`);
        console.log('='.repeat(60));
        
        if (this.hasPrivateKey) {
            console.log('1. Show Credentials');
            console.log('2. Check Balances (USDC + MATIC)');
            console.log('3. Check Allowance');
            console.log('4. Set Allowance');
        }
        
        console.log('5. Find Current Bitcoin Market');
        console.log('6. Get Price Data (Bid/Ask)');
        
        if (this.hasPrivateKey) {
            console.log('7. Place Market Order');
            console.log('8. Place Limit Order');
            console.log('9. View Open Orders');
            console.log('10. Cancel Order');
        }
        
        console.log('0. Exit');
        console.log('='.repeat(60));
    }

    async handleInput(choice: string): Promise<boolean> {
        try {
            const requiresAuth = ['1', '2', '3', '4', '7', '8', '9', '10'].includes(choice);
            if (requiresAuth && !this.hasPrivateKey) {
                console.log('\nThis action requires PRIVATE_KEY in .env.\n');
                return true;
            }
            
            switch (choice) {
                case '1':
                    await this.showCredentials();
                    break;
                case '2':
                    await this.checkBalances();
                    break;
                case '3':
                    await this.checkAllowance();
                    break;
                case '4':
                    await this.setAllowance();
                    break;
                case '5':
                    await this.findMarket();
                    break;
                case '6':
                    await this.getPriceData();
                    break;
                case '7':
                    await this.placeMarketOrder();
                    break;
                case '8':
                    await this.placeLimitOrder();
                    break;
                case '9':
                    await this.viewOpenOrders();
                    break;
                case '10':
                    await this.cancelOrder();
                    break;
                case '0':
                    console.log('\nGoodbye.\n');
                    return false;
                default:
                    console.log('\nInvalid choice. Try again.\n');
            }
        } catch (error) {
            console.error('\nError:', error);
        }
        
        return true;
    }

    async showCredentials(): Promise<void> {
        this.credentials?.displayInfo();
    }

    async checkBalances(): Promise<void> {
        if (!this.wallet || !this.balanceChecker) {
            console.log('Wallet not initialized.');
            return;
        }

        console.log('\nChecking wallet balances...');
        const balances = await this.balanceChecker.checkBalances(this.wallet);
        this.balanceChecker.displayBalances(balances);
        
        const check = this.balanceChecker.checkSufficientBalance(balances, 500.0, 0.05);
        console.log('\nBalance check (trading):');
        check.warnings.forEach(w => console.log(`  ${w}`));
        
        if (!check.sufficient) {
            console.log('\nInsufficient funds for trading.');
            console.log('Please fund your wallet:');
            console.log(`  - USDC: At least $500.00`);
            console.log(`  - MATIC: At least 0.05 for gas fees`);
        }
    }

    async checkAllowance(): Promise<void> {
        await this.allowanceManager?.checkAllowance();
    }

    async setAllowance(): Promise<void> {
        const amount = await this.prompt('Enter allowance amount (USDC): ');
        await this.allowanceManager?.setAllowance(amount);
    }

    async findMarket(): Promise<void> {
        const market = await this.marketFinder.findCurrentBitcoinMarket();
        
        if (market && market.tokens.length > 0) {
            console.log('\nShow price data for this market? (y/n)');
            const answer = await this.prompt('');
            
            if (answer.toLowerCase() === 'y') {
                for (const token of market.tokens) {
                    console.log(`\nFetching ${token.outcome}...`);
                    const data = await this.bidAsker.getPriceData(token.tokenId);
                    this.bidAsker.displayPriceInfo(token.tokenId, data);
                }
            }
        }
    }

    async getPriceData(): Promise<void> {
        const tokenId = await this.prompt('Enter token ID: ');
        const data = await this.bidAsker.getPriceData(tokenId);
        this.bidAsker.displayPriceInfo(tokenId, data);
    }

    async placeMarketOrder(): Promise<void> {
        console.log('\nPlace Market Order');
        const tokenId = await this.prompt('Enter token ID: ');
        const side = await this.prompt('Enter side (BUY/SELL): ');
        const amount = await this.prompt('Enter amount (USDC): ');

        const confirm = await this.prompt(`\nConfirm ${side} ${amount} USDC of token? (yes/no): `);
        
        if (confirm.toLowerCase() === 'yes') {
            await this.orderExecutor?.placeMarketOrder({
                tokenId,
                side: side.toUpperCase() as 'BUY' | 'SELL',
                amount: parseFloat(amount)
            });
        } else {
            console.log('Order cancelled.');
        }
    }

    async placeLimitOrder(): Promise<void> {
        console.log('\nPlace Limit Order');
        const tokenId = await this.prompt('Enter token ID: ');
        const side = await this.prompt('Enter side (BUY/SELL): ');
        const price = await this.prompt('Enter price: ');
        const size = await this.prompt('Enter size (shares): ');

        const confirm = await this.prompt(`\nConfirm ${side} ${size} shares at $${price}? (yes/no): `);
        
        if (confirm.toLowerCase() === 'yes') {
            await this.orderExecutor?.placeLimitOrder(
                tokenId,
                side.toUpperCase() as 'BUY' | 'SELL',
                parseFloat(price),
                parseFloat(size)
            );
        } else {
            console.log('Order cancelled.');
        }
    }

    async viewOpenOrders(): Promise<void> {
        const orders = await this.orderExecutor?.getOpenOrders() || [];
        
        console.log('\nOpen Orders:');
        console.log('='.repeat(60));
        
        if (orders.length === 0) {
            console.log('No open orders');
        } else {
            orders.forEach((order: any, index: number) => {
                console.log(`\n${index + 1}. Order ID: ${order.orderID}`);
                console.log(`   Token: ${order.tokenID?.substring(0, 12)}...`);
                console.log(`   Side: ${order.side}`);
                console.log(`   Price: $${order.price}`);
                console.log(`   Size: ${order.size}`);
            });
        }
        
        console.log('='.repeat(60));
    }

    async cancelOrder(): Promise<void> {
        const orderId = await this.prompt('Enter order ID to cancel: ');
        
        const confirm = await this.prompt(`\nConfirm cancel order ${orderId}? (yes/no): `);
        
        if (confirm.toLowerCase() === 'yes') {
            await this.orderExecutor?.cancelOrder(orderId);
        } else {
            console.log('Cancellation aborted.');
        }
    }

    private prompt(question: string): Promise<string> {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer);
            });
        });
    }

    async run(): Promise<void> {
        let running = true;
        
        while (running) {
            this.displayMenu();
            const choice = await this.prompt('\nEnter your choice: ');
            running = await this.handleInput(choice);
        }
    }
}

if (require.main === module) {
    (async () => {
        try {
            const bot = new PolymarketBot();
            await bot.run();
        } catch (error) {
            console.error('\nFatal error:', error);
            process.exit(1);
        }
    })();
}

export default PolymarketBot;

