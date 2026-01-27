// Risk Management Engine - Production Ready
// Protects users and the bot from dangerous trades and excessive losses

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{Utc, DateTime};

// ==================== DATA STRUCTURES ====================

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RiskProfile {
    pub user_id: i64,
    pub max_trade_size_usd: f64,
    pub max_daily_loss_usd: f64,
    pub max_open_positions: i32,
    pub default_stop_loss_percent: f64,
    pub default_take_profit_percent: f64,
    pub kill_switch_enabled: bool,
    pub blacklist_enabled: bool,
    pub last_updated: i64,
}

impl Default for RiskProfile {
    fn default() -> Self {
        Self {
            user_id: 0,
            max_trade_size_usd: 100.0, // Conservative default
            max_daily_loss_usd: 50.0,
            max_open_positions: 5,
            default_stop_loss_percent: 15.0,
            default_take_profit_percent: 30.0,
            kill_switch_enabled: false,
            blacklist_enabled: true,
            last_updated: Utc::now().timestamp(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct RiskState {
    // In-memory cache of daily stats to avoid DB hammering
    // Key: user_id
    pub daily_stats: Arc<RwLock<std::collections::HashMap<i64, DailyStats>>>,
    pub global_blacklist: Arc<RwLock<HashSet<String>>>,
    pub dev_blacklist: Arc<RwLock<HashSet<String>>>,
}

#[derive(Debug, Clone, Default)]
pub struct DailyStats {
    pub date: String, // YYYY-MM-DD
    pub total_loss_usd: f64,
    pub trade_count: i32,
}

#[derive(Debug)]
pub enum RiskError {
    KillSwitchActive,
    MaxTradeSizeExceeded(f64, f64), // (attempted, max)
    MaxDailyLossExceeded(f64, f64), // (current_loss, max)
    MaxOpenPositionsExceeded(i32, i32), // (current, max)
    TokenBlacklisted(String),
    DevBlacklisted(String),
    InsufficientLiquidity,
    DatabaseError(String),
}

impl std::fmt::Display for RiskError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RiskError::KillSwitchActive => write!(f, "Kill switch is ACTIVE. Trading disabled."),
            RiskError::MaxTradeSizeExceeded(amt, max) => write!(f, "Trade size ${:.2} exceeds limit ${:.2}", amt, max),
            RiskError::MaxDailyLossExceeded(loss, max) => write!(f, "Daily loss limit reached (${:.2} / ${:.2})", loss, max),
            RiskError::MaxOpenPositionsExceeded(curr, max) => write!(f, "Max open positions reached ({}/{})", curr, max),
            RiskError::TokenBlacklisted(token) => write!(f, "Token is blacklisted: {}", token),
            RiskError::DevBlacklisted(dev) => write!(f, "Developer wallet is blacklisted: {}", dev),
            RiskError::InsufficientLiquidity => write!(f, "Insufficient liquidity for safe trade"),
            RiskError::DatabaseError(e) => write!(f, "Risk engine DB error: {}", e),
        }
    }
}

// ==================== CORE LOGIC ====================

pub async fn check_trade_risk(
    user_id: i64,
    token_address: &str,
    amount_usd: f64,
    pool: &PgPool,
    risk_state: &RiskState,
) -> Result<(), RiskError> {
    // 1. Fetch User Risk Profile
    let profile = get_risk_profile(user_id, pool).await
        .map_err(|e| RiskError::DatabaseError(e))?;

    // 2. Kill Switch Check
    if profile.kill_switch_enabled {
        return Err(RiskError::KillSwitchActive);
    }

    // 3. Blacklist Check
    if profile.blacklist_enabled {
        let blacklist = risk_state.global_blacklist.read().await;
        if blacklist.contains(token_address) {
            return Err(RiskError::TokenBlacklisted(token_address.to_string()));
        }
        // TODO: Check Dev Wallet via external API or cache
    }

    // 4. Max Trade Size Check
    if amount_usd > profile.max_trade_size_usd {
        return Err(RiskError::MaxTradeSizeExceeded(amount_usd, profile.max_trade_size_usd));
    }

    // 5. Daily Loss Check
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let mut stats_map = risk_state.daily_stats.write().await;
    let stats = stats_map.entry(user_id).or_insert(DailyStats {
        date: today.clone(),
        total_loss_usd: 0.0,
        trade_count: 0,
    });

    // Reset if new day
    if stats.date != today {
        *stats = DailyStats {
            date: today,
            total_loss_usd: 0.0,
            trade_count: 0,
        };
    }

    if stats.total_loss_usd >= profile.max_daily_loss_usd {
        return Err(RiskError::MaxDailyLossExceeded(stats.total_loss_usd, profile.max_daily_loss_usd));
    }

    // 6. Max Open Positions Check
    let open_positions_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM positions WHERE user_id = $1" // Assuming 'positions' table exists and rows are deleted/archived on close
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| RiskError::DatabaseError(e.to_string()))?;

    if open_positions_count as i32 >= profile.max_open_positions {
        return Err(RiskError::MaxOpenPositionsExceeded(open_positions_count as i32, profile.max_open_positions));
    }

    Ok(())
}

pub async fn record_trade_result(
    user_id: i64,
    pnl_usd: f64,
    risk_state: &RiskState,
) {
    if pnl_usd < 0.0 {
        let mut stats_map = risk_state.daily_stats.write().await;
        if let Some(stats) = stats_map.get_mut(&user_id) {
            stats.total_loss_usd += pnl_usd.abs();
        }
    }
}

// ==================== DB HELPERS ====================

pub async fn get_risk_profile(user_id: i64, pool: &PgPool) -> Result<RiskProfile, String> {
    // Try to get existing profile
    let profile = sqlx::query_as::<_, RiskProfile>(
        "SELECT * FROM risk_profiles WHERE user_id = $1"
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    match profile {
        Some(p) => Ok(p),
        None => {
            // Create default profile if not exists
            let default = RiskProfile { user_id, ..Default::default() };
            sqlx::query(
                r#"
                INSERT INTO risk_profiles 
                (user_id, max_trade_size_usd, max_daily_loss_usd, max_open_positions, default_stop_loss_percent, default_take_profit_percent, kill_switch_enabled, blacklist_enabled, last_updated)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                "#
            )
            .bind(default.user_id)
            .bind(default.max_trade_size_usd)
            .bind(default.max_daily_loss_usd)
            .bind(default.max_open_positions)
            .bind(default.default_stop_loss_percent)
            .bind(default.default_take_profit_percent)
            .bind(default.kill_switch_enabled)
            .bind(default.blacklist_enabled)
            .bind(default.last_updated)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(default)
        }
    }
}
