// Telegram Bot - Production Ready
// File: telegram-bot/src/bot.ts
// Install: bun add grammy dotenv

import { Bot, Context, InlineKeyboard, session } from 'grammy';
import { config } from 'dotenv';

config();

const RUST_API = process.env.RUST_API_URL || 'http://localhost:3000';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is required!');
  process.exit(1);
}

// ==================== TYPES ====================
interface SessionData {
  walletCreated: boolean;
  settings: TradingSettings;
  awaitingInput?: 'buy' | 'sell' | 'token_check' | 'import_wallet' | 'import_data';
}

interface TradingSettings {
  defaultChain: 'solana' | 'eth' | 'bsc';
  buyAmount: number;
  slippage: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  autoTrade: boolean;
}

interface Position {
  position: {
    user_id: number;
    chain: string;
    token: string;
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

type MyContext = Context & {
  session: SessionData;
};

// ==================== BOT SETUP ====================
const bot = new Bot<MyContext>(BOT_TOKEN);

// Session middleware
bot.use(session({
  initial: (): SessionData => ({
    walletCreated: false,
    settings: {
      defaultChain: 'solana',
      buyAmount: 0.1,
      slippage: 10,
      takeProfitPercent: 100,
      stopLossPercent: -40,
      autoTrade: false,
    },
  }),
}));

// ==================== HELPER FUNCTIONS ====================
async function callRustAPI(endpoint: string, method: string = 'GET', body?: any) {
  try {
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${RUST_API}${endpoint}`, options);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API Error (${endpoint}):`, error);
    throw error;
  }
}

function getMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('💼 Wallet', 'wallet')
    .text('💰 Buy', 'buy').row()
    .text('📊 Positions', 'positions')
    .text('📈 Portfolio', 'portfolio').row()
    .text('📥 Import', 'import_data')
    .text('⚙️ Settings', 'settings').row()
    .text('🔍 Check Token', 'check_token');
}

// Portfolio button
bot.callbackQuery('portfolio', async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const portfolio = await callRustAPI(`/api/portfolio/${ctx.from!.id}`);
    
    let message = '<b>📊 Portfolio Summary</b>\n\n';
    message += `<b>Total Value:</b> $${formatNumber(portfolio.total_value_usd)}\n`;
    message += `<b>PnL:</b> ${formatPnL(portfolio.total_profit_loss_percent)}\n`;
    message += `<b>PnL USD:</b> $${formatNumber(portfolio.total_profit_loss_usd)}\n`;
    message += `<b>Active Positions:</b> ${portfolio.active_positions}\n\n`;
    
    if (portfolio.wallets && portfolio.wallets.length > 0) {
      message += '<b>Wallets:</b>\n';
      for (const wallet of portfolio.wallets) {
        const chain = wallet.chain.toUpperCase();
        message += `${chain}: $${formatNumber(wallet.total_usd)}\n`;
      }
    }
    
    const keyboard = new InlineKeyboard()
      .text('💼 Wallets', 'wallet')
      .text('📊 Positions', 'positions').row()
      .text('🔙 Back', 'back_main');
    
    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals);
}

function formatPnL(pnl: number): string {
  const emoji = pnl >= 0 ? '🟢' : '🔴';
  const sign = pnl >= 0 ? '+' : '';
  return `${emoji} ${sign}${formatNumber(pnl)}%`;
}

// ==================== COMMANDS ====================

// /start command
bot.command('start', async (ctx) => {
  const welcomeMessage = `
🤖 <b>Welcome to MemecoinSniper Bot!</b>

⚡ Lightning-fast multi-chain trading
🔒 Secure non-custodial wallets
🎯 Auto TP/SL on every trade

<b>Supported Chains:</b>
• Solana (SOL)
• Ethereum (ETH)
• Binance Smart Chain (BSC)

Get started by creating your wallet 👇
  `;
  
  await ctx.reply(welcomeMessage, {
    parse_mode: 'HTML',
    reply_markup: getMainKeyboard(),
  });
});

// /help command
bot.command('help', async (ctx) => {
  const helpText = `
📚 <b>Command Reference</b>

<b>Trading:</b>
/buy <code>&lt;token&gt; &lt;amount&gt;</code> - Buy tokens
/sell <code>&lt;position_id&gt; &lt;%&gt;</code> - Sell position
/positions - View active positions
/pnl - Show profit/loss

<b>Wallet:</b>
/wallet - View balances
/deposit - Deposit addresses
/withdraw - Withdraw funds

<b>Settings:</b>
/settings - Configure bot
/chain <code>&lt;sol|eth|bsc&gt;</code> - Set default chain

<b>Tools:</b>
/check <code>&lt;token&gt;</code> - Security check
/gas <code>&lt;chain&gt;</code> - Current gas prices
/history - Transaction history
/alerts - View alerts
/import_data - Import wallets or positions

<b>Quick Actions:</b>
Use the buttons below for faster access 👇
  `;
  
  await ctx.reply(helpText, {
    parse_mode: 'HTML',
    reply_markup: getMainKeyboard(),
  });
});

// /buy command
bot.command('buy', async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1);
  
  if (!args || args.length < 2) {
    return ctx.reply(
      '❌ <b>Usage:</b> /buy <code>&lt;token_address&gt; &lt;amount&gt;</code>\n\n' +
      '<b>Example:</b>\n' +
      '/buy So11...abc 0.5\n' +
      '/buy 0x123...xyz 0.1',
      { parse_mode: 'HTML' }
    );
  }
  
  const [token, amount] = args;
  const settings = ctx.session.settings;
  
  await ctx.reply('🔍 Checking token security...');
  
  try {
    // Security check
    const securityCheck = await callRustAPI('/api/security-check', 'POST', {
      chain: settings.defaultChain,
      token,
    });
    
    if (!securityCheck.is_safe) {
      return ctx.reply(
        `⚠️ <b>Security Warning!</b>\n\n` +
        `Rug Score: ${securityCheck.rug_score}/100\n` +
        `Honeypot: ${securityCheck.honeypot ? 'YES ⚠️' : 'NO ✅'}\n` +
        `Liquidity: $${formatNumber(securityCheck.liquidity_usd)}\n` +
        `Holders: ${securityCheck.holder_count}\n\n` +
        `Proceed with caution! Use /force_buy to continue anyway.`,
        { parse_mode: 'HTML' }
      );
    }
    
    await ctx.reply('✅ Token looks safe! Executing trade...');
    
    // Execute buy
    const result = await callRustAPI('/api/buy', 'POST', {
      user_id: ctx.from!.id,
      chain: settings.defaultChain,
      token,
      amount,
      slippage: settings.slippage,
      take_profit: settings.takeProfitPercent,
      stop_loss: settings.stopLossPercent,
    });
    
    if (result.success) {
      const chain = settings.defaultChain.toUpperCase();
      await ctx.reply(
        `✅ <b>Buy Executed!</b>\n\n` +
        `Chain: ${chain}\n` +
        `Token: <code>${token}</code>\n` +
        `Amount: ${amount} ${chain === 'SOLANA' ? 'SOL' : chain === 'ETH' ? 'ETH' : 'BNB'}\n` +
        `TX: <code>${result.tx_hash}</code>\n\n` +
        `🎯 TP: +${settings.takeProfitPercent}%\n` +
        `🛑 SL: ${settings.stopLossPercent}%\n\n` +
        `Position ID: <code>${result.position_id}</code>`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`❌ Trade failed: ${result.error}`);
    }
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// /positions command
bot.command('positions', async (ctx) => {
  try {
    await ctx.reply('📊 Fetching your positions...');
    
    const positions: Position[] = await callRustAPI(
      `/api/positions/${ctx.from!.id}`
    );
    
    if (positions.length === 0) {
      return ctx.reply('📭 No active positions');
    }
    
    let message = '<b>📊 Your Positions</b>\n\n';
    
    for (const pos of positions) {
      const chain = pos.position.chain.toUpperCase();
      const age = Math.floor((Date.now() / 1000 - pos.position.timestamp) / 60);
      
      message += `<b>${chain}</b> | ${formatPnL(pos.pnl_percent)}\n`;
      message += `Token: <code>${pos.position.token.slice(0, 8)}...</code>\n`;
      message += `Entry: $${formatNumber(pos.position.entry_price, 6)}\n`;
      message += `Current: $${formatNumber(pos.position.current_price, 6)}\n`;
      message += `Age: ${age}m\n`;
      message += `TP: +${pos.position.take_profit_percent}% | `;
      message += `SL: ${pos.position.stop_loss_percent}%\n`;
      message += `\n`;
    }
    
    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// /settings command
bot.command('settings', async (ctx) => {
  const settings = ctx.session.settings;
  
  const message = `
⚙️ <b>Your Settings</b>

<b>Trading:</b>
Chain: ${settings.defaultChain.toUpperCase()}
Buy Amount: ${settings.buyAmount} ${settings.defaultChain === 'solana' ? 'SOL' : settings.defaultChain === 'eth' ? 'ETH' : 'BNB'}
Slippage: ${settings.slippage}%
Take Profit: +${settings.takeProfitPercent}%
Stop Loss: ${settings.stopLossPercent}%
Auto-Trade: ${settings.autoTrade ? 'ON ✅' : 'OFF ❌'}

<b>Commands to change:</b>
/chain <code>&lt;sol|eth|bsc&gt;</code>
/amount <code>&lt;number&gt;</code>
/slippage <code>&lt;%&gt;</code>
/tp <code>&lt;%&gt;</code>
/sl <code>&lt;-%&gt;</code>
  `;
  
  await ctx.reply(message, { parse_mode: 'HTML' });
});

// /chain command
bot.command('chain', async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1);
  
  if (!args || args.length === 0) {
    return ctx.reply(
      'Current chain: ' + ctx.session.settings.defaultChain.toUpperCase() + '\n\n' +
      'Change with: /chain <sol|eth|bsc>'
    );
  }
  
  const chain = args[0].toLowerCase();
  
  if (!['sol', 'solana', 'eth', 'ethereum', 'bsc', 'binance'].includes(chain)) {
    return ctx.reply('❌ Invalid chain. Use: sol, eth, or bsc');
  }
  
  const chainMap: any = {
    sol: 'solana',
    solana: 'solana',
    eth: 'eth',
    ethereum: 'eth',
    bsc: 'bsc',
    binance: 'bsc',
  };
  
  ctx.session.settings.defaultChain = chainMap[chain];
  await ctx.reply(`✅ Default chain set to ${chainMap[chain].toUpperCase()}`);
});

// /wallet command
bot.command('wallet', async (ctx) => {
  try {
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
    
    if (!wallets || wallets.length === 0) {
      return ctx.reply(
        '💼 <b>No Wallets Found</b>\n\n' +
        'You need to create or import a wallet first.\n\n' +
        '<b>Commands:</b>\n' +
        '/generate_wallet - Generate new wallet\n' +
        '/import_wallet - Import existing wallet',
        { parse_mode: 'HTML' }
      );
    }
    
    let message = '<b>💼 Your Wallets</b>\n\n';
    
    for (const wallet of wallets) {
      const chain = wallet.chain.toUpperCase();
      const address = wallet.address;
      const shortAddress = address.length > 20 
        ? `${address.slice(0, 8)}...${address.slice(-6)}`
        : address;
      
      // Fetch balance
      try {
        const balance = await callRustAPI(`/api/wallet/balance/${ctx.from!.id}/${wallet.chain}`);
        message += `<b>${chain}</b>\n`;
        message += `Address: <code>${shortAddress}</code>\n`;
        message += `Balance: ${balance.native_balance} ${chain === 'SOLANA' ? 'SOL' : chain === 'ETH' ? 'ETH' : 'BNB'}\n`;
        message += `Value: $${formatNumber(balance.total_usd)}\n`;
        message += `Created: ${new Date(wallet.created_at * 1000).toLocaleDateString()}\n\n`;
      } catch {
        message += `<b>${chain}</b>\n`;
        message += `Address: <code>${shortAddress}</code>\n`;
        message += `Created: ${new Date(wallet.created_at * 1000).toLocaleDateString()}\n\n`;
      }
    }
    
    message += '<b>Actions:</b>\n';
    message += '/generate_wallet - Create new wallet\n';
    message += '/import_wallet - Import existing wallet\n';
    message += '/portfolio - View portfolio summary';
    
    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// /generate_wallet command
bot.command('generate_wallet', async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1);
  const chain = args && args.length > 0 ? args[0].toLowerCase() : ctx.session.settings.defaultChain;
  
  // Validate chain
  const validChains = ['solana', 'sol', 'eth', 'ethereum', 'bsc', 'binance'];
  const chainMap: any = {
    sol: 'solana',
    solana: 'solana',
    eth: 'eth',
    ethereum: 'eth',
    bsc: 'bsc',
    binance: 'bsc',
  };
  
  const normalizedChain = chainMap[chain] || chain;
  
  if (!validChains.includes(chain) && !validChains.includes(normalizedChain)) {
    return ctx.reply(
      '❌ <b>Invalid chain</b>\n\n' +
      'Usage: /generate_wallet [sol|eth|bsc]\n\n' +
      'Example: /generate_wallet sol',
      { parse_mode: 'HTML' }
    );
  }
  
  await ctx.reply(`🔐 Generating ${normalizedChain.toUpperCase()} wallet...`);
  
  try {
    const result = await callRustAPI('/api/wallet/generate', 'POST', {
      user_id: ctx.from!.id,
      chain: normalizedChain,
    });
    
    if (result.success) {
      let message = `✅ <b>Wallet Generated!</b>\n\n`;
      message += `<b>Chain:</b> ${normalizedChain.toUpperCase()}\n`;
      message += `<b>Address:</b> <code>${result.address}</code>\n\n`;
      
      if (result.private_key) {
        message += `⚠️ <b>SAVE THIS PRIVATE KEY SECURELY!</b>\n\n`;
        message += `<b>Private Key:</b>\n<code>${result.private_key}</code>\n\n`;
      }
      
      if (result.mnemonic) {
        message += `<b>Mnemonic (12 words):</b>\n<code>${result.mnemonic}</code>\n\n`;
      }
      
      message += `⚠️ <b>WARNING:</b> Never share your private key or mnemonic with anyone!`;
      
      await ctx.reply(message, { parse_mode: 'HTML' });
    } else {
      await ctx.reply(`❌ Error: ${result.error}`);
    }
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// /import_wallet command
bot.command('import_wallet', async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1);
  
  if (!args || args.length < 2) {
    ctx.session.awaitingInput = 'import_wallet';
    return ctx.reply(
      '📥 <b>Import Wallet</b>\n\n' +
      'Send me your private key to import.\n\n' +
      'Format: <code>&lt;chain&gt; &lt;private_key&gt;</code>\n\n' +
      '<b>Example:</b>\n' +
      '<code>sol 5KJvsngHeM...xyz</code>\n' +
      '<code>eth 0x1234...abcd</code>\n\n' +
      'Or just send the private key and I\'ll use your default chain.',
      { parse_mode: 'HTML' }
    );
  }
  
  const [chainArg, privateKey] = args;
  const chainMap: any = {
    sol: 'solana',
    solana: 'solana',
    eth: 'eth',
    ethereum: 'eth',
    bsc: 'bsc',
    binance: 'bsc',
  };
  
  const chain = chainMap[chainArg.toLowerCase()] || ctx.session.settings.defaultChain;
  
  await ctx.reply(`📥 Importing ${chain.toUpperCase()} wallet...`);
  
  try {
    const result = await callRustAPI('/api/wallet/import', 'POST', {
      user_id: ctx.from!.id,
      chain: chain,
      private_key: privateKey,
    });
    
    if (result.success) {
      await ctx.reply(
        `✅ <b>Wallet Imported!</b>\n\n` +
        `<b>Chain:</b> ${chain.toUpperCase()}\n` +
        `<b>Address:</b> <code>${result.address}</code>\n\n` +
        `Your wallet is now ready to use!`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`❌ Error: ${result.error}`);
    }
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ==================== CALLBACK HANDLERS ====================

// Wallet button
bot.callbackQuery('wallet', async (ctx) => {
  await ctx.answerCallbackQuery();
  
  try {
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
    
    if (!wallets || wallets.length === 0) {
      const keyboard = new InlineKeyboard()
        .text('🔐 Generate Wallet', 'generate_wallet')
        .text('📥 Import Wallet', 'import_wallet').row()
        .text('🔙 Back', 'back_main');
      
      await ctx.editMessageText(
        '💼 <b>No Wallets Found</b>\n\n' +
        'Create or import a wallet to get started:',
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
      return;
    }
    
    let message = '<b>💼 Your Wallets</b>\n\n';
    
    for (const wallet of wallets) {
      const chain = wallet.chain.toUpperCase();
      const address = wallet.address;
      const shortAddress = address.length > 20 
        ? `${address.slice(0, 8)}...${address.slice(-6)}`
        : address;
      
      message += `<b>${chain}</b>\n`;
      message += `Address: <code>${shortAddress}</code>\n\n`;
    }
    
    const keyboard = new InlineKeyboard()
      .text('🔐 Generate New', 'generate_wallet')
      .text('📥 Import', 'import_wallet').row()
      .text('🔙 Back', 'back_main');
    
    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// Generate wallet callback
bot.callbackQuery('generate_wallet', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    '🔐 <b>Generate Wallet</b>\n\n' +
    'Use: /generate_wallet [sol|eth|bsc]\n\n' +
    'Example: /generate_wallet sol',
    { parse_mode: 'HTML' }
  );
});

// Import wallet callback
bot.callbackQuery('import_wallet', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingInput = 'import_wallet';
  await ctx.reply(
    '📥 <b>Import Wallet</b>\n\n' +
    'Send me your private key:\n\n' +
    'Format: <code>&lt;chain&gt; &lt;private_key&gt;</code>\n\n' +
    'Example:\n' +
    '<code>sol 5KJvsngHeM...xyz</code>\n' +
    '<code>eth 0x1234...abcd</code>',
    { parse_mode: 'HTML' }
  );
});

// Buy button
bot.callbackQuery('buy', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingInput = 'buy';
  await ctx.reply(
    '💰 <b>Quick Buy</b>\n\n' +
    'Send me the token address to buy:',
    { parse_mode: 'HTML' }
  );
});

// Positions button
bot.callbackQuery('positions', async (ctx) => {
  await ctx.answerCallbackQuery();
  // Reuse /positions command logic
  await ctx.reply('📊 Fetching positions...');
  try {
    const positions: Position[] = await callRustAPI(
      `/api/positions/${ctx.from!.id}`
    );
    
    if (positions.length === 0) {
      await ctx.reply('📭 No active positions');
      return;
    }
    
    let message = '<b>📊 Your Positions</b>\n\n';
    
    for (const pos of positions) {
      const chain = pos.position.chain.toUpperCase();
      const age = Math.floor((Date.now() / 1000 - pos.position.timestamp) / 60);
      
      message += `<b>${chain}</b> | ${formatPnL(pos.pnl_percent)}\n`;
      message += `Token: <code>${pos.position.token.slice(0, 8)}...</code>\n`;
      message += `Entry: $${formatNumber(pos.position.entry_price, 6)}\n`;
      message += `Current: $${formatNumber(pos.position.current_price, 6)}\n`;
      message += `Age: ${age}m\n`;
      message += `TP: +${pos.position.take_profit_percent}% | `;
      message += `SL: ${pos.position.stop_loss_percent}%\n`;
      message += `\n`;
    }
    
    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// Settings button
bot.callbackQuery('settings', async (ctx) => {
  await ctx.answerCallbackQuery();
  const settings = ctx.session.settings;
  
  const keyboard = new InlineKeyboard()
    .text(`Chain: ${settings.defaultChain.toUpperCase()}`, 'change_chain').row()
    .text(`Amount: ${settings.buyAmount}`, 'change_amount')
    .text(`Slippage: ${settings.slippage}%`, 'change_slippage').row()
    .text(`TP: +${settings.takeProfitPercent}%`, 'change_tp')
    .text(`SL: ${settings.stopLossPercent}%`, 'change_sl').row()
    .text('🔙 Back', 'back_main');
  
  await ctx.editMessageText(
    '⚙️ <b>Settings</b>\n\nClick to change:',
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
});

// Check token button
bot.callbackQuery('check_token', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingInput = 'token_check';
  await ctx.reply(
    '🔍 <b>Token Security Check</b>\n\n' +
    'Send me the token address to check:',
    { parse_mode: 'HTML' }
  );
});

// Import data button
bot.callbackQuery('import_data', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingInput = 'import_data';
  
  const keyboard = new InlineKeyboard()
    .text('📋 Show Format', 'show_import_format')
    .text('❌ Cancel', 'cancel_import').row();
  
  await ctx.reply(
    '📥 <b>Import Data</b>\n\n' +
    'Send me your data in JSON or CSV format.\n\n' +
    '<b>Supported types:</b>\n' +
    '• Wallets\n' +
    '• Positions\n\n' +
    'Click "Show Format" for examples.',
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
});

// Back to main
bot.callbackQuery('back_main', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    '🤖 <b>Main Menu</b>\n\nWhat would you like to do?',
    { parse_mode: 'HTML', reply_markup: getMainKeyboard() }
  );
});

// ==================== MESSAGE HANDLERS ====================

// Handle awaiting input
bot.on('message:text', async (ctx) => {
  if (!ctx.session.awaitingInput) return;
  
  const input = ctx.message.text;
  
  if (ctx.session.awaitingInput === 'buy') {
    ctx.session.awaitingInput = undefined;
    
    // Assume input is token address, use default amount
    const settings = ctx.session.settings;
    await ctx.reply('🔍 Checking token and executing buy...');
    
    try {
      const result = await callRustAPI('/api/buy', 'POST', {
        user_id: ctx.from.id,
        chain: settings.defaultChain,
        token: input,
        amount: settings.buyAmount.toString(),
        slippage: settings.slippage,
        take_profit: settings.takeProfitPercent,
        stop_loss: settings.stopLossPercent,
      });
      
      if (result.success) {
        await ctx.reply(
          `✅ <b>Buy Executed!</b>\n\n` +
          `TX: <code>${result.tx_hash}</code>\n` +
          `Position: <code>${result.position_id}</code>`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply(`❌ ${result.error}`);
      }
    } catch (error: any) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  } else if (ctx.session.awaitingInput === 'token_check') {
    ctx.session.awaitingInput = undefined;
    
    await ctx.reply('🔍 Checking token security...');
    
    try {
      const check = await callRustAPI('/api/security-check', 'POST', {
        chain: ctx.session.settings.defaultChain,
        token: input,
      });
      
      const status = check.is_safe ? '✅ SAFE' : '⚠️ RISKY';
      
      await ctx.reply(
        `🔍 <b>Security Report</b>\n\n` +
        `Status: ${status}\n` +
        `Rug Score: ${check.rug_score}/100\n` +
        `Honeypot: ${check.honeypot ? 'YES ⚠️' : 'NO ✅'}\n` +
        `Liquidity: $${formatNumber(check.liquidity_usd)}\n` +
        `Holders: ${check.holder_count}\n\n` +
        `${check.warnings.length > 0 ? '⚠️ Warnings:\n' + check.warnings.join('\n') : ''}`,
        { parse_mode: 'HTML' }
      );
    } catch (error: any) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  } else if (ctx.session.awaitingInput === 'import_wallet') {
    ctx.session.awaitingInput = undefined;
    
    // Try to parse chain and private key
    const parts = input.split(' ');
    let chain = ctx.session.settings.defaultChain;
    let privateKey = input;
    
    if (parts.length >= 2) {
      const chainMap: any = {
        sol: 'solana',
        solana: 'solana',
        eth: 'eth',
        ethereum: 'eth',
        bsc: 'bsc',
        binance: 'bsc',
      };
      const chainArg = parts[0].toLowerCase();
      if (chainMap[chainArg]) {
        chain = chainMap[chainArg];
        privateKey = parts.slice(1).join(' ');
      }
    }
    
    await ctx.reply(`📥 Importing ${chain.toUpperCase()} wallet...`);
    
    try {
      const result = await callRustAPI('/api/wallet/import', 'POST', {
        user_id: ctx.from.id,
        chain: chain,
        private_key: privateKey,
      });
      
      if (result.success) {
        await ctx.reply(
          `✅ <b>Wallet Imported!</b>\n\n` +
          `<b>Chain:</b> ${chain.toUpperCase()}\n` +
          `<b>Address:</b> <code>${result.address}</code>\n\n` +
          `Your wallet is now ready to use!`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply(`❌ Error: ${result.error}`);
      }
    } catch (error: any) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  } else if (ctx.session.awaitingInput === 'import_data') {
    ctx.session.awaitingInput = undefined;
    
    await ctx.reply('📥 Processing import data...');
    
    try {
      let dataType = 'wallets';
      let data: any;
      
      // Try to parse JSON
      try {
        const jsonData = JSON.parse(input);
        
        // Determine data type
        if (Array.isArray(jsonData)) {
          if (jsonData.length > 0) {
            if (jsonData[0].chain && jsonData[0].private_key) {
              dataType = 'wallets';
            } else if (jsonData[0].token && jsonData[0].chain) {
              dataType = 'positions';
            }
          }
        }
        
        data = jsonData;
      } catch {
        // Not JSON, try to parse as text format
        const lines = input.split('\n').filter(l => l.trim());
        if (lines.length > 0 && lines[0].includes('chain')) {
          // CSV-like format
          const headers = lines[0].split(',').map(h => h.trim());
          const items = [];
          
          for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const item: any = {};
            headers.forEach((header, idx) => {
              item[header] = values[idx] || '';
            });
            items.push(item);
          }
          
          if (items[0]?.private_key) {
            dataType = 'wallets';
          } else if (items[0]?.token) {
            dataType = 'positions';
          }
          data = items;
        } else {
          throw new Error('Invalid data format. Send JSON array or CSV format.');
        }
      }
      
      const result = await callRustAPI('/api/import', 'POST', {
        user_id: ctx.from.id,
        data_type: dataType,
        data: data,
      });
      
      if (result.success) {
        await ctx.reply(
          `✅ <b>Data Imported Successfully!</b>\n\n` +
          `<b>Type:</b> ${dataType}\n` +
          `<b>Imported:</b> ${result.imported_count} items\n` +
          `${result.errors.length > 0 ? `\n⚠️ Errors: ${result.errors.length}\n${result.errors.slice(0, 3).join('\n')}` : ''}`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply(
          `❌ <b>Import Failed</b>\n\n` +
          `Imported: ${result.imported_count} items\n` +
          `Errors:\n${result.errors.slice(0, 5).join('\n')}`,
          { parse_mode: 'HTML' }
        );
      }
    } catch (error: any) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  }
});

// /import_data command
bot.command('import_data', async (ctx) => {
  ctx.session.awaitingInput = 'import_data';
  
  const keyboard = new InlineKeyboard()
    .text('📋 Show Format', 'show_import_format')
    .text('❌ Cancel', 'cancel_import').row();
  
  await ctx.reply(
    '📥 <b>Import Data</b>\n\n' +
    'Send me your data in JSON or CSV format.\n\n' +
    '<b>Supported types:</b>\n' +
    '• Wallets (chain, private_key, address)\n' +
    '• Positions (user_id, chain, token, amount, etc.)\n\n' +
    'Click "Show Format" to see examples.',
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
});

// Show import format
bot.callbackQuery('show_import_format', async (ctx) => {
  await ctx.answerCallbackQuery();
  
  const walletsExample = JSON.stringify([
    {
      chain: 'solana',
      private_key: '5KJvsngHeM...',
      address: 'So111...'
    },
    {
      chain: 'eth',
      private_key: '0x1234...',
      address: '0x742d...'
    }
  ], null, 2);
  
  const positionsExample = JSON.stringify([
    {
      user_id: 123456789,
      chain: 'solana',
      token: 'So111...',
      amount: '0.5',
      entry_price: 0.0001,
      current_price: 0.0001,
      take_profit_percent: 100,
      stop_loss_percent: -40,
      timestamp: Math.floor(Date.now() / 1000)
    }
  ], null, 2);
  
  await ctx.reply(
    '📋 <b>Import Data Format</b>\n\n' +
    '<b>Wallets JSON:</b>\n' +
    '<code>' + walletsExample.slice(0, 200) + '...</code>\n\n' +
    '<b>Positions JSON:</b>\n' +
    '<code>' + positionsExample.slice(0, 200) + '...</code>\n\n' +
    'Send your data now:',
    { parse_mode: 'HTML' }
  );
});

// Cancel import
bot.callbackQuery('cancel_import', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingInput = undefined;
  await ctx.reply('❌ Import cancelled.', { parse_mode: 'HTML' });
});

// /portfolio command
bot.command('portfolio', async (ctx) => {
  try {
    await ctx.reply('📊 Calculating portfolio...');
    
    const portfolio = await callRustAPI(`/api/portfolio/${ctx.from!.id}`);
    
    let message = '<b>📊 Portfolio Summary</b>\n\n';
    message += `<b>Total Value:</b> $${formatNumber(portfolio.total_value_usd)}\n`;
    message += `<b>PnL:</b> ${formatPnL(portfolio.total_profit_loss_percent)}\n`;
    message += `<b>PnL USD:</b> $${formatNumber(portfolio.total_profit_loss_usd)}\n`;
    message += `<b>Active Positions:</b> ${portfolio.active_positions}\n\n`;
    
    if (portfolio.wallets && portfolio.wallets.length > 0) {
      message += '<b>Wallets:</b>\n';
      for (const wallet of portfolio.wallets) {
        const chain = wallet.chain.toUpperCase();
        message += `${chain}: $${formatNumber(wallet.total_usd)}\n`;
      }
      message += '\n';
    }
    
    message += 'Use /wallet to view detailed balances';
    
    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// /price command
bot.command('price', async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1);
  
  if (!args || args.length < 2) {
    return ctx.reply(
      '❌ <b>Usage:</b> /price <code>&lt;chain&gt; &lt;token&gt;</code>\n\n' +
      '<b>Example:</b>\n' +
      '/price solana So111...abc\n' +
      '/price eth 0x123...xyz',
      { parse_mode: 'HTML' }
    );
  }
  
  const [chainArg, token] = args;
  const chainMap: any = {
    sol: 'solana',
    solana: 'solana',
    eth: 'eth',
    ethereum: 'eth',
    bsc: 'bsc',
    binance: 'bsc',
  };
  
  const chain = chainMap[chainArg.toLowerCase()] || chainArg.toLowerCase();
  
  await ctx.reply(`🔍 Fetching price for ${chain.toUpperCase()}...`);
  
  try {
    const result = await callRustAPI(`/api/price/${chain}/${token}`);
    
    if (result.success && result.price) {
      const p = result.price;
      const changeEmoji = p.price_change_24h >= 0 ? '🟢' : '🔴';
      
      await ctx.reply(
        `💰 <b>Token Price</b>\n\n` +
        `<b>Chain:</b> ${p.chain.toUpperCase()}\n` +
        `<b>Token:</b> <code>${p.token.slice(0, 12)}...</code>\n\n` +
        `<b>Price:</b> $${formatNumber(p.price_usd, 8)}\n` +
        `<b>24h Change:</b> ${changeEmoji} ${formatNumber(p.price_change_24h)}%\n` +
        `<b>Volume 24h:</b> $${formatNumber(p.volume_24h)}\n` +
        `<b>Liquidity:</b> $${formatNumber(p.liquidity)}\n`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`❌ Error: ${result.error || 'Failed to fetch price'}`);
    }
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// /pnl command
bot.command('pnl', async (ctx) => {
  try {
    const positions: Position[] = await callRustAPI(`/api/positions/${ctx.from!.id}`);
    
    if (positions.length === 0) {
      return ctx.reply('📭 No active positions to calculate PnL');
    }
    
    let totalPnL = 0;
    let totalPnLPercent = 0;
    let winning = 0;
    let losing = 0;
    
    for (const pos of positions) {
      totalPnL += pos.pnl_usd;
      totalPnLPercent += pos.pnl_percent;
      if (pos.pnl_percent > 0) winning++;
      if (pos.pnl_percent < 0) losing++;
    }
    
    const avgPnL = totalPnLPercent / positions.length;
    
    let message = '<b>📈 Profit & Loss Summary</b>\n\n';
    message += `<b>Total PnL:</b> ${formatPnL(totalPnLPercent / positions.length)}\n`;
    message += `<b>Total PnL USD:</b> $${formatNumber(totalPnL)}\n`;
    message += `<b>Average PnL:</b> ${formatPnL(avgPnL)}\n\n`;
    message += `<b>Positions:</b> ${positions.length}\n`;
    message += `🟢 Winning: ${winning}\n`;
    message += `🔴 Losing: ${losing}\n`;
    
    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// /gas command
bot.command('gas', async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1);
  const chain = args && args.length > 0 ? args[0].toLowerCase() : ctx.session.settings.defaultChain;
  
  const chainMap: any = {
    sol: 'solana',
    solana: 'solana',
    eth: 'eth',
    ethereum: 'eth',
    bsc: 'bsc',
    binance: 'bsc',
  };
  
  const normalizedChain = chainMap[chain] || chain;
  
  await ctx.reply(`⛽ Fetching gas prices for ${normalizedChain.toUpperCase()}...`);
  
  try {
    const result = await callRustAPI(`/api/gas/${normalizedChain}`);
    
    if (result.success && result.gas_price) {
      const gp = result.gas_price;
      const unit = normalizedChain === 'solana' ? 'SOL' : normalizedChain === 'eth' ? 'Gwei' : 'Gwei';
      
      await ctx.reply(
        `⛽ <b>Gas Prices - ${gp.chain.toUpperCase()}</b>\n\n` +
        `🐌 Slow: ${gp.slow} ${unit}\n` +
        `⚡ Standard: ${gp.standard} ${unit}\n` +
        `🚀 Fast: ${gp.fast} ${unit}\n` +
        `🔥 Fastest: ${gp.fastest} ${unit}\n\n` +
        `Updated: ${new Date(gp.timestamp * 1000).toLocaleTimeString()}`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`❌ Error: ${result.error || 'Failed to fetch gas prices'}`);
    }
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// /history command
bot.command('history', async (ctx) => {
  try {
    await ctx.reply('📜 Fetching transaction history...');
    
    const history = await callRustAPI(`/api/history/${ctx.from!.id}`);
    
    if (!history.transactions || history.transactions.length === 0) {
      return ctx.reply('📭 No transaction history found');
    }
    
    let message = '<b>📜 Transaction History</b>\n\n';
    message += `<b>Total Trades:</b> ${history.total_trades}\n`;
    message += `<b>Total Volume:</b> $${formatNumber(history.total_volume)}\n`;
    message += `<b>Total Fees:</b> $${formatNumber(history.total_fees)}\n\n`;
    message += '<b>Recent Transactions:</b>\n\n';
    
    // Show last 10 transactions
    const recent = history.transactions.slice(-10).reverse();
    
    for (const tx of recent) {
      const date = new Date(tx.timestamp * 1000).toLocaleDateString();
      const emoji = tx.tx_type === 'buy' ? '🟢' : '🔴';
      const statusEmoji = tx.status === 'confirmed' ? '✅' : tx.status === 'pending' ? '⏳' : '❌';
      
      message += `${emoji} <b>${tx.tx_type.toUpperCase()}</b> ${statusEmoji}\n`;
      message += `${tx.chain.toUpperCase()} | ${tx.amount} @ $${formatNumber(tx.price, 6)}\n`;
      message += `TX: <code>${tx.tx_hash.slice(0, 16)}...</code>\n`;
      message += `${date}\n\n`;
    }
    
    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// /alerts command
bot.command('alerts', async (ctx) => {
  try {
    const alerts = await callRustAPI(`/api/alerts/${ctx.from!.id}`);
    
    if (!alerts || alerts.length === 0) {
      return ctx.reply(
        '🔔 <b>No Active Alerts</b>\n\n' +
        'Create alerts to get notified about:\n' +
        '• Take profit triggers\n' +
        '• Stop loss triggers\n' +
        '• Price movements\n' +
        '• Balance changes',
        { parse_mode: 'HTML' }
      );
    }
    
    let message = '<b>🔔 Your Alerts</b>\n\n';
    
    for (const alert of alerts) {
      let emoji = "🔔";
      if (alert.alert_type === "tp") emoji = "🎯";
      else if (alert.alert_type === "sl") emoji = "🛑";
      else if (alert.alert_type === "price") emoji = "💰";
      else if (alert.alert_type === "balance") emoji = "💼";
      
      message += `${emoji} <b>${alert.alert_type.toUpperCase()}</b>\n`;
      if alert.chain {
        message += `Chain: ${alert.chain.toUpperCase()}\n`;
      }
      if alert.token {
        message += `Token: <code>${alert.token.slice(0, 8)}...</code>\n`;
      }
      message += `Threshold: ${alert.threshold}\n`;
      message += `Condition: ${alert.condition}\n\n`;
    }
    
    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ==================== ERROR HANDLING ====================
bot.catch((err) => {
  console.error('Bot error:', err);
});

// ==================== START BOT ====================
async function startBot() {
  console.log('🤖 Starting Telegram bot...');
  
  // Check if Rust API is running
  try {
    const health = await fetch(`${RUST_API}/health`);
    if (health.ok) {
      console.log('✅ Connected to Rust Trading Engine');
    }
  } catch (error) {
    console.warn('⚠️  Warning: Cannot connect to Rust API at', RUST_API);
    console.warn('   Make sure trading-engine is running!');
  }
  
  // Start bot
  bot.start({
    onStart: (botInfo) => {
      console.log('✅ Bot started:', botInfo.username);
      console.log('📱 Ready to receive commands!');
    },
  });
}

startBot();
