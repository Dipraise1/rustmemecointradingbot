import { Context, SessionFlavor } from 'grammy';
import { config } from 'dotenv';

config();

export const RUST_API = process.env.RUST_API_URL || 'http://localhost:3000';

// ==================== TYPES ====================
export interface SessionData {
  walletCreated: boolean;
  settings: TradingSettings;
  awaitingInput?: 'buy' | 'sell' | 'token_check' | 'import_wallet' | 'import_data' | 'custom_amount' | 'bundler_add' | 'whale_alert' | 'grid_create' | 'ai_chat';
  pendingBuy?: {
    token: string;
    chain: string;
  };
  // Trojan UI specific
  selectedAmount?: string;
  selectedToken?: string;
}

export interface TradingSettings {
  defaultChain: 'solana' | 'eth' | 'bsc';
  buyAmount: number;
  slippage: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  autoTrade: boolean;
  // New features
  preset: 'custom' | 'safe' | 'degen' | 'snipe';
  simulationMode: boolean;
  bundlerMode: boolean;
  ignoreSafety: boolean; // Bypass security checks
}

export interface Position {
  position: {
    position_id?: string;
    user_id: number;
    chain: string;
    token: string;
    token_address?: string;
    amount: string;
    entry_price: number;
    current_price: number;
    take_profit_percent: number;
    stop_loss_percent: number;
    timestamp: number;
  };
  pnl_percent: number;
  pnl_usd: number;
  should_close: boolean;
  reason?: string;
}

export type MyContext = Context & SessionFlavor<SessionData>;

// ==================== HELPER FUNCTIONS ====================

export function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals);
}

export function formatPnL(pnl: number): string {
  const emoji = pnl >= 0 ? '🟢' : '🔴';
  const sign = pnl >= 0 ? '+' : '';
  return `${emoji} ${sign}${formatNumber(pnl)}%`;
}

// Helper function to safely edit messages (handles "message not modified" error)
export async function safeEditMessage(ctx: MyContext, text: string, options?: any) {
  try {
    await ctx.editMessageText(text, options);
  } catch (error: any) {
    // Ignore "message is not modified" error - it means the message is already correct
    if (error.error_code === 400 && error.description?.includes('message is not modified')) {
      // Message is already correct, no need to update
      return;
    }
    // For other errors, try to reply instead
    try {
      await ctx.reply(text, options);
    } catch (replyError) {
      // If reply also fails, just log it
      console.error('Failed to edit or reply:', replyError);
    }
  }
}

export async function callRustAPI(endpoint: string, method: string = 'GET', body?: any, timeout: number = 30000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${RUST_API}${endpoint}`, options);
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`API error (${response.status}): ${errorText}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      const safeText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 200);
      throw new Error(`Failed to parse JSON. Response: "${safeText}..."`);
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`API call timeout after ${timeout}ms`);
    }
    
    // Parse error message for better logging
    let errorDetails = error.message || error;
    let parsedError: any = null;
    
    // Try to extract JSON from error message
    const jsonMatch = errorDetails.match(/API error \((\d+)\): (.+)/);
    if (jsonMatch) {
      try {
        parsedError = JSON.parse(jsonMatch[2]);
      } catch (e) {
        // Not JSON, use raw message
      }
    }
    
    // Categorize errors for better logging
    const isTokenRisk = errorDetails.includes('Token Risk') || 
                        (errorDetails.includes('400') && errorDetails.includes('Risk'));
    const isAccountNotFound = parsedError?.warnings?.some((w: string) => w.includes('AccountNotFound')) ||
                              errorDetails.includes('AccountNotFound');
    const isNoPairsFound = errorDetails.includes('No pairs found');
    
    // Log errors with context
    if (isAccountNotFound) {
      // Devnet account lookup failures - provide helpful context
      const pubkey = errorDetails.match(/pubkey=([a-zA-Z0-9]+)/)?.[1] || 'unknown';
      console.warn(`⚠️ [DEVNET] Account not found: ${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`);
      console.warn(`   Endpoint: ${endpoint}`);
    } else if (isTokenRisk) {
      // Token risk warnings - don't spam logs
    } else if (isNoPairsFound) {
      // Price lookup failures on devnet
      console.warn(`⚠️ [DEVNET] No trading pairs found for token`);
      console.warn(`   Endpoint: ${endpoint}`);
    } else {
      // Log based on status code
      const statusMatch = errorDetails.match(/API error \((\d+)\)/);
      const statusCode = statusMatch ? parseInt(statusMatch[1]) : 500;

      if (statusCode >= 400 && statusCode < 499) {
          // Client/User error - Keep it concise
          console.warn(`⚠️ API Warning (${endpoint}): ${statusCode}. User Error: ${parsedError?.error || errorDetails}`);
      } else {
          // System error - log with full details
          console.error(`❌ API Error (${endpoint}):`, errorDetails);
          if (parsedError) {
            console.error(`   Details:`, JSON.stringify(parsedError, null, 2));
          }
      }
    }
    
    throw error;
  }
}
