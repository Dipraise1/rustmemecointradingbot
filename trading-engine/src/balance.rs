// Balance Checking Module - Production Ready
use serde::Serialize;
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

#[derive(Debug, Serialize, Clone)]
pub struct WalletBalance {
    pub chain: String,
    pub address: String,
    pub native_balance: String,
    pub native_balance_usd: f64,
    pub token_balances: Vec<TokenBalance>,
    pub total_usd: f64,
    pub last_updated: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct TokenBalance {
    pub token: String,
    pub symbol: String,
    pub balance: String,
    pub balance_usd: f64,
}

/// Get Solana balance with retry logic and fallback RPC endpoints
pub async fn get_solana_balance(
    address: &str,
    client: &RpcClient,
) -> Result<WalletBalance, String> {
    let pubkey = Pubkey::from_str(address)
        .map_err(|e| format!("Invalid address: {}", e))?;
    
    // Try primary RPC client first
    let mut lamports = match client.get_balance(&pubkey) {
        Ok(balance) => Ok(balance),
        Err(e) => {
            tracing::warn!("Primary RPC failed: {}, trying fallback endpoints", e);
            // Try fallback RPC endpoints
            try_fallback_rpc_balance(&pubkey).await
        }
    };
    
    // If still failed, try with retries on primary
    if lamports.is_err() {
        lamports = retry_rpc_balance(client, &pubkey, 3).await;
    }
    
    let lamports = lamports.map_err(|e| {
        format!("Failed to get balance after retries: {}. Try again in a moment.", e)
    })?;
    
    let sol_balance = lamports as f64 / 1_000_000_000.0; // Convert lamports to SOL
    let sol_balance_str = format!("{:.9}", sol_balance);
    
    // Fetch real SOL price from price module
    let sol_price_usd = match fetch_sol_price().await {
        Ok(price) => price,
        Err(_) => 100.0, // Fallback price
    };
    let native_balance_usd = sol_balance * sol_price_usd;
    
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    
    let sol_balance_str_clone = sol_balance_str.clone();
    Ok(WalletBalance {
        chain: "solana".to_string(),
        address: address.to_string(),
        native_balance: sol_balance_str,
        native_balance_usd,
        token_balances: vec![
            TokenBalance {
                token: "So11111111111111111111111111111111111111112".to_string(),
                symbol: "SOL".to_string(),
                balance: sol_balance_str_clone,
                balance_usd: native_balance_usd,
            },
        ],
        total_usd: native_balance_usd,
        last_updated: timestamp,
    })
}

/// Retry RPC balance call with exponential backoff
async fn retry_rpc_balance(
    client: &RpcClient,
    pubkey: &Pubkey,
    max_retries: u32,
) -> Result<u64, String> {
    for attempt in 0..max_retries {
        match client.get_balance(pubkey) {
            Ok(balance) => return Ok(balance),
            Err(e) => {
                if attempt < max_retries - 1 {
                    let delay_ms = 100 * (2_u64.pow(attempt)); // Exponential backoff: 100ms, 200ms, 400ms
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
                    tracing::debug!("Retry {} for balance check (delay: {}ms)", attempt + 1, delay_ms);
                } else {
                    return Err(format!("{}", e));
                }
            }
        }
    }
    Err("Max retries exceeded".to_string())
}

/// Try fallback public RPC endpoints
async fn try_fallback_rpc_balance(pubkey: &Pubkey) -> Result<u64, String> {
    let fallback_rpcs = vec![
        "https://api.mainnet-beta.solana.com",
        "https://solana-api.projectserum.com",
        "https://rpc.ankr.com/solana",
    ];
    
    for rpc_url in fallback_rpcs {
        match try_single_rpc_balance(rpc_url, pubkey).await {
            Ok(balance) => {
                tracing::info!("Successfully fetched balance from fallback RPC: {}", rpc_url);
                return Ok(balance);
            }
            Err(e) => {
                tracing::debug!("Fallback RPC {} failed: {}", rpc_url, e);
                continue;
            }
        }
    }
    
    Err("All fallback RPC endpoints failed".to_string())
}

/// Try a single RPC endpoint using HTTP request
async fn try_single_rpc_balance(rpc_url: &str, pubkey: &Pubkey) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getBalance",
        "params": [pubkey.to_string()]
    });
    
    let response = client
        .post(rpc_url)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("RPC request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("RPC returned status: {}", response.status()));
    }
    
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse RPC response: {}", e))?;
    
    let result = json.get("result")
        .and_then(|r| r.get("value"))
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "Invalid RPC response format".to_string())?;
    
    Ok(result)
}

/// Fetch current SOL price
async fn fetch_sol_price() -> Result<f64, String> {
    // Try to fetch from DexScreener or CoinGecko
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    // Try CoinGecko first
    let url = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
    match client.get(url).send().await {
        Ok(response) => {
            if response.status().is_success() {
                if let Ok(json) = response.json::<serde_json::Value>().await {
                    if let Some(price) = json.get("solana")
                        .and_then(|s| s.get("usd"))
                        .and_then(|p| p.as_f64()) {
                        return Ok(price);
                    }
                }
            }
        }
        Err(_) => {}
    }
    
    // Fallback: try DexScreener
    let url = "https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112";
    match client.get(url).send().await {
        Ok(response) => {
            if response.status().is_success() {
                if let Ok(json) = response.json::<serde_json::Value>().await {
                    if let Some(pairs) = json.get("pairs").and_then(|p| p.as_array()) {
                        if let Some(pair) = pairs.first() {
                            if let Some(price) = pair.get("priceUsd")
                                .and_then(|p| p.as_str())
                                .and_then(|p| p.parse::<f64>().ok()) {
                                return Ok(price);
                            }
                        }
                    }
                }
            }
        }
        Err(_) => {}
    }
    
    Err("Failed to fetch SOL price".to_string())
}

pub async fn get_evm_balance(
    address: &str,
    chain: &str,
) -> Result<WalletBalance, String> {
    // Get primary and fallback RPC URLs
    let (primary_rpc, fallback_rpcs) = match chain {
        "eth" | "ethereum" => {
            let primary = std::env::var("ETH_RPC")
                .unwrap_or_else(|_| "https://eth.llamarpc.com".to_string());
            let fallbacks = vec![
                "https://rpc.ankr.com/eth",
                "https://eth.llamarpc.com",
                "https://ethereum.publicnode.com",
            ];
            (primary, fallbacks)
        }
        "bsc" | "binance" => {
            let primary = std::env::var("BSC_RPC")
                .unwrap_or_else(|_| "https://bsc-dataseed.binance.org/".to_string());
            let fallbacks = vec![
                "https://bsc-dataseed1.binance.org/",
                "https://bsc-dataseed2.binance.org/",
                "https://rpc.ankr.com/bsc",
            ];
            (primary, fallbacks)
        }
        _ => return Err("Unsupported chain".to_string()),
    };
    
    // Try primary RPC first
    let mut balance_result = try_evm_rpc_balance(&primary_rpc, address).await;
    
    // If primary fails, try fallbacks
    if balance_result.is_err() {
        tracing::warn!("Primary EVM RPC failed, trying fallbacks");
        for fallback_rpc in &fallback_rpcs {
            if *fallback_rpc != primary_rpc {
                balance_result = try_evm_rpc_balance(fallback_rpc, address).await;
                if balance_result.is_ok() {
                    tracing::info!("Successfully fetched balance from fallback RPC: {}", fallback_rpc);
                    break;
                }
            }
        }
    }
    
    // If still failed, retry primary with exponential backoff
    if balance_result.is_err() {
        balance_result = retry_evm_rpc_balance(&primary_rpc, address, 3).await;
    }
    
    let balance_wei = balance_result.map_err(|e| {
        format!("Failed to get balance after retries: {}. Try again in a moment.", e)
    })?;
    
    let (native_balance, symbol, decimals) = match chain {
        "eth" | "ethereum" => {
            let eth = balance_wei as f64 / 1e18;
            (format!("{:.9}", eth), "ETH", 18)
        }
        "bsc" | "binance" => {
            let bnb = balance_wei as f64 / 1e18;
            (format!("{:.9}", bnb), "BNB", 18)
        }
        _ => return Err("Unsupported chain".to_string()),
    };
    
    // Fetch real price
    let native_price_usd = match fetch_evm_price(chain).await {
        Ok(price) => price,
        Err(_) => match chain {
            "eth" | "ethereum" => 2000.0,
            "bsc" | "binance" => 300.0,
            _ => 0.0,
        }
    };
    
    let native_balance_f64 = balance_wei as f64 / 10_f64.powi(decimals);
    let native_balance_usd = native_balance_f64 * native_price_usd;
    
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    
    Ok(WalletBalance {
        chain: chain.to_string(),
        address: address.to_string(),
        native_balance: native_balance.clone(),
        native_balance_usd,
        token_balances: vec![
            TokenBalance {
                token: address.to_string(),
                symbol: symbol.to_string(),
                balance: native_balance,
                balance_usd: native_balance_usd,
            },
        ],
        total_usd: native_balance_usd,
        last_updated: timestamp,
    })
}

/// Try a single EVM RPC call
async fn try_evm_rpc_balance(rpc_url: &str, address: &str) -> Result<u128, String> {
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "eth_getBalance",
        "params": [address, "latest"],
        "id": 1
    });
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .post(rpc_url)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("RPC request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("RPC returned status: {}", response.status()));
    }
    
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse RPC response: {}", e))?;
    
    // Check for RPC error
    if let Some(error) = json.get("error") {
        let error_msg = error.get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown RPC error");
        return Err(format!("RPC error: {}", error_msg));
    }
    
    let balance_hex = json.get("result")
        .and_then(|r| r.as_str())
        .ok_or_else(|| "Invalid RPC response format".to_string())?;
    
    // Convert hex to decimal
    u128::from_str_radix(balance_hex.strip_prefix("0x").unwrap_or(balance_hex), 16)
        .map_err(|e| format!("Failed to parse balance: {}", e))
}

/// Retry EVM RPC with exponential backoff
async fn retry_evm_rpc_balance(
    rpc_url: &str,
    address: &str,
    max_retries: u32,
) -> Result<u128, String> {
    for attempt in 0..max_retries {
        match try_evm_rpc_balance(rpc_url, address).await {
            Ok(balance) => return Ok(balance),
            Err(e) => {
                if attempt < max_retries - 1 {
                    let delay_ms = 100 * (2_u64.pow(attempt));
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
                    tracing::debug!("Retry {} for EVM balance (delay: {}ms)", attempt + 1, delay_ms);
                } else {
                    return Err(e);
                }
            }
        }
    }
    Err("Max retries exceeded".to_string())
}

/// Fetch EVM token price
async fn fetch_evm_price(chain: &str) -> Result<f64, String> {
    let coin_id = match chain {
        "eth" | "ethereum" => "ethereum",
        "bsc" | "binance" => "binancecoin",
        _ => return Err("Unsupported chain".to_string()),
    };
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let url = format!("https://api.coingecko.com/api/v3/simple/price?ids={}&vs_currencies=usd", coin_id);
    match client.get(&url).send().await {
        Ok(response) => {
            if response.status().is_success() {
                if let Ok(json) = response.json::<serde_json::Value>().await {
                    if let Some(price) = json.get(coin_id)
                        .and_then(|c| c.get("usd"))
                        .and_then(|p| p.as_f64()) {
                        return Ok(price);
                    }
                }
            }
        }
        Err(_) => {}
    }
    
    Err("Failed to fetch price".to_string())
}
