// Whale Tracker Module - Production Ready
// Tracks large trades (whales) on perpetual stablecoin markets

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::Utc;

// ==================== DATA STRUCTURES ====================
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhaleTrade {
    pub trade_id: String,
    pub chain: String,
    pub token: String,
    pub token_symbol: String,
    pub trade_type: TradeType,
    pub size_usd: f64,
    pub size_native: f64,
    pub price: f64,
    pub timestamp: i64,
    pub wallet_address: String,
    pub leverage: Option<f64>, // For perpetuals
    pub position_type: PositionType, // Long or Short
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TradeType {
    Buy,
    Sell,
    Long,  // Opening long position
    Short, // Opening short position
    CloseLong,
    CloseShort,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PositionType {
    Long,
    Short,
    Spot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhaleAlert {
    pub alert_id: String,
    pub user_id: i64,
    pub min_size_usd: f64,
    pub chains: Vec<String>,
    pub tokens: Vec<String>, // Empty = all tokens
    pub position_types: Vec<PositionType>,
    pub active: bool,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct WhaleTrackerStats {
    pub total_whales_tracked: usize,
    pub total_volume_24h: f64,
    pub largest_trade_24h: Option<WhaleTrade>,
    pub top_whales: Vec<WhaleInfo>,
    pub long_short_ratio: f64, // Long volume / Short volume
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhaleInfo {
    pub wallet_address: String,
    pub total_volume_24h: f64,
    pub trade_count: usize,
    pub avg_trade_size: f64,
    pub net_position: f64, // Positive = net long, Negative = net short
    pub last_trade: Option<WhaleTrade>,
}

#[derive(Debug, Deserialize)]
pub struct CreateWhaleAlertRequest {
    pub user_id: i64,
    pub min_size_usd: f64,
    pub chains: Option<Vec<String>>,
    pub tokens: Option<Vec<String>>,
    pub position_types: Option<Vec<String>>, // "long", "short", "spot"
}

#[derive(Debug, Serialize)]
pub struct WhaleAlertResponse {
    pub success: bool,
    pub alert_id: Option<String>,
    pub error: Option<String>,
}

// ==================== WHALE DETECTION ====================
pub fn is_whale_trade(size_usd: f64, chain: &str) -> bool {
    // Minimum thresholds per chain
    let threshold = match chain {
        "solana" => 10_000.0,  // $10k+ on Solana
        "eth" | "ethereum" => 50_000.0, // $50k+ on Ethereum
        "bsc" | "binance" => 25_000.0,  // $25k+ on BSC
        _ => 10_000.0,
    };
    
    size_usd >= threshold
}

pub fn classify_trade_type(
    token: &str,
    is_perpetual: bool,
    is_buy: bool,
    is_opening: bool,
) -> (TradeType, PositionType) {
    if is_perpetual {
        if is_opening {
            if is_buy {
                (TradeType::Long, PositionType::Long)
            } else {
                (TradeType::Short, PositionType::Short)
            }
        } else {
            if is_buy {
                (TradeType::CloseShort, PositionType::Short)
            } else {
                (TradeType::CloseLong, PositionType::Long)
            }
        }
    } else {
        if is_buy {
            (TradeType::Buy, PositionType::Spot)
        } else {
            (TradeType::Sell, PositionType::Spot)
        }
    }
}

// ==================== WHALE TRACKING ====================
pub fn track_whale_trade(
    trade: WhaleTrade,
    whale_map: &mut HashMap<String, WhaleInfo>,
) {
    let whale_info = whale_map.entry(trade.wallet_address.clone())
        .or_insert_with(|| WhaleInfo {
            wallet_address: trade.wallet_address.clone(),
            total_volume_24h: 0.0,
            trade_count: 0,
            avg_trade_size: 0.0,
            net_position: 0.0,
            last_trade: None,
        });
    
    whale_info.total_volume_24h += trade.size_usd;
    whale_info.trade_count += 1;
    whale_info.avg_trade_size = whale_info.total_volume_24h / whale_info.trade_count as f64;
    
    // Update net position
    match trade.position_type {
        PositionType::Long => whale_info.net_position += trade.size_usd,
        PositionType::Short => whale_info.net_position -= trade.size_usd,
        PositionType::Spot => {
            match trade.trade_type {
                TradeType::Buy => whale_info.net_position += trade.size_usd,
                TradeType::Sell => whale_info.net_position -= trade.size_usd,
                _ => {}
            }
        }
    }
    
    whale_info.last_trade = Some(trade);
}

pub fn calculate_whale_stats(
    trades: &[WhaleTrade],
    whale_map: &HashMap<String, WhaleInfo>,
) -> WhaleTrackerStats {
    let now = Utc::now().timestamp();
    let day_ago = now - 86400; // 24 hours
    
    // Filter trades from last 24h
    let recent_trades: Vec<&WhaleTrade> = trades
        .iter()
        .filter(|t| t.timestamp >= day_ago)
        .collect();
    
    let total_volume: f64 = recent_trades.iter().map(|t| t.size_usd).sum();
    
    let largest_trade = recent_trades.iter()
        .max_by(|a, b| a.size_usd.partial_cmp(&b.size_usd).unwrap());
    
    // Calculate long/short ratio
    let long_volume: f64 = recent_trades.iter()
        .filter(|t| matches!(t.position_type, PositionType::Long))
        .map(|t| t.size_usd)
        .sum();
    
    let short_volume: f64 = recent_trades.iter()
        .filter(|t| matches!(t.position_type, PositionType::Short))
        .map(|t| t.size_usd)
        .sum();
    
    let long_short_ratio = if short_volume > 0.0 {
        long_volume / short_volume
    } else if long_volume > 0.0 {
        999.0 // All long
    } else {
        1.0 // No trades
    };
    
    // Get top whales by volume
    let mut top_whales: Vec<WhaleInfo> = whale_map.values()
        .filter(|w| w.total_volume_24h > 0.0)
        .cloned()
        .collect();
    
    top_whales.sort_by(|a, b| b.total_volume_24h.partial_cmp(&a.total_volume_24h).unwrap());
    top_whales.truncate(10); // Top 10
    
    WhaleTrackerStats {
        total_whales_tracked: whale_map.len(),
        total_volume_24h: total_volume,
        largest_trade_24h: largest_trade.map(|t| (*t).clone()),
        top_whales,
        long_short_ratio,
    }
}

// ==================== WHALE ALERTS ====================
pub fn create_whale_alert(request: CreateWhaleAlertRequest) -> WhaleAlert {
    let position_types: Vec<PositionType> = request.position_types
        .unwrap_or_default()
        .iter()
        .map(|s| match s.to_lowercase().as_str() {
            "long" => PositionType::Long,
            "short" => PositionType::Short,
            "spot" => PositionType::Spot,
            _ => PositionType::Spot,
        })
        .collect();
    
    WhaleAlert {
        alert_id: format!("alert_{}_{}", request.user_id, Utc::now().timestamp()),
        user_id: request.user_id,
        min_size_usd: request.min_size_usd,
        chains: request.chains.unwrap_or_default(),
        tokens: request.tokens.unwrap_or_default(),
        position_types: if position_types.is_empty() {
            vec![PositionType::Long, PositionType::Short, PositionType::Spot]
        } else {
            position_types
        },
        active: true,
        created_at: Utc::now().timestamp(),
    }
}

pub fn check_whale_alert(
    trade: &WhaleTrade,
    alert: &WhaleAlert,
) -> bool {
    if !alert.active {
        return false;
    }
    
    if trade.size_usd < alert.min_size_usd {
        return false;
    }
    
    if !alert.chains.is_empty() && !alert.chains.contains(&trade.chain) {
        return false;
    }
    
    if !alert.tokens.is_empty() && !alert.tokens.contains(&trade.token) {
        return false;
    }
    
    if !alert.position_types.contains(&trade.position_type) {
        return false;
    }
    
    true
}
