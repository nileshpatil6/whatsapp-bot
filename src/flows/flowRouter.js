'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const { FLOWS } = require('../utils/constants');
const userService = require('../services/userService');
const { formatHelpText } = require('../utils/formatters');

function getFlow(name) {
  switch (name) {
    case 'registration': return require('./registrationFlow');
    case 'mainMenu':     return require('./mainMenuFlow');
    case 'offerRide':    return require('./offerRideFlow');
    case 'findRide':     return require('./findRideFlow');
    case 'booking':      return require('./bookingFlow');
    case 'myBookings':   return require('./myBookingsFlow');
    default: throw new Error(`Unknown flow: ${name}`);
  }
}

const RESTART_CMDS  = new Set(['restart', 'reset', '/restart', '/reset']);
const MENU_CMDS     = new Set(['hi', 'hello', 'start', 'menu', '/menu', 'hii', 'hey', 'home']);
const HELP_CMDS     = new Set(['help', '/help']);
const OFFER_CMDS    = new Set(['offer', '/offer', 'offer ride']);
const FIND_CMDS     = new Set(['find', '/find', 'find ride', 'search', '/search']);
const BOOKINGS_CMDS = new Set(['bookings', 'my bookings', '/mybookings', 'my rides', '/myridesr']);
const CANCEL_CMDS   = new Set(['cancel', '/cancel']);

async function route(phone, text) {
  const norm = text.trim().toLowerCase();

  // --- Global: restart ---
  if (RESTART_CMDS.has(norm)) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone, '🔄 Session reset. Send *Hi* to start fresh. 🚗');
  }

  // --- Global: help ---
  if (HELP_CMDS.has(norm)) {
    return sendHelp(phone);
  }

  const user = userService.getUserByPhone(phone);
  const session = sessionManager.getSession(phone);

  // --- Global shortcut: cancel (must be registered) ---
  if (CANCEL_CMDS.has(norm) && user) {
    sessionManager.clearSession(phone);
    return getFlow('myBookings').start(phone, user);
  }

  // --- Global: menu/greeting ---
  if (MENU_CMDS.has(norm)) {
    if (!user || !user.IsVerified) return getFlow('registration').start(phone);
    return getFlow('mainMenu').show(phone, user);
  }

  // --- Global shortcuts for registered users ---
  if (user && user.IsVerified) {
    if (OFFER_CMDS.has(norm)) {
      sessionManager.clearSession(phone);
      return getFlow('offerRide').start(phone, user);
    }
    if (FIND_CMDS.has(norm)) {
      sessionManager.clearSession(phone);
      return getFlow('findRide').start(phone, user);
    }
    if (BOOKINGS_CMDS.has(norm)) {
      sessionManager.clearSession(phone);
      return getFlow('myBookings').start(phone, user);
    }
  }

  // --- No session → route to registration or menu ---
  if (!session) {
    if (!user || !user.IsVerified) return getFlow('registration').start(phone);
    return getFlow('mainMenu').show(phone, user);
  }

  // --- Dispatch to current flow ---
  try {
    switch (session.flow) {
      case FLOWS.IDLE:
        if (!user || !user.IsVerified) return getFlow('registration').start(phone);
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

      case FLOWS.RECURRING:
        return getFlow('booking').handleRecurring(phone, text, session);

      case FLOWS.MY_BOOKINGS:
        return getFlow('myBookings').handle(phone, text, session);

      default:
        sessionManager.clearSession(phone);
        return waClient.sendText(phone, 'Send *Hi* to get started. 🚗');
    }
  } catch (err) {
    console.error(`[Router] Error for ${phone}:`, err);
    await waClient.sendText(phone,
      '⚠️ Something went wrong. Reply *Menu* to start over or *Restart* to reset.'
    );
  }
}

async function sendHelp(phone) {
  await waClient.sendText(phone, formatHelpText());
}

async function sendUnsupportedTypeMessage(phone) {
  await waClient.sendText(phone, 'I can only read text messages. Please type your response. 😊');
}

module.exports = { route, sendHelp, sendUnsupportedTypeMessage };
