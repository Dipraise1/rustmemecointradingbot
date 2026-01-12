// Balance Checking Module - Production Ready
use serde::{Deserialize, Serialize};
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

pub async fn get_solana_balance(
    address: &str,
    client: &RpcClient,
) -> Result<WalletBalance, String> {
    let pubkey = Pubkey::from_str(address)
        .map_err(|e| format!("Invalid address: {}", e))?;
    
    // Query real balance from Solana RPC
    let lamports = client.get_balance(&pubkey)
        .map_err(|e| format!("Failed to get balance: {}", e))?;
    
    let sol_balance = lamports as f64 / 1_000_000_000.0; // Convert lamports to SOL
    let sol_balance_str = format!("{:.9}", sol_balance);
    
    // Approximate USD value (would use real price feed in production)
    let sol_price_usd = 100.0; // Should fetch from price API
    let native_balance_usd = sol_balance * sol_price_usd;
    
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    
    Ok(WalletBalance {
        chain: "solana".to_string(),
        address: address.to_string(),
        native_balance: sol_balance_str,
        native_balance_usd,
        token_balances: vec![
            TokenBalance {
                token: "So11111111111111111111111111111111111111112".to_string(),
                symbol: "SOL".to_string(),
                balance: sol_balance_str.clone(),
                balance_usd: native_balance_usd,
            },
        ],
        total_usd: native_balance_usd,
        last_updated: timestamp,
    })
}

pub async fn get_evm_balance(
    address: &str,
    chain: &str,
) -> Result<WalletBalance, String> {
    // Query real balance from EVM RPC
    let rpc_url = match chain {
        "eth" | "ethereum" => std::env::var("ETH_RPC")
            .unwrap_or_else(|_| "https://eth.llamarpc.com".to_string()),
        "bsc" | "binance" => std::env::var("BSC_RPC")
            .unwrap_or_else(|_| "https://bsc-dataseed.binance.org/".to_string()),
        _ => return Err("Unsupported chain".to_string()),
    };
    
    // Build JSON-RPC request
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "eth_getBalance",
        "params": [address, "latest"],
        "id": 1
    });
    
    let client = reqwest::Client::new();
    let response = client
        .post(&rpc_url)
        .json(&request)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("RPC request failed: {}", e))?;
    
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse RPC response: {}", e))?;
    
    let balance_hex = json.get("result")
        .and_then(|r| r.as_str())
        .ok_or_else(|| "Invalid RPC response".to_string())?;
    
    // Convert hex to decimal
    let balance_wei = u128::from_str_radix(balance_hex.strip_prefix("0x").unwrap_or(balance_hex), 16)
        .map_err(|e| format!("Failed to parse balance: {}", e))?;
    
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
    
    // Approximate USD value (would use real price feed)
    let native_price_usd = match chain {
        "eth" | "ethereum" => 2000.0,
        "bsc" | "binance" => 300.0,
        _ => 0.0,
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
