import { ClobClient } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function generateCredentials() {
    console.log('='.repeat(70));
    console.log('Polymarket CLOB Credentials Generator');
    console.log('='.repeat(70));

    const privateKey = process.env.PRIVATE_KEY;
    
    if (!privateKey || privateKey === 'your_private_key_here') {
        console.log('\nError: No private key found.');
        console.log('Add PRIVATE_KEY to .env:');
        console.log('   PRIVATE_KEY=0xYourPrivateKeyHere');
        console.log('Private key location:');
        console.log('   - MetaMask: Account Details > Export Private Key');
        console.log('   - Hardware Wallet: Cannot export (use browser connection)');
        console.log('   - Magic/Email Wallet: https://reveal.magic.link/polymarket');
        process.exit(1);
    }

    console.log('\nStep 1: Creating wallet...');
    const wallet = new Wallet(privateKey);
    console.log(`Wallet: ${wallet.address}`);

    console.log('\nStep 2: Connecting to CLOB...');
    const host = 'https://clob.polymarket.com';
    const chainId = 137;

    const client = new ClobClient(host, chainId, wallet);
    console.log('Connected to CLOB API.');

    console.log('\nStep 3: Generating API credentials...');
    console.log('   (This will sign a message with your wallet)');
    
    try {
        const creds = await client.createOrDeriveApiKey();
        
        console.log('\nAPI credentials generated.');
        console.log('='.repeat(70));
        console.log('CLOB API Credentials:');
        console.log('='.repeat(70));
        console.log(`API Key:        ${creds.key}`);
        console.log(`API Secret:     ${creds.secret}`);
        console.log(`API Passphrase: ${creds.passphrase}`);
        console.log('='.repeat(70));

        const credsFile = path.join(__dirname, '..', '.credentials.json');
        const credsData = {
            address: wallet.address,
            apiKey: creds.key,
            secret: creds.secret,
            passphrase: creds.passphrase,
            generatedAt: new Date().toISOString()
        };
        
        fs.writeFileSync(credsFile, JSON.stringify(credsData, null, 2));
        console.log('Credentials saved to .credentials.json');

        console.log('\nStep 4: Testing credentials...');

        const authClient = new ClobClient(host, chainId, wallet, creds);

        const serverTime = await authClient.getServerTime();
        console.log(`Auth OK. Server time: ${new Date(serverTime).toISOString()}`);

        console.log('\n' + '='.repeat(70));
        console.log('Usage:');
        console.log('='.repeat(70));
        console.log('\n1. Using Environment Variables (Recommended):');
        console.log('   Add these to your .env file:');
        console.log(`   CLOB_API_KEY=${creds.key}`);
        console.log(`   CLOB_SECRET=${creds.secret}`);
        console.log(`   CLOB_PASS_PHRASE=${creds.passphrase}`);
        
        console.log('\n2. Using in Code:');
        console.log('   ```typescript');
        console.log('   const wallet = new Wallet(privateKey);');
        console.log('   const client = new ClobClient(host, chainId, wallet);');
        console.log('   const creds = await client.createOrDeriveApiKey();');
        console.log('   // Create authenticated client');
        console.log('   const authClient = new ClobClient(host, chainId, wallet, creds);');
        console.log('   // Now you can make authenticated requests');
        console.log('   ```');
        
        console.log('\n3. Notes:');
        console.log('   Keep credentials secret; they control the wallet.');
        console.log('   .credentials.json is in .gitignore.');
        console.log('   Credentials are deterministic per wallet; re-run to derive same keys.');
        
        console.log('\n' + '='.repeat(70));
        console.log('Done. Credentials are ready.');
        console.log('='.repeat(70));
        
    } catch (error: any) {
        console.error('\nError generating credentials:', error.message);
        console.log('Common issues:');
        console.log('   - Make sure your private key is correct');
        console.log('   - Check your internet connection');
        console.log('   - Ensure the wallet has been used on Polymarket before');
        process.exit(1);
    }
}

async function checkExistingCredentials() {
    const credsFile = path.join(__dirname, '..', '.credentials.json');
    
    if (fs.existsSync(credsFile)) {
        console.log('\nExisting credentials file:');
        const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
        console.log(`   Address: ${creds.address}`);
        console.log(`   API Key: ${creds.apiKey.substring(0, 20)}...`);
        console.log(`   Generated: ${new Date(creds.generatedAt).toLocaleString()}`);
        return true;
    }
    return false;
}

if (require.main === module) {
    (async () => {
        try {
            await checkExistingCredentials();
            await generateCredentials();
        } catch (error) {
            console.error('Fatal error:', error);
            process.exit(1);
        }
    })();
}

export { generateCredentials };

