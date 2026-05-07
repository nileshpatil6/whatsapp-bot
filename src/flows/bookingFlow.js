'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const bookingService = require('../services/bookingService');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const {
  formatDriverNotification, formatDepartureTime,
} = require('../utils/formatters');

async function start(phone, ride, seatsNeeded) {
  const available = ride.TotalSeats - ride.BookedSeats;
  const seats = Math.min(seatsNeeded || 1, available);
  const total = seats * ride.PricePerSeat;
  const driver = userService.getUserById(ride.DriverID);
  const priceStr = total === 0 ? 'Free' : `₹${total}`;

  sessionManager.replaceSession(phone, {
    phone,
    flow: FLOWS.BOOKING,
    step: STEPS.BOOK_CONFIRM,
    data: { ride, seats, total },
  });

  await waClient.sendButtons(phone,
    `📋 *Booking Summary*\n\n` +
    `👤 Driver: ${driver ? driver.Name : 'Unknown'}\n` +
    `🗺️ Route: ${ride.PickupLocation} → ${ride.Destination}\n` +
    `🕐 Departure: ${formatDepartureTime(ride.DepartureTime)}\n` +
    `💺 Seats: ${seats}\n` +
    `💰 Total: ${priceStr}\n\n` +
    `_Payment directly to driver via UPI or Cash._\n\n` +
    `Confirm booking?`,
    [
      { id: 'book_yes', title: '✅ Confirm Booking' },
      { id: 'book_no', title: '❌ Cancel' },
    ]
  );
}

async function handle(phone, text, session) {
  const t = text.trim().toLowerCase();

  if (['book_no', 'no', 'cancel', '❌ cancel'].includes(t)) {
    sessionManager.clearSession(phone);
    const user = userService.getUserByPhone(phone);
    await waClient.sendText(phone, 'Booking cancelled.');
    return require('./mainMenuFlow').show(phone, user);
  }

  if (!['book_yes', 'yes', '✅ confirm booking'].includes(t)) {
    return waClient.sendButtons(phone, 'Please confirm your booking:',
      [
        { id: 'book_yes', title: '✅ Confirm Booking' },
        { id: 'book_no', title: '❌ Cancel' },
      ]
    );
  }

  const { ride, seats, total } = session.data;
  const passenger = userService.getUserByPhone(phone);

  // Atomic: increment seats first (concurrency guard)
  const changed = rideService.incrementBookedSeats(ride.RideID, seats);
  if (changed === 0) {
    sessionManager.clearSession(phone);
    return waClient.sendButtons(phone,
      '😔 Sorry, those seats were just taken by someone else.',
      [{ id: 'menu_2', title: '🔍 Find Another Ride' }]
    );
  }

  // Generate a 4-digit verification code for boarding confirmation
  const verificationCode = String(Math.floor(1000 + Math.random() * 9000));

  const booking = bookingService.createBooking({
    rideId: ride.RideID,
    userId: passenger.UserID,
    seatsBooked: seats,
    totalAmount: total,
    verificationCode,
  });

  const driver = userService.getUserById(ride.DriverID);
  const updatedRide = rideService.getRideById(ride.RideID);

  console.log(`[Booking] #${booking.BookingID} by ${passenger.Name} for ride #${ride.RideID}`);

  // 1. Brief ride confirmed
  await waClient.sendText(phone,
    `✅ *Ride Confirmed!* Booking #${booking.BookingID}\n` +
    `🗺️ ${ride.PickupLocation} → ${ride.Destination}\n` +
    `🕐 ${formatDepartureTime(ride.DepartureTime)} | 💺 ${seats} seat(s)`
  );

  // 2. Security check — full details + OTP revealed after user confirms
  await waClient.sendButtons(phone,
    `🔐 *Security Check*\n\n` +
    `Verify the driver is from your organisation before sharing the OTP.\n` +
    `If unsure, do not share.\n\n` +
    `_Loopz is for internal corporate use only._`,
    [{ id: `sec_confirm_${booking.BookingID}`, title: '✅ Confirm: loopmate is from my org' }]
  );

  // Set RECURRING session so sec_confirm_ handler can show recurring question after OTP
  sessionManager.replaceSession(phone, {
    phone,
    flow: FLOWS.RECURRING,
    step: STEPS.RECURRING_ASK,
    data: {
      bookingId:     booking.BookingID,
      rideId:        ride.RideID,
      driverPhone:   driver ? driver.Phone : null,
      driverName:    driver ? driver.Name  : null,
    },
  });

  // Set driver's ACTIVE_RIDE session NOW — before sending the notification —
  // so that when the driver receives the message and types the code, their
  // session is already in the right state to handle it.
  // (Skip if driver == passenger, e.g. during self-testing on the same phone)
  if (driver && driver.Phone !== phone) {
    sessionManager.replaceSession(driver.Phone, {
      phone: driver.Phone,
      flow:  FLOWS.ACTIVE_RIDE,
      step:  'ACTIVE_RIDE_SHARE',
      data: {
        passengerPhone: phone,
        passengerName:  passenger.Name,
        driverPhone:    driver.Phone,
        role:           'driver',
        rideId:         ride.RideID,   // pinned — code must match THIS ride
      },
    });
  }

  // Notify driver (fire and forget) — instruct driver to enter code from passenger
  if (driver) {
    waClient.sendText(driver.Phone,
      formatDriverNotification(booking, updatedRide, passenger) +
      '\n\n📱 *Reply with the passenger\'s 4-digit code to confirm boarding.*\n' +
      '_Ask the passenger to show you their Ride Code before you depart._'
    ).catch(err => console.error('[Booking] Driver notify failed:', err.message));
  }
}

async function handleRecurring(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { bookingId, driverPhone, driverName } = session.data;

  if (['rec_yes', 'yes', '🔁 yes, daily ride'].includes(t)) {
    getDb().prepare('UPDATE Bookings SET IsRecurring = 1 WHERE BookingID = ?').run(bookingId);
    await waClient.sendText(phone,
      '✅ *Recurring ride set!* 🔁\n\nYour ride will repeat *Mon–Fri* at the same time.\n\n' +
      'You can cancel anytime by replying *cancel*.'
    );
  } else {
    await waClient.sendText(phone, '✅ Got it! One-time booking confirmed.');
  }

  // Switch to ACTIVE_RIDE — user can share live location with driver through the bot
  const { FLOWS } = require('../utils/constants');
  const passenger = userService.getUserByPhone(phone);
  if (driverPhone) {
    sessionManager.replaceSession(phone, {
      phone,
      flow: FLOWS.ACTIVE_RIDE,
      step: 'ACTIVE_RIDE_SHARE',
      data: { driverPhone, driverName, passengerPhone: phone, passengerName: passenger.Name, role: 'passenger', bookingId },
    });
    await waClient.sendText(phone,
      '📍 *Location Sharing (Optional)*\n\n' +
      `To keep your driver *${driverName || 'your driver'}* updated on your location:\n\n` +
      '• Tap 📎 (attachment) → *Location* in this chat\n' +
      '• Share your current location or search for your spot\n\n' +
      'The bot will *automatically forward* your location to the driver. 🛡️\n\n' +
      'You can share location anytime before or during the ride.'
    );
    await waClient.sendButtons(phone,
      '🎉 *All set! Enjoy your ride.*\n\n_Share feedback or go back to the main menu._',
      [
        { id: 'pf_feedback', title: '💬 Leave Feedback' },
        { id: 'pf_menu',     title: '📋 Main Menu' },
      ]
    );

    // Driver's ACTIVE_RIDE session was already set in handle() when the
    // booking was confirmed — no need to set it again here.
  } else {
    sessionManager.clearSession(phone);
    const user = userService.getUserByPhone(phone);
    return require('./mainMenuFlow').show(phone, user);
  }
}

function getDb() { return require('../db/database').getDb(); }

module.exports = { start, handle, handleRecurring };
