'use strict';

const { Telegraf } = require('telegraf');

let bot = null;

function getBot() {
  if (!bot) throw new Error('Telegram bot not initialized. Call initBot() first.');
  return bot;
}

async function initBot(token) {
  bot = new Telegraf(token);

  // Lazy-require to avoid circular deps — flows → client → bot
  const { route, routeLocation, sendUnsupportedTypeMessage } = require('../flows/flowRouter');

  // Plain text messages & bot commands
  bot.on('text', async (ctx) => {
    try {
      const chatId = String(ctx.chat.id);
      await route(chatId, ctx.message.text);
    } catch (e) {
      console.error('[Bot] text handler error:', e.message);
    }
  });

  // Inline keyboard button taps → callback_data fed back as "text"
  bot.on('callback_query', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const chatId = String(ctx.callbackQuery.message.chat.id);
      await route(chatId, ctx.callbackQuery.data);
    } catch (e) {
      console.error('[Bot] callback_query error:', e.message);
    }
  });

  // Location shared via "Share Location" button or attachment
  bot.on('location', async (ctx) => {
    const chatId = String(ctx.chat.id);
    try {
      const { latitude, longitude } = ctx.message.location;
      await routeLocation(chatId, {
        lat:    latitude,
        lng:    longitude,
        name:   null,
        address: null,
        isLive: !!ctx.message.live_period,
      });
    } catch (e) {
      console.error('[Bot] location error:', e.message);
      try {
        await require('../whatsapp/client').sendText(chatId,
          '❌ Error processing your location. Please try typing your area name instead.'
        );
      } catch (_) {}
    }
  });

  // Unsupported types (photos, stickers, etc.) — explicitly skip types handled above
  bot.on('message', async (ctx) => {
    if (ctx.message?.text || ctx.message?.location) return;
    try {
      const chatId = String(ctx.chat.id);
      await sendUnsupportedTypeMessage(chatId);
    } catch (_) {}
  });

  // Register bot commands (shows up in the menu inside Telegram)
  await bot.telegram.setMyCommands([
    { command: 'start',    description: 'Main Menu' },
    { command: 'offer',    description: 'Offer a ride' },
    { command: 'find',     description: 'Find a ride' },
    { command: 'bookings', description: 'My bookings & rides' },
    { command: 'help',     description: 'Help' },
    { command: 'cancel',   description: 'Cancel current action' },
    { command: 'feedback', description: 'Leave feedback' },
  ]).catch(e => console.warn('[Bot] setMyCommands failed:', e.message));

  console.log('[Bot] Telegram bot initialized.');
  return bot;
}

module.exports = { getBot, initBot };
