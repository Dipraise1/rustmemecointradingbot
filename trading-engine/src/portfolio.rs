// Portfolio Analytics Module - Production Ready
use serde::{Deserialize, Serialize};
use crate::balance::WalletBalance;

#[derive(Debug, Serialize)]
pub struct PortfolioSummary {
    pub user_id: i64,
    pub total_value_usd: f64,
    pub total_profit_loss_usd: f64,
    pub total_profit_loss_percent: f64,
    pub active_positions: usize,
    pub wallets: Vec<WalletBalance>,
    pub positions_pnl: f64,
    pub timestamp: i64,
}

#[derive(Debug, Serialize)]
pub struct PortfolioStats {
    pub total_trades: usize,
    pub winning_trades: usize,
    pub losing_trades: usize,
    pub win_rate: f64,
    pub average_profit: f64,
    pub average_loss: f64,
    pub largest_win: f64,
    pub largest_loss: f64,
    pub total_volume: f64,
}

pub fn calculate_portfolio_summary(
    user_id: i64,
    wallets: Vec<WalletBalance>,
    positions_pnl: f64,
    active_positions: usize,
) -> PortfolioSummary {
    let total_wallet_value: f64 = wallets.iter().map(|w| w.total_usd).sum();
    let total_value = total_wallet_value + positions_pnl;
    
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    
    PortfolioSummary {
        user_id,
        total_value_usd: total_value,
        total_profit_loss_usd: positions_pnl,
        total_profit_loss_percent: if total_wallet_value > 0.0 {
            (positions_pnl / total_wallet_value) * 100.0
        } else {
            0.0
        },
        active_positions,
        wallets,
        positions_pnl,
        timestamp,
    }
}

pub fn calculate_portfolio_stats(positions: Vec<f64>) -> PortfolioStats {
    let total_trades = positions.len();
    let winning_trades = positions.iter().filter(|&&p| p > 0.0).count();
    let losing_trades = positions.iter().filter(|&&p| p < 0.0).count();
    
    let win_rate = if total_trades > 0 {
        (winning_trades as f64 / total_trades as f64) * 100.0
    } else {
        0.0
    };
    
    let profits: Vec<f64> = positions.iter().filter(|&&p| p > 0.0).copied().collect();
    let losses: Vec<f64> = positions.iter().filter(|&&p| p < 0.0).copied().collect();
    
    let average_profit = if !profits.is_empty() {
        profits.iter().sum::<f64>() / profits.len() as f64
    } else {
        0.0
    };
    
    let average_loss = if !losses.is_empty() {
        losses.iter().sum::<f64>() / losses.len() as f64
    } else {
        0.0
    };
    
    let largest_win = profits.iter().copied().fold(0.0, f64::max);
    let largest_loss = losses.iter().copied().fold(0.0, f64::min);
    let total_volume = positions.iter().map(|p| p.abs()).sum();
    
    PortfolioStats {
        total_trades,
        winning_trades,
        losing_trades,
        win_rate,
        average_profit,
        average_loss,
        largest_win,
        largest_loss,
        total_volume,
    }
}
