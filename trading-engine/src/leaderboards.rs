// Leaderboards Module - Production Ready
// User rankings based on trading performance

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::Utc;
use axum::{
    extract::{Path, State, Query},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use crate::AppState;

// ==================== DATA STRUCTURES ====================
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardEntry {
    pub user_id: i64,
    pub username: Option<String>,
    pub rank: usize,
    pub total_pnl_usd: f64,
    pub total_pnl_percent: f64,
    pub win_rate: f64,
    pub total_trades: usize,
    pub winning_trades: usize,
    pub losing_trades: usize,
    pub largest_win: f64,
    pub largest_loss: f64,
    pub total_volume_usd: f64,
    pub avg_trade_size: f64,
    pub streak: i32, // Current win/loss streak (positive = wins, negative = losses)
    pub last_updated: i64,
}

#[derive(Debug, Serialize)]
pub struct Leaderboard {
    pub period: LeaderboardPeriod,
    pub entries: Vec<LeaderboardEntry>,
    pub total_participants: usize,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LeaderboardPeriod {
    Daily,
    Weekly,
    Monthly,
    AllTime,
}

#[derive(Debug, Deserialize)]
pub struct GetLeaderboardRequest {
    pub period: Option<String>, // "daily", "weekly", "monthly", "alltime"
    pub limit: Option<usize>,
    pub metric: Option<String>, // "pnl", "volume", "winrate"
}

// ==================== LEADERBOARD CALCULATION ====================
pub fn calculate_user_stats(
    user_id: i64,
    trades: &[TradeRecord],
    period: &LeaderboardPeriod,
) -> LeaderboardEntry {
    let now = Utc::now().timestamp();
    let cutoff_time = match period {
        LeaderboardPeriod::Daily => now - 86400,
        LeaderboardPeriod::Weekly => now - 604800,
        LeaderboardPeriod::Monthly => now - 2592000,
        LeaderboardPeriod::AllTime => 0,
    };
    
    let filtered_trades: Vec<&TradeRecord> = trades
        .iter()
        .filter(|t| t.user_id == user_id && t.timestamp >= cutoff_time)
        .collect();
    
    let mut total_pnl_usd = 0.0;
    let mut total_pnl_percent = 0.0;
    let mut winning_trades = 0;
    let mut losing_trades = 0;
    let mut largest_win = 0.0;
    let mut largest_loss = 0.0;
    let mut total_volume = 0.0;
    let mut streak = 0;
    
    // Calculate streak (most recent trades first)
    let recent_trades: Vec<&TradeRecord> = filtered_trades.iter().rev().take(10).copied().collect();
    for trade in recent_trades.iter() {
        if trade.pnl_usd > 0.0 {
            if streak >= 0 {
                streak += 1;
            } else {
                streak = 1;
            }
        } else if trade.pnl_usd < 0.0 {
            if streak <= 0 {
                streak -= 1;
            } else {
                streak = -1;
            }
        }
    }
    
    for trade in &filtered_trades {
        total_pnl_usd += trade.pnl_usd;
        total_pnl_percent += trade.pnl_percent;
        total_volume += trade.volume_usd;
        
        if trade.pnl_usd > 0.0 {
            winning_trades += 1;
            if trade.pnl_usd > largest_win {
                largest_win = trade.pnl_usd;
            }
        } else if trade.pnl_usd < 0.0 {
            losing_trades += 1;
            if trade.pnl_usd < largest_loss {
                largest_loss = trade.pnl_usd;
            }
        }
    }
    
    let total_trades = filtered_trades.len();
    let win_rate = if total_trades > 0 {
        (winning_trades as f64 / total_trades as f64) * 100.0
    } else {
        0.0
    };
    
    let avg_trade_size = if total_trades > 0 {
        total_volume / total_trades as f64
    } else {
        0.0
    };
    
    LeaderboardEntry {
        user_id,
        username: None,
        rank: 0, // Will be set when building leaderboard
        total_pnl_usd,
        total_pnl_percent: if total_trades > 0 { total_pnl_percent / total_trades as f64 } else { 0.0 },
        win_rate,
        total_trades,
        winning_trades,
        losing_trades,
        largest_win,
        largest_loss,
        total_volume_usd: total_volume,
        avg_trade_size,
        streak,
        last_updated: now,
    }
}

pub fn build_leaderboard(
    all_trades: &[TradeRecord],
    period: LeaderboardPeriod,
    metric: &str,
    limit: usize,
) -> Leaderboard {
    let now = Utc::now().timestamp();
    
    // Get unique user IDs
    let mut user_ids: Vec<i64> = all_trades.iter()
        .map(|t| t.user_id)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    
    // Calculate stats for each user
    let mut entries: Vec<LeaderboardEntry> = user_ids.iter()
        .map(|&user_id| calculate_user_stats(user_id, all_trades, &period))
        .collect();
    
    // Sort by metric
    match metric {
        "pnl" => {
            entries.sort_by(|a, b| b.total_pnl_usd.partial_cmp(&a.total_pnl_usd).unwrap_or(std::cmp::Ordering::Equal));
        }
        "volume" => {
            entries.sort_by(|a, b| b.total_volume_usd.partial_cmp(&a.total_volume_usd).unwrap_or(std::cmp::Ordering::Equal));
        }
        "winrate" => {
            entries.sort_by(|a, b| b.win_rate.partial_cmp(&a.win_rate).unwrap_or(std::cmp::Ordering::Equal));
        }
        _ => {
            entries.sort_by(|a, b| b.total_pnl_usd.partial_cmp(&a.total_pnl_usd).unwrap_or(std::cmp::Ordering::Equal));
        }
    }
    
    // Set ranks and limit
    for (idx, entry) in entries.iter_mut().enumerate() {
        entry.rank = idx + 1;
    }
    
    entries.truncate(limit);
    
    Leaderboard {
        period,
        entries,
        total_participants: user_ids.len(),
        updated_at: now,
    }
}

// ==================== TRADE RECORD ====================
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TradeRecord {
    pub user_id: i64,
    pub trade_id: String,
    pub chain: String,
    pub token: String,
    pub trade_type: String, // "buy", "sell"
    pub volume_usd: f64,
    pub pnl_usd: f64,
    pub pnl_percent: f64,
    pub timestamp: i64,
}

impl TradeRecord {
    pub fn from_position_close(
        user_id: i64,
        chain: String,
        token: String,
        entry_price: f64,
        exit_price: f64,
        amount: f64,
        timestamp: i64,
    ) -> Self {
        let pnl_percent = ((exit_price - entry_price) / entry_price) * 100.0;
        let pnl_usd = (amount * entry_price) * (pnl_percent / 100.0);
        let volume_usd = amount * entry_price;
        
        Self {
            user_id,
            trade_id: format!("trade_{}", timestamp),
            chain,
            token,
            trade_type: if pnl_usd > 0.0 { "sell".to_string() } else { "sell".to_string() },
            volume_usd,
            pnl_usd,
            pnl_percent,
            timestamp,
        }
    }
}

// ==================== USER RANKING ====================
pub fn get_user_rank(
    user_id: i64,
    leaderboard: &Leaderboard,
) -> Option<usize> {
    leaderboard.entries.iter()
        .find(|e| e.user_id == user_id)
        .map(|e| e.rank)
}

pub fn get_user_position(
    user_id: i64,
    leaderboard: &Leaderboard,
) -> Option<&LeaderboardEntry> {
    leaderboard.entries.iter()
        .find(|e| e.user_id == user_id)
}

// ==================== API HANDLERS ====================

pub async fn get_daily_leaderboard_handler(
    State(state): State<AppState>,
    Path(user_id): Path<i64>,
) -> impl IntoResponse {
    // 1. Fetch all trades from DB
    let trades = sqlx::query_as::<_, TradeRecord>("SELECT * FROM transactions")
        .fetch_all(&state.db)
        .await
        .unwrap_or(vec![]);

    // 2. Build Daily Leaderboard
    let leaderboard = build_leaderboard(
        &trades,
        LeaderboardPeriod::Daily,
        "pnl",
        100 // Top 100
    );

    // 3. Get User's Rank
    let user_rank = get_user_rank(user_id, &leaderboard);
    let user_entry = get_user_position(user_id, &leaderboard).cloned();

    (StatusCode::OK, Json(serde_json::json!({
        "period": "Daily",
        "rank": user_rank,
        "entry": user_entry,
        "top_10": leaderboard.entries.iter().take(10).collect::<Vec<_>>(),
    })))
}

pub async fn get_alltime_leaderboard_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let trades = sqlx::query_as::<_, TradeRecord>("SELECT * FROM transactions")
        .fetch_all(&state.db)
        .await
        .unwrap_or(vec![]);

    let leaderboard = build_leaderboard(
        &trades,
        LeaderboardPeriod::AllTime,
        "pnl",
        100
    );

    (StatusCode::OK, Json(serde_json::json!({
        "period": "AllTime",
        "top_10": leaderboard.entries.iter().take(10).collect::<Vec<_>>(),
    })))
}


