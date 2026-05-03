'use strict';

// Telegram client — same interface as the old WhatsApp client so all flows work unchanged.
// Uses the Telegraf bot singleton from src/telegram/bot.js.

const { getBot } = require('../telegram/bot');

// ── helpers ────────────────────────────────────────────────────────────────────

// Build a 2-column inline keyboard from a flat button list
function buildKeyboard(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const row = [{ text: buttons[i].title, callback_data: buttons[i].id }];
    if (buttons[i + 1]) {
      row.push({ text: buttons[i + 1].title, callback_data: buttons[i + 1].id });
    }
    rows.push(row);
  }
  return rows;
}

// Escape characters that break Telegram Markdown (MarkdownV1 only needs minimal escaping)
function safe(text) {
  return String(text || '');
}

async function tgSend(chatId, text, extra = {}) {
  try {
    await getBot().telegram.sendMessage(chatId, safe(text), {
      parse_mode: 'Markdown',
      ...extra,
    });
  } catch (err) {
    // If Markdown parse fails, retry as plain text
    if (err.description && err.description.includes('parse')) {
      await getBot().telegram.sendMessage(chatId, safe(text), extra).catch(() => {});
    } else {
      console.error('[TG Client] sendMessage error:', err.message);
    }
  }
}

// ── Public API (matches old WhatsApp client exactly) ──────────────────────────

// Plain text message — also removes any lingering "Share Location" keyboard
async function sendText(chatId, text) {
  return tgSend(chatId, text, {
    reply_markup: { remove_keyboard: true },
  });
}

// Message with inline keyboard buttons (up to any count, 2 per row)
// buttons: [{ id: 'btn_id', title: 'Button Label' }]
async function sendButtons(chatId, text, buttons) {
  return tgSend(chatId, text, {
    reply_markup: { inline_keyboard: buildKeyboard(buttons) },
  });
}

// List picker — becomes a rich formatted message + inline keyboard
// sections: [{ title: 'Section', rows: [{ id, title, description }] }]
async function sendList(chatId, bodyText, _buttonLabel, sections) {
  let formattedBody = bodyText + '\n';
  const keyboard = [];
  let globalIdx = 1;

  for (const section of sections) {
    if (section.title) formattedBody += `\n*${section.title}*\n`;
    for (const row of section.rows) {
      const desc = row.description ? `  _${row.description}_` : '';
      formattedBody += `\n${globalIdx}. *${row.title}*${desc}`;
      // Button shows only the title — no redundant "N." prefix since body already numbers them
      const btnLabel = row.title.length <= 40 ? row.title : row.title.slice(0, 39) + '…';
      keyboard.push([{ text: btnLabel, callback_data: row.id.slice(0, 64) }]);
      globalIdx++;
    }
  }

  return tgSend(chatId, formattedBody, {
    reply_markup: { inline_keyboard: keyboard },
  });
}

// Send a map pin (location message)
async function sendLocation(chatId, lat, lng, name, address) {
  try {
    await getBot().telegram.sendLocation(chatId, lat, lng);
    if (name || address) {
      const label = [name, address].filter(Boolean).join('\n');
      await tgSend(chatId, `📍 ${label}`);
    }
  } catch (e) {
    console.error('[TG Client] sendLocation error:', e.message);
  }
}

// Ask user to share their phone number via Telegram contact button or type it
async function sendContactRequest(chatId, text) {
  return tgSend(chatId, text, {
    reply_markup: {
      keyboard: [[{ text: '📱 Share My Phone Number', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

// Prompt user to type a location name or share via attachment menu
async function sendLocationRequest(chatId, text) {
  return tgSend(chatId, text + '\n\n_💡 To pin a specific place: tap 📎 → Location → search on the map_', {
    reply_markup: { remove_keyboard: true },
  });
}

// Stub — no mark-read concept in Telegram
async function markRead() {}

async function sendUnsupportedTypeMessage(chatId) {
  return sendText(chatId, 'Please use text or tap a button to respond. 😊');
}

module.exports = {
  sendText, sendButtons, sendList,
  sendLocation, sendLocationRequest, sendContactRequest,
  markRead, sendUnsupportedTypeMessage,
};
