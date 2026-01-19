-- Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
    user_id BIGINT PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Settings table
CREATE TABLE IF NOT EXISTS user_settings (
    user_id BIGINT PRIMARY KEY REFERENCES users(user_id),
    default_chain VARCHAR(20) DEFAULT 'solana',
    buy_amount VARCHAR(50) DEFAULT '0.1',
    slippage FLOAT DEFAULT 10.0,
    take_profit_percent FLOAT DEFAULT 100.0,
    stop_loss_percent FLOAT DEFAULT -40.0,
    auto_trade BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Wallets table
CREATE TABLE IF NOT EXISTS wallets (
    id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    chain VARCHAR(20) NOT NULL,
    address VARCHAR(255) NOT NULL,
    private_key TEXT NOT NULL, -- Encrypted in production usually, simplistic for now
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, chain)
);

-- Positions table
CREATE TABLE IF NOT EXISTS positions (
    position_id VARCHAR(100) PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    chain VARCHAR(20) NOT NULL,
    token_address VARCHAR(255) NOT NULL,
    amount VARCHAR(100) NOT NULL,
    entry_price DOUBLE PRECISION NOT NULL,
    current_price DOUBLE PRECISION NOT NULL,
    take_profit_percent DOUBLE PRECISION NOT NULL,
    stop_loss_percent DOUBLE PRECISION NOT NULL,
    status VARCHAR(20) DEFAULT 'OPEN', -- OPEN, CLOSED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE
);

-- Transactions/History table
CREATE TABLE IF NOT EXISTS transactions (
    transaction_id VARCHAR(100) PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    chain VARCHAR(20) NOT NULL,
    type VARCHAR(20) NOT NULL, -- BUY, SELL
    token_address VARCHAR(255) NOT NULL,
    amount VARCHAR(100) NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    tx_hash VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
