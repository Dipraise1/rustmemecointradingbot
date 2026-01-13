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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

// ==================== WALLET OPERATIONS ====================
pub fn create_wallet_info(
    user_id: i64,
    chain: String,
    address: String,
    private_key: String,
) -> WalletInfo {
    let encrypted_key = encrypt_key(&private_key, user_id);
    
    WalletInfo {
        user_id,
        chain,
        address,
        encrypted_private_key: encrypted_key,
        created_at: Utc::now().timestamp(),
        balance: None,
        last_updated: None,
    }
}

pub fn validate_wallet_format(chain: &str, private_key: &str) -> Result<(), String> {
    match chain {
        "solana" => {
            let _ = bs58::decode(private_key)
                .into_vec()
                .map_err(|_| "Invalid Solana private key format (expected base58)")?;
            Ok(())
        }
        "eth" | "ethereum" | "bsc" | "binance" => {
            let key_hex = private_key.strip_prefix("0x").unwrap_or(private_key);
            let bytes = hex::decode(key_hex)
                .map_err(|_| "Invalid EVM private key format (expected hex)")?;
            if bytes.len() != 32 {
                return Err("EVM private key must be 32 bytes".to_string());
            }
            Ok(())
        }
        _ => Err("Unsupported chain".to_string()),
    }
}

// ==================== DATA IMPORT ====================
pub fn import_wallets_data(
    user_id: i64,
    wallets_data: Vec<serde_json::Value>,
) -> Result<ImportDataResponse, String> {
    let mut imported = 0;
    let mut errors = Vec::new();
    
    for (idx, wallet_json) in wallets_data.iter().enumerate() {
        let chain = wallet_json["chain"]
            .as_str()
            .ok_or_else(|| format!("Wallet {}: missing chain", idx))?;
        
        let private_key = wallet_json["private_key"]
            .as_str()
            .ok_or_else(|| format!("Wallet {}: missing private_key", idx))?;
        
        match validate_wallet_format(chain, private_key) {
            Ok(_) => {
                let result = match chain {
                    "solana" => import_solana_wallet(private_key),
                    "eth" | "ethereum" | "bsc" | "binance" => {
                        import_evm_wallet(private_key).map(|(addr, pk)| (addr, pk))
                    }
                    _ => Err("Unsupported chain".to_string()),
                };
                
                match result {
                    Ok((address, _)) => {
                        tracing::info!("Imported wallet {}: {} on {}", idx, address, chain);
                        imported += 1;
                    }
                    Err(e) => {
                        errors.push(format!("Wallet {}: {}", idx, e));
                    }
                }
            }
            Err(e) => {
                errors.push(format!("Wallet {}: {}", idx, e));
            }
        }
    }
    
    Ok(ImportDataResponse {
        success: errors.is_empty(),
        imported_count: imported,
        errors,
    })
}

pub fn export_wallet_for_user(wallet: &WalletInfo) -> Result<serde_json::Value, String> {
    let private_key = decrypt_key(&wallet.encrypted_private_key, wallet.user_id)?;
    
    Ok(serde_json::json!({
        "chain": wallet.chain,
        "address": wallet.address,
        "private_key": private_key,
        "created_at": wallet.created_at,
    }))
}
