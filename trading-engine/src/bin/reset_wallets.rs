use magic_crypt::MagicCryptTrait;
use sqlx::postgres::PgPoolOptions;
use std::env;
use dotenv::dotenv;
use bs58;
use solana_sdk::signature::{Keypair, Signer};
use secp256k1::{Secp256k1, SecretKey, PublicKey};
use sha3::{Keccak256, Digest};
use rand::Rng;
use bip39::{Mnemonic, Language};

// Re-using logic from wallet.rs for generation
fn generate_solana_wallet() -> (String, String) {
    let keypair = Keypair::new();
    let address = keypair.pubkey().to_string();
    let private_key = bs58::encode(keypair.to_bytes()).into_string();
    (address, private_key)
}

fn generate_evm_wallet() -> (String, String) {
    let mut rng = rand::thread_rng();
    let mut entropy = [0u8; 16];
    rng.fill(&mut entropy);
    
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy).unwrap();
    let seed = mnemonic.to_seed("");
    let private_key_bytes = &seed[..32];
    
    let secp = Secp256k1::new();
    let secret_key = SecretKey::from_slice(private_key_bytes).unwrap();
    
    let public_key = PublicKey::from_secret_key(&secp, &secret_key);
    let public_key_bytes = public_key.serialize_uncompressed();
    
    let hash = Keccak256::digest(&public_key_bytes[1..]);
    let address_bytes = &hash[12..32];
    let address_hex = format!("0x{}", hex::encode(address_bytes));
    
    let private_key_hex = format!("0x{}", hex::encode(private_key_bytes));
    
    (address_hex, private_key_hex)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();
    
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let current_key = env::var("MASTER_ENCRYPTION_KEY").expect("MASTER_ENCRYPTION_KEY must be set");
    
    println!("🚨 WARNING: This will OVERWRITE ALL WALLETS with new addresses and keys! 🚨");
    println!("   Target Key: {}...", &current_key.chars().take(5).collect::<String>());

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    // 1. Fetch all wallets
    #[derive(sqlx::FromRow, Debug)]
    struct WalletData {
        user_id: i64,
        chain: String,
        address: String,
    }

    let wallets = sqlx::query_as::<_, WalletData>("SELECT user_id, chain, address FROM wallets")
        .fetch_all(&pool)
        .await?;

    println!("🔍 Found {} wallets to recreate.", wallets.len());

    let mc_current = magic_crypt::new_magic_crypt!(&current_key, 256);

    for wallet in wallets {
        println!("🔄 Recreating wallet for user {} ({})", wallet.user_id, wallet.chain);
        println!("   Old Address: {}", wallet.address);

        let (new_address, new_private_key) = match wallet.chain.to_lowercase().as_str() {
            "solana" | "sol" => generate_solana_wallet(),
            "eth" | "ethereum" | "bsc" | "binance" => generate_evm_wallet(),
            _ => {
                println!("   ⚠️ Unsupported chain: {}. Skipping.", wallet.chain);
                continue;
            }
        };

        // Encrypt new key
        let encrypted_key = mc_current.encrypt_str_to_base64(&new_private_key);

        // Update database
        sqlx::query("UPDATE wallets SET address = $1, private_key = $2 WHERE user_id = $3 AND chain = $4 AND address = $5")
            .bind(&new_address)
            .bind(encrypted_key)
            .bind(wallet.user_id)
            .bind(&wallet.chain)
            .bind(&wallet.address)
            .execute(&pool)
            .await?;

        println!("   ✅ Success! New Address: {}", new_address);
    }

    println!("\n✨ Wallet reset complete!");
    Ok(())
}
