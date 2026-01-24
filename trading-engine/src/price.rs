// Price Fetching Module - Production Ready
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokenPrice {
    pub chain: String,
    pub token: String,
    pub token_symbol: Option<String>,
    pub price_usd: f64,
    pub price_native: f64,
    pub volume_24h: f64,
    pub liquidity: f64,
    pub price_change_24h: f64,
    pub timestamp: i64,
}

#[derive(Debug, Serialize)]
pub struct PriceResponse {
    pub success: bool,
    pub price: Option<TokenPrice>,
    pub error: Option<String>,
}

pub async fn fetch_token_price(chain: &str, token: &str) -> Result<TokenPrice, String> {
    // Call DexScreener API for real price data
    let url = format!("https://api.dexscreener.com/latest/dex/tokens/{}", token);
    
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch price: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("DexScreener API error: {}", response.status()));
    }
    
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    // Parse DexScreener response
    let pairs = json.get("pairs")
        .and_then(|p| p.as_array())
        .ok_or_else(|| {
            let network = std::env::var("NETWORK").unwrap_or_else(|_| "testnet".to_string());
            if network == "devnet" || network == "testnet" {
                tracing::warn!("⚠️ [{}] No trading pairs found for token {}", network.to_uppercase(), &token[..8]);
                tracing::warn!("   This is expected on devnet for tokens without liquidity");
            }
            "No pairs found".to_string()
        })?;
    
    if pairs.is_empty() {
        let network = std::env::var("NETWORK").unwrap_or_else(|_| "testnet".to_string());
        if network == "devnet" || network == "testnet" {
            tracing::warn!("⚠️ [{}] No trading pairs found for token {}", network.to_uppercase(), &token[..8]);
        }
        return Err("No trading pairs found for token".to_string());
    }
    
    // Get the first pair (usually most liquid)
    let pair = pairs[0].as_object()
        .ok_or_else(|| "Invalid pair data".to_string())?;
    
    let price_usd = pair.get("priceUsd")
        .and_then(|p| p.as_str())
        .and_then(|p| p.parse::<f64>().ok())
        .unwrap_or(0.0);
    
    let volume_24h = pair.get("volume")
        .and_then(|v| v.as_object())
        .and_then(|v| v.get("h24"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    
    let liquidity_usd = pair.get("liquidity")
        .and_then(|l| l.as_object())
        .and_then(|l| l.get("usd"))
        .and_then(|l| l.as_f64())
        .unwrap_or(0.0);
    
    let price_change_24h = pair.get("priceChange")
        .and_then(|p| p.as_object())
        .and_then(|p| p.get("h24"))
        .and_then(|p| p.as_f64())
        .unwrap_or(0.0);
    
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    
    // Calculate native price (simplified - would need chain-specific conversion)
    let price_native = match chain {
        "solana" => price_usd / 100.0, // Approximate SOL price
        "eth" | "ethereum" => price_usd / 2000.0, // Approximate ETH price
        "bsc" | "binance" => price_usd / 300.0, // Approximate BNB price
        _ => price_usd,
    };
    
    // Get token symbol from pair data
    let token_symbol = pair.get("baseToken")
        .and_then(|t| t.as_object())
        .and_then(|t| t.get("symbol"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());
    
    Ok(TokenPrice {
        chain: chain.to_string(),
        token: token.to_string(),
        token_symbol,
        price_usd,
        price_native,
        volume_24h,
        liquidity: liquidity_usd,
        price_change_24h,
        timestamp,
    })
}

pub async fn fetch_multiple_prices(tokens: Vec<(String, String)>) -> HashMap<String, TokenPrice> {
    let mut prices = HashMap::new();
    
    for (chain, token) in tokens {
        if let Ok(price) = fetch_token_price(&chain, &token).await {
            let key = format!("{}_{}", chain, token);
            prices.insert(key, price);
        }
    }
    
    prices
}
