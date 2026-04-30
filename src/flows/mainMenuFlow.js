'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');

async function show(phone, user) {
  sessionManager.setSession(phone, {
    flow: FLOWS.MAIN_MENU,
    step: STEPS.MENU_AWAITING,
    data: {},
  });

  const name = user ? user.Name : 'there';

  // sendText removes any lingering location keyboard
  await waClient.sendText(phone,
    `👋 *Hi ${name}!* Welcome to *Loopz* 🚗\n\n` +
    `_Smart ride sharing for daily office commute._`
  );

  return waClient.sendButtons(phone, 'What would you like to do?', [
    { id: 'menu_1', title: '🚗 Offer a Ride' },
    { id: 'menu_2', title: '🔍 Find a Ride' },
    { id: 'menu_3', title: '📋 My Bookings' },
    { id: 'menu_4', title: '❓ Help' },
  ]);
}

async function handle(phone, text, session, user) {
  if (!user) user = userService.getUserByPhone(phone);
  const t = text.trim().toLowerCase();

  switch (t) {
    case '1': case 'menu_1': case 'offer': case 'offer ride':
    case '1️⃣ offer a ride':
      return require('./offerRideFlow').start(phone, user);

    case '2': case 'menu_2': case 'find': case 'find ride': case 'search':
    case '2️⃣ find a ride':
      return require('./findRideFlow').start(phone, user);

    case '3': case 'menu_3': case 'my bookings': case 'bookings': case 'my rides':
    case '3️⃣ my bookings':
      return require('./myBookingsFlow').start(phone, user);

    case '4': case 'menu_4': case 'help':
    case '4️⃣ help':
      return require('./flowRouter').sendHelp(phone);

    default:
      return show(phone, user);
  }
}

module.exports = { show, handle };
