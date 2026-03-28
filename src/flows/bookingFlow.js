'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const bookingService = require('../services/bookingService');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const { isValidBookingSeats } = require('../utils/validators');
const { formatBookingConfirmation, formatDriverNotification, formatDepartureTime } = require('../utils/formatters');

async function start(phone, ride) {
  const available = ride.TotalSeats - ride.BookedSeats;

  sessionManager.replaceSession(phone, {
    phone,
    flow: FLOWS.BOOKING,
    step: STEPS.BOOK_ASK_SEATS,
    data: { ride },
  });

  await waClient.sendText(phone,
    `🚗 *${ride.PickupLocation} → ${ride.Destination}*\n` +
    `🕐 ${formatDepartureTime(ride.DepartureTime)}\n` +
    `💰 ₹${ride.PricePerSeat}/seat | 💺 ${available} seat(s) available\n\n` +
    `How many seats do you need? _(1–${available})_`
  );
}

async function handle(phone, text, session) {
  switch (session.step) {
    case STEPS.BOOK_ASK_SEATS: return handleSeats(phone, text, session);
    case STEPS.BOOK_CONFIRM:   return handleConfirm(phone, text, session);
    default: return waClient.sendText(phone, 'Something went wrong. Reply *Menu* to start over.');
  }
}

async function handleSeats(phone, text, session) {
  const ride = session.data.ride;
  const available = ride.TotalSeats - ride.BookedSeats;

  if (!isValidBookingSeats(text, available)) {
    return waClient.sendText(phone,
      `❌ Please enter a number between 1 and ${available}.\n\nHow many seats do you need?`
    );
  }

  const seatsBooked = parseInt(text.trim(), 10);
  const totalAmount = seatsBooked * ride.PricePerSeat;
  const priceStr = totalAmount === 0 ? 'Free' : `₹${totalAmount}`;

  sessionManager.setSession(phone, {
    step: STEPS.BOOK_CONFIRM,
    data: { seatsBooked, totalAmount },
  });

  const driver = userService.getUserById(ride.DriverID);

  await waClient.sendButtons(phone,
    `📋 *Booking Summary*\n\n` +
    `🚗 ${ride.PickupLocation} → ${ride.Destination}\n` +
    `🕐 ${formatDepartureTime(ride.DepartureTime)}\n` +
    `💺 Seats: ${seatsBooked}\n` +
    `💰 Total: ${priceStr}\n` +
    `👤 Driver: ${driver ? driver.Name : 'Unknown'}\n\n` +
    `_Payment is done directly to the driver via UPI or Cash._\n\n` +
    `Confirm booking?`,
    [
      { id: 'book_yes', title: '✅ Confirm Booking' },
      { id: 'book_no', title: '❌ Cancel' },
    ]
  );
}

async function handleConfirm(phone, text, session) {
  const t = text.trim().toLowerCase();

  if (['book_no', 'no', 'cancel', '❌ cancel'].includes(t)) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone, 'Booking cancelled. Reply *Menu* to go back.');
  }

  if (!['book_yes', 'yes', '✅ confirm booking'].includes(t)) {
    return waClient.sendButtons(phone, 'Please confirm your booking:',
      [
        { id: 'book_yes', title: '✅ Confirm Booking' },
        { id: 'book_no', title: '❌ Cancel' },
      ]
    );
  }

  const { ride, seatsBooked, totalAmount } = session.data;
  const passenger = userService.getUserByPhone(phone);

  // Atomic: increment seats first (concurrency guard), then create booking
  const changed = rideService.incrementBookedSeats(ride.RideID, seatsBooked);
  let booking = null;
  if (changed > 0) {
    booking = bookingService.createBooking({
      rideId: ride.RideID,
      userId: passenger.UserID,
      seatsBooked,
      totalAmount,
    });
  }

  if (!booking) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone,
      '😔 Sorry, those seats were just taken by someone else.\n\n' +
      'Reply *2* to search for another ride.'
    );
  }

  const driver = userService.getUserById(ride.DriverID);
  // Fetch the updated ride for correct seat counts
  const updatedRide = rideService.getRideById(ride.RideID);

  sessionManager.clearSession(phone);
  console.log(`[Booking] #${booking.BookingID} by ${passenger.Name} for ride #${ride.RideID}`);

  // Confirm to passenger
  await waClient.sendText(phone, formatBookingConfirmation(booking, ride, driver, passenger));

  // Notify driver (fire-and-forget)
  if (driver) {
    waClient.sendText(driver.Phone, formatDriverNotification(booking, updatedRide, passenger))
      .catch((err) => console.error('[Booking] Driver notification failed:', err.message));
  }
}

module.exports = { start, handle };
