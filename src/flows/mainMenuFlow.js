'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const { formatMainMenu } = require('../utils/formatters');

async function show(phone, user) {
  sessionManager.setSession(phone, {
    flow: FLOWS.MAIN_MENU,
    step: STEPS.MENU_AWAITING,
    data: {},
  });

  const name = user ? user.Name : 'there';
  await waClient.sendText(phone, formatMainMenu(name));
}

async function handle(phone, text, session, user) {
  const t = text.trim();

  // Fetch fresh user if not passed
  if (!user) user = userService.getUserByPhone(phone);

  switch (t) {
    case '1':
      return require('./offerRideFlow').start(phone);
    case '2':
      return require('./findRideFlow').start(phone);
    case '3':
      return require('./myRidesFlow').start(phone, user);
    case '4':
      // Help — stay on main menu
      return waClient.sendText(phone,
        '🆘 *Help*\n\n' +
        'Reply *1* — Offer a ride (you\'re the driver)\n' +
        'Reply *2* — Find and book a ride\n' +
        'Reply *3* — See your rides & bookings\n' +
        'Reply *Menu* — Return to this menu\n' +
        'Reply *Restart* — Cancel and start over\n\n' +
        'Reply *1*, *2*, *3*, or *4* to continue.'
      );
    default:
      return waClient.sendText(phone,
        'Please reply with *1*, *2*, *3*, or *4*.\n\n' + formatMainMenu(user ? user.Name : 'there')
      );
  }
}

module.exports = { show, handle };
