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
    '👋 *Welcome to Loopz!* 🚗\n\n' +
    '_Smart ride sharing for daily office commute._\n\n' +
    "What is your *full name*?"
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

  await waClient.sendText(phone,
    `🎉 *You're all set, ${name}!*\n\n` +
    '_Your name is saved. You can start right away!_\n\n' +
    '📄 Reply *privacy* anytime to read our Privacy Policy.'
  );

  return require('./mainMenuFlow').show(phone, user);
}

module.exports = { start, handle };
