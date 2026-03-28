'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const bookingService = require('../services/bookingService');
const userService = require('../services/userService');
const { FLOWS } = require('../utils/constants');
const { formatMyRides } = require('../utils/formatters');

async function start(phone, user) {
  if (!user) user = userService.getUserByPhone(phone);

  sessionManager.setSession(phone, { flow: FLOWS.MY_RIDES, data: {} });

  const offeredRides = rideService.getRidesByDriver(user.UserID);
  const bookings = bookingService.getBookingsByUser(user.UserID);

  await waClient.sendText(phone, formatMyRides(offeredRides, bookings));
}

async function handle(phone, text, session) {
  // My Rides is a single display — any reply goes back to menu
  const user = userService.getUserByPhone(phone);
  sessionManager.clearSession(phone);
  return require('./mainMenuFlow').show(phone, user);
}

module.exports = { start, handle };
