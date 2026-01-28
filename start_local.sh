#!/bin/bash

# Startup script for Local Development (No Docker)

echo "🚀 Starting Memecoin Sniper Bot (Local Mode)..."
echo ""

# Check Prerequisites
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust (cargo) is not installed."
    exit 1
fi

if ! command -v bun &> /dev/null; then
    echo "❌ Bun is not installed."
    exit 1
fi

# Setup Environment
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating default local config..."
    # Note: Defaulting DB to localhost
    echo "SOLANA_RPC=https://api.devnet.solana.com
NETWORK=testnet
PORT=3000
RUST_LOG=info
DATABASE_URL=postgres://postgres:password@localhost:5432/trading_bot
TELEGRAM_BOT_TOKEN=YOUR_TOKEN_HERE" > .env
    
    echo "📝 Created .env file."
    echo "⚠️  IMPORTANT: Please edit .env with:"
    echo "   1. Your TELEGRAM_BOT_TOKEN"
    echo "   2. Your local DATABASE_URL (Ensure Postgres is running!)"
    echo ""
    exit 1
fi

# Check for Token
if grep -q "YOUR_TOKEN_HERE" .env; then
     echo "❌ Please set TELEGRAM_BOT_TOKEN in .env"
     exit 1
fi

echo "📦 Compiling & Starting Trading Engine..."
cd trading-engine
# Source the .env file from parent directory so cargo sees variables
set -a
source ../.env
set +a

# Run in background, redirect logs to file to keep console clean
cargo run --release --bin trading-engine > ../engine.log 2>&1 &
ENGINE_PID=$!
echo "   PID: $ENGINE_PID (Logs: engine.log)"
cd ..

echo "⏳ Waiting for Engine to initialize (5s)..."
sleep 5

# Check if Engine is still running
if ! ps -p $ENGINE_PID > /dev/null; then
    echo "❌ Trading Engine failed to start! Check engine.log:"
    tail -n 10 engine.log
    exit 1
fi

echo "🤖 Starting Telegram Bot..."
cd telegram-bot
bun install
bun run dev &
BOT_PID=$!
cd ..

echo ""
echo "✅ Local Stack Running!"
echo "   Engine API: http://localhost:3000"
echo "   Telegram Bot: Up"
echo ""
echo "Press Ctrl+C to stop."

# Trap Ctrl+C
trap "kill $ENGINE_PID $BOT_PID; exit" SIGINT SIGTERM

wait
