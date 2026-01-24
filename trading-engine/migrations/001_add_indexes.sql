-- Performance Indexes Migration
-- Add indexes for frequently queried columns

-- Positions table indexes
CREATE INDEX IF NOT EXISTS idx_positions_user_status ON positions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_positions_created ON positions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_user_chain ON positions(user_id, chain);

-- Transactions table indexes
CREATE INDEX IF NOT EXISTS idx_transactions_user_chain ON transactions(user_id, chain);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_timestamp ON transactions(user_id, timestamp DESC);

-- Wallets table indexes (already has UNIQUE constraint on user_id, chain)
-- No additional index needed

-- Users table index
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);
