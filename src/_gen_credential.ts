import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

export class CredentialGenerator {
    private wallet: ethers.Wallet;
    private chainId: number;

    constructor(privateKey?: string, chainId: number = 137) {
        const key = privateKey || process.env.PRIVATE_KEY;
        
        if (!key) {
            throw new Error('Private key not provided');
        }

        this.wallet = new ethers.Wallet(key);
        this.chainId = chainId;
    }

    getAddress(): string {
        return this.wallet.address;
    }

    getPrivateKey(): string {
        return this.wallet.privateKey;
    }

    async signMessage(message: string): Promise<string> {
        return await this.wallet.signMessage(message);
    }

    async generateApiCredentials(): Promise<{
        address: string;
        privateKey: string;
        chainId: number;
    }> {
        return {
            address: this.wallet.address,
            privateKey: this.wallet.privateKey,
            chainId: this.chainId
        };
    }

    async createApiKey(nonce: string): Promise<string> {
        const message = `Sign this message to authenticate with Polymarket CLOB API.\n\nNonce: ${nonce}`;
        return await this.signMessage(message);
    }

    displayInfo(): void {
        console.log('='.repeat(50));
        console.log('Polymarket Credentials');
        console.log('='.repeat(50));
        console.log(`Address: ${this.wallet.address}`);
        console.log(`Chain ID: ${this.chainId}`);
        console.log(`Private Key: ${'*'.repeat(60)} (hidden)`);
        console.log('='.repeat(50));
    }
}

if (require.main === module) {
    try {
        const generator = new CredentialGenerator();
        generator.displayInfo();
        
        console.log('\nCredentials loaded.');
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

