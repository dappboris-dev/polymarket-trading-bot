# Polymarket Trading Bot

TypeScript trading client for Polymarket: credential management, order execution, market data, and automated arbitrage.

## Features

- **Credential management**: Private key handling and CLOB API authentication
- **Allowance control**: USDC token allowance checks and updates
- **Market data**: Bid/ask and order book data
- **Order execution**: Market and limit orders, cancel, status
- **Market discovery**: Current Bitcoin UP/DOWN market lookup
- **Automated bot**: Arbitrage-style execution with configurable risk parameters

![Screenshot](./run.png)

![Screenshot](./tx.png)

## Modes

### Interactive CLI

Menu-driven: credentials, balances, allowance, find market, price data, place/cancel orders.

### Automated bot

Runs without interaction: subscribes to oracle and CLOB feeds, places trades when spread exceeds threshold, attaches take-profit and stop-loss orders.

## Installation

```bash
npm install
```

Create and edit `.env` with your keys and settings.

## Configuration

`.env`:

```env
PRIVATE_KEY=your_private_key_here
CLOB_API_URL=https://clob.polymarket.com
POLYGON_CHAIN_ID=137

SOFTWARE_WS_URL=ws://45.130.166.119:5001
PRICE_DIFFERENCE_THRESHOLD=0.015
STOP_LOSS_AMOUNT=0.005
TAKE_PROFIT_AMOUNT=0.01
DEFAULT_TRADE_AMOUNT=5.0
TRADE_COOLDOWN=30
```

## Usage

### Generate CLOB credentials (first run)

```bash
npm run gen-creds
```

### Run automated bot

```bash
npm run auto-trade
```

### Run interactive CLI

```bash
npm run dev
```

### Other scripts

```bash
npm run credentials   # Show credential info
npm run allowance     # Check/set allowance
npm run market        # Find current Bitcoin market
npm run bid-ask <token_id>
npm run order         # Order CLI
```

### Build

```bash
npm run build
npm start
```

## Project layout

```
src/
  main.ts              Interactive CLI
  auto_trading_bot.ts  Automated arbitrage bot
  _gen_credential.ts   Credential helpers
  allowance.ts         Allowance management
  bid_asker.ts         Bid/ask and order book
  market_order.ts      Order execution
  market_finder.ts     Market discovery
  generate_credentials.ts  Credential generation
  balance_checker.ts   USDC/MATIC balance checks
  check_balance.ts     Balance check script
```

## Bot logic

1. Subscribes to software oracle and Polymarket CLOB prices.
2. When oracle vs market spread exceeds `PRICE_DIFFERENCE_THRESHOLD`, places a market buy.
3. Submits take-profit and stop-loss limit sells.
4. Enforces minimum balance and cooldown between trades.

| Variable | Default | Meaning |
|----------|---------|---------|
| PRICE_DIFFERENCE_THRESHOLD | 0.015 | Min spread to trade |
| TAKE_PROFIT_AMOUNT | 0.01 | Profit target above fill |
| STOP_LOSS_AMOUNT | 0.005 | Max loss below fill |
| DEFAULT_TRADE_AMOUNT | 5.0 | USDC per trade |
| TRADE_COOLDOWN | 30 | Seconds between trades |

## Security

- Do not commit `.env` or `.credentials.json`.
- Keep private key and API credentials confidential.
- Test with small size first.

## Dependencies

- `@polymarket/clob-client` — Polymarket CLOB client
- `ethers` — Wallet and signing
- `axios` — HTTP
- `dotenv` — Env loading

## License

ISC

## References

- [Polymarket Docs](https://docs.polymarket.com)
- [CLOB API](https://docs.polymarket.com/#clob-api)

---

Disclaimer: Use at your own risk. No warranty. Test with small amounts first.
