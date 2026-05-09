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
  const { route, routeLocation, routeContact, sendUnsupportedTypeMessage } = require('../flows/flowRouter');

  // Plain text messages & bot commands
  bot.on('text', async (ctx) => {
    // Skip inline-result messages — already handled by chosen_inline_result
    if (ctx.message.via_bot) return;
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

  // Contact shared (phone number via Share My Phone Number button)
  bot.on('contact', async (ctx) => {
    const chatId = String(ctx.chat.id);
    try {
      const phone = ctx.message.contact.phone_number;
      await routeContact(chatId, phone);
    } catch (e) {
      console.error('[Bot] contact error:', e.message);
    }
  });

  // Inline location search — triggered when user taps "Search Location" button
  bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    if (query.length < 2) {
      return ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
    }
    const { searchPlaces } = require('../services/mapsService');
    try {
      const places = await searchPlaces(query);
      if (!places.length) return ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });

      const results = places.map(p => {
        const nameSlice = p.name.slice(0, 43);
        const resultId = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}|${nameSlice}`;
        return {
          type: 'article',
          id: resultId,
          title: p.name,
          description: p.shortAddr || '',
          input_message_content: { message_text: `📍 ${p.name}` },
        };
      });

      return ctx.answerInlineQuery(results, { cache_time: 10, is_personal: true });
    } catch (e) {
      console.error('[Bot] inline_query error:', e.message);
      return ctx.answerInlineQuery([], { cache_time: 0 });
    }
  });

  // When user picks an inline result, route it as a location into the active flow
  bot.on('chosen_inline_result', async (ctx) => {
    const chatId = String(ctx.chosenInlineResult.from.id);
    const resultId = ctx.chosenInlineResult.result_id;
    try {
      const pipeIdx = resultId.indexOf('|');
      if (pipeIdx === -1) return;
      const [lat, lng] = resultId.slice(0, pipeIdx).split(',').map(Number);
      const name = resultId.slice(pipeIdx + 1);
      if (!isNaN(lat) && !isNaN(lng)) {
        await routeLocation(chatId, { lat, lng, name, address: null });
      }
    } catch (e) {
      console.error('[Bot] chosen_inline_result error:', e.message);
    }
  });

  // Unsupported types (photos, stickers, etc.) — explicitly skip types handled above
  bot.on('message', async (ctx) => {
    // Skip messages sent via inline mode — already handled by chosen_inline_result
    if (ctx.message?.via_bot) return;
    if (ctx.message?.text || ctx.message?.location || ctx.message?.contact) return;
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
    { command: 'terms',    description: 'Terms & Conditions / Privacy Policy' },
    { command: 'cancel',   description: 'Cancel current action' },
    { command: 'feedback', description: 'Leave feedback' },
  ]).catch(e => console.warn('[Bot] setMyCommands failed:', e.message));

  console.log('[Bot] Telegram bot initialized.');
  return bot;
}

module.exports = { getBot, initBot };
