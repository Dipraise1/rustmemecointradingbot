#!/bin/bash

# Start only the Rust trading engine

cd trading-engine

if [ ! -f .env ]; then
    echo "Creating .env file from example..."
    cat > .env << EOF
SOLANA_RPC=https://api.mainnet-beta.solana.com
PORT=3000
RUST_LOG=info
EOF
fi

echo "🚀 Starting Rust Trading Engine..."
cargo run
