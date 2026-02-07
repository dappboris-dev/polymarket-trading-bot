# Polymarket Auto Trading Bot — Operations Guide

This document describes how the arbitrage bot works, how to run it, and how to interpret results.

## Overview

The bot trades on price differences between a software oracle (token value from market logic) and Polymarket CLOB prices. When the spread is large enough, it buys on the CLOB and attaches take-profit and stop-loss orders.

## Strategy

Polymarket runs hourly Bitcoin UP/DOWN markets. The bot compares:

1. Oracle-implied price (from the software feed)
2. CLOB bid/ask (Polymarket)

If the oracle price is higher than the market by at least the configured threshold, the bot buys and then places a take-profit sell and a stop-loss sell.

### Example

```
Oracle: UP = $0.75
Market: UP = $0.70
Spread: $0.05 (above 0.015 threshold)

Actions:
1. Market buy @ $0.70
2. Limit sell @ $0.71 (take profit)
3. Limit sell @ $0.695 (stop loss)
```

Outcomes: take profit gives about +$0.01 per share; stop loss caps loss at about -$0.005 per share.

## Requirements

- **USDC on Polygon** (Chain ID 137). Contract: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`. Recommended at least $50–100; below that, fees are proportionally large.
- **MATIC** for gas (e.g. 0.1–0.5 MATIC).
- **Wallet** with exportable private key (e.g. MetaMask: Account details → Export Private Key; Magic: https://reveal.magic.link/polymarket).

## Setup

### 1. Install

```bash
cd polymarket-trading-bot
npm install
```

### 2. Configure private key

In `.env`:

```
PRIVATE_KEY=0xYourPrivateKeyHere
```

Do not commit this file or share the key.

### 3. Generate API credentials

```bash
npm run gen-creds
```

Credentials are written to `.credentials.json`. Keep this file private.

### 4. Optional: risk parameters

In `.env`:

```
PRICE_DIFFERENCE_THRESHOLD=0.015
STOP_LOSS_AMOUNT=0.005
TAKE_PROFIT_AMOUNT=0.01
DEFAULT_TRADE_AMOUNT=5.0
TRADE_COOLDOWN=30
```

Default values are reasonable for initial runs.

### 5. Start the bot

```powershell
.\start-bot.ps1
```

If execution policy blocks the script:

```powershell
powershell -ExecutionPolicy Bypass -File start-bot.ps1
```

## Console output

On startup you should see wallet, threshold, take profit, stop loss, trade amount, cooldown, then balance check and market resolution. Example:

```
============================================================
Starting Auto Trading Bot...
============================================================
Wallet: 0x...
Threshold: $0.0150
...
============================================================
WALLET BALANCES
...
Balances sufficient.
...
Bot started successfully.
```

If balances are insufficient, the script reports required USDC and MATIC.

## When a trade runs

Example:

```
TRADE OPPORTUNITY DETECTED
Token: UP
Software Price: $0.7500
Polymarket Price: $0.7300
Difference: $0.0200
...
Executing trade...
Buy order placed: ...
Take Profit order: ... @ $0.7400
Stop Loss order: ... @ $0.7250
TRADE EXECUTION COMPLETE
Next trade available in 30 seconds
```

## Status line

Every 30 seconds (approx.) a line like:

```
[Monitor] Software: UP=$0.7500 DOWN=$0.2500 | Market: UP=$0.7300 DOWN=$0.2700
```

If prices stay at 0.0000, the WebSocket feeds are likely not connected.

## Troubleshooting

| Message / behavior | Cause | Action |
|--------------------|--------|--------|
| PRIVATE_KEY not found or invalid | Missing or bad key in `.env` | Set correct `PRIVATE_KEY` in `.env` |
| No active Bitcoin market found | Current hour market not yet open | Wait until the next hour |
| Insufficient balance | Not enough USDC or MATIC on Polygon | Add USDC/MATIC to wallet |
| Repeated reconnects | Network or server issues | Check connectivity; restart if needed |
| Prices stuck at 0.0000 | WebSocket not connected | Check firewall/network; restart bot |

## Stopping

Press `Ctrl+C`. The process exits and connections close.

## Risk and sizing

- Start with small size (e.g. $5–10 per trade).
- Run for at least a week before increasing size.
- Do not risk funds you cannot afford to lose.
- Do not manually cancel or modify orders that the bot is managing unless you understand the impact.

## Performance expectations

Backtests and live use suggest win rates in the 60–70% range with the default parameters. Profit per trade is small; total PnL depends on size, frequency, and market conditions. There is no guarantee of profit.

## Common issues

- **Order appears stuck**: Check positions and orders on Polymarket. Cancel or adjust there if needed.
- **Bot exit**: Restart the bot; existing orders remain on the book.
- **Stop loss not filled**: Possible in thin markets; loss may exceed the stop amount.
- **Balance not updating**: Check Polygonscan; proceeds may be in outcome tokens until sold.

## Important files

- `.env` — Private key and config (do not share)
- `.credentials.json` — API credentials (do not share)
- `start-bot.ps1` — Bot launcher
- `README.md` — Project and usage overview

## Scaling

After stable runs with small size:

1. Review win rate and drawdowns.
2. Increase trade size gradually (e.g. double every week if results support it).
3. Avoid order sizes that cause noticeable slippage; for Bitcoin UP/DOWN, staying at or below roughly $100 per order is often reasonable.

## Contact

For product or integration questions: see README.md for documentation links.

---

Disclaimer: Trading carries risk. Losses are possible. This is not financial advice. You are responsible for your own trading decisions.
