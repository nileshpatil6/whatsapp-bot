'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const { isValidName } = require('../utils/validators');
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
  if (session.step === STEPS.REG_ASK_NAME) return handleName(phone, text);
  return start(phone);
}

async function handleName(phone, text) {
  if (!isValidName(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid name (letters only, e.g. *Rahul Sharma*).\n\nWhat is your *full name*?'
    );
  }

  const name = text.trim();
  const user = userService.createUser({ phone, name });

  sessionManager.clearSession(phone);
  console.log(`[Registration] ✅ New user: ${name} (${phone})`);

  await waClient.sendText(phone, formatDisclaimer());
  userService.markDisclaimerSeen(phone);

  return require('./mainMenuFlow').show(phone, user);
}

module.exports = { start, handle };
