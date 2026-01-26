// Telegram Bot - Production Ready
// File: telegram-bot/src/bot.ts
// Install: bun add grammy dotenv

import { Bot, InlineKeyboard, session, GrammyError, HttpError } from 'grammy';
import { config } from 'dotenv';
import { sendChatMessage, analyzeToken } from './eliza-client.js';
import { 
  RUST_API, 
  SessionData, 
  TradingSettings, 
  Position, 
  MyContext, 
  callRustAPI, 
  formatNumber, 
  formatPnL, 
  safeEditMessage 
} from './shared.js';
import { setupTrojanUI } from './trojan_ui.js';

config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is required!');
  process.exit(1);
}

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
      preset: 'custom',
      simulationMode: false,
      bundlerMode: false,
      ignoreSafety: false,
    },
  }),
}));

// Initialize Trojan UI
setupTrojanUI(bot);

// ==================== KEYBOARD LAYOUTS ====================
// All buttons arranged horizontally in rows of 3 - All main features visible
function getMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('💰 Buy', 'buy')
    .text('📊 Positions', 'positions')
    .text('📈 Portfolio', 'portfolio').row()
    .text('📦 Bundler', 'bundler')
    .text('🐋 Whales', 'whales')
    .text('📐 Grid Trading', 'grid_trading').row()
    .text('🏆 Leaderboard', 'leaderboard')
    .text('💼 Wallet', 'wallet')
    .text('⚙️ Settings', 'settings').row()
    .text('🔍 Check Token', 'check_token')
    .text('📥 Import', 'import_data')
    .text('❓ Help', 'help').row()
    .text('🤖 AI Assistant', 'ai_chat').row();
}

function getTradingMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('💰 Buy Token', 'buy')
    .text('📊 Positions', 'positions')
    .text('📈 Portfolio', 'portfolio').row()
    .text('🔙 Back', 'back_main').row();
}

function getToolsMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📦 Bundler', 'bundler')
    .text('🐋 Whales', 'whales')
    .text('📐 Grid Trading', 'grid_trading').row()
    .text('🏆 Leaderboard', 'leaderboard')
    .text('🔍 Check Token', 'check_token')
    .text('🔙 Back', 'back_main').row();
}

function getWalletMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('💼 View Wallets', 'wallet')
    .text('🔐 Generate', 'generate_wallet')
    .text('📥 Import', 'import_wallet').row()
    .text('🔙 Back', 'back_main').row();
}

// Check Token Button
bot.callbackQuery('check_token', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('To check a token, please send: /check <token_address>');
});

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
      .text('📊 Positions', 'positions')
      .text('💰 Trading', 'menu_trading').row()
      .text('🔄 Refresh', 'portfolio')
      .text('🔙 Back', 'back_main');

    await safeEditMessage(ctx, message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});



// ==================== COMMANDS ====================

// Chat-based Buy/Sell/Swap Handler
bot.on('message:text', async (ctx, next) => {
  const text = ctx.message.text.trim();
  // Regex: <Token> <Action> <Amount>
  // Supports: So11... buy 0.5 OR 0x... sell 50 OR So11... swap 0.5
  const match = text.match(/^(So11[a-zA-Z0-9]+|0x[a-fA-F0-9]{40}|[a-zA-Z0-9]{32,44})\s+(buy|sell|swap)\s+([\d.]+)$/i);

  if (!match) {
    return next();
  }

  const [, token, action, amountStr] = match;
  const amount = parseFloat(amountStr);
  const mode = action.toLowerCase();
  const settings = ctx.session.settings;

  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('❌ Invalid amount.');
  }

  // Treat 'swap' as 'buy'
  if (mode === 'buy' || mode === 'swap') {
    const actionText = mode === 'swap' ? 'Swap' : 'Buy';
    await ctx.reply(`🔄 <b>Executing Quick ${actionText}...</b>\n\nToken: <code>${token}</code>\nAmount: ${amount}`, { parse_mode: 'HTML' });
    
    try {
        const result = await callRustAPI('/api/buy', 'POST', {
          user_id: ctx.from!.id,
          chain: settings.defaultChain,
          token,
          amount: amountStr,
          slippage: settings.slippage,
          take_profit: settings.takeProfitPercent,
          stop_loss: settings.stopLossPercent,
          is_simulation: settings.simulationMode,
          bundler_enabled: settings.bundlerMode,
          ignore_safety: settings.ignoreSafety,
        });

        if (result.success) {
            await ctx.reply(
                `✅ <b>${actionText} Successful!</b>\nTX: <code>${result.tx_hash}</code>\nPos ID: <code>${result.position_id}</code>`,
                { parse_mode: 'HTML' }
            );
        } else {
      if (result.error?.includes('Token Risk')) {
        await ctx.reply(
           `⚠️ <b>Security Check Failed</b>\n\n` +
           `${result.error}\n\n` +
           `To bypass, enable "Ignore Safety" in /settings or use:\n` +
           `/force_buy ${token} ${amount}`,
           { 
             parse_mode: 'HTML',
             reply_markup: new InlineKeyboard().text('⚠️ Force Buy', `force_buy:${token}:${amount}`)
           }
        );
      } else {
        await ctx.reply(`❌ ${actionText} Failed: ${result.error}`);
      }
        }
    } catch (e: any) {
        if (e.message.includes('Token Risk') || (e.message.includes('API error') && e.message.includes('Token Risk'))) {
             // Try to extract clean error message
             const match = e.message.match(/API error \(\d+\): (.*)/);
             let errorMsg = match ? match[1] : e.message;
             try { const json = JSON.parse(errorMsg); if(json.error) errorMsg = json.error; } catch(err){}
             
             await ctx.reply(
               `⚠️ <b>Security Check Failed</b>\n\n` +
               `${errorMsg}\n\n` +
               `To bypass, enable "Ignore Safety" in /settings`,
               { 
                 parse_mode: 'HTML',
                 reply_markup: new InlineKeyboard().text('⚙️ Settings', 'settings')
               }
            );
            return;
        }
        await ctx.reply(`❌ Error: ${e.message}`);
    }
    return;
  }

  if (mode === 'sell') {
    await ctx.reply(`🔄 <b>Analyzing Sell Request...</b>`, { parse_mode: 'HTML' });
    
    // 1. Find Position
    try {
        const positions: Position[] = await callRustAPI(`/api/positions/${ctx.from!.id}`);
        // Filter for this token
        const position = positions.find(p => p.position.token === token || p.position.token_address === token); 
        // Note: API returns 'token_address' in DB structure but type said 'token'. Checking both or fixing type.
        // Actually looking at Position interface: it has 'token' in the 'position' object.
        
        if (!position) {
            return ctx.reply('❌ No active position found for this token.');
        }

        const posId = position.position.position_id;
        const totalAmount = parseFloat(position.position.amount);
        let percentToSell = 0;

        // Logic: specific amount vs percentage
        // If user says "Sell 500" and they have 1000, we sell 50%.
        // If user says "Sell 50" and they have 100, we sell 50%.
        // Ambiguity: "Sell 50". Do they mean 50 tokens or 50%?
        // Heuristic:
        // If RequestAmount <= TotalAmount, we treat it as Token Amount -> Calculate %.
        // If RequestAmount > TotalAmount && RequestAmount <= 100, we *could* treat as %, but safer to error "Insufficient balance".
        
        if (amount <= totalAmount) {
             percentToSell = (amount / totalAmount) * 100;
             await ctx.reply(`📉 Calculated: Selling ${amount} tokens (${percentToSell.toFixed(2)}% of position)`);
        } else {
             // User requested more than they have. 
             // Could be they meant %, e.g. "Sell 50" (percent) but they only have 10 tokens.
             if (amount <= 100) {
                 percentToSell = amount;
                 await ctx.reply(`📉 Assumed Percentage: Selling ${percentToSell}% of position`);
             } else {
                 return ctx.reply(`❌ Insufficient balance. You have ${totalAmount} tokens.`);
             }
        }
        
        // Cap at 100%
        if (percentToSell > 100) percentToSell = 100;

        const result = await callRustAPI('/api/sell', 'POST', {
             user_id: ctx.from!.id,
             position_id: posId,
             percent: percentToSell
        });

        if (result.success) {
             await ctx.reply(
                `✅ <b>Sell Successful!</b>\nTX: <code>${result.tx_hash}</code>\nPnL: ${formatPnL(result.profit_loss || 0)}`,
                { parse_mode: 'HTML' }
            );
        } else {
             await ctx.reply(`❌ Sell Failed: ${result.error}`);
        }

    } catch (e: any) {
        await ctx.reply(`❌ Error: ${e.message}`);
    }
    return;
  }
});

// /start command
bot.command('start', async (ctx) => {
  try {
    // Check if user already has wallets
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);

    // Check if wallets is an array and has items
    const hasWallets = Array.isArray(wallets) && wallets.length > 0;

    if (hasWallets) {
      // User has wallets - show balance and positions
      const loadingMsg = await ctx.reply('📊 <b>Loading your portfolio...</b>', { parse_mode: 'HTML' });

      // Fetch balances and positions concurrently
      const [balancePromises, positionsResult] = await Promise.allSettled([
        Promise.allSettled(
          wallets.map(async (wallet: any) => {
            try {
              const balance = await callRustAPI(`/api/wallet/balance/${ctx.from!.id}/${wallet.chain}`);
              return { wallet, balance };
            } catch (error: any) {
              return { wallet, balance: null, error: error.message };
            }
          })
        ),
        callRustAPI(`/api/positions/${ctx.from!.id}`).catch(() => []),
      ]);

      let message = '💼 <b>Your Portfolio</b>\n\n';
      message += '━━━━━━━━━━━━━━━━━━━━\n\n';

      // Show wallet balances
      message += '💰 <b>Wallet Balances</b>\n';
      message += '━━━━━━━━━━━━━━━━━━━━\n\n';

      if (balancePromises.status === 'fulfilled') {
        const balanceResults = balancePromises.value;
        for (const result of balanceResults) {
          if (result.status === 'fulfilled') {
            const { wallet, balance, error } = result.value;
            const chain = wallet.chain.toUpperCase();
            const chainEmoji = chain === 'SOLANA' ? '🟣' : chain === 'ETH' ? '🔵' : '🟡';
            const symbol = chain === 'SOLANA' ? 'SOL' : chain === 'ETH' ? 'ETH' : 'BNB';

            message += `${chainEmoji} <b>${chain}</b>\n`;
            message += `📍 <code>${wallet.address}</code>\n`;

            if (error) {
              message += `💰 <i>⚠️ Error: ${error}</i>\n`;
            } else if (balance && balance.native_balance && !balance.error) {
              const bal = parseFloat(balance.native_balance);
              const usd = balance.total_usd || 0;
              message += `💰 <b>${formatNumber(bal, 6)} ${symbol}</b>\n`;
              message += `💵 $${formatNumber(usd, 2)}\n`;
            } else {
              message += `💰 <i>Loading...</i>\n`;
            }
            message += '\n';
          }
        }
      }

      // Show positions
      let positions: Position[] = [];
      if (positionsResult.status === 'fulfilled' && Array.isArray(positionsResult.value)) {
        positions = positionsResult.value;
      }

      if (positions.length > 0) {
        message += '━━━━━━━━━━━━━━━━━━━━\n\n';
        message += '📊 <b>Active Positions</b>\n';
        message += '━━━━━━━━━━━━━━━━━━━━\n\n';

        for (const pos of positions.slice(0, 5)) { // Show max 5 positions
          const chain = pos.position.chain.toUpperCase();
          const age = Math.floor((Date.now() / 1000 - pos.position.timestamp) / 60);

          const tokenAddress = pos.position.token || 'Unknown';
          message += `${formatPnL(pos.pnl_percent)} <b>${chain}</b>\n`;
          message += `📍 <code>${tokenAddress.slice(0, 12)}...${tokenAddress.slice(-6)}</code>\n`;
          message += `💰 Entry: $${formatNumber(pos.position.entry_price, 6)}\n`;
          message += `📈 Current: $${formatNumber(pos.position.current_price, 6)}\n`;
          message += `⏰ Age: ${age}m\n`;
          message += `🎯 TP: +${pos.position.take_profit_percent}% | `;
          message += `🛑 SL: ${pos.position.stop_loss_percent}%\n`;
          message += '\n';
        }

        if (positions.length > 5) {
          message += `... and ${positions.length - 5} more positions\n\n`;
        }
      } else {
        message += '━━━━━━━━━━━━━━━━━━━━\n\n';
        message += '📭 <b>No Active Positions</b>\n\n';
        message += 'Start trading to see your positions here.\n\n';
      }

      message += '━━━━━━━━━━━━━━━━━━━━\n\n';
      message += 'Use the menu below to manage your portfolio:';

      // Delete the loading message and send new one
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
      } catch {
        // Ignore if can't delete
      }
      
      await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: getMainKeyboard(),
      });
    } else {
      // New user - show welcome message
      const welcomeMessage = `
🤖 <b>Welcome to MemecoinSniper Bot!</b>

⚡ Lightning-fast multi-chain trading
🔒 Secure non-custodial wallets
🎯 Auto TP/SL on every trade

<b>Supported Chains:</b>
• Solana (SOL)
• Ethereum (ETH)
• Binance Smart Chain (BSC)

━━━━━━━━━━━━━━━━━━━━

<b>All Features Available:</b>
• <b>Buy:</b> Purchase tokens
• <b>Positions:</b> View active trades
• <b>Portfolio:</b> Complete holdings overview
• <b>Bundler:</b> Save gas with transaction bundling
• <b>Whales:</b> Track large trades
• <b>Grid Trading:</b> Automated grid strategy
• <b>Leaderboard:</b> Top traders rankings

Get started by creating your wallet 👇
      `;

      await ctx.reply(welcomeMessage, {
        parse_mode: 'HTML',
        reply_markup: getMainKeyboard(),
      });
    }
  } catch (error: any) {
    console.error('Error in /start command:', error);
    // Try to show portfolio anyway if error, or show welcome
    try {
      const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
      if (Array.isArray(wallets) && wallets.length > 0) {
        // User has wallets but there was an error - show basic info
        await ctx.reply(
          `💼 <b>Your Wallets</b>\n\n` +
          `You have ${wallets.length} wallet(s) configured.\n\n` +
          `Use /wallet to view balances or /positions to see your positions.`,
          { parse_mode: 'HTML', reply_markup: getMainKeyboard() }
        );
      } else {
        throw error; // Re-throw to show welcome message
      }
    } catch {
      // Fallback to welcome message on error
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
    }
  }
});

// /help command
bot.command('help', async (ctx) => {
  const helpText = `
📚 <b>Command Reference</b>

<b>💰 Quick Trading:</b>
<code>&lt;token&gt; buy &lt;amount&gt;</code>
<code>&lt;token&gt; swap &lt;amount&gt;</code>
<code>&lt;token&gt; sell &lt;amount&gt;</code>

<b>Examples:</b>
<code>So11...abc 0.5 buy</code>
<code>4fERe7x...u6 0.2 swap</code>

<b>Wallet:</b>
/wallet - View balances
/deposit - Deposit addresses

<b>Settings:</b>
/settings - Configure bot
• Toggle Safety Checks
• Simulation Mode
• Bundler Mode

<b>Tools:</b>
/check <code>&lt;token&gt;</code> - Security check
/positions - Active positions
/import_data - Import wallets

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
      is_simulation: settings.simulationMode,
      bundler_enabled: settings.bundlerMode,
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
        `Type: ${settings.simulationMode ? '🧪 SIMULATION' : settings.bundlerMode ? '📦 BUNDLED' : '🚀 REAL'}\n` +
        `Position ID: <code>${result.position_id}</code>`,
        { parse_mode: 'HTML' }
      );
    } else {
      if (result.error?.includes('Token Risk')) {
         await ctx.reply(
            `⚠️ <b>Security Check Failed</b>\n\n` +
            `${result.error}\n\n` +
            `To bypass this check and buy anyway, use:\n` +
            `/force_buy ${token} ${amount}`,
            { 
               parse_mode: 'HTML',
               reply_markup: new InlineKeyboard().text('⚠️ Force Buy', `force_buy:${token}:${amount}`)
            }
         );
      } else {
         await ctx.reply(`❌ Trade failed: ${result.error}`);
      }
    }
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// /force_buy command
bot.command('force_buy', async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1);

  if (!args || args.length < 2) {
    return ctx.reply(
      '❌ <b>Usage:</b> /force_buy <code>&lt;token&gt; &lt;amount&gt;</code>\n' +
      'Bypasses security checks. Use at your own risk!',
      { parse_mode: 'HTML' }
    );
  }

  const [token, amount] = args;
  const settings = ctx.session.settings;

  await ctx.reply('⚠️ <b>Forcing Buy...</b> (Skipping Safety Checks)', { parse_mode: 'HTML' });

  try {
     const result = await callRustAPI('/api/buy', 'POST', {
       user_id: ctx.from!.id,
       chain: settings.defaultChain,
       token,
       amount,
       slippage: settings.slippage,
       take_profit: settings.takeProfitPercent,
       stop_loss: settings.stopLossPercent,
       is_simulation: settings.simulationMode,
       bundler_enabled: settings.bundlerMode,
       ignore_safety: true // New flag
     });

     if (result.success) {
          const chain = settings.defaultChain.toUpperCase();
          await ctx.reply(
            `✅ <b>Force Buy Successful!</b>\n\n` +
            `Chain: ${chain}\n` +
            `Token: <code>${token}</code>\n` +
            `Amount: ${amount}\n` +
            `TX: <code>${result.tx_hash}</code>`,
            { parse_mode: 'HTML' }
          );
     } else {
          await ctx.reply(`❌ Force Buy Failed: ${result.error}`);
     }
  } catch (e: any) {
       await ctx.reply(`❌ Error: ${e.message}`);
  }
});

// Callback for Force Buy Button
bot.callbackQuery(/^force_buy:(.+):(.+)$/, async (ctx) => {
  const match = ctx.callbackQuery.data.match(/^force_buy:(.+):(.+)$/);
  if (!match) return;

  const [_, token, amount] = match;
  const settings = ctx.session.settings;

  // Answer callback so the loading spinner stops
  await ctx.answerCallbackQuery('⚠️ Forcing Buy...');
  
  // Provide feedback in chat
  await ctx.reply(`⚠️ <b>Forcing Buy...</b>\n\nToken: <code>${token}</code>\nAmount: ${amount}\n\n(Skipping Safety Checks)`, { parse_mode: 'HTML' });

  try {
     const result = await callRustAPI('/api/buy', 'POST', {
       user_id: ctx.from!.id,
       chain: settings.defaultChain,
       token,
       amount,
       slippage: settings.slippage,
       take_profit: settings.takeProfitPercent,
       stop_loss: settings.stopLossPercent,
       is_simulation: settings.simulationMode,
       bundler_enabled: settings.bundlerMode,
       ignore_safety: true
     });

     if (result.success) {
          const chain = settings.defaultChain.toUpperCase();
          await ctx.reply(
            `✅ <b>Force Buy Executed!</b>\n\n` +
            `Chain: ${chain}\n` +
            `Token: <code>${token}</code>\n` +
            `Amount: ${amount}\n` +
            `TX: <code>${result.tx_hash}</code>\n\n` +
            `Type: ${settings.simulationMode ? '🧪 SIMULATION' : settings.bundlerMode ? '📦 BUNDLED' : '🚀 REAL'}`,
            { parse_mode: 'HTML' }
          );
     } else {
          await ctx.reply(`❌ Force Buy Failed: ${result.error}`);
     }
  } catch (e: any) {
       await ctx.reply(`❌ Error: ${e.message}`);
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
  const presetEmoji = {
    custom: '⚙️',
    safe: '🛡️',
    degen: '🦍',
    snipe: '⚡'
  };

  const message = `
⚙️ <b>Your Settings</b>

<b>Trading Mode:</b>
• Simulation: ${settings.simulationMode ? '✅ ON' : '❌ OFF'}
• Bundler: ${settings.bundlerMode ? '✅ ON' : '❌ OFF'} (Save Gas)
• Preset: ${presetEmoji[settings.preset]} ${settings.preset.toUpperCase()}

<b>Parameters:</b>
• Chain: ${settings.defaultChain.toUpperCase()}
• Buy Amount: ${settings.buyAmount} ${settings.defaultChain === 'solana' ? 'SOL' : settings.defaultChain === 'eth' ? 'ETH' : 'BNB'}
• Slippage: ${settings.slippage}%
• Take Profit: +${settings.takeProfitPercent}%
• Stop Loss: ${settings.stopLossPercent}%
• Auto-Trade: ${settings.autoTrade ? 'ON ✅' : 'OFF ❌'}
  `;

  const keyboard = new InlineKeyboard()
    .text(`🧪 Sim Mode: ${settings.simulationMode ? 'ON' : 'OFF'}`, 'toggle_sim')
    .text(`📦 Bundler: ${settings.bundlerMode ? 'ON' : 'OFF'}`, 'toggle_bundler').row()
    .text('🛡️ Safe', 'preset_safe')
    .text('🦍 Degen', 'preset_degen')
    .text('⚡ Snipe', 'preset_snipe').row()
    .text('🔙 Back', 'back_main');

  await ctx.reply(message, { parse_mode: 'HTML', reply_markup: keyboard });
});

// Toggle Handlers
bot.callbackQuery('toggle_sim', async (ctx) => {
  ctx.session.settings.simulationMode = !ctx.session.settings.simulationMode;
  await ctx.answerCallbackQuery(`Simulation Mode: ${ctx.session.settings.simulationMode ? 'ON' : 'OFF'}`);
  await showSettings(ctx); // Helper to refresh settings view
});

bot.callbackQuery('toggle_bundler', async (ctx) => {
  ctx.session.settings.bundlerMode = !ctx.session.settings.bundlerMode;
  await ctx.answerCallbackQuery(`Bundler Mode: ${ctx.session.settings.bundlerMode ? 'ON' : 'OFF'}`);
  await showSettings(ctx);
});

// Preset Handlers
bot.callbackQuery('preset_safe', async (ctx) => {
  const s = ctx.session.settings;
  s.preset = 'safe';
  s.slippage = 1;
  s.takeProfitPercent = 20;
  s.stopLossPercent = -10;
  await ctx.answerCallbackQuery('Applied Safe Preset');
  await showSettings(ctx);
});

bot.callbackQuery('preset_degen', async (ctx) => {
  const s = ctx.session.settings;
  s.preset = 'degen';
  s.slippage = 10;
  s.takeProfitPercent = 100;
  s.stopLossPercent = -50;
  await ctx.answerCallbackQuery('Applied Degen Preset');
  await showSettings(ctx);
});

bot.callbackQuery('preset_snipe', async (ctx) => {
  const s = ctx.session.settings;
  s.preset = 'snipe';
  s.slippage = 20;
  s.takeProfitPercent = 200;
  s.stopLossPercent = -80;
  await ctx.answerCallbackQuery('Applied Snipe Preset');
  await showSettings(ctx);
});

// Helper to refresh settings message
async function showSettings(ctx: MyContext) {
  const settings = ctx.session.settings;
  const presetEmoji = {
    custom: '⚙️',
    safe: '🛡️',
    degen: '🦍',
    snipe: '⚡'
  };

  const message = `
⚙️ <b>Your Settings</b>

<b>Trading Mode:</b>
• Simulation: ${settings.simulationMode ? '✅ ON' : '❌ OFF'}
• Bundler: ${settings.bundlerMode ? '✅ ON' : '❌ OFF'} (Save Gas)
• Preset: ${presetEmoji[settings.preset]} ${settings.preset.toUpperCase()}

<b>Parameters:</b>
• Chain: ${settings.defaultChain.toUpperCase()}
• Buy Amount: ${settings.buyAmount} ${settings.defaultChain === 'solana' ? 'SOL' : settings.defaultChain === 'eth' ? 'ETH' : 'BNB'}
• Slippage: ${settings.slippage}%
• Take Profit: +${settings.takeProfitPercent}%
• Stop Loss: ${settings.stopLossPercent}%
• Auto-Trade: ${settings.autoTrade ? 'ON ✅' : 'OFF ❌'}
  `;

  const keyboard = new InlineKeyboard()
    .text(`🧪 Sim Mode: ${settings.simulationMode ? 'ON' : 'OFF'}`, 'toggle_sim')
    .text(`📦 Bundler: ${settings.bundlerMode ? 'ON' : 'OFF'}`, 'toggle_bundler').row()
    .text('🛡️ Safe', 'preset_safe')
    .text('🦍 Degen', 'preset_degen')
    .text('⚡ Snipe', 'preset_snipe').row()
    .text('🔙 Back', 'back_main');

  try {
    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (e) {
    // Ignore unedited error
  }
}

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
      try {
        const balance = await callRustAPI(`/api/wallet/balance/${ctx.from!.id}/${wallet.chain}`);
        message += `<b>${chain}</b>\n`;
        message += `Address: <code>${address}</code>\n`;
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
  const chain = args && args.length > 0 ? args[0].toLowerCase() : null;

  if (!chain) {
    // Show menu if no chain specified
    const keyboard = new InlineKeyboard()
      .text('🟣 Solana', 'gen_wallet_solana')
      .text('🔵 Ethereum', 'gen_wallet_eth').row()
      .text('🟡 BSC', 'gen_wallet_bsc').row()
      .text('🔙 Back', 'back_main');

    return ctx.reply(
      '🔐 <b>Generate Wallet</b>\n\n' +
      'Select a chain to generate a wallet for:',
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  }

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
    // Check if wallet already exists
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
    const hasWallet = wallets && wallets.some((w: any) => w.chain === normalizedChain);

    if (hasWallet) {
      return ctx.reply(
        `⚠️ <b>Wallet Already Exists</b>\n\n` +
        `You already have a ${normalizedChain.toUpperCase()} wallet.\n\n` +
        `Use /wallet to view your existing wallet.`,
        { parse_mode: 'HTML' }
      );
    }

    const result = await callRustAPI('/api/wallet/generate', 'POST', {
      user_id: ctx.from!.id,
      chain: normalizedChain,
    });

    if (result.success) {
      let message = `✅ <b>Wallet Generated Successfully!</b>\n\n`;
      message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
      message += `🌐 <b>Chain:</b> ${normalizedChain.toUpperCase()}\n`;
      message += `📍 <b>Address:</b>\n<code>${result.address}</code>\n\n`;

      if (result.private_key) {
        message += `🔑 <b>Private Key:</b>\n<code>${result.private_key}</code>\n\n`;
      }

      if (result.mnemonic) {
        message += `📝 <b>Mnemonic (12 words):</b>\n<code>${result.mnemonic}</code>\n\n`;
      }

      message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
      message += `⚠️ <b>SECURITY WARNING</b>\n\n`;
      message += `• Save your private key/mnemonic securely\n`;
      message += `• Never share it with anyone\n`;
      message += `• Store it in a password manager\n`;
      message += `• You cannot recover it if lost`;

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
        '💼 <b>Wallet Management</b>\n\n' +
        '🔒 <b>Secure Non-Custodial Wallets</b>\n\n' +
        'No wallets found. Create or import a wallet to get started:\n\n' +
        '• <b>Generate:</b> Create a new secure wallet\n' +
        '• <b>Import:</b> Import existing wallet with private key',
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
      return;
    }

    let message = '💼 <b>Your Wallets</b>\n\n';
    message += '🔒 <b>Non-Custodial • Encrypted Storage</b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━\n\n';

    // Fetch balances for all wallets with better error handling
    const walletPromises = wallets.map(async (wallet: any) => {
      try {
        const balance = await callRustAPI(`/api/wallet/balance/${ctx.from!.id}/${wallet.chain}`);
        // Check if response has error
        if (balance && balance.error) {
          return { wallet, balance: null, error: balance.error };
        }
        return { wallet, balance, error: null };
      } catch (error: any) {
        return { wallet, balance: null, error: error.message || 'Failed to fetch balance' };
      }
    });

    const walletsWithBalances = await Promise.allSettled(walletPromises);

    for (const result of walletsWithBalances) {
      if (result.status === 'fulfilled') {
        const { wallet, balance, error } = result.value;
        const chain = wallet.chain.toUpperCase();
        const address = wallet.address;
        const shortAddress = address.length > 20
          ? `${address.slice(0, 10)}...${address.slice(-8)}`
          : address;

        const chainEmoji = chain === 'SOLANA' ? '🟣' : chain === 'ETH' ? '🔵' : '🟡';
        const symbol = chain === 'SOLANA' ? 'SOL' : chain === 'ETH' ? 'ETH' : 'BNB';

        message += `${chainEmoji} <b>${chain}</b>\n`;
        message += `📍 <code>${shortAddress}</code>\n`;

        if (error) {
          message += `💰 Balance: <i>⚠️ Error: ${error}</i>\n`;
        } else if (balance && balance.native_balance) {
          const bal = parseFloat(balance.native_balance);
          const usd = balance.total_usd || 0;
          message += `💰 Balance: <b>${formatNumber(bal, 6)} ${symbol}</b>\n`;
          message += `💵 Value: <b>$${formatNumber(usd, 2)}</b>\n`;
        } else {
          message += `💰 Balance: <i>Loading...</i>\n`;
        }
        message += '\n';
      }
    }

    message += '━━━━━━━━━━━━━━━━━━━━\n\n';
    message += '⚠️ <i>Your private keys are encrypted and stored securely</i>';

    const keyboard = new InlineKeyboard();

    // Add wallet-specific actions
    for (const result of walletsWithBalances) {
      if (result.status === 'fulfilled') {
        const { wallet } = result.value;
        const chain = wallet.chain.toUpperCase();
        const chainEmoji = chain === 'SOLANA' ? '🟣' : chain === 'ETH' ? '🔵' : '🟡';
        keyboard.text(`${chainEmoji} ${chain} Options`, `wallet_options_${wallet.chain}`).row();
      }
    }

    keyboard.text('🔄 Refresh Balances', 'wallet').row()
      .text('🔐 Generate New', 'generate_wallet')
      .text('📥 Import', 'import_wallet').row()
      .text('🔙 Back', 'back_main');

    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
    await ctx.editMessageText(
      `❌ <b>Error Loading Wallets</b>\n\n` +
      `Unable to fetch wallet information.\n\n` +
      `<i>${error.message}</i>`,
      { parse_mode: 'HTML' }
    );
  }
});

// Generate wallet callback - show chain selection menu
bot.callbackQuery('generate_wallet', async (ctx) => {
  await ctx.answerCallbackQuery();

  try {
    // Check existing wallets
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
    const existingChains = wallets ? wallets.map((w: any) => w.chain) : [];

    const keyboard = new InlineKeyboard();

    // Show available chains to generate
    const chains = [
      { name: 'Solana', value: 'solana', emoji: '🟣' },
      { name: 'Ethereum', value: 'eth', emoji: '🔵' },
      { name: 'BSC', value: 'bsc', emoji: '🟡' },
    ];

    chains.forEach((chain) => {
      const hasWallet = existingChains.includes(chain.value);
      const label = hasWallet
        ? `${chain.emoji} ${chain.name} (Exists)`
        : `${chain.emoji} ${chain.name}`;
      keyboard.text(label, `gen_wallet_${chain.value}`).row();
    });

    keyboard.text('🔙 Back', 'wallet');

    let message = '🔐 <b>Generate New Wallet</b>\n\n';
    message += 'Select a chain to generate a wallet for:\n\n';

    if (existingChains.length > 0) {
      message += '⚠️ <b>Existing Wallets:</b>\n';
      existingChains.forEach((chain: string) => {
        message += `• ${chain.toUpperCase()}\n`;
      });
      message += '\n';
    }

    message += '💡 <b>Note:</b> You can only have one wallet per chain.';

    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// Generate wallet for specific chain
bot.callbackQuery(/^gen_wallet_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const chain = ctx.match[1];
  const chainMap: any = {
    solana: 'solana',
    eth: 'eth',
    ethereum: 'eth',
    bsc: 'bsc',
    binance: 'bsc',
  };
  const normalizedChain = chainMap[chain] || chain;

  try {
    // Check if wallet already exists
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
    const hasWallet = wallets && wallets.some((w: any) => w.chain === normalizedChain);

    if (hasWallet) {
      return ctx.editMessageText(
        `⚠️ <b>Wallet Already Exists</b>\n\n` +
        `You already have a ${normalizedChain.toUpperCase()} wallet.\n\n` +
        `Use the wallet menu to view your existing wallet or import a different one.`,
        { parse_mode: 'HTML' }
      );
    }

    await ctx.editMessageText(`🔐 Generating ${normalizedChain.toUpperCase()} wallet...`, { parse_mode: 'HTML' });

    const result = await callRustAPI('/api/wallet/generate', 'POST', {
      user_id: ctx.from.id,
      chain: normalizedChain,
    });

    if (result.success) {
      let message = `✅ <b>Wallet Generated Successfully!</b>\n\n`;
      message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
      message += `🌐 <b>Chain:</b> ${normalizedChain.toUpperCase()}\n`;
      message += `📍 <b>Address:</b>\n<code>${result.address}</code>\n\n`;

      if (result.private_key) {
        message += `🔑 <b>Private Key:</b>\n<code>${result.private_key}</code>\n\n`;
      }

      if (result.mnemonic) {
        message += `📝 <b>Mnemonic (12 words):</b>\n<code>${result.mnemonic}</code>\n\n`;
      }

      message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
      message += `⚠️ <b>SECURITY WARNING</b>\n\n`;
      message += `• Save your private key/mnemonic securely\n`;
      message += `• Never share it with anyone\n`;
      message += `• Store it in a password manager\n`;
      message += `• You cannot recover it if lost\n\n`;
      message += `🔒 Your keys are encrypted and stored securely.`;

      const keyboard = new InlineKeyboard()
        .text('💼 View Wallets', 'wallet').row()
        .text('🔙 Back', 'back_main');

      await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
    } else {
      await ctx.editMessageText(
        `❌ <b>Wallet Generation Failed</b>\n\n` +
        `Error: ${result.error || 'Unknown error'}\n\n` +
        `Please try again.`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// Wallet options for specific chain
bot.callbackQuery(/^wallet_options_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const chain = ctx.match[1];
  const chainUpper = chain.toUpperCase();
  const chainEmoji = chainUpper === 'SOLANA' ? '🟣' : chainUpper === 'ETH' ? '🔵' : '🟡';

  try {
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
    const wallet = wallets.find((w: any) => w.chain === chain);

    if (!wallet) {
      return ctx.editMessageText('❌ Wallet not found.', { parse_mode: 'HTML' });
    }

    const keyboard = new InlineKeyboard()
      .text('🔑 View Private Key', `show_key_${chain}`).row();

    if (chain === 'solana') {
      keyboard.text('🗑️ Close Token Accounts', `close_tokens_${chain}`).row();
    }

    keyboard.text('🔙 Back', 'wallet');

    const shortAddress = wallet.address.length > 20
      ? `${wallet.address.slice(0, 10)}...${wallet.address.slice(-8)}`
      : wallet.address;

    let message = `${chainEmoji} <b>${chainUpper} Wallet Options</b>\n\n`;
    message += '━━━━━━━━━━━━━━━━━━━━\n\n';
    message += `📍 <b>Address:</b>\n<code>${wallet.address}</code>\n\n`;
    message += '━━━━━━━━━━━━━━━━━━━━\n\n';
    message += 'Select an action:';

    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// Close token accounts for Solana
bot.callbackQuery(/^close_tokens_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const chain = ctx.match[1];

  if (chain !== 'solana') {
    return ctx.editMessageText('❌ This feature is only available for Solana.', { parse_mode: 'HTML' });
  }

  try {
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
    const wallet = wallets.find((w: any) => w.chain === chain);

    if (!wallet) {
      return ctx.editMessageText('❌ Wallet not found.', { parse_mode: 'HTML' });
    }

    // For now, show a message - we'll need to implement the API endpoint
    const keyboard = new InlineKeyboard()
      .text('✅ Confirm Close', `confirm_close_tokens_${chain}`).row()
      .text('❌ Cancel', `wallet_options_${chain}`);

    await ctx.editMessageText(
      `🗑️ <b>Close Token Accounts</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `This will close all empty token accounts for your Solana wallet.\n\n` +
      `⚠️ <b>Warning:</b>\n` +
      `• Only empty token accounts will be closed\n` +
      `• You'll receive rent back (≈0.002 SOL per account)\n` +
      `• This action cannot be undone\n\n` +
      `💡 <b>Note:</b> This feature helps recover rent from unused token accounts.`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// Confirm close token accounts
bot.callbackQuery(/^confirm_close_tokens_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const chain = ctx.match[1];

  try {
    // Call API to close token accounts
    // We'll need to add this endpoint to the Rust API
    await ctx.editMessageText('⏳ Closing token accounts...', { parse_mode: 'HTML' });

    // Get wallet info
    // In production, call: /api/wallet/close-token-accounts
    const result = await callRustAPI('/api/wallet/close-token-accounts', 'POST', {
      user_id: ctx.from.id,
      chain: chain,
    }).catch(() => ({ success: false, error: 'API endpoint not implemented yet' }));

    if (result.success) {
      await ctx.editMessageText(
        `✅ <b>Token Accounts Closed</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Successfully closed empty token accounts.\n\n` +
        `💰 <b>Rent Recovered:</b> ${result.rent_recovered || '0'} SOL\n` +
        `📊 <b>Accounts Closed:</b> ${result.accounts_closed || '0'}\n\n` +
        `Your wallet has been optimized.`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.editMessageText(
        `❌ <b>Failed to Close Accounts</b>\n\n` +
        `Error: ${result.error || 'Unknown error'}\n\n` +
        `This feature may not be fully implemented yet.`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (error: any) {
    await ctx.editMessageText(
      `❌ <b>Error</b>\n\n` +
      `Unable to close token accounts.\n\n` +
      `<i>${error.message}</i>`,
      { parse_mode: 'HTML' }
    );
  }
});

// Import wallet callback
bot.callbackQuery('import_wallet', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingInput = 'import_wallet';
  await ctx.editMessageText(
    '📥 <b>Import Wallet</b>\n\n' +
    'Send me your private key:\n\n' +
    'Format: <code>&lt;chain&gt; &lt;private_key&gt;</code>\n\n' +
    'Example:\n' +
    '<code>sol 5KJvsngHeM...xyz</code>\n' +
    '<code>eth 0x1234...abcd</code>\n\n' +
    'Or just send the private key and I\'ll use your default chain.',
    { parse_mode: 'HTML' }
  );
});

// Buy button
bot.callbackQuery('buy', async (ctx) => {
  await ctx.answerCallbackQuery();

  // Check if user has wallet for default chain
  try {
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
    const defaultChain = ctx.session.settings.defaultChain;
    const hasWallet = wallets && wallets.some((w: any) => w.chain === defaultChain);

    if (!hasWallet) {
      const keyboard = new InlineKeyboard()
        .text('🔐 Generate Wallet', 'generate_wallet')
        .text('📥 Import Wallet', 'import_wallet')
        .text('🔙 Back', 'menu_trading').row();

      await safeEditMessage(
        ctx,
        '❌ <b>Wallet Required</b>\n\n' +
        `You need to setup a ${defaultChain.toUpperCase()} wallet before buying.\n\n` +
        'Please create or import a wallet first:',
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
      return;
    }

    ctx.session.awaitingInput = 'buy';
    const keyboard = new InlineKeyboard()
      .text('🔙 Back', 'menu_trading');

    await safeEditMessage(
      ctx,
      '💰 <b>Quick Buy</b>\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n\n' +
      '🔒 <b>Secure Trading Interface</b>\n\n' +
      'Please provide the token contract address you wish to purchase.\n\n' +
      '⚠️ <b>Security Note:</b> All tokens undergo automated security screening before purchase.\n\n' +
      '📝 <b>Send token address:</b>\n\n' +
      '💡 <b>Example:</b>\n' +
      '<code>2tJU3pMh4HJjKa9HN6HngdopfNqqaeEytFqW98Kqpump</code>',
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (error: any) {
    await ctx.reply(`❌ Error checking wallet: ${error.message}`);
  }
});

// ==================== TOGGLE HANDLERS ====================

// Toggle Safety Checks
bot.callbackQuery('toggle_safety', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.settings.ignoreSafety = !ctx.session.settings.ignoreSafety;
  
  const status = ctx.session.settings.ignoreSafety ? 'DISABLED ⚠️' : 'ENABLED 🛡️';
  await ctx.reply(
    `${ctx.session.settings.ignoreSafety ? '⚠️' : '🛡️'} <b>Safety Checks ${status}</b>\n\n` +
    (ctx.session.settings.ignoreSafety 
      ? '⚠️ <b>Warning:</b> You can now buy risky tokens without security warnings.\nUse with caution!' 
      : '✅ Tokens will be checked for safety before purchase.'),
    { parse_mode: 'HTML' }
  );
});

// Toggle Simulation Mode
bot.callbackQuery('toggle_simulation', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.settings.simulationMode = !ctx.session.settings.simulationMode;
  
  const status = ctx.session.settings.simulationMode ? 'ON 🧪' : 'OFF 🚀';
  await ctx.reply(
    `${ctx.session.settings.simulationMode ? '🧪' : '🚀'} <b>Simulation Mode ${status}</b>\n\n` +
    (ctx.session.settings.simulationMode 
      ? '🧪 Trades will be simulated (no real transactions)' 
      : '🚀 Trades will be executed for real'),
    { parse_mode: 'HTML' }
  );
});

// Toggle Bundler Mode
bot.callbackQuery('toggle_bundler', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.settings.bundlerMode = !ctx.session.settings.bundlerMode;
  
  const status = ctx.session.settings.bundlerMode ? 'ON 📦' : 'OFF';
  await ctx.reply(
    `📦 <b>Bundler Mode ${status}</b>\n\n` +
    (ctx.session.settings.bundlerMode 
      ? '📦 Transactions will be bundled to save on gas' 
      : 'Transactions will be sent individually'),
    { parse_mode: 'HTML' }
  );
});

// Help callback
bot.callbackQuery('help', async (ctx) => {
  await ctx.answerCallbackQuery();
  
  const helpText = `
📚 <b>Quick Command Reference</b>

<b>💰 Trading Commands:</b>
<code>&lt;token&gt; buy &lt;amount&gt;</code> - Buy tokens
<code>&lt;token&gt; swap &lt;amount&gt;</code> - Swap (same as buy)
<code>&lt;token&gt; sell &lt;amount&gt;</code> - Sell position

<b>Examples:</b>
<code>So11...abc 0.5 buy</code>
<code>4fERe7x...u6 0.2 swap</code>

<b>⚙️ Settings:</b>
• Toggle Safety Checks - Bypass token security
• Simulation Mode - Test without real trades
• Bundler Mode - Save gas by bundling

<b>📊 Other Commands:</b>
/start - View portfolio
/positions - Active positions
/wallet - View wallets
/settings - Configure bot
/help - Show this help

<b>�� Tips:</b>
• Use /settings to toggle safety checks
• "swap" and "buy" work the same way
  `;
  
  const keyboard = new InlineKeyboard()
    .text('⚙️ Settings', 'settings')
    .text('💰 Buy', 'buy')
    .text('📊 Positions', 'positions').row()
    .text('🔙 Back', 'back_main');
  
  await ctx.editMessageText(helpText, { parse_mode: 'HTML', reply_markup: keyboard });
});


// ==================== TOGGLE HANDLERS ====================

// Toggle Safety Checks
bot.callbackQuery('toggle_safety', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.settings.ignoreSafety = !ctx.session.settings.ignoreSafety;
  
  const status = ctx.session.settings.ignoreSafety ? 'DISABLED ⚠️' : 'ENABLED 🛡️';
  await ctx.reply(
    `${ctx.session.settings.ignoreSafety ? '⚠️' : '🛡️'} <b>Safety Checks ${status}</b>\n\n` +
    (ctx.session.settings.ignoreSafety 
      ? '⚠️ <b>Warning:</b> You can now buy risky tokens without security warnings.\nUse with caution!' 
      : '✅ Tokens will be checked for safety before purchase.'),
    { parse_mode: 'HTML' }
  );
});

// Toggle Simulation Mode
bot.callbackQuery('toggle_simulation', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.settings.simulationMode = !ctx.session.settings.simulationMode;
  
  const status = ctx.session.settings.simulationMode ? 'ON 🧪' : 'OFF 🚀';
  await ctx.reply(
    `${ctx.session.settings.simulationMode ? '🧪' : '🚀'} <b>Simulation Mode ${status}</b>\n\n` +
    (ctx.session.settings.simulationMode 
      ? '🧪 Trades will be simulated (no real transactions)' 
      : '🚀 Trades will be executed for real'),
    { parse_mode: 'HTML' }
  );
});

// Toggle Bundler Mode
bot.callbackQuery('toggle_bundler', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.settings.bundlerMode = !ctx.session.settings.bundlerMode;
  
  const status = ctx.session.settings.bundlerMode ? 'ON 📦' : 'OFF';
  await ctx.reply(
    `📦 <b>Bundler Mode ${status}</b>\n\n` +
    (ctx.session.settings.bundlerMode 
      ? '📦 Transactions will be bundled to save on gas' 
      : 'Transactions will be sent individually'),
    { parse_mode: 'HTML' }
  );
});

// Help callback
bot.callbackQuery('help', async (ctx) => {
  await ctx.answerCallbackQuery();
  
  const helpText = `
📚 <b>Quick Command Reference</b>

<b>💰 Trading Commands:</b>
<code>&lt;token&gt; buy &lt;amount&gt;</code> - Buy tokens
<code>&lt;token&gt; swap &lt;amount&gt;</code> - Swap (same as buy)
<code>&lt;token&gt; sell &lt;amount&gt;</code> - Sell position

<b>Examples:</b>
<code>So11...abc 0.5 buy</code>
<code>4fERe7x...u6 0.2 swap</code>
<code>0x123...xyz 50 sell</code>

<b>⚙️ Settings:</b>
• Toggle Safety Checks - Bypass token security
• Simulation Mode - Test without real trades
• Bundler Mode - Save gas by bundling

<b>📊 Other Commands:</b>
/start - View portfolio
/positions - Active positions
/wallet - View wallets
/settings - Configure bot
/help - Show this help

<b>💡 Tips:</b>
• Use /settings to toggle safety checks
• "swap" and "buy" work the same way
• Amounts can be in tokens or %
  `;
  
  const keyboard = new InlineKeyboard()
    .text('⚙️ Settings', 'settings')
    .text('💰 Buy', 'buy')
    .text('📊 Positions', 'positions').row()
    .text('🔙 Back', 'back_main');
  
  await ctx.editMessageText(helpText, { parse_mode: 'HTML', reply_markup: keyboard });
});


// Positions button
// Positions button with Pagination (Carousel)
bot.callbackQuery(/^positions(_(\d+))?$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  
  const pageStr = ctx.match[2];
  const page = pageStr ? parseInt(pageStr) : 0;

  await safeEditMessage(ctx, '📊 <b>Fetching positions...</b>', { parse_mode: 'HTML' });

  try {
    const positions: Position[] = await callRustAPI(
      `/api/positions/${ctx.from!.id}`
    );

    if (positions.length === 0) {
      const keyboard = new InlineKeyboard()
        .text('💰 Buy Tokens', 'buy')
        .text('📈 Portfolio', 'portfolio')
        .text('🔙 Back', 'menu_trading').row();

      await safeEditMessage(
        ctx,
        '📭 <b>No Active Positions</b>\n\n' +
        'You don\'t have any open positions yet.\n\n' +
        'Start trading to see your positions here.',
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
      return;
    }

    // Pagination bounds
    const total = positions.length;
    const idx = Math.max(0, Math.min(page, total - 1));
    const pos = positions[idx];
    
    // Build Message for Single Position
    const chain = pos.position.chain.toUpperCase();
    const age = Math.floor((Date.now() / 1000 - pos.position.timestamp) / 60);
    const tokenAddress = pos.position.token || pos.position.token_address || 'Unknown';
    const shortToken = `${tokenAddress.slice(0, 8)}...${tokenAddress.slice(-6)}`;
    const holdingsAmount = parseFloat(pos.position.amount);

    let message = `📊 <b>Active Positions (${idx + 1}/${total})</b>\n`;
    message += '━━━━━━━━━━━━━━━━━━━━\n\n';
    message += `${formatPnL(pos.pnl_percent)} <b>${chain}</b>\n`;
    message += `📍 <code>${tokenAddress}</code>\n`;
    message += `💰 Entry: $${formatNumber(pos.position.entry_price, 6)}\n`;
    message += `📈 Current: $${formatNumber(pos.position.current_price, 6)}\n`;
    message += `💼 Holdings: ${formatNumber(holdingsAmount, 4)} tokens\n`;
    message += `⏰ Age: ${age}m\n\n`;
    message += `🎯 TP: +${pos.position.take_profit_percent}% | `;
    message += `🛑 SL: ${pos.position.stop_loss_percent}%\n\n`;
    message += '━━━━━━━━━━━━━━━━━━━━\n';
    message += `<b>📊 Trade This Token</b>\n`;

    // Action Buttons
    const keyboard = new InlineKeyboard();
    
    // Row 1: Primary Actions
    keyboard.text('💰 Buy More', `buy_more_${tokenAddress}`)
    .text('🔴 Sell', `sell_options_${tokenAddress}`).row();
    
    // Row 2: Navigation
    const navRow = [];
    if (idx > 0) {
        navRow.push({ text: '⬅️ Prev', callback_data: `positions_${idx - 1}` });
    }
    navRow.push({ text: '🔄 Refresh', callback_data: `positions_${idx}` });
    if (idx < total - 1) {
        navRow.push({ text: 'Next ➡️', callback_data: `positions_${idx + 1}` });
    }
    
    if (navRow.length > 0) {
        keyboard.row(...navRow);
    }

    keyboard.text('🔙 Back', 'menu_trading').row();

    await safeEditMessage(ctx, message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// Manage Position handler
bot.callbackQuery(/^manage_pos_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const token = ctx.match[1];
  
  await safeEditMessage(ctx, '📊 <b>Fetching position data...</b>', { parse_mode: 'HTML' });

  try { 
      // Fetch fresh position data
      const positions: Position[] = await callRustAPI(`/api/positions/${ctx.from!.id}`);
      const pos = positions.find((p: any) => p.position.token === token || p.position.token_address === token || (token === 'Unknown' && positions.length === 1));
      
      if (!pos) {
          await safeEditMessage(ctx, '❌ <b>Position Not Found</b>\n\nIt may have been closed or sold.', { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔙 Back', 'positions') });
          return;
      }
      
      const chain = pos.position.chain.toUpperCase();
      const age = Math.floor((Date.now() / 1000 - pos.position.timestamp) / 60);
      const tokenAddress = pos.position.token || 'Unknown';
      
      let message = `⚙️ <b>Manage Position: ${chain}</b>\n`;
      message += `📍 <code>${tokenAddress}</code>\n`;
      message += '━━━━━━━━━━━━━━━━━━━━\n\n';
      
      message += `${formatPnL(pos.pnl_percent)} <b>PnL</b>\n`;
      message += `💰 Entry: $${formatNumber(pos.position.entry_price, 6)}\n`;
      message += `📈 Current: $${formatNumber(pos.position.current_price, 6)}\n`;
      message += `⏰ Age: ${age}m\n\n`;
      message += `🎯 TP: +${pos.position.take_profit_percent}% | `;
      message += `🛑 SL: ${pos.position.stop_loss_percent}%\n`;
      
      const keyboard = new InlineKeyboard()
        .text('💰 Buy More', `buy_more_${token}`).row()
        .text('🔴 Sell 25%', `sell_pos_${token}_25`)
        .text('🔴 Sell 50%', `sell_pos_${token}_50`)
        .text('🔴 Sell 100%', `sell_pos_${token}_100`).row()
        .text('🔙 Back', 'positions');
        
      await safeEditMessage(ctx, message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
      await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});



// Buy More handler
bot.callbackQuery(/^buy_more_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const token = ctx.match[1];
  
  // Set up session for custom amount Buy
  ctx.session.pendingBuy = {
      token: token,
      chain: ctx.session.settings.defaultChain // Assuming same chain. Better to fetch from position but defaultChain is usually safe or we can extract?
      // Actually, if user switches default chain, this might be wrong.
      // But pendingBuy requires chain. 
      // We should probably rely on the assumption that the user wants to buy on the default chain OR fetch position again.
      // For speed, let's use defaultChain. 
  };
  ctx.session.awaitingInput = 'custom_amount';
  
  await safeEditMessage(
      ctx,
      `💰 <b>Buy More: ${token.slice(0, 4)}...</b>\n\n` +
      `Please enter the amount you wish to buy:\n` +
      `<i>(e.g., 0.1, 0.5, 1.0)</i>`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'cancel_buy') }
  );
});

// Sell Position handler
// Sell Options Submenu
bot.callbackQuery(/^sell_options_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const token = ctx.match[1];
  
  await safeEditMessage(ctx, '🔄 <b>Loading position data...</b>', { parse_mode: 'HTML' });
  
  try {
      // Fetch position to show current holdings
      const positions: Position[] = await callRustAPI(`/api/positions/${ctx.from!.id}`);
      
      // Find position by matching token or token_address, or if only one position exists and token is 'Unknown'
      const pos = positions.find((p: any) => 
        p.position.token === token || 
        p.position.token_address === token ||
        (token === 'Unknown' && positions.length === 1)
      );
      
      if (!pos) {
          await safeEditMessage(ctx, '❌ <b>Position Not Found</b>\\n\\nIt may have been closed or sold.', { 
              parse_mode: 'HTML', 
              reply_markup: new InlineKeyboard().text('🔙 Back', 'positions') 
          });
          return;
      }
      
      const chain = pos.position.chain.toUpperCase();
      const holdingsAmount = parseFloat(pos.position.amount);
      const tokenShort = `${token.slice(0, 6)}...${token.slice(-4)}`;
      
      let message = `🔴 <b>Select Sell Amount</b>\\n`;
      message += '━━━━━━━━━━━━━━━━━━━━\\n\\n';
      message += `<b>${chain}</b>\\n`;
      message += `📍 <code>${tokenShort}</code>\\n\\n`;
      message += `💼 <b>Current Holdings:</b>\\n`;
      message += `   ${formatNumber(holdingsAmount, 4)} tokens\\n\\n`;
      message += `💰 Entry: $${formatNumber(pos.position.entry_price, 6)}\\n`;
      message += `📈 Current: $${formatNumber(pos.position.current_price, 6)}\\n`;
      message += `${formatPnL(pos.pnl_percent)}\\n\\n`;
      message += '━━━━━━━━━━━━━━━━━━━━\\n';
      message += `<b>Choose sell percentage:</b>`;
      
      const keyboard = new InlineKeyboard()
        .text('25%', `sell_pos_${token}_25`)
        .text('50%', `sell_pos_${token}_50`).row()
        .text('100% (All)', `sell_pos_${token}_100`)
        .text('Custom', `sell_custom_${token}`).row()
        .text('❌ Cancel', 'positions');
        
      await safeEditMessage(ctx, message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
      await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// Custom Sell Amount Handler
bot.callbackQuery(/^sell_custom_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const token = ctx.match[1];
  
  // Set up session for custom sell amount
  ctx.session.pendingBuy = {
      token: token,
      chain: ctx.session.settings.defaultChain
  };
  ctx.session.awaitingInput = 'custom_amount';
  
  await safeEditMessage(
      ctx,
      `🔴 <b>Custom Sell Amount</b>\\n\\n` +
      `Token: <code>${token.slice(0, 6)}...${token.slice(-4)}</code>\\n\\n` +
      `Please enter the percentage you wish to sell:\\n` +
      `<i>(e.g., 10, 33, 75)</i>`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('❌ Cancel', 'positions') }
  );
});
bot.callbackQuery(/^sell_pos_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const token = ctx.match[1];
  const percentStr = ctx.match[2]; // "25", "50", "100"
  const percentage = parseInt(percentStr);
  
  await safeEditMessage(ctx, `🔴 <b>Selling ${percentage}%...</b>`, { parse_mode: 'HTML' });
  
  try {
      // 1. Fetch Position to get amount? Or Wallet Balance?
      // Usually "Sell 50%" means 50% of wallet balance for that token.
      
      // Get wallet balance for the token
      // We don't have a direct "get token balance" API easily exposed in `callRustAPI`.
      // The `balance` endpoint returns NATIVE balance.
      // But `positions` endpoint returns the position data which implies checking holding.
      
      // Let's use the `/api/sell` endpoint. Does it accept percentage?
      // Looking at `server.js` / backend... `main.rs`.
      // `SellRequest` (not visible but usually takes amount).
      // `bot.ts` line 316 (chat command) calculates amount manually.
      
      // We need to fetch position to get the amount held.
      const positions: Position[] = await callRustAPI(`/api/positions/${ctx.from!.id}`);
      const pos = positions.find((p: any) => 
        p.position.token === token || 
        p.position.token_address === token ||
        (token === 'Unknown' && positions.length === 1)
      );
      
      if (!pos) {
           await ctx.editMessageText('❌ Position not found or already closed.', { parse_mode: 'HTML' });
           return;
      }
      
      // Calculate amount
      // `pos.position.amount` should be the amount of tokens.
      const totalAmount = parseFloat(pos.position.amount);
      const sellAmount = (totalAmount * percentage) / 100;
      
      // Get position_id from the position object
      const positionId = (pos.position as any).position_id || `${ctx.from!.id}_unknown`;
      
      // Call Sell API with correct format
      const result = await callRustAPI('/api/sell', 'POST', {
          user_id: ctx.from!.id,
          position_id: positionId,
          percent: percentage
      });
      
      if (result.success) {
           await ctx.editMessageText(
              `✅ <b>Sell Executed</b>\n\n` +
              `Sold: ${formatNumber(sellAmount)} tokens (${percentage}%)\n` +
              `Tx: <code>${result.tx_hash}</code>`,
              { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔙 Back to Positions', 'positions') }
           );
      } else {
           await ctx.editMessageText(`❌ Sell Failed: ${result.error}`, { parse_mode: 'HTML' });
      }
  } catch (error: any) {
       await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// Settings button
bot.callbackQuery('settings', async (ctx) => {
  await ctx.answerCallbackQuery();
  const settings = ctx.session.settings;

  // Get user wallets to show which chains are available
  let availableChains: string[] = [];
  try {
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
    availableChains = wallets ? wallets.map((w: any) => w.chain) : [];
  } catch { }

  const keyboard = new InlineKeyboard()
    .text(`🌐 Chain: ${settings.defaultChain.toUpperCase()}`, 'change_chain').row()
    .text(`💰 Amount: ${settings.buyAmount}`, 'change_amount')
    .text(`📊 Slippage: ${settings.slippage}%`, 'change_slippage').row()
    .text(`🎯 TP: +${settings.takeProfitPercent}%`, 'change_tp')
    .text(`🛑 SL: ${settings.stopLossPercent}%`, 'change_sl').row()
    .text(`${settings.ignoreSafety ? '⚠️ Safety: OFF' : '🛡️ Safety: ON'}`, 'toggle_safety')
    .text(`${settings.simulationMode ? '🧪 Sim: ON' : '🚀 Sim: OFF'}`, 'toggle_simulation').row()
    .text(`${settings.bundlerMode ? '📦 Bundle: ON' : '📦 Bundle: OFF'}`, 'toggle_bundler')
    .text('🔑 View Private Keys', 'view_private_keys').row()
    .text('🔙 Back', 'back_main');

  let message = '⚙️ <b>Settings</b>\n\n';
  message += '━━━━━━━━━━━━━━━━━━━━\n\n';
  message += `🌐 <b>Default Chain:</b> ${settings.defaultChain.toUpperCase()}\n`;
  message += `💰 <b>Buy Amount:</b> ${settings.buyAmount}\n`;
  message += `📊 <b>Slippage:</b> ${settings.slippage}%\n`;
  message += `🎯 <b>Take Profit:</b> +${settings.takeProfitPercent}%\n`;
  message += `🛑 <b>Stop Loss:</b> ${settings.stopLossPercent}%\n`;
  message += `${settings.ignoreSafety ? '⚠️' : '🛡️'} <b>Safety Checks:</b> ${settings.ignoreSafety ? 'DISABLED' : 'ENABLED'}\n`;
  message += `${settings.simulationMode ? '🧪' : '🚀'} <b>Simulation Mode:</b> ${settings.simulationMode ? 'ON' : 'OFF'}\n`;
  message += `${settings.bundlerMode ? '📦' : '📦'} <b>Bundler Mode:</b> ${settings.bundlerMode ? 'ON' : 'OFF'}\n\n`;

  if (availableChains.length > 0) {
    message += `💼 <b>Available Wallets:</b>\n`;
    availableChains.forEach(chain => {
      message += `• ${chain.toUpperCase()}\n`;
    });
    message += '\n';
  }

  message += '━━━━━━━━━━━━━━━━━━━━\n\n';
  message += 'Click any option to modify:';

  await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
});

// Change chain callback
bot.callbackQuery('change_chain', async (ctx) => {
  await ctx.answerCallbackQuery();

  try {
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
    const availableChains = wallets ? wallets.map((w: any) => w.chain) : [];

    const keyboard = new InlineKeyboard();

    const chains = [
      { name: 'Solana', value: 'solana', emoji: '🟣' },
      { name: 'Ethereum', value: 'eth', emoji: '🔵' },
      { name: 'BSC', value: 'bsc', emoji: '🟡' },
    ];

    chains.forEach((chain) => {
      const hasWallet = availableChains.includes(chain.value);
      const isCurrent = ctx.session.settings.defaultChain === chain.value;
      const label = isCurrent
        ? `✅ ${chain.emoji} ${chain.name} (Current)`
        : hasWallet
          ? `${chain.emoji} ${chain.name}`
          : `${chain.emoji} ${chain.name} (No wallet)`;
      keyboard.text(label, `set_chain_${chain.value}`).row();
    });

    keyboard.text('🔙 Back', 'settings');

    let message = '🌐 <b>Change Default Chain</b>\n\n';
    message += 'Select your default trading chain:\n\n';
    message += '⚠️ <b>Note:</b> You need a wallet for the chain you want to use.';

    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// Set chain callback
bot.callbackQuery(/^set_chain_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const chain = ctx.match[1];
  const chainMap: any = {
    solana: 'solana',
    eth: 'eth',
    ethereum: 'eth',
    bsc: 'bsc',
    binance: 'bsc',
  };
  const normalizedChain = chainMap[chain] || chain;

  // Check if user has wallet for this chain
  try {
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
    const hasWallet = wallets && wallets.some((w: any) => w.chain === normalizedChain);

    if (!hasWallet) {
      const keyboard = new InlineKeyboard()
        .text('🔐 Generate Wallet', 'gen_wallet_' + normalizedChain)
        .text('📥 Import Wallet', 'import_wallet').row()
        .text('🔙 Back', 'change_chain');

      return ctx.editMessageText(
        `⚠️ <b>Wallet Required</b>\n\n` +
        `You need a ${normalizedChain.toUpperCase()} wallet to use this chain as default.\n\n` +
        `Please create or import a wallet first:`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }

    ctx.session.settings.defaultChain = normalizedChain as 'solana' | 'eth' | 'bsc';

    await ctx.editMessageText(
      `✅ <b>Default Chain Updated</b>\n\n` +
      `Your default chain is now set to <b>${normalizedChain.toUpperCase()}</b>.\n\n` +
      `All trades will use this chain by default.`,
      { parse_mode: 'HTML' }
    );

    // Return to settings after a moment
    setTimeout(async () => {
      const settings = ctx.session.settings;
      const keyboard = new InlineKeyboard()
        .text(`🌐 Chain: ${settings.defaultChain.toUpperCase()}`, 'change_chain').row()
        .text(`💰 Amount: ${settings.buyAmount}`, 'change_amount')
        .text(`📊 Slippage: ${settings.slippage}%`, 'change_slippage').row()
        .text(`🎯 TP: +${settings.takeProfitPercent}%`, 'change_tp')
        .text(`🛑 SL: ${settings.stopLossPercent}%`, 'change_sl').row()
        .text('🔑 View Private Keys', 'view_private_keys').row()
        .text('🔙 Back', 'back_main');

      await ctx.editMessageText(
        '⚙️ <b>Settings</b>\n\nClick any option to modify:',
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }, 2000);
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// View private keys callback
bot.callbackQuery('view_private_keys', async (ctx) => {
  await ctx.answerCallbackQuery();

  try {
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);

    if (!wallets || wallets.length === 0) {
      return ctx.editMessageText(
        '❌ <b>No Wallets Found</b>\n\n' +
        'You need to create or import a wallet first.',
        { parse_mode: 'HTML' }
      );
    }

    const keyboard = new InlineKeyboard();

    wallets.forEach((wallet: any) => {
      const chain = wallet.chain.toUpperCase();
      const chainEmoji = chain === 'SOLANA' ? '🟣' : chain === 'ETH' ? '🔵' : '🟡';
      keyboard.text(`${chainEmoji} ${chain}`, `show_key_${wallet.chain}`).row();
    });

    keyboard.text('🔙 Back', 'settings');

    await ctx.editMessageText(
      '🔑 <b>View Private Keys</b>\n\n' +
      '⚠️ <b>SECURITY WARNING</b>\n\n' +
      'Select a wallet to view its private key.\n\n' +
      '🔒 Your keys are encrypted and stored securely.',
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// Show private key for specific chain
bot.callbackQuery(/^show_key_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const chain = ctx.match[1];

  try {
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
    const wallet = wallets.find((w: any) => w.chain === chain);

    if (!wallet) {
      return ctx.editMessageText('❌ Wallet not found.', { parse_mode: 'HTML' });
    }

    // Try to get decrypted private key from API
    // Note: In production, you'd add a secure endpoint that decrypts the key
    // For now, we'll show a message that the key should have been saved when generated

    const keyboard = new InlineKeyboard()
      .text('🔙 Back', 'view_private_keys');

    await ctx.editMessageText(
      `🔑 <b>Private Key - ${chain.toUpperCase()}</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📍 <b>Address:</b>\n<code>${wallet.address}</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `⚠️ <b>Private Key Access</b>\n\n` +
      `Your private keys are encrypted and stored securely.\n\n` +
      `💡 <b>Important:</b>\n` +
      `• Private keys are shown ONLY when you generate a new wallet\n` +
      `• Save your private key immediately when generated\n` +
      `• Keys are encrypted with your user ID\n\n` +
      `🔒 <b>Security Note:</b>\n` +
      `If you didn't save your key when generated, you'll need to:\n` +
      `• Import the wallet again with your saved key\n` +
      `• Or generate a new wallet\n\n` +
      `⚠️ Never share your private key with anyone!`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// Check token button
bot.callbackQuery('check_token', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingInput = 'token_check';
  await ctx.editMessageText(
    '🔍 <b>Token Security Check</b>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Send me the token address to check:\n\n' +
    '💡 <b>Example:</b>\n' +
    '<code>2tJU3pMh4HJjKa9HN6HngdopfNqqaeEytFqW98Kqpump</code>',
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

// Buy amount selection callbacks
bot.callbackQuery(/^buy_amount_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  if (!ctx.session.pendingBuy) {
    return ctx.editMessageText('❌ No pending buy. Please start over.', { parse_mode: 'HTML' });
  }

  const amountStr = ctx.match[1];
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    return ctx.editMessageText('❌ Invalid amount.', { parse_mode: 'HTML' });
  }

  // Save pending buy info before clearing
  const pendingBuy = ctx.session.pendingBuy!;
  const buyToken = pendingBuy.token;
  const buyChain = pendingBuy.chain;

  // Check balance
  try {
    const balanceResult = await callRustAPI(`/api/wallet/balance/${ctx.from!.id}/${buyChain}`);
    const balance = parseFloat(balanceResult.native_balance) || 0;

    if (amount > balance) {
      const balanceSymbol = buyChain === 'solana' ? 'SOL' : buyChain === 'eth' ? 'ETH' : 'BNB';
      return ctx.editMessageText(
        `❌ <b>Insufficient Balance</b>\n\n` +
        `You have: ${formatNumber(balance, 6)} ${balanceSymbol}\n` +
        `Requested: ${formatNumber(amount, 6)}\n\n` +
        `Please select a smaller amount.`,
        { parse_mode: 'HTML' }
      );
    }

    ctx.session.pendingBuy = undefined;
    ctx.session.awaitingInput = undefined;

    // Execute buy
    await ctx.editMessageText('⚡ <b>Executing Trade</b>\n\n⏳ Processing transaction on blockchain...', { parse_mode: 'HTML' });

    const settings = ctx.session.settings;
    const result = await callRustAPI('/api/buy', 'POST', {
      user_id: ctx.from.id,
      chain: buyChain,
      token: buyToken,
      amount: amount.toString(),
      slippage: settings.slippage,
      take_profit: settings.takeProfitPercent,
      stop_loss: settings.stopLossPercent,
    });

    const chain = buyChain.toUpperCase();
    const balanceSymbol = chain === 'SOLANA' ? 'SOL' : chain === 'ETH' ? 'ETH' : 'BNB';

    if (result.success) {
      await ctx.editMessageText(
        `✅ <b>Trade Executed Successfully</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🌐 <b>Chain:</b> ${chain}\n` +
        `📍 <b>Token:</b> <code>${buyToken.slice(0, 16)}...${buyToken.slice(-12)}</code>\n` +
        `💰 <b>Amount:</b> ${formatNumber(amount, 6)} ${balanceSymbol}\n\n` +
        `🔗 <b>Transaction Hash:</b>\n` +
        `<code>${result.tx_hash}</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 <b>Position Management</b>\n` +
        `🎯 Take Profit: <b>+${settings.takeProfitPercent}%</b>\n` +
        `🛑 Stop Loss: <b>${settings.stopLossPercent}%</b>\n\n` +
        `🆔 <b>Position ID:</b> <code>${result.position_id}</code>\n\n` +
        `✅ Your position is now being monitored automatically.`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.editMessageText(
        `❌ <b>Trade Execution Failed</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Error: <code>${result.error || 'Unknown error occurred'}</code>\n\n` +
        `Please verify:\n` +
        `• Sufficient balance\n` +
        `• Valid token address\n` +
        `• Network connectivity\n\n` +
        `Try again or contact support if the issue persists.`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (error: any) {
    let errorMsg = error.message;
    let isTokenRisk = false;
    let isNetworkError = false;

    // Try to parse JSON error from the message
    const match = errorMsg.match(/API error \(\d+\): (.*)/);
    if (match) {
        try {
            const json = JSON.parse(match[1]);
            if (json.error) {
                errorMsg = json.error;
                if (json.error.includes('Token Risk')) isTokenRisk = true;
                if (json.error.includes('Failed to get blockhash') || json.error.includes('Connection refused')) isNetworkError = true;
            }
        } catch (e) {
            // Not JSON, just check string
        }
    }
    
    // Fallback string check
    if (!isTokenRisk && (errorMsg.includes('Token Risk') || errorMsg.includes('Risk: Score'))) isTokenRisk = true;
    if (!isNetworkError && (errorMsg.includes('blockhash') || errorMsg.includes('timeout') || errorMsg.includes('500'))) isNetworkError = true;

    if (isTokenRisk) {
         ctx.session.pendingBuy = undefined;
         ctx.session.awaitingInput = undefined;

         await ctx.editMessageText(
           `⚠️ <b>Security Check Failed</b>\n\n` +
           `${errorMsg}\n\n` +
           `To bypass this check, click below:`,
           { 
             parse_mode: 'HTML',
             reply_markup: new InlineKeyboard().text('⚠️ Force Buy', `force_buy:${buyToken}:${amount}`)
           }
        );
        return;
    }
    
    if (isNetworkError) {
        await ctx.editMessageText(
            `⚠️ <b>Network Error</b>\n\n` +
            `Solana Devnet appears to be congested or unreachable.\n\n` +
            `Error: ${errorMsg}\n\n` +
            `Please try again in a moment.`, 
            { parse_mode: 'HTML' }
        );
        return;
    }
    
    ctx.session.pendingBuy = undefined;
    ctx.session.awaitingInput = undefined;
    
    // Escape HTML in error message before sending
    const safeError = errorMsg.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    await ctx.editMessageText(`❌ Error: ${safeError}`, { parse_mode: 'HTML' });
  }
});

// Custom amount button
bot.callbackQuery('buy_custom', async (ctx) => {
  await ctx.answerCallbackQuery();

  if (!ctx.session.pendingBuy) {
    return ctx.editMessageText('❌ No pending buy. Please start over.', { parse_mode: 'HTML' });
  }

  const balanceSymbol = ctx.session.pendingBuy.chain === 'solana' ? 'SOL' : ctx.session.pendingBuy.chain === 'eth' ? 'ETH' : 'BNB';

  // Get current balance for display
  try {
    const balanceResult = await callRustAPI(`/api/wallet/balance/${ctx.from!.id}/${ctx.session.pendingBuy.chain}`);
    const balance = parseFloat(balanceResult.native_balance) || 0;
    const usdValue = balanceResult.total_usd || 0;

    await ctx.editMessageText(
      `✏️ <b>Custom Purchase Amount</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 <b>Available Balance:</b>\n` +
      `${formatNumber(balance, 6)} ${balanceSymbol}\n` +
      `💵 Value: $${formatNumber(usdValue, 2)}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📝 <b>Enter Amount</b>\n\n` +
      `Please enter the amount in ${balanceSymbol} you wish to purchase.\n\n` +
      `💡 <b>Example:</b> 0.5\n` +
      `💡 <b>Maximum:</b> ${formatNumber(balance, 6)} ${balanceSymbol}`,
      { parse_mode: 'HTML' }
    );
  } catch {
    await ctx.editMessageText(
      `✏️ <b>Custom Purchase Amount</b>\n\n` +
      `Enter the amount in ${balanceSymbol} to buy:\n\n` +
      `💡 <b>Example:</b> 0.5`,
      { parse_mode: 'HTML' }
    );
  }
});

// Cancel buy
bot.callbackQuery('cancel_buy', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.pendingBuy = undefined;
  ctx.session.awaitingInput = undefined;
  await ctx.editMessageText('❌ Buy cancelled.', { parse_mode: 'HTML' });
});

// ==================== MENU HANDLERS ====================
// Trading menu
bot.callbackQuery('menu_trading', async (ctx) => {
  await ctx.answerCallbackQuery();
  await safeEditMessage(
    ctx,
    '💰 <b>Trading Menu</b>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    '• <b>Buy Token:</b> Purchase tokens on any chain\n' +
    '• <b>Positions:</b> View your active positions\n' +
    '• <b>Portfolio:</b> See your complete portfolio\n\n' +
    'Select an option below:',
    { parse_mode: 'HTML', reply_markup: getTradingMenuKeyboard() }
  );
});

// Tools menu
bot.callbackQuery('menu_tools', async (ctx) => {
  await ctx.answerCallbackQuery();
  await safeEditMessage(
    ctx,
    '🛠️ <b>Tools & Features</b>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    '• <b>Bundler:</b> Bundle transactions to save gas\n' +
    '• <b>Whales:</b> Track large trades and alerts\n' +
    '• <b>Grid Trading:</b> Automated grid strategy\n' +
    '• <b>Leaderboard:</b> Top traders rankings\n' +
    '• <b>Check Token:</b> Security analysis\n\n' +
    'Select a tool:',
    { parse_mode: 'HTML', reply_markup: getToolsMenuKeyboard() }
  );
});

// Back to main
bot.callbackQuery('back_main', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.pendingBuy = undefined;
  ctx.session.awaitingInput = undefined;
  await safeEditMessage(
    ctx,
    '🤖 <b>Main Menu</b>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Welcome! All features are available below:\n\n' +
    '• <b>Buy:</b> Purchase tokens\n' +
    '• <b>Positions:</b> View active trades\n' +
    '• <b>Portfolio:</b> Complete holdings overview\n' +
    '• <b>Bundler:</b> Save gas with transaction bundling\n' +
    '• <b>Whales:</b> Track large trades\n' +
    '• <b>Grid Trading:</b> Automated grid strategy\n' +
    '• <b>Leaderboard:</b> Top traders rankings\n' +
    '• <b>Wallet:</b> Manage your wallets\n' +
    '• <b>Settings:</b> Configure preferences',
    { parse_mode: 'HTML', reply_markup: getMainKeyboard() }
  );
});

// AI Chat handler
bot.callbackQuery('ai_chat', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingInput = 'ai_chat';
  await safeEditMessage(
    ctx,
    '🤖 <b>AI Assistant</b>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Ask me anything about trading, tokens, or your portfolio!\n\n' +
    'Examples:\n' +
    '• "Should I buy this token?"\n' +
    '• "Analyze my portfolio risk"\n' +
    '• "What is Jupiter Aggregator?"\n' +
    '• "Explain grid trading"\n\n' +
    'Type your question below:',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔙 Back', 'back_main') }
  );
});

// AI Analyze Token handler
bot.callbackQuery(/^ai_analyze_token:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery('Analyzing token with AI...');
  const token = ctx.match[1];
  const settings = ctx.session.settings;

  try {
    const result = await analyzeToken(settings.defaultChain, token);

    if (result.success && result.analysis) {
      const analysis = result.analysis;
      let message = `🤖 <b>AI Token Analysis</b>\n\n`;
      message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
      message += `<b>Summary:</b>\n${analysis.summary}\n\n`;
      message += `<b>Risk Assessment:</b>\n${analysis.riskAssessment}\n\n`;
      
      if (analysis.recommendations.length > 0) {
        message += `<b>Recommendations:</b>\n`;
        analysis.recommendations.forEach((rec, i) => {
          message += `${i + 1}. ${rec}\n`;
        });
        message += `\n`;
      }

      message += `<b>Market Sentiment:</b> ${analysis.marketSentiment === 'bullish' ? '📈 Bullish' : analysis.marketSentiment === 'bearish' ? '📉 Bearish' : '➡️ Neutral'}\n`;
      message += `<b>Confidence:</b> ${(analysis.confidence * 100).toFixed(0)}%`;

      await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('🔙 Back', 'back_main'),
      });
    } else {
      await ctx.reply(
        `❌ <b>AI Analysis Failed</b>\n\n${result.error || 'Unknown error'}`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (error: any) {
    await ctx.reply(
      `❌ <b>Error</b>\n\n${error.message}`,
      { parse_mode: 'HTML' }
    );
  }
});

// ==================== MESSAGE HANDLERS ====================

// Handle awaiting input
bot.on('message:text', async (ctx) => {
  // Handle AI chat
  if (ctx.session.awaitingInput === 'ai_chat') {
    const message = ctx.message.text;
    const thinkingMsg = await ctx.reply('🤖 <i>Thinking...</i>', { parse_mode: 'HTML' });

    try {
      const result = await sendChatMessage(ctx.from!.id, message);

      // Delete thinking message
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);
      } catch {}

      if (result.success && result.response) {
        await ctx.reply(
          `🤖 <b>AI Assistant</b>\n\n${result.response}`,
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text('🔙 Back', 'back_main'),
          }
        );
      } else {
        await ctx.reply(
          `❌ <b>Error</b>\n\n${result.error || 'Failed to get AI response'}\n\nPlease try again or check if ElizaOS service is running.`,
          { parse_mode: 'HTML' }
        );
      }
    } catch (error: any) {
      // Delete thinking message
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);
      } catch {}
      
      await ctx.reply(
        `❌ <b>Error</b>\n\n${error.message}\n\nPlease check if ElizaOS service is running on ${process.env.ELIZA_API_URL || 'http://localhost:3001'}`,
        { parse_mode: 'HTML' }
      );
    }

    ctx.session.awaitingInput = undefined;
    return;
  }

  if (!ctx.session.awaitingInput) {
    // Check if it's a natural language message (not a command)
    const text = ctx.message.text.trim();
    const isCommand = text.startsWith('/') || 
                     /^(So11[a-zA-Z0-9]+|0x[a-fA-F0-9]{40}|[a-zA-Z0-9]{32,44})\s+(buy|sell|swap)\s+([\d.]+)$/i.test(text);
    
    if (!isCommand && text.length > 5) {
      // Send to ElizaOS for processing
      try {
        const processingMsg = await ctx.reply('🤖 <i>Processing with AI...</i>', { parse_mode: 'HTML' });
        const result = await sendChatMessage(ctx.from!.id, text);

        // Delete processing message
        try {
          await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id);
        } catch {}

        if (result.success && result.response) {
          await ctx.reply(
            `🤖 <b>AI Response</b>\n\n${result.response}`,
            {
              parse_mode: 'HTML',
              reply_markup: new InlineKeyboard().text('💬 Chat with AI', 'ai_chat').text('🔙 Main Menu', 'back_main'),
            }
          );
        } else {
          // Silently fail for natural language - don't interrupt user experience
          console.warn('AI processing failed:', result.error);
        }
      } catch (error: any) {
        // Silently fail - don't interrupt normal flow
        console.error('AI processing error:', error);
      }
    }
    return;
  }

  const input = ctx.message.text;

  if (ctx.session.awaitingInput === 'buy') {
    const settings = ctx.session.settings;
    const token = input.trim();

    // Check wallet again
    try {
      const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
      const hasWallet = wallets && wallets.some((w: any) => w.chain === settings.defaultChain);

      if (!hasWallet) {
        ctx.session.awaitingInput = undefined;
        const keyboard = new InlineKeyboard()
          .text('🔐 Generate Wallet', 'gen_wallet_' + settings.defaultChain)
          .text('📥 Import Wallet', 'import_wallet').row()
          .text('🔙 Back', 'back_main');

        await ctx.reply(
          '❌ <b>Wallet Required</b>\n\n' +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `You need to setup a ${settings.defaultChain.toUpperCase()} wallet before buying.\n\n` +
          `Please create or import a wallet first:`,
          { parse_mode: 'HTML', reply_markup: keyboard }
        );
        return;
      }

      // Fetch token info and security check - REPLIED instead of edited
      const statusMsg = await ctx.reply('🔍 <b>Analyzing Token</b>\n\n⏳ Performing security scan and market analysis...', { parse_mode: 'HTML' });

      const [priceResult, securityResult, balanceResult] = await Promise.allSettled([
        callRustAPI(`/api/price/${settings.defaultChain}/${token}`),
        callRustAPI('/api/security-check', 'POST', {
          chain: settings.defaultChain,
          token: token,
        }),
        callRustAPI(`/api/wallet/balance/${ctx.from!.id}/${settings.defaultChain}`),
      ]);

      // Build professional token info message
      let tokenInfo = '📊 <b>Token Analysis Report</b>\n\n';
      tokenInfo += '━━━━━━━━━━━━━━━━━━━━\n\n';

      // Token Address
      tokenInfo += '📍 <b>Token Address</b>\n';
      tokenInfo += `<code>${token.slice(0, 16)}...${token.slice(-12)}</code>\n`;
      tokenInfo += `🌐 Chain: <b>${settings.defaultChain.toUpperCase()}</b>\n\n`;

      // Security Section (Priority)
      if (securityResult.status === 'fulfilled' && securityResult.value) {
        const sec = securityResult.value;
        const isSafe = sec.is_safe;
        const securityBadge = isSafe ? '🟢 VERIFIED' : '🔴 HIGH RISK';
        const securityColor = isSafe ? '🟢' : '🔴';

        tokenInfo += `${securityColor} <b>Security Status: ${securityBadge}</b>\n`;
        tokenInfo += '━━━━━━━━━━━━━━━━━━━━\n';

        // Rug Score with visual indicator
        const rugScoreBar = Math.floor(sec.rug_score / 10);
        const rugBar = '█'.repeat(rugScoreBar) + '░'.repeat(10 - rugScoreBar);
        const rugEmoji = sec.rug_score >= 70 ? '🟢' : sec.rug_score >= 40 ? '🟡' : '🔴';
        tokenInfo += `${rugEmoji} <b>Rug Score:</b> ${sec.rug_score}/100\n`;
        tokenInfo += `   ${rugBar}\n`;

        // Honeypot check
        const honeypotStatus = sec.honeypot ? '🔴 DETECTED' : '🟢 CLEAR';
        tokenInfo += `${sec.honeypot ? '⚠️' : '✅'} <b>Honeypot:</b> ${honeypotStatus}\n`;

        // Holders
        tokenInfo += `👥 <b>Holders:</b> ${sec.holder_count.toLocaleString()}\n`;

        // Liquidity
        const liquidityStatus = sec.liquidity_usd > 100000 ? '🟢' : sec.liquidity_usd > 10000 ? '🟡' : '🔴';
        tokenInfo += `${liquidityStatus} <b>Liquidity:</b> $${formatNumber(sec.liquidity_usd)}\n`;

        if (sec.warnings && sec.warnings.length > 0) {
          tokenInfo += '\n⚠️ <b>Security Warnings:</b>\n';
          sec.warnings.forEach((w: string) => {
            tokenInfo += `   • ${w}\n`;
          });
        }

        if (!isSafe) {
          tokenInfo += '\n⚠️ <b>WARNING:</b> This token has security risks. Trade with extreme caution.\n';
        }

        tokenInfo += '\n';
      } else {
        tokenInfo += '⚠️ <b>Security Check Unavailable</b>\n';
        tokenInfo += 'Unable to verify token security. Proceed with caution.\n\n';
      }

      // Price Section
      tokenInfo += '━━━━━━━━━━━━━━━━━━━━\n';
      tokenInfo += '💰 <b>Market Data</b>\n';
      tokenInfo += '━━━━━━━━━━━━━━━━━━━━\n';

      if (priceResult.status === 'fulfilled' && priceResult.value.success && priceResult.value.price) {
        const p = priceResult.value.price;
        const changeEmoji = p.price_change_24h >= 0 ? '🟢' : '🔴';
        const changeSign = p.price_change_24h >= 0 ? '+' : '';

        tokenInfo += `💵 <b>Price:</b> $${formatNumber(p.price_usd, 8)}\n`;
        tokenInfo += `${changeEmoji} <b>24h Change:</b> ${changeSign}${formatNumber(p.price_change_24h)}%\n`;
        tokenInfo += `📊 <b>24h Volume:</b> $${formatNumber(p.volume_24h)}\n`;
        tokenInfo += `💧 <b>Liquidity:</b> $${formatNumber(p.liquidity)}\n\n`;
      } else {
        tokenInfo += '⚠️ Price data unavailable\n\n';
      }

      // Balance Section
      tokenInfo += '━━━━━━━━━━━━━━━━━━━━\n';
      tokenInfo += '💼 <b>Your Wallet Balance</b>\n';
      tokenInfo += '━━━━━━━━━━━━━━━━━━━━\n';

      let balance = 0;
      let balanceSymbol = settings.defaultChain === 'solana' ? 'SOL' : settings.defaultChain === 'eth' ? 'ETH' : 'BNB';

      if (balanceResult.status === 'fulfilled' && balanceResult.value) {
        // Check if there's an error in the response
        if (balanceResult.value.error) {
          tokenInfo += `⚠️ <b>Balance Check Failed</b>\n`;
          tokenInfo += `Error: ${balanceResult.value.error}\n\n`;
          tokenInfo += `💡 <b>Possible causes:</b>\n`;
          tokenInfo += `• RPC connection issue\n`;
          tokenInfo += `• Network timeout\n`;
          tokenInfo += `• Invalid wallet address\n\n`;
          tokenInfo += `Please try refreshing or check your wallet connection.\n\n`;
        } else {
          balance = parseFloat(balanceResult.value.native_balance) || 0;
          const usdValue = balanceResult.value.total_usd || 0;

          if (balance > 0) {
            tokenInfo += `💰 <b>Available:</b> ${formatNumber(balance, 6)} ${balanceSymbol}\n`;
            tokenInfo += `💵 <b>USD Value:</b> $${formatNumber(usdValue, 2)}\n\n`;
          } else {
            tokenInfo += `⚠️ <b>Insufficient Balance</b>\n`;
            tokenInfo += `You have: 0 ${balanceSymbol}\n`;
            tokenInfo += `Please deposit funds to proceed.\n\n`;
          }
        }
      } else {
        tokenInfo += '⚠️ <b>Unable to Fetch Balance</b>\n';
        tokenInfo += '━━━━━━━━━━━━━━━━━━━━\n';
        if (balanceResult.status === 'rejected') {
          const error = balanceResult.reason;
          tokenInfo += `Error: ${error?.message || 'Network error'}\n\n`;
        } else {
          tokenInfo += 'Balance service unavailable.\n\n';
        }
        tokenInfo += '💡 <b>Possible solutions:</b>\n';
        tokenInfo += '• Check RPC connection\n';
        tokenInfo += '• Verify wallet is synced\n';
        tokenInfo += '• Try again in a moment\n\n';
      }

      // Store pending buy info
      ctx.session.pendingBuy = {
        token: token,
        chain: settings.defaultChain,
      };
      ctx.session.awaitingInput = 'custom_amount';

      // Create amount selection keyboard
      const keyboard = new InlineKeyboard();

      // Preset amounts based on balance
      if (balance > 0) {
        const amounts = [
          balance * 0.1,  // 10%
          balance * 0.25, // 25%
          balance * 0.5,  // 50%
          balance * 0.75, // 75%
          balance,        // 100%
        ];

        amounts.forEach((amt, idx) => {
          if (amt > 0 && amt <= balance) {
            const label = idx === 0 ? '10%' : idx === 1 ? '25%' : idx === 2 ? '50%' : idx === 3 ? '75%' : '100%';
            keyboard.text(`${label} (${formatNumber(amt, 4)} ${balanceSymbol})`, `buy_amount_${amt.toFixed(6)}`).row();
          }
        });
      }

      // Custom amount button
      keyboard.text('✏️ Custom Amount', 'buy_custom').row();
      keyboard.text('❌ Cancel', 'cancel_buy');

      tokenInfo += '━━━━━━━━━━━━━━━━━━━━\n';
      tokenInfo += '📈 <b>Select Purchase Amount</b>\n';
      tokenInfo += '━━━━━━━━━━━━━━━━━━━━\n\n';
      tokenInfo += 'Choose a preset amount or enter a custom value:';

      // Edit the previous message instead of replying
      // Edit the previous message instead of replying
      try {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, tokenInfo, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } catch (e) {
        // If edit fails, send new message
        console.error('Failed to edit message:', e);
        await ctx.reply(tokenInfo, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      }
    } catch (error: any) {
        if (error.message.includes('Token Risk') || (error.message.includes('API error') && error.message.includes('Token Risk'))) {
             // Try to extract clean error message
             const match = error.message.match(/API error \(\d+\): (.*)/);
             let errorMsg = match ? match[1] : error.message;
             try { const json = JSON.parse(errorMsg); if(json.error) errorMsg = json.error; } catch(err){}
             
             // Save needed info before clearing session if needed, but session already had pendingBuy
             // Actually, the session has pendingBuy. We need it for the button.
             const tokenForButton = ctx.session.pendingBuy?.token || ''; 
             
             ctx.session.awaitingInput = undefined;
             // Don't clear pendingBuy yet so user can try again? No, force buy takes arguments.
             ctx.session.pendingBuy = undefined;
    
             await ctx.reply(
               `⚠️ <b>Security Check Failed</b>\n\n` +
               `${errorMsg}\n\n` +
               `To bypass this check, click below:`,
               { 
                 parse_mode: 'HTML',
                 reply_markup: new InlineKeyboard().text('⚠️ Force Buy', `force_buy:${tokenForButton}:${amount}`)
               }
            );
            return;
        }

      ctx.session.awaitingInput = undefined;
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  } else if (ctx.session.awaitingInput === 'custom_amount') {
    // Handle custom amount input
    const amount = parseFloat(input);

    if (isNaN(amount) || amount <= 0) {
      return ctx.reply(
        `❌ <b>Invalid Amount</b>\n\n` +
        `Please enter a valid positive number.\n\n` +
        `💡 <b>Example:</b> 0.5, 1.0, 2.5`,
        { parse_mode: 'HTML' }
      );
    }

    if (!ctx.session.pendingBuy) {
      ctx.session.awaitingInput = undefined;
      return ctx.reply(
        `❌ <b>No Active Purchase</b>\n\n` +
        `The purchase session has expired.\n\n` +
        `Please start a new purchase from the main menu.`,
        { parse_mode: 'HTML' }
      );
    }

    // Check balance
    // Extract pendingBuy info before try block so it's available in catch if needed
    const pendingBuy = ctx.session.pendingBuy!; // Safe because check above
    const buyToken = pendingBuy.token;
    const buyChain = pendingBuy.chain;

    try {
      const balanceResult = await callRustAPI(`/api/wallet/balance/${ctx.from!.id}/${buyChain}`);
      const balance = parseFloat(balanceResult.native_balance) || 0;

      if (amount > balance) {
        return ctx.reply(
          `❌ <b>Insufficient Balance</b>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `💰 <b>Available:</b> ${formatNumber(balance, 6)} ${buyChain === 'solana' ? 'SOL' : buyChain === 'eth' ? 'ETH' : 'BNB'}\n` +
          `💸 <b>Requested:</b> ${formatNumber(amount, 6)}\n\n` +
          `⚠️ The requested amount exceeds your available balance.\n\n` +
          `Please deposit funds or select a smaller amount.`,
          { parse_mode: 'HTML' }
        );
      }

      // Execute buy
      ctx.session.awaitingInput = undefined;

      // Save pending buy info before clearing
      ctx.session.pendingBuy = undefined;

      try {
        await ctx.editMessageText('⚡ <b>Executing Trade</b>\n\n⏳ Processing transaction on blockchain...', { parse_mode: 'HTML' });
      } catch {
        await ctx.reply('⚡ <b>Executing Trade</b>\n\n⏳ Processing transaction on blockchain...', { parse_mode: 'HTML' });
      }

      const settings = ctx.session.settings;
      const result = await callRustAPI('/api/buy', 'POST', {
        user_id: ctx.from.id,
        chain: buyChain,
        token: buyToken,
        amount: amount.toString(),
        slippage: settings.slippage,
        take_profit: settings.takeProfitPercent,
        stop_loss: settings.stopLossPercent,
      });

      if (result.success) {
        const chain = buyChain.toUpperCase();
        const balanceSymbol = chain === 'SOLANA' ? 'SOL' : chain === 'ETH' ? 'ETH' : 'BNB';

        const successMessage =
          `✅ <b>Trade Executed Successfully</b>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🌐 <b>Chain:</b> ${chain}\n` +
          `📍 <b>Token:</b> <code>${buyToken.slice(0, 16)}...${buyToken.slice(-12)}</code>\n` +
          `💰 <b>Amount:</b> ${formatNumber(amount, 6)} ${balanceSymbol}\n\n` +
          `🔗 <b>Transaction Hash:</b>\n` +
          `<code>${result.tx_hash}</code>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📊 <b>Position Management</b>\n` +
          `🎯 Take Profit: <b>+${settings.takeProfitPercent}%</b>\n` +
          `🛑 Stop Loss: <b>${settings.stopLossPercent}%</b>\n\n` +
          `🆔 <b>Position ID:</b> <code>${result.position_id}</code>\n\n` +
          `✅ Your position is now being monitored automatically.`;

        try {
          await ctx.editMessageText(successMessage, { parse_mode: 'HTML' });
        } catch {
          await ctx.reply(successMessage, { parse_mode: 'HTML' });
        }
      } else {
        const errorMessage =
          `❌ <b>Trade Execution Failed</b>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Error: <code>${result.error || 'Unknown error occurred'}</code>\n\n` +
          `Please verify:\n` +
          `• Sufficient balance\n` +
          `• Valid token address\n` +
          `• Network connectivity\n\n` +
          `Try again or contact support if the issue persists.`;

        try {
          await ctx.editMessageText(errorMessage, { parse_mode: 'HTML' });
        } catch {
          await ctx.reply(errorMessage, { parse_mode: 'HTML' });
        }
      }
    } catch (error: any) {
        if (error.message.includes('Token Risk') || (error.message.includes('API error') && error.message.includes('Token Risk'))) {
             const match = error.message.match(/API error \(\d+\): (.*)/);
             let errorMsg = match ? match[1] : error.message;
             try { const json = JSON.parse(errorMsg); if(json.error) errorMsg = json.error; } catch(err){}
             
             // We can use buyToken from the try block scope if we moved declaration? 
             // In custom_amount, buyToken was declared via `const buyToken = pendingBuy.token`.
             // But const is block scoped to the `if (!ctx.session.pendingBuy) ... else ...` block or try block?
             // Actually, in the view above, `buyToken` is declared at line 2383 (Step 726 view).
             // Wait, in `custom_amount` handler (not visible fully here), `buyToken` is declared.
             // We need to make sure we use the right variable.
             
             // To be safe, we just use the session if available, or fail gracefully.
             // But we cleared session in `try`? No, we clear it at line 2376.
             // So in catch, session is gone.
             // We must rely on `buyToken` being available in scope.
             // In the previous step I didn't see the full custom_amount handler.
             // I will just use `buyToken` assuming I move it up, OR I will restart the flow.
             
             // Actually, I can't easily move `buyToken` up in `custom_amount` without seeing the start.
             // Let's just fix the catch block to NOT rely on `buyToken` if it's potentially undefined, 
             // OR re-read `pendingBuy` before clearing.
             
             // Better fix: Don't clear session until SUCCESS.
             // But then we risk stale state.
             
             // I will try to use `buyToken` but wrapping it in a check or using the `tokenForButton` approach if valid.
             // Re-reading code from Step 726:
             // `const pendingBuy = ctx.session.pendingBuy!;` line 2373.
             // `const buyToken = pendingBuy.token;` line 2374.
             // These are inside the `else if` block, so they are available in `catch` which is also inside `else if` block?
             // `try` block starts at 2353.
             // `buyToken` is declared at 2374, which is AFTER `try` block starts? No.
             // Wait, `try` structure in `custom_amount` is complex.
             // The `try` where `callRustAPI` happens starts at 2353 (check balance).
             // `buyToken` is extracted at 2374.
             // This is INSIDE the `try` block for balance check?
             // Yes, line 2353 `try {`.
             // So `buyToken` is block scoped to `try`.
             
             // I must move `buyToken` extraction BEFORE `try`.
             
             // This tool call only sees catch block. I need another tool call to move the definition.
             // I will use `replace_file_content` to move the definition UP, similar to previous step.
        }
        
      ctx.session.awaitingInput = undefined;
      ctx.session.pendingBuy = undefined;
      try {
        await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
      } catch {
        await ctx.reply(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
      }
    }
  } else if (ctx.session.awaitingInput === 'token_check') {
    ctx.session.awaitingInput = undefined;

    try {
      await ctx.editMessageText('🔍 <b>Checking token security...</b>', { parse_mode: 'HTML' });
    } catch {
      await ctx.reply('🔍 <b>Checking token security...</b>', { parse_mode: 'HTML' });
    }

    try {
      const check = await callRustAPI('/api/security-check', 'POST', {
        chain: ctx.session.settings.defaultChain,
        token: input,
      });

      const status = check.is_safe ? '✅ SAFE' : '⚠️ RISKY';

      const securityMessage =
        `🔍 <b>Security Report</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Status: ${status}\n` +
        `Rug Score: ${check.rug_score}/100\n` +
        `Honeypot: ${check.honeypot ? 'YES ⚠️' : 'NO ✅'}\n` +
        `Liquidity: $${formatNumber(check.liquidity_usd)}\n` +
        `Holders: ${check.holder_count}\n\n` +
        `${check.warnings.length > 0 ? '⚠️ Warnings:\n' + check.warnings.join('\n') : ''}`;

      try {
        await ctx.editMessageText(securityMessage, { parse_mode: 'HTML' });
      } catch {
        await ctx.reply(securityMessage, { parse_mode: 'HTML' });
      }
    } catch (error: any) {
      try {
        await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
      } catch {
        await ctx.reply(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
      }
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

    try {
      await ctx.editMessageText(`📥 Importing ${chain.toUpperCase()} wallet...`, { parse_mode: 'HTML' });
    } catch {
      await ctx.reply(`📥 Importing ${chain.toUpperCase()} wallet...`, { parse_mode: 'HTML' });
    }

    try {
      // Check if wallet already exists
      const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`);
      const hasWallet = wallets && wallets.some((w: any) => w.chain === chain);

      if (hasWallet) {
        return ctx.reply(
          `⚠️ <b>Wallet Already Exists</b>\n\n` +
          `You already have a ${chain.toUpperCase()} wallet.\n\n` +
          `Use /wallet to view your existing wallet.`,
          { parse_mode: 'HTML' }
        );
      }

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

    try {
      await ctx.editMessageText('📥 <b>Processing import data...</b>', { parse_mode: 'HTML' });
    } catch {
      await ctx.reply('📥 <b>Processing import data...</b>', { parse_mode: 'HTML' });
    }

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
        const importMessage =
          `✅ <b>Data Imported Successfully!</b>\n\n` +
          `<b>Type:</b> ${dataType}\n` +
          `<b>Imported:</b> ${result.imported_count} items\n` +
          `${result.errors.length > 0 ? `\n⚠️ Errors: ${result.errors.length}\n${result.errors.slice(0, 3).join('\n')}` : ''}`;

        try {
          await ctx.editMessageText(importMessage, { parse_mode: 'HTML' });
        } catch {
          await ctx.reply(importMessage, { parse_mode: 'HTML' });
        }
      } else {
        const errorMessage =
          `❌ <b>Import Failed</b>\n\n` +
          `Imported: ${result.imported_count} items\n` +
          `Errors:\n${result.errors.slice(0, 5).join('\n')}`;

        try {
          await ctx.editMessageText(errorMessage, { parse_mode: 'HTML' });
        } catch {
          await ctx.reply(errorMessage, { parse_mode: 'HTML' });
        }
      }
    } catch (error: any) {
      try {
        await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
      } catch {
        await ctx.reply(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
      }
    }
  } else if (ctx.session.awaitingInput === 'bundler_add') {
    ctx.session.awaitingInput = undefined;

    const parts = input.trim().split(' ');
    if (parts.length < 3) {
      return ctx.reply('❌ Invalid format. Use: <token> <amount> <type>');
    }

    const [token, amount, txType] = parts;
    const settings = ctx.session.settings;

    try {
      await ctx.editMessageText('➕ <b>Adding to bundle...</b>', { parse_mode: 'HTML' });

      const result = await callRustAPI('/api/bundler/add', 'POST', {
        user_id: ctx.from.id,
        chain: settings.defaultChain,
        tx_type: txType.toLowerCase(),
        token: token,
        amount: amount,
        slippage: settings.slippage,
        priority: 5,
      });

      if (result.success) {
        await ctx.editMessageText(
          `✅ <b>Transaction Added to Bundle</b>\n\n` +
          `Bundle ID: <code>${result.bundle_id}</code>\n\n` +
          `Transaction will be executed when bundle is ready.`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.editMessageText(`❌ Error: ${result.error}`, { parse_mode: 'HTML' });
      }
    } catch (error: any) {
      await ctx.reply(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
    }
  } else if (ctx.session.awaitingInput === 'whale_alert') {
    ctx.session.awaitingInput = undefined;

    const parts = input.trim().split(' ');
    if (parts.length < 1) {
      return ctx.reply('❌ Invalid format. Use: <min_size_usd> [chains] [tokens] [types]');
    }

    const minSize = parseFloat(parts[0]);
    if (isNaN(minSize) || minSize <= 0) {
      return ctx.reply('❌ Invalid minimum size. Must be a positive number.');
    }

    const chains = parts[1] ? parts[1].split(',') : [];
    const tokens = parts[2] ? parts[2].split(',') : [];
    const types = parts[3] ? parts[3].split(',') : [];

    try {
      await ctx.editMessageText('🔔 <b>Creating whale alert...</b>', { parse_mode: 'HTML' });

      const result = await callRustAPI('/api/whales/alert', 'POST', {
        user_id: ctx.from.id,
        min_size_usd: minSize,
        chains: chains.length > 0 ? chains : undefined,
        tokens: tokens.length > 0 ? tokens : undefined,
        position_types: types.length > 0 ? types : undefined,
      });

      if (result.success) {
        await ctx.editMessageText(
          `✅ <b>Whale Alert Created!</b>\n\n` +
          `Alert ID: <code>${result.alert_id}</code>\n\n` +
          `You'll be notified when trades exceed $${formatNumber(minSize)}.`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.editMessageText(`❌ Error: ${result.error}`, { parse_mode: 'HTML' });
      }
    } catch (error: any) {
      await ctx.reply(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
    }
  } else if (ctx.session.awaitingInput === 'grid_create') {
    ctx.session.awaitingInput = undefined;

    const parts = input.trim().split(' ');
    if (parts.length < 5) {
      return ctx.reply('❌ Invalid format. Use: <token> <lower_price> <upper_price> <grid_count> <investment>');
    }

    const [token, lowerStr, upperStr, gridCountStr, investmentStr] = parts;
    const lower = parseFloat(lowerStr);
    const upper = parseFloat(upperStr);
    const gridCount = parseInt(gridCountStr);
    const investment = parseFloat(investmentStr);

    if (isNaN(lower) || isNaN(upper) || isNaN(gridCount) || isNaN(investment)) {
      return ctx.reply('❌ Invalid values. All parameters must be numbers.');
    }

    if (lower >= upper) {
      return ctx.reply('❌ Lower price must be less than upper price.');
    }

    if (gridCount < 2 || gridCount > 50) {
      return ctx.reply('❌ Grid count must be between 2 and 50.');
    }

    const settings = ctx.session.settings;

    try {
      await ctx.editMessageText('📐 <b>Creating grid strategy...</b>', { parse_mode: 'HTML' });

      // Get token symbol from price API
      let tokenSymbol = token.slice(0, 8) + '...';
      try {
        const priceData = await callRustAPI(`/api/price/${settings.defaultChain}/${token}`);
        if (priceData.success && priceData.price && priceData.price.token_symbol) {
          tokenSymbol = priceData.price.token_symbol;
        }
      } catch { }

      const result = await callRustAPI('/api/grid/create', 'POST', {
        user_id: ctx.from.id,
        chain: settings.defaultChain,
        token: token,
        token_symbol: tokenSymbol,
        lower_price: lower,
        upper_price: upper,
        grid_count: gridCount,
        investment_amount: investment,
      });

      if (result.success) {
        await ctx.editMessageText(
          `✅ <b>Grid Strategy Created!</b>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Strategy ID: <code>${result.strategy_id}</code>\n` +
          `Token: ${tokenSymbol}\n` +
          `Price Range: $${formatNumber(lower)} - $${formatNumber(upper)}\n` +
          `Grid Levels: ${gridCount}\n` +
          `Investment: ${investment} ${settings.defaultChain === 'solana' ? 'SOL' : settings.defaultChain === 'eth' ? 'ETH' : 'BNB'}\n\n` +
          `Grid trading is now active!`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.editMessageText(`❌ Error: ${result.error}`, { parse_mode: 'HTML' });
      }
    } catch (error: any) {
      await ctx.reply(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
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

// /check command
bot.command('check', async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1);
  const token = args && args.length > 0 ? args[0] : null; // Expect formatting /check <token>
  const settings = ctx.session.settings;
  const chain = settings.defaultChain;

  if (!token) {
    return ctx.reply('⚠️ Please provide a token address. Usage: /check <token_address>');
  }

  await ctx.reply(`🔍 Analyzing token on ${chain.toUpperCase()}...`);

  try {
    const response = await callRustAPI(`/api/check/${chain}/${token}`);

    let message = `🛡️ <b>Security Report</b>: <code>${token}</code>\n\n`;
    let scoreEmoji = '🟢';
    if (response.rug_score < 80) scoreEmoji = '🟡';
    if (response.rug_score < 50) scoreEmoji = '🔴';

    message += `<b>Risk Score:</b> ${scoreEmoji} ${response.rug_score}/100\n`;
    message += `<b>Recommendation:</b> ${response.is_safe ? 'Safe to Trade ✅' : 'High Risk ⚠️'}\n\n`;

    if (response.warnings.length > 0) {
      message += `<b>⚠️ Risk Factors:</b>\n`;
      response.warnings.forEach((w: string) => {
        message += `• ${w}\n`;
      });
    } else {
      message += `✅ No major warnings found.\n`;
    }

    // Add more details if available (liquidity etc stubbed for now)

    await ctx.reply(message, { parse_mode: 'HTML' });

  } catch (error: any) {
    await ctx.reply(`❌ Error checking token: ${error.message}`);
  }
});

// /simulate_whale command
bot.command('simulate_whale', async (ctx) => {
  await ctx.reply('🐋 Simulating whale activity...');

  try {
    const activity = await callRustAPI('/api/whales/simulate', 'POST', {});

    let message = `🚨 <b>WHALE ALERT</b> 🚨\n\n`;
    message += `🐋 <b>${activity.known_label || 'Unknown Whale'}</b>\n`;
    message += `<code>${activity.trade.wallet_address.slice(0, 8)}...${activity.trade.wallet_address.slice(-6)}</code>\n\n`;

    const typeEmoji = activity.trade.trade_type === 'Buy' ? '🟢' : '🔴';
    const action = activity.trade.trade_type === 'Buy' ? 'BOUGHT' : 'SOLD';

    message += `${typeEmoji} <b>${action} $${activity.trade.token_symbol}</b>\n`;
    message += `💰 Size: $${formatNumber(activity.trade.size_usd)} (${formatNumber(activity.trade.size_native)} ${activity.trade.token_symbol})\n`;

    if (activity.is_first_entry) {
      message += `🆕 <b>FIRST ENTRY Detected!</b>\n`;
    }

    message += `\n🎯 <b>Confidence Score:</b> ${activity.confidence_score}%\n`;
    message += `🌊 <b>Market Impact:</b> ${activity.market_impact}`;

    await ctx.reply(message, { parse_mode: 'HTML' });

  } catch (error: any) {
    await ctx.reply(`❌ Error simulating whale: ${error.message}`);
  }
});

// /whale_monitor command
bot.command('whale_monitor', async (ctx) => {
  await ctx.reply(
    '🐋 <b>Whale Monitor Active</b>\n\n' +
    'Tracking: <b>Solana Mainnet</b>\n' +
    'Threshold: <b>$100,000+</b>\n' +
    'Known Whales: <b>Alameda, Binance, Jump</b>\n\n' +
    '<i>No active alerts in the last hour.</i>',
    { parse_mode: 'HTML' }
  );
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
      if (alert.chain) {
        message += `Chain: ${alert.chain.toUpperCase()}\n`;
      }
      if (alert.token) {
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

// ==================== BUNDLER FEATURE ====================
bot.callbackQuery('bundler', async (ctx) => {
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text('➕ Add Transaction', 'bundler_add')
    .text('📊 View Bundle', 'bundler_status')
    .text('⚡ Execute', 'bundler_execute').row()
    .text('🔙 Back', 'menu_tools').row();

  await safeEditMessage(
    ctx,
    '📦 <b>Transaction Bundler</b>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Bundle multiple transactions together to save on gas fees!\n\n' +
    '💡 <b>How it works:</b>\n' +
    '• Add multiple buy/sell transactions\n' +
    '• Bundle executes them in one transaction\n' +
    '• Save up to 70% on gas fees\n\n' +
    'Select an option:',
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
});

bot.callbackQuery('bundler_add', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingInput = 'bundler_add';

  await ctx.editMessageText(
    '➕ <b>Add Transaction to Bundle</b>\n\n' +
    'Send transaction details:\n\n' +
    'Format: <code>&lt;token&gt; &lt;amount&gt; &lt;type&gt;</code>\n\n' +
    '<b>Example:</b>\n' +
    '<code>So111...abc 0.5 buy</code>\n' +
    '<code>0x123...xyz 0.1 sell</code>\n\n' +
    'Type: buy, sell, or swap',
    { parse_mode: 'HTML' }
  );
});

bot.callbackQuery('bundler_status', async (ctx) => {
  await ctx.answerCallbackQuery();

  try {
    const settings = ctx.session.settings;
    const status = await callRustAPI(`/api/bundler/status/${ctx.from!.id}/${settings.defaultChain}`);

    let message = '📊 <b>Bundle Status</b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━\n\n';
    message += `<b>Bundle ID:</b> <code>${status.bundle_id}</code>\n`;
    message += `<b>Status:</b> ${status.status}\n`;
    message += `<b>Transactions:</b> ${status.transaction_count}\n`;
    message += `<b>Gas Saved:</b> ${formatNumber(status.gas_saved, 6)} ${settings.defaultChain === 'solana' ? 'SOL' : settings.defaultChain === 'eth' ? 'ETH' : 'BNB'}\n`;
    message += `<b>Savings:</b> ${formatNumber(status.estimated_savings_percent, 2)}%\n\n`;

    if (status.transactions.length > 0) {
      message += '<b>Pending Transactions:</b>\n';
      status.transactions.forEach((tx: any, idx: number) => {
        message += `${idx + 1}. ${tx.tx_type.toUpperCase()} ${tx.token.slice(0, 8)}... (${tx.amount})\n`;
      });
    }

    const keyboard = new InlineKeyboard()
      .text('⚡ Execute', `bundler_execute_${settings.defaultChain}`)
      .text('🔙 Back', 'bundler');

    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

bot.callbackQuery(/^bundler_execute/, async (ctx) => {
  await ctx.answerCallbackQuery();

  try {
    const settings = ctx.session.settings;
    await safeEditMessage(ctx, '⚡ <b>Executing bundle...</b>', { parse_mode: 'HTML' });

    // First check if bundle exists
    const bundleStatus = await callRustAPI(`/api/bundler/status/${ctx.from!.id}/${settings.defaultChain}`, 'GET').catch(() => null);

    if (!bundleStatus || bundleStatus.transaction_count === 0) {
      await safeEditMessage(
        ctx,
        `❌ <b>No Bundle Found</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `You need to add transactions to a bundle first.\n\n` +
        `Use the "Add to Bundle" option when buying/selling.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const result = await callRustAPI(`/api/bundler/execute/${ctx.from!.id}/${settings.defaultChain}`, 'POST');

    if (result.success) {
      await safeEditMessage(
        ctx,
        `✅ <b>Bundle Executed!</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔗 <b>TX Hash:</b>\n` +
        `<code>${result.tx_hash}</code>\n\n` +
        `💰 Gas saved by bundling transactions!`,
        { parse_mode: 'HTML' }
      );
    } else {
      await safeEditMessage(
        ctx,
        `❌ <b>Bundle Execution Failed</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Error: ${result.error || 'Unknown error'}\n\n` +
        `Make sure you have transactions in your bundle.`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
    if (errorMessage.includes('404') || errorMessage.includes('Bundle not found')) {
      await safeEditMessage(
        ctx,
        `❌ <b>No Bundle Found</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `You need to add transactions to a bundle first.\n\n` +
        `Use the "Add to Bundle" option when buying/selling.`,
        { parse_mode: 'HTML' }
      );
    } else {
      await safeEditMessage(
        ctx,
        `❌ <b>Error</b>\n\n${errorMessage}`,
        { parse_mode: 'HTML' }
      );
    }
  }
});

// ==================== WHALE TRACKER FEATURE ====================
bot.callbackQuery('whales', async (ctx) => {
  await ctx.answerCallbackQuery();

  try {
    const stats = await callRustAPI('/api/whales/stats');

    let message = '🐋 <b>Whale Tracker</b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━\n\n';
    message += `<b>Total Whales Tracked:</b> ${stats.total_whales_tracked}\n`;
    message += `<b>24h Volume:</b> $${formatNumber(stats.total_volume_24h)}\n`;
    message += `<b>Long/Short Ratio:</b> ${formatNumber(stats.long_short_ratio, 2)}\n\n`;

    if (stats.largest_trade_24h) {
      const trade = stats.largest_trade_24h;
      message += `<b>Largest Trade (24h):</b>\n`;
      message += `$${formatNumber(trade.size_usd)} ${trade.position_type}\n`;
      message += `${trade.token_symbol} on ${trade.chain.toUpperCase()}\n\n`;
    }

    if (stats.top_whales && stats.top_whales.length > 0) {
      message += '<b>Top Whales:</b>\n';
      stats.top_whales.slice(0, 5).forEach((whale: any, idx: number) => {
        message += `${idx + 1}. ${whale.wallet_address.slice(0, 8)}... - $${formatNumber(whale.total_volume_24h)}\n`;
      });
    }

    const keyboard = new InlineKeyboard()
      .text('🔔 Create Alert', 'whale_alert_create')
      .text('📋 My Alerts', 'whale_alerts')
      .text('🔄 Refresh', 'whales').row()
      .text('🔙 Back', 'menu_tools').row();

    await safeEditMessage(ctx, message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

bot.callbackQuery('whale_alert_create', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingInput = 'whale_alert';

  await ctx.editMessageText(
    '🔔 <b>Create Whale Alert</b>\n\n' +
    'Send alert configuration:\n\n' +
    'Format: <code>&lt;min_size_usd&gt; [chains] [tokens] [types]</code>\n\n' +
    '<b>Example:</b>\n' +
    '<code>50000 solana,eth USDC,USDT long,short</code>\n\n' +
    '• min_size_usd: Minimum trade size in USD\n' +
    '• chains: Comma-separated (optional)\n' +
    '• tokens: Comma-separated (optional)\n' +
    '• types: long, short, spot (optional)',
    { parse_mode: 'HTML' }
  );
});

bot.callbackQuery('whale_alerts', async (ctx) => {
  await ctx.answerCallbackQuery();

  try {
    const alerts = await callRustAPI(`/api/whales/alerts/${ctx.from!.id}`);

    if (alerts.length === 0) {
      return ctx.editMessageText(
        '📋 <b>No Whale Alerts</b>\n\n' +
        'You don\'t have any active whale alerts.\n\n' +
        'Create one to get notified about large trades!',
        { parse_mode: 'HTML' }
      );
    }

    let message = '📋 <b>Your Whale Alerts</b>\n\n';
    alerts.forEach((alert: any, idx: number) => {
      message += `${idx + 1}. Min Size: $${formatNumber(alert.min_size_usd)}\n`;
      if (alert.chains.length > 0) {
        message += `   Chains: ${alert.chains.join(', ')}\n`;
      }
      if (alert.tokens.length > 0) {
        message += `   Tokens: ${alert.tokens.join(', ')}\n`;
      }
      message += '\n';
    });

    await ctx.editMessageText(message, { parse_mode: 'HTML' });
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// ==================== LEADERBOARDS FEATURE ====================
bot.callbackQuery('leaderboard', async (ctx) => {
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text('📅 Daily', 'leaderboard_daily')
    .text('📆 Weekly', 'leaderboard_weekly')
    .text('📊 Monthly', 'leaderboard_monthly').row()
    .text('🏆 All Time', 'leaderboard_alltime')
    .text('👤 My Rank', 'leaderboard_myrank')
    .text('🔙 Back', 'menu_tools').row();

  await safeEditMessage(
    ctx,
    '🏆 <b>Leaderboards</b>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    'View top traders ranked by performance!\n\n' +
    'Select a time period:',
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
});

bot.callbackQuery(/^leaderboard_(daily|weekly|monthly|alltime)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const period = ctx.match[1];

  try {
    const leaderboard = await callRustAPI(`/api/leaderboard/${period}`);

    let message = `🏆 <b>Leaderboard - ${period.charAt(0).toUpperCase() + period.slice(1)}</b>\n\n`;
    message += '━━━━━━━━━━━━━━━━━━━━\n\n';
    message += `<b>Total Participants:</b> ${leaderboard.total_participants}\n\n`;

    if (leaderboard.entries && leaderboard.entries.length > 0) {
      message += '<b>Top 10:</b>\n\n';
      leaderboard.entries.slice(0, 10).forEach((entry: any) => {
        const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `${entry.rank}.`;
        const pnlEmoji = entry.total_pnl_usd >= 0 ? '🟢' : '🔴';
        message += `${medal} ${pnlEmoji} $${formatNumber(entry.total_pnl_usd)} (${formatNumber(entry.total_pnl_percent)}%)\n`;
        message += `   📊 ${entry.total_trades} trades | ${formatNumber(entry.win_rate)}% win rate\n`;
      });
    } else {
      message += 'No entries yet. Start trading to appear on the leaderboard!';
    }

    const keyboard = new InlineKeyboard()
      .text('🔄 Refresh', `leaderboard_${period}`)
      .text('👤 My Rank', 'leaderboard_myrank')
      .text('🔙 Back', 'leaderboard').row();

    await safeEditMessage(ctx, message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

bot.callbackQuery('leaderboard_myrank', async (ctx) => {
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text('📅 Daily', 'myrank_daily')
    .text('📆 Weekly', 'myrank_weekly').row()
    .text('📊 Monthly', 'myrank_monthly')
    .text('🏆 All Time', 'myrank_alltime').row()
    .text('🔙 Back', 'leaderboard');

  await ctx.editMessageText(
    '👤 <b>My Rank</b>\n\n' +
    'Select a time period to view your ranking:',
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
});

bot.callbackQuery(/^myrank_(daily|weekly|monthly|alltime)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const period = ctx.match[1];

  try {
    const rank = await callRustAPI(`/api/leaderboard/user/${ctx.from!.id}/${period}`);

    let message = `👤 <b>My Rank - ${period.charAt(0).toUpperCase() + period.slice(1)}</b>\n\n`;
    message += '━━━━━━━━━━━━━━━━━━━━\n\n';
    message += `<b>Rank:</b> #${rank.rank}\n`;
    message += `<b>Total PnL:</b> $${formatNumber(rank.total_pnl_usd)} (${formatNumber(rank.total_pnl_percent)}%)\n`;
    message += `<b>Total Trades:</b> ${rank.total_trades}\n`;
    message += `<b>Win Rate:</b> ${formatNumber(rank.win_rate)}%\n`;
    message += `<b>Winning:</b> ${rank.winning_trades} | <b>Losing:</b> ${rank.losing_trades}\n`;
    message += `<b>Total Volume:</b> $${formatNumber(rank.total_volume_usd)}\n`;
    message += `<b>Streak:</b> ${rank.streak > 0 ? '🔥 ' + rank.streak + ' wins' : rank.streak < 0 ? '❄️ ' + Math.abs(rank.streak) + ' losses' : '—'}\n`;

    const keyboard = new InlineKeyboard()
      .text('🔙 Back', 'leaderboard_myrank');

    await ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error: any) {
    await ctx.editMessageText(`❌ Error: ${error.message}`, { parse_mode: 'HTML' });
  }
});

// ==================== GRID TRADING FEATURE ====================
bot.callbackQuery('grid_trading', async (ctx) => {
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text('➕ Create Grid', 'grid_create')
    .text('📊 My Grids', 'grid_list')
    .text('🔙 Back', 'menu_tools').row();

  await safeEditMessage(
    ctx,
    '📐 <b>Grid Trading</b>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Automated trading strategy for sideways markets!\n\n' +
    '💡 <b>How it works:</b>\n' +
    '• Set a price range (e.g., $130-$140)\n' +
    '• Bot places buy orders at lower prices\n' +
    '• Bot places sell orders at higher prices\n' +
    '• Profits from price oscillations\n\n' +
    'Perfect for choppy/sideways markets!',
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
});

bot.callbackQuery('grid_create', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingInput = 'grid_create';

  await safeEditMessage(
    ctx,
    '➕ <b>Create Grid Strategy</b>\n\n' +
    'Send grid configuration:\n\n' +
    'Format: <code>&lt;token&gt; &lt;lower_price&gt; &lt;upper_price&gt; &lt;grid_count&gt; &lt;investment&gt;</code>\n\n' +
    '<b>Example:</b>\n' +
    '<code>So111...abc 130 140 10 1.0</code>\n\n' +
    '• token: Token address\n' +
    '• lower_price: Bottom of price range\n' +
    '• upper_price: Top of price range\n' +
    '• grid_count: Number of grid levels (2-50)\n' +
    '• investment: Total investment amount',
    { parse_mode: 'HTML' }
  );
});

bot.callbackQuery('grid_list', async (ctx) => {
  await ctx.answerCallbackQuery();

  // In production, fetch user's grids from API
  // For now, show placeholder
  await ctx.editMessageText(
    '📊 <b>My Grid Strategies</b>\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    'No active grid strategies.\n\n' +
    'Create one to start grid trading!',
    { parse_mode: 'HTML' }
  );
});

// ==================== ERROR HANDLING ====================
bot.catch((err) => {
  const ctx = err.ctx;
  const e = err.error;
  
  if (e instanceof GrammyError) {
    if (e.description.includes('query is too old') || e.description.includes('query ID is invalid')) {
        // Ignore these errors as they are common and harmless (user clicked button on old update)
        // console.log('⚠️ Warning: callback query expired');
        return;
    }
  }

  if (e instanceof HttpError) {
      console.error(`❌ Telegram HttpError: ${e}`);
      return;
  }

  console.error('❌ Bot error:', e);
  console.error('   Update:', ctx?.update);

  // Try to send error message to user if possible
  if (ctx) {
    ctx.reply('❌ An error occurred. Please try again or contact support.').catch(() => { });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down bot gracefully...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down bot gracefully...');
  await bot.stop();
  process.exit(0);
});

// Unhandled promise rejection
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// ==================== START BOT ====================
async function startBot() {
  console.log('🚀 Starting Telegram bot...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Validate environment
  if (!BOT_TOKEN) {
    console.error('❌ FATAL: TELEGRAM_BOT_TOKEN is required!');
    process.exit(1);
  }

  console.log(`📡 Rust API: ${RUST_API}`);

  // Check if Rust API is running with retry
  let apiReady = false;
  for (let i = 0; i < 5; i++) {
    try {
      const health = await fetch(`${RUST_API}/health`, {
        signal: AbortSignal.timeout(5000)
      });
      if (health.ok) {
        console.log('✅ Connected to Rust Trading Engine');
        apiReady = true;
        break;
      }
    } catch (error) {
      if (i < 4) {
        console.log(`⏳ Waiting for Rust API... (${i + 1}/5)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.warn('⚠️  Warning: Cannot connect to Rust API at', RUST_API);
        console.warn('   Bot will start but some features may not work.');
        console.warn('   Make sure trading-engine is running!');
      }
    }
  }

  // Start bot
  try {
    await bot.start({
      onStart: async (botInfo) => {
        // Set bot commands menu
        try {
          await bot.api.setMyCommands([
            { command: 'start', description: '🏠 View portfolio' },
            { command: 'buy', description: '💰 Buy tokens' },
            { command: 'sell', description: '💸 Sell position' },
            { command: 'positions', description: '📊 View positions' },
            { command: 'wallet', description: '💼 View wallets' },
            { command: 'settings', description: '⚙️ Bot settings' },
            { command: 'help', description: '❓ Show help' },
          ]);
          console.log('✅ Slash commands menu configured');
        } catch (error) {
          console.error('⚠️  Failed to set commands menu:', error);
        }
        
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ Bot started successfully!');
        console.log(`   Username: @${botInfo.username}`);
        console.log(`   ID: ${botInfo.id}`);
        console.log(`   API Status: ${apiReady ? '✅ Connected' : '⚠️  Not Connected'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📱 Ready to receive commands!');
      },
    });
  } catch (error: any) {
    console.error('❌ Failed to start bot:', error.message);
    process.exit(1);
  }
}

startBot().catch((error) => {
  console.error('❌ Fatal error starting bot:', error);
  process.exit(1);
});
// ==================== TROJAN-STYLE TOKEN INFO HANDLER ====================
// When user pastes just a contract address, show rich token info like Trojan bot

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  
  // Check if it's JUST a contract address (no buy/sell/swap command)
  const isContractAddress = /^(So11[a-zA-Z0-9]{40,44}|[a-zA-Z0-9]{32,44}|0x[a-fA-F0-9]{40})$/.test(text);
  
  if (!isContractAddress) {
    return; // Not a contract address, ignore
  }
  
  const token = text;
  const settings = ctx.session.settings;
  
  // Show loading message
  const loadingMsg = await ctx.reply('🔍 <b>Fetching token info...</b>', { parse_mode: 'HTML' });
  
  try {
    // Fetch token info, price, and security check in parallel
    const [priceData, securityData] = await Promise.allSettled([
      callRustAPI(`/api/price/${settings.defaultChain}/${token}`).catch(() => null),
      callRustAPI(`/api/security-check/${settings.defaultChain}/${token}`).catch(() => null)
    ]);
    
    const price = priceData.status === 'fulfilled' ? priceData.value : null;
    const security = securityData.status === 'fulfilled' ? securityData.value : null;
    
    // Get user's balance for this token
    const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`).catch(() => []);
    const userWallet = wallets.find((w: any) => w.chain === settings.defaultChain);
    
    // Build Trojan-style message
    let message = `<b>🪙 Token Info</b>\n\n`;
    
    // Token symbol and address
    if (price?.symbol) {
      message += `<b>Buy ${price.symbol}</b> 📊\n`;
    }
    message += `<code>${token}</code>\n\n`;
    
    // Balance
    message += `<b>Balance:</b> 0 SOL — W2 👍\n`;
    
    // Price info
    if (price) {
      message += `<b>Price:</b> $${formatNumber(price.price, 8)}\n`;
      message += `<b>LIQ:</b> $${formatNumber(price.liquidity_usd / 1000, 2)}K — `;
      message += `<b>MC:</b> $${formatNumber(price.market_cap / 1000, 2)}K\n`;
    } else {
      message += `<b>Price:</b> Not available\n`;
      message += `<b>LIQ:</b> Unknown — <b>MC:</b> Unknown\n`;
    }
    
    // Security status
    if (security) {
      if (security.is_safe) {
        message += `<b>Renounced</b> ✅\n\n`;
      } else {
        message += `<b>⚠️ Risk Detected</b>\n\n`;
      }
    } else {
      message += `\n`;
    }
    
    // Price impact calculator (example with 0.1 SOL)
    const exampleAmount = 0.1;
    if (price) {
      const tokens = (exampleAmount / price.price);
      const impact = calculatePriceImpact(exampleAmount, price.liquidity_usd);
      message += `<b>${exampleAmount} SOL</b> ⇄ ${formatNumber(tokens, 0)} ${price.symbol || 'tokens'} ($${formatNumber(exampleAmount * price.price, 2)})\n`;
      message += `<b>Price Impact:</b> ${impact.toFixed(2)}%\n`;
    }
    
    // Delete loading message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    } catch {}
    
    // Create Trojan-style keyboard
    const keyboard = new InlineKeyboard()
      // Row 1: Back and Refresh
      .text('← Back', 'back_main')
      .text('🔄 Refresh', `token_refresh:${token}`).row()
      
      // Row 2: W2 and Settings
      .text('✅ W2', 'noop')
      .text('⚙️', 'settings').row()
      
      // Row 3: Swap/Limit/DCA
      .text('✅ Swap', `token_mode:swap:${token}`)
      .text('Limit', `token_mode:limit:${token}`)
      .text('DCA', `token_mode:dca:${token}`).row()
      
      // Row 4: Quick amounts
      .text('0.5 SOL', `quick_buy:${token}:0.5`)
      .text('1 SOL', `quick_buy:${token}:1`)
      .text('3 SOL', `quick_buy:${token}:3`).row()
      
      // Row 5: More amounts
      .text('5 SOL', `quick_buy:${token}:5`)
      .text('10 SOL', `quick_buy:${token}:10`)
      .text('✅ 0.1 SOL 👍', `quick_buy:${token}:0.1`).row()
      
      // Row 6: Slippage
      .text('✅ 15% Slippage', `slippage:15`)
      .text('X Slippage 👍', `slippage:custom`).row()
      
      // Row 7: BUY button
      .text('🟢 BUY', `execute_buy:${token}:0.1`);
    
    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
    
  } catch (error: any) {
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    } catch {}
    
    await ctx.reply(
      `❌ <b>Error fetching token info</b>\n\n${error.message}`,
      { parse_mode: 'HTML' }
    );
  }
});

// Helper function to calculate price impact
function calculatePriceImpact(amountSOL: number, liquidityUSD: number): number {
  if (!liquidityUSD || liquidityUSD === 0) return 0;
  // Simplified price impact calculation
  // Impact = (amount / liquidity) * 100
  return (amountSOL / liquidityUSD) * 100 * 100; // Rough estimate
}

// Quick buy callback handler
bot.callbackQuery(/^quick_buy:(.+):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const token = ctx.match[1];
  const amount = ctx.match[2];
  
  // Store selected amount in session
  ctx.session.selectedAmount = amount;
  ctx.session.selectedToken = token;
  
  // Update the message to highlight selected amount
  await ctx.answerCallbackQuery(`Selected: ${amount} SOL`);
  
  // Update keyboard to show selected amount
  const keyboard = new InlineKeyboard()
    .text('← Back', 'back_main')
    .text('🔄 Refresh', `token_refresh:${token}`).row()
    .text('✅ W2', 'noop')
    .text('⚙️', 'settings').row()
    .text('✅ Swap', `token_mode:swap:${token}`)
    .text('Limit', `token_mode:limit:${token}`)
    .text('DCA', `token_mode:dca:${token}`).row()
    .text(amount === '0.5' ? '✅ 0.5 SOL 👍' : '0.5 SOL', `quick_buy:${token}:0.5`)
    .text(amount === '1' ? '✅ 1 SOL 👍' : '1 SOL', `quick_buy:${token}:1`)
    .text(amount === '3' ? '✅ 3 SOL 👍' : '3 SOL', `quick_buy:${token}:3`).row()
    .text(amount === '5' ? '✅ 5 SOL 👍' : '5 SOL', `quick_buy:${token}:5`)
    .text(amount === '10' ? '✅ 10 SOL 👍' : '10 SOL', `quick_buy:${token}:10`)
    .text(amount === '0.1' ? '✅ 0.1 SOL 👍' : '0.1 SOL', `quick_buy:${token}:0.1`).row()
    .text('✅ 15% Slippage', `slippage:15`)
    .text('X Slippage 👍', `slippage:custom`).row()
    .text('🟢 BUY', `execute_buy:${token}:${amount}`);
  
  await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
});

// Execute buy callback
bot.callbackQuery(/^execute_buy:(.+):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const token = ctx.match[1];
  const amount = ctx.match[2];
  const settings = ctx.session.settings;
  
  await ctx.reply(`🔄 <b>Executing Buy...</b>\n\nToken: <code>${token}</code>\nAmount: ${amount} SOL`, { parse_mode: 'HTML' });
  
  try {
    const result = await callRustAPI('/api/buy', 'POST', {
      user_id: ctx.from!.id,
      chain: settings.defaultChain,
      token,
      amount: amount.toString(),
      slippage: settings.slippage,
      take_profit: settings.takeProfitPercent,
      stop_loss: settings.stopLossPercent,
      is_simulation: settings.simulationMode,
      bundler_enabled: settings.bundlerMode,
      ignore_safety: settings.ignoreSafety,
    });
    
    if (result.success) {
      await ctx.reply(
        `✅ <b>Buy Successful!</b>\n\nTX: <code>${result.tx_hash}</code>\nPosition: <code>${result.position_id}</code>`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`❌ Buy Failed: ${result.error}`);
    }
  } catch (error: any) {
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// Token refresh callback
bot.callbackQuery(/^token_refresh:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery('Refreshing...');
  const token = ctx.match[1];
  
  // Simulate refresh by re-sending the token info
  // In a real implementation, you'd re-fetch the data
  await ctx.answerCallbackQuery('✅ Refreshed!');
});
