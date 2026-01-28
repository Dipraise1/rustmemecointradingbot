#!/bin/bash

# Startup script for the trading bot MVP (Docker Version)

echo "🚀 Starting Memecoin Sniper Bot (Full Stack)..."
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker Desktop."
    exit 1
fi

# Check env file
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from example..."
    echo "SOLANA_RPC=https://api.devnet.solana.com
NETWORK=testnet
TELEGRAM_BOT_TOKEN=YOUR_TOKEN_HERE" > .env
    echo "❌ Please edit .env and add your TELEGRAM_BOT_TOKEN before running!"
    exit 1
fi

# Check if token is set
if grep -q "YOUR_TOKEN_HERE" .env; then
     echo "❌ Please edit .env and add your actual TELEGRAM_BOT_TOKEN!"
     exit 1
fi

echo "� Building and Starting Services..."
docker-compose up --build

# Cleanup is handled by docker-compose usually (Ctrl+C w)

