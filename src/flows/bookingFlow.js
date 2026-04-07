'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const bookingService = require('../services/bookingService');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const {
  formatBookingConfirmation, formatSafetyInfo,
  formatLiabilityNotice, formatDriverNotification, formatDepartureTime,
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
    return waClient.sendText(phone,
      '😔 Sorry, those seats were just taken by someone else.\n\nReply *find* to search for another ride.'
    );
  }

  const booking = bookingService.createBooking({
    rideId: ride.RideID,
    userId: passenger.UserID,
    seatsBooked: seats,
    totalAmount: total,
  });

  const driver = userService.getUserById(ride.DriverID);
  const updatedRide = rideService.getRideById(ride.RideID);

  console.log(`[Booking] #${booking.BookingID} by ${passenger.Name} for ride #${ride.RideID}`);

  // 1. Booking confirmation
  await waClient.sendText(phone, formatBookingConfirmation(booking, ride, driver));

  // 2. Safety info (auto-send)
  await waClient.sendText(phone, formatSafetyInfo());

  // 3. Liability notice (auto-send)
  await waClient.sendText(phone, formatLiabilityNotice());

  // 4. Ask about recurring ride
  sessionManager.replaceSession(phone, {
    phone,
    flow: FLOWS.RECURRING,
    step: STEPS.RECURRING_ASK,
    data: { bookingId: booking.BookingID, rideId: ride.RideID },
  });

  await waClient.sendButtons(phone,
    '🔁 *Recurring Ride*\n\nDo you want this to be a *daily recurring ride*?\n_(Mon–Fri at the same time)_',
    [
      { id: 'rec_yes', title: '🔁 Yes, Daily Ride' },
      { id: 'rec_no', title: '✖️ No, Just Once' },
    ]
  );

  // Notify driver (fire and forget)
  if (driver) {
    waClient.sendText(driver.Phone, formatDriverNotification(booking, updatedRide, passenger))
      .catch(err => console.error('[Booking] Driver notify failed:', err.message));
  }
}

async function handleRecurring(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { bookingId } = session.data;

  if (['rec_yes', 'yes', '🔁 yes, daily ride'].includes(t)) {
    getDb().prepare('UPDATE Bookings SET IsRecurring = 1 WHERE BookingID = ?').run(bookingId);
    await waClient.sendText(phone,
      '✅ *Recurring ride set!* 🔁\n\nYour ride will repeat *Mon–Fri* at the same time.\n\n' +
      'You can cancel anytime by replying *cancel*.'
    );
  } else {
    await waClient.sendText(phone, '✅ Got it! One-time booking confirmed.');
  }

  sessionManager.clearSession(phone);
  const user = userService.getUserByPhone(phone);
  return require('./mainMenuFlow').show(phone, user);
}

function getDb() { return require('../db/database').getDb(); }

module.exports = { start, handle, handleRecurring };
