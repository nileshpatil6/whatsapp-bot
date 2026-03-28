'use strict';

const axios = require('axios');

function getBaseUrl() {
  return `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function post(payload) {
  try {
    const response = await axios.post(getBaseUrl(), payload, { headers: getHeaders() });
    return { success: true, data: response.data };
  } catch (err) {
    const errData = err.response ? err.response.data : err.message;
    console.error('[WA Client] API error:', JSON.stringify(errData));
    return { success: false, error: errData };
  }
}

// Send a plain text message
async function sendText(to, text) {
  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  });
}

// Send a message with up to 3 quick-reply buttons
// buttons: [{ id: 'yes', title: 'Yes' }, { id: 'no', title: 'No' }]
async function sendButtons(to, bodyText, buttons) {
  const btns = buttons.slice(0, 3).map((b) => ({
    type: 'reply',
    reply: { id: b.id, title: b.title },
  }));

  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: { buttons: btns },
    },
  });
}

// Mark a message as read
async function markRead(messageId) {
  return post({
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}

module.exports = { sendText, sendButtons, markRead };
