# Rust Memecoin Trading Bot

A production-ready multi-chain memecoin sniper bot built with Rust and TypeScript.

## Features

- 🚀 **Multi-chain Support**: Solana, Ethereum, Binance Smart Chain
- 💼 **Wallet Management**: Generate and import EVM/Solana wallets
- 📊 **Real-time Trading**: Buy/sell with auto TP/SL
- 🔒 **Security Checks**: GoPlus API integration for token safety
- 💰 **Portfolio Analytics**: Track PnL, positions, and balances
- 📈 **Price Tracking**: Real-time prices via DexScreener
- ⛽ **Gas Optimization**: Smart gas price monitoring
- 📜 **Transaction History**: Complete audit trail
- 🔔 **Alerts**: Price and position notifications

## Architecture

- **Rust Trading Engine**: High-performance backend with Axum
- **TypeScript Telegram Bot**: User-friendly interface via Grammy
- **Real API Integration**: DexScreener, GoPlus, Jupiter, 1inch

## Quick Start

```bash
# Start both services
./start.sh

# Or separately
./start-engine.sh  # Rust engine on port 3000
./start-bot.sh      # Telegram bot
```

## Environment Variables

### Trading Engine (.env)
```
SOLANA_RPC=https://api.mainnet-beta.solana.com
ETH_RPC=https://eth.llamarpc.com
BSC_RPC=https://bsc-dataseed.binance.org/
PORT=3000
RUST_LOG=info
```

### Telegram Bot (.env)
```
TELEGRAM_BOT_TOKEN=your_bot_token
RUST_API=http://localhost:3000
```

## API Endpoints

- `GET /health` - Health check
- `POST /api/buy` - Execute buy order
- `POST /api/sell` - Execute sell order
- `GET /api/positions/:user_id` - Get user positions
- `GET /api/portfolio/:user_id` - Portfolio summary
- `GET /api/price/:chain/:token` - Token price
- `GET /api/gas/:chain` - Gas prices
- `GET /api/history/:user_id` - Transaction history

## License

MIT
