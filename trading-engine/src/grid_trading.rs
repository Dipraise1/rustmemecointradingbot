// Grid Trading Module - Production Ready
// Automated trading strategy that profits from sideways market movement

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::Utc;
use uuid::Uuid;

// ==================== DATA STRUCTURES ====================
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridStrategy {
    pub strategy_id: String,
    pub user_id: i64,
    pub chain: String,
    pub token: String,
    pub token_symbol: String,
    pub lower_price: f64,
    pub upper_price: f64,
    pub grid_count: usize,
    pub grid_spacing: f64,
    pub investment_amount: f64,
    pub status: GridStatus,
    pub created_at: i64,
    pub last_price: f64,
    pub total_profit: f64,
    pub total_trades: usize,
    pub active_orders: Vec<GridOrder>,
    pub completed_orders: Vec<GridOrder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridOrder {
    pub order_id: String,
    pub order_type: OrderType,
    pub price: f64,
    pub amount: f64,
    pub status: OrderStatus,
    pub filled_at: Option<i64>,
    pub filled_price: Option<f64>,
    pub profit: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderType {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderStatus {
    Pending,
    Active,
    Filled,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GridStatus {
    Active,
    Paused,
    Stopped,
    Completed,
}

#[derive(Debug, Deserialize)]
pub struct CreateGridRequest {
    pub user_id: i64,
    pub chain: String,
    pub token: String,
    pub token_symbol: String,
    pub lower_price: f64,
    pub upper_price: f64,
    pub grid_count: usize,
    pub investment_amount: f64,
}

#[derive(Debug, Serialize)]
pub struct GridResponse {
    pub success: bool,
    pub strategy_id: Option<String>,
    pub message: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GridStats {
    pub strategy_id: String,
    pub status: String,
    pub total_profit: f64,
    pub total_profit_percent: f64,
    pub total_trades: usize,
    pub active_orders: usize,
    pub completed_orders: usize,
    pub current_price: f64,
    pub price_range: (f64, f64),
    pub grid_levels: Vec<GridLevel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridLevel {
    pub level: usize,
    pub price: f64,
    pub buy_order: Option<GridOrder>,
    pub sell_order: Option<GridOrder>,
    pub profit: f64,
}

// ==================== GRID CREATION ====================
pub fn create_grid_strategy(request: CreateGridRequest) -> Result<GridStrategy, String> {
    // Validate inputs
    if request.lower_price >= request.upper_price {
        return Err("Lower price must be less than upper price".to_string());
    }
    
    if request.grid_count < 2 {
        return Err("Grid count must be at least 2".to_string());
    }
    
    if request.investment_amount <= 0.0 {
        return Err("Investment amount must be positive".to_string());
    }
    
    // Calculate grid spacing
    let price_range = request.upper_price - request.lower_price;
    let grid_spacing = price_range / (request.grid_count - 1) as f64;
    
    // Create initial buy orders at each grid level
    let amount_per_level = request.investment_amount / request.grid_count as f64;
    let mut active_orders = Vec::new();
    
    for i in 0..request.grid_count {
        let price = request.lower_price + (grid_spacing * i as f64);
        let order = GridOrder {
            order_id: format!("grid_{}_{}", Uuid::new_v4(), i),
            order_type: OrderType::Buy,
            price,
            amount: amount_per_level,
            status: OrderStatus::Pending,
            filled_at: None,
            filled_price: None,
            profit: None,
        };
        active_orders.push(order);
    }
    
    Ok(GridStrategy {
        strategy_id: format!("grid_{}_{}", request.user_id, Uuid::new_v4()),
        user_id: request.user_id,
        chain: request.chain,
        token: request.token,
        token_symbol: request.token_symbol,
        lower_price: request.lower_price,
        upper_price: request.upper_price,
        grid_count: request.grid_count,
        grid_spacing,
        investment_amount: request.investment_amount,
        status: GridStatus::Active,
        created_at: Utc::now().timestamp(),
        last_price: (request.lower_price + request.upper_price) / 2.0,
        total_profit: 0.0,
        total_trades: 0,
        active_orders,
        completed_orders: Vec::new(),
    })
}

// ==================== GRID EXECUTION ====================
pub fn update_grid_with_price(
    strategy: &mut GridStrategy,
    current_price: f64,
) -> Vec<GridOrder> {
    strategy.last_price = current_price;
    let mut new_orders = Vec::new();
    
    // Check if price is within grid range
    if current_price < strategy.lower_price || current_price > strategy.upper_price {
        // Price out of range - pause strategy
        if matches!(strategy.status, GridStatus::Active) {
            strategy.status = GridStatus::Paused;
        }
        return new_orders;
    }
    
    // Reactivate if price comes back into range
    if matches!(strategy.status, GridStatus::Paused) {
        strategy.status = GridStatus::Active;
    }
    
    // Process active buy orders that should be filled
    let mut orders_to_fill: Vec<usize> = Vec::new();
    for (idx, order) in strategy.active_orders.iter().enumerate() {
        if matches!(order.order_type, OrderType::Buy) 
            && matches!(order.status, OrderStatus::Pending | OrderStatus::Active)
            && current_price <= order.price {
            // Price dropped to or below buy order - fill it
            orders_to_fill.push(idx);
        }
    }
    
    // Fill buy orders (price dropped)
    for &idx in orders_to_fill.iter().rev() {
        let mut order = strategy.active_orders.remove(idx);
        order.status = OrderStatus::Filled;
        order.filled_at = Some(Utc::now().timestamp());
        order.filled_price = Some(current_price);
        
        // Create corresponding sell order at next grid level
        let sell_price = order.price + strategy.grid_spacing;
        if sell_price <= strategy.upper_price {
            let sell_order = GridOrder {
                order_id: format!("grid_sell_{}", Uuid::new_v4()),
                order_type: OrderType::Sell,
                price: sell_price,
                amount: order.amount,
                status: OrderStatus::Pending,
                filled_at: None,
                filled_price: None,
                profit: None,
            };
            strategy.active_orders.push(sell_order.clone());
            new_orders.push(sell_order);
        }
        
        strategy.completed_orders.push(order);
        strategy.total_trades += 1;
    }
    
    // Process active sell orders that should be filled
    let mut sell_orders_to_fill: Vec<usize> = Vec::new();
    for (idx, order) in strategy.active_orders.iter().enumerate() {
        if matches!(order.order_type, OrderType::Sell)
            && matches!(order.status, OrderStatus::Pending | OrderStatus::Active)
            && current_price >= order.price {
            // Price rose to or above sell order - fill it
            sell_orders_to_fill.push(idx);
        }
    }
    
    // Fill sell orders (price rose)
    for &idx in sell_orders_to_fill.iter().rev() {
        let mut order = strategy.active_orders.remove(idx);
        order.status = OrderStatus::Filled;
        order.filled_at = Some(Utc::now().timestamp());
        order.filled_price = Some(current_price);
        
        // Calculate profit
        if let Some(buy_order) = strategy.completed_orders.iter()
            .find(|o| matches!(o.order_type, OrderType::Buy) && o.price < order.price) {
            let profit = (order.price - buy_order.price) / buy_order.price * 100.0;
            let profit_usd = order.amount * (order.price - buy_order.price);
            order.profit = Some(profit);
            strategy.total_profit += profit_usd;
        }
        
        // Create new buy order at lower grid level
        let buy_price = order.price - strategy.grid_spacing;
        if buy_price >= strategy.lower_price {
            let buy_order = GridOrder {
                order_id: format!("grid_buy_{}", Uuid::new_v4()),
                order_type: OrderType::Buy,
                price: buy_price,
                amount: order.amount,
                status: OrderStatus::Pending,
                filled_at: None,
                filled_price: None,
                profit: None,
            };
            strategy.active_orders.push(buy_order.clone());
            new_orders.push(buy_order);
        }
        
        strategy.completed_orders.push(order);
        strategy.total_trades += 1;
    }
    
    new_orders
}

// ==================== GRID STATS ====================
pub fn get_grid_stats(strategy: &GridStrategy, current_price: f64) -> GridStats {
    let mut grid_levels = Vec::new();
    
    for i in 0..strategy.grid_count {
        let price = strategy.lower_price + (strategy.grid_spacing * i as f64);
        
        let buy_order = strategy.active_orders.iter()
            .find(|o| matches!(o.order_type, OrderType::Buy) && (o.price - price).abs() < 0.0001)
            .cloned();
        
        let sell_order = strategy.active_orders.iter()
            .find(|o| matches!(o.order_type, OrderType::Sell) && (o.price - price).abs() < 0.0001)
            .cloned();
        
        // Calculate profit at this level
        let mut profit = 0.0;
        if let Some(sell) = &sell_order {
            if let Some(buy) = &buy_order {
                profit = (sell.price - buy.price) / buy.price * 100.0;
            }
        }
        
        grid_levels.push(GridLevel {
            level: i + 1,
            price,
            buy_order,
            sell_order,
            profit,
        });
    }
    
    let total_profit_percent = if strategy.investment_amount > 0.0 {
        (strategy.total_profit / strategy.investment_amount) * 100.0
    } else {
        0.0
    };
    
    GridStats {
        strategy_id: strategy.strategy_id.clone(),
        status: format!("{:?}", strategy.status),
        total_profit: strategy.total_profit,
        total_profit_percent,
        total_trades: strategy.total_trades,
        active_orders: strategy.active_orders.len(),
        completed_orders: strategy.completed_orders.len(),
        current_price,
        price_range: (strategy.lower_price, strategy.upper_price),
        grid_levels,
    }
}

// ==================== GRID MANAGEMENT ====================
pub fn pause_grid(strategy: &mut GridStrategy) {
    strategy.status = GridStatus::Paused;
}

pub fn resume_grid(strategy: &mut GridStrategy) {
    if matches!(strategy.status, GridStatus::Paused) {
        strategy.status = GridStatus::Active;
    }
}

pub fn stop_grid(strategy: &mut GridStrategy) {
    strategy.status = GridStatus::Stopped;
    // Cancel all pending orders
    for order in &mut strategy.active_orders {
        if matches!(order.status, OrderStatus::Pending | OrderStatus::Active) {
            order.status = OrderStatus::Cancelled;
        }
    }
}

// ==================== WHALE INTEGRATION ====================
/// Adjust grid strategy based on whale activity
pub fn adjust_grid_for_whale_activity(
    strategy: &mut GridStrategy,
    whale_impact: &str, // "critical", "high", "medium", "low"
    price_impact: f64,
    current_price: f64,
) -> Vec<String> {
    let mut actions = Vec::new();
    
    match whale_impact {
        "critical" => {
            // Pause grid immediately
            if matches!(strategy.status, GridStatus::Active) {
                strategy.status = GridStatus::Paused;
                actions.push("Grid paused due to critical whale activity".to_string());
            }
        },
        "high" => {
            // Widen grid spacing to handle volatility
            let volatility_multiplier = 1.0 + (price_impact / 100.0).min(0.5); // Max 50% wider
            strategy.grid_spacing *= volatility_multiplier;
            
            // Adjust price range if price moved significantly
            let price_change_pct = ((current_price - strategy.last_price) / strategy.last_price).abs();
            if price_change_pct > 0.05 { // 5% price change
                // Expand range by 20%
                let range_expansion = (strategy.upper_price - strategy.lower_price) * 0.2;
                strategy.lower_price = (strategy.lower_price - range_expansion / 2.0).max(0.0);
                strategy.upper_price += range_expansion / 2.0;
                actions.push(format!("Grid range expanded by {:.2}% due to whale activity", price_change_pct * 100.0));
            }
            
            actions.push("Grid spacing widened for high volatility".to_string());
        },
        "medium" => {
            // Slightly widen spacing
            strategy.grid_spacing *= 1.1; // 10% wider
            actions.push("Grid spacing slightly widened".to_string());
        },
        _ => {
            // Low impact - no changes needed
        }
    }
    
    actions
}

/// Check if grid should be paused based on whale activity
pub fn should_pause_grid_for_whale(
    strategy: &GridStrategy,
    whale_impact: &str,
    price_impact: f64,
    velocity_score: f64,
) -> bool {
    match whale_impact {
        "critical" => true,
        "high" => {
            // Pause if high velocity (rapid trades) or very high price impact
            velocity_score > 0.7 || price_impact > 8.0
        },
        _ => false,
    }
}

/// Dynamically adjust grid parameters based on market volatility from whale activity
pub fn optimize_grid_for_volatility(
    strategy: &mut GridStrategy,
    avg_volatility: f64, // Average price movement percentage
    whale_activity_level: f64, // 0.0 to 1.0
) {
    // Increase grid spacing in high volatility periods
    let volatility_adjustment = 1.0 + (avg_volatility * whale_activity_level * 0.5);
    strategy.grid_spacing *= volatility_adjustment;
    
    // Reduce number of active orders if volatility is extreme
    if avg_volatility > 0.10 && whale_activity_level > 0.7 {
        // Cancel some pending orders to reduce exposure
        let orders_to_cancel = strategy.active_orders.len() / 4; // Cancel 25%
        for (i, order) in strategy.active_orders.iter_mut().enumerate() {
            if i < orders_to_cancel && matches!(order.status, OrderStatus::Pending) {
                order.status = OrderStatus::Cancelled;
            }
        }
    }
}
