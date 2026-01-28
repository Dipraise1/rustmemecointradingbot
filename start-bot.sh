#!/bin/bash

# Start only the Telegram bot

cd telegram-bot

if [ ! -f .env ]; then
    echo "❌ No .env file found!"
    echo "Please create .env with:"
    echo "  TELEGRAM_BOT_TOKEN=your_token_here"
    echo "  RUST_API_URL=http://localhost:3000"
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "📥 Installing dependencies..."
    bun install
fi

echo "🤖 Starting Telegram Bot..."
bun run dev
