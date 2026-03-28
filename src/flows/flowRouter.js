'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const { FLOWS } = require('../utils/constants');
const userService = require('../services/userService');

// Lazy-load flows to avoid circular dependency issues at startup
function getFlow(name) {
  switch (name) {
    case 'registration': return require('./registrationFlow');
    case 'mainMenu':     return require('./mainMenuFlow');
    case 'offerRide':    return require('./offerRideFlow');
    case 'findRide':     return require('./findRideFlow');
    case 'booking':      return require('./bookingFlow');
    case 'myRides':      return require('./myRidesFlow');
    default: throw new Error(`Unknown flow: ${name}`);
  }
}

const GLOBAL_RESTART_COMMANDS = new Set(['restart', 'reset', 'cancel', '/restart', '/reset']);
const GLOBAL_MENU_COMMANDS = new Set(['hi', 'hello', 'start', 'menu', '/menu', 'hii', 'hey']);
const GLOBAL_HELP_COMMANDS = new Set(['help', '/help', '4']);

async function route(phone, text) {
  const normalized = text.trim().toLowerCase();

  // Global restart — always works regardless of state
  if (GLOBAL_RESTART_COMMANDS.has(normalized)) {
    sessionManager.clearSession(phone);
    await waClient.sendText(phone,
      'Session reset. Send *Hi* to start fresh. 🚗'
    );
    return;
  }

  // Global help
  if (GLOBAL_HELP_COMMANDS.has(normalized)) {
    await waClient.sendText(phone, getHelpText());
    return;
  }

  // Check if user is registered
  const user = userService.getUserByPhone(phone);

  // Global menu/greeting commands
  if (GLOBAL_MENU_COMMANDS.has(normalized)) {
    if (!user || !user.IsVerified) {
      // New user — start registration
      return getFlow('registration').start(phone);
    } else {
      // Returning user — show main menu
      return getFlow('mainMenu').show(phone, user);
    }
  }

  // Get or create session
  let session = sessionManager.getSession(phone);

  // No session and no greeting → guide user
  if (!session) {
    if (!user || !user.IsVerified) {
      return getFlow('registration').start(phone);
    } else {
      return getFlow('mainMenu').show(phone, user);
    }
  }

  // Dispatch to the correct flow handler
  switch (session.flow) {
    case FLOWS.IDLE:
      if (!user || !user.IsVerified) {
        return getFlow('registration').start(phone);
      }
      return getFlow('mainMenu').show(phone, user);

    case FLOWS.REGISTRATION:
      return getFlow('registration').handle(phone, text, session);

    case FLOWS.MAIN_MENU:
      return getFlow('mainMenu').handle(phone, text, session, user);

    case FLOWS.OFFER_RIDE:
      return getFlow('offerRide').handle(phone, text, session);

    case FLOWS.FIND_RIDE:
      return getFlow('findRide').handle(phone, text, session);

    case FLOWS.VIEW_RESULTS:
      return getFlow('findRide').handleResults(phone, text, session);

    case FLOWS.BOOKING:
      return getFlow('booking').handle(phone, text, session);

    case FLOWS.MY_RIDES:
      return getFlow('myRides').handle(phone, text, session);

    default:
      sessionManager.clearSession(phone);
      await waClient.sendText(phone, 'Send *Hi* to get started. 🚗');
  }
}

async function sendUnsupportedTypeMessage(phone) {
  await waClient.sendText(phone,
    'I can only read text messages. Please type your response. 😊'
  );
}

function getHelpText() {
  return (
    '🚗 *ICICI RideShare Help*\n\n' +
    '*Available commands:*\n' +
    '• *Hi / Menu* — Go to main menu\n' +
    '• *1* — Offer a ride\n' +
    '• *2* — Find a ride\n' +
    '• *3* — My rides\n' +
    '• *Restart* — Cancel current action and start over\n\n' +
    '*How it works:*\n' +
    '1️⃣ Register once with your ICICI email\n' +
    '2️⃣ Drivers offer rides with seats & price\n' +
    '3️⃣ Travellers search & book available rides\n' +
    '4️⃣ Pay directly to driver (UPI/Cash)\n\n' +
    'Reply *Menu* to continue.'
  );
}

module.exports = { route, sendUnsupportedTypeMessage };
