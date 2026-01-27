use serde::{Deserialize, Serialize};
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokenAnalysisResponse {
    pub token: String,
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub price_usd: f64,
    pub market_cap: f64,
    pub fdv: f64,
    pub liquidity_usd: f64,
    pub volume_24h: f64,
    pub pair_age_hours: f64,
    pub bundler_score: f64, // 0-100 (100 = High Risk)
    pub total_score: f64,   // 0-100 (100 = Perfect Gem)
    pub risk_flags: Vec<String>,
    pub bundler_details: Option<BundlerDetails>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BundlerDetails {
    pub creator_address: String,
    pub creator_balance_sol: f64,
    pub initial_buy_count: usize,
    pub bundled_percentage: f64, // % of supply bought by bundler wallets
    pub suspicious_wallets: Vec<String>,
}

pub async fn check_token_handler(
    State(state): State<AppState>,
    Path((chain, token)): Path<(String, String)>,
) -> impl IntoResponse {
    // 1. Fetch DexScreener Data
    let dex_data = match fetch_dex_data(&token).await {
        Ok(data) => data,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response(),
    };

    // 2. Perform Bundler Analysis (Solana only)
    let bundler_analysis = if chain == "solana" || chain == "sol" {
        analyze_solana_bundler(&token, &state.solana_client).await
    } else {
        None
    };

    // 3. Calculate Scores
    let (total_score, risk_flags) = calculate_scores(&dex_data, &bundler_analysis);

    let response = TokenAnalysisResponse {
        token,
        name: dex_data.name,
        symbol: dex_data.symbol,
        price_usd: dex_data.price_usd,
        market_cap: dex_data.market_cap,
        fdv: dex_data.fdv,
        liquidity_usd: dex_data.liquidity,
        volume_24h: dex_data.volume,
        pair_age_hours: dex_data.pair_age_hours,
        bundler_score: bundler_analysis.as_ref().map(|b| b.bundled_percentage * 100.0).unwrap_or(0.0), // Simplified
        total_score,
        risk_flags,
        bundler_details: bundler_analysis,
    };

    (StatusCode::OK, Json(response)).into_response()
}

// ==================== DEXSCREENER ====================

struct DexData {
    name: Option<String>,
    symbol: Option<String>,
    price_usd: f64,
    market_cap: f64,
    fdv: f64,
    liquidity: f64,
    volume: f64,
    pair_age_hours: f64,
}

async fn fetch_dex_data(token: &str) -> Result<DexData, String> {
    let url = format!("https://api.dexscreener.com/latest/dex/tokens/{}", token);
    let client = reqwest::Client::new();
    
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let pairs = json.get("pairs").and_then(|p| p.as_array()).ok_or("No pairs found")?;
    if pairs.is_empty() { return Err("No pairs found".to_string()); }
    
    // Take best pair
    let pair = &pairs[0]; 
    
    let name = pair["baseToken"]["name"].as_str().map(|s| s.to_string());
    let symbol = pair["baseToken"]["symbol"].as_str().map(|s| s.to_string());
    let price_usd = pair["priceUsd"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let liquidity = pair["liquidity"]["usd"].as_f64().unwrap_or(0.0);
    let volume = pair["volume"]["h24"].as_f64().unwrap_or(0.0);
    let fdv = pair["fdv"].as_f64().unwrap_or(0.0);
    let market_cap = pair["marketCap"].as_f64().unwrap_or(fdv); // Fallback to FDV
    
    let pair_created = pair["pairCreatedAt"].as_i64().unwrap_or(0);
    let age_hours = if pair_created > 0 {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
        (now - pair_created) as f64 / 3600000.0
    } else {
        0.0
    };

    Ok(DexData {
        name,
        symbol,
        price_usd,
        market_cap,
        fdv,
        liquidity,
        volume,
        pair_age_hours: age_hours,
    })
}

// ==================== BUNDLER DETECTION ====================

async fn analyze_solana_bundler(token: &str, client: &Arc<RpcClient>) -> Option<BundlerDetails> {
    // REAL LOGIC TO BE IMPLEMENTED:
    // 1. Get signaturesForAddress (earliest)
    // 2. Scan first 50 txs
    // 3. Count how many buy txs funded by same source
    
    // Mock simulation for now to establish architecture (or basic implementation)
    // Implementing basic parsing is complex without extensive logging, 
    // so we'll start with a robust placeholder that hints at real logic.
    
    let pubkey = Pubkey::from_str(token).ok()?;
    
    // Attempt to fetch first signatures (limit 20)
    // Note: ensure we are fetching earliest. get_signatures_for_address_with_config needed.
    // For now, let's just assume we check recent for a rapid "live" check or minimal check.
    
    Some(BundlerDetails {
        creator_address: "Unknown".to_string(),
        creator_balance_sol: 0.0,
        initial_buy_count: 0,
        bundled_percentage: 0.0,
        suspicious_wallets: vec![],
    })
}

// ==================== SCORING ====================

fn calculate_scores(dex: &DexData, bundler: &Option<BundlerDetails>) -> (f64, Vec<String>) {
    let mut score: f64 = 50.0;
    let mut flags = Vec::new();

    // 1. Liquidity Check
    if dex.liquidity > 100_000.0 { score += 20.0; }
    else if dex.liquidity < 5_000.0 { score -= 20.0; flags.push("Low Liquidity".to_string()); }

    // 2. Volume Check
    if dex.volume > dex.liquidity { score += 10.0; } // High interest
    
    // 3. Age Check
    if dex.pair_age_hours < 1.0 { 
        flags.push("Review: Brand New Pair".to_string()); 
        // Could be gem or rug
    } else {
        score += 10.0;
    }

    // 4. Bundler Check (Simple Logic)
    if let Some(b) = bundler {
        if b.bundled_percentage > 30.0 {
            score -= 40.0;
            flags.push(format!("High Bundler Risk ({}%)", b.bundled_percentage));
        }
    }

    // Clamp
    score = score.clamp(0.0, 100.0);
    (score, flags)
}
