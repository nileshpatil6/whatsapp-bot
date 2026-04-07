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
  await waClient.sendText(phone, formatMainMenu(user ? user.Name : 'there'));
}

async function handle(phone, text, session, user) {
  if (!user) user = userService.getUserByPhone(phone);
  const t = text.trim().toLowerCase();

  switch (t) {
    case '1': case 'offer': case 'offer ride':
      return require('./offerRideFlow').start(phone, user);
    case '2': case 'find': case 'find ride': case 'search':
      return require('./findRideFlow').start(phone, user);
    case '3': case 'my bookings': case 'bookings': case 'my rides':
      return require('./myBookingsFlow').start(phone, user);
    case '4': case 'help':
      return require('./flowRouter').sendHelp(phone);
    default:
      return waClient.sendText(phone,
        'Please reply with *1*, *2*, *3*, or *4*.\n\n' + formatMainMenu(user ? user.Name : 'there')
      );
  }
}

module.exports = { show, handle };
