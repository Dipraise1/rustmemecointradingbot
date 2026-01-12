// Notifications & Alerts Module - Production Ready
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alert {
    pub user_id: i64,
    pub alert_type: String, // "tp", "sl", "price", "balance"
    pub chain: Option<String>,
    pub token: Option<String>,
    pub threshold: f64,
    pub condition: String, // "above", "below", "equals"
    pub active: bool,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct Notification {
    pub user_id: i64,
    pub message: String,
    pub alert_type: String,
    pub timestamp: i64,
    pub priority: String, // "low", "medium", "high", "critical"
}

pub fn create_notification(
    user_id: i64,
    message: String,
    alert_type: String,
    priority: String,
) -> Notification {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    
    Notification {
        user_id,
        message,
        alert_type,
        timestamp,
        priority,
    }
}

pub fn check_alert_triggered(
    alert: &Alert,
    current_value: f64,
) -> bool {
    match alert.condition.as_str() {
        "above" => current_value >= alert.threshold,
        "below" => current_value <= alert.threshold,
        "equals" => (current_value - alert.threshold).abs() < 0.0001,
        _ => false,
    }
}

pub fn format_notification_message(notification: &Notification) -> String {
    let emoji = match notification.priority.as_str() {
        "critical" => "🔴",
        "high" => "🟠",
        "medium" => "🟡",
        _ => "🔵",
    };
    
    format!("{} {}: {}", emoji, notification.alert_type.to_uppercase(), notification.message)
}
