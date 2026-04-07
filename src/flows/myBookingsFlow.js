'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const bookingService = require('../services/bookingService');
const userService = require('../services/userService');
const rideService = require('../services/rideService');
const { FLOWS, STEPS } = require('../utils/constants');
const { formatMyBookings, formatDepartureTime } = require('../utils/formatters');

async function start(phone, user) {
  if (!user) user = userService.getUserByPhone(phone);

  const bookings = bookingService.getBookingsByUser(user.UserID);
  const offeredRides = rideService.getRidesByDriver(user.UserID);

  sessionManager.setSession(phone, {
    flow: FLOWS.MY_BOOKINGS,
    step: STEPS.CANCEL_SELECT,
    data: { bookings },
  });

  // Show bookings
  await waClient.sendText(phone, formatMyBookings(bookings));

  // Show offered rides if any
  if (offeredRides.length > 0) {
    let msg = '🚗 *Rides You Offered (as Driver):*\n\n';
    offeredRides.slice(0, 5).forEach((ride, i) => {
      const status = ride.Status === 'active' ? '🟢 Active' : ride.Status === 'full' ? '🔴 Full' : '⚫ ' + ride.Status;
      msg += `${i + 1}. ${ride.PickupLocation} → ${ride.Destination}\n   ${formatDepartureTime(ride.DepartureTime)} | ${ride.TotalSeats - ride.BookedSeats}/${ride.TotalSeats} seats | ${status}\n\n`;
    });
    await waClient.sendText(phone, msg.trim());
  }

  await waClient.sendText(phone,
    '_Reply the booking number to *cancel* it, or reply *Menu* to go back._'
  );
}

async function handle(phone, text, session) {
  const t = text.trim().toLowerCase();

  if (t === 'menu' || t === 'back') {
    sessionManager.clearSession(phone);
    const user = userService.getUserByPhone(phone);
    return require('./mainMenuFlow').show(phone, user);
  }

  const { bookings } = session.data;
  const idx = parseInt(text.trim(), 10);

  if (!isNaN(idx) && idx >= 1 && idx <= bookings.length) {
    const booking = bookings[idx - 1];

    sessionManager.setSession(phone, {
      step: STEPS.CANCEL_CONFIRM,
      data: { cancelBookingId: booking.BookingID, cancelBookingText: `${booking.PickupLocation} → ${booking.Destination}` },
    });

    return waClient.sendButtons(phone,
      `⚠️ *Cancel Booking #${booking.BookingID}?*\n\n` +
      `Route: ${booking.PickupLocation} → ${booking.Destination}\n` +
      `Time: ${formatDepartureTime(booking.DepartureTime)}\n\n` +
      '_Please cancel at least 30 minutes before departure.\nRepeated cancellations may affect your account._',
      [
        { id: 'cancel_yes', title: '⚠️ Yes, Cancel' },
        { id: 'cancel_no', title: '← Keep Booking' },
      ]
    );
  }

  if (session.step === STEPS.CANCEL_CONFIRM) {
    if (['cancel_yes', 'yes', '⚠️ yes, cancel'].includes(t)) {
      bookingService.cancelBooking(session.data.cancelBookingId);
      sessionManager.clearSession(phone);
      await waClient.sendText(phone,
        `✅ Booking #${session.data.cancelBookingId} cancelled.\n\n_${session.data.cancelBookingText}_\n\nReply *Menu* to go back.`
      );
      return;
    }
    sessionManager.setSession(phone, { step: STEPS.CANCEL_SELECT });
    await waClient.sendText(phone, '↩️ Cancellation aborted. Booking kept.\n\nReply *Menu* to go back.');
    return;
  }

  await waClient.sendText(phone,
    'Reply the *booking number* to cancel, or *Menu* to go back.'
  );
}

module.exports = { start, handle };
