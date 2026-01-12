// Transaction History Module - Production Ready
use serde::{Deserialize, Serialize};
use chrono::Utc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub user_id: i64,
    pub chain: String,
    pub tx_type: String, // "buy", "sell", "transfer"
    pub token: String,
    pub amount: String,
    pub price: f64,
    pub tx_hash: String,
    pub status: String, // "pending", "confirmed", "failed"
    pub timestamp: i64,
    pub gas_fee: Option<String>,
    pub profit_loss: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct TransactionHistory {
    pub user_id: i64,
    pub transactions: Vec<Transaction>,
    pub total_trades: usize,
    pub total_volume: f64,
    pub total_fees: f64,
}

pub fn create_transaction(
    user_id: i64,
    chain: String,
    tx_type: String,
    token: String,
    amount: String,
    price: f64,
    tx_hash: String,
    gas_fee: Option<String>,
) -> Transaction {
    Transaction {
        id: format!("{}_{}", user_id, Utc::now().timestamp_millis()),
        user_id,
        chain,
        tx_type,
        token,
        amount,
        price,
        tx_hash,
        status: "confirmed".to_string(),
        timestamp: Utc::now().timestamp(),
        gas_fee,
        profit_loss: None,
    }
}

pub fn calculate_history_stats(transactions: &[Transaction]) -> TransactionHistory {
    let total_trades = transactions.len();
    let total_volume: f64 = transactions
        .iter()
        .filter(|t| t.tx_type == "buy" || t.tx_type == "sell")
        .map(|t| t.amount.parse::<f64>().unwrap_or(0.0) * t.price)
        .sum();
    
    let total_fees: f64 = transactions
        .iter()
        .filter_map(|t| t.gas_fee.as_ref())
        .map(|f| f.parse::<f64>().unwrap_or(0.0))
        .sum();
    
    TransactionHistory {
        user_id: transactions.first().map(|t| t.user_id).unwrap_or(0),
        transactions: transactions.to_vec(),
        total_trades,
        total_volume,
        total_fees,
    }
}
