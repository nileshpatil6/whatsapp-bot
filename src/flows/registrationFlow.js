'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const { isValidName, isValidPhone } = require('../utils/validators');
const { formatDisclaimer } = require('../utils/formatters');

async function start(phone) {
  sessionManager.setSession(phone, {
    flow: FLOWS.REGISTRATION,
    step: STEPS.REG_ASK_NAME,
    data: {},
  });

  await waClient.sendText(phone,
    '👋 Welcome to *Loopz* 🚗\n\n' +
    'A smarter way for employees to commute.\n\n' +
    '• Save on daily travel costs\n' +
    '• Share rides with colleagues nearby\n' +
    '• Earn by offering empty seats\n\n' +
    'Simple. Safe. Efficient.\n\n' +
    "Let's get you started 👇\nWhat is your *full name*?"
  );
}

async function handle(phone, text, session) {
  if (session.step === STEPS.REG_ASK_NAME)  return handleName(phone, text, session);
  if (session.step === STEPS.REG_ASK_PHONE) return handlePhone(phone, text, session);
  return start(phone);
}

async function handleContact(phone, contactPhone, session) {
  return savePhone(phone, contactPhone, session);
}

async function handleName(phone, text, session) {
  if (!isValidName(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid name (letters only, e.g. *Rahul Sharma*).\n\nWhat is your *full name*?'
    );
  }

  const name = text.trim();
  sessionManager.setSession(phone, {
    step: STEPS.REG_ASK_PHONE,
    data: { name },
  });

  return waClient.sendContactRequest(phone,
    `✅ Got it, *${name}*!\n\n` +
    '📱 *What is your phone number?*\n\n' +
    'Tap *Share My Phone Number* or type it manually.\n' +
    '_This is shared with your ride partner so they can contact you._'
  );
}

async function handlePhone(phone, text, session) {
  const cleaned = text.trim().replace(/\s+/g, '');
  if (!isValidPhone(cleaned)) {
    return waClient.sendContactRequest(phone,
      '❌ Please enter a valid phone number (10–15 digits).\n\n📱 *Your phone number:*'
    );
  }
  return savePhone(phone, cleaned, session);
}

async function savePhone(phone, contactPhone, session) {
  const { name } = session.data;
  const user = userService.createUser({ phone, name, contactPhone });

  sessionManager.clearSession(phone);
  console.log(`[Registration] ✅ New user: ${name} (${phone}) contact: ${contactPhone}`);

  await waClient.sendText(phone, formatDisclaimer());
  userService.markDisclaimerSeen(phone);

  return require('./mainMenuFlow').show(phone, user);
}

module.exports = { start, handle, handleContact };
