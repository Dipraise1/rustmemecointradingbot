use magic_crypt::MagicCryptTrait;

fn main() {
    let examples = vec![
        ("Old Wallet", "BHlAAlRdBV5MT0RGZlpDVVdsDUUPC3RyTllVAXNgemZoRX5mf3JXA00DVEtDXWgDTXZSX1pJAWV6bXhcBXxHRUNvZVBxeXRWfElde2VDVFFjR3YGWG9UYA=="),
        ("New Wallet", "kayRhFGfo+yG9aPBAZGM23vDTVebN1IC98jf5rAVJTcPmQABUkTRybCDqifHZkgZ2918yvqfyC9s6oYKMrT5OkNdC/+w2zNhfSfYrZ+XKcs="),
    ];
    
    let keys = vec![
        "prod_master_key_super_secure_9928374", // Current in .env
        "change_me_in_production_please_12345678", // Default
    ];

    for key in keys {
        println!("--- Checking key: {} ---", key);
        for (name, encrypted) in &examples {
            let mc = magic_crypt::new_magic_crypt!(key, 256);
            match mc.decrypt_base64_to_string(encrypted) {
                Ok(decrypted) => println!("  ✅ [{}]: Success! Decrypted: {}", name, decrypted),
                Err(e) => println!("  ❌ [{}]: Failed: {}", name, e),
            }
        }
    }
}
