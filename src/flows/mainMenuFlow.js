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

  // Nudge users who haven't set their contact phone
  if (user && !user.ContactPhone) {
    await waClient.sendContactRequest(phone,
      `⚠️ *Contact number missing!*\n\n` +
      `Your phone number is shared with ride partners so they can coordinate with you.\n\n` +
      `Tap *Share Phone* below to add it — takes 1 second. 👇`
    );
  }

  // sendText removes any lingering location keyboard
  await waClient.sendText(phone,
    `👋 *Hi ${name}!* Welcome to *Loopz* 🚗\n\n` +
    `_Smart ride sharing for daily office commute._`
  );

  return waClient.sendButtons(phone, '👇 Choose an option:', [
    { id: 'menu_1',       title: '🚗 Offer a Ride' },
    { id: 'menu_2',       title: '🔍 Find a Ride' },
    { id: 'menu_3',       title: '📋 My Bookings' },
    { id: 'menu_profile', title: '👤 My Profile' },
    { id: 'menu_4',       title: '❓ Help' },
  ]);
}

async function handle(phone, text, session, user) {
  if (!user) user = userService.getUserByPhone(phone);
  const t = text.trim().toLowerCase();

  switch (t) {
    case 'menu_1': case 'offer': case 'offer ride':
      return require('./offerRideFlow').start(phone, user);

    case 'menu_2': case 'find': case 'find ride': case 'search':
      return require('./findRideFlow').start(phone, user);

    case 'menu_3': case 'my bookings': case 'bookings': case 'my rides':
      return require('./myBookingsFlow').start(phone, user);

    case 'menu_profile': case 'profile': case 'my profile':
      return require('./profileFlow').show(phone, user);

    case 'menu_4': case 'help':
      return require('./flowRouter').sendHelp(phone);

    case 'menu_terms': case 'terms': case 'privacy': case 't&c':
      return require('./flowRouter').sendTerms(phone);

    default:
      return show(phone, user);
  }
}

module.exports = { show, handle };
