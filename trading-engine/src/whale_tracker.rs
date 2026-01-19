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
    pub trade_velocity: f64, // Trades per hour
    pub price_impact_avg: f64, // Average price impact percentage
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhaleActivity {
    pub trade: WhaleTrade,
    pub price_impact: f64, // Price impact percentage
    pub volume_anomaly: f64, // Volume spike multiplier vs average
    pub velocity_score: f64, // Rapid trade indicator (0-1)
    pub market_impact: MarketImpact, // Overall market impact assessment
    pub known_label: Option<String>,
    pub is_first_entry: bool,
    pub confidence_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MarketImpact {
    Low,      // < 1% price impact
    Medium,   // 1-5% price impact
    High,     // 5-10% price impact
    Critical, // > 10% price impact or rapid consecutive trades
}

#[derive(Debug, Serialize)]
pub struct WhaleImpactAnalysis {
    pub trade: WhaleTrade,
    pub price_impact: f64,
    pub volume_anomaly: f64,
    pub velocity_score: f64,
    pub market_impact: String,
    pub recommended_action: String, // For grid trading
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

lazy_static::lazy_static! {
    static ref KNOWN_WHALES: HashMap<String, String> = {
        let mut m = HashMap::new();
        m.insert("5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1".to_string(), "Alameda (Tagged)".to_string());
        m.insert("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM".to_string(), "Binance Hot Wallet".to_string());
        m
    };
}

/// Enhanced whale detection with multiple criteria
pub fn detect_whale_activity(
    trade: &WhaleTrade,
    recent_trades: &[WhaleTrade],
    avg_volume_24h: f64,
) -> WhaleActivity {
    // Calculate price impact (simplified - in production, use order book depth)
    let price_impact = calculate_price_impact(trade.size_usd, trade.chain.as_str());
    
    // Calculate volume anomaly (how much above average)
    let volume_anomaly = if avg_volume_24h > 0.0 {
        trade.size_usd / avg_volume_24h
    } else {
        1.0
    };
    
    // Calculate velocity (rapid consecutive trades)
    let velocity_score = calculate_trade_velocity(trade, recent_trades);
    
    // Determine market impact
    let market_impact = if price_impact > 10.0 || velocity_score > 0.8 {
        MarketImpact::Critical
    } else if price_impact > 5.0 || velocity_score > 0.6 {
        MarketImpact::High
    } else if price_impact > 1.0 || volume_anomaly > 3.0 {
        MarketImpact::Medium
    } else {
        MarketImpact::Low
    };
    
    // Smart Intelligence
    let known_label = KNOWN_WHALES.get(&trade.wallet_address).cloned();
    
    // Check first entry: simplistic check if they have traded this token before in recent history
    let previous_trades = recent_trades.iter()
        .filter(|t| t.wallet_address == trade.wallet_address && t.token == trade.token && t.timestamp < trade.timestamp)
        .count();
    let is_first_entry = previous_trades == 0;
    
    // Calculate Confidence Score (0-100)
    let mut confidence = 70.0; // Base confidence
    if known_label.is_some() { confidence += 20.0; } // Known entity = high confidence it's accurate
    if is_first_entry { confidence += 5.0; }
    if trade.size_usd > 500_000.0 { confidence += 5.0; }
    if confidence > 100.0 { confidence = 100.0; }
    
    WhaleActivity {
        trade: trade.clone(),
        price_impact,
        volume_anomaly,
        velocity_score,
        market_impact,
        known_label,
        is_first_entry,
        confidence_score: confidence,
    }
}

/// Calculate estimated price impact based on trade size and chain
fn calculate_price_impact(size_usd: f64, chain: &str) -> f64 {
    // Simplified model - in production, use order book depth analysis
    // Larger trades on less liquid chains have more impact
    let base_impact = match chain {
        "solana" => size_usd / 100_000.0, // ~0.01% per $100k
        "eth" | "ethereum" => size_usd / 500_000.0, // ~0.002% per $500k
        "bsc" | "binance" => size_usd / 250_000.0, // ~0.004% per $250k
        _ => size_usd / 100_000.0,
    };
    
    // Non-linear impact (larger trades have exponentially more impact)
    base_impact * (1.0 + (size_usd / 1_000_000.0).powf(1.5))
}

/// Calculate trade velocity (rapid consecutive trades indicator)
fn calculate_trade_velocity(trade: &WhaleTrade, recent_trades: &[WhaleTrade]) -> f64 {
    let time_window = 300; // 5 minutes
    let cutoff = trade.timestamp - time_window;
    
    // Count trades from same wallet in time window
    let rapid_trades = recent_trades.iter()
        .filter(|t| t.wallet_address == trade.wallet_address 
                && t.timestamp >= cutoff
                && t.token == trade.token)
        .count();
    
    // Velocity score: 0.0 (no velocity) to 1.0 (very high velocity)
    // 3+ trades in 5 minutes = high velocity
    (rapid_trades as f64 / 3.0).min(1.0)
}

/// Analyze whale impact for grid trading recommendations
pub fn analyze_whale_impact_for_grid(
    activity: &WhaleActivity,
    current_price: f64,
    grid_range: (f64, f64),
) -> WhaleImpactAnalysis {
    let recommended_action = match activity.market_impact {
        MarketImpact::Critical => {
            if activity.trade.price > current_price * 1.05 || activity.trade.price < current_price * 0.95 {
                "PAUSE_GRID - Whale activity causing significant price movement"
            } else {
                "REDUCE_GRID_SPACING - High volatility expected"
            }
        },
        MarketImpact::High => {
            if activity.velocity_score > 0.6 {
                "PAUSE_GRID - Rapid whale trades detected"
            } else {
                "WIDEN_GRID_RANGE - Adjust for increased volatility"
            }
        },
        MarketImpact::Medium => {
            "MONITOR - Continue with caution"
        },
        MarketImpact::Low => {
            "CONTINUE - Normal market conditions"
        },
    };
    
    WhaleImpactAnalysis {
        trade: activity.trade.clone(),
        price_impact: activity.price_impact,
        volume_anomaly: activity.volume_anomaly,
        velocity_score: activity.velocity_score,
        market_impact: format!("{:?}", activity.market_impact),
        recommended_action: recommended_action.to_string(),
    }
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
    price_impact: f64,
) {
    let whale_info = whale_map.entry(trade.wallet_address.clone())
        .or_insert_with(|| WhaleInfo {
            wallet_address: trade.wallet_address.clone(),
            total_volume_24h: 0.0,
            trade_count: 0,
            avg_trade_size: 0.0,
            net_position: 0.0,
            last_trade: None,
            trade_velocity: 0.0,
            price_impact_avg: 0.0,
        });
    
    // Calculate time since last trade for velocity
    let time_since_last = if let Some(last) = &whale_info.last_trade {
        trade.timestamp - last.timestamp
    } else {
        3600 // Default to 1 hour if no previous trade
    };
    
    whale_info.total_volume_24h += trade.size_usd;
    whale_info.trade_count += 1;
    whale_info.avg_trade_size = whale_info.total_volume_24h / whale_info.trade_count as f64;
    
    // Update velocity (trades per hour)
    if time_since_last > 0 {
        whale_info.trade_velocity = 3600.0 / time_since_last as f64;
    }
    
    // Update average price impact (exponential moving average)
    whale_info.price_impact_avg = (whale_info.price_impact_avg * 0.7) + (price_impact * 0.3);
    
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
