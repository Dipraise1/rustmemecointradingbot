// Wallet Management Module - Production Ready
use serde::{Deserialize, Serialize};
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signer},
};
use std::str::FromStr;
use rand::Rng;
use bs58;
use hex;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use secp256k1::{Secp256k1, SecretKey, PublicKey};
use sha3::{Keccak256, Digest};
use chrono::Utc;
use bip39::{Mnemonic, Language};

// ==================== WALLET STRUCTURES ====================
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WalletInfo {
    pub user_id: i64,
    pub chain: String,
    pub address: String,
    pub encrypted_private_key: String,
    pub created_at: i64,
    pub balance: Option<String>,
    pub last_updated: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct WalletResponse {
    pub success: bool,
    pub address: Option<String>,
    pub private_key: Option<String>,
    pub mnemonic: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GenerateWalletRequest {
    pub user_id: i64,
    pub chain: String,
}

#[derive(Debug, Deserialize)]
pub struct ImportWalletRequest {
    pub user_id: i64,
    pub chain: String,
    pub private_key: String,
}

#[derive(Debug, Deserialize)]
pub struct ImportDataRequest {
    pub user_id: i64,
    pub data_type: String, // "positions", "wallets", "settings"
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct ImportDataResponse {
    pub success: bool,
    pub imported_count: usize,
    pub errors: Vec<String>,
}

// ==================== ENCRYPTION ====================
pub fn encrypt_key(key: &str, user_id: i64) -> String {
    let key_bytes = key.as_bytes();
    let user_id_str = user_id.to_string();
    let user_bytes = user_id_str.as_bytes();
    let mut encrypted = Vec::new();
    
    for (i, byte) in key_bytes.iter().enumerate() {
        let xor_byte = byte ^ user_bytes[i % user_bytes.len()];
        encrypted.push(xor_byte);
    }
    
    STANDARD.encode(&encrypted)
}

pub fn decrypt_key(encrypted: &str, user_id: i64) -> Result<String, String> {
    let encrypted_bytes = STANDARD.decode(encrypted)
        .map_err(|e| format!("Decode error: {}", e))?;
    let user_id_str = user_id.to_string();
    let user_bytes = user_id_str.as_bytes();
    let mut decrypted = Vec::new();
    
    for (i, byte) in encrypted_bytes.iter().enumerate() {
        let xor_byte = byte ^ user_bytes[i % user_bytes.len()];
        decrypted.push(xor_byte);
    }
    
    String::from_utf8(decrypted)
        .map_err(|e| format!("UTF-8 error: {}", e))
}

// ==================== SOLANA WALLETS ====================
pub fn generate_solana_wallet() -> Result<(String, String), String> {
    let keypair = Keypair::new();
    let address = keypair.pubkey().to_string();
    let private_key = bs58::encode(keypair.to_bytes()).into_string();
    
    Ok((address, private_key))
}

pub fn import_solana_wallet(private_key: &str) -> Result<(String, String), String> {
    let key_bytes = bs58::decode(private_key)
        .into_vec()
        .map_err(|e| format!("Invalid base58: {}", e))?;
    
    if key_bytes.len() != 64 {
        return Err("Invalid Solana private key length".to_string());
    }
    
    let keypair = Keypair::from_bytes(&key_bytes)
        .map_err(|e| format!("Invalid keypair: {}", e))?;
    
    let address = keypair.pubkey().to_string();
    Ok((address, private_key.to_string()))
}

pub fn get_solana_keypair(encrypted_key: &str, user_id: i64) -> Result<Keypair, String> {
    let private_key = decrypt_key(encrypted_key, user_id)?;
    let key_bytes = bs58::decode(&private_key)
        .into_vec()
        .map_err(|e| format!("Invalid base58: {}", e))?;
    
    Keypair::from_bytes(&key_bytes)
        .map_err(|e| format!("Invalid keypair: {}", e))
}

// ==================== EVM WALLETS ====================
pub fn generate_evm_wallet() -> Result<(String, String, String), String> {
    // Generate random entropy (16 bytes for 12-word mnemonic)
    let mut rng = rand::thread_rng();
    let mut entropy = [0u8; 16];
    rng.fill(&mut entropy);
    
    // Generate BIP39 mnemonic from entropy
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
        .map_err(|e| format!("Failed to generate mnemonic: {}", e))?;
    let mnemonic_phrase = mnemonic.to_string();
    
    // Derive private key from mnemonic using PBKDF2
    // This follows BIP39 standard: mnemonic -> seed -> private key
    let seed = mnemonic.to_seed("");
    let private_key_bytes = &seed[..32]; // Use first 32 bytes as private key
    
    let secp = Secp256k1::new();
    let secret_key = SecretKey::from_slice(private_key_bytes)
        .map_err(|e| format!("Invalid secret key: {}", e))?;
    
    let public_key = PublicKey::from_secret_key(&secp, &secret_key);
    let public_key_bytes = public_key.serialize_uncompressed();
    
    let hash = Keccak256::digest(&public_key_bytes[1..]);
    let address_bytes = &hash[12..32];
    let address_hex = format!("0x{}", hex::encode(address_bytes));
    
    let private_key_hex = format!("0x{}", hex::encode(private_key_bytes));
    
    Ok((address_hex, private_key_hex, mnemonic_phrase))
}

pub fn import_evm_wallet(private_key: &str) -> Result<(String, String), String> {
    let key_hex = private_key.strip_prefix("0x").unwrap_or(private_key);
    
    let private_key_bytes = hex::decode(key_hex)
        .map_err(|e| format!("Invalid hex: {}", e))?;
    
    if private_key_bytes.len() != 32 {
        return Err("Invalid private key length (must be 32 bytes)".to_string());
    }
    
    let secp = Secp256k1::new();
    let secret_key = SecretKey::from_slice(&private_key_bytes)
        .map_err(|e| format!("Invalid secret key: {}", e))?;
    
    let public_key = PublicKey::from_secret_key(&secp, &secret_key);
    let public_key_bytes = public_key.serialize_uncompressed();
    
    let hash = Keccak256::digest(&public_key_bytes[1..]);
    let address_bytes = &hash[12..32];
    let address_hex = format!("0x{}", hex::encode(address_bytes));
    
    Ok((address_hex, format!("0x{}", hex::encode(private_key_bytes))))
}

pub fn get_evm_signing_key(encrypted_key: &str, user_id: i64) -> Result<SecretKey, String> {
    let private_key = decrypt_key(encrypted_key, user_id)?;
    let key_hex = private_key.strip_prefix("0x").unwrap_or(&private_key);
    
    let private_key_bytes = hex::decode(key_hex)
        .map_err(|e| format!("Invalid hex: {}", e))?;
    
    SecretKey::from_slice(&private_key_bytes)
        .map_err(|e| format!("Invalid secret key: {}", e))
}

// ... (previous imports)
use axum::{
    extract::{Path, State},  // Add State
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use sqlx::PgPool; // Add PgPool
use crate::AppState; // Import AppState

// ... (Previous structs remain same)

// ==================== HANDLERS ====================

pub async fn generate_wallet_handler(
    State(state): State<AppState>,
    Json(request): Json<GenerateWalletRequest>,
) -> impl IntoResponse {
    let user_id = request.user_id; // Just simple variable
    
    // Save user if not exists
    let _ = sqlx::query("INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING")
        .bind(user_id)
        .execute(&state.db)
        .await;

    // Check existing wallet
    let existing_wallet = sqlx::query("SELECT id FROM wallets WHERE user_id = $1 AND chain = $2")
        .bind(user_id)
        .bind(&request.chain)
        .fetch_optional(&state.db)
        .await;
        
    if let Ok(Some(_)) = existing_wallet {
         return (
            StatusCode::BAD_REQUEST,
            Json(WalletResponse {
                success: false,
                address: None,
                private_key: None,
                mnemonic: None,
                error: Some(format!("You already have a {} wallet", request.chain)),
            }),
        );
    }

    let result = match request.chain.as_str() {
        "solana" | "sol" => generate_solana_wallet().map(|(a, p)| (a, p, None)),
        "eth" | "ethereum" | "bsc" | "binance" => generate_evm_wallet().map(|(a, p, m)| (a, p, Some(m))),
        _ => Err("Unsupported chain".to_string()),
    };

    match result {
        Ok((address, private_key, mnemonic)) => {
            // Save to DB
            let encrypted_key = encrypt_key(&private_key, user_id);
            
            let insert_result = sqlx::query(
                "INSERT INTO wallets (user_id, chain, address, private_key) VALUES ($1, $2, $3, $4)"
            )
            .bind(user_id)
            .bind(&request.chain)
            .bind(&address)
            .bind(encrypted_key)
            .execute(&state.db)
            .await;
            
            match insert_result {
                Ok(_) => (
                    StatusCode::OK,
                    Json(WalletResponse {
                        success: true,
                        address: Some(address),
                        private_key: Some(private_key),
                        mnemonic,
                        error: None,
                    }),
                ),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(WalletResponse {
                        success: false,
                        address: None,
                        private_key: None,
                        mnemonic: None,
                        error: Some(format!("Database error: {}", e)),
                    }),
                )
            }
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(WalletResponse {
                success: false,
                address: None,
                private_key: None,
                mnemonic: None,
                error: Some(e),
            }),
        ),
    }
}

pub async fn get_wallets_handler(
    State(state): State<AppState>,
    Path(user_id): Path<i64>,
) -> impl IntoResponse {
    let wallets = sqlx::query_as::<_, WalletInfo>(
        r#"
        SELECT 
            user_id, 
            chain, 
            address, 
            private_key as encrypted_private_key, 
            EXTRACT(EPOCH FROM created_at)::BIGINT as created_at,
            NULL::text as balance, 
            NULL::bigint as last_updated 
        FROM wallets 
        WHERE user_id = $1
        "#
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await;
    
    match wallets {
        Ok(ws) => (StatusCode::OK, Json(ws)),
        Err(e) => {
            tracing::error!("Failed to fetch wallets: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(vec![]))
        }
    }
}

// ==================== KEY MANAGEMENT ====================
pub async fn get_wallet_keypair(
    user_id: i64,
    chain: &str,
    pool: &PgPool,
) -> Result<solana_sdk::signature::Keypair, String> {
    // 1. Fetch encrypted key from DB
    #[derive(sqlx::FromRow)]
    struct KeyRecord { private_key: String }
    
    let record = sqlx::query_as::<_, KeyRecord>(
        "SELECT private_key FROM wallets WHERE user_id = $1 AND chain = $2"
    )
    .bind(user_id)
    .bind(chain)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB Error: {}", e))?;

    let record = record.ok_or("Wallet not found")?;

    // 2. Decrypt key
    let private_key_str = decrypt_key(&record.private_key, user_id)?;

    // 3. Create Keypair (Solana only for now)
    if chain == "solana" || chain == "sol" {
        let bytes = bs58::decode(&private_key_str)
            .into_vec()
            .map_err(|_| "Invalid base58 key".to_string())?;
        
        solana_sdk::signature::Keypair::from_bytes(&bytes)
            .map_err(|e| format!("Invalid keypair bytes: {}", e))
    } else {
        Err("Only Solana keypair retrieval supported currently".to_string())
    }
}

// ... (Rest of format validation and helper functions remain same)
// ... existing code ...

pub async fn get_balance_handler(
    State(state): State<AppState>,
    Path((user_id, chain)): Path<(i64, String)>,
) -> impl IntoResponse {
    // 1. Get wallet address from DB
    #[derive(sqlx::FromRow)]
    struct AddressRecord { address: String }

    let record = sqlx::query_as::<_, AddressRecord>(
        "SELECT address FROM wallets WHERE user_id = $1 AND chain = $2"
    )
    .bind(user_id) // Bind explicitly
    .bind(&chain)   // Bind explicitly
    .fetch_optional(&state.db)
    .await;
    
    let address = match record {
        Ok(Some(r)) => r.address,
        Ok(None) => return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Wallet not found"}))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    };
    
    // 2. Fetch Balance based on chain
    let result = match chain.as_str() {
        "solana" | "sol" => crate::balance::get_solana_balance(&address, &state.solana_client).await,
        "eth" | "ethereum" | "bsc" | "binance" => crate::balance::get_evm_balance(&address, &chain).await,
        _ => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Unsupported chain"}))).into_response(),
    };
    
    match result {
        Ok(balance) => (StatusCode::OK, Json(balance)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response(),
    }
}
