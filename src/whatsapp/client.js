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

// Send a list-picker message (up to 10 rows across all sections)
// sections: [{ title: '...', rows: [{ id, title, description }] }]
async function sendList(to, bodyText, buttonTitle, sections) {
  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonTitle.slice(0, 20),
        sections: sections.map((s) => ({
          title: s.title ? s.title.slice(0, 24) : undefined,
          rows: s.rows,
        })),
      },
    },
  });
}

// Send a location pin message (bot → user or bot → driver)
async function sendLocation(to, lat, lng, name, address) {
  const location = { latitude: lat, longitude: lng };
  if (name)    location.name    = name;
  if (address) location.address = address;
  return post({
    messaging_product: 'whatsapp',
    to,
    type: 'location',
    location,
  });
}

// Request a location from the user via the native WhatsApp "Send Location" button.
// Falls back to a plain-text prompt if the API doesn't support it.
async function sendLocationRequest(to, bodyText) {
  const result = await post({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'location_request_message',
      body: { text: bodyText },
      action: { name: 'send_location' },
    },
  });
  if (!result.success) {
    // Fallback: plain text with instructions
    return sendText(
      to,
      bodyText +
      '\n\n📎 *How to share:*\nTap the attachment (📎) icon → *Location* → search for your area or tap *Send Your Current Location*.\n\n_You can also type your area name as text._'
    );
  }
  return result;
}

// Mark a message as read
async function markRead(messageId) {
  return post({
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}

module.exports = { sendText, sendButtons, sendList, sendLocation, sendLocationRequest, markRead };
