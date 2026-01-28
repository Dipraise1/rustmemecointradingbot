#!/bin/bash

# Kill script for Trading Bot processes

echo "🔍 Searching for trading bot processes..."

# Kill processes on common ports
echo "📡 Checking ports..."
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null && echo "   ✅ Killed process on port 3000" || echo "   ⚪ No process on port 3000"
lsof -ti:8080 2>/dev/null | xargs kill -9 2>/dev/null && echo "   ✅ Killed process on port 8080" || echo "   ⚪ No process on port 8080"

# Kill by process name
echo "🔪 Killing by process name..."
pkill -f "trading-engine" 2>/dev/null && echo "   ✅ Killed trading-engine processes" || echo "   ⚪ No trading-engine processes"
pkill -f "telegram-bot" 2>/dev/null && echo "   ✅ Killed telegram-bot processes" || echo "   ⚪ No telegram-bot processes"
pkill -f "bot.ts" 2>/dev/null && echo "   ✅ Killed bot.ts processes" || echo "   ⚪ No bot.ts processes"

# Kill Node/Bun processes related to bot
echo "📦 Checking Node/Bun processes..."
pkill -f "node.*bot" 2>/dev/null && echo "   ✅ Killed Node bot processes" || echo "   ⚪ No Node bot processes"
pkill -f "bun.*bot" 2>/dev/null && echo "   ✅ Killed Bun bot processes" || echo "   ⚪ No Bun bot processes"

# Stop Docker containers
echo "🐳 Checking Docker containers..."
cd "$(dirname "$0")"
if command -v docker-compose &> /dev/null; then
    docker-compose down 2>/dev/null && echo "   ✅ Stopped Docker containers" || echo "   ⚪ No Docker containers running"
fi

# Kill Rust cargo processes
echo "🦀 Checking Rust processes..."
pkill -f "cargo.*run" 2>/dev/null && echo "   ✅ Killed cargo run processes" || echo "   ⚪ No cargo run processes"

echo ""
echo "✅ Cleanup complete!"
