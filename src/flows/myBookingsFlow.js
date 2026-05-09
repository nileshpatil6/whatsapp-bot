'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const bookingService = require('../services/bookingService');
const userService = require('../services/userService');
const rideService = require('../services/rideService');
const { FLOWS, STEPS } = require('../utils/constants');
const { formatDepartureTime } = require('../utils/formatters');
const { parseTimeInput, formatDateForDb } = require('../utils/validators');
const postTripFlow = require('./postTripFlow');

async function start(phone, user) {
  if (!user) user = userService.getUserByPhone(phone);

  const bookings = bookingService.getBookingsByUser(user.UserID);
  const offeredRides = rideService.getRidesByDriver(user.UserID)
    .filter(r => r.Status === 'active').slice(0, 5);

  sessionManager.setSession(phone, {
    flow: FLOWS.MY_BOOKINGS,
    step: STEPS.CANCEL_SELECT,
    data: { bookings, offeredRides },
  });

  const hasBookings = bookings.length > 0;
  const hasRides = offeredRides.length > 0;

  const freshUser = userService.getUserByPhone(phone);
  const earnings = freshUser ? (freshUser.TotalEarnings || 0) : 0;
  const earningsLine = `\n💰 *Total Earnings: ₹${Math.round(earnings)}*`;

  if (!hasBookings && !hasRides) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone,
      `📋 *My Bookings & Rides*${earningsLine}\n\n` +
      'You have no active bookings or offered rides.\n\nUse the menu to find or offer a ride. 🚗'
    );
  }

  const sections = [];

  if (hasBookings) {
    sections.push({
      title: '📋 Your Bookings',
      rows: bookings.slice(0, 5).map((b) => ({
        id: `booking_${b.BookingID}`,
        title: trunc(`${b.PickupLocation} → ${b.Destination}`, 24),
        description: trunc(`${formatDepartureTime(b.DepartureTime)} | #${b.BookingID} | ${b.SeatsBooked} seat(s)`, 72),
      })),
    });
  }

  if (hasRides) {
    sections.push({
      title: '🚗 Rides You Offered',
      rows: offeredRides.map((r) => ({
        id: `ride_${r.RideID}`,
        title: trunc(`${r.PickupLocation} → ${r.Destination}`, 24),
        description: trunc(`${formatDepartureTime(r.DepartureTime)} | ${r.BookedSeats}/${r.TotalSeats} booked`, 72),
      })),
    });
  }

  const bodyText =
    `📋 *My Bookings & Rides*${earningsLine}\n\n` +
    (hasBookings ? `✅ ${bookings.length} booking(s) — tap to view/cancel\n` : '') +
    (hasRides ? `🚗 ${offeredRides.length} offered ride(s) — tap to manage\n` : '');

  return waClient.sendList(phone, bodyText, 'View Details 📋', sections);
}

async function handle(phone, text, session) {
  const t = text.trim().toLowerCase();

  if (t === 'menu' || t === 'back') {
    sessionManager.clearSession(phone);
    const user = userService.getUserByPhone(phone);
    return require('./mainMenuFlow').show(phone, user);
  }

  switch (session.step) {
    case STEPS.CANCEL_SELECT:        return handleSelect(phone, text, session);
    case STEPS.CANCEL_CONFIRM:       return handleBookingCancelConfirm(phone, text, session);
    case STEPS.RIDE_MANAGE:          return handleRideManage(phone, text, session);
    case STEPS.RIDE_CANCEL_CONFIRM:  return handleRideCancelConfirm(phone, text, session);
    case STEPS.RIDE_RESCHEDULE_TIME: return handleRescheduleTime(phone, text, session);
    default:
      return start(phone, userService.getUserByPhone(phone));
  }
}

// ─── SELECT: user tapped something from the list ─────────────────────────────

async function handleSelect(phone, text, session) {
  const t = text.trim().toLowerCase();

  // Booking row tapped
  if (t.startsWith('booking_')) {
    const bookingId = parseInt(t.replace('booking_', ''), 10);
    const booking = session.data.bookings.find(b => b.BookingID === bookingId);
    if (!booking) return waClient.sendButtons(phone, '❌ Booking not found.', [{ id: 'pf_menu', title: '📋 Main Menu' }]);
    return askCancelBooking(phone, booking);
  }

  // Offered ride row tapped
  if (t.startsWith('ride_')) {
    const rideId = parseInt(t.replace('ride_', ''), 10);
    return showRideManageMenu(phone, rideId);
  }

  // Numeric fallback: user typed "1", "2" etc. — map to bookings
  const idx = parseInt(text.trim(), 10);
  const { bookings } = session.data;
  if (!isNaN(idx) && idx >= 1 && idx <= bookings.length) {
    return askCancelBooking(phone, bookings[idx - 1]);
  }

  await waClient.sendButtons(phone, '👆 Tap an item from the list to manage it.', [{ id: 'pf_menu', title: '📋 Main Menu' }]);
}

// ─── BOOKING CANCEL ───────────────────────────────────────────────────────────

async function askCancelBooking(phone, booking) {
  const fullBooking = bookingService.getBookingById(booking.BookingID);
  const ride   = fullBooking ? rideService.getRideById(fullBooking.RideID) : null;
  const driver = ride ? userService.getUserById(ride.DriverID) : null;
  const driverContact = driver && driver.ContactPhone ? `+${driver.ContactPhone}` : '_not shared yet_';
  const codeLine = fullBooking && fullBooking.VerificationCode
    ? `\n🎫 *Ride Code: ${fullBooking.VerificationCode}* _(show to driver)_` : '';

  sessionManager.setSession(phone, {
    step: STEPS.CANCEL_CONFIRM,
    data: {
      cancelBookingId: booking.BookingID,
      cancelBookingText: `${booking.PickupLocation} → ${booking.Destination}`,
    },
  });

  return waClient.sendButtons(phone,
    `📋 *Booking #${booking.BookingID}*\n\n` +
    `🗺️ ${booking.PickupLocation} → ${booking.Destination}\n` +
    `🕐 ${formatDepartureTime(booking.DepartureTime)}\n` +
    `💺 ${booking.SeatsBooked} seat(s)\n` +
    `👤 Driver: ${driver ? driver.Name : 'Unknown'}\n` +
    `📞 Driver contact: ${driverContact}` +
    `${codeLine}\n\n` +
    '_Cancel this booking?_',
    [
      { id: 'cancel_yes', title: '⚠️ Cancel Booking' },
      { id: 'cancel_no', title: '← Keep Booking' },
    ]
  );
}

async function handleBookingCancelConfirm(phone, text, session) {
  const t = text.trim().toLowerCase();

  if (['cancel_yes', 'yes', '⚠️ yes, cancel'].includes(t)) {
    const bookingId = session.data.cancelBookingId;

    // Fetch before cancelling so we have route info for driver notification
    const fullBooking = bookingService.getBookingById(bookingId);
    const ride  = fullBooking ? rideService.getRideById(fullBooking.RideID) : null;
    const driver = ride ? userService.getUserById(ride.DriverID) : null;

    bookingService.cancelBooking(bookingId);

    // Notify driver — fire and forget
    if (driver && driver.Phone !== phone) {
      waClient.sendText(driver.Phone,
        `⚠️ *Booking Cancelled*\n\n` +
        `A passenger has cancelled their booking on your ride.\n\n` +
        `🗺️ ${session.data.cancelBookingText}\n` +
        `🎫 Booking #${bookingId}` +
        (fullBooking ? `\n💺 ${fullBooking.SeatsBooked} seat(s) now available again.` : '') +
        ``
      ).catch(err => console.error('[MyBookings] Driver cancel notify failed:', err.message));
    }

    // Transition to feedback flow (optional) — session now set to FEEDBACK
    const { FLOWS: F } = require('../utils/constants');
    sessionManager.replaceSession(phone, {
      phone,
      flow: F.FEEDBACK,
      step: 'FEEDBACK_AWAIT',
      data: { bookingId, role: 'passenger' },
    });

    return waClient.sendButtons(phone,
      `✅ *Booking #${bookingId} cancelled.*\n\n` +
      `_${session.data.cancelBookingText}_\n\n` +
      '_Would you like to share feedback?_',
      [
        { id: 'pf_feedback', title: '💬 Leave Feedback' },
        { id: 'pf_menu',     title: '📋 Main Menu' },
      ]
    );
  }

  if (['cancel_no', 'no', '← keep booking'].includes(t)) {
    const user = userService.getUserByPhone(phone);
    return start(phone, user);
  }

  return waClient.sendButtons(phone, 'Cancel this booking?',
    [
      { id: 'cancel_yes', title: '⚠️ Yes, Cancel' },
      { id: 'cancel_no', title: '← Keep Booking' },
    ]
  );
}

// ─── RIDE MANAGE ──────────────────────────────────────────────────────────────

async function showRideManageMenu(phone, rideId) {
  const ride = rideService.getRideById(rideId);
  if (!ride || ride.Status !== 'active') {
    await waClient.sendButtons(phone, '❌ Ride not found or already cancelled.', [{ id: 'pf_menu', title: '📋 Main Menu' }]);
    return;
  }

  sessionManager.setSession(phone, {
    step: STEPS.RIDE_MANAGE,
    data: { managingRideId: rideId },
  });

  const passengerBtnTitle = ride.BookedSeats > 0 ? `👥 Passengers (${ride.BookedSeats})` : '👥 Passengers';
  return waClient.sendButtons(phone,
    `🚗 *Manage Your Ride*\n\n` +
    `🗺️ Route: ${ride.PickupLocation} → ${ride.Destination}\n` +
    `🕐 Time: ${formatDepartureTime(ride.DepartureTime)}\n` +
    `💺 ${ride.BookedSeats}/${ride.TotalSeats} seats booked\n` +
    `💰 ₹${ride.PricePerSeat}/seat\n\n` +
    'What would you like to do?',
    [
      { id: 'ride_passengers', title: passengerBtnTitle },
      { id: 'ride_complete',   title: '✅ Mark Complete' },
      { id: 'ride_reschedule', title: '🗓️ Reschedule' },
      { id: 'ride_cancel',     title: '❌ Cancel Ride' },
    ]
  );
}

async function handleRideManage(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { managingRideId } = session.data;

  if (['ride_back', 'back', '← back'].includes(t)) {
    const user = userService.getUserByPhone(phone);
    return start(phone, user);
  }

  if (['ride_passengers', '👥 passengers'].includes(t) || t.startsWith('ride_passengers')) {
    const passengers = rideService.getPassengersByRide(managingRideId);
    if (passengers.length === 0) {
      return waClient.sendButtons(phone, '👥 No passengers booked yet.',
        [{ id: 'ride_back', title: '← Back' }]
      );
    }
    let msg = `👥 *Passengers (${passengers.length})*\n\n`;
    passengers.forEach((p, i) => {
      const contact = p.ContactPhone ? `+${p.ContactPhone}` : '_not shared_';
      msg += `*${i + 1}. ${p.Name}*\n`;
      msg += `   📞 ${contact}\n`;
      msg += `   🎫 Code: ${p.VerificationCode} | 💺 ${p.SeatsBooked} seat(s)\n\n`;
    });
    return waClient.sendButtons(phone, msg, [{ id: 'ride_back', title: '← Back' }]);
  }

  if (['ride_complete', '✅ mark complete'].includes(t)) {
    const ride = rideService.getRideById(managingRideId);
    const passengers = rideService.getPassengersByRide(managingRideId);

    // Credit driver earnings from all confirmed bookings
    const confirmedBookings = bookingService.getConfirmedBookingsByRide(managingRideId);
    const earned = confirmedBookings.reduce((sum, b) => sum + (b.TotalAmount || 0), 0);
    const driverUser = userService.getUserByPhone(phone);
    if (earned > 0 && driverUser) {
      userService.addEarnings(driverUser.UserID, earned);
      console.log(`[Earnings] ₹${earned} credited to driver ${driverUser.Name} (${phone})`);
    }

    rideService.completeRide(managingRideId);
    sessionManager.clearSession(phone);

    await postTripFlow.triggerForDriver(phone, ride, passengers);
    return;
  }

  if (['ride_reschedule', '🗓️ reschedule'].includes(t)) {
    const ride = rideService.getRideById(managingRideId);
    sessionManager.setSession(phone, { step: STEPS.RIDE_RESCHEDULE_TIME });
    return waClient.sendText(phone,
      `🗓️ *Reschedule Ride*\n\n` +
      `Current time: *${formatDepartureTime(ride ? ride.DepartureTime : '')}*\n\n` +
      `Enter the *new departure time:*\n_(e.g. 09:00, 17:30 or tomorrow 08:30)_`
    );
  }

  if (['ride_cancel', '❌ cancel ride'].includes(t)) {
    const passengers = rideService.getPassengersByRide(managingRideId);
    const ride = rideService.getRideById(managingRideId);
    sessionManager.setSession(phone, {
      step: STEPS.RIDE_CANCEL_CONFIRM,
      data: { managingRideId, passengerCount: passengers.length },
    });

    const passNote = passengers.length > 0
      ? `\n\n⚠️ *${passengers.length} passenger(s)* will be notified.`
      : '\n\n_(No passengers booked yet)_';

    return waClient.sendButtons(phone,
      `❌ *Cancel Your Ride?*\n\n` +
      `🗺️ ${ride ? `${ride.PickupLocation} → ${ride.Destination}` : ''}\n` +
      `🕐 ${ride ? formatDepartureTime(ride.DepartureTime) : ''}` +
      passNote,
      [
        { id: 'rcancel_yes', title: '❌ Yes, Cancel Ride' },
        { id: 'rcancel_no', title: '← Keep Ride' },
      ]
    );
  }

  // Unexpected — re-show buttons
  return showRideManageMenu(phone, managingRideId);
}

// ─── RIDE CANCEL CONFIRM ──────────────────────────────────────────────────────

async function handleRideCancelConfirm(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { managingRideId } = session.data;

  if (['rcancel_no', 'no', '← keep ride'].includes(t)) {
    const user = userService.getUserByPhone(phone);
    return start(phone, user);
  }

  if (['rcancel_yes', 'yes', '❌ yes, cancel ride'].includes(t)) {
    const ride = rideService.getRideById(managingRideId);
    const passengers = rideService.getPassengersByRide(managingRideId);

    bookingService.cancelBookingsByRide(managingRideId);
    rideService.cancelRide(managingRideId);
    sessionManager.clearSession(phone);

    await waClient.sendButtons(phone,
      `✅ *Ride Cancelled.*\n\n` +
      `🗺️ ${ride ? `${ride.PickupLocation} → ${ride.Destination}` : ''}\n` +
      `🕐 ${ride ? formatDepartureTime(ride.DepartureTime) : ''}\n\n` +
      (passengers.length > 0 ? `📲 Notifying ${passengers.length} passenger(s)...` : ''),
      [{ id: 'pf_menu', title: '📋 Main Menu' }]
    );

    // Notify passengers — fire and forget
    for (const p of passengers) {
      waClient.sendText(p.Phone,
        `⚠️ *Ride Cancelled by Driver*\n\n` +
        `Your ride *${ride.PickupLocation} → ${ride.Destination}* ` +
        `(${formatDepartureTime(ride.DepartureTime)}) has been *cancelled*.\n\n` +
        `Booking #${p.BookingID} has been cancelled.\n\n` +
        `Tap *Find a Ride* in the main menu to search again. 🚗`
      ).catch(err => console.error('[MyBookings] Passenger cancel notify failed:', err.message));
    }
    return;
  }

  return waClient.sendButtons(phone, '❌ Cancel this ride?',
    [
      { id: 'rcancel_yes', title: '❌ Yes, Cancel Ride' },
      { id: 'rcancel_no', title: '← Keep Ride' },
    ]
  );
}

// ─── RESCHEDULE TIME ──────────────────────────────────────────────────────────

async function handleRescheduleTime(phone, text, session) {
  const { managingRideId } = session.data;

  const parsed = parseTimeInput(text);
  if (!parsed) {
    return waClient.sendText(phone,
      '❌ Couldn\'t understand that time.\n_(e.g. *09:00*, *17:30*, *tomorrow 08:30*)_\n\n🗓️ *New Departure Time:*'
    );
  }

  const newTime = formatDateForDb(parsed);
  const newDisplay = formatDepartureTime(newTime);
  const ride = rideService.getRideById(managingRideId);
  const passengers = rideService.getPassengersByRide(managingRideId);

  rideService.rescheduleRide(managingRideId, newTime);
  sessionManager.clearSession(phone);

  await waClient.sendButtons(phone,
    `✅ *Ride Rescheduled!*\n\n` +
    `🗺️ ${ride ? `${ride.PickupLocation} → ${ride.Destination}` : ''}\n` +
    `🕐 New time: *${newDisplay}*\n\n` +
    (passengers.length > 0 ? `📲 Notifying ${passengers.length} passenger(s)...` : ''),
    [{ id: 'pf_menu', title: '📋 Main Menu' }]
  );

  // Notify passengers — fire and forget
  for (const p of passengers) {
    waClient.sendText(p.Phone,
      `🗓️ *Ride Rescheduled*\n\n` +
      `Your ride *${ride.PickupLocation} → ${ride.Destination}* ` +
      `has been rescheduled by the driver.\n\n` +
      `🕐 New departure time: *${newDisplay}*\n` +
      `🎫 Booking #${p.BookingID} is still *confirmed*.\n\n` +
      `Check *My Bookings* for the updated time. 🚗`
    ).catch(err => console.error('[MyBookings] Passenger reschedule notify failed:', err.message));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trunc(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

module.exports = { start, handle };
