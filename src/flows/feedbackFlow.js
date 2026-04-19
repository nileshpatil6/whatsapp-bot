'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const userService = require('../services/userService');
const feedbackService = require('../services/feedbackService');
const { FLOWS, STEPS } = require('../utils/constants');

async function start(phone, bookingId, role) {
  sessionManager.replaceSession(phone, {
    phone,
    flow: FLOWS.FEEDBACK,
    step: STEPS.FEEDBACK_AWAIT,
    data: { bookingId: bookingId || null, role: role || 'passenger' },
  });
  await waClient.sendText(phone,
    '💬 *Leave Feedback*\n\n' +
    'Your thoughts help us improve Loopz for everyone.\n\n' +
    'Type your message below:\n_(Reply *skip* to skip)_'
  );
}

async function handle(phone, text, session) {
  const t = text.trim().toLowerCase();
  const user = userService.getUserByPhone(phone);

  if (t === 'skip' || t === 'pf_menu') {
    sessionManager.clearSession(phone);
    return require('./mainMenuFlow').show(phone, user);
  }

  feedbackService.createFeedback({
    userId:    user ? user.UserID : null,
    bookingId: session.data.bookingId || null,
    message:   text.trim(),
    role:      session.data.role || 'passenger',
  });

  sessionManager.clearSession(phone);
  return waClient.sendButtons(phone,
    '✅ *Thank you for your feedback!* 🙏\n\nYour response has been recorded.',
    [{ id: 'pf_menu', title: '📋 Main Menu' }]
  );
}

module.exports = { start, handle };
