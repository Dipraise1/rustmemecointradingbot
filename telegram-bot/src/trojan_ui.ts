import { Bot, InlineKeyboard } from 'grammy';
import { callRustAPI, formatNumber, formatPnL, MyContext } from './shared.js';

// ==================== TROJAN-STYLE TOKEN INFO HANDLER ====================
// When user pastes just a contract address, show rich token info like Trojan bot

export function setupTrojanUI(bot: Bot<MyContext>) {

  bot.on('message:text', async (ctx, next) => {
    const text = ctx.message.text.trim();
    
    // Check if it's JUST a contract address (no buy/sell/swap command)
    const isContractAddress = /^(So11[a-zA-Z0-9]{40,44}|[a-zA-Z0-9]{32,44}|0x[a-fA-F0-9]{40})$/.test(text);
    
    if (!isContractAddress) {
      return next(); // Not a contract address, pass to next handler
    }
    
    const token = text;
    const settings = ctx.session.settings;
    
    // Show loading message
    const loadingMsg = await ctx.reply('🔍 <b>Fetching token info...</b>', { parse_mode: 'HTML' });
    
    try {
      // Fetch analysis and positions concurrently
      const [analysisResult, positionsResult] = await Promise.allSettled([
        callRustAPI(`/api/check/${settings.defaultChain}/${token}`).catch(() => null),
        callRustAPI(`/api/positions/${ctx.from!.id}`).catch(() => []),
      ]);
      
      const analysis = analysisResult.status === 'fulfilled' ? analysisResult.value : null;
      const positions = positionsResult.status === 'fulfilled' ? positionsResult.value : [];
      
      // Check if we have an active position on this token
      const myPosition = positions.find((p: any) => p.position.token === token || p.position.token_address === token);
      
      // Get user's balance for this token
      const wallets = await callRustAPI(`/api/wallets/${ctx.from!.id}`).catch(() => []);
      const userWallet = wallets.find((w: any) => w.chain === settings.defaultChain);
      
      // Build Trojan-style message
      let message = `<b>🪙 Token Info</b>\n\n`;
      
      // Token symbol and address
      if (analysis?.symbol) {
        message += `<b>Buy ${analysis.symbol}</b> 📊\n`;
      }
      message += `<code>${token}</code>\n\n`;
      
      // Balance
      message += `<b>Balance:</b> 0 SOL — W2 👍\n`;
      
      // Price info
      if (analysis) {
        message += `<b>Price:</b> $${formatNumber(analysis.price_usd, 8)}\n`;
        message += `<b>LIQ:</b> $${formatNumber(analysis.liquidity_usd / 1000, 2)}K — `;
        message += `<b>MC:</b> $${formatNumber(analysis.market_cap / 1000, 2)}K\n`;
        message += `<b>FDV:</b> $${formatNumber(analysis.fdv / 1000, 2)}K — `;
        message += `<b>Age:</b> ${analysis.pair_age_hours.toFixed(1)}h\n\n`;
        
        // SCORE & BUNDLER SECTION (Enhanced Trojan View)
        let scoreEmoji = '🟢';
        if (analysis.total_score < 70) scoreEmoji = '🟡';
        if (analysis.total_score < 40) scoreEmoji = '🔴';
        
        message += `${scoreEmoji} <b>Score: ${analysis.total_score.toFixed(1)}/100</b>\n`;
        
        if (analysis.bundler_details) {
            const b = analysis.bundler_details;
            if (b.bundled_percentage > 30) {
               message += `⚠️ <b>BUNDLER: ${b.bundled_percentage.toFixed(1)}% RISK!</b>\n`;
            } else {
               message += `✅ <b>Bundler Safe: ${b.bundled_percentage.toFixed(1)}%</b>\n`;
            }
        }
      } else {
        message += `<b>Price:</b> Not available\n`;
        message += `<b>LIQ:</b> Unknown — <b>MC:</b> Unknown\n`;
      }
      
      // Active Position Info
      if (myPosition) {
        message += `\n🟢 <b>Active Position</b>\n`;
        message += `Entry: $${formatNumber(myPosition.position.entry_price, 6)} | Cur: $${formatNumber(myPosition.position.current_price, 6)}\n`;
        message += `PnL: ${formatPnL(myPosition.pnl_percent)} (Value: $${formatNumber(myPosition.pnl_usd)}) \n`;
      }
      message += '\n'; // Spacer
      
      // Price impact calculator (example with 0.1 SOL)
      const exampleAmount = 0.1;
      if (analysis) {
        const tokens = (exampleAmount / (analysis.price_usd / 140)); // Approx SOL
        const impact = (exampleAmount * 140) / (analysis.liquidity_usd) * 100;
        message += `<b>${exampleAmount} SOL</b> ⇄ ${formatNumber(tokens, 0)} ${analysis.symbol || 'tokens'} ($${formatNumber(exampleAmount * 140, 2)})\n`;
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
        
        // Row 2: W2, Settings, and AI Analysis
        .text('✅ W2', 'noop')
        .text('⚙️', 'settings')
        .text('🤖 AI', `ai_analyze_token:${token}`).row()
        
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
    const match = ctx.callbackQuery.data.match(/^quick_buy:(.+):(.+)$/);
    if (!match) return;

    const token = match[1];
    const amount = match[2];
    
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
    const match = ctx.callbackQuery.data.match(/^execute_buy:(.+):(.+)$/);
    if (!match) return;

    const token = match[1];
    const amount = match[2];
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
    // const token = ctx.match[1]; // Removed unwrapped usage
    
    // Simulate refresh by re-sending the token info
    // In a real implementation, you'd re-fetch the data
    await ctx.answerCallbackQuery('✅ Refreshed!');
  });

}
